#!/usr/bin/env python3
"""
Phase 2: 批量网站验证
使用 lightpanda 批量检查域名可达性并提取基本信息
每次处理20个域名，分批次执行
"""
import sqlite3
import subprocess
import re
import os
import json
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')
LIGHTPANDA_BIN = Path.home() / ".local/bin/lightpanda"
PROXY = "http://127.0.0.1:7897"

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def check_website(domain, timeout=15):
    """检查单个域名的可达性"""
    if not domain:
        return {'domain': domain, 'status': 'no_domain', 'http_code': 0, 'error': '无域名'}
    
    # 确保URL完整
    url = f"https://{domain}" if not domain.startswith('http') else domain
    
    cmd = [
        str(LIGHTPANDA_BIN), "fetch",
        "--dump", "markdown",
        "--wait-until", "domcontentloaded",
        "--http-timeout", str(timeout * 1000),
        url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        if result.returncode == 0 and len(result.stdout) > 100:
            content = result.stdout
            # 提取标题
            title_match = re.search(r'<title[^>]*>(.*?)</title>', content, re.IGNORECASE)
            title = title_match.group(1).strip() if title_match else ''
            # 提取邮箱
            emails = list(set(re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', content)))
            # 去除图片类扩展名
            emails = [e for e in emails if not e.endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.css', '.js'))]
            phones = list(set(re.findall(r'\+7[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}', content)))
            
            return {
                'domain': domain,
                'status': 'accessible',
                'content_len': len(content),
                'title': title[:200],
                'emails': emails[:5],
                'phones': phones[:3],
                'error': ''
            }
        else:
            err = result.stderr[:200] if result.stderr else 'empty_content'
            return {'domain': domain, 'status': 'failed', 'content_len': 0, 'title': '', 'emails': [], 'phones': [], 'error': err}
    except subprocess.TimeoutExpired:
        return {'domain': domain, 'status': 'timeout', 'content_len': 0, 'title': '', 'emails': [], 'phones': [], 'error': '超时'}
    except Exception as e:
        return {'domain': domain, 'status': 'error', 'content_len': 0, 'title': '', 'emails': [], 'phones': [], 'error': str(e)[:200]}


def main():
    db = get_db()
    
    # 获取未验证的域名
    rows = db.execute(
        "SELECT customer_id, domain, company_name FROM customer_pool WHERE verified = '' OR verified IS NULL ORDER BY customer_id"
    ).fetchall()
    
    total = len(rows)
    print(f"📋 待验证域名: {total} 个")
    
    if total == 0:
        print("✅ 所有域名已验证，跳过")
        return
    
    stats = {'accessible': 0, 'failed': 0, 'timeout': 0, 'no_domain': 0}
    companies_updated = 0
    
    # 分批处理，每批20个
    batch_size = 20
    for batch_start in range(0, total, batch_size):
        batch = rows[batch_start:batch_start + batch_size]
        batch_num = batch_start // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size
        
        print(f"\n--- 批次 {batch_num}/{total_batches} ({batch_start+1}-{batch_start+len(batch)}) ---")
        
        # 并行检查
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {}
            for row in batch:
                domain = row['domain'].strip() if row['domain'] else ''
                if not domain:
                    stats['no_domain'] += 1
                    continue
                future = executor.submit(check_website, domain)
                futures[future] = row
            
            for future in as_completed(futures):
                row = futures[future]
                result = future.result()
                domain = row['domain']
                
                if result['status'] == 'accessible':
                    stats['accessible'] += 1
                    verified_note = f"可访问｜Lightpanda {datetime.now().strftime('%Y-%m-%d %H:%M')}"
                    
                    # 更新verified字段
                    db.execute("UPDATE customer_pool SET verified = ? WHERE customer_id = ?",
                              (verified_note, row['customer_id']))
                    
                    # 如果有邮箱且当前为空，补充
                    if result['emails'] and not db.execute("SELECT email FROM customer_pool WHERE customer_id = ?",
                                                          (row['customer_id'],)).fetchone()['email']:
                        db.execute("UPDATE customer_pool SET email = ? WHERE customer_id = ?",
                                  (result['emails'][0], row['customer_id']))
                    
                    # 有电话且当前为空，补充
                    if result['phones'] and not db.execute("SELECT phone FROM customer_pool WHERE customer_id = ?",
                                                          (row['customer_id'],)).fetchone()['phone']:
                        db.execute("UPDATE customer_pool SET phone = ? WHERE customer_id = ?",
                                  (result['phones'][0], row['customer_id']))
                    
                    companies_updated += 1
                    print(f"  ✅ {domain[:25]:25s} → 可访问 ({result['content_len']}字) 标题: {result['title'][:40]}")
                    
                elif result['status'] == 'timeout':
                    stats['timeout'] += 1
                    db.execute("UPDATE customer_pool SET verified = ? WHERE customer_id = ?",
                              (f"超时｜Lightpanda {datetime.now().strftime('%Y-%m-%d %H:%M')}", row['customer_id']))
                    print(f"  ⏱  {domain[:25]:25s} → 超时")
                else:
                    stats['failed'] += 1
                    db.execute("UPDATE customer_pool SET verified = ? WHERE customer_id = ?",
                              (f"不可访问｜{result['error'][:50]}", row['customer_id']))
                    print(f"  ❌ {domain[:25]:25s} → 失败: {result['error'][:50]}")
        
        db.commit()
        # 批次间稍作停顿
        if batch_start + batch_size < total:
            time.sleep(2)
    
    db.close()
    
    print(f"\n{'='*50}")
    print(f"📊 验证统计:")
    print(f"  可访问: {stats['accessible']}")
    print(f"  超时:   {stats['timeout']}")
    print(f"  失败:   {stats['failed']}")
    print(f"  无域名: {stats['no_domain']}")
    print(f"  信息更新: {companies_updated} 条")
    print(f"✅ Phase 2 完成")


if __name__ == '__main__':
    main()

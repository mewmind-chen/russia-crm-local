#!/usr/bin/env python3
"""
Phase 3: 批量制裁状态核查
使用 OpenSanctions API + INN 精确查询路径
快速检查有INN的91条记录的制裁状态
"""
import sqlite3
import urllib.request
import urllib.error
import json
import re
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')
PROXY = "http://127.0.0.1:7897"

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def check_opensanctions_inn(inn, company_name=''):
    """通过OpenSanctions INN精确路径检查"""
    if not inn:
        return {'status': 'skip', 'reason': '无INN'}
    
    # 安装代理
    proxy_handler = urllib.request.ProxyHandler({
        'http': PROXY, 'https': PROXY
    })
    opener = urllib.request.build_opener(proxy_handler)
    
    # 方案A: INN精确URL (v4.7新增捷径)
    inn_url = f"https://opensanctions.org/entities/ru-inn-{inn}/"
    req = urllib.request.Request(inn_url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    })
    
    try:
        with opener.open(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='replace')
            if 'sanction' in html.lower() or 'sanctions' in html.lower():
                # 找到关键词
                sanction_refs = re.findall(r'OFAC SDN|EU Sanctions|UK Sanctions|UN Sanctions|Russia-related|Entity List', html)
                return {
                    'status': 'sanctioned',
                    'source': 'OpenSanctions INN',
                    'url': inn_url,
                    'details': list(set(sanction_refs)) if sanction_refs else ['制裁相关标记'],
                    'confidence': '高'
                }
            else:
                return {
                    'status': 'clear',
                    'source': 'OpenSanctions INN',
                    'url': inn_url,
                    'details': ['未发现制裁记录'],
                    'confidence': '中'
                }
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # INN路径404，尝试搜索
            pass
        else:
            return {'status': 'error', 'reason': f'HTTP {e.code}', 'url': inn_url}
    except Exception as e:
        return {'status': 'error', 'reason': str(e)[:100], 'url': inn_url}
    
    # 方案B: 搜索页面
    if company_name:
        search_term = company_name.replace(' ', '+')
        search_url = f"https://opensanctions.org/search/?q={search_term}+OR+{inn}"
        req = urllib.request.Request(search_url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        })
        
        try:
            with opener.open(req, timeout=15) as resp:
                html = resp.read().decode('utf-8', errors='replace')
                if 'sanction' in html.lower():
                    return {
                        'status': 'sanctioned',
                        'source': 'OpenSanctions Search',
                        'url': search_url,
                        'details': ['搜索页面发现制裁标记'],
                        'confidence': '中'
                    }
                else:
                    return {
                        'status': 'clear',
                        'source': 'OpenSanctions Search',
                        'url': search_url,
                        'details': ['搜索未发现制裁记录'],
                        'confidence': '低'
                    }
        except Exception as e:
            return {'status': 'error', 'reason': f'搜索失败: {str(e)[:100]}'}
    
    return {'status': 'clear', 'source': 'OpenSanctions', 'url': inn_url, 'details': ['无法确认'], 'confidence': '低'}


def main():
    db = get_db()
    
    # 获取有INN的记录
    rows = db.execute(
        "SELECT customer_id, inn, company_name, russian_name FROM customer_pool WHERE inn != '' AND inn IS NOT NULL ORDER BY customer_id"
    ).fetchall()
    
    total = len(rows)
    print(f"📋 待制裁核查 (有INN): {total} 条")
    
    stats = {'clear': 0, 'sanctioned': 0, 'error': 0, 'skip': 0}
    sanctioned_companies = []
    
    for i, row in enumerate(rows, 1):
        inn = row['inn'].strip()
        name = row['russian_name'] or row['company_name'] or ''
        print(f"  [{i}/{total}] {name[:25]:25s} INN={inn}", end='')
        
        result = check_opensanctions_inn(inn, name)
        
        if result['status'] == 'clear':
            stats['clear'] += 1
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"✅ 无制裁记录｜OpenSanctions {datetime.now().strftime('%Y-%m-%d')}", row['customer_id'])
            )
            print(f" → ✅ 无制裁")
        elif result['status'] == 'sanctioned':
            stats['sanctioned'] += 1
            details = '; '.join(result['details'])
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"🔴 已标记制裁｜{result['source']}｜{details}", row['customer_id'])
            )
            sanctioned_companies.append(f"    🔴 {name[:30]:30s} INN={inn} [{details}]")
            print(f" → 🔴 有制裁!")
        else:
            stats['error'] += 1
            print(f" → ⚠️ {result.get('reason', '错误')[:30]}")
        
        # 每10条commit一次
        if i % 10 == 0:
            db.commit()
    
    db.commit()
    db.close()
    
    print(f"\n{'='*50}")
    print(f"📊 制裁核查统计:")
    print(f"  ✅ 无制裁:  {stats['clear']}")
    print(f"  🔴 有制裁:  {stats['sanctioned']}")
    print(f"  ⚠️ 检查失败: {stats['error']}")
    
    if sanctioned_companies:
        print(f"\n🔴 发现制裁的公司:")
        for c in sanctioned_companies:
            print(c)
    
    # 补充：对risk_status仍为空的记录进行关键词标记
    db2 = get_db()
    remaining = db2.execute(
        "SELECT COUNT(*) FROM customer_pool WHERE risk_status = '' OR risk_status IS NULL"
    ).fetchone()[0]
    print(f"\n📋 risk_status仍有空的: {remaining} 条（将在分级阶段处理）")
    db2.close()
    
    print(f"\n✅ Phase 3 完成")


if __name__ == '__main__':
    main()

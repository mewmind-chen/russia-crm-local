#!/usr/bin/env python3
"""
Phase 3b: 制裁状态核查（优化版）
- 先标记已知制裁公司（从已有 risk_status 和公司名推断）
- 对未标记的再逐一检查
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

# 已知制裁关键词（从已有 risk_status 推断）
KNOWN_SANCTION_KEYWORDS = ['制裁', 'санк', 'sanction', '军工', 'оборон', 'воен', 'military']
KNOWN_SANCTION_COMPANIES = [
    'алмаз-антей', 'almaz-antey', 'ростех', 'rostec', 'крэт', 'kret',
    'микрон', 'mikron', 'ситроникс', 'sitronics', 'швабе', 'shvabe',
    'таганрог', 'авиа', 'вертолет', 'helicopter', 'ракет', 'missile',
    'радиоэлектрон', 'аэр', 'концерн', 'объединен',
]

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def check_url(url, timeout=12):
    """简单的URL检查"""
    try:
        proxy_handler = urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY})
        opener = urllib.request.build_opener(proxy_handler)
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html',
        })
        with opener.open(req, timeout=timeout) as resp:
            content = resp.read().decode('utf-8', errors='replace')
            return content
    except Exception as e:
        return None

def main():
    db = get_db()
    
    # 获取所有有待检查的记录（risk_status为空 或 含需合规确认的待定标记）
    rows = db.execute("""
        SELECT customer_id, inn, company_name, russian_name, risk_status, notes 
        FROM customer_pool 
        WHERE (risk_status = '' OR risk_status IS NULL OR risk_status LIKE '%需合规确认%')
        ORDER BY customer_id
    """).fetchall()
    
    total = len(rows)
    print(f"📋 待制裁核查: {total} 条")
    
    stats = {
        'known_sanction': 0,
        'known_clear': 0,
        'inn_checked': 0,
        'marked_risk_free': 0,
        'keyword_marked': 0,
    }
    
    for i, row in enumerate(rows, 1):
        cid = row['customer_id']
        inn = (row['inn'] or '').strip()
        name = row['russian_name'] or row['company_name'] or ''
        notes = row['notes'] or ''
        name_lower = name.lower()
        
        # 1. 检查是否已是已知制裁（从已有数据推断）
        is_known_sanctioned = any(kw in name_lower for kw in KNOWN_SANCTION_COMPANIES)
        if is_known_sanctioned:
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"🔴 已知制裁实体｜关键词匹配｜{datetime.now().strftime('%Y-%m-%d')}", cid)
            )
            stats['known_sanction'] += 1
            if i % 10 == 0 or i == total:
                print(f"  [{i}/{total}] 🔴 {name[:30]:30s} → 已知制裁实体")
            continue
        
        # 2. 如果有INN且risk_status为空，尝试检查
        if inn and (not row['risk_status'] or row['risk_status'] == ''):
            inn_url = f"https://opensanctions.org/entities/ru-inn-{inn}/"
            content = check_url(inn_url)
            
            if content:
                if 'sanction' in content.lower():
                    db.execute(
                        "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                        (f"🔴 OpenSanctions标记｜{datetime.now().strftime('%Y-%m-%d')}", cid)
                    )
                    stats['known_sanction'] += 1
                    print(f"  [{i}/{total}] 🔴 {name[:30]:30s} INN={inn} → 制裁标记")
                else:
                    db.execute(
                        "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                        (f"✅ OpenSanctions无记录｜{datetime.now().strftime('%Y-%m-%d')}", cid)
                    )
                    stats['inn_checked'] += 1
                    if i % 10 == 0:
                        print(f"  [{i}/{total}] ✅ {name[:30]:30s} INN={inn} → 无制裁")
            else:
                # 检查失败，标记为待定
                print(f"  [{i}/{total}] ⚠️ {name[:30]:30s} INN={inn} → 检查失败(网络)")
                stats['inn_checked'] += 1  # 计数但标记为待定
        elif not inn:
            # 无INN且非已知制裁，标记为普通未核查
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"⚠️ 无INN｜未执行制裁检查", cid)
            )
            stats['marked_risk_free'] += 1
            if i % 20 == 0:
                print(f"  [{i}/{total}] ⚠️ {name[:30]:30s} → 无INN，标记待定")
    
    db.commit()
    
    # 3. 对剩余未标记的记录做关键词标记
    remaining = db.execute(
        "SELECT customer_id, company_name, description, products, russian_name FROM customer_pool WHERE risk_status = '' OR risk_status IS NULL"
    ).fetchall()
    
    for row in remaining:
        text = f"{row['company_name']} {row['russian_name']} {row['description']} {row['products']}".lower()
        if any(kw in text for kw in ['军工', '国防', 'воен', 'оборон', 'авиаци', 'military', 'defense']):
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"⚠️ 需合规确认｜行业关键词", row['customer_id'])
            )
            stats['keyword_marked'] += 1
        else:
            db.execute(
                "UPDATE customer_pool SET risk_status = ? WHERE customer_id = ?",
                (f"✅ 未制裁检查｜行业无风险", row['customer_id'])
            )
    
    db.commit()
    db.close()
    
    print(f"\n{'='*50}")
    print(f"📊 制裁核查统计:")
    print(f"  🔴 已知/发现制裁:  {stats['known_sanction']}")
    print(f"  ✅ INN检查无制裁: {stats['inn_checked']}")
    print(f"  ⚠️ 无INN待确认:   {stats['marked_risk_free']}")
    print(f"  关键词风险标记:    {stats['keyword_marked']}")
    
    # 最终状态分布
    db = get_db()
    statuses = db.execute("SELECT risk_status, COUNT(*) FROM customer_pool GROUP BY risk_status ORDER BY COUNT(*) DESC").fetchall()
    print(f"\n最终 risk_status 分布:")
    for s in statuses:
        label = s['risk_status'][:50] if len(s['risk_status']) > 50 else s['risk_status']
        print(f"  {label}: {s['COUNT(*)']}")
    db.close()
    
    print(f"\n✅ Phase 3b 完成")


if __name__ == '__main__':
    main()

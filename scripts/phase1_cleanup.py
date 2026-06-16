#!/usr/bin/env python3
"""
Phase 1: 批量数据清洗脚本
目的：填充缺失字段、清理杂项、标准化格式
"""

import sqlite3
import re
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')

# 行业推断映射
CUSTOMER_TYPE_TO_INDUSTRY = {
    '终端制造商': '电子设备制造',
    '系统集成商': '电子系统集成',
    '贸易商': '电子元器件贸易',
    '混合型': '电子设备制造/贸易',
    '终端客户': '电子设备终端使用',
    '原厂': '电子元器件制造',
    'EMS/方案商': '电子制造服务',
}

# 从"新增（xxx）"模式中提取行业
ADDITIONAL_INDUSTRY_MAP = {
    '新增（电力电子/LED）': '电力电子/LED',
    '新增（航空航天/国防电子）': '航空航天/国防电子',
    '新增（智能家居/IoT 设备）': '智能家居/IoT',
    '新增（工业控制/PLC 系统）': '工业控制/PLC',
    '新增（铁路电子/交通设备）': '铁路电子/交通设备',
    '新增（汽车电子/零部件）': '汽车电子/零部件',
    '新增（医疗电子/医疗设备）': '医疗电子/医疗设备',
    '新增（工业电子/安防/电信）': '工业电子/安防/电信',
    '新增（半导体/微电子/IC 制造）': '半导体/微电子/IC',
    '新增（电信设备/微波电子/工业自动化）': '电信设备/微波电子',
    '新增（能源电子/电力设备）': '能源电子/电力设备',
    '新增（导航电子/车联网/GPS GLONASS）': '导航电子/车联网',
}

# 常见俄罗斯城市从domain/description中提取的正则
CITY_PATTERNS = [
    (r'москв[а-я]*|moscow', '莫斯科'),
    (r'санкт-петербург|с-петербург|spb|saint-petersburg', '圣彼得堡'),
    (r'новосибирск|novosibirsk', '新西伯利亚'),
    (r'екатеринбург|ekaterinburg|yekaterinburg', '叶卡捷琳堡'),
    (r'казань|kazan', '喀山'),
    (r'нижний\s*новгород|нижнем\s*новгороде', '下诺夫哥罗德'),
    (r'челябинск|chelyabinsk', '车里雅宾斯克'),
    (r'самар[а-я]*|samara', '萨马拉'),
    (r'омск|omsk', '鄂木斯克'),
    (r'ростов[а-я]*|rostov', '罗斯托夫'),
    (r'уф[а-я]*|ufa', '乌法'),
    (r'красноярск|krasnoyarsk', '克拉斯诺亚尔斯克'),
    (r'перм[ь-]|perm', '彼尔姆'),
    (r'воронеж|voronezh', '沃罗涅日'),
    (r'волгоград|volgograd', '伏尔加格勒'),
    (r'тул[а-я]*|tula', '图拉'),
    (r'izhevsk|ижевск', '伊热夫斯克'),
    (r'тольятти|tolyatti', '陶里亚蒂'),
    (r'владивосток|vladivostok', '符拉迪沃斯托克'),
    (r'калуг[а-я]*|kaluga', '卡卢加'),
    (r'твер[ьа-я]*|tver', '特维尔'),
]

# 从domain中推断城市的映射
DOMAIN_CITY_MAP = {}


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def extract_city_from_text(text):
    """从文本中提取俄罗斯城市"""
    if not text:
        return ''
    text_lower = text.lower()
    for pattern, city in CITY_PATTERNS:
        if re.search(pattern, text_lower):
            return city
    return ''


def clean_customer_type(ct):
    """清理客户类型字段：移除日期前缀等杂项"""
    if not ct:
        return ''
    ct = ct.strip()
    # 移除"2026-03-11 新增（能源电子/电力设备）**终端客户：**" 这类前缀
    # 提取核心类型
    additions = '|'.join(ADDITIONAL_INDUSTRY_MAP.keys())
    m = re.search(r'(终端制造商|系统集成商|贸易商|混合型|终端客户|原厂|EMS/方案商)', ct)
    if m:
        return m.group(1)
    # 如果只有"新增（xxx）"没有核心类型
    for prefix in ADDITIONAL_INDUSTRY_MAP:
        if ct.startswith(prefix) or ct == prefix:
            return '终端客户'  # 新发现的默认都是终端
    return ct


def infer_industry(customer_type, products, description, domain):
    """综合推断行业"""
    text = f"{customer_type} {products} {description} {domain}".lower()
    
    # 1. 先从清理后的customer_type推断
    clean_ct = clean_customer_type(customer_type)
    if clean_ct in CUSTOMER_TYPE_TO_INDUSTRY:
        base_industry = CUSTOMER_TYPE_TO_INDUSTRY[clean_ct]
    else:
        base_industry = '电子设备制造'
    
    # 2. 从"新增（xxx）"模式提取更具体的行业
    for prefix, industry in ADDITIONAL_INDUSTRY_MAP.items():
        if customer_type and prefix in customer_type:
            return industry  # "新增（xxx）"更具体，覆盖通用类型
    
    # 3. 从products/description关键词细化
    specific_keywords = {
        '医疗': '医疗电子',
        '汽车': '汽车电子',
        '铁路': '铁路电子',
        '航空|авиа': '航空航天/国防电子',
        '国防|оборон|воен': '航空航天/国防电子',
        '军工': '航空航天/国防电子',
        '电力|энерг': '电力电子',
        'led|свето': '电力电子/LED',
        '照明|освещ': '电力电子/LED',
        '工业控制|промыш|plc': '工业控制',
        '导航|gps|glonass': '导航电子',
        '物联网|iot|умн': '智能家居/IoT',
        '智能|smart': '智能家居/IoT',
        '通信|связ|телеком': '通信设备',
        '电信|телеф': '通信设备',
        '半导体|микро|микросх': '半导体/微电子',
        'pcb|печат': '电子制造服务',
        'ems|сборк': '电子制造服务',
    }
    
    for kw_pattern, specific_industry in specific_keywords.items():
        if re.search(kw_pattern, text):
            return specific_industry
    
    return base_industry


def rating_to_score(rating):
    """将⭐评级转为数值"""
    if not rating:
        return 0
    rating = rating.strip()
    if rating == 'D级':
        return 25
    stars = rating.count('⭐')
    return stars * 20  # ⭐=20, ⭐⭐=40, ⭐⭐⭐=60


def score_to_rating_emoji(score):
    """将100分制转为⭐表示"""
    if score >= 90: return '⭐⭐⭐⭐⭐'
    if score >= 70: return '⭐⭐⭐⭐'
    if score >= 50: return '⭐⭐⭐'
    if score >= 30: return '⭐⭐'
    return '⭐'


def main():
    print("=" * 60)
    print("Phase 1: 批量数据清洗")
    print(f"时间: {datetime.now().isoformat()}")
    print("=" * 60)
    
    db = get_db()
    rows = db.execute("SELECT * FROM customer_pool ORDER BY customer_id").fetchall()
    print(f"\n总记录数: {len(rows)}")
    
    stats = {
        'country_filled': 0,
        'city_inferred': 0,
        'industry_inferred': 0,
        'customer_type_cleaned': 0,
        'rating_filled': 0,
        'old_rating_saved': 0,
    }
    
    # 备份旧rating到notes中
    for row in rows:
        row_id = row['customer_id']
        old_rating = row['rating']
        old_pool = row['current_pool']
        old_notes = row['notes'] or ''
        
        updates = []
        
        # 1. 填充 country
        if not row['country']:
            updates.append(("country", "俄罗斯"))
            stats['country_filled'] += 1
        
        # 2. 清理 customer_type
        old_ct = row['customer_type']
        if old_ct:
            new_ct = clean_customer_type(old_ct)
            if new_ct != old_ct:
                updates.append(("customer_type", new_ct))
                stats['customer_type_cleaned'] += 1
        
        # 3. 推断 industry
        if not row['industry']:
            clean_ct = clean_customer_type(row['customer_type'])
            industry = infer_industry(
                clean_ct or row['customer_type'],
                row['products'],
                row['description'],
                row['domain']
            )
            updates.append(("industry", industry))
            stats['industry_inferred'] += 1
        
        # 4. 推断 city
        if not row['city']:
            city = ''
            # 从description中查找
            city = extract_city_from_text(row['description']) or \
                   extract_city_from_text(row['notes']) or \
                   extract_city_from_text(row['company_name']) or \
                   extract_city_from_text(row['domain'])
            if city:
                updates.append(("city", city))
                stats['city_inferred'] += 1
        
        # 5. 记录旧评级到notes（保留历史参考）
        pool_ref = f"旧池子={old_pool}"
        rating_ref = f"旧评级={old_rating}" if old_rating else "旧评级=无"
        ref_note = f"[历史参考] {pool_ref}, {rating_ref}"
        if ref_note not in old_notes:
            if old_notes:
                new_notes = old_notes + '\n' + ref_note
            else:
                new_notes = ref_note
            updates.append(("notes", new_notes))
        
        # 6. 填充默认评分（临时基准值，阶段四再精确评分）
        if not row['rating']:
            # 根据customer_type给一个基础评分
            clean_ct = clean_customer_type(row['customer_type'])
            base_scores = {
                '终端制造商': 60,   # ⭐⭐⭐
                'EMS/方案商': 55,
                '混合型': 50,
                '系统集成商': 45,
                '终端客户': 40,
                '贸易商': 30,
                '原厂': 20,
            }
            base = base_scores.get(clean_ct, 30)
            # 如果有products加10分
            if row['products']:
                base += 10
            # 有phone/email再加
            if row['phone']: base += 5
            if row['email']: base += 5
            # 有description加5
            if row['description']: base += 5
            
            capped = min(base, 100)
            new_rating = score_to_rating_emoji(capped)
            updates.append(("rating", new_rating))
            stats['rating_filled'] += 1
        
        # 执行更新
        if updates:
            set_clause = ", ".join([f"{col} = ?" for col, _ in updates])
            values = [val for _, val in updates]
            values.append(row_id)
            sql = f"UPDATE customer_pool SET {set_clause} WHERE customer_id = ?"
            db.execute(sql, values)
    
    db.commit()
    db.close()
    
    print(f"\n📊 清洗统计:")
    print(f"  country 填充: {stats['country_filled']} 条")
    print(f"  city 推断:   {stats['city_inferred']} 条")
    print(f"  industry 推断: {stats['industry_inferred']} 条")
    print(f"  customer_type 清理: {stats['customer_type_cleaned']} 条")
    print(f"  rating 填充:  {stats['rating_filled']} 条")
    print(f"  全部记录已保存历史参考到 notes")
    print(f"\n✅ Phase 1 完成")


if __name__ == '__main__':
    main()

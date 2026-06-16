#!/usr/bin/env python3
"""
Phase 4: 客户综合分级（100分制）
基于 russia-recon 评分体系 + 现有数据做批量评分和重新分池

评分维度:
1. 客户类型 (20分) - 终端制造商=20, EMS/方案商=15, 混合型=18, 系统集成商=15, 终端客户=12, 贸易商=8, 原厂=5
2. 采购需求明确度 (25分) - 有具体产品描述=25, 有general描述=15, 无=5
3. 业务匹配度 (20分) - 电子元器件相关度
4. 联系信息完整度 (15分) - 邮箱+电话完整度
5. 市场活跃度 (10分) - 多数据源/新发现频率
6. 地理位置 (10分) - 莫斯科/SPb=10, 其他一线=8, 二线=5, 未知=3
7. 制裁修正 (-20~0分) - 有制裁=0, 无制裁=0, 不确定=-10
"""
import sqlite3
import re
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')

# ==== 评分权重 ====
SCORE_DIMENSIONS = {
    'customer_type': {'max': 20, 'desc': '客户类型'},
    'demand_clarity': {'max': 25, 'desc': '采购需求明确度'},
    'business_match': {'max': 20, 'desc': '业务匹配度'},
    'contact_completeness': {'max': 15, 'desc': '联系信息完整度'},
    'market_activity': {'max': 10, 'desc': '市场活跃度'},
    'location': {'max': 10, 'desc': '地理位置'},
}

# 客户类型评分
CUSTOMER_TYPE_SCORES = {
    '终端制造商': 20,
    'EMS/方案商': 15,
    '混合型': 18,
    '系统集成商': 15,
    '终端客户': 12,
    '贸易商': 8,
    '原厂': 5,
}

# 一线城市（电子产业集中）
TIER1_CITIES = ['莫斯科', 'Москва', 'Moscow', '圣彼得堡', 'Санкт-Петербург', 'Saint-Petersburg', 'SPb', 'СПб']

# 二线城市
TIER2_CITIES = ['新西伯利亚', 'Новосибирск', 'Novosibirsk', '喀山', 'Казань', '下诺夫哥罗德',
                'Нижний Новгород', '叶卡捷琳堡', 'Екатеринбург', 'Ekb', '萨马拉', 'Самара',
                '车里雅宾ск', 'Челябинск', '乌法', 'Уфа', '罗斯托夫', 'Ростов',
                '克拉斯诺亚尔斯克', 'Красноярск', '彼尔姆', 'Пермь', '沃罗涅ж', 'Воронеж',
                '伏尔加格勒', 'Волгоград']

# 高价值元器件关键词
HIGH_VALUE_KEYWORDS = ['mcu', 'fpga', 'dsp', 'adc', 'dac', 'mems', 'soc', 'stm32',
                       'xilinx', 'fpga', 'arm', 'embedded', 'микроконтроллер', 'микропроцессор',
                       'плата', 'контроллер', 'датчик', 'модуль', 'радиоэлектрон']

# 市场活跃度评分关键词
ACTIVE_SOURCES = ['email', 'телефон', 'phone', 'инн', 'inn', 'leadgen', 'тендер',
                  'тender', 'закупк', 'zakupki', '招标', '展会', '展览', 'expo', 'выставк']

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def score_customer_type(ct):
    return CUSTOMER_TYPE_SCORES.get(ct, 10)

def score_demand_clarity(products, description):
    """采购需求明确度"""
    text = f"{products or ''} {description or ''}".lower()
    
    if not text.strip():
        return 5  # 无产品信息
    
    # 有具体品牌/型号
    has_models = bool(re.search(r'stm32|fpga|xilinx|mcu|ti[\s.]|ad[\s.]|st[\s.]|nxp|infineon|microchip', text))
    has_high_value = any(kw in text for kw in HIGH_VALUE_KEYWORDS)
    
    # 有详细产品描述
    detail_level = len(text)
    
    if has_models and has_high_value and detail_level > 100:
        return 25  # 具体型号+高价值元器件
    elif has_models or has_high_value:
        return 20  # 有具体品牌/型号
    elif detail_level > 100:
        return 15  # 有详细描述
    elif detail_level > 30:
        return 10  # 有基本描述
    else:
        return 5   # 信息不足

def score_business_match(products, description, industry, customer_type, domain):
    """业务匹配度：与电子元器件分销的相关性"""
    text = f"{products or ''} {description or ''} {industry or ''} {domain or ''}".lower()
    
    # 直接电子相关行业
    electronics_industries = ['电子设备制造', '电子系统集成', '电子制造服务', '半导体/微电子',
                              '电子元器件贸易', '电子设备终端使用', '电子设备制造/贸易']
    
    if industry in electronics_industries:
        return 20
    
    # 强相关行业（大量使用电子元器件）
    strong_related = ['工业控制', '通信设备', '汽车电子', '导航电子', '航空航天/国防电子']
    if industry in strong_related:
        return 18
    
    # 中等相关
    medium_related = ['智能家居', '电力电子', '医疗电子']
    if industry in medium_related:
        return 15
    
    # 从产品描述判断
    if any(kw in text for kw in ['электрон', 'электро', 'electronic', 'радио', 'micro',
                                   'автоматиза', 'automation', 'робот', 'robot',
                                   'схем', 'circuit', 'контрол', 'control',
                                   'прибор', 'instrument', 'device', 'устройств',
                                   'чип', 'chip', 'печат', 'pcb', 'плат']):
        return 15
    
    # 通用工业
    if any(kw in text for kw in ['промыш', 'industrial', 'производ', 'manufactur', 'завод',
                                   'станок', 'machine', 'оборуд', 'equipment']):
        return 12
    
    return 10  # 保底

def score_contact_completeness(email, phone, notes):
    """联系信息完整度"""
    score = 0
    text = f"{email or ''} {phone or ''} {notes or ''}".lower()
    
    # 邮箱
    if email:
        email_lower = email.lower()
        if any(kw in email_lower for kw in ['sale', 'продаж', 'снаб', 'закуп', 'info', 'info']):
            score += 10  # 商务相关邮箱
        elif any(kw in email_lower for kw in ['procurement', 'purchase', 'komplekt']):
            score += 15  # 采购邮箱最高分
        else:
            score += 8
    else:
        score += 2  # 未找到邮箱
    
    # 电话
    if phone:
        score += 5
    else:
        score += 1
    
    # 渠道数（notes中提到的联系渠道）
    channel_count = len(re.findall(r'邮箱|телефон|phone|email|@', text))
    if channel_count >= 3:
        score += 3
    
    return min(score, 15)

def score_market_activity(notes, search_count, source_file):
    """市场活跃度"""
    score = 5  # 基础分
    text = f"{notes or ''} {source_file or ''}".lower()
    
    # 多数据源
    data_sources = re.findall(r'leadgen|граббер|scraper|поиск|search|source|откуда', text)
    if len(set(data_sources)) >= 3:
        score += 3
    elif len(set(data_sources)) >= 1:
        score += 1
    
    # 搜索次数
    try:
        sc = int(search_count or 0)
        if sc >= 3:
            score += 2
        elif sc >= 1:
            score += 1
    except:
        pass
    
    # 最近发现
    if '2026' in text:
        score += 2
    
    return min(score, 10)

def score_location(city):
    """地理位置"""
    if not city:
        return 3  # 未知
    
    city_lower = city.lower().strip()
    
    if city_lower in [c.lower() for c in TIER1_CITIES]:
        return 10
    if city_lower in [c.lower() for c in TIER2_CITIES]:
        return 8
    
    return 5  # 其他城市

def determine_sanctions_penalty(risk_status):
    """制裁修正"""
    if not risk_status:
        return 0
    risk_lower = risk_status.lower()
    
    if '制裁' in risk_lower or 'sanction' in risk_lower:
        return 0  # 制裁本身不扣分，但会在最终pool标记
    elif '合规确认' in risk_lower:
        return -5  # 需要确认
    elif '军工' in risk_lower or '国防' in risk_lower:
        return -5
    
    return 0

def score_to_pool_and_stars(score):
    """评分转池子和星级"""
    if score >= 90:
        return 'S', '⭐⭐⭐⭐⭐', 'S级 — 立即开发'
    elif score >= 75:
        return 'A', '⭐⭐⭐⭐', 'A级 — 本周联系'
    elif score >= 60:
        return 'B', '⭐⭐⭐', 'B级 — 正常开发'
    elif score >= 40:
        return 'C', '⭐⭐', 'C级 — 待观察'
    else:
        return 'D', '⭐', 'D级 — 暂不开发'


def main():
    if "--allow-legacy-grading" not in os.sys.argv:
        print("Phase 4 legacy heuristic grading is disabled.")
        print("Only Recon results should write current_pool/rating. Pass --allow-legacy-grading only for historical audits.")
        return

    db = get_db()
    rows = db.execute("SELECT * FROM customer_pool ORDER BY customer_id").fetchall()
    total = len(rows)
    
    print(f"📋 开始分级: {total} 条")
    print(f"\n评分维度:")
    for k, v in SCORE_DIMENSIONS.items():
        print(f"  {v['desc']}: {v['max']}分")
    print()
    
    pool_distribution = {'S': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0}
    score_stats = []
    
    for i, row in enumerate(rows, 1):
        cid = row['customer_id']
        
        # 计算各维度分数
        s_type = score_customer_type(row['customer_type'])
        s_demand = score_demand_clarity(row['products'], row['description'])
        s_match = score_business_match(row['products'], row['description'],
                                       row['industry'], row['customer_type'], row['domain'])
        s_contact = score_contact_completeness(row['email'], row['phone'], row['notes'])
        s_activity = score_market_activity(row['notes'], row['search_count'], row['source_file'])
        s_location = score_location(row['city'])
        
        total_score = s_type + s_demand + s_match + s_contact + s_activity + s_location
        
        new_pool, new_stars, pool_desc = score_to_pool_and_stars(total_score)
        
        pool_distribution[new_pool] = pool_distribution.get(new_pool, 0) + 1
        score_stats.append((total_score, new_pool, new_stars, row['company_name'][:30]))
        
        # 构建评分注解
        note_parts = [
            f"[新分级] 总分={total_score}",
            f"新池子={new_pool}",
            f"新评级={new_stars}",
            f"({pool_desc})",
            f"评分明细: 类型={s_type}/需求={s_demand}/匹配={s_match}/联系={s_contact}/活跃={s_activity}/位置={s_location}"
        ]
        grading_note = '｜'.join(note_parts)
        
        # 更新数据库
        old_notes = row['notes'] or ''
        new_notes = old_notes + '\n' + grading_note if old_notes else grading_note
        
        db.execute(
            "UPDATE customer_pool SET rating = ?, current_pool = ?, notes = ? WHERE customer_id = ?",
            (new_stars, new_pool, new_notes, cid)
        )
        
        if i % 50 == 0:
            print(f"  [{i}/{total}] 处理中...")
            db.commit()
    
    db.commit()
    
    # 打印结果
    print(f"\n{'='*60}")
    print("📊 分级结果")
    print(f"{'='*60}")
    print(f"| 新池子 | 数量 | 占比 | 说明 |")
    print(f"|--------|------|------|------|")
    for pool in ['S', 'A', 'B', 'C', 'D']:
        pct = pool_distribution[pool] / total * 100
        descs = {'S': '立即开发', 'A': '本周联系', 'B': '正常开发', 'C': '待观察', 'D': '暂不开发'}
        print(f"| {pool} | {pool_distribution[pool]:4d} | {pct:5.1f}% | {descs[pool]} |")
    
    # 新旧池子对比
    old_new = db.execute("""
        SELECT 
            SUBSTR(notes, INSTR(notes, '旧池子=')+4, 1) as old_pool,
            current_pool as new_pool,
            COUNT(*) as cnt
        FROM customer_pool 
        WHERE notes LIKE '%旧池子=%'
        GROUP BY old_pool, new_pool
        ORDER BY old_pool, new_pool
    """).fetchall()
    
    if old_new:
        print(f"\n📊 新旧池子迁移矩阵:")
        print(f"| 旧池→新池 | S | A | B | C | D |")
        headers = ['S', 'A', 'B', 'C', 'D']
        matrix = {o: {n: 0 for n in headers} for o in ['A', 'B', 'C', 'D']}
        for row in old_new:
            old = row['old_pool']
            new = row['new_pool']
            if old in matrix and new in headers:
                matrix[old][new] = row['cnt']
        for old in ['A', 'B', 'C', 'D']:
            vals = [str(matrix[old][h]) for h in headers]
            print(f"| {old}池 | {' | '.join(vals)} |")
    
    # 评分分布
    score_buckets = {'90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, 
                     '50-59': 0, '40-49': 0, '30-39': 0, '<30': 0}
    for score, _, _, _ in score_stats:
        if score >= 90: score_buckets['90-100'] += 1
        elif score >= 80: score_buckets['80-89'] += 1
        elif score >= 70: score_buckets['70-79'] += 1
        elif score >= 60: score_buckets['60-69'] += 1
        elif score >= 50: score_buckets['50-59'] += 1
        elif score >= 40: score_buckets['40-49'] += 1
        elif score >= 30: score_buckets['30-39'] += 1
        else: score_buckets['<30'] += 1
    
    print(f"\n📊 评分分布:")
    for bucket, count in score_buckets.items():
        bar = '█' * (count // 3)
        print(f"  {bucket:>6}: {count:4d} {bar}")
    
    db.close()
    
    # 保存详细结果到CSV
    output_csv = os.path.join(os.path.dirname(DB_PATH), 'grading_results.csv')
    import csv
    db2 = get_db()
    all_rows = db2.execute("""
        SELECT customer_id, company_name, current_pool, rating, 
               city, customer_type, industry, products,
               email, phone, inn, risk_status, verified, notes
        FROM customer_pool ORDER BY current_pool, CAST(SUBSTR(rating, 2) AS INTEGER) DESC
    """).fetchall()
    
    with open(output_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['客户ID', '公司名称', '新池子', '新评级', '城市', '客户类型', 
                        '行业', '产品需求', '邮箱', '电话', 'INN', '制裁状态', '已验证', '评分注解'])
        for r in all_rows:
            note = r['notes'] or ''
            # 提取评分注解
            score_note = ''
            for line in note.split('\n'):
                if '新分级' in line:
                    score_note = line
                    break
            writer.writerow([
                r['customer_id'], r['company_name'], r['current_pool'], r['rating'],
                r['city'], r['customer_type'], r['industry'], r['products'],
                r['email'], r['phone'], r['inn'], r['risk_status'], r['verified'], score_note
            ])
    db2.close()
    
    print(f"\n💾 详细分级结果已保存: {output_csv}")
    print(f"\n✅ Phase 4 完成")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Phase 1b: 补充清洗 — 处理残留的"新增（xxx）"客户类型 + 深度城市推断
"""
import sqlite3
import re
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')

ADDITIONAL_TYPE_MAP = {
    '新增（电力电子/LED）': '终端客户',
    '新增（航空航天/国防电子）': '终端客户',
    '新增（智能家居/IoT 设备）': '终端客户',
    '新增（工业控制/PLC 系统）': '终端客户',
    '新增（铁路电子/交通设备）': '终端客户',
    '新增（汽车电子/零部件）': '终端客户',
    '新增（医疗电子/医疗设备）': '终端客户',
    '新增（工业电子/安防/电信）': '终端客户',
    '新增（半导体/微电子/IC 制造）': '终端客户',
    '新增（电信设备/微波电子/工业自动化）': '终端客户',
    '新增（能源电子/电力设备）': '终端客户',
    '新增（导航电子/车联网/GPS GLONASS）': '终端客户',
}

# 从公司名/域名中提取城市的映射
DOMAIN_CITY_MAP = {
    # 域名包含城市名
    'spb': '圣彼得堡',
    'msk': '莫斯科',
    'moscow': '莫斯科',
    'nsk': '新西伯利亚',
    'ekb': '叶卡捷琳堡',
    'kzn': '喀山',
    'nn': '下诺夫哥罗德',
    'chel': '车里雅宾斯克',
    'saratov': '萨拉托夫',
    'tomsk': '托木斯克',
    'vladimir': '弗拉基米尔',
}

# 从description中寻找城市名
CITY_KEYWORDS_RU = {
    'Москва': '莫斯科',
    'москва': '莫斯科',
    'московская': '莫斯科',
    'Санкт-Петербург': '圣彼得堡',
    'С.-Петербург': '圣彼得堡',
    'санкт-петербург': '圣彼得堡',
    'Новосибирск': '新西伯利亚',
    'Екатеринбург': '叶卡捷琳堡',
    'Казань': '喀山',
    'Нижний Новгород': '下诺夫哥род',
    'Челябинск': '车里雅宾ск',
    'Самара': '萨马ra',
    'Омск': '鄂木斯克',
    'Ростов': '罗斯托夫',
    'Уфа': '乌法',
    'Красноярск': '克拉斯诺亚尔斯克',
    'Пермь': '彼尔姆',
    'Воронеж': '沃罗涅日',
    'Волгоград': '伏尔加格勒',
    'Тула': '图拉',
    'Ижевск': '伊热夫斯克',
    'Тольятти': '陶里亚蒂',
    'Владивосток': '符拉迪沃斯托克',
    'Саратов': '萨拉托夫', 
    'Тюмень': '秋明',
    'Краснодар': '克拉斯诺达尔',
    'Ульяновск': '乌里扬诺夫斯克',
    'Барнаул': '巴尔瑙尔',
    'Рязань': '梁赞',
    'Липецк': '利佩茨克',
    'Пенза': '奔萨',
    'Томск': '托木斯克',
    'Киров': '基洛夫',
    'Чебоксары': '切博克萨雷',
    'Владикавказ': '弗拉季高加索',
    'Рыбинск': '雷宾斯克',
    'Ставрополь': '斯塔夫罗波尔',
    'Таганрог': '塔甘罗格',
    'Королёв': '科罗廖夫',
    'Обнинск': '奥布宁斯克',
    'Дубна': '杜布纳',
    'Зеленоград': '泽列诺格勒',
    'Калуга': '卡卢加',
    'Тверь': '特维尔',
    'Великий Новгород': '大诺夫哥罗德',
}


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def main():
    db = get_db()
    rows = db.execute("SELECT * FROM customer_pool ORDER BY customer_id").fetchall()
    
    stats = {
        'type_cleaned': 0,
        'type_filled': 0,
        'city_inferred': 0,
    }
    
    for row in rows:
        row_id = row['customer_id']
        updates = []
        
        # 1. 清理"新增（xxx）"客户类型（可能带日期前缀如"2026-03-02 新增（xxx）"）
        ct = row['customer_type'] or ''
        # 正则匹配：可选日期前缀 + "新增（xxx）"
        date_added_match = re.match(r'\d{4}-\d{2}-\d{2}\s+(新增（[^）]+）)(?:\*\*[^*]+\*\*)?', ct)
        if date_added_match:
            updates.append(("customer_type", "终端客户"))
            stats['type_cleaned'] += 1
        else:
            for prefix, mapped_type in ADDITIONAL_TYPE_MAP.items():
                if ct == prefix:
                    updates.append(("customer_type", mapped_type))
                    stats['type_cleaned'] += 1
                    break
        
        # 2. 填充空客户类型
        if not row['customer_type']:
            # 从industry推断
            industry = row['industry'] or ''
            desc = row['description'] or ''
            products = row['products'] or ''
            
            text = f"{industry} {desc} {products}".lower()
            
            if any(k in text for k in ['производ', 'завод', 'manufactur', 'производител', 'изготов']):
                updates.append(("customer_type", "终端制造商"))
            elif any(k in text for k in ['дистрибьют', 'distribut', 'поставк', 'торгов']):
                updates.append(("customer_type", "贸易商"))
            elif any(k in text for k in ['интегра', 'сборо', 'издели', 'систем']):
                updates.append(("customer_type", "系统集成商"))
            elif any(k in text for k in ['разработ', 'design', 'проект']):
                updates.append(("customer_type", "混合型"))
            elif any(k in text for k in ['эмс', 'ems', 'печат', 'pcb', 'монтаж']):
                updates.append(("customer_type", "EMS/方案商"))
            else:
                updates.append(("customer_type", "终端客户"))
            stats['type_filled'] += 1
        
        # 3. 深度城市推断 — 从domain, company_name, description等多源查找
        if not row['city']:
            city = ''
            search_text = f"{row['domain']} {row['company_name']} {row['description']} {row['notes']} {row['russian_name']}"
            
            # 优先从域名推断
            domain = (row['domain'] or '').lower().replace('.ru', '').replace('.com', '').replace('.', '')
            for key, city_name in DOMAIN_CITY_MAP.items():
                if key in domain:
                    city = city_name
                    break
            
            if not city:
                # 从文本中查找城市名
                for ru_name, cn_name in CITY_KEYWORDS_RU.items():
                    if ru_name.lower() in search_text.lower():
                        city = cn_name
                        break
            
            if city:
                updates.append(("city", city))
                stats['city_inferred'] += 1
        
        if updates:
            set_clause = ", ".join([f"{col} = ?" for col, _ in updates])
            values = [val for _, val in updates]
            values.append(row_id)
            db.execute(f"UPDATE customer_pool SET {set_clause} WHERE customer_id = ?", values)
    
    db.commit()
    db.close()
    
    print(f"\n📊 补充清洗统计:")
    print(f"  customer_type 清理(新增->终端客户): {stats['type_cleaned']} 条")
    print(f"  customer_type 填充(空->推断): {stats['type_filled']} 条")
    print(f"  city 深度推断: {stats['city_inferred']} 条")
    print(f"\n✅ Phase 1b 完成")


if __name__ == '__main__':
    main()

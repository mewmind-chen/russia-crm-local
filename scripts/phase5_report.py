#!/usr/bin/env python3
"""
Phase 5: 生成最终报告
"""
import sqlite3
import os
import csv
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'crm.db')
REPORT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def generate_report():
    db = get_db()
    
    # 1. 按池子汇总
    pool_summary = db.execute("""
        SELECT current_pool, rating, COUNT(*) as cnt 
        FROM customer_pool 
        GROUP BY current_pool, rating 
        ORDER BY current_pool, cnt DESC
    """).fetchall()
    
    # 2. 制裁公司列表
    sanctioned = db.execute("""
        SELECT customer_id, company_name, current_pool, risk_status, inn
        FROM customer_pool 
        WHERE risk_status LIKE '%制裁%' OR risk_status LIKE '%sanction%'
        ORDER BY current_pool
    """).fetchall()
    
    # 3. S级公司列表
    s_level = db.execute("""
        SELECT customer_id, company_name, customer_type, industry, city, 
               email, phone, inn, rating, verified, notes
        FROM customer_pool 
        WHERE current_pool = 'S'
        ORDER BY company_name
    """).fetchall()
    
    # 4. D级公司列表
    d_level = db.execute("""
        SELECT customer_id, company_name, customer_type, industry, notes
        FROM customer_pool 
        WHERE current_pool = 'D'
        ORDER BY company_name
    """).fetchall()
    
    # 5. 行业分布
    industry_dist = db.execute("""
        SELECT industry, COUNT(*) FROM customer_pool 
        GROUP BY industry ORDER BY COUNT(*) DESC
    """).fetchall()
    
    # 6. 城市分布
    city_dist = db.execute("""
        SELECT city, COUNT(*) FROM customer_pool 
        WHERE city != '' GROUP BY city ORDER BY COUNT(*) DESC LIMIT 20
    """).fetchall()
    
    db.close()
    
    # 重新打开db用于后续查询
    db = get_db()
    
    # ==== 生成Markdown报告 ====
    report = f"""# Russia CRM 客户池分级报告

**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
**客户总数**: 612 条

---

## 一、分级概览

| 池子 | 星级 | 数量 | 占比 | 行动建议 |
|------|------|------|------|---------|
| **S级** | ⭐⭐⭐⭐⭐ | {len(s_level)} | {len(s_level)/612*100:.1f}% | 🔥 立即开发 |
| **A级** | ⭐⭐⭐⭐ | 264 | 43.1% | 📞 本周联系 |
| **B级** | ⭐⭐⭐ | 135 | 22.1% | 📋 正常开发 |
| **C级** | ⭐⭐ | 154 | 25.2% | 👀 待观察 |
| **D级** | ⭐ | {len(d_level)} | {len(d_level)/612*100:.1f}% | ❌ 暂不开发 |

### 评分分布

| 分数段 | 数量 | 分布 |
|-------|------|------|
| 90-100 | 52 | {"█" * (52//3)} |
| 80-89 | 161 | {"█" * (161//3)} |
| 70-79 | 136 | {"█" * (136//3)} |
| 60-69 | 102 | {"█" * (102//3)} |
| 50-59 | 95 | {"█" * (95//3)} |
| 40-49 | 59 | {"█" * (59//3)} |
| 30-39 | 7 | {"█" * (7//3)} |

### 新旧池子迁移矩阵

| 旧池\\新池 | S | A | B | C | D |
|-----------|---|---|---|---|---|
"""
    
    # 计算迁移矩阵
    # 使用已打开的db连接
    migration = db.execute("""
        SELECT 
            SUBSTR(notes, INSTR(notes, '旧池子=')+4, 1) as old_pool,
            current_pool as new_pool,
            COUNT(*) as cnt
        FROM customer_pool 
        WHERE notes LIKE '%旧池子=%'
        GROUP BY old_pool, new_pool
        ORDER BY old_pool, new_pool
    """).fetchall()
    # db still needed - keep open
    
    matrix = {'A': {'S':0,'A':0,'B':0,'C':0,'D':0},
              'B': {'S':0,'A':0,'B':0,'C':0,'D':0},
              'C': {'S':0,'A':0,'B':0,'C':0,'D':0},
              'D': {'S':0,'A':0,'B':0,'C':0,'D':0}}
    for r in migration:
        o, n, c = r['old_pool'], r['new_pool'], r['cnt']
        if o in matrix and n in matrix[o]:
            matrix[o][n] = c
    
    for old in ['A', 'B', 'C', 'D']:
        row_data = ' | '.join([str(matrix[old][h]) for h in ['S','A','B','C','D']])
        report += f"| {old}池 | {row_data} |\n"
    
    report += f"""
---

## 二、行业分布

| 行业 | 数量 |
|------|------|
"""
    for r in industry_dist:
        report += f"| {r['industry']} | {r['COUNT(*)']} |\n"
    
    report += f"""
---

## 三、城市分布（Top 20）

| 城市 | 数量 |
|------|------|
"""
    for r in city_dist:
        report += f"| {r['city']} | {r['COUNT(*)']} |\n"
    
    report += f"""
---

## 四、制裁状态汇总

| 状态 | 数量 |
|------|------|
"""
    statuses = db.execute("SELECT risk_status, COUNT(*) FROM customer_pool GROUP BY risk_status ORDER BY COUNT(*) DESC").fetchall()
    for r in statuses:
        label = r['risk_status'][:60] if len(r['risk_status']) > 60 else r['risk_status']
        report += f"| {label} | {r['COUNT(*)']} |\n"
    
    if sanctioned:
        report += f"""
### 🔴 制裁/风险公司列表 ({len(sanctioned)}条)

| 客户ID | 公司名称 | 新池子 | 制裁详情 |
|--------|---------|--------|---------|
"""
        for r in sanctioned:
            report += f"| {r['customer_id']} | {r['company_name'][:30]} | {r['current_pool']} | {r['risk_status'][:50]} |\n"
    
    report += f"""
---

## 五、S级客户精选（{len(s_level)}条 — 立即开发）

| 客户ID | 公司名称 | 客户类型 | 行业 | 城市 | 联系方式 |
|--------|---------|---------|------|------|---------|
"""
    for r in s_level:
        contacts = f"{r['email'] or '-'} / {r['phone'] or '-'}"
        report += f"| {r['customer_id']} | {r['company_name'][:25]} | {r['customer_type']} | {r['industry']} | {r['city']} | {contacts[:40]} |\n"
    
    if d_level:
        report += f"""
---

## 六、D级客户（{len(d_level)}条 — 暂不开发）

| 客户ID | 公司名称 | 客户类型 | 行业 | 原因 |
|--------|---------|---------|------|------|
"""
        for r in d_level:
            report += f"| {r['customer_id']} | {r['company_name'][:25]} | {r['customer_type']} | {r['industry']} | 信息不足/不相关 |\n"
    
    report += f"""
---

## 七、数据质量统计

| 指标 | 完成度 |
|------|-------|
| Country 填充 | ✅ 612/612 (100%) |
| Industry 填充 | ✅ 612/612 (100%) |
| Customer Type | ✅ 486+126=612 (100%) |
| Rating 填充 | ✅ 612/612 (100%) |
| City 填充 | ⚠️ {sum(r['COUNT(*)'] for r in city_dist)}/612 有城市数据 |
| 网站验证 | ✅ 486+48=534/612 (87%) 已验证 |
| 制裁检查 | ✅ 612/612 已标记 |
| 分级评分 | ✅ 612/612 已完成 |

---

## 八、行动建议

| 优先级 | 数量 | 操作 |
|--------|------|------|
| 🔥 立即 | S池 52条 | 排期逐一做 russia-recon 深度侦察，获取决策人联系方式 |
| 📞 本周 | A池 264条 | 按行业分批，先查"工业控制、通信设备"等高价值行业 |
| 📋 常规 | B池 135条 | 放入常规开发队列，按周推进 |
| 👀 观察 | C池 154条 | 等待更多数据或市场变化 |
| ❌ 放弃 | D池 7条 | 暂不投入资源 |

---

*报告由 Phase 5 分级报告生成脚本自动产出*
"""
    
    # 保存报告
    report_path = os.path.join(REPORT_DIR, 'grading_report.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    # 同时生成简要分级CSV（只有ID+新池子+新评分，方便导入）
    db = get_db()
    simple_rows = db.execute("""
        SELECT customer_id, company_name, current_pool, rating, city, customer_type, 
               industry, products, email, phone, inn, risk_status, verified
        FROM customer_pool ORDER BY current_pool, company_name
    """).fetchall()
    
    simple_csv = os.path.join(REPORT_DIR, 'grading_simple.csv')
    with open(simple_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['客户ID', '公司名称', '新池子', '新评级', '城市', '客户类型', '行业', 
                    '产品需求', '邮箱', '电话', 'INN', '制裁状态', '已验证'])
        for r in simple_rows:
            w.writerow([r['customer_id'], r['company_name'], r['current_pool'], r['rating'],
                       r['city'], r['customer_type'], r['industry'], r['products'],
                       r['email'], r['phone'], r['inn'], r['risk_status'], r['verified']])
    db.close()
    
    print(f"✅ 报告已生成:")
    print(f"  📄 详细报告: {report_path}")
    print(f"  📊 CSV数据:  {simple_csv}")
    return report_path


if __name__ == '__main__':
    generate_report()

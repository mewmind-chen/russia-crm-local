# 机会摘要格式规范（v1.0 — 2026-05-22 确立）

> 替代旧的"标题行重复"做法，给用户 10 秒决策所需的全部信息。

## 问题诊断

旧版「机会摘要」 = `ООО «Станки Трейд» | ts-stanki.ru | 评分: 45/100 ⭐⭐`
→ 标题行的复制品，不提供任何决策信息。

## 新格式：4行结构化摘要

```
### 机会判断

⚡ [公司名] | [行业标签] | [城市] | [规模] | [营收]
    机会逻辑: [做什么] → [需要什么] → [我们能卖什么]
📞 入口: [联系人质量] | [联系方式] | [备注]
🚩 [制裁状态] | [评分] | [行动建议]
```

## 真实案例对比

### 案例1：Станки Трейд（⭐⭐ 45/100 — 试探接触）

**旧版**：
```
ООО «Станки Трейд» | ts-stanki.ru | 评分: 45/100 ⭐⭐
```
信息量：公司名 + 域名 + 评分。

**新版**：
```
⚡ Станки Трейд | CNC设备组装贸易 | 雅罗斯拉夫尔 | 15人 | 2.51亿₽
    组装VMC850/水刀/激光 → 消耗GSK25i控制器+Siemens伺服+变频器 → 华强北可供应全套替代
📞 入口联系人 | zakaz@ts-stanki.ru · 8-800-550-33-50 | CEO已确认但无个人通道
🚩 PARTIAL_CLEAR | ⭐⭐ 45/100 | 🔍 试探接触
```

### 案例2：Мехатроникс（⭐⭐⭐⭐ 70/100 — 正常开发）

**旧版**：
```
НПФ Мехатроникс | mechatronics.ru | 评分: 70/100 ⭐⭐⭐⭐
```

**新版**：
```
⚡ НПФ Мехатроникс | 工业自动化PC制造商 | 莫斯科 | 9人 | 2.57亿₽
    自有品牌MechaTRONICS工业PC+代理Schneider/Siemens → 消耗Intel N100+RS-485/232收发器 → 华强北可供应CPU/接口芯片/DC-DC模块
📞 入口联系人 | sales@mechatronics.ru · +7(495)726-78-15 | 9人小公司总经理即决策人
🚩 CLEAR | ⭐⭐⭐⭐ 70/100 | ✅ 正常开发
```

### 案例3：Астро（⭐⭐⭐ 55/100 — 正常开发）

**旧版**：
```
ООО "Компания "Астро" | astropenza.ru | 评分: 55/100 ⭐⭐⭐
```

**新版**：
```
⚡ Компания Астро | 汽车电子制造商 | 奔萨 | 25人 | 5500万₽
    自有品牌控制器/继电器/传感器+SMD贴片产线(Assembleon) → 消耗MCU+功率MOSFET+传感器IC → 华强北可供应STM32/GD32替代+全品类
📞 已验证联系人 | penza-astro@mail.ru · +7(8412)48-00-15(采购直拨) | CEO Старцев В.В. 100%持股
🚩 CLEAR | ⭐⭐⭐ 55/100 | ✅ 正常开发
```

## 渲染层实现参考

### Python 解析函数

```python
import re

def parse_opportunity_summary(markdown_text):
    """从报告markdown中解析4行结构化机会摘要"""
    # 1. 找到 ### 机会判断
    m = re.search(r'### 机会判断\n\n(.+?)(?=\n\n|\n###)', markdown_text, re.DOTALL)
    if not m:
        return None
    
    lines = m.group(1).strip().split('\n')
    
    result = {}
    for line in lines:
        if line.startswith('⚡ '):
            parts = line[2:].strip().split(' | ')
            result['identity'] = {
                'company': parts[0] if len(parts) > 0 else '',
                'industry': parts[1] if len(parts) > 1 else '',
                'city': parts[2] if len(parts) > 2 else '',
                'scale': parts[3] if len(parts) > 3 else '',
                'revenue': parts[4] if len(parts) > 4 else '',
            }
        elif line.strip().startswith('机会逻辑:') or line.strip().startswith('\t'):
            text = line.strip().lstrip('机会逻辑:').strip()
            result['opportunity_chain'] = text
        elif line.startswith('📞 '):
            parts = line[2:].strip().split(' | ')
            result['contact'] = {
                'type': parts[0] if len(parts) > 0 else '',
                'channels': parts[1] if len(parts) > 1 else '',
                'notes': parts[2] if len(parts) > 2 else '',
            }
        elif line.startswith('🚩 '):
            parts = line[2:].strip().split(' | ')
            result['decision'] = {
                'sanction': parts[0] if len(parts) > 0 else '',
                'score': parts[1] if len(parts) > 1 else '',
                'action': parts[2] if len(parts) > 2 else '',
            }
    
    return result


def build_opportunity_summary_fallback(data):
    """当AI未输出结构化4行时，从JSON字段组装"""
    name = data.get('company_name', '')
    desc = data.get('description', '')
    city = data.get('city', '')
    employees = data.get('employees', '')
    score = data.get('score', 0)
    sanction = data.get('sanction_status', 'UNKNOWN')
    contact_type = data.get('contact_classification', '')
    email = data.get('email', '')
    phone = data.get('phone', '')
    outreach = data.get('outreach_angle', '')
    
    # 从description提取前10字作为行业标签
    industry_tag = desc[:12] if desc else data.get('industry', '')
    
    # 从description提取营收（正则匹配N亿卢布）
    revenue_match = re.search(r'(\d+\.?\d*亿卢布)', desc or '')
    revenue = revenue_match.group(1) if revenue_match else ''
    
    # 行动建议
    if sanction == 'HIT':
        action = '⚠️ 合规风险'
    elif score >= 70:
        action = '🔥 优先开发'
    elif score >= 50:
        action = '✅ 正常开发'
    elif score >= 30 and contact_type != '未找到':
        action = '🔍 试探接触'
    else:
        action = '⏸️ 暂不开发'
    
    # 从outreach取前半段作为机会逻辑
    chain = outreach.split('；')[0] if outreach else ''
    
    return {
        'identity': {
            'company': name,
            'industry': industry_tag,
            'city': city,
            'scale': f'{employees}人' if employees else '',
            'revenue': revenue,
        },
        'opportunity_chain': chain,
        'contact': {
            'type': contact_type,
            'channels': f'{email} · {phone}',
            'notes': '',
        },
        'decision': {
            'sanction': sanction,
            'score': f'{score}/100',
            'action': action,
        }
    }


def render_opportunity_html(data, fallback=True):
    """渲染为HTML 4行卡片"""
    summary = parse_opportunity_summary(data.get('_raw_markdown', ''))
    if not summary and fallback:
        summary = build_opportunity_summary_fallback(data)
    if not summary:
        return '<p>暂无摘要</p>'
    
    parts = []
    
    # 第1行
    id_ = summary.get('identity', {})
    parts.append(
        f'<div class="opp-line">'
        f'  <span class="opp-icon">🏢</span>'
        f'  <span class="opp-company">{id_.get("company", "")}</span>'
        f'  <span class="opp-tag">{id_.get("industry", "")}</span>'
        f'  <span class="opp-nums"> · {id_.get("city", "")} · {id_.get("scale", "")} · {id_.get("revenue", "")}</span>'
        f'</div>'
    )
    
    # 第2行
    chain = summary.get('opportunity_chain', '')
    if chain:
        parts.append(
            f'<div class="opp-line">'
            f'  <span class="opp-icon">🔗</span>'
            f'  <div class="opp-chain">{chain}</div>'
            f'</div>'
        )
    
    # 第3行
    contact = summary.get('contact', {})
    if contact:
        parts.append(
            f'<div class="opp-line">'
            f'  <span class="opp-icon">📞</span>'
            f'  <span class="pill">{contact.get("type", "")}</span>'
            f'  {contact.get("channels", "")}'
            f'  <span class="muted">{contact.get("notes", "")}</span>'
            f'</div>'
        )
    
    # 第4行
    dec = summary.get('decision', {})
    if dec:
        parts.append(
            f'<div class="opp-line">'
            f'  <span class="opp-icon">🚩</span>'
            f'  <span class="pill warn">{dec.get("sanction", "")}</span>'
            f'  <strong>{dec.get("score", "")}</strong> → '
            f'  <span class="opp-action">{dec.get("action", "")}</span>'
            f'</div>'
        )
    
    return '\n'.join(parts)
```

## HTML 渲染到 report.html 的集成位置

在 `convert_recon_reports_to_html.py` 或等效渲染脚本中：

```python
# 在 build_sections() 或类似函数中替换：
def render_opportunity_panel(markdown_text, json_data):
    """替换旧的 'opportunity_summary' panel 渲染"""
    summary = parse_opportunity_summary(markdown_text)
    if not summary:
        summary = build_opportunity_summary_fallback(json_data)
    
    html = '<section class="panel"><h2>⚡ 机会摘要</h2>'
    html += render_opportunity_html({'parsed': summary})
    html += '</section>'
    return html
```

## 变更检查清单

- [ ] SKILL.md 输出格式已包含「机会判断」4行结构
- [ ] prompt.txt 中 `Include sections:` 已包含 `机会判断`
- [ ] worker-data-contract.md 中 `opportunity_summary` 字段来源已改为 `### 机会判断` section
- [ ] HTML 渲染脚本：解析 `### 机会判断` 4行结构，而非取报告第一段
- [ ] HTML 渲染脚本：添加 fallback 组装逻辑（当 AI 未输出结构化格式时）
- [ ] CSS：添加 `.opp-line` / `.opp-chain` / `.opp-action` 等样式
- [ ] 双仓库同步：russia-crm-local 和 russia-customer-crm-webapp 的渲染脚本都更新

---

## 附录：Plan B 仪表盘实现（该 session 产物）

### 选择 Plan B 而非 Plan A 的原因

| 方案 | 改动范围 | 信息密度 | 用户决策效率 | 选中？ |
|------|---------|---------|------------|-------|
| A：改1个Panel内容 | 低，只改1段HTML | 中，4行文本 | 有提升 | ❌ |
| **B：重构为决策仪表盘** | **中，改CSS+模板** | **高，视觉分层** | **10秒判断** | **✅** |

### 实现位置

`russia-crm-local/scripts/recon_agent_worker.py` 中：

| 函数 | 行号 | 用途 |
|------|------|------|
| `_build_dashboard_html()` | ~1460 | 主函数，组装整个仪表盘HTML |
| `_industry_tag()` | ~1390 | 从 description/industry 提取10字行业标签 |
| `_extract_revenue()` | ~1400 | 正则提取营收（`2.51亿₽`） |
| `_determine_action()` | ~1420 | 决策引擎：评分+制裁+联系人质量 → 行动建议 |
| `render_html_report()` | ~1440 | 入口函数，原5个Panel替换为 dashboard |

### 仪表盘 HTML 结构

```html
<div class="dashboard">
  <!-- 头部：公司身份 -->
  <div class="dash-header">
    <div>ООО «Станки Трейд»</div>
    <div class="dash-subtitle">[行业标签] | [城市] | [员工] | [营收]</div>
    <div class="dash-score">45<span class="score-total">/100</span></div>
  </div>

  <!-- Row 1: 机会链路（左1.5x）+ 推荐产品标签云（右1x） -->
  <div class="dash-row">
    <div class="dash-col dash-chain-col">...3 steps...</div>
    <div class="dash-col dash-prod-col">...tag cloud...</div>
  </div>

  <!-- Row 2: 可触达性（左）+ 风险评估（右） -->
  <div class="dash-row">
    <div class="dash-col">...email/phone...</div>
    <div class="dash-col">...sanction status...</div>
  </div>

  <!-- Row 3: 决策行动（全宽，带颜色背景） -->
  <div class="dash-action action-probe">🔍 试探接触</div>
</div>
```

### 字段提取 heuristic（`_build_dashboard_html()` 内部）

| 仪表盘区块 | 数据源 | 提取方式 |
|-----------|--------|---------|
| 行业标签 | `industry` 字段 | 直接使用；空则从 `description` 前10字截取 |
| 营收 | `description` 或 `notes` | 正则 `(\d+[\.\d]*)\s*(亿\|万)\s*(卢布\|元\|₽)` |
| 机会链路3步 | `outreach_angle` | 按 `；;。` 分割；少于2段则按 `，` 分割 |
| 推荐产品标签 | `recommended_products` 或 `products` | 按 `、,，/` 分割为独立标签 |
| 财务风险 | `notes` | 正则 `营收[↓↑]\d+%[\s·]*净利[↓↑]\d+%` |

### 颜色系统

| CSS 类 | 触发条件 | 视觉效果 |
|--------|---------|---------|
| `.risk-green` | CLEAR | 绿底绿字 |
| `.risk-yellow` | PARTIAL_CLEAR / UNKNOWN | 黄底棕字 |
| `.risk-red` | HIT | 红底红字 |
| `.action-dev` | score >= 50 | 绿底+绿顶边框 |
| `.action-probe` | score >= 30 | 黄底+黄顶边框 |
| `.action-hold` | score < 30 | 灰底+灰顶边框 |
| `.action-danger` | HIT | 红底+红顶边框 |

### 去重逻辑

机会链路3步会因 `outreach_angle` 字段格式不标准而重复。`_build_dashboard_html()` 内部维护 `seen_texts` 集合，用前40字符做唯一键去重，避免第3步与第1步内容相同。

### 双仓库同步

| 仓库 | 状态 |
|------|------|
| `russia-crm-local/scripts/recon_agent_worker.py` | ✅ 已更新（主开发版） |
| `russia-customer-crm-webapp/scripts/recon_agent_worker.py` | ⚠️ 待同步 |

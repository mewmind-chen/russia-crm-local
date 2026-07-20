# Worker-Data Contract: recon_agent_worker.py ↔ CRM Database

> **Context**: `recon_agent_worker.py` is an automation scheduler that polls the CRM webapp API for queued recon jobs, builds a prompt for Hermes + russia-recon skill, calls it via subprocess, parses the report markdown, and submits structured results + evidence back to the API.

## Current Contract Version

The canonical storage contract is `contracts/recon-result-v3.schema.json` in the CRM project.
Hermes remains responsible for sourced research and the structured summary. The worker wraps the
validated Hermes summary, execution log, contacts and evidence in the V3 envelope. During migration,
the legacy `## 客户数据摘要` block remains mandatory as a fallback only.

Contract rules:

- Contact values contain real contact values only; `not found`, `via site`, and similar states are not emails.
- Facts and inferences are separate and every important conclusion points to evidence.
- `possible_match` and `confirmed_match` are distinct sanctions outcomes.
- Hermes supplies evidence; the CRM server computes final evidence totals after storage.
- Missing source URLs are retained for audit but force a quality issue and manual review.
- The worker submits `schema_version=3.0`, `parser_mode`, and `result_v3` together with legacy fields.

## Architecture

```
CRM Webapp (API)              Worker                      Hermes CLI
      │                          │                           │
      │── listQueuedJobs ───────→│                           │
      │←─────── jobs ────────────│                           │
      │                          │── build_prompt() ────────→│
      │                          │   (公司名, INN, URL)       │
      │                          │                           │── russia-recon skill
      │                          │←── report.md (markdown)───│
      │                          │                           
      │                          │── extract_structured_data()
      │                          │   (parse ## 客户数据摘要)
      │                          │── build_payload_from_report()
      │                          │── validate_payload()
      │                          │
      │← submitReconResult ──────│
      │   (result + evidence)     │
```

## The `## 客户数据摘要` Contract (Report → CRM bridge)

The skill outputs a YAML-like block at the **end** of its markdown report. The worker parses this to auto-fill CRM fields:

```
## 客户数据摘要
industry: 工业自动化
customer_type: 终端制造商
city: 莫斯科
employees: 50
phone: +7 (495) 123-45-67
email: info@company.ru
inn: 7712345678
rating: ⭐⭐⭐⭐
products: MCU、电源管理、连接器
description: 俄罗斯工业控制器制造商
sanctioned: false
sanction_source: 
sanction_program: 
outreach_angle: 了解到贵司使用STM32系列MCU...
contact_name: Иванов Иван Иванович
contact_title: 采购总监
notes: 官网有俄英双语，建议用俄语联系
```

### Field Sources

| Field | Source in report | Confidence |
|-------|-----------------|-----------|
| `industry` | Step 1 OKVED → Step 0 关联度判定 | ✅ 直接 |
| `customer_type` | Step 0 6维评分 | ✅ 直接 |
| `city` | Step 1 rusprofile 地址 | ✅ 直接 |
| `employees` | Step 1 rusprofile 1分钟概要 | ✅ 直接 |
| `phone` | Step 1 rusprofile / 官网 | ✅ 直接 |
| `email` | Step 1 rusprofile / Step 4 官网/Step 5 社交 | ✅ 直接 |
| `inn` | Step 1 rusprofile | ✅ 直接 |
| `rating` | Step 8 综合评分 / score 转换 | ✅ 直接 |
| `products` | Step 4 元器件需求 / Step 7 品牌识别 | ✅ 直接 |
| `description` | Step 0-1 综合分析 | ✅ 直接 |
| `sanctioned` | Step 3 制裁检查 | ✅ 直接 |
| `outreach_angle` | Step 9 话术生成 | ✅ 直接 |
| `opportunity_do` | Step 4 产品分析 / Step 7 品牌识别 → 提炼 | ✅ 直接，新字段v6.0 |
| `opportunity_need` | Step 4 元器件需求 / Step 7 品牌识别 → 提炼 | ✅ 直接，新字段v6.0 |
| `opportunity_sell` | Step 7 品牌识别 / Step 9 话术 → 提炼 | ✅ 直接，新字段v6.0 |
| `opportunity_decision` | Step 8 评分 + Step 3 制裁 + Step 5 联系人 → 综合 | ✅ 直接，新字段v6.0 |
| `contact_name/title` | Step 5 社交痕迹 / Step 2 zakupki | ✅ 直接 |
| `notes` | 异常/特殊发现 | ✅ 直接 |

## Worker result dict → Database Field Mapping

### → `recon_results` table (22 fields, worker fills 21)

| worker result key | recon_results column | Notes |
|---|---|---|
| company_name | company_name | from job |
| website | website | from job |
| customer_type | customer_type | |
| score | score | |
| priority | priority | "review" |
| compliance_status | compliance_status | "sanctioned"/"clear" |
| sanctioned | sanctioned | "true"/"false" |
| sanction_source | sanction_source | |
| sanction_program | sanction_program | |
| sanction_checked_at | sanction_checked_at | iso timestamp |
| evidence_url | evidence_url | |
| opportunity_summary | opportunity_summary | `### 机会判断` section 4行结构化文本 |
| opportunity_do | — | 仪表盘输入，不入库，只在report.html渲染 |
| opportunity_need | — | 仪表盘输入，不入库，只在report.html渲染 |
| opportunity_sell | — | 仪表盘输入，不入库，只在report.html渲染 |
| opportunity_decision | — | 仪表盘输入，不入库，只在report.html渲染 |
| contacts_summary | contacts_summary | 联系人 section |
| recommended_products | recommended_products | |
| products | products | same value |
| outreach_angle | outreach_angle | |
| next_action | next_action | dynamic: 有联系人/无 |
| report_path | report_path | |
| artifacts_json | artifacts_json | JSON of 3 file paths |
| — | job_id | from job |
| — | customer_id | from job |
| — | evidence_count | computed from evidence array length |
| — | updated_at | server-side |

### → `customer_pool` table (26 fields, worker covers 23)

| worker result key | customer_pool column |
|---|---|
| company_name | company_name |
| domain | domain |
| country | country |
| russian_name | russian_name |
| english_name | english_name |
| website | website |
| industry | industry |
| customer_type | customer_type |
| city | city |
| phone | phone |
| email | email |
| inn | inn |
| rating | rating |
| current_pool | current_pool (from score) |
| products | products |
| description | description |
| risk_status | risk_status (from sanctioned) |
| website_verification | website_verification |
| verified | verified |
| contact_count | contact_count |
| contact_name | (maps to customers.contact) |
| contact_title | (maps to customers.contact) |
| notes | notes |
| deep_report | deep_report (full markdown content, added 2026-05-12) |
| source_file | source_file (from job.source, added 2026-05-12) |
| — | customer_id (CRM generated) |
| — | first_found / last_found / search_count (operational fields) |

### Functions in the Worker

| Function | Purpose |
|----------|---------|
| `build_prompt()` | Generates the Hermes CLI prompt instructing the skill what fields to produce in `## 客户数据摘要` |
| `run_agent()` | `subprocess.run([hermes, "chat", ...])` with timeout |
| `extract_structured_data()` | Parses the YAML block from report markdown + regex fallbacks for all fields |
| `infer_domain()` | Strips protocol/path from website URL to get clean domain |
| `infer_customer_type()` | Regex fallback using keywords (制造商/贸易商/系统集成商/EMS) |
| `infer_city()` | Regex + city name map (Москва→莫斯科 etc) |
| `infer_industry()` | OKVED keyword matching (28.12→液压, etc) |
| `infer_phone()` | Russian phone regex (`+7 ...`) |
| `infer_products()` | Regex keyword map (VFD→变频器/VFD) |
| `infer_description()` | Takes first non-trivial paragraph or "一句话结论" line |
| `infer_company_names()` | Extracts `ООО «...»` from text |
| `score_to_rating()`/`score_to_pool()` | Numeric score → ⭐ / S/A/B/C/D |
| `unique_urls()` | Extracts all https?:// URLs from markdown |
| `validate_payload()` | Ensures sanctioned=true has required fields and evidence has field_name |
| `build_v3_contract()` | Wraps validated Hermes output in the shared V3 contract |
| `validate_v3_contract()` | Verifies identity, evidence, and confirmed sanction matches before submission |
| `cleanup_value()` | Strips emoji/markdown cruft from extracted values |

### Two Active Copies

| Location | Status | Notes |
|----------|--------|-------|
| `russia-crm-local/scripts/recon_agent_worker.py` | 🟢 Active development | 599+ lines, richer fallbacks |
| `russia-customer-crm-webapp/scripts/recon_agent_worker.py` | 🟢 Production | 400 lines, simpler but same contract |

Keep both in sync — prompt template changes must apply to both.

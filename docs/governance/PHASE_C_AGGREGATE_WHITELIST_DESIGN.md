# 阶段 C：大聚合 payload 白名单化设计

日期：2026-08-30
状态：设计草案（待逐片执行）
范围：将剩余的 `redactContactFields`（CONTACT_KEYS 递归黑名单）调用点收敛为字段级白名单
纪律：每片 = 契约测试先行（结构 + 等价 + 行为）→ 实现 → 专项/全量 → 提交；等价以"blacklist≡whitelist 逐键 deepEqual"锁定

## 1. 目标

阶段 C 已完成三个**列表路径**白名单化：accounts 列表（`78e698b`）、intake 页（`5e992fe`）、通知页（`1835f73`）。剩余 `redactContactFields` 调用点全部位于**多形状大聚合 payload**，需逐形状推导白名单后组合。本设计定义：形状清单 → 白名单映射 → 复合投影 → 切片拆分。

## 2. 剩余调用点清单

| # | 调用点 | 载荷 | 包含形状 |
|---|---|---|---|
| P1 | `sales_crm.js:7022/7025/7096`（`loadAuthorizedBusinessPage` bootstrap 内） | `contactSafe(timeline)`、`contactSafe(intakeState)`、`contactSafeAlerts(alerts, preserveAlertCopy)`、`redactContactFields(visibleEvaluations)` | timeline、intake-state、alerts(alarm-copy)、evaluations |
| P2 | `db.js:1564` + `db.js:1707`（bootstrap 全量） | `{customers, customerPool, stats, reconJobs, reconResults, tags, contactReconJobs, people, contactQualityStats, prospectTasks/Candidates/Sources, ...}` | account、pool、recon、people、prospect |
| P3 | `sales_crm.js:11631`（`GET /api/sales-crm/intake` 的 `loadIntakeState`） | `{settings, stats, items, batches}` | intake-state（items 形状与 P1 相同） |
| P4 | `sales_crm.js:9975`（`loadRecycleProfile`） | `{masterProfile, account, activities, rfqs, quotes, orders, timeline, insights:{contacts,evaluations}, auditLog}` | account、activity、commerce、timeline、insights |
| P5 | `sales_crm.js:10631`（`GET /api/sales-crm/export`） | `{users, customers, contacts, activities, corrections, proposals, rfqs, quotes, orders, evaluations}` | account、activity、commerce、evaluation |

注意：P1 的 intake-state `items` 与 P3 相同，因此 intake-state 形状只需推导一次；但与 `queryIntakeFlowPage` 的 items 形状**不同**（多出 `batch_source`/`master_description`/`master_products`/`deep_report`/`source_file`/`master_updated_at`/`in_crm`/`crm_assignment_status`/`crm_stage`），不能复用 29 键的 `CONTACT_SAFE_INTAKE_KEYS`。

## 3. 形状清单与白名单映射

| 形状 | 现有白名单 | 需新建立 |
|---|---|---|
| account rows | ✅ `contactSafeAccountRecord` | |
| pool rows | ✅ `contactSafePoolRecord` | |
| recon rows | ✅ `contactSafeReconRecord` | |
| evaluation rows（insights） | ✅ `contactSafeInsightsRecord`（需核验 evaluation payload 键集） | |
| alert rows（alarm copy） | ✅ `contactSafeAlertsRecord`（需核验 preserveAlertCopy ≡） | |
| activity rows | ✅ `contactSafeActivityRecord` | |
| commerce rows（rfq/quote/order） | ✅ `contactSafeCommerceRecord` | |
| intake-state items（P1/P3） | ❌（区别于 29 键版本） | ✅ `CONTACT_SAFE_INTAKE_STATE_ITEM_KEYS` + `contactSafeIntakeStateItemRecord` |
| intake-state settings/stats/batches | ❌ | ✅ 推导各自键集（settings 多为内部配置，或可直接按需保留） |
| timeline rows（activity+account 混合） | ✅ activity 白名单（需核验 timeline 特有键） | ⚠ 可能需补键 |
| master profile | ❌ | ✅ 推导键集 |
| people / prospect rows | ❌ | ✅ 推导键集（仅 P2） |
| 复合 payload 容器 | ❌ | ✅ 各路径复合投影函数 |

新白名单一律按既定范式推导：先对真实端点行跑 `redactContactFields` → 得"黑名单保留键集"，据此建白名单键集，再用等价契约锁定。

## 4. 复合投影设计

`redactContactFields` 对混合对象是"递归剥 CONTACT_KEYS"。字段级白名单是"每形状显式键集"。对大聚合，采用**结构化复合投影**（非递归黑名单、非单一白名单）：

```js
// 每个路径一个复合投影，按顶层字段分派到对应形状白名单；
// 已是空/门控(如 !view_contacts 时 contacts:[]) 的字段原样保留。
```

候选函数（放进 `access_control.js`，按片添加）：
- `contactSafeIntakeStatePayload(payload)`（settings/stats 推导键集 + items 用新 intake-state item 白名单 + batches 推导）
- `contactSafeBootstrapPayload` / `contactSafeRecycleProfilePayload` / `contactSafeExportPayload`（P2/P4/P5 各自的顶层字段→形状白名单）

等价测试策略：对真实端点行构造"同形状对象"，断言 `复合白名单(payload) deepEqual redactContactFields(payload)`；对每个新键集先单测等价，再组合。

## 5. 切片拆分（依赖 DAG）

按"形状先于组合"原则，先建被复用的形状白名单，再建复合投影：

1. **S1 基础形状**：`CONTACT_SAFE_INTAKE_STATE_ITEM_KEYS`（P1/P3 items）+ `contactSafeIntakeStateItemRecord`；等价契约（loadIntakeState items 行）。
2. **S2 intake-state 复合**：`contactSafeIntakeStatePayload`（settings/stats/batches 键集 + S1）；接线 `sales_crm.js:11631`（P3，边界最小的单端点）；契约 = 等价 + `GET /api/sales-crm/intake` API 行为。
3. **S3 timeline + master 形状**：推导 timeline（buildCustomerTimeline 行）与 master profile 键集/白名单；等价契约。
4. **S4 bootstrap sis 复线**：用 S2+S3 接线 `sales_crm.js:7022/7025/7096`（P1 bootstrap 内 timeline + intake-state + alerts + evaluations）；`contactSafeAlertsRecord` preserveAlertCopy 等价核验。
5. **S5 recycle-profile 复合**：`contactSafeRecycleProfilePayload`（S4 复用 timeline + account/activity/commerce/insights）；接线 P4。
6. **S6 export 复合**：`contactSafeExportPayload`（S5 复用）；接线 P5。
7. **S7 db bootstrap 复合**：people/prospect 键集 + `contactSafeBootstrapPayload`；接线 P2。
8. **S8 收尾**：确认 `lib/` 无剩余 `redactContactFields`（AI 相关 `assistant.js`/`ai_stations/task_center.js` 红线除外）；范围解释器统一与按页面合约为下一主线。

依赖：S2→S1；S4→S2,S3；S5→S4（及 account/activity/commerce/insights 现有）；S6→S5；S7→S5（+people/prospect）。S3/S5/S6/S7 相对独立，可按需并行。

每片完成定义：契约测试（结构 + 等价 + 行为）绿 → 受影响域专项 → 全量 `node --test` → core → `git diff --check` → 更新 CURRENT_STATE + session → 独立提交。

## 6. 风险与门禁

- **行为保持**：等价契约保证无 view_contacts 用户可见字段逐键一致；复合投影不得改变空字段/门控字段。
- **preserveAlertCopy**：alert 形状须核验 `contactSafeAlertsRecord` 与 `redactContactFields(payload,{preserveAlertCopy:true})` 等价，必要时为 alarm-copy 记录单列键集。
- **intake-state 双形状**：勿把 P1/P3 items 与 `queryIntakeFlowPage` items 混用同一 29 键白名单（键集不同）。
- **红线**：不改 `ai_stations/**`、`assistant.js`/`task_center.js` 内调用；不改 AI 触发点。
- 未全绿前不叠加下一阶段功能。
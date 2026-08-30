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

> **关键发现（2026-08-30 S1 审计）**：`loadIntakeState`（P1/P3）的 items 经 `queryIntakeFlowPage` 之外的 enrichment 带**深度嵌套内容**——`arbitration`（ruleDecision 含 `reason`、aiRecommendation、rankedCandidates、history 带 `actorName`+嵌套 aiRecommendation）、`developmentHistory`、`signals`（AI）、`customerTags`、`identityWarning`。黑名单是**递归**剥离（在每层嵌套内剥 CONTACT_KEYS，如 `arbitration.ruleDecision.reason`、`history.notes`、`developmentHistory.summary`）；字段级白名单是**保留顶层键、值原样拷贝**——会对嵌套对象内的 contact 子字段**泄漏**。
>
> **结论**：P1/P3（loadIntakeState items）**不适合作顶层白名单**——忠实转换需要按每个嵌套形状各建递归白名单，复杂度等同黑名单且无简化收益；强行顶层白名单违反"不泄漏联系方式"合规不变量。**P1/P3 不建议本设计推进**（或需另立"递归逐形状白名单"独立子项目）。其余路径（P4/P5 的 account/activity/commerce/timeline/evaluations 为扁平行）可安全白名单化。
>
> **S5（export）补充发现（2026-08-30 实测）**：导出 payload 的 `users` 数组（仅 `view_users` 时非空）为 sales_users 行，黑名单**保留 `password_hash`/`password_salt`**（不在 CONTACT_KEYS）——忠实镜像白名单将把密码哈希列入显式键集，属合规隐患；改行为则破坏等价。**S5 暂缓**：与 P1/P3 同样判定"保留黑名单"，或需先修 users 形状的密码列暴露（另立合规修复切片，先经用户裁定）。export 的 corrections/proposals/activities 追加字段亦需各自键集推导，非纯复用。
>
> **S6（db bootstrap）审计结论（2026-08-30 实测）**：两个 bootstrap 聚合（`db.js:1564`/`1707`）里真正携带联系数据的形状**均已在源头门控为空**：`people`/`contactReconJobs`/`contactQualityStats` 仅 `view_contacts` 时查询（无权限为空数组）、`customerPool`/`reconResults` 已分别经 `contactSafePoolRecord`/`contactSafeReconRecord` 白名单。剩余 `redactContactFields` 对抗的是 `customers`（legacy customers 表，含 email/phone/contact）、`reconJobs`、`templates`、`tags` 及纯配置标量。**`customers` 是唯一未覆盖的联系承载形状**。结论：S6 主要是 belt-and-suspenders 低价值加固（联系数据已在源头收敛），非暴露缺口；`customers` 可单独立一 `CONTACT_SAFE_CUSTOMER_ROW_KEYS` 形状片（含 leakage 校验），但不阻塞主线。

| 形状 | 现有白名单 | 需新建立 | 可行性 |
|---|---|---|---|
| account rows | ✅ `contactSafeAccountRecord` | | ✅ 扁平 |
| pool rows | ✅ `contactSafePoolRecord` | | ✅ 扁平 |
| recon rows | ✅ `contactSafeReconRecord` | | ✅ 扁平 |
| evaluation rows（insights） | ✅ `contactSafeInsightsRecord`（需核验 evaluation payload 键集） | | ✅ 扁平 |
| alert rows（alarm copy） | ✅ `contactSafeAlertsRecord`（需核验 preserveAlertCopy ≡） | | ✅ 需专项核验 |
| activity rows | ✅ `contactSafeActivityRecord` | | ✅ 扁平 |
| commerce rows（rfq/quote/order） | ✅ `contactSafeCommerceRecord` | | ✅ 扁平 |
| timeline rows（activity+account 混合） | ✅ activity 白名单（需核验 timeline 特有键） | | ⚠ 需补键核验 |
| **intake-state items（P1/P3）** | ❌ | ❌ **不建议**（深度嵌套泄漏） | ⛔ 保留黑名单或递归子项目 |
| intake-state settings/stats/batches | ❌ | ⚠ 仅 P3 不经 enrichment 时扁平 | ⚠ 待定 |
| master profile | ❌ | ✅ 推导键集 | ⚠ 需核验 |
| people / prospect rows | ❌ | ✅ 推导键集（仅 P2） | ⚠ 需核验嵌套 |

新白名单一律按既定范式推导：先对真实端点行跑 `redactContactFields` → 得"黑名单保留键集"，据此建白名单键集，再用等价契约锁定；**凡白名单键的值为非空对象/数组，须校验该嵌套值的 CONTACT_KEYS 子键是否泄漏，泄漏则改归黑名单路径或建递归白名单**。

## 4. 复合投影设计

`redactContactFields` 对混合对象是"递归剥 CONTACT_KEYS"。字段级白名单是"每形状显式键集"。对大聚合，采用**结构化复合投影**（非递归黑名单、非单一白名单）：

```js
// 每个路径一个复合投影，按顶层字段分派到对应形状白名单；
// 已是空/门控(如 !view_contacts 时 contacts:[]) 的字段原样保留。
```

候选函数（放进 `access_control.js`，按片添加）：`contactSafeBootstrapPayload` / `contactSafeRecycleProfilePayload` / `contactSafeExportPayload`（P2/P4/P5 各自的顶层字段→形状白名单）。P1/P3（loadIntakeState）**退出本设计**（见 §3 嵌套泄漏）——其 `redactContactFields` 调用保留，或在独立"递归逐形状白名单"子项目处理。

等价测试策略：对真实端点行构造"同形状对象"，断言 `复合白名单(payload) deepEqual redactContactFields(payload)`；对每个新键集先单测等价，再组合。复合投影必须以"被保留键的嵌套值不泄漏 CONTACT_KEYS 子键"为前提。

## 5. 切片拆分（依赖 DAG，已排除 P1/P3/P5）

按"形状先于组合"原则，先建被复用的形状白名单，再建复合投影；每片执行前先用 §3 泄漏校验确认该形状嵌套安全。

1. **S3 timeline + audit 形状（已完成 `38bfe7d`）**：`contactSafeTimelineRecord`（12 键，title/summary/next_action/outcome 属 CONTACT_KEYS 被剥，provenance 纯结构已泄漏校验）+ `contactSafeAuditLogRecord`（剥 action）+ 等价/泄漏契约 3/3。
2. **S4 recycle-profile 复合**：`contactSafeRecycleProfilePayload`（account/activity/commerce/timeline(S3)/insights + auditLog(S3) + recycle/profileAccess）；**被 `masterProfile`（`getCustomerProfileData` 巨型共享形状，含 people/recon）门控**——需先为 masterProfile 形状另立子设计（或复用 S6 的 people/recon 白名单）；接线 P4。
3. **S6 db bootstrap 复合**：people/prospect 键集（泄漏校验）+ `contactSafeBootstrapPayload`；接线 P2。产出可被 S4 复用。
4. **S7 收尾**：确认 `lib/` 无剩余 `redactContactFields`（AI 相关 `assistant.js`/`ai_stations/task_center.js` 红线除外；P1/P3 与 S5 被 §3 判定不建议转换）；范围解释器统一与按页面合约为下一主线。

**暂缓**：P1/P3（loadIntakeState 嵌套泄漏）、S5（export 的 users 形状含 password_hash 暴露，需先修合规）。

依赖：S4→S3,S6（及 account/activity/commerce/insights 现有）；S6 独立。S4 与 S6 均可作为独立切片执行，S6 无前置。

每片完成定义：契约测试（结构 + 等价 + 行为）绿 → 受影响域专项 → 全量 `node --test` → core → `git diff --check` → 更新 CURRENT_STATE + session → 独立提交。

## 6. 风险与门禁

- **行为保持**：等价契约保证无 view_contacts 用户可见字段逐键一致；复合投影不得改变空字段/门控字段。
- **嵌套泄漏（本轮发现的最高风险）**：凡白名单保留键的值为非空对象/数组，其内部 CONTACT_KEYS 子键会被泄漏（白名单不递归、黑名单递归）。每个新键集接线前必须做泄漏校验（扫描保留值中的 CONTACT_KEYS 子键）；泄漏则改回黑名单路径或建递归白名单。**P1/P3（loadIntakeState）因深度嵌套 AI/仲裁内容已在 §3 判定不建议转换。**
- **preserveAlertCopy**：alert 形状须核验 `contactSafeAlertsRecord` 与 `redactContactFields(payload,{preserveAlertCopy:true})` 等价，必要时为 alarm-copy 记录单列键集。
- **红线**：不改 `ai_stations/**`、`assistant.js`/`task_center.js` 内调用；不改 AI 触发点。
- 未全绿前不叠加下一阶段功能。
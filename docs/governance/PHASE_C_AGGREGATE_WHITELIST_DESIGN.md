# 阶段 C：大聚合 payload 白名单化设计

日期：2026-08-30（P1/P3、S5/P5、S7、S4/P4 复核：2026-09-02）
状态：P1/P3 递归合规修复方案与契约已完成；S6 legacy customers 行已收口（`c595bf0`），S5/P5 导出凭据字段边界已收口（`ccc9bb5`），S7 剩余 `redactContactFields` 调用点审计与迁移边界契约已完成（`a57c44f`），S4/P4 回收资料与共享完整资料逐形状风险矩阵/只读契约/迁移门禁已完成（`09665b5`）；P1/P3 顶层白名单及 S4/S6 复合迁移仍按本文边界暂缓
范围：将剩余的 `redactContactFields`（CONTACT_KEYS 递归黑名单）调用点收敛为字段级白名单
纪律：每片 = 契约测试先行（结构 + 等价 + 行为）→ 实现 → 专项/全量 → 提交；等价以"blacklist≡whitelist 逐键 deepEqual"锁定

> 当前实现注记（2026-09-02）：S6 legacy `customers` 行使用 `CONTACT_SAFE_CUSTOMER_ROW_KEYS`；P1/P3 深度嵌套 intake-state 使用 `redactIntakeAggregate`；S5/P5 export 使用 `redactExportCredentials` 作为独立凭据边界；S7 以矩阵和静态契约确认剩余复合调用点的保留/冻结决定。四者均不是整个复合 payload 的顶层白名单迁移：P1/P3 顶层迁移仍按嵌套等价风险暂缓，export 的合法业务字段/联系人权限继续由原有查询和联系人投影负责。

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

### 2026-09-02 P1/P3 审计复核

审计契约位于 `test/phase_c_load_intake_aggregate_audit.test.js`，以真实
`GET /api/sales-crm/intake` 响应和合成嵌套行同时验证 `loadIntakeState` 的形状边界：

| 返回路径 | 真实来源/组装点 | 无 `view_contacts` 时的观察 | 白名单决策 |
|---|---|---|---|
| `items[].arbitration.ruleDecision` | `crm_intake_decisions.rule_decision_json` | `reason`/`notes` 等已知 CONTACT_KEYS 递归剥离 | 不能只保留 `arbitration` 顶层键；需逐形状递归投影 |
| `items[].arbitration.aiRecommendation.rankedCandidates[]` | 仲裁 JSON + 负责人名称补全 | 数组及未知子键原样保留，已知键按黑名单递归处理 | 继续保留黑名单；AI 面不改 |
| `items[].assignmentAudit[].ruleDecision` | `intakeDecisionHistory` 历史数组 | 嵌套 `reason`/`notes` 递归剥离 | 与 `arbitration` 同一高耦合形状，暂缓 |
| `items[].developmentTimeline[]` | `intakeDevelopmentHistory` 的 timeline | `summary`/`next_action` 等已知叙事键剥离 | 不能把数组作为顶层白名单值原样复制 |
| `items[].developmentHistory` | 账户、活动、RFQ/报价/订单聚合 | `lastActivitySummary` 不是当前 CONTACT_KEYS，含联系人叙事的值会原样保留（已用哨兵值复现） | 记录为残余高风险；先另立合规修复，再谈白名单迁移 |
| `items[].identityWarning` | `publicLeadIdentityWarning` | 当前固定结构为公开核验提示 | 可保留，但不能推导整个 item 白名单 |
| `items[].customerTags[]` | `customer_tags`/`tags` 查询 | 当前字段固定；未来标签列会随值复制进入 payload | 需要独立标签形状投影，不能复用 intake 行白名单 |
| `items[].signals.fit/readiness` | AI station 结果的固定摘要 | 由既有 AI 开关决定是否出现；本轮不改 AI | AI 红线，保持原位 |
| `items[].complementaryInfo` | `supplement_pending_json` 任意 JSON | 递归黑名单只认识已登记键，未知别名仍可能保留 | 需要形状约束/递归白名单子项目 |
| `batches[]` | `SELECT * FROM crm_intake_batches` | 当前为扁平行，未来新增列会自动进入 | 不与嵌套 item 合并投影 |

复核还证明：若按黑名单保留的顶层键集合直接做“顶层白名单 + 值原样复制”，
`arbitration.ruleDecision.reason` 和 `assignmentAudit[].ruleDecision.reason` 会重新泄漏；
这不是可接受的等价转换。当前 P1/P3 仍由 `redactContactFields` 递归兜底，不能以本轮
审计结果宣称已完成字段级白名单化。

### 2026-09-02 P1/P3 递归合规修复方案与契约

本目标不把 P1/P3 改造成顶层字段白名单，而是在同一权限边界上增加专用的
`redactIntakeAggregate` 递归投影。它只在无 `view_contacts` 的 P1/P3 读路径使用；有权限的
响应保持原形状，AI 生产函数、存储格式和其他 payload 的 `redactContactFields` 语义均不变。

| 风险面 | 允许的形状/字段 | 无 `view_contacts` 的规则 | 拒绝默认 | 契约证据 |
|---|---|---|---|---|
| `developmentHistory.lastActivitySummary` | 账户标识、阶段、回收状态、计数、最后活动时间/类型 | `developmentHistory` 采用显式元数据投影；`lastActivitySummary` 及其别名永不下发 | 未来新增的嵌套对象/叙事字段不随值复制进入响应 | `phase_c_load_intake_aggregate_audit`：哨兵摘要在 P1/P3 均被移除 |
| `complementaryInfo`（含 `supplement_pending_json`） | 仅 `website`、`industry` 两个布尔补充标记 | 采用严格对象投影；`contact`、未知键、嵌套对象/数组、非布尔值全部丢弃；原始 JSON 字符串列同步不下发 | 任意未知 JSON 不递归保留，避免别名绕过 `CONTACT_KEYS` | 同一契约：未知别名/嵌套邮箱哨兵不可见，已知布尔标记保留 |
| `arbitration` / `assignmentAudit[]` 动态后代 | 现有规则/人工/推荐对象及其结构化业务值 | 对每一层对象和数组递归访问；按规范化键移除 `CONTACT_KEYS`、`lastActivitySummary`、原始补充 JSON 和常见联系方式别名；非敏感未知键可保留，以避免改动 AI/规则生产者 | 禁止“只保留顶层键再原样复制”；敏感字段在任意深度都必须剥离 | 合成嵌套契约 + 真实 P1/P3 路由；`reason`/`notes`/`emailAddress`/`phoneNumber` 哨兵均不可见 |
| `developmentTimeline[]`、`identityWarning`、`customerTags[]` | 既有结构化条目 | 继续走递归边界；已登记叙事键按既有规则剥离 | 不因本目标启动新的列表白名单迁移 | 既有 timeline/customer/tag 契约与本轮形状清单 |

规则优先级固定为：权限判断 → 递归键裁剪 → 形状专用投影。投影返回新对象，不修改
`loadIntakeState` 的源对象；空对象可以保留作为结构占位，但不得包含被拒字段或其原始值。
P1 bootstrap 与 P3 直读路由必须调用同一 helper，确保没有单路由修复遗漏。该方案完成的是
“无联系方式权限时不泄漏”的运行时边界与契约，不等同于 P1/P3 的顶层白名单迁移；后者仍需
另行做逐形状等价评审。

### 2026-09-02 S5/P5 导出凭据字段合规修复

S5/P5 的目标是让 `/api/sales-crm/export` 的 JSON 与 CSV 输出形成独立、与联系人权限正交的凭据安全边界。历史审计发现已记录为风险证据；本轮在不改变导出授权、范围和合法业务字段的前提下完成最小修复（`ccc9bb5`）。

#### 导出字段风险矩阵

| 形状 | 真实来源/组装 | 风险 | 合规规则 | 合法保留范围 |
|---|---|---|---|---|
| `users[]` | `sales_users` + `hydrateUsersPermissions` | 原始行含 `password_hash/password_salt`，未来新增凭据列可能随 `SELECT *` 进入 | 现有显式用户 DTO + 复合 payload 递归凭据投影；无论 `view_users` 或 `view_contacts` 均删除凭据键 | `id/email/name/role/active/archived/permissionGroupId/permissions/createdAt` |
| `customers[]` | `crm_accounts` 动态列 + customer pool/负责人别名 | 动态列扩展可能携带 token/secret 等运行时材料 | 保留既有账户查询、范围和联系人投影；随后递归移除凭据键 | 客户、阶段、负责人、国家/行业、排序/状态等既有授权字段 |
| `contacts[]` | `crm_account_contacts` `SELECT *`，仅 `view_contacts` 非空 | 有联系人权限不等于有凭据权限；未来列或动态 JSON 可能携带 credential | 联系人权限仍由原逻辑门控；凭据投影对所有角色无条件生效 | 已授权联系人业务字段；联系人本身不因本切片被额外裁剪 |
| `activities[]` | `crm_activities` `SELECT *` + `publicActivityRecords`/provenance | 活动追加列、嵌入式 JSON 或溯源字段可能绕过用户行 DTO | 对对象/数组任意深度裁剪；对 JSON 文本中的对象/数组递归处理；不改变更正/范围语义 | 活动、客户关联、有效状态、更正关联和非敏感业务元数据 |
| `activityCorrections[]` / `activityCorrectionProposals[]` | 更正表行经范围判断后重组 | 追加字段或历史 JSON 可能包含 token/session/secret | 保持双方客户可见性、审批人和原因的既有规则；输出前统一凭据投影 | 已授权关系端点、状态、审批/更正业务字段 |
| `rfqs[]` / `quotes[]` / `orders[]` | 各商务表 `SELECT *` | 动态列扩展可能引入密钥、会话或内部 credential | 递归移除凭据键，不改变客户范围和金额/币种/毛利字段 | RFQ、报价、订单及其金额、币种、阶段关联 |
| `evaluations[]` | `crm_manager_evaluations` `SELECT *`，AI 开关另有既有裁剪 | 评价扩展列可能携带 secret；AI 开关不能替代凭据边界 | 先执行既有 AI/联系人规则，再无条件递归凭据投影 | 既有人工评价字段；AI 开关语义不变 |
| CSV（客户/活动） | `exportCrmCsv` 固定表头与行映射 | 未来若从 JSON 动态取列，可能把凭据列写入文件 | 只使用现有合法表头/字段；上游 JSON 已经过凭据投影；公式注入防护保持 | 客户 CSV 与活动 CSV 既有列、筛选和范围 |

#### 凭据递归投影契约

`lib/access_control.js` 的 `redactExportCredentials(value)` 是导出专用安全边界：

1. 适用于整个 payload，而不是仅 `users`；即使调用者同时拥有 `export_data`、`view_users`、`view_contacts`，凭据键也不得返回。
2. 键名先规范化，再移除 `password/passphrase/passwd`、`token`、`session`、`secret`、`credential`、`authorization`、`cookie`、`apiKey`、`privateKey`、`encryptionKey`、`salt` 等单复合别名（含 hash/salt/json/header 等后缀）。
3. 对对象和数组递归访问；对形如 JSON object/array 的 TEXT 值也递归解析。只有确实移除了嵌套凭据时才重新序列化，未命中的 JSON 文本保持原字节。
4. 凭据字段直接删除，不以 `[REDACTED]` 占位，避免 JSON/CSV 出现字段名或秘密值；非敏感未知业务键保留，保证 export 合法字段和既有范围行为不变。
5. 联系人权限裁剪先按原合同执行，凭据投影随后执行；两者正交。CSV 仍由固定列映射生成，不启动其他 payload 的顶层白名单迁移。

#### 契约与证据

`test/phase_c_export_credential_contract.test.js` 覆盖：

- 对象、数组、嵌套 JSON 文本、双重编码 JSON 的凭据键递归删除，且源对象不被修改；普通 `tokenCount`/`secretary` 等非凭据业务键保留；
- admin JSON/客户 CSV/活动 CSV 保留客户、活动、RFQ、报价、订单等合法字段，并验证密码哈希、salt、token、session、secret、API key 哨兵均不可见；
- 授权非 admin 用户验证客户范围、联系人空数组、商务字段和 JSON/CSV 凭据边界；
- 空范围 JSON/CSV 仍返回既有空数组/表头；无 `export_data` 仍返回 403；静态契约确认投影接在 `exportCrmData` 聚合边界。

该切片完成的是 S5/P5 **凭据字段合规边界**，不等同于 P1/P3 顶层字段白名单迁移；后者继续按嵌套等价风险暂缓。

### 2026-09-02 S7 剩余 `redactContactFields` 调用点审计

S7 以 `test/phase_c_s7_redaction_boundary_contract.test.js`（`a57c44f`）和配套会话
`docs/governance/sessions/2026-09-02-stage-c-s7-redaction-boundary-audit.md` 固化剩余调用点
的字段风险矩阵。结论按形状而不是按函数名分类：

- `listCustomerAccounts`、Research pool/recon、Pipeline、Alerts、Insights、通知等独立列表
  已使用 `contactSafe*Record` 和来源权限门控；静态契约禁止回退到直接的通用递归 helper。
- P1 `loadPayload`、P2 `getInitialData`、P4 `getCustomerProfileData`、P4 recycle profile
  的外层仍是跨域复合对象，继续保留 `redactContactFields` 递归兜底；legacy customer 行、
  timeline/audit、pool/recon 等已收口的叶子投影不改变。
- P1/P3 intake 只使用 `redactIntakeAggregate` 处理动态仲裁、历史和补充 JSON；不把顶层键
  集和值原样复制成白名单。S5 export 继续保持联系人投影后执行凭据递归投影。
- `assistant.js` 与 `ai_stations/task_center.js` 的调用点是 AI 冻结红线，仅记录不迁移。

因此 S7 没有新增可安全迁移的复合 payload；S4 recycle-profile、S6 bootstrap 和 P1/P3
顶层白名单仍需独立的逐形状结构/等价/嵌套泄漏契约后再立项，不能由本轮审计自动开启。

### 2026-09-02 S4/P4 回收资料与共享完整资料逐形状审计

S4 以 `test/phase_c_s4_recycle_profile_contract.test.js`（`09665b5`）和会话记录
`docs/governance/sessions/2026-09-02-stage-c-s4-recycle-profile-audit.md` 固化 P4 两条资料
边界。`getCustomerProfileData` 的 `masterProfile` 是跨 bootstrap/profile/recycle 复用的
巨型共享形状；其 customer/recon 叶子已有 `contactSafe*Record` 或 `view_contacts` /
`view_recon` 源头门控，外层仍由 `redactContactFields` 递归兜底。

`buildRecycleAccountProfile` 则将 masterProfile 与 account、activities、rfqs、quotes、
orders、timeline、insights、auditLog、recycle、profileAccess/actions 组合为只读资料。
`loadRecycleProfile` 独立要求 `manage_customer_recycle`，先进行回收生命周期/范围验证，再
委托 builder；route 保持 `private, no-store`。契约同时锁定 sales/manager/admin 的
`readOnly:true`、`canRestore` 三重 admin/权限/非 impersonation 门、mismatch/sales_return
的 `canReassign`，以及 contacts/evaluations 的来源权限门控。

| P4 形状 | 当前安全边界 | 迁移结论 |
|---|---|---|
| masterProfile、people、recon、标签/状态 | 共享聚合，部分叶子已投影/源头为空数组；跨页面复用且可随 `SELECT *` 扩展 | 必须先建立完整逐键、嵌套泄漏和行为契约；暂不迁移 |
| account、activities、rfqs/quotes/orders、timeline、auditLog | 既有扁平叶子 projection 可证明等价；复合数组仍混合动态来源/叙事字段 | 叶子 helper 保留；不能外推为复合 payload 等价 |
| insights.contacts/evaluations、recycle、profileAccess/actions | contacts/evaluations 有权限门；recycle/profileAccess/actions 需保持只读和动作负门 | 保留源头门控 + 最终递归裁剪，新增动作另立审计 |

结论是 **S4 迁移前置条件尚未满足**：masterProfile 与动态 account/commerce/timeline 的
全部后代尚未完成稳定键集与递归等价证明。因此不创建或接线
`contactSafeRecycleProfilePayload`，继续保留 builder/profile 的外层递归黑名单；已证明的
`contactSafe*Record` 仅作为叶子边界复用。S4 完成的是风险矩阵和门禁契约，不是运行时白名单
迁移；P1/P3 顶层和 S6 复合迁移同样不能由本轮自动开启。

> **历史审计发现（2026-08-30）**：导出 payload 的 `users` 形状曾被判定可能保留 `password_hash/password_salt`（不在 CONTACT_KEYS）；该发现作为本轮修复动因保留，已不再作为当前暂缓项。export 的 corrections/proposals/activities 追加字段仍需遵守本节递归凭据边界。
>
> **S6（db bootstrap）审计结论（2026-08-30 实测，2026-09-02 切片完成）**：两个 bootstrap 聚合（`db.js:1564`/`1707`）里真正携带联系数据的形状**均已在源头门控为空**：`people`/`contactReconJobs`/`contactQualityStats` 仅 `view_contacts` 时查询（无权限为空数组）、`customerPool`/`reconResults` 已分别经 `contactSafePoolRecord`/`contactSafeReconRecord` 白名单。剩余 `redactContactFields` 对抗的是 `customers`（legacy customers 表，含 email/phone/contact）、`reconJobs`、`templates`、`tags` 及纯配置标量。`customers` 已由 `c595bf0` 的 `CONTACT_SAFE_CUSTOMER_ROW_KEYS` 在 bootstrap/profile 两个路径显式投影并以结构/等价/泄漏/行为契约锁定；其余字段仍由原聚合黑名单兜底。结论：S6 的可选 legacy customers 残值已收口，但不等同于 P2 复合 bootstrap 全量白名单化。

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

候选函数（放进 `access_control.js`，按片添加）：`contactSafeBootstrapPayload` / `contactSafeRecycleProfilePayload`（P2/P4 各自的顶层字段→形状白名单）。P1/P3（loadIntakeState）**不做顶层白名单迁移**（见 §3 嵌套泄漏），改由 `redactIntakeAggregate` 处理；P5 export 先由 `redactExportCredentials` 形成凭据边界，是否建立业务字段白名单另行逐形状审计。

等价测试策略：对真实端点行构造"同形状对象"，断言 `复合白名单(payload) deepEqual redactContactFields(payload)`；对每个新键集先单测等价，再组合。复合投影必须以"被保留键的嵌套值不泄漏 CONTACT_KEYS 子键"为前提。

## 5. 切片拆分（依赖 DAG，已排除 P1/P3 顶层迁移）

按"形状先于组合"原则，先建被复用的形状白名单，再建复合投影；每片执行前先用 §3 泄漏校验确认该形状嵌套安全。

1. **S3 timeline + audit 形状（已完成 `38bfe7d`）**：`contactSafeTimelineRecord`（12 键，title/summary/next_action/outcome 属 CONTACT_KEYS 被剥，provenance 纯结构已泄漏校验）+ `contactSafeAuditLogRecord`（剥 action）+ 等价/泄漏契约 3/3。
2. **S4 recycle-profile 复合（审计完成，迁移仍门控）**：`09665b5` 已完成 account/activity/commerce/timeline(S3)/insights/auditLog(S3)/recycle/profileAccess/actions 与 masterProfile 的逐形状风险矩阵、权限/只读/递归契约；**仍被 `masterProfile`（`getCustomerProfileData` 巨型共享形状，含 people/recon）及动态 account/commerce/timeline 后代门控**。在完整结构/逐键等价/嵌套泄漏契约通过前，不创建或接线 `contactSafeRecycleProfilePayload`；接线 P4 暂缓。
3. **S6 db bootstrap 复合**：people/prospect 键集（泄漏校验）+ `contactSafeBootstrapPayload`；接线 P2。产出可被 S4 复用。
4. **S5/P5 导出凭据字段合规（已完成 `ccc9bb5`）**：`redactExportCredentials` 对整个 JSON payload 递归删除凭据键，并检查嵌入式 JSON 文本；CSV 继续固定合法列映射，保留授权、范围、联系人和商务字段。
5. **S7 收尾（已完成 `a57c44f`）**：确认剩余 `redactContactFields` 调用点与高耦合边界均有独立审计；独立列表投影已闭合，AI 相关 `assistant.js`/`ai_stations/task_center.js` 保持红线，P1/P3 顶层迁移仍按 §3 暂缓。范围解释器统一与按页面合约为下一主线。

**暂缓**：P1/P3 顶层白名单迁移（递归合规修复已完成，仍需独立逐形状等价评审）。

依赖：S4→S3,S6（及 account/activity/commerce/insights 现有）；S5 独立；S6 独立。S4、S5、S6 均可作为独立切片执行。

每片完成定义：契约测试（结构 + 等价 + 行为）绿 → 受影响域专项 → 全量 `node --test` → core → `git diff --check` → 更新 CURRENT_STATE + session → 独立提交。

## 6. 风险与门禁

- **行为保持**：等价契约保证无 view_contacts 用户可见字段逐键一致；复合投影不得改变空字段/门控字段。
- **嵌套泄漏（本轮发现的最高风险）**：凡白名单保留键的值为非空对象/数组，其内部 CONTACT_KEYS 子键会被泄漏（白名单不递归、黑名单递归）。每个新键集接线前必须做泄漏校验（扫描保留值中的 CONTACT_KEYS 子键）；泄漏则改回黑名单路径或建递归白名单。**P1/P3（loadIntakeState）因深度嵌套 AI/仲裁内容已在 §3 判定不建议转换。**
- **P1/P3 递归边界**：无 `view_contacts` 时必须使用 `redactIntakeAggregate`；`developmentHistory` 与 `complementaryInfo` 走严格形状投影，arbitration/assignmentAudit 的每层后代走规范化递归裁剪。不得把该 helper 复用为其他 payload 的全局黑名单替代品。
- **S5/P5 凭据边界**：`exportCrmData` 在联系人投影之后必须调用 `redactExportCredentials`；该 helper 对有 `view_contacts` 的导出同样生效，凭据键与 JSON 嵌套凭据不得因角色或格式差异出现在 JSON/CSV。不得以本切片名义启动其他复合 payload 的顶层业务白名单迁移。
- **preserveAlertCopy**：alert 形状须核验 `contactSafeAlertsRecord` 与 `redactContactFields(payload,{preserveAlertCopy:true})` 等价，必要时为 alarm-copy 记录单列键集。
- **红线**：不改 `ai_stations/**`、`assistant.js`/`task_center.js` 内调用；不改 AI 触发点。
- 未全绿前不叠加下一阶段功能。

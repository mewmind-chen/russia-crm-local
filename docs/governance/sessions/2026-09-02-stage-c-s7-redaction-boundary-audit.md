# 2026-09-02 Stage C S7 剩余递归脱敏调用点审计与迁移边界契约

## 目标与非目标

本切片对当前非 AI 生产代码中剩余的 `redactContactFields` 调用点逐一建立
“调用点 → 返回形状 → 权限/来源门控 → 嵌套风险 → 决策”记录，并用静态契约锁定已可
字段投影的独立列表与仍需保留的高耦合复合聚合。目标是明确下一刀的安全边界，不把
高耦合聚合强行改成未经逐形状等价证明的顶层白名单。

不修改 AI runtime、`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或 AI 触发点；不修改
生产；不启动 P1/P3 顶层白名单迁移，也不把本审计扩大为 S4/S6 的复合投影实现。

## 双基线与工作区

- `repo/` 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 生产 `current/.release-sha` 与 `state/state.json.lastSuccessfulSha`：同为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，本轮未部署。
- `after/` 实现基线：`ccc9bb5`（S5/P5），本切片契约提交：`a57c44f`；治理文档与看板
  在验证后同步提交。

## 字段风险矩阵与决定

| 调用点 | 返回形状/数据来源 | 权限与来源门控 | 嵌套风险 | 本轮决定 |
|---|---|---|---|---|
| `sales_crm_read_routes.js:80`（P3 intake 直读兼容回退） | `loadIntakeState` 的 `settings/stats/items/batches` | 路由注入 `redactIntakeAggregate`；仅在 helper 不可用时回退到旧黑名单 | `items.arbitration`、`assignmentAudit[]`、`developmentHistory`、`complementaryInfo` 含动态后代 | 专用递归 helper 已接线；回退仅兼容保险，保持，不迁移顶层白名单 |
| `sales_crm.js:6678`（P1 `loadPayload` 通用 wrapper） | bootstrap 复合 payload：accounts/activities/RFQ/quote/order/timeline/alerts/reports/team/insights/audit/notifications 等 | `permissions.view_contacts`；各独立子形状已有来源门控或投影 | 多形状混合，未来追加列会改变聚合；单一顶层白名单无法证明等价 | 高耦合复合边界保留递归黑名单；不迁移 |
| `sales_crm.js:6679`（P1 intake wrapper） | 同一 `loadPayload` 中的 intake-state | 同上；无权限时调用 `redactIntakeAggregate` | 动态仲裁/历史/补充 JSON 深层字段 | P1/P3 专用递归边界已收口；不复用为其他 payload 的全局替代品 |
| `sales_crm.js:6682`（P1 alerts wrapper） | alerts 及 `preserveAlertCopy` 文案 | 由 `permissions.view_contacts` 门控；alert 行有 `contactSafeAlertsRecord` 形状 | alarm copy 可能包含叙事字段；需保证 preserve 语义 | 保留当前 wrapper；独立 alert 行继续用字段投影，暂不改复合 payload |
| `sales_crm.js:6753`（P1 insights evaluations） | `insights.evaluations` 公司评价行 | `view_contacts` 时返回可见评价，否则仅公司 subjectType 行再递归裁剪 | 评价扩展列或嵌套 JSON 可能引入联系叙事 | 保留既有筛选/黑名单；独立 Insights 列表使用 `contactSafeInsightsRecord` |
| `db.js:1568`（P2 `getInitialData`） | bootstrap：customers/customerPool/recon/people/prospect/tasks/tags 等 | customers/pool/recon 已字段投影；people/contactReconJobs/contactQualityStats 由 `view_contacts` 源头门控 | 外层仍是多域复合对象，`SELECT *` 未来可扩展 | legacy customer 行已收口；外层聚合保留递归兜底，不启动 S6 复合迁移 |
| `db.js:1714`（P4 `getCustomerProfileData`） | 共享完整资料：客户、recon、people、活动/任务等 | customer/recon 叶子投影；people/contactReconJobs 由 `view_contacts` 门控 | profile 是跨页面共享巨型形状，改动会影响 bootstrap、profile 与抽屉 | 保留外层黑名单；待 master profile 独立逐形状契约后再评估 |
| `sales_crm.js:9549`（P4 `buildRecycleAccountProfile`） | masterProfile + account/activities/rfqs/quotes/orders/timeline/insights/auditLog/recycle/profileAccess | `view_contacts` 门控；下层部分行已有 projection | 跨账户、活动、商务、时间线、审计和动作状态混合 | 高耦合 composite retain；S4 继续暂停，不能用顶层值复制白名单 |
| `sales_crm.js:10206`（S5 `exportCrmData` 联系人边界） | users/customers/contacts/activities/corrections/proposals/rfqs/quotes/orders/evaluations；JSON/CSV | 联系人权限按原合同；随后无条件 `redactExportCredentials` | 凭据键及嵌套 JSON 与联系人字段正交 | 已闭环：联系人投影后再凭据递归投影；本轮只锁定调用顺序 |
| `assistant.js:1979`（AI assistant） | assistant result 任意 AI 结构 | AI assistant access context | AI 结果动态嵌套 | AI 红线冻结，记录但排除迁移 |
| `ai_stations/task_center.js:320`（AI station detail） | station result value 任意 AI 结构 | station permission/context | AI 结果动态嵌套 | AI 红线冻结，记录但排除迁移 |

### 已关闭的独立列表形状

以下路径不再直接依赖顶层 `redactContactFields`，而由形状专用投影与来源权限门控负责，
本轮以静态契约确认它们没有回退到通用黑名单：

- `listCustomerAccounts` → `contactSafeAccountRecord`；
- `loadResearchPage` 的 pool/recon → `contactSafePoolRecord`/`contactSafeReconRecord`，
  people 受 `permissions.view_contacts` 门控；
- `listPipelineRows`、`listTodayTasks`、`listManagerEvaluationCustomers`、
  `listNotificationRows` → 各自 `contactSafe*Record`。

这些是“字段投影/权限来源门控”已闭合的候选形状，不代表其上层 bootstrap、profile、
recycle 或 P1 payload 已经完成复合白名单迁移。

## 迁移边界契约

1. 所有剩余非 AI 复合调用点必须有明确保留理由；本矩阵覆盖 P1/P2/P3/P4/S5 的每个
   生产调用形状，不能以“尚未迁移”代替风险判断。
2. P1/P3 无 `view_contacts` 继续只走 `redactIntakeAggregate`；`developmentHistory`、
   `complementaryInfo`、`arbitration`/`assignmentAudit` 的规则由其递归契约负责。不得把
   P1/P3 顶层键集合和值原样复制当作白名单。
3. P2/P4 外层复合 payload 暂留 `redactContactFields`；只有先对每个叶子形状建立
   结构、等价、嵌套泄漏和行为契约，才能另立 S4/S6 实现切片。
4. S5 导出保持“联系人投影 → `redactExportCredentials`”顺序；凭据边界对 admin/非 admin、
   `view_contacts` 有/无及 JSON/CSV 均生效，不借本切片扩大业务字段白名单。
5. AI 两个调用点是冻结红线，不纳入迁移计数、完成度或后续改造候选。

## 契约与验证

新增 `test/phase_c_s7_redaction_boundary_contract.test.js`（`a57c44f`）：

- 1 个测试锁定全部剩余非 AI 调用形状的 helper/投影/权限门控/高耦合决定；
- 1 个测试锁定独立列表的 shape-specific projection 且禁止直接回退通用 helper；
- 1 个测试锁定 AI 调用点存在但保持冻结红线。

本切片完成条件：上述矩阵与静态契约一致；全量 `node --test`、core `npm test`、治理权威、
AI 边界、语法和差异门禁全部通过；生产目录与 AI 源码无变化。

## 结论与下一步

S7 将剩余调用点分为三类：独立列表形状已字段级闭合；P1/P3 已有专用递归合规边界；
P1/P2/P4 的外层复合及 recycle profile 仍是高耦合保留边界；AI 调用点冻结排除。当前没有
新的安全迁移候选，也没有证据支持启动 P1/P3 顶层白名单、S4 recycle-profile 或 S6
bootstrap 复合投影。下一步只能在独立逐形状契约完成后另立切片；否则保持当前回滚点和
生产只读状态。

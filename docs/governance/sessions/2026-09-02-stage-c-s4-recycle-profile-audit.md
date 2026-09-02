# 2026-09-02 Stage C S4/P4 回收资料与共享完整资料逐形状安全契约

## 目标与非目标

本切片对 P4 的两个共享资料边界建立逐形状字段风险矩阵：
`db.js:getCustomerProfileData` 的共享完整资料，以及
`sales_crm.js:buildRecycleAccountProfile`/`loadRecycleProfile` 的回收客户资料。
审计范围覆盖 masterProfile、account、activities、rfqs/quotes/orders、timeline、
insights、auditLog、recycle、profileAccess/actions 和两条 HTTP 路由。验收重点是
结构完整性、来源与权限门控、无 `view_contacts` 时的递归脱敏等价性、回收资料只读语义，
以及是否具备启动 `contactSafeRecycleProfilePayload` 的前置条件。

不改运行时实现、不改 AI、不改生产；不创建或接线 `contactSafeRecycleProfilePayload`，
不把本次审计扩大为 P1/P3 顶层白名单或 S6 bootstrap 复合迁移。AI 开关和既有
`withoutEvaluationAI` 语义只作为形状来源记录，保持冻结。

## 双基线与工作区

- `repo/` 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 生产 `current/.release-sha` 与 `state/state.json.lastSuccessfulSha`：同为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，本轮未部署。
- `after/` 在 S7 审计契约 `a57c44f` 后新增 S4 结构契约
  `test/phase_c_s4_recycle_profile_contract.test.js`（实现提交为 `09665b5`）。

## P4 装配边界

### 共享完整资料：`getCustomerProfileData`

该函数先以 `assertExternalCustomerAccess` 验证外部客户范围，再从
`customer_pool`、`customers`、`recon_jobs`、`recon_results`、`contact_recon_jobs`、
`person_candidates` 和标签/配置查询组装统一资料。客户行在无 `view_contacts` 时经
`contactSafeCustomerRecord`，recon 结果经 `contactSafeReconRecord`；
`contactReconJobs`、`people` 只在 `view_contacts` 时查询，其余返回空数组。最终 payload
仍由 `redactContactFields` 递归兜底，`profileAccess` 根据 CRM、intake 或 recycle 只读
来源生成。

### 回收资料：`buildRecycleAccountProfile` 与 loader

`loadRecycleProfile` 是独立授权边界：先要求 `manage_customer_recycle`，再用
`findRecycleAccount(value,user,customerId)` 校验回收生命周期与可见范围；全局范围用户
找不到记录返回 `RECYCLED_CUSTOMER_NOT_FOUND`，非全局用户返回
`RECYCLED_CUSTOMER_FORBIDDEN`，通过后才调用 builder。builder 组装 account、共享
masterProfile、活动/商务查询、timeline、insights、auditLog、recycle 元数据和动作
状态，响应头由路由固定为 `Cache-Control: private, no-store`。

## 字段风险矩阵与决定

| 形状 | 真实来源/组装 | 权限、范围与只读门控 | 递归/动态风险 | 本轮决定 |
|---|---|---|---|---|
| `masterProfile` 外层 | `getCustomerProfileData` 返回的 `customers`、`customerPool`、`stats`、recon、people、prospect、tags、状态选项、`profileAccess` 等共享对象 | 先过 `assertExternalCustomerAccess`；`view_contacts` 控制客户/联系人叶子；`view_recon` 控制 recon；`recycleReadOnly` 强制来源为 recycle、`readOnly:true` | 跨 bootstrap、普通 profile 和 recycle 三处复用；未来 `SELECT *`/新增嵌套列会改变共享形状 | 保留外层递归黑名单；必须先有完整 masterProfile 逐键/嵌套契约，当前不具备复合白名单迁移条件 |
| `customers[]` / `customerPool[]` | legacy `customers` + `customer_pool` 行，经 `buildCustomer`/`buildPoolCustomer` 和标签补全 | 无 `view_contacts` 时 customer 行使用 `contactSafeCustomerRecord`；pool 的负责人/来源字段再受 CRM 范围与 `view_all_customers` 门控 | 行内未来新增字段可能携带联系人叙事；标签值为数组/对象时有嵌套泄漏风险 | 叶子投影继续保留；不把其已闭合证明外推为 masterProfile 顶层证明 |
| `reconJobs[]` / `reconResults[]` | `recon_jobs`、`recon_results` 查询；结果无联系人权限时 `contactSafeReconRecord` | `view_recon` 源头门控；无 `view_contacts` 只裁剪结果敏感叶子 | recon 结果可能增加动态 JSON/叙事字段；jobs 与 results 权限不同 | 保留现有来源门控和叶子投影；复合外层继续递归兜底 |
| `contactReconJobs[]` / `people[]` | `contact_recon_jobs`、`person_candidates`，people 另拼 `methods_summary` | 仅 `view_contacts` 查询；无权限固定为空数组 | 联系方式集中在 methods/候选字段，未来 `SELECT *` 扩列会扩大暴露面 | 以空数组源头门控作为当前安全边界；不在本轮推导新白名单 |
| `account` | `findRecycleAccount` 返回回收账户，`addStageLabels` 补 stage 标签；含负责人、回收人、前负责人等关联名称 | loader 已做回收范围/生命周期校验；builder 不提供编辑 account 的动作 | `SELECT`/join 字段和负责人名称属于动态扩展面，回收原因/备注可能是叙事联系方式 | 保持现有 account DTO + 最终递归裁剪；先补完整 account 键集和叙事审计，再评估叶子投影 |
| `activities[]` | `crm_activities x` 左连接用户名称，经 `addActivityProvenance`、`publicActivityRecords` | 按 account.id 查询且排除测试数据；回收资料本身只读；联系方式由最终权限投影控制 | provenance、备注、参与人或未来 JSON 列可能嵌套联系方式 | 现有 `contactSafeActivityRecord` 仅作为独立扁平行证明；回收复合仍不迁移 |
| `rfqs[]` / `quotes[]` / `orders[]` | 各商务表 `SELECT *`，按 account.id 与时间倒序 | builder 只读查询；回收账户已由 loader 授权；金额/币种/阶段等业务值必须保持 | `SELECT *` 未来新增列、备注或嵌套 JSON 无固定键集 | `contactSafeCommerceRecord` 的扁平等价契约继续有效，但三个数组仍留在递归复合边界 |
| `timeline` | `buildCustomerTimeline(value,[account],activities,rfqs,quotes,orders,{includeAI})` 混合账户/活动/商务事件 | 由 builder 的回收范围、`includeAI` 既有开关和最终联系人权限共同决定；无写入口 | 事件可能带 title/summary/next_action/outcome、provenance 或 AI 扩展；混合来源使单键集易漂移 | 复用 S3 `contactSafeTimelineRecord` 仅限已证明叶子；不复制整个 timeline 数组 |
| `insights.contacts[]` | `loadInsights(value,[account]).contacts` | 只有 `view_contacts` 返回；否则固定 `[]` | 联系人行未来可扩列，或携带嵌套评价/联系方式对象 | 继续源头空数组门控；不在本轮把 contacts 纳入复合白名单 |
| `insights.evaluations[]` | `loadInsights(...).evaluations`，AI 关闭时 `withoutEvaluationAI` | 只有 `view_insights` 返回评价；AI 开关仅决定 AI 字段，非联系人授权替代 | 评价文案、作者、AI 推荐和动态 JSON 可能含叙事联系方式 | 保留 `view_insights` 与 AI 原有语义，复合外层递归裁剪；独立行继续用 `contactSafeInsightsRecord` |
| `auditLog[]` | `crm_audit_log` 选取 action/entity/时间/real/effective user 及名称 | 仅关联 account.id/external_customer_id；builder 只读 | `action`、用户名和未来 metadata 可能形成叙事或动态 JSON | S3 audit 叶子投影继续可复用；不把 audit 行证明升级为整个 payload 证明 |
| `recycle` | builder 从 account 生成 kind/reason/previous owner/recycler/time | 固定 `source:'recycle'`、`status:'recycled'`；只读 | reason、owner name 是叙事/联系人风险，字段可能继续扩展 | 保留显式元数据但经过最终递归裁剪；需独立审计 reason 的允许语义 |
| `profileAccess` | shared profile 与 recycle builder 分别生成访问状态 DTO | recycle 始终 `readOnly:true`、`crmAccessible:false`；`canEditNickname` 仅由既有编辑权限+主档可访问决定 | 未来新增 action/编辑能力字段可能意外变成写入口 | 静态契约锁定 read-only/source/status/accountId/canEditNickname；不迁移为白名单复合 |
| `actions` | `canReassign`（sales_return/mismatch）与 `canRestore`（manual_delete + admin + manage 权限 + 非 impersonating）组合 | 仅公开允许动作名；资料路由仍只读，真正写入另有动作路由/权限 | 动作扩展可能将写操作混进资料响应；impersonation 是关键负门 | 保留显式动作集合，契约锁定 admin/manager/sales 分支和 impersonation 负例；新增动作必须另立审计 |
| profile/recycle route | `/api/sales-crm/profile/:customerId`、`/api/sales-crm/accounts/:customerId/recycle-profile` | profile policy=`view_customers`；recycle policy=`manage_customer_recycle`；recycle `private, no-store` | 路由包装器可能添加 contacts/access 等新字段，绕开 builder 证明 | 仅锁定委托、授权和缓存语义；不在路由层新增聚合投影 |

## 递归脱敏与等价契约

本轮新增 `test/phase_c_s4_recycle_profile_contract.test.js`（`09665b5`）锁定四类边界：

1. 共享资料的 customer/pool/recon/people 来源门控、回收 payload 的全部显式形状、loader
   的权限/范围/错误码和 builder 委托；
2. sales、manager、admin 的回收资料均保持 `readOnly:true`，`canRestore` 的 admin、
   `manage_manual_customer_deletion`、非 impersonation 三重门，以及 mismatch/sales_return
   的 `canReassign`；contacts/evaluations 分别由 `view_contacts`/`view_insights` 门控；
3. activity、commerce、timeline、audit、insights 五类已存在扁平叶子投影逐行验证
   `contactSafe*Record(row) deepEqual redactContactFields(row)`，且不修改源行；
4. `access_control.js` 不存在 `contactSafeRecycleProfilePayload`，设计文档仍要求完整的
   结构、逐键等价、嵌套泄漏和行为契约后才能开启复合迁移。

递归规则因此保持为：权限/范围判断 → 各叶子已有投影或源头空数组门控 → 外层
`redactContactFields` 递归裁剪。未知动态字段不能因顶层值复制而绕过递归边界；在所有数组和
对象后代均完成证明之前，不能宣称复合白名单与现有黑名单等价。投影必须返回新对象，不能
修改查询结果供后续有权限调用者使用。

## 迁移门禁决定

当前 **不具备** `contactSafeRecycleProfilePayload` 的迁移前置条件，理由是：

- `masterProfile` 是跨 bootstrap/profile/recycle 复用的巨型共享形状，people、recon、标签、
  状态和动态扩展尚未完成逐键与深层泄漏证明；
- account、commerce 和 timeline 使用 `SELECT *` 或混合 builder，动态后代和叙事字段尚未
  形成稳定键集；
- `profileAccess`/`actions` 虽已锁定只读和权限分支，但其未来新增动作的行为契约尚未独立；
- 已证明的扁平叶子投影可以继续复用，不能把叶子证明外推成整个复合 payload 的等价证明。

因此保持 `buildRecycleAccountProfile` 和 `getCustomerProfileData` 的最终
`redactContactFields` 黑名单边界，不新增 composite helper，不改变任何运行时或权限行为。
下一项若要推进，必须先另立 masterProfile/people/recon 的逐形状契约，再补 account/commerce/
timeline 的动态键与叙事风险证据；在此之前 S4/S6/P1/P3 顶层迁移均继续冻结。

## 验证与结论

- 专项：`node --test test/phase_c_s4_recycle_profile_contract.test.js` → `4/4`。
- 目标限定在非 AI P4 审计与契约；AI runtime、AI 专用 UI、生产目录均未修改。
- 全量、core、治理权威、AI 边界、语法和差异门禁在文档与看板同步后重跑，并以
  `CURRENT_STATE.md` 的当前验证摘要为准。

结论：P4 的叶子投影和来源权限门已清楚、回收资料的只读/动作边界已锁定，但复合返回仍是
高耦合安全边界。S4 本轮完成“逐形状风险矩阵 + 迁移门禁契约”，不是运行时白名单迁移。

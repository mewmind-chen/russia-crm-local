# Issue #171 跟进记录更正实施计划

> **执行约束：** 本轮不使用或依赖任何 `superpowers:*` 技能。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 允许销售更正误填客户的跟进记录和已建立稳定链接的业务里程碑，同时保留不可变审计并原子重算两个客户。

**架构：** 原活动保留但标记为 superseded，创建关联的有效替代活动；所有业务读取使用 effective activity；来源和目标客户通过确定性重算函数在一个 IMMEDIATE 事务中更新。

**技术栈：** Node.js、SQLite、Express、原生前端、Node test。

## 全局约束

- 依赖 #172 和 #170 全部合并并验证。
- 计划基线为 `d0bdd104f924b736d8e653938c7899ede2272318`；执行时 fetch/rebase 当时最新 `origin/main`。
- 创建人权限与当前 owner 权限分开判断；目标客户搜索必须遵守 #172 保护和数据范围。
- 销售可直接更正本人创建的普通活动，以及能够通过稳定 activity link 或唯一确定 CRM 里程碑映射的简单 RFQ/quote/order；不得按时间或相似文本猜关联。无法确定映射、管理员锁定、他人记录或会产生不可自动判定阶段冲突时，进入 manager/admin 审批，不得统一拒绝或静默移动。
- 启用真实 correction 写入后，旧代码会重复计算原/替代记录；上线前必须确认回滚兼容或保留写开关关闭。
- `CRM_ACTIVITY_CORRECTIONS_ENABLED` 默认 `false`；首次部署完成有效历史读取和权限冒烟后再启用。
- 权限键固定为 `correct_own_activity`（admin/manager/sales 默认允许，但普通路径仍要求原记录创建人）和 `manage_activity_corrections`（admin/manager 默认允许，sales 默认拒绝）。manager 只处理授权客户范围，真实 admin 可处理全公司及归档创建人记录。
- 所有更正目标、审批队列和历史列表消费 #116 authorized filter schema；销售不得看到分配规则、分配原因、候选、排除原因或额度。
- AI hard/effective gate 关闭时，AI context、异常/辅导字段、来源、下钻和导出全部隐藏；有效活动和手工更正的非 AI 业务读取继续工作。

---

### Task 1：#171-A 有效活动、业务链接和状态重算

**文件：**

- 创建：`lib/crm_activity_effective.js`
- 创建：`lib/crm_account_rebuild.js`
- 修改：`lib/sales_crm.js: schema、addActivity/addQuote/addOrder、buildCustomerTimeline、buildAlerts、buildTeamReport、loadPayload`
- 修改：`lib/business_page_filters.js`
- 修改：`lib/ai_stations/context.js`
- 修改：`lib/ai_stations/manager_anomaly.js`
- 修改：`lib/ai_stations/sales_coaching.js`
- 创建：`test/issue171_effective_activity.test.js`
- 创建：`test/issue171_account_rebuild.test.js`

**接口：**

- `listEffectiveActivities(db,customerId) -> rows[]`。
- `rebuildAccountDerivedState(db,accountId,{now}) -> {stage,lastActivityAt,nextAction,nextActionAt,managerState}`。
- `linkCommerceActivity(db,{activityId,entityType,entityId}) -> link`。

- [ ] **步骤 1：写 effective reader 失败测试**

插入原活动、替代活动和关系；时间线返回两者和 provenance，但 alerts、today tasks、team stats、AI context、anomaly、coaching 只计算替代活动。

运行：`node --test test/issue171_effective_activity.test.js`。

预期：基线读全部活动，出现重复计算，测试失败。

- [ ] **步骤 2：写状态重算失败测试**

覆盖后期活动、回溯活动、terminal stage、#170 deferred/explicit plans、manager flags；排序固定为 `occurred_at,created_at,id`。相同输入重复重算结果完全一致。

- [ ] **步骤 3：写业务链接测试**

新 RFQ/quote/order 创建后必须有稳定 activity link；旧简单里程碑只有在稳定编号和唯一业务关系可确定映射时允许创建 link 并继续更正。缺少 link 且不能唯一映射时创建待审批 correction proposal，明确提示“需要主管或管理员确认”，不得按 timestamp 自动绑定。

- [ ] **步骤 4：实现 schema 和 reader**

为 `crm_activities` 增加 `superseded_at TEXT NOT NULL DEFAULT ''` 和 `superseded_by TEXT NOT NULL DEFAULT ''`；为 `crm_rfqs`、`crm_quotes`、`crm_orders` 分别增加 `activity_id TEXT NOT NULL DEFAULT ''` 并建立非唯一索引。所有 operational reader 使用 `listEffectiveActivities` 或统一条件 `superseded_at=''`。

- [ ] **步骤 5：实现确定性重算**

从有效 activity、#170 plan events、RFQ/quote/order 和 terminal events 重建快照；禁止通过减去原记录影响来“撤销”。函数不自行开启事务，供更正服务在外层事务中调用。

- [ ] **步骤 6：测试和 PR #171-A**

```bash
node --test test/issue171_effective_activity.test.js test/issue171_account_rebuild.test.js test/today_tasks_integration.test.js test/ai_next_action.test.js test/ai_sales_coaching.test.js test/customer_stage_disqualified.test.js
npm test -- --test-concurrency=1
git add lib/crm_activity_effective.js lib/crm_account_rebuild.js lib/sales_crm.js lib/business_page_filters.js lib/ai_stations/context.js lib/ai_stations/manager_anomaly.js lib/ai_stations/sales_coaching.js test/issue171_effective_activity.test.js test/issue171_account_rebuild.test.js
git commit -m "feat: rebuild CRM state from effective activity history"
git push -u origin codex/issue-171a-effective-activity
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-171a-effective-activity --title "feat: rebuild CRM state from effective activity history" --body "Refs #171. 建立有效活动读取、业务链接和确定性客户状态重算。"
```

---

### Task 2：#171-B 原子更正、权限、审计、通知和导出

**文件：**

- 创建：`lib/crm_activity_corrections.js`
- 修改：`lib/sales_crm.js: activityActionRequest、searchActivityCustomers、publicActivityRecord、exportCrmData/exportCrmCsv、route registration`
- 修改：`lib/access_control.js`
- 修改：`lib/crm_notifications.js`
- 修改：`scripts/dispatch-crm-notifications.js`
- 修改：`.env.example`
- 创建：`test/issue171_correction_authorization.test.js`
- 创建：`test/issue171_correction_transaction.test.js`
- 创建：`test/issue171_correction_export.test.js`

**接口：**

- `correctActivity(db,user,{originalActivityId,targetCustomerId,reason,idempotencyKey}) -> {correctionId,original,replacement}`。
- `proposeActivityCorrection(db,user,payload) -> {proposalId,status}`，`reviewActivityCorrection(db,user,{proposalId,decision,reason,expectedVersion}) -> result`。
- `searchCorrectionTargets(db,user,query) -> scoped rows`。
- `rebuildAccountDerivedState` 在同一事务中对来源和目标各调用一次。

- [ ] **步骤 1：写授权失败测试**

持有 `correct_own_activity` 的创建人可更正普通活动和可确定映射的简单里程碑；当前 owner 但非创建人不可走直接路径；持有 `manage_activity_corrections` 的 manager 可审批授权范围内的他人/锁定/不确定冲突，admin 可审批全公司及归档创建人；目标越权返回不枚举 403。已更正、同客户、空 reason 均拒绝，锁定或不确定阶段冲突进入审批而不是直接移动。

- [ ] **步骤 2：写事务故障注入测试**

分别在创建 replacement、写 correction、标记 original、重算来源、重算目标、写通知前注入异常；断言 correction 不存在、两个客户快照和所有活动均保持原值。

- [ ] **步骤 3：写幂等和并发测试**

同一 idempotency key 重试返回同一 correction/replacement；两个 SQLite 连接并发更正同一 original，只允许一个成功，另一个 409，不产生孤立 replacement。

- [ ] **步骤 4：实现不可变更正事务**

创建 `crm_activity_corrections`，对 original/replacement 加 UNIQUE；`BEGIN IMMEDIATE` 中复制有效字段、写 source/target stable IDs、actor、reason、timestamps，标记 original superseded，重算两个客户并写 audit；`.env.example` 增加 `CRM_ACTIVITY_CORRECTIONS_ENABLED=false`，路由在关闭时返回明确的 503 功能未启用错误。

- [ ] **步骤 5：实现 manager/admin 审批闭环**

审批页显示原客户、目标客户、原活动/里程碑、稳定映射证据、阶段冲突、创建人、当前 owner 和理由。批准时在同一更正事务中写 reviewer、decision、版本和审计；拒绝不改变两个客户业务状态。manager 受 row scope，admin 全量；重复审批返回同一结果或稳定 409。

- [ ] **步骤 6：实现权限安全通知、失败恢复和导出**

通知 relation 保存两个 stable IDs，但 recipient query 按 scope；本人更正或审批完成后通知对应主管和老板，按 correction/proposal/recipient/type 唯一去重。通知派发失败不得回滚已提交更正，进入可重试 outbox；重复派发不重复通知。JSON export 提升 schema version，CSV 增加 correction/original/replacement/proposal/reviewer IDs 和有效状态；无权 export 不出现目标客户或分配细节。

- [ ] **步骤 7：接入 authorized filter schema 并测试 PR #171-B**

目标搜索、审批列表、更正历史、计数、分页和导出使用同一授权筛选口径；权限撤销使旧 cursor/filter state 失效。增加 manager/admin 审批、通知去重、outbox 重试、admin 全量、AI-off 和销售分配原因脱敏测试。

```bash
node --test test/issue171_correction_authorization.test.js test/issue171_correction_transaction.test.js test/issue171_correction_export.test.js test/permission_integration.test.js
npm test -- --test-concurrency=1
git add lib/crm_activity_corrections.js lib/sales_crm.js lib/access_control.js lib/crm_notifications.js scripts/dispatch-crm-notifications.js .env.example test/issue171_correction_authorization.test.js test/issue171_correction_transaction.test.js test/issue171_correction_export.test.js
git commit -m "feat: correct misfiled CRM activity with audit"
git push -u origin codex/issue-171b-activity-correction
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-171b-activity-correction --title "feat: correct misfiled CRM activity with audit" --body "Refs #171. 依赖 #171-A，提供授权、原子更正、审计、通知和导出。"
```

---

### Task 3：#171-C 时间线和更正界面

**文件：**

- 修改：`sales-assets/app.js: timeline、customer picker/search、correction confirm`
- 修改：`sales-assets/app.css`
- 修改：`sales-crm.html`
- 创建：`test/issue171_correction_ui.test.js`

- [ ] **步骤 1：写 UI 失败测试**

原记录显示“已更正”及目标，不隐藏历史；replacement 显示来源；入口只对被授权创建人或 admin 显示；目标搜索遵守 scope；reason 必填；重复点击复用 idempotency key。

- [ ] **步骤 2：实现三步确认流程**

步骤为选择目标、填写理由、最终确认；确认页明确来源客户、目标客户、活动时间和业务影响。可确定映射的简单里程碑直接进入确认；不确定映射、锁定或阶段冲突提交主管/管理员审批，并保留当前输入和 proposal 状态。

- [ ] **步骤 3：实现错误与刷新行为**

403/409/500 保留 target、reason 和展开状态；成功后刷新来源和目标 profile、timeline、alerts、team metrics，浏览器刷新后保持一致。

- [ ] **步骤 4：桌面/移动端验证**

在 1280/430/390/375/320px 完成普通 activity、更正简单里程碑、提交审批、manager/admin 决策、重复请求和越权目标；确认无横向溢出、无双计数，审计可见。验证 authorized filters、AI-off 隐藏和销售分配原因脱敏。

- [ ] **步骤 5：测试、提交和 PR #171-C**

```bash
node --test test/issue171_correction_ui.test.js test/issue171_correction_authorization.test.js test/issue171_correction_transaction.test.js
npm test -- --test-concurrency=1
git add sales-assets/app.js sales-assets/app.css sales-crm.html test/issue171_correction_ui.test.js
git commit -m "feat: add audited activity correction workflow"
git push -u origin codex/issue-171c-correction-ui
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-171c-correction-ui --title "feat: add audited activity correction workflow" --body "Refs #171. 提供更正时间线、目标搜索、主管审批、通知恢复和响应式回归。"
```

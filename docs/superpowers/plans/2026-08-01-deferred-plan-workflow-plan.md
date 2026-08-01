# Issue #170 暂未确定计划与主管介入实施计划

> **执行约束：** 本轮不使用或依赖任何 `superpowers:*` 技能。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 支持“已有明确计划/暂未确定”真实状态、统一未来时间校验、可配置主管任务、升级、通知、统计和桌面/移动端闭环。

**架构：** 用不可变计划事件、主管任务和配置表表达新状态，兼容更新现有 account 快照；所有未来时间入口调用一个业务时区解析器；主管任务通过真实业务动作关闭。

**技术栈：** Node.js、SQLite、Express、原生前端、Node test。

## 全局约束

- 依赖 #172 全部合并并验证。
- 计划基线为 `d0bdd104f924b736d8e653938c7899ede2272318`；执行时 fetch/rebase 当时最新 `origin/main`。
- 历史缺少计划不追溯生成 deferred 事件。
- 同客户同原因只能有一个 open 主管任务。
- 暂停/流失/不对口停止普通跟进提醒；重新激活必须设置新阶段、真实计划和未来时间。
- 不提供无业务状态意义的“忽略”或“直接完成”。
- `CRM_DEFERRED_PLAN_WRITES_ENABLED` 默认 `false`；首次部署完成 schema、读取、权限和时区冒烟后再启用。
- 不建立销售分配组；管理提醒接收人选择具体 manager/admin 账号。真实 admin 作为老板视角读取全公司汇总和全部明细，仍受认证、审计、feature hard gate 和数据完整性约束。
- 所有主管任务、统计和下钻列表消费 #116 authorized filter schema；销售响应不得包含分配规则、分配原因、候选销售、排除原因或额度。
- AI hard/effective gate 关闭时，AI 建议入口、字段、来源、下钻和导出全部隐藏；手工计划与暂未确定流程继续可用。

---

### Task 1：#170-A 未来时间和计划事件

**文件：**

- 创建：`lib/deferred_plan.js`
- 修改：`lib/sales_crm.js: installSalesCrm、normalizeTodayTaskDate、addNextPlanTodayTask、addActivity、addQuote、addOrder、addAccount、updateAccount`
- 修改：`lib/ai_stations/next_action.js`
- 修改：`.env.example`
- 创建：`test/issue170_deferred_plan_state.test.js`
- 创建：`test/issue170_future_time_validation.test.js`

**接口：**

- `parseBusinessDateTime(input,{now,timezone}) -> utcText`。
- `recordDeferredPlan(db,{customerId,actorId,ownerIdSnapshot,reviewAt,reason,source}) -> event`。
- `recordExplicitPlan(db,{customerId,actorId,nextAction,nextAt,source}) -> event`。

- [ ] **步骤 1：写所有时间入口失败测试**

覆盖七类入口：今日待办补计划、记录新进展、新增客户、编辑客户、采纳 AI 建议、报价后跟进和订单后经营动作；过去时间和等于当前时间均返回 400、“下一步时间必须晚于当前时间”；历史 `occurredAt` 可按权限补录。AI gate 关闭时采纳入口和数据不得出现，直接调用也不得绕过 hard gate。

运行：`node --test test/issue170_future_time_validation.test.js`。

预期：基线允许过去时间，测试失败。

- [ ] **步骤 2：写状态链失败测试**

暂未确定必须有 reviewAt；明确计划结束当前连续链但不删除累计历史；更换 owner 不删除客户历史，个人统计归属实际 actor；终止阶段不再产生普通提醒，重新激活缺计划时拒绝。

- [ ] **步骤 3：实现业务时区解析器**

增加明确环境变量 `CRM_BUSINESS_TIMEZONE=Asia/Shanghai` 和 `CRM_DEFERRED_PLAN_WRITES_ENABLED=false`；解析 browser `datetime-local` 时按业务时区转换，严格比较 `now`，统一返回简体中文错误。各入口删除各自的“只校验格式”逻辑并调用同一函数。

- [ ] **步骤 4：创建事件表并兼容快照**

创建 `crm_deferred_plan_events` 和 `crm_next_plan_events`，保存稳定客户编号、actor、owner snapshot、时间、review/next time、说明和来源。继续更新 `crm_accounts.next_action/next_action_at` 供旧页面读取。

- [ ] **步骤 5：接入终止和重新激活规则**

复用 `lib/customer_stages.js` 的 terminal semantics；正式选择 terminal stage 清空快照并停止普通提醒，自由文本写“暂停”不改变阶段；reactivation 缺 stage/plan/future time 返回 400。

- [ ] **步骤 6：测试和 PR #170-A**

```bash
node --test test/issue170_deferred_plan_state.test.js test/issue170_future_time_validation.test.js test/customer_stage_disqualified.test.js test/ai_next_action.test.js
npm test -- --test-concurrency=1
git add lib/deferred_plan.js lib/sales_crm.js lib/ai_stations/next_action.js .env.example test/issue170_deferred_plan_state.test.js test/issue170_future_time_validation.test.js
git commit -m "feat: model deferred plans and future actions"
git push -u origin codex/issue-170a-deferred-plan-state
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-170a-deferred-plan-state --title "feat: model deferred plans and future actions" --body "Refs #170. 建立暂未确定事件和全部计划入口的服务端未来时间校验。"
```

---

### Task 2：#170-B 主管任务、配置、通知和统计

**文件：**

- 创建：`lib/manager_tasks.js`
- 修改：`lib/sales_crm.js: buildAlerts、buildTeamReport、bootstrap/settings/routes`
- 修改：`lib/access_control.js`
- 修改：`lib/crm_notifications.js`
- 修改：`lib/business_page_filters.js`
- 创建：`test/issue170_manager_tasks.test.js`
- 创建：`test/issue170_manager_metrics.test.js`
- 创建：`test/issue170_manager_permissions.test.js`

**接口：**

- `evaluateManagerTriggers(db,customerId,now) -> reasons[]`。
- `upsertManagerTask(db,{customerId,reason,triggeredAt}) -> task`。
- `resolveManagerTask(db,user,taskId,action) -> result`。
- `buildSalesMetrics(db,scope,range) -> {counts,ratios,sampleSize,unavailable}`。
- 权限键固定为 `manage_manager_task_settings`（仅 admin 默认允许）和 `resolve_manager_tasks`（admin/manager 默认允许，sales 默认拒绝）。

- [ ] **步骤 1：写阈值和去重失败测试**

建议默认：连续暂未确定 N=3、首次触达无二次动作 D=14 天、计划超时 G=48 小时、最低活跃客户 M=10、最低异常客户 K=3、比例 R=30%。每项可启用/停用和修改；同客户同原因重复扫描只有一个 open task。

- [ ] **步骤 2：写角色权限失败测试**

销售只处理本人客户；主管只处理授权范围；老板默认读取汇总、长期未解决和主动升级；接收人必须同时具备管理权限和客户范围；销售不能读取他人明细。设置路由要求 `manage_manager_task_settings`，主管任务处理路由要求 `resolve_manager_tasks`。

- [ ] **步骤 3：创建配置、任务、介入表**

创建 `crm_manager_task_settings`、`crm_manager_task_settings_audit`、`crm_manager_tasks`、`crm_manager_interventions`；任务包含 stable customer ID、owner/actor snapshot、reason、evidence、due time、completion condition、status、result、timestamps、settings version 和判断时间，唯一约束覆盖 open customer/reason。每次修改开关、阈值或接收人都写旧值、新值、actor 和时间。设置新版本只作用于修改后的新判断，不追溯改写、关闭或重新归类已有任务；已有任务保留触发时版本和阈值快照。

- [ ] **步骤 4：实现真实完结动作**

允许：共同形成计划、暂停/流失、重新分配、记录主管建议并指定后续动作、升级老板。每个动作调用既有领域服务并在同一事务中关闭对应 reason；没有状态变化时不得关闭。

- [ ] **步骤 5：实现通知和统计**

通知去重并按 recipient scope 发送；销售通知不含分配规则、原因、候选或额度。统计明确支持近 30 天和 90 天，并同时显示原始数量、比例、样本数、延期后形成计划率、计划后按时有效动作率、首次触达后沉默数、介入后仍未改善数。客户维度返回当前连续次数、历史累计次数、未形成明确计划的持续天数、每次 deferred 的 actor/owner snapshot/review time/source、达到阈值时间；销售维度按实际 actor 归属并支持逐条下钻。结果只标记“需要主管复盘”。

- [ ] **步骤 6：接入授权筛选和逐条下钻**

主管任务、客户风险、销售 30/90 天统计和通知列表均从 authorized filter schema 解析可用字段，服务端在聚合前执行 row scope；列表、计数、分页、下钻和导出使用同一查询。admin 不受 filter allowlist 或团队行级范围限制；销售只能下钻本人及本人客户，不能从统计推断他人数据。

- [ ] **步骤 7：测试和 PR #170-B**

```bash
node --test test/issue170_manager_tasks.test.js test/issue170_manager_metrics.test.js test/issue170_manager_permissions.test.js test/today_tasks_integration.test.js
npm test -- --test-concurrency=1
git add lib/manager_tasks.js lib/sales_crm.js lib/access_control.js lib/crm_notifications.js lib/business_page_filters.js test/issue170_manager_tasks.test.js test/issue170_manager_metrics.test.js test/issue170_manager_permissions.test.js
git commit -m "feat: add configurable manager intervention tasks"
git push -u origin codex/issue-170b-manager-intervention
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-170b-manager-intervention --title "feat: add configurable manager intervention tasks" --body "Refs #170. 依赖 #170-A，提供阈值、主管任务、通知、统计和权限闭环。"
```

---

### Task 3：#170-C 桌面与移动端流程

**文件：**

- 修改：`sales-assets/app.js`
- 修改：`sales-assets/app.css`
- 修改：`sales-crm.html`
- 创建：`test/issue170_deferred_plan_ui.test.js`

- [ ] **步骤 1：写 UI 失败测试**

缺少计划弹窗必须有“已有明确计划/暂未确定” segmented control；暂未确定显示必填复查时间和选填卡点；所有 `datetime-local` 使用统一 min/validation；主管 task 显示依据、期限、建议动作和完结条件；管理员设置显示三条客户触发规则、最低样本 M/K/R、启停开关和接收人；统计可切换 30/90 天并下钻客户连续/累计记录、持续天数、阈值时间和逐条历史。

- [ ] **步骤 2：实现统一未来时间输入**

新增 `setFutureDateTimeConstraint(input,now)`、`validateFutureDateTime(input)`，七类未来计划入口全部调用。前端只提供即时反馈，服务端 Task 1 兜底。

- [ ] **步骤 3：实现两条销售路径**

明确计划提交 next plan event；暂未确定提交 deferred event；成功后刷新客户快照、待办、计数和通知。失败时保留当前 tab、说明和时间。

- [ ] **步骤 4：实现主管处理 UI**

展示客户、销售、触发依据、时间线、期限和完结条件；按钮只对应真实领域动作。升级老板必须填写难点，记录辅导支持关联销售和可选客户。

- [ ] **步骤 5：实现管理员提醒规则 UI**

在用户与权限/系统设置中增加紧凑规则区：连续暂未确定 N、首次触达 D 天无第二次动作、计划超时 G 小时、最低样本 M/K/R、各自启停和一个或多个接收人。保存调用设置路由，显示版本冲突和审计时间；非 admin 不渲染且直接 API 返回 403。

- [ ] **步骤 6：浏览器与失败恢复测试**

在桌面和 320/375/390/430px 完成两种销售路径、30/90 天统计下钻和所有主管动作；模拟 400/403/500 确认输入保留；终止阶段客户不再显示普通待办。分别验证 sales/manager/admin filter schema、admin 全量范围、AI-off 隐藏和销售分配原因脱敏。

- [ ] **步骤 7：测试、提交和 PR #170-C**

```bash
node --test test/issue170_deferred_plan_ui.test.js test/issue168_today_task_mobile.test.js test/issue157_today_task_ui.test.js
npm test -- --test-concurrency=1
git add sales-assets/app.js sales-assets/app.css sales-crm.html test/issue170_deferred_plan_ui.test.js
git commit -m "feat: add truthful deferred-plan workflow UI"
git push -u origin codex/issue-170c-deferred-plan-ui
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-170c-deferred-plan-ui --title "feat: add truthful deferred-plan workflow UI" --body "Refs #170. 覆盖暂未确定、未来时间、主管任务、统计下钻和桌面/移动端闭环。"
```

# TradePulse 前端渐进式模块化重构实施计划

> **供执行代理使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项执行。所有行为变更使用 `superpowers:test-driven-development`，每次提交和完成声明前使用 `superpowers:verification-before-completion`。复选框用于跟踪进度。

**目标：** 把单体 CRM 前端改造成按角色组织的模块化前端，完整保留所有已发布功能，并把 AI 呈现为“有证据、需人工确认”的业务决策流程。

**架构：** 保留 Node.js、Express、SQLite、现有 API、权限、审计、幂等、AI Router、Worker 和业务规则。在 `sales-assets/` 下增加浏览器原生 ES Modules；迁移期通过 `CRM_UX_REDESIGN_ENABLED` 保留同一 release 内的新旧外壳切换；按业务流程逐步迁入共享 core、service 和 component。

**技术栈：** Node.js 18+、CommonJS 服务端、Express 4、better-sqlite3/WAL、浏览器原生 ES Modules、HTML/CSS、Node test runner、Playwright。

**已批准设计：** `docs/superpowers/specs/2026-07-25-frontend-modular-refactor-design.md`

**实施基线：** `origin/main @ 79800f529d1d98e8a936959d88cbbbebce6f559f`

## 全局约束

- 保留最新 `origin/main`、生产已启用功能、深链、API、权限、feature flag、Worker、报表和维护入口的并集。
- 不引入 React、Vue、前端打包器或第二套业务数据模型。
- 不替换服务端权限、行级范围、幂等、审计、AI Router、预算或降级规则。
- 关键写入不做乐观更新，只在服务端成功后更新界面。
- 每个页面模块必须实现 `load(context)`、`render(context)`、`dispose(context)`。
- 路由离开时必须释放请求、定时器、订阅和临时监听器。
- AI“生成”不得暗中改变客户状态、负责人、阶段、活动或外发消息。
- AI 治理仅管理员可用；经理只保留授权范围内的结果复核和故障查看。
- 历史 AI 任务缺少权威来源时标为 `legacy_unknown`，前端不得猜测。
- 销售辅导沿用现有门槛：`<10` 样本不足，`10-29` 有限样本，`>=30` 样本充分。
- 发布门视口为 `1440`、`1280` 和 `390` 像素。
- `CRM_UX_REDESIGN_ENABLED` 只切换外壳，不改变业务功能。
- 每个任务形成一个可独立评审的提交；聚焦测试未通过不得进入下一任务。
- 执行时使用 `superpowers:using-git-worktrees` 创建隔离 worktree，并保留任何无关用户修改。
- Task 14 前不得部署生产。

## 目标文件结构

```text
sales-assets/
├── package.json
├── app.js
├── modular-app.js
├── app.css
├── core/
│   ├── api.js
│   ├── state.js
│   ├── router.js
│   ├── access.js
│   ├── registry.js
│   ├── preferences.js
│   └── lifecycle.js
├── components/
│   ├── html.js
│   ├── modal.js
│   ├── drawer.js
│   ├── table.js
│   ├── empty-state.js
│   ├── status.js
│   ├── shell.js
│   └── ai-result.js
├── services/
│   ├── session.js
│   ├── customers.js
│   ├── intake.js
│   ├── activities.js
│   ├── intelligence.js
│   ├── ai.js
│   └── administration.js
└── modules/
    ├── my-today/
    ├── customers/
    ├── intake/
    ├── customer-detail/
    ├── team-dashboard/
    ├── team-tasks/
    ├── team-insights/
    ├── intelligence/
    ├── assistant/
    ├── ai-control/
    └── administration/
```

服务端新增文件仅包括 `lib/frontend_shell.js` 和 `lib/ai_stations/presentation.js`；其他修改进入现有 `server.js`、`lib/sales_crm.js`、`lib/access_control.js`、AI schema/jobs/routes。

---

## Task 1：冻结全功能等价基线

**文件：**
- 新建：`docs/refactor/frontend-capability-manifest.json`
- 新建：`scripts/audit-frontend-parity.js`
- 新建：`test/frontend_parity_manifest.test.js`
- 修改：`package.json`

**接口：**
- `loadManifest(path)`
- `auditManifest({ manifest, html, appSource, routePolicies })`
- `node scripts/audit-frontend-parity.js [--json]`

- [ ] **步骤 1：编写失败测试**

每项能力必须记录 `id`、类别、旧路由、新模块、角色、权限、feature flag、API policy、测试和迁移状态。测试必须发现未映射的 `data-view`、`SALES_ROUTE_POLICIES` 和设计第 3 章功能类别。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_parity_manifest.test.js
```

预期：因 manifest 和审计脚本不存在而失败。

- [ ] **步骤 3：实现**

清单覆盖身份、权限、首页、通知、线索、客户、跟进、商务、情报、助手、8 个 AI 能力、补全、任务中心、治理、维护、报表、health、部署和 Worker。新增：

```json
"frontend:parity": "node scripts/audit-frontend-parity.js"
```

- [ ] **步骤 4：确认 GREEN**

```bash
npm run frontend:parity
node --test test/frontend_parity_manifest.test.js test/access_control.test.js test/sales_menu.test.js
```

预期：未映射页面、policy 和能力均为 0。

- [ ] **步骤 5：提交**

```bash
git add docs/refactor/frontend-capability-manifest.json scripts/audit-frontend-parity.js test/frontend_parity_manifest.test.js package.json
git commit -m "test(frontend): freeze capability parity baseline"
```

## Task 2：建立浏览器核心运行时

**文件：**
- 新建：`sales-assets/package.json`
- 新建：`sales-assets/core/api.js`
- 新建：`sales-assets/core/state.js`
- 新建：`sales-assets/core/lifecycle.js`
- 修改：`sales-assets/app.js`、`sales-crm.html`
- 新建：`test/frontend_core_modules.test.js`

**接口：**
- `createApiClient({ fetchImpl, defaultTimeoutMs, onUnauthorized })`
- `createStore(initialState)`
- `createLifecycleScope()`

- [ ] **步骤 1：编写失败测试**

覆盖 JSON 请求、401 回调、超时中止、结构化 `HttpError`、状态分区通知、取消订阅、清理定时器/请求/监听器和重复 `dispose()`。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_core_modules.test.js
```

- [ ] **步骤 3：实现**

创建 `sales-assets/package.json`：

```json
{ "type": "module" }
```

把现有脚本改为 `type="module"`，先只替换 fetch/timeout 和顶层生命周期，不迁移业务渲染器。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_core_modules.test.js test/sales_menu.test.js test/ai_station_ui.test.js test/sales_access_ui.test.js
node --check sales-assets/app.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/package.json sales-assets/core sales-assets/app.js sales-crm.html test/frontend_core_modules.test.js
git commit -m "refactor(frontend): add shared browser runtime"
```

## Task 3：统一路由、角色、权限和旧别名

**文件：**
- 新建：`sales-assets/core/access.js`、`registry.js`、`router.js`
- 修改：`sales-assets/app.js`
- 新建：`test/frontend_router_registry.test.js`

**接口：**
- `PAGE_REGISTRY`
- `LEGACY_ROUTE_ALIASES`
- `visiblePages({ role, permissions, featureFlags, impersonating })`
- `createRouter(...)`
- `resolveRoute(url)`

- [ ] **步骤 1：编写失败测试**

销售默认 `my-today`；经理/管理员默认 `team-dashboard`。覆盖销售 4 个、经理 6 个一级入口，以及 `pending`、`claimed`、`pipeline`、`team`、`insights`、`markets`、`pool`、`contacts`、`recon`、`customerProfile` 旧路由。验证客户 ID、刷新、前进后退、未知路由和无权限回退。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_router_registry.test.js
```

- [ ] **步骤 3：实现**

注册项固定包含 `id/routes/roles/permissions/featureFlags/nav/module`。权限默认 all-of；路由器独占 `hashchange` 和 `popstate`。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_router_registry.test.js test/sales_menu.test.js test/sales_access_ui.test.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/core/access.js sales-assets/core/registry.js sales-assets/core/router.js sales-assets/app.js test/frontend_router_registry.test.js
git commit -m "refactor(frontend): centralize routes and access"
```

## Task 4：抽取 service 并按页面加载数据

**文件：**
- 新建：`sales-assets/services/*.js`
- 修改：`lib/sales_crm.js`、`sales-assets/app.js`
- 新建：`test/frontend_services.test.js`、`test/frontend_scoped_bootstrap.test.js`

**接口：**
- `createSessionService`、`createCustomerService`、`createIntakeService`
- `createActivityService`、`createIntelligenceService`
- `createAIService`、`createAdministrationService`
- `GET /api/sales-crm/bootstrap?sections=<allowlist>`

- [ ] **步骤 1：编写失败测试**

逐项锁定现有登录、客户、线索、活动、RFQ、报价、订单、通知、情报、AI、用户、权限和维护请求。无 `sections` 保持完整旧 payload；允许 `core/today/customers/intake/team/intelligence/administration`；未知 section 返回 400；新外壳不得请求完整 payload。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_services.test.js test/frontend_scoped_bootstrap.test.js
```

- [ ] **步骤 3：实现**

service 只封装 URL、method 和 body，不复制权限或业务规则。把 bootstrap 拆成真实 section 查询，禁止先构建完整 payload 再删字段；旧外壳无参数调用保持不变。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_services.test.js test/frontend_scoped_bootstrap.test.js test/permission_integration.test.js test/ai_station_api.test.js test/ai_customer_enrichment_api.test.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/services lib/sales_crm.js sales-assets/app.js test/frontend_services.test.js test/frontend_scoped_bootstrap.test.js
git commit -m "refactor(frontend): extract API services"
```

## Task 5：共享组件和可回滚新外壳

**文件：**
- 新建：`lib/frontend_shell.js`
- 修改：`server.js`
- 新建：`sales-crm-next.html`、`sales-assets/modular-app.js`
- 新建：`sales-assets/components/*.js`
- 修改：`sales-assets/app.css`
- 新建：`test/frontend_shell.test.js`、`test/frontend_components.test.js`

**接口：**
- `resolveFrontendShell(env)`
- `createModal`、`createDrawer`
- `renderTable`、`renderEmptyState`、`renderStatus`、`renderShell`

- [ ] **步骤 1：编写失败测试**

flag 缺失/错误/false 必须选择旧外壳，`1/true` 选择新外壳。验证两套外壳共用 API/service；弹层焦点、Esc、焦点恢复；表格滚动和表头；动态文本转义；导航仅来自 `visiblePages()`。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_shell.test.js test/frontend_components.test.js
```

- [ ] **步骤 3：实现**

根路由只根据 resolver 选择 HTML。新 HTML 仅保留登录、应用挂载点、modal/drawer/toast portal；`modular-app.js` 只装配 core/service/registry/router/lifecycle/shell。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_shell.test.js test/frontend_components.test.js test/sales_menu.test.js
```

- [ ] **步骤 5：提交**

```bash
git add lib/frontend_shell.js server.js sales-crm-next.html sales-assets/modular-app.js sales-assets/components sales-assets/app.css test/frontend_shell.test.js test/frontend_components.test.js
git commit -m "feat(frontend): add reversible modular shell"
```

## Task 6：角色首页、导航和布局偏好

**文件：**
- 新建：`modules/my-today`、`team-dashboard`、`team-tasks`
- 新建：`core/preferences.js`
- 修改：`registry.js`、`shell.js`、`app.css`
- 新建：`test/frontend_role_homes.test.js`、`test/frontend_layout_preferences.test.js`

**接口：**
- 每个模块导出 `id/load/render/dispose`
- `loadLayoutPreference`、`saveLayoutPreference`、`sanitizeLayoutPreference`

- [ ] **步骤 1：编写失败测试**

验证销售“我的今日”、经理驾驶舱和今日待办；未采纳 AI 建议不算正式待办；销售 DOM 不含团队、治理、维护和任务中心；离开路由释放轮询。偏好只能设置默认页、顺序和折叠组，不能恢复无权限/flag 关闭页面或彻底隐藏能力。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_role_homes.test.js test/frontend_layout_preferences.test.js
```

- [ ] **步骤 3：实现**

偏好键使用 `tradepulse:layout:<userId>`，读取后必须经过 `visiblePages()` 清洗。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_role_homes.test.js test/frontend_layout_preferences.test.js test/a4_04_stage_gate.test.js test/ai_manager_anomaly.test.js test/a3_04_notifications_claims.test.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/modules/my-today sales-assets/modules/team-dashboard sales-assets/modules/team-tasks sales-assets/core/preferences.js sales-assets/core/registry.js sales-assets/components/shell.js sales-assets/app.css test/frontend_role_homes.test.js test/frontend_layout_preferences.test.js
git commit -m "feat(frontend): add role-based workspaces"
```

## Task 7：迁移线索、客户、管道和销售写入

**文件：**
- 新建：`modules/intake/index.js`、`modules/customers/index.js`
- 修改：相关 service、`app.css`
- 新建：`test/frontend_customer_workflows.test.js`

- [ ] **步骤 1：编写失败测试**

覆盖线索状态/搜索/分页/批量分配/领取/退回/不对口/幂等；客户筛选/导出/阶段管道/回收/恢复/重分配；RFQ/报价/订单的币种、毛利、报价绑定和幂等。409 必须刷新权威数据。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_customer_workflows.test.js
```

- [ ] **步骤 3：实现**

固定写入流：`服务端成功 -> domain store -> counter invalidation -> 局部渲染`。不得在浏览器重写资格、阶段、商务或回收规则。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_customer_workflows.test.js test/sales_crm.test.js test/a3_04_notifications_claims.test.js test/a3_05_rfq_order_boundary.test.js test/ai_assignment_arbitration.test.js test/customer_recycle_bin.test.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/modules/intake sales-assets/modules/customers sales-assets/services/intake.js sales-assets/services/customers.js sales-assets/services/activities.js sales-assets/app.css test/frontend_customer_workflows.test.js
git commit -m "feat(frontend): migrate customer flow modules"
```

## Task 8：统一客户详情并退出 iframe

**文件：**
- 新建：`modules/customer-detail/index.js`、`tabs.js`
- 修改：registry、customers/intelligence/ai service、CSS
- 新建：`test/frontend_customer_detail.test.js`
- 修改：`test/sales_menu.test.js`

- [ ] **步骤 1：编写失败测试**

验证旧深链、页面/抽屉复用、概览/时间线/商务/情报/评价/标签/AI 七个 tab、联系人脱敏、完整时间线、返回来源路由以及新外壳无 `customerProfileFrame`。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_customer_detail.test.js test/sales_menu.test.js
```

- [ ] **步骤 3：实现**

旧外壳保留 iframe；新外壳只加载当前 tab 可选数据，切换客户时中止旧请求，页面/抽屉共用动作分发器，并显示 403/404/stale/retry。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_customer_detail.test.js test/sales_menu.test.js test/permission_integration.test.js test/ai_customer_enrichment_ui.test.js test/a3_06_sales_execution_gate.test.js
npm run frontend:parity
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/modules/customer-detail sales-assets/core/registry.js sales-assets/services/customers.js sales-assets/services/intelligence.js sales-assets/services/ai.js sales-assets/app.css test/frontend_customer_detail.test.js test/sales_menu.test.js docs/refactor/frontend-capability-manifest.json
git commit -m "feat(frontend): unify customer detail"
```

## Task 9：迁移团队、情报、助手和管理

**文件：**
- 新建：`modules/team-insights`、`intelligence`、`assistant`、`administration`
- 修改：相关 service、registry、CSS
- 新建：`test/frontend_management_modules.test.js`

- [ ] **步骤 1：编写失败测试**

验证团队/情报行级范围、销售无管理 DOM、助手历史和显式 scope、用户/权限/模拟身份/维护/报表完整可达，以及 loading/empty/error/403/pagination 状态。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_management_modules.test.js
```

- [ ] **步骤 3：实现**

确定性团队指标必须排在 AI 辅导前；助手标题和请求都显示 scope；系统管理不并入经理日常导航。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_management_modules.test.js test/assistant_conversations.test.js test/assistant_session_routing.test.js test/permission_group_api.test.js test/impersonation_authorization.test.js test/data_maintenance.test.js test/report_files.test.js
```

- [ ] **步骤 5：提交**

```bash
git add sales-assets/modules/team-insights sales-assets/modules/intelligence sales-assets/modules/assistant sales-assets/modules/administration sales-assets/services/intelligence.js sales-assets/services/administration.js sales-assets/core/registry.js sales-assets/app.css test/frontend_management_modules.test.js
git commit -m "feat(frontend): migrate management workspaces"
```

## Task 10：强制记录 AI 触发来源

**文件：**
- 修改：`lib/ai_stations/schema.js`、`jobs.js`、`task_center.js`、所有入队点
- 新建：`test/ai_trigger_provenance.test.js`
- 修改：`test/ai_station_jobs.test.js`

**接口：**

```js
trigger: {
  source, eventType, eventId, actorId, workflowId, reason, triggeredAt
}
```

- [ ] **步骤 1：编写失败测试**

历史行迁移为 `legacy_unknown`；新任务缺 trigger 拒绝；`business_event` 必须有事件；`workflow` 必须有 workflow ID；手动、业务事件和补全子任务可追溯；`created_by` 不能冒充来源。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js
```

- [ ] **步骤 3：实现**

新增 `trigger_source/trigger_actor_id/trigger_reason/triggered_at`，复用现有 `event_type/event_id/workflow_id/created_by`，同一提交更新全部入队点，禁止新生产任务成为 `legacy_unknown`。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js test/ai_sales_pack.test.js test/ai_action_proposal.test.js test/ai_next_action.test.js test/ai_manager_anomaly.test.js test/ai_sales_coaching.test.js test/ai_customer_enrichment_workflow.test.js
```

- [ ] **步骤 5：提交**

```bash
git add lib/ai_stations/schema.js lib/ai_stations/jobs.js lib/ai_stations/task_center.js lib/ai_stations/routes.js lib/ai_stations/sales_pack.js lib/ai_stations/action_proposal.js lib/ai_stations/next_action.js lib/ai_stations/contact_readiness.js lib/ai_stations/manager_anomaly.js lib/ai_stations/sales_coaching.js lib/ai_stations/enrichment/workflow.js lib/ai_stations/enrichment/events.js test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js
git commit -m "feat(ai): record authoritative trigger provenance"
```

## Task 11：把 AI 呈现为事实、推断、决定和动作

**文件：**
- 新建：`lib/ai_stations/presentation.js`、`components/ai-result.js`
- 修改：AI routes/task_center/service 和相关业务模块
- 新建：`test/ai_business_presentation.test.js`、`test/ai_business_experience_ui.test.js`

**接口：**
- `presentAIResult({ job, result, evidence, coverage, permissions })`
- `renderAIResult(viewModel, actions)`

- [ ] **步骤 1：编写失败测试**

覆盖 8 个能力、活动提案和补全；区分事实/规则/推断/人工决定/系统动作；置信度与覆盖率分离；零分母显示“暂无样本”；样本不足不调用模型；受限证据不泄露；fit 不改状态、pack 不发送、异常来自规则、stale 不可采纳。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js
```

- [ ] **步骤 3：实现**

业务名称、副作用和允许动作由服务端定义，前端只渲染。AI 只进入客户详情、线索分配、我的今日、经理待办和团队洞察，不新增“AI 工作站”页面。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js test/ai_sales_pack.test.js test/ai_next_action.test.js test/ai_manager_anomaly.test.js test/ai_sales_coaching.test.js test/ai_customer_enrichment_e2e.test.js
```

- [ ] **步骤 5：提交**

```bash
git add lib/ai_stations/presentation.js lib/ai_stations/routes.js lib/ai_stations/task_center.js sales-assets/components/ai-result.js sales-assets/services/ai.js sales-assets/modules/customer-detail/index.js sales-assets/modules/my-today/index.js sales-assets/modules/intake/index.js sales-assets/modules/team-tasks/index.js sales-assets/modules/team-insights/index.js test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js
git commit -m "feat(ai): clarify evidence and human decisions"
```

## Task 12：按角色收紧 AI 操作

**文件：**
- 修改：`lib/access_control.js`、AI routes、registry/service
- 新建：`modules/ai-control/index.js`
- 修改：相关权限和 UI 测试

- [ ] **步骤 1：编写失败测试**

销售不能访问任务列表/详情；经理凭 `review_ai_tasks` 只看授权任务；经理不能访问治理、策略、模型、runtime 和 flags；管理员拥有全局审计和治理；模拟身份继续阻断敏感写入。

- [ ] **步骤 2：确认 RED**

```bash
node --test test/frontend_ai_roles.test.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js
```

- [ ] **步骤 3：实现**

治理全部使用 `realAdminOnly: true`；任务列表/详情要求 `review_ai_tasks` 并保留行级过滤。管理员系统组包含 AI 运行审计、治理、预算、runtime 和 flags。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_ai_roles.test.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js test/impersonation_authorization.test.js test/a4_04_stage_gate.test.js
```

- [ ] **步骤 5：提交**

```bash
git add lib/access_control.js lib/ai_stations/routes.js sales-assets/modules/ai-control sales-assets/modules/administration sales-assets/core/registry.js sales-assets/services/ai.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js test/frontend_ai_roles.test.js
git commit -m "fix(ai): restrict governance to administrators"
```

## Task 13：响应式、可访问性和浏览器门

**文件：**
- 修改：`package.json`、`package-lock.json`、CSS 和共享组件
- 新建：`playwright.config.js`、`test/e2e/*`、`test/frontend_accessibility.test.js`

- [ ] **步骤 1：安装 Playwright 并编写失败测试**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

测试三角色、`1440x900/1280x800/390x844`、登录、导航、深链、前进后退、筛选分页、详情 tab、授权/拒绝写入、AI disabled/failed/stale/insufficient/review/adopt、键盘、焦点和控制台错误。

- [ ] **步骤 2：确认 RED**

```bash
npm run test:browser
```

- [ ] **步骤 3：实现**

390px 页面级无横向溢出；仅表格容器可横滚；移动详情全页；弹层操作区可见；无嵌套卡片；图标按钮有名称和 tooltip；dialog/tab/menu/status 语义正确；隐藏内容不保留焦点。

- [ ] **步骤 4：确认 GREEN**

```bash
node --test test/frontend_accessibility.test.js
npm run test:browser
```

保存桌面/移动截图，禁止重叠、裁切、空白和页面级溢出。

- [ ] **步骤 5：提交**

```bash
git add package.json package-lock.json playwright.config.js test/e2e test/frontend_accessibility.test.js sales-assets/app.css sales-assets/components/modal.js sales-assets/components/drawer.js sales-assets/components/shell.js
git commit -m "test(frontend): add responsive browser gates"
```

## Task 14：证明全功能等价、切换并退役旧外壳

**文件：**
- 修改：能力清单、server、HTML、app、部署测试
- 新建：`docs/evidence/frontend-modular-refactor-stage-gate.md`
- 删除：`sales-crm-next.html`、临时 `modular-app.js`、稳定观察期后的旧渲染器和 `lib/frontend_shell.js`

- [ ] **步骤 1：编写失败完成门**

要求所有清单项为 `verified`；旧路由均有别名或批准退役；全部模块有 `id/load/render/dispose`；新外壳不引用 iframe/旧渲染器；最终根路由不再读取临时 flag。

- [ ] **步骤 2：确认 RED**

```bash
npm run frontend:parity
node --test test/frontend_parity_manifest.test.js test/frontend_shell.test.js test/deploy_contract.test.js
```

- [ ] **步骤 3：切换前完整验证**

```bash
node --check server.js
find sales-assets -name '*.js' -print0 | xargs -0 -n1 node --check
npm run frontend:parity
npm test
npm run test:browser
git diff --check
```

- [ ] **步骤 4：带旧外壳部署**

先以 `CRM_UX_REDESIGN_ENABLED=false` 部署不可变 release：

```bash
sqlite3 -readonly /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db "PRAGMA quick_check;"
curl -fsS http://127.0.0.1:7100/health
```

旧外壳三角色 smoke 通过后开启新外壳，重复 local/public health、三角色、导航、390px、关键写入、AI 来源/覆盖和控制台检查。失败立即关闭 flag，不自动恢复数据库。

- [ ] **步骤 5：稳定观察后退役**

把模块化 HTML/app 设为正式入口，删除旧外壳和 flag，更新静态版本，重跑完整矩阵，将 `ux-preview` 标为只读历史参考。

- [ ] **步骤 6：确认最终 GREEN**

```bash
npm run frontend:parity
npm test
npm run test:browser
git diff --check
```

- [ ] **步骤 7：提交**

```bash
git add -A docs/refactor/frontend-capability-manifest.json docs/evidence/frontend-modular-refactor-stage-gate.md server.js lib/frontend_shell.js sales-crm.html sales-crm-next.html sales-assets/app.js sales-assets/modular-app.js test/frontend_parity_manifest.test.js test/frontend_shell.test.js test/deploy_contract.test.js
git commit -m "feat(frontend): complete modular shell cutover"
```

## 设计覆盖检查

| 已批准要求 | 对应任务 |
|---|---|
| 零功能遗漏和生产功能并集 | 1、14 |
| 原生 JavaScript 模块化 | 2-5 |
| 角色、权限、flag、别名和默认页 | 3、6 |
| 全局 bootstrap 与页面按需加载 | 4 |
| 共享状态/service/lifecycle/悲观写入 | 2、4、7 |
| 三角色信息架构 | 3、6、9、12 |
| 统一客户详情和 iframe 退役 | 8 |
| 客户、线索、商务、情报、报表、管理 | 7-9 |
| AI 事实/规则/推断/决定/动作 | 11 |
| AI 触发来源和历史缺失状态 | 10 |
| 覆盖率、样本门槛、stale、零分母 | 11 |
| 禁止自动发送和隐式写入 | 10、11 |
| 技术任务中心与管理员治理 | 12 |
| 用户布局偏好 | 6 |
| 错误、空、加载、403、重试状态 | 5-9、11 |
| 移动端、可访问性、浏览器验证 | 13 |
| 同 release 回滚、生产 smoke、旧外壳退役 | 5、14 |

自检结果：已批准设计的每一章都有实施任务，不存在延期要求或未定义接口。

## 执行检查点

1. Tasks 1-5：等价基线、核心、service、组件、可回滚外壳。
2. Tasks 6-9：全部非 AI 业务模块和统一客户详情。
3. Tasks 10-12：AI 来源、业务语义和角色边界。
4. Task 13：浏览器、响应式和可访问性。
5. Task 14：生产切换和旧外壳退役。

每个检查点执行：

```bash
npm run frontend:parity
npm test
git diff --check
git status --short
```

存在失败测试、未映射能力、未评审权限变化或未评审任务修改时不得继续；无关用户修改必须保留并报告。

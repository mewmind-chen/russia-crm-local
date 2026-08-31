# Session Checkpoint：阶段 E 首片——widget 注册表落地

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`b0920d7` → `2d98eea`（业务）

## 本轮切片

### `2d98eea` feat(frontend): land widget registry and assemble customer profile through it

阶段 E（前端 widget 组合架构）首片，兑现路线图"建立 Widget 注册表 + 页面注册表化组装"：

- **新增 `sales-assets/widget-registry.js`**（UMD，范式同 filter-component.js）：`register(metadata)` + `renderPage(pageKey, container, ctx)`。widget 元数据含 `id`、`pages/page`、`order`、`permission`（string|string[]）、`feature`（string|string[]）、`when(ctx)`、`render(container, ctx)`。门槛等价 `data-permission`/`data-ai-business` + bootstrap features：permission 查 `ctx.permissions`、feature 查 `ctx.features`。`widgetsForPage` 页面过滤 + 门槛过滤 + order 排序；`renderPage` 逐 widget await（支持 async render），异常按 widget 隔离（返回 `{id, error}`），不阻断同页其余 widget。
- **`sales-crm.html`**：在 app.js 之前加载 `widget-registry.js`。
- **`sales-assets/app.js`**：`customerProfile` 页面改由注册表组装——`registerProfilePageWidgets()` 注册 `profile-facts`（order 10，when：fieldWidget+schema 就绪）与 `profile-contacts`（order 20，when：contactsWidget 就绪）；`mountCustomerProfileWidgets` 委托 `window.TradePulseWidgetRegistry.renderPage('customerProfile', widgetRoot, ctx)`，ctx 注入 `permissions`/`features`/`fieldWidget`/`contactsWidget`/`profileSchema`/`profilePreferences`。facts 渲染（schema 驱动 + 偏好条）与联系人挂载逻辑原样迁入 widget render，行为逐字节一致。

**契约测试**（新增 `test/widget_registry_contract.test.js`，8 断言）：
- 结构：html 在 app.js 前加载 registry；UMD 导出 register/unregister/has/list/clear/widgetsForPage/renderPage；register 校验 id/pages/render；app.js 注册 profile-facts/profile-contacts、挂载委托 renderPage、ctx 携带 permissions/features；widget render 保留既有 UMD 契约（renderProfileFacts/mountContacts/偏好条）。
- 行为：widgetsForPage 按页面过滤 + order 排序 + permission/feature/when 三门槛；renderPage 按序挂载（含 async render）、异常隔离不阻断后续；无 container 返回空；unregister/clear。

## 测试证据

- 新契约 8/8；既有 `profile_widgets.test.js` 12/12（行为未回归）。
- `node --test` 全量 `1983/1983`（较上轮 +8）；`npm test` 核心 `1622/1622`（+8）。
- `git diff --check` 通过；lint 无错误；工作区干净（业务提交后）。

## 提交

- `2d98eea` feat(frontend): land widget registry and assemble customer profile through it

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片（按路线图关键动作 2/3/4/6）：
   - 其余功能 widget 化：身份、业务画像、洞察/评价、时间线、商务、下一步、回收状态、AI 区域；
   - `#customerDrawer` 与完整资料共用同一 widget 集合；
   - AI 区域登记为 widget，由现有开关决定是否挂载（AI 内部零改动）；
   - 验收后 `/development-workbench` profile 模式收敛为只读/兼容入口（先确认现有使用方）。
3. 全量绿灯，可继续。
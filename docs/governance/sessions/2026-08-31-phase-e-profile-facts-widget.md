# Session Checkpoint：阶段 E 次片——profile-facts 自包含 UMD widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`2d98eea → 41a722e`（业务）

## 本轮切片

### `41a722e` feat(frontend): extract profile-facts into self-contained UMD widget

阶段 E 次片：把客户资料"字段事实 + 区块偏好"从 app.js 抽成自包含 UMD widget，兑现路线图阶段 E 关键动作 2"widget 化：每个 widget 自包含模板/状态/事件，对外只暴露 render(container, ctx)；以 filter-component.js 的 UMD 模式为范式"。

- **新增 `sales-assets/profile-facts-widget.js`**（UMD，`TradePulseProfileFactsWidget`）：自持客户资料事实模板、`hiddenSections` 偏好状态（`loadPreferences`/`savePreferences`/`toggleSection`，localStorage 按存储键读写）、`data-profile-section-toggle` 点击事件。对外只暴露 `render(container, ctx)`（另导出 `renderFactsHtml`/`renderPreferenceBarHtml` 纯函数与偏好助手供契约测试）。ctx 经依赖注入承载数据源（`fieldWidget`/`schema`/`storageKey`/`getAccount`/`fetchProfile`/`fallbackPool`/`buildFactsData`/`formatters`/`onSectionsChanged`），异常回退 `fallbackPool`、不抛出阻断同页其他 widget。
- **`sales-assets/app.js`**：`profile-facts` 注册表条目的 render 改为只组装 ctx 并委托 `ctx.factsWidget.render`；删除内联 facts+偏好条渲染、`defaultProfilePreferences`/`loadProfilePreferences`/`saveProfilePreferences`/`toggleProfileSectionPreference` 偏好助手，以及 app 级点击委托里的 `data-profile-section-toggle` 分支（事件已下沉到 widget）——净 -55 行。
- **`sales-crm.html`**：在 app.js 前加载 `profile-facts-widget.js`（且在 widget-registry 之后）。
- **契约测试**（`test/widget_registry_contract.test.js` 由 8 → 12 断言）：新增 facts widget 偏好状态（storage shim load/save/toggle）、facts/偏好条 HTML 按 hiddenSections 隐藏区块、render 挂载 facts+条并绑定 toggle 重挂载；既有注册表门槛/排序/错误隔离断言保持；app.js 接线断言更新为"只注入 ctx、模板/状态/事件下沉到 widget"。

## 测试证据

- `node --test` 全量 `1987/1987`（较上轮 +4）；`npm test` 核心 `1626/1626`（+4）。
- 前端专项：`profile_widgets`+`issue286_drawer`+`issue103`+`field_catalog`+`issue116_filter_component` 57/57。
- `git diff --check` 通过；lint 无错误；工作区干净（业务提交后）。

## 提交

- `41a722e` feat(frontend): extract profile-facts into self-contained UMD widget

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - 其余功能 widget 化：身份、业务画像、洞察/评价、时间线、商务、下一步、回收状态、AI 区域（AI 零改动，按开关登记）；
   - `#customerDrawer` 与完整资料共用同一 widget 集合（drawer 现内联 schema facts 渲染）；
   - 验收后 `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。
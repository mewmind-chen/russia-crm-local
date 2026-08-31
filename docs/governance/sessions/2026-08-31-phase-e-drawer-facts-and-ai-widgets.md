# Session Checkpoint：阶段 E 续片——CRM 抽屉 facts + AI 问答 widget 化

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`2d98eea → 41a722e → 7c76fb3 → 64b9418`（业务）

## 背景

工作区存在一班未提交的 WIP（`drawer-facts-widget.js` 新增 + app.js/html/测试改动），
是对「CRM 抽屉客户事实区抽为自包含 UMD widget」的完整切片但未收尾。本轮先核验该切片
（专项 39/39、核心 1630/1630、全量 1991/1991 全绿）后提交为 `7c76fb3`，再叠加
「抽屉 AI 问答区 widget 化」新切片 `64b9418`。

## 本轮切片

### `7c76fb3` feat(frontend): extract CRM drawer facts into self-contained UMD widget

- **新增 `sales-assets/drawer-facts-widget.js`**（UMD，`TradePulseDrawerFactsWidget`）：
  自持 facts 模板回退（schema 就绪优先 `fieldWidget.renderFacts`，异常回退硬编码行）与
  website 安全转义（script/credential URL 拦截回「暂无官网」）。对外只暴露
  `renderFactsHtml(ctx)`/`factMarkup`/`websiteMarkup`/`render`。
- **`sales-assets/app.js`**：`renderDrawer` 事实区经 `drawerFactsContext`（集中
  schema/formatters/fallback）生成 ctx，再经 `TradePulseDrawerFactsWidget.renderFactsHtml`
  渲染；widget 缺失时回退既有 fieldWidget/硬编码行为（逐字节一致）。`registerProfilePageWidgets`
  改用 `registerIfMissing` 幂等注册模式，新增 `drawer-facts`（pages: ['crmDrawer'], order 10）。
- **`sales-crm.html`**：`drawer-facts-widget.js` 在 `ui-format.js`（website 依赖）之后、
  `widget-registry.js`/`app.js` 之前加载。
- **契约测试 +4**（加载顺序/渲染/安全转义/注册表接线，`widget_registry_contract.test.js`）；
  4 个既有测试（issue285/286/287/325）断言更新到新结构与命名。

### `64b9418` feat(frontend): extract CRM drawer AI Q&A section into self-contained UMD widget

- **新增 `sales-assets/drawer-ai-widget.js`**（UMD，`TradePulseDrawerAiWidget`）：
  自持 customer-ai section 模板（AI 问答卡片 + `#drawerAiForm` 表单）与公司名安全转义；
  `enabled`/`canUseAi` 门槛缺失时返回空串。对外暴露 `renderCustomerAiSectionHtml(ctx)`/
  `render`/`escapeHtml`。
- **`sales-assets/app.js`**：`customerAiSection` 改为经 `drawerAiContext`（集中
  `technicalAIPresentationAllowed()` && `can('use_ai_assistant')` 门槛）委托 widget 渲染；
  `registerProfilePageWidgets` 新增 `drawer-ai`（pages: ['crmDrawer'], order 30）。
  `drawerAiForm` 提交与 AI 问答仍由 app 级委托处理（**AI 内部零改动**）。
- **`sales-crm.html`**：`drawer-ai-widget.js` 在 `widget-registry.js`/`app.js` 之前加载。
- **契约测试 +3**（加载顺序/门槛转义/注册表委托）；issue100 AI gate、sales_menu 上下文
  AI Q&A、issue325 sales copy 断言更新（门槛 gate 归属从 `customerAiSection` 移入
  `drawerAiContext`，模板 id 归属移入 widget）。

## 测试证据

- 全量 `node --test`：1994/1994（较上轮 +7：drawer-facts 4 + drawer-ai 3）。
- 专项：widget_registry + issue285/286/287/103/116 + field_catalog + profile_widgets 79/79；
  issue100、sales_menu 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `7c76fb3` feat(frontend): extract CRM drawer facts into self-contained UMD widget
- `64b9418` feat(frontend): extract CRM drawer AI Q&A section into self-contained UMD widget

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：其余功能 widget 化（身份、业务画像、洞察/评价、时间线、商务、下一步、
   回收状态），以及 customerDrawer（drawer-facts/drawer-ai 已就位）与完整资料共用同一
   widget 集合；AI 完整资料站（`customerAiStation` 的评分/资料包/补全渲染）评估是否纳入
   widget 注册表。
3. 全量绿灯，可继续。
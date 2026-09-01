# Session Checkpoint：阶段 E——identity/source tags UMD widget

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
远端 main / production current：`57c4c42a89e7730545b726b29fd932c5bfb20574`
当前业务提交：`3adc1d1`（前置 host isolation：`8a86425`）
看板校准提交：`4941b7e`

## 背景

阶段 E 已将 customerProfile 默认视图接入 widget 注册表，并完成 profile-only
workbench 只读兼容契约与逐 widget host 隔离。本轮继续沿最小边界收敛身份/来源标签：
把 `sales-assets/app.js` 内联的 `sourceTagMarkup` 及其纯投影逻辑提取为独立 UMD
资产，保持统一壳、抽屉与既有 API 的行为边界。

## 本轮切片

`3adc1d1 refactor(frontend): extract source tag widget` 完成：

- 新增 `sales-assets/source-tags-widget.js` UMD；对外提供 source tag 的安全转义、文本归一化、去重保序、账户标签投影与行 HTML 渲染。
- `sales-assets/app.js` 的兼容 wrappers 委托给 UMD；`sales-crm.html` 在 widget registry 与 app 之前加载该资产，确保运行时依赖顺序明确。
- 只读消费 `customerTags`，不合成 `customer_type`/`industry`；空名过滤、NFKC/空白归一化、原始名称去重并保留输入顺序。
- AI 关闭时过滤 `readOnly` 标签；默认最多 5 项，溢出以 `+N` 展示。UMD 转义 name/category/source；`app.js` 注入 `includeReadOnly` 开关，并继续以 `esc` 转义、追加 identity warning amber pill。
- `Index.html` 的标签编辑/postMessage 逻辑、后端 API、AI internals 与既有 AI 触发点均未修改。

## 验证证据

- 目标前端/标签专项：`106/106`。
- core `npm test`：`1670/1670`。
- 全量 `node --test`：`2031/2031`。
- `node --check`、`npm run check:ai-boundary`、`npm run check:governance-authority`、`git diff --check`：通过。
- 本会话重新核验：远端 `origin/main`、生产 `current/.release-sha` 与 `state/state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；未修改生产目录。

## 权限、AI 与生产边界

本轮只移动只读标签投影与 HTML 模板；既有 permission/feature 门槛保持。未触碰
`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*`、AI provider 或 AI 运行时开关，未改变
标签编辑写入、postMessage、API 或 AI 内部行为。未执行浏览器双角色验收、生产验证、
部署或生产目录写入。

当前没有隔离 preview/mock runtime。不得把未跑浏览器写成通过，也不得直接运行默认
`npm start`：该命令会使用默认 `after/data/crm.db`，建表并启动 AI health monitor，
不满足本阶段的隔离条件。

## 回滚与下一最小动作

业务回滚点为 `3adc1d1^`（即前置 host isolation 提交 `8a86425`）；source-tags
UMD 资产可随本业务提交独立回退，旧 profile iframe 仍可由 `profileView=legacy`
显式兼容回退，profile-only workbench 保持只读兼容入口。

下一可执行动作固定为：先建立独立临时 SQLite、绑定 `127.0.0.1`、禁用 AI
provider/monitor 的 Phase E browser-preview harness，再做 sales/manager 双角色验收；
其后才处理剩余复杂主体/activity timeline。阶段 E 仍进行中。

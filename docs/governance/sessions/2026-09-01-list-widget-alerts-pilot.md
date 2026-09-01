# 2026-09-01 List widget Alerts/今日待办试点

## 范围

- 将销售工作台 Alerts/今日待办桌面表格接入 `sales-assets/list-widget.js`。
- 新增 Alerts 字段目录：等级、客户、主要原因/其他原因、计划时间、负责人；操作列仍由页面动作负责并保持必选。
- 按当前用户保存列显隐、列顺序与排序预设；排序只接受服务端白名单：紧急程度、计划时间、最近更新、客户名称。
- 保留既有严重程度钻取、移动端卡片、行级打开入口与唯一动作；主管异常区和既有 AI 开关/动作不改动。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/alerts` 提供；客户端布局只在服务端有效字段 schema 内生效。
- `/api/sales-crm/lists/alerts` 对未授权排序返回 `403 SORT_NOT_AUTHORIZED`。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --test test/list_widget.test.js test/issue116_business_page_api.test.js test/issue116_business_page_filters.test.js test/today_tasks_integration.test.js test/issue168_today_task_mobile.test.js test/issue273_mismatch_recycle_ui.test.js`：相关回归 `27/27` 通过。
- `npm test`：core `1687/1687` 通过。
- `node --test`：全量 `2048/2048` 通过。
- `node --check`（修改后的 JS）与 `git diff --check`：通过。
- `npm run check:governance-authority`：通过。
- `npm run check:ai-boundary`：通过（193 个文件）。

## 结果与后续

Alerts/今日待办成为第六套 List widget 样板，与 customers、Research People、不对口记录、Pipeline、Intake/lead_flow 共同验证授权字段目录与用户级布局协议。阶段 E 仍未完成；其余业务列表迁移及隔离预览环境中的销售/经理浏览器验收继续排队。

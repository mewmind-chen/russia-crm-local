# 2026-09-01 List widget Dashboard 国家快照

## 范围

- 将 Dashboard 的“国家转化与价值”只读快照表接入 `sales-assets/list-widget.js`。
- 新增 Dashboard 字段目录：国家、客户、回复率、询价率、首单率、单客毛利；不新增或改动智能内容。
- 按当前用户保存列显隐、列顺序与排序预设；排序在前端基于已授权的快照数据执行，保留原有前五行展示边界。
- 保留 Dashboard 漏斗、提醒、活动流与市场深度分析入口，不改变经营指标计算或服务端授权范围。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/dashboard` 提供；客户端布局只在服务端有效字段 schema 内生效。
- Dashboard 快照继续消费既有 `countryReport`，销售无 `view_markets` 时保持空快照；本轮不扩大数据权限。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --test test/list_widget.test.js test/field_catalog.test.js`：`33/33` 通过。
- `npm test`：core `1692/1692` 通过。
- `node --check sales-assets/app.js lib/field_catalog.js` 与 `git diff --check`：通过。
- `node --test`：全量 `2053/2053` 通过。
- `npm run check:governance-authority`：通过。
- `npm run check:ai-boundary`：通过（193 个文件）。

## 结果与后续

Dashboard 国家快照成为第九套 List widget 样板，与 customers、Research People、Research Recon、
不对口记录、Pipeline、Intake/lead_flow、Alerts/今日待办和通知中心共同验证授权字段目录与用户级布局协议。
阶段 E 仍未完成；下一代码切片继续从剩余只读业务列表中选择一页，之后再执行隔离预览环境中的销售/经理浏览器验收。

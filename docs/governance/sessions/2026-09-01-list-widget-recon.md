# 2026-09-01 List widget Research Recon

## 范围

- 将 Research Recon 结果列表接入 `sales-assets/list-widget.js`。
- 新增 Recon 字段目录：客户、评分/分组、客户画像、需求与机会、联系人；报告动作列由页面按权限组装并保持必选。
- 按当前用户保存列显隐、列顺序与排序预设；排序只接受服务端白名单：最近更新、评分优先、客户名称。
- 桌面端使用共享 descriptor table，保留原有数据内容、报告链接权限、授权筛选与分页行为。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/recon` 提供；客户端布局只在服务端有效字段 schema 内生效。
- Recon 联系人列由 `view_contacts` 字段权限门控；服务端仍使用既有 `contactSafeReconRecord`，无联系人权限不下发联系人派生数据。
- `/api/sales-crm/research/recon` 对未授权排序返回 `403 SORT_NOT_AUTHORIZED`；排序 SQL 只从既有后端白名单映射生成。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --test test/issue116_research_filter_api.test.js test/issue116_research_filter_component.test.js test/list_widget.test.js test/issue325_sales_copy_boundary.test.js`：`32/32` 通过。
- `npm test`：core `1691/1691` 通过。
- `node --test`：全量 `2052/2052` 通过。
- `node --check`（修改后的 JS）与 `git diff --check`：通过。
- `npm run check:governance-authority`：通过。
- `npm run check:ai-boundary`：通过（193 个文件）。

## 结果与后续

Research Recon 成为第八套 List widget 样板，与 customers、Research People、不对口记录、Pipeline、Intake/lead_flow、Alerts/今日待办和通知中心共同验证授权字段目录与用户级布局协议。阶段 E 仍未完成；其余业务列表迁移及隔离预览环境中的销售/经理浏览器验收继续排队。

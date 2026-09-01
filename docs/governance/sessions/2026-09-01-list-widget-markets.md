# 2026-09-01 List widget Markets 报表

## 范围

- 将 Markets 的国家经营矩阵、分配批次与四个细分报表接入 `sales-assets/list-widget.js`。
- 新增 `markets_country`、`markets_cohort`、`markets_segments` 字段目录；仅保留既有只读经营指标，不新增或改动智能内容。
- 按当前用户保存列显隐、列顺序与本地排序预设；布局仅接受服务端授权字段 schema 内的字段。
- 保留既有 Markets 数据范围、权限门控、卡片和报表计算；四个细分表共用同一字段布局与排序协议。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/:pageKey` 提供；客户端布局不能扩大字段权限、数据范围或筛选授权。
- 国家矩阵与分配批次继续消费既有 `countryReport`/`cohortReport`；细分表继续消费既有 `segmentReports`，本轮不改变服务端查询或授权逻辑。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --check sales-assets/app.js lib/field_catalog.js`：通过。
- `node --test test/list_widget.test.js test/field_catalog.test.js`：`34/34` 通过。
- 影响面 `node --test test/list_widget.test.js test/field_catalog.test.js test/permission_integration.test.js test/sales_access_ui.test.js`：`100/100` 通过。
- `npm test`：core `1693/1693` 通过。
- `node --test`：全量 `2054/2054` 通过。
- Phase E preview harness 已另提交为 `dd650ba`；`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：通过；浏览器双角色、生产与部署验证尚未执行（当前环境缺失锁定浏览器依赖时入口以 `78` fail-closed）。

## 结果与后续

Markets 国家矩阵、分配批次和细分报表成为共享 List widget 的新增业务切片；Dashboard、customers、Research People、Research Recon、不对口记录、Pipeline、Intake/lead_flow、Alerts/今日待办和通知中心继续复用同一协议。

阶段 E 仍未完成。下一门禁是独立临时 SQLite、`127.0.0.1` 随机端口、禁用 AI provider/monitor 的 preview harness；harness 可重复运行后再进行 sales/manager 双角色真实浏览器验收，随后继续剩余只读业务列表迁移。

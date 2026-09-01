# 2026-09-01 List widget 主管指标列表

## 范围

- 将团队复盘中的销售指标行接入 `sales-assets/list-widget.js`，保留统计周期切换、指标摘要和每个指标的客户钻取按钮。
- 新增 `manager_metrics` 聚合字段目录：销售、统计周期、当前开发客户、延期客户、需要主管关注、延期后形成计划、计划后按时行动、首次触达后未推进、协助后未改善、复盘状态。
- 为指标列表提供独立的当前用户布局偏好（列显隐、列顺序、排序预设）；支持销售名称、计数、比例和需复盘优先排序。
- 指标数字仍通过原 `data-manager-metric-kind`/`data-manager-metric-owner` 进入 `/manager-metrics/drilldown`，不改变统计口径或客户明细钻取。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/:pageKey` 提供；客户端布局只接受服务端授权字段，不能扩大字段、数据范围、筛选或钻取权限。
- 指标行继续消费既有 `listManagerMetricRows` 的授权聚合和 `managerMetricAvailabilityCopy`；本轮只改变前端呈现和用户级布局，不改后端统计、周期或钻取查询。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --check sales-assets/app.js`、`node --check lib/field_catalog.js`：通过。
- 主管/列表专项 `node --test test/issue333_stat_drilldown.test.js test/issue170_deferred_plan_ui.test.js test/issue196_manager_task_pagination_ui.test.js test/issue273_mismatch_recycle_ui.test.js test/issue291_browser_regressions.test.js test/list_widget.test.js`：`42/42` 通过。
- 影响面权限/筛选专项：`117/117` 通过。
- `npm test`：core `1700/1700` 通过。
- `node --test`：全量 `2061/2061` 通过。
- `git diff --check`、`npm run check:ai-boundary`：通过；治理 authority 将在本 checkpoint 提交前复核。

## 结果与后续

主管指标主表成为共享 List widget 的新增业务切片；指标摘要、授权聚合、数字钻取和风险钻取明细均保持原语义。

阶段 E 仍未完成。下一步先在具备锁定浏览器依赖的环境运行隔离 preview harness，完成 sales/manager 双角色验收；随后继续 Team 进度/协作与其余业务列表迁移。

# 2026-09-01 List widget 主管风险明细

## 范围

- 将主管风险明细列表接入 `sales-assets/list-widget.js`，保留风险摘要、授权筛选、分页和既有“查看历史”处置动作。
- 新增 `manager_risks` 字段目录：客户、客户 ID、状态、负责人、触发原因、处理期限、触发时间；操作列保持必显且不进入排序字段。
- 为风险明细提供独立的当前用户布局偏好（列显隐、列顺序、排序预设），默认按最早处理期限优先，支持期限、状态、负责人、触发原因和客户名称排序。
- 指标统计钻取仍保留原客户明细卡片和独立分页语义；本轮只迁移 `GET /manager-risks` 主列表，避免把不同数据形状强行合并。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/:pageKey` 提供；客户端布局只接受服务端授权字段，不能扩大字段、数据范围、筛选或动作权限。
- 风险明细继续消费既有 `listManagerRiskRows`（与主管任务共享授权范围和只读任务投影）；本轮不改服务端查询、风险判定、任务状态或写入语义。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --check sales-assets/app.js`、`node --check lib/field_catalog.js`：通过。
- `node --test test/issue291_browser_regressions.test.js test/list_widget.test.js test/field_catalog.test.js`：`41/41` 通过。
- 影响面 `node --test test/list_widget.test.js test/field_catalog.test.js test/permission_integration.test.js test/sales_access_ui.test.js test/issue170_manager_filters.test.js test/issue170_manager_permissions.test.js`：`116/116` 通过。
- `npm test`：core `1699/1699` 通过。
- `node --test`：全量 `2060/2060` 通过。
- `git diff --check`、`npm run check:ai-boundary`：通过；治理 authority 将在本 checkpoint 提交前复核。

## 结果与后续

主管风险明细主列表成为共享 List widget 的新增业务切片；原有授权范围、筛选、分页、风险动作和指标钻取行为保持不变。

阶段 E 仍未完成。下一步先在具备锁定浏览器依赖的环境运行隔离 preview harness，完成 sales/manager 双角色验收；随后继续 `manager_metrics`、Team 进度/协作和其余业务列表迁移。

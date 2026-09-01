# 2026-09-01 List widget 主管任务列表

## 范围

- 将主管任务列表接入 `sales-assets/list-widget.js`，保留任务摘要、分页与既有授权动作（完成/处理等）。
- 新增 `manager_tasks` 字段目录：客户、客户 ID、状态、负责人、触发原因、处理期限、触发时间；操作列保持必显且不进入排序字段。
- 按当前用户保存列显隐、列顺序和排序预设；默认按最早处理期限优先，支持期限、状态、负责人、触发原因和客户名称排序。
- 处理期限与触发时间分别作为独立列，避免原卡片日期信息在表格化迁移中合并或丢失。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/:pageKey` 提供；客户端布局只接受服务端授权字段，不能扩大字段、数据范围、筛选或动作权限。
- 任务数据仍由既有 `resolve_manager_tasks` 投影与授权分页接口提供；本轮只改变前端呈现和用户级布局，不改服务端查询、任务状态或写入语义。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --check sales-assets/app.js`、`node --check lib/field_catalog.js`：通过。
- `node --test test/issue291_browser_regressions.test.js test/list_widget.test.js test/field_catalog.test.js`：`40/40` 通过。
- 影响面 `node --test test/list_widget.test.js test/field_catalog.test.js test/permission_integration.test.js test/sales_access_ui.test.js`：既有权限回归 `100/100` 保持通过。
- `npm test`：core `1698/1698` 通过。
- `node --test`：全量 `2059/2059` 通过。
- `git diff --check`、`npm run check:ai-boundary`：通过；治理 authority 将在本 checkpoint 提交前复核。

## 结果与后续

主管任务列表成为共享 List widget 的新增业务切片；既有任务动作、权限、摘要和分页保持不变。

阶段 E 仍未完成。下一步先在具备锁定浏览器依赖的环境运行隔离 preview harness，完成 sales/manager 双角色验收；随后继续 `manager_risks`、`manager_metrics` 与其余业务列表迁移。

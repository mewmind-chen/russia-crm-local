# 2026-09-01 List widget 数据维护运行记录

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将数据维护页的只读“最近维护记录”接入统一 List widget。

## 本轮范围

- `sales-assets/app.js` / `sales-crm.html`：新增 `maintenance_runs` 列设置、排序控件和用户级 `visibleColumns` / `columnOrder` / `sortPreset` 偏好；使用 `listWidget.renderTable`，本地排序只作用于已返回的最多 20 条记录。
- `lib/field_catalog.js`：新增 `maintenance_runs` 人工字段目录（时间、操作人、状态、目标、备份），不包含 AI 字段。
- 保留既有权限门控、`GET /api/sales-crm/data-maintenance/runs?limit=20`、空态、刷新、维护预览和 destructive execute 流程；未新增服务端排序或写 API。
- `test/data_maintenance.test.js` 与 `test/list_widget.test.js`：锁定 runs API 返回、List widget 接线、用户偏好、列顺序/显隐事件与 AI 边界。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不新增 AI 列、推荐或生成行为。
- 不迁移用户/归档用户、审计/迁移复核和跟进更正列表。
- 不改维护预览/执行安全校验，不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha`：均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- after 业务提交：`6001f61 feat(widget): migrate maintenance runs list`。
- 维护 runs / 受保护目录 / List widget / access UI 定向：`50/50`。
- 全量 `npm test`：`1709/1709` 通过。
- 全量 `node --test`：`2071/2071` 通过。
- `node --check`（app.js、field_catalog.js）、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：通过。

## 当前结论与下一步

维护运行记录已迁移到共享 List widget；偏好只能在服务端授权 schema 内生效，且不改变维护预览/执行安全边界。AI 面保持零动作。

阶段 E 仍未完成。下一切片迁移跟进更正历史只读列表，复用既有筛选/分页 schema；target/proposal/review 审批流保留原样。用户/归档用户和审计/迁移复核另拆高风险切片。

## 回滚点

回退 `6001f61` 可移除维护运行记录的 List widget 接线、字段目录和用户布局偏好；受保护客户目录及前序列表迁移仍保留。生产目录保持只读。

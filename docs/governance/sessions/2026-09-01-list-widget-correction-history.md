# 2026-09-01 List widget 跟进更正历史

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将跟进更正历史的只读列表主体接入统一 List widget。

## 本轮范围

- `sales-assets/app.js` / `sales-crm.html` / `sales-assets/app.css`：接入 `correction_history` 列设置、排序控件和用户级 `visibleColumns` / `columnOrder` / `sortPreset` 偏好；当前服务端分页页内执行本地排序。
- `lib/field_catalog.js`：新增更正历史人工字段目录（来源客户、目标客户、里程碑、原因、状态、操作人、时间），由服务端 schema 门控可展示列。
- 保留既有 `/api/sales-crm/activity-corrections` 筛选、服务端分页、权限范围、总数与 `target/proposal/review` 审批流；不新增排序 API，不改变更正写入或审批行为。
- `test/list_widget.test.js`：锁定字段 schema、用户偏好、列显隐/顺序/恢复默认/关闭面板接线与 AI 边界。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不新增 AI 列、推荐或生成行为。
- 不迁移用户/归档用户、审计/迁移复核列表；不改更正目标选择器、提案队列、审批动作和写入门控。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha`：均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- after 业务提交：`61a6572 feat(widget): migrate correction history list`。
- 更正历史 / 维护 runs / 受保护目录 / API / List widget 定向：`50/50`。
- 全量 `npm test`：`1710/1710` 通过。
- 全量 `node --test`：`2072/2072` 通过。
- `node --check`（app.js、field_catalog.js）、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：通过。

## 当前结论与下一步

跟进更正历史只读列表已接入共享 List widget；偏好只能在服务端授权 schema 内生效，且不改变既有筛选、分页、权限和审批边界。AI 面保持零动作。

阶段 E 仍未完成。下一切片迁移用户/归档用户、审计/迁移复核列表，先拆分 bootstrap 数据与高风险行操作边界；浏览器双角色验收继续作为独立门禁，依赖缺失时保持 fail-closed。

## 回滚点

回退 `61a6572` 可移除更正历史的 List widget 接线、字段目录和用户布局偏好；维护运行记录、受保护客户目录及前序列表迁移仍保留。生产目录保持只读。

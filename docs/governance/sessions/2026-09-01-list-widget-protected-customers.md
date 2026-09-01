# 2026-09-01 List widget 受保护客户目录

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将受保护客户目录的只读列表主体接入统一 List widget。

## 本轮范围

- `sales-assets/app.js` / `sales-crm.html` / `sales-assets/app.css`：接入受保护目录的授权列 schema、用户级 `visibleColumns` / `columnOrder` / `sortPreset` 偏好、列设置面板和排序控件；移动端保持横向可读。
- `lib/field_catalog.js`：新增 `protected_customers` 人工字段目录；身份列与操作列保持必需，不包含 AI 字段。
- `lib/protected_customers.js` / `lib/sales_crm.js`：保留原管理员权限、状态/查询过滤、分页、导出和行操作；新增仅限白名单的服务端排序预设，非法排序返回 `SORT_NOT_AUTHORIZED`。
- `test/list_widget.test.js` 与 `test/issue205_pagination_backend.test.js`：锁定字段 schema、控件接线、服务端安全排序和非法排序拒绝。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不新增 AI 列、推荐或生成行为。
- 不迁移后台/运维列表，不改变受保护客户导入、批次、冲突核验与激活动作的权限或 API 契约。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha`：均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- after 业务提交：`f1fe7d1 feat(widget): migrate protected customer directory`。
- 受保护目录 / List widget 定向：`43/43`。
- 全量 `npm test`：`1708/1708` 通过。
- 全量 `node --test`：`2070/2070` 通过。
- `node --check`（app.js、protected_customers.js、sales_crm.js）、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：通过。

## 当前结论与下一步

受保护客户目录已接入统一 List widget，客户端偏好不能扩大服务端授权字段、数据范围、导出权限或行操作权限；AI 面保持零动作。

阶段 E 仍未完成。下一切片先只读盘点后台/运维列表的权限、分页、导出、审计与行操作边界，再逐页迁移；浏览器双角色验收继续作为独立门禁，依赖缺失时保持 fail-closed。

## 回滚点

回退 `f1fe7d1` 可移除受保护客户目录的 List widget 接线、字段目录和排序白名单；Insights 及前序列表迁移仍保留。生产目录保持只读。

# Phase E：Research People 列表迁移到 List widget

日期：2026-09-01

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将只读、服务端筛选分页的 Research People 列表迁移到统一 List widget。

## 本轮范围

- `sales-assets/app.js`：联系人列表接入授权列 schema、用户级 `visibleColumns` /
  `columnOrder` / `sortPreset` 偏好、列设置面板与排序控件；保留原有筛选、分页、
  空态、错误态和权限边界。
- `sales-crm.html` / `sales-assets/app.css`：增加联系人列表列设置和排序入口，
  复用统一面板样式并保留移动端安全布局。
- `lib/field_catalog.js`：新增 `contacts` 列目录；公司列必选，其余联系人敏感列
  由 `view_contacts` 授权门控。
- `lib/sales_crm.js`：Research People 仅接受白名单排序值（`sales_ready`、
  `contact_level`、`updated_desc`、`company_asc`），排序仍在服务端执行，分页结果
  不在浏览器端重排。
- `test/list_widget.test.js` 与 `test/issue116_research_filter_api.test.js`：锁定
  widget 接线、字段目录、排序白名单、排序结果与非法排序拒绝。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点。
- 不迁移 Recon 列表，不改变 Research People 数据授权、筛选 AST、分页语义。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- after 分支：`codex/frontend-widget-pilot`
- 业务提交：`3c9a97f feat(frontend): migrate research people list to shared widget`
- Research People / List widget 定向：`17/17`
- `node --check`（app.js、sales_crm.js、field_catalog.js）：通过
- `git diff --check`：通过
- 全量 `npm test`：`1678/1678` 通过
- 全量 `node --test`：`2039/2039` 通过
- `npm run check:governance-authority`：通过
- `npm run check:ai-boundary`：通过

## 当前结论

customers 与 Research People 已成为两个可回归的 List widget 样板；“所有列表页”
仍未宣称完成。下一代码切片优先评估线索池或另一套只读授权列表，继续保持服务端
授权字段与用户偏好分离。

## 回滚点

回退 `3c9a97f` 可移除本轮 Research People 列表 widget 接线、contacts 字段目录和
排序白名单；customers 样板及通用 List widget 协议仍保留在前序提交中。生产目录保持只读。

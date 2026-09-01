# Phase E：不对口记录列表迁移到 List widget

日期：2026-09-01

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将无 AI、授权分页的“不对口记录”列表迁移到统一 List widget。

## 本轮范围

- `sales-assets/app.js`：回收列表接入授权列 schema、用户级 `visibleColumns` /
  `columnOrder` / `sortPreset` 偏好、列设置面板与排序控件；保留原有筛选、分页、
  记录详情、恢复和重新分配动作。
- `sales-crm.html` / `sales-assets/app.css`：增加回收列表列设置和排序入口，复用
  统一面板样式并保留移动端安全布局。
- `lib/field_catalog.js`：新增 `recycle_bin` 列目录，动作列仍由前端授权动作组装。
- `lib/business_page_filters.js` / `lib/sales_crm.js`：回收列表仅接受
  `recycled_desc`、`recycled_asc`、`company_asc`、`reason_asc` 四种服务端排序。
- `test/list_widget.test.js` 与 `test/issue116_business_page_api.test.js`：锁定
  widget 接线、字段目录、排序白名单、排序结果与非法排序拒绝。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点。
- 不改变回收/恢复/重新分配权限、筛选 AST、分页语义和记录详情数据形状。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- after 分支：`codex/frontend-widget-pilot`
- 业务提交：`1bbc5c4 feat(frontend): migrate recycle list to shared widget`
- Research People/Recycle/List widget/字段目录定向：`20/20`
- `npm test`：`1680/1680` 通过
- `node --test`：`2041/2041` 通过
- `node --check`（app.js、sales_crm.js、business_page_filters.js、field_catalog.js）：通过
- `git diff --check`：通过
- `npm run check:governance-authority`：通过
- `npm run check:ai-boundary`：通过

## 当前结论

customers、Research People 与不对口记录已成为三个可回归的 List widget 样板；
“所有列表页”仍未宣称完成。下一代码切片优先评估线索池或另一套只读授权列表，
继续保持服务端授权字段与用户偏好分离。

## 回滚点

回退 `1bbc5c4` 可移除本轮不对口记录列表 widget 接线、`recycle_bin` 字段目录和
排序白名单；customers 与 Research People 样板及通用 List widget 协议仍保留在前序
提交中。生产目录保持只读。

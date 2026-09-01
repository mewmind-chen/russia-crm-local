# Phase E：Pipeline 推进动作台迁移到 List widget

日期：2026-09-01

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将无 AI、授权分页的 Pipeline 推进动作台明细列表迁移到统一 List widget。

## 本轮范围

- `sales-assets/app.js`：Pipeline 明细表接入授权列 schema、用户级 `visibleColumns` /
  `columnOrder` / `sortPreset` 偏好、列设置面板与排序控件；保留行动队列、星标视图、
  客户详情、推进动作和主管协助等既有业务动作。
- `sales-crm.html` / `sales-assets/app.css`：增加 Pipeline 列设置和排序入口，保留
  现有表头语义、行动行样式与移动端安全布局。
- `sales-assets/list-widget.js`：descriptor table 支持可选表头行属性，保持页面既有
  `pipeline-list-head` 语义，同时继续使用原始 cell markup 承载受控动作。
- `lib/field_catalog.js`：新增 `pipeline` 列目录；客户与操作列由页面必选，其他列受
  服务端字段 schema 约束。
- `lib/business_page_filters.js` / `lib/sales_crm.js`：Pipeline 列表仅接受
  `pending_action`、`recent_activity`、`stage_asc`、`company_asc` 四种服务端排序，
  非法排序统一返回 `SORT_NOT_AUTHORIZED`。
- `test/list_widget.test.js` 与 `test/issue116_business_page_api.test.js`：锁定
  widget 接线、字段目录、表头兼容属性、排序白名单、排序结果与非法排序拒绝。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不新增 AI 内容、
  推荐或自动动作。
- 不改变 Pipeline 行动队列、星标筛选、权限范围、筛选 AST、分页或客户动作语义。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- after 分支：`codex/frontend-widget-pilot`
- 业务提交：`eb73388 feat(frontend): migrate pipeline list to shared widget`
- List widget/Research People/Recycle/Pipeline/字段目录定向：`26/26`
- `npm test`：`1683/1683` 通过
- `node --test`：`2044/2044` 通过
- `node --check`（app.js、list-widget.js、sales_crm.js、business_page_filters.js、field_catalog.js）：通过
- `git diff --check`：通过

## 当前结论

customers、Research People、不对口记录与 Pipeline 已成为四个可回归的 List widget
样板；“所有列表页”仍未宣称完成。下一代码切片优先评估线索池/Intake 或另一套只读
授权列表，继续保持服务端授权字段与用户偏好分离。

## 回滚点

回退 `eb73388` 可移除本轮 Pipeline 列表 widget 接线、`pipeline` 字段目录、排序白名单
和表头兼容属性；前序 customers、Research People、不对口记录样板及通用 List widget
协议仍保留。生产目录保持只读。

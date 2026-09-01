# Phase E：Intake / lead_flow 线索列表迁移到 List widget

日期：2026-09-01

## 目标

继续执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，
将 Intake/lead_flow 线索池明细列表迁移到统一 List widget。

## 本轮范围

- `sales-assets/app.js`：线索池明细表接入授权列 schema、用户级
  `visibleColumns` / `columnOrder` / `sortPreset` 偏好、列设置面板与排序控件；
  保留手动选择、批量分配、领取、退回、查重核验、客户资料入口和审计信息等既有动作。
- `sales-crm.html` / `sales-assets/app.css`：增加 Intake 列设置和排序入口，保持原有筛选、
  分配栏、分页和移动端表格布局。
- `lib/intake_flow_filters.js` / `lib/sales_crm.js`：线索列表仅接受
  `status_priority`、`recent_update`、`company_asc`、`claim_due_asc` 四种服务端排序，
  非法排序统一返回 `SORT_NOT_AUTHORIZED`；排序仍在授权过滤范围内执行。
- `test/list_widget.test.js` / `test/issue116_business_page_api.test.js`：锁定 Intake
  widget 接线、字段目录、排序结果与非法排序拒绝；旧 Intake profile、选择与 AI 门控契约
  保持通过。

## 明确不在范围

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不新增 AI 内容、
  推荐或自动动作。现有 AI 列继续由既有 `technicalAIPresentationAllowed()` 门控。
- 不改变 Intake/lead_flow 的授权范围、筛选 AST、分页、分配/领取/退回/查重/审计语义。
- 不写入生产目录、生产数据库、远端分支或部署系统。

## 验证

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- after 分支：`codex/frontend-widget-pilot`
- 业务提交：`fffde40`（Intake 迁移）；兼容旧行属性的修复提交：`30d863c`
- Intake/lead_flow/Research People/Recycle/Pipeline/List widget/字段目录定向：`22/22`
- `npm test`：`1685/1685` 通过
- `node --test`：`2046/2046` 通过
- `node --check`（app.js、list-widget.js、intake_flow_filters.js、sales_crm.js、
  business_page_filters.js、field_catalog.js）：通过
- `git diff --check`：通过

## 当前结论

customers、Research People、不对口记录、Pipeline 与 Intake/lead_flow 已成为五个可回归的
List widget 样板；“所有列表页”仍未宣称完成。下一代码切片继续评估下一套只读授权列表，
并保持用户级布局与服务端授权字段分离。

## 回滚点

回退 `30d863c` 可移除 Intake/lead_flow 列表 widget 接线与四种排序白名单；前序 customers、
Research People、不对口记录、Pipeline 样板及通用 List widget 协议仍保留。生产目录保持只读。

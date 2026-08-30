# Session Checkpoint：阶段 C 次片——intake 页切字段级白名单

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`78e698b` → `5e992fe`

## 本轮切片

### `5e992fe` queryIntakeFlowPage 无 view_contacts 分支切换白名单
- 审计：`queryIntakeFlowPage`（intake/lead_flow 页面，`GET /api/sales-crm/lists/intake`）仍用递归 `redactContactFields` 黑名单；intake 无专用白名单投影。
- 收敛：
  - `access_control.js`：新增 `CONTACT_SAFE_INTAKE_KEYS`（29 键，镜像黑名单在 `crm_intake_items` 行保留的全部键）+ `contactSafeIntakeRecord`（`contactSafeStateRecord` 包裹，支持数组行集）+ 导出。
  - `intake_flow_filters.js`：`items = contactSafeIntakeRecord(items)`（import 同步）。
  - 隐藏面不变：`contact_name`/`contact_title`/`contact_methods`/`contact_level`/`evidence_urls`/`report_url`/`product_focus`/`decision_reason`/`return_reason` 继续不下发。
- 契约测试 `test/phase_c_intake_whitelist_contract.test.js`（3 断言）：
  - 结构：intake 页用白名单、不再用黑名单。
  - 等价：端点同款 intake 行（`i.*` + nickname/company_name/owner 派生列）上 `contactSafeIntakeRecord ≡ redactContactFields`（deepEqual）。
  - 行为：无 view_contacts 用户经 `GET /api/sales-crm/lists/intake` 看到业务字段（id/status/company_name/nickname/country）、无联系方式与决策字段。

## 测试证据

- 新契约 3/3；intake/lead_flow/权限/前端兼容回归 52/52。
- `node --test` 全量 `1949/1949`；`npm test` core `1588/1588`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `5e992fe` refactor(access): drive intake flow contact projection from a field whitelist

## 风险与回滚

- 行为保持：等价契约证明切换前后无 view_contacts 用户可见键集一致；隐藏面（联系方式/决策字段）不变。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容（`assistant.js`/`task_center.js` 的 `redactContactFields` 保持）。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 续：剩余 `redactContactFields` 路径评估收敛（通知副本 `business_page_filters.js:1253`、evaluation/alert payload `sales_crm.js:7022/9975/10631/11631`、db bootstrap `db.js:1564/1707`）。
3. 统一 `buildAccessContext` 与列表查询范围解释器；按页面落地"权限→字段→筛选"合同。
# Session Checkpoint：阶段 C 首片——accounts 列表切字段级白名单

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`929b8c1` → `78e698b`

## 本轮切片

### `78e698b` listCustomerAccounts 无 view_contacts 分支切换白名单
- 审计发现：`contactSafeAccountRecord`（字段级账户白名单，`CONTACT_SAFE_ACCOUNT_KEYS` = FIELDS_CATALOG 派生 + 显式业务键）**定义但从未接线**；`listCustomerAccounts`（accounts 列表端点核心路径）仍用递归 `redactContactFields` 黑名单。
- 收敛：
  - `access_control.js`：`CONTACT_SAFE_ACCOUNT_KEYS` 补 `istestdata`/`testrunid` 两键（黑名单保留的非敏感列，切换需逐键等价）。
  - `sales_crm.js`：`listCustomerAccounts` 的 `: redactContactFields(rows)` → `: contactSafeAccountRecord(rows)`。
- 契约测试 `test/phase_c_account_whitelist_contract.test.js`（3 断言）：
  - 结构：`listCustomerAccounts` 用白名单、不再用黑名单。
  - 等价：端点同款行（crm_accounts 全列投影 + pool/owner/creator 派生列 + customerTags）上 `contactSafeAccountRecord ≡ redactContactFields`（deepEqual）。
  - 行为：无 view_contacts 销售经 API 看到业务字段（stage/lifecycle/assignment/company_name/customerTags）、无联系方式（email/phone/contact/notes/summary）与 state DTO。

## 背景

阶段 C（权限/筛选/字段）"页面覆盖未完成"：主账户路径是最大缺口。白名单设计即"mirror 黑名单在账户行保留的键"，本片让账户页走上显式字段 schema（权限→字段→筛选）。黑名单/白名单差异点核对：白名单顶层数组映射、嵌套数组原样保留（customerTags 等价）、`state` 特判（账户行已无 state，no-op）。

## 测试证据

- 新契约 3/3；白名单/投影/前端兼容/账户列表回归 60/60。
- `node --test` 全量 `1946/1946`；`npm test` core `1585/1585`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。
- `sales_crm.js` 13,003 行；`access_control.js` +2 键。

## 提交

- `78e698b` refactor(access): drive the accounts list contact projection from the field whitelist

## 风险与回滚

- 行为保持：等价契约证明切换前后无 view_contacts 用户可见字段集合逐键一致；唯一新增是显式 schema 约束（未来新敏感字段进 catalog 后仍受控）。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 续：剩余 `redactContactFields` 路径评估收敛（intake items `intake_flow_filters.js:472`、通知副本 `business_page_filters.js:1253`、evaluation/alert payload `sales_crm.js`、bootstrap `db.js`——AI 相关 `assistant.js`/`task_center.js` 除外）。
3. 统一 `buildAccessContext` 与列表查询范围解释器；按页面落地"权限→字段→筛选"合同。
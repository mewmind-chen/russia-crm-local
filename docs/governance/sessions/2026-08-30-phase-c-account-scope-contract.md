# Session Checkpoint：阶段 C 范围解释器统一（等价契约）

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`38bfe7d` → `2ca107b`

## 本轮切片

### `2ca107b` accountScope ≡ buildAccessContext 账户可见性等价契约
- `accountScope`（business_page_filters，每页 SQL 条件集）与 `buildAccessContext`（access_control，accountIds 集合）此前**独立实现同一账户可见性门控**（view_all_customers/manage_intake/owner_id/assignment_returned/lifecycle_active/test_data），易漂移。
- 契约测试 `test/phase_c_account_scope_contract.test.js`（2 断言）：
  - 等价：对异质 fixture（returned + test-data + recycled 账户）跨 sales-only / view_all+intake / view_all-intake 三种权限组合，断言 `accountScope` 选中账户集 == `buildAccessContext.accountIds`（SQL 条件集与 ID 集一致）。
  - 语义：test-data 与 recycled 对 view_all 均排除，returned 对 view_all+manage_intake 仍可见——两解释器行为点核对。
- **代码级去重延后**：`buildAccessContext` 用 PRAGMA 守卫兼容缺失 `lifecycle_status`/`is_test_data` 列的老 schema，`accountScope` 硬编码条件；强制合并有回归风险。以等价比对契约为护栏，先锁行为一致，待确定安全共享 helper 落点再做去重。

## 测试证据

- 新契约 2/2；全量 `node --test` `1957/1957`；core `1596/1596`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `2ca107b` refactor(access): lock list-scope/buildAccessContext account-visibility equivalence

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 剩余：按页面"权限→字段→筛选"合同测试、范围解释器代码级去重（待安全落点）、可选残值（legacy customers 形状白名单）。P1/P3/S5 暂缓已记录。
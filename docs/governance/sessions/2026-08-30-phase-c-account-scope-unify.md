# Session Checkpoint：阶段 C 范围解释器代码级统一

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`45e0c05` → `f2056e5`

## 本轮切片

### `f2056e5` 范围解释器代码级去重
此前 `buildAccessContext`（accountIds 集）与 `accountScope`（每页 SQL 条件集）各自维护同一套账户可见性门控，仅靠 `2ca107b` 的等价契约防漂移。本片把共享逻辑提炼为 `accountVisibilityScope(user, alias, options)`，两个调用方统一委托：

1. **`buildAccessContext`** 传入 PRAGMA 实际列存在性（`tableHas.lifecycle/testData`），保持老 schema 优雅降级语义。
2. **`business_page_filters.accountScope`** 委托共享解释器，默认表均含生命周期/测试数据列，与原内联版逐字等价。

契约测试 `phase_c_account_scope_contract` 新增结构断言：accountScope 必须委托、buildAccessContext 必须复用共享解释器且不再自行分支可见性。

### 回归中发现并修复的真 bug：空 WHERE 子句
全量回归中 `test/ai_control_plane.test.js` 的"6 worker 并发/全局槽位"测试稳定失败（worker loop exhausted）。二分归因（stash 两个 lib 改动后测试恢复全绿）确认与 lib 改动相关，追到因果链：worker 每次执行 job 都经 `executionIdentity` 调 `buildAccessContext`。

根因：AI 测试 fixture 的 `crm_accounts` 表**没有** `lifecycle_status`/`is_test_data` 列，原实现 `WHERE 1=1${activeClause}${testDataClause}` 空子句时退化为 `WHERE 1=1` 合法；新实现把 `conditions=[]` 直接拼成 `WHERE `（空），SQL 语法错误 → 身份校验抛错 → job 被 block → pending 永不归零 → 500 次 worker 循环耗尽。

修复：`accountVisibilityScope` 以 `'1=1'` 为条件基底，空条件时仍产出合法 SQL，且对两个调用方语义不变。

## 测试证据

- 新契约 3/3（等价 2 + 结构 1）；AI 控制面 `ai_control_plane` 7/7（修复后）。
- 相关回归：phase_c_* + ai_control_plane + domain_facades + issue209 + issue116 = 34/34。
- `node --test` 全量 `1961/1961`；`git diff --check` 通过；模块加载正常；工作区干净。

## 提交

- `f2056e5` refactor(access): unify account visibility scope interpreter

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 C 剩余：可选残值（legacy customers 形状白名单，S6 审计确认其余联系形状已源头门控）。P1/P3/S5 已判定暂缓。
3. 进入阶段 D：商业闭环（rfq→quote→order）领域边界成型；或阶段 E widget 注册表。

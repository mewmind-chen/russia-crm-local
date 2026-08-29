# Session Checkpoint：阶段 A-assignment 域首刀 — 线索账户关联判定

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`4c8f8f8` / `pilot/commerce-rules-v1`

## 本次范围

assignment 域首刀：把 intake 与账户的“当前归属 / 可复用已退回账户”判定抽离。

## 迁移内容

- 新增 `lib/domains/assignment/link.js`：
  - `isCurrentIntakeAccount(account, item)`：根据 intake_item_id / crm_customer_id 判定当前关联
  - `isReturnedAccountForIntake(account, item)`：已退回/回收销售退回判定
  - `reusableReturnedAccountForIntake(accounts, item)`：可复用 returned/sales_return 账户选择
- `sales_crm.js` 改为命名空间转发。

## 行为保证

- 当前关联判定、returned 账户复用规则、sales_return 回收例外与原实现一致。

## 测试

- 新增 1 项 assignment 契约测试；本分部测试 35/35 通过。
- 全量 `node --test` 1455/1455 通过。

## 提交与回滚

- 提交：`c5e4a75 refactor(assignment): extract intake account linkage predicates`
- Tag：`pilot/assignment-link-v1`
- 工作区 clean，未 push。

## 进度全景

| 域 | 刀数 | 模块 |
|---|---|---|
| customer（A-3） | 6 | normalize / recycle / create / summary / contacts |
| activity（A-6） | 4 | present / progress / serialize / request |
| planning | 3 | streak / alerts / risk |
| intake | 2 | query / owner |
| commerce | 1 | rules |
| assignment | 1 | link |

## 下一步

assignment 继续（`manualAssignment*` / `chooseIntakeOwner`周边、`bulkAssignAccounts` 的纯判定）或进入 recon / contact 域。
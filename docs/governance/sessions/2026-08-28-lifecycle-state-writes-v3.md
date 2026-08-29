# Session Checkpoint：阶段 D-2c 商务、恢复与分配状态写入迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`f9e79b5` / `pilot/lifecycle-state-writes-v2`

## 本次范围

继续阶段 D-2，使用既有 `lib/domains/lifecycle/state_write.js` 约束更多客户主状态写入；不改变 API、权限、错误码、幂等、schema、SQLite trigger 或 AI。

## 迁移内容

- 报价完成：`stage='quoted'` 通过 shim 写入。
- 订单完成：`stage='won'` 或 `stage='repeat'` 通过 shim 写入。
- 领取时恢复已退回 CRM 账户：`lifecycle_status='active'`、`assignment_status='claimed'`、`owner_id` 通过 shim 写入。
- 手工删除客户恢复：`lifecycle_status='active'`、`assignment_status='claimed'/'unassigned'`、`owner_id` 通过 shim 写入。
- 回收客户重新分配：`lifecycle_status='active'`、`assignment_status='assigned'`、`owner_id` 通过 shim 写入。
- 普通批量分配：账户逐行通过 shim 写入 `owner_id`、`assignment_status`。

## 保留独立写入

- `next_action`、`next_action_at`
- `manager_status`
- RFQ、报价、订单事实表字段
- intake 明细状态、分配字段和审计字段
- recycle 元数据和 previous owner 字段

## 验证

- D-2c 相关专项：22/22 通过。
- 全量 `node --test`：1395/1395 通过。
- `git diff --check`：通过。
- linter：无错误。

## 提交与回滚

- 提交：`e0d6bfe refactor(lifecycle): migrate commerce and recovery state writes`。
- Tag：`pilot/lifecycle-state-writes-v3`。
- 工作区仅使用隔离 worktree，未触碰生产数据库。

## 下一步

盘点剩余客户创建、手工编辑、异常回收和历史迁移写入；确认是否需要把状态 patch 与 intake 双表更新封装为同一领域事务函数。继续保持 `manager_status` 与 `next_action` 独立。

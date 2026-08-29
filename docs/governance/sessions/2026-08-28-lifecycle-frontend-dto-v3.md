# Session Checkpoint：阶段 E-3 漏斗/回收页阶段显示迁移

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`dc1a026` / `pilot/lifecycle-frontend-dto-v2`

## 本次范围

继续阶段 E：把漏斗（pipeline）行动行与回收资料页的阶段显示迁移到统一 `state` DTO。

## 迁移内容

- `accountStageOf(account)` 扩展到：
  - 漏斗行动行：`stageLabel || stageLabel(accountStageOf(account))`。
  - 回收资料页原阶段：`stageLabel(accountStageOf(account))`。
- 数据源无 `state` 的场景（活动、候选人、团队、insight）保持回退到 `account.stage`。

## 行为保证

- 有 `stage` 字段时优先原值；缺失/脏数据时回退投影默认 `new`。
- 回收资料页 `account` 无 `state`，回退安全。

## 测试

- 更新前端契约守卫，断言漏斗行模板与回收页使用 `accountStageOf`。
- 修正一处正则括号数量。
- 专项 32/32 通过；全量 `node --test` 1414/1414 通过。

## 提交与回滚

- 提交：`5de312b feat(lifecycle): use state DTO for pipeline and recycle stage display`
- Tag：`pilot/lifecycle-frontend-dto-v3`
- 工作区 clean，未 push。

## 现状

客户列表、抽屉、漏斗、回收资料页的阶段/生命周期/经理状态显示均优先消费统一 `state` DTO。剩余（活动模态、候选人、团队）数据源未附加 `state`，保持原路径。下一步可做字段级白名单投影（替换 `CONTACT_KEYS` 黑名单）。

# Session Checkpoint：阶段 A-intake 域第二刀 — 确定性负责人选择

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`ad7cfec` / `pilot/intake-query-v1`

## 本次范围

把仲裁回退用的确定性负责人选择抽离到 intake 域。

## 迁移内容

- 新增 `lib/domains/intake/owner.js`：`chooseIntakeOwner(candidate, users, loadByOwner, dailyByOwner, quota)`
  - 销售角色/活跃/配额过滤
  - 国家经验、俄/葡/西语、渠道匹配、负荷均衡计分
  - 稳定排序（score desc → load asc → userId）
- 复用 `customer/normalize.normalizeCountry`；内部 JSON 解析 helper 与原模块一致。
- `sales_crm.js` 改为命名空间转发。

## 修正

编辑时发现 `intakeQuery` 命名空间 require 被重复声明（上一刀遗留），已去重。

## 行为保证

- 计分权重、原因文案、平手排序与仲裁回退完全一致。

## 测试

- 新增 chooseIntakeOwner 契约测试（国家/语言/渠道加分、角色与活跃过滤、无匹配按负荷均衡）。
- 本分部测试 31/31 通过；全量 `node --test` 1451/1451 通过。

## 提交与回滚

- 提交：`96f595f refactor(intake): extract deterministic owner selection`
- Tag：`pilot/intake-owner-v1`
- 工作区 clean，未 push。

## 下一步

intake 继续（`buildIntakeQueryScope`/`hydrateDuplicateLinkFields`/`applyIdentityConflictResolution`）或进入 assignment 域。
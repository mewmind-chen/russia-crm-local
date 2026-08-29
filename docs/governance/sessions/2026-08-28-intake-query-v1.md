# Session Checkpoint：阶段 A-intake 域首刀 — 查询参数规范化

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`56dbba9` / `pilot/planning-risk-v1`

## 本次范围

intake（线索池）域首刀：把查询参数规范化抽离，使线索筛选共享同一路径。

## 迁移内容

- 新增 `lib/domains/intake/query.js`：
  - `intakeQueryValues`：值集去重裁剪
  - `intakeQueryBoolean`：1/true/yes/on 与 0/false/no/off 布尔映射，否则 null
  - `intakeQueryDate`：YYYY-MM-DD 校验与日末时间补全
- `sales_crm.js` 三个函数改为命名空间转发。

## 行为保证

- 值集去重（大小写敏感）、布尔判定、日期格式化与原实现一致。

## 测试

- 新增 2 项 intake 契约测试；本分部测试 30/30 通过。
- 全量 `node --test` 1450/1450 通过。

## 提交与回滚

- 提交：`ad7cfec refactor(intake): extract query parameter normalization`
- Tag：`pilot/intake-query-v1`
- 工作区 clean，未 push。

## 进度全景（阶段 A 域拆分）

| 域 | 已抽刀数 | 模块 |
|---|---|---|
| identity/filter（A-1） | 既有 | domains/identity, domains/filter |
| customer（A-3） | 6 | normalize / recycle / create / summary / contacts |
| activity（A-6） | 4 | present / progress / serialize / request |
| planning | 3 | streak / alerts / risk |
| intake | 1 | query |

`sales_crm.js` 摊位显著收敛；仍有 schedule/commerce/contact/recon/delivery/recycle 域待拆。

## 下一步

intake 继续（`chooseIntakeOwner`/`buildIntakeQueryScope`/`hydrateDuplicateLinkFields`）或进入 assignment 域。
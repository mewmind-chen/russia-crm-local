# Session Checkpoint：阶段 A-6 activity 域第三刀 — 活动记录序列化

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`e594eb0` / `pilot/activity-progress-v1`

## 本次范围

把活动行公开序列化（`publicActivityRecord`/`publicActivityRecords`）抽离到 activity 域，供 list/bootstrap/timeline 共用。

## 迁移内容

- 新增 `lib/domains/activity/serialize.js`：
  - `publicActivityRecord(row, visibleActivityIds)`：剥离 `superseded_by`/`provenance` 后补 expose 字段（externalCustomerId/progressType/reactionSnapshot/nextAction/managerRequired/noPlan/supersededBy/effective/provenance）
  - `publicActivityRecords(rows)`：共享可见 id 集后逐行序列化
- 复用本域 `present.legacyProgressKey`/`scopedActivityProvenance` 与 schema 的 `crm_activity_effective.isEffectiveActivity`。
- `sales_crm.js` 两个函数改为 `activitySerialize.*` 转发。

## 行为保证

- 序列化逐字段与黑名单原实现一致；原始 snake_case 键随 `...publicRow` 保留；`supersededBy` 仅在替换 id 可见时暴露。

## 测试

- 新增 2 项 serialize 契约测试（单行字段映射/provenance 裁剪、批内共享 id 集合）。
- 活动/customer 域测试 21/21 通过；全量 `node --test` 1441/1441 通过。

## 提交与回滚

- 提交：`61cc77d refactor(activity): extract public activity serialization`
- Tag：`pilot/activity-serialize-v1`
- 工作区 clean，未 push。

## 下一步

activity 域已 3 刀（present/progress/serialize）。可继续反应解析 `resolveActivityReaction` 或进入 planning 域。
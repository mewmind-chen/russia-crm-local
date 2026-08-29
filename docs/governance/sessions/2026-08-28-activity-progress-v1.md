# Session Checkpoint：阶段 A-6 activity 域第二刀 — 进展规格解析

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`a013621` / `pilot/activity-present-v1`

## 本次范围

把活动进展阶段常量与请求规格解析抽离到 activity 域，保持 legacy 校验消息不变。

## 迁移内容

- 新增 `lib/domains/activity/progress.js`：
  - `ACTIVITY_STAGE` / `PROGRESS_TYPE_MAP`（进展 → 类型/渠道/阶段）
  - `LEGACY_ACTIVITY_TYPES` / `LEGACY_ACTIVITY_CHANNELS`
  - `resolveActivityRequestSpec(payload, { badRequest })`：现代 progressType 分支（`legacy:false`）与 legacy activityType/channel 分支（`legacy:true`，复用 present.legacyProgressKey）
- `sales_crm.js` 四个常量改为命名空间引用，`resolveActivityRequestSpec` 改为注入 `badRequest` 的转发。

## 关键修正

预写版本臆造了 activityType 分支逻辑（note 特判、schema 化错误），已还原为逐字原逻辑：`LEGACY_ACTIVITY_TYPES.has` / `LEGACY_ACTIVITY_CHANNELS.has` 校验与 `legacy` 标志（progressType=false / legacy=true）。

## 行为保证

- 现代/legacy 两条解析路径的返回形状与错误消息（不支持的本次进展类型 / 请选择有效的本次进展 / 不支持的进展渠道）不变。

## 测试

- 新增 3 项 progress 契约测试（modern 分支、legacy 校验分支、常量映射）。
- activity/customer 域测试 19/19 通过；全量 `node --test` 1439/1439 通过。

## 提交与回滚

- 提交：`e594eb0 refactor(activity): extract progress spec resolution`
- Tag：`pilot/activity-progress-v1`
- 工作区 clean，未 push。

## 下一步

activity 域继续：请求判定/反应解析（`resolveActivityReaction` 纯逻辑部分）、活动记录序列化 `publicActivityRecord` 按同模式抽离。
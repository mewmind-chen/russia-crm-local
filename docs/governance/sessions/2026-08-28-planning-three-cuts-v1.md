# Session Checkpoint：阶段 A-planning 域三刀 — 无计划连击/告警聚合/计划风险

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`51159a8` / `pilot/activity-request-v1`

## 本次范围（自执行批次，持续完成任务）

进入 planning 域，抽离三块纯函数：无计划连击、告警排序/分组、计划风险兜底帧。

## 迁移内容

1. **`lib/domains/planning/streak.js`**：`noPlanStreakForActivities`（尾部连续 no_plan 计数 + 起点 id），复用 `crm_activity_effective.isEffectiveActivity`，过滤测试数据。Tag `pilot/planning-streak-v1`。
2. **`lib/domains/planning/alerts.js`**：`ALERT_REASON_ORDER`、`reasonOrder`（OVERDUE 高优特判）、`urgencyFor`、`groupAlerts`（external/customer/intake 分组键、overdue-claim 语义合并、轻重缓急排序）。Tag `pilot/planning-alerts-v1`。
3. **`lib/domains/planning/risk.js`**：`emptyCustomerPlanRisk`（无风险兜底帧）。Tag `pilot/planning-risk-v1`。

`sales_crm.js` 对应函数与常量改为命名空间转发。

## 行为保证

- 连击计数/排序、告警分组键/合并/排序、风险兜底字段全部与原实现一致。

## 测试

- 新增 5 项契约测试；本分部测试 28/28 通过。
- 三次全量 `node --test` 分别 1445 / 1447 / 1448 全通过。

## 提交与回滚

- `649c72f` + `pilot/planning-streak-v1`
- `b4ce730` + `pilot/planning-alerts-v1`
- `56dbba9` + `pilot/planning-risk-v1`
- 工作区 clean，未 push。

## 下一步

planning 域继续（`deferAccountPlan`/`todayTaskRequestSpec`/`managerAssistanceRecipientIds` 等）或进入 intake 域。
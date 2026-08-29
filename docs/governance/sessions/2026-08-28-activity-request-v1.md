# Session Checkpoint：阶段 A-6 activity 域第四刀 — 反应请求解析

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`61cc77d` / `pilot/activity-serialize-v1`

## 本次范围

把活动反应的请求解析（标准选项 id / 文字 key / 自定义）抽离到 activity 域，DB 访问经注入回调。

## 迁移内容

- 新增 `lib/domains/activity/request.js`：`resolveActivityReaction(payload, { badRequest, conflictError, findReactionById, findReactionByKey })`
  - 自定义分支：与标准选项互斥 + `normalizeActivityReactionName` 校验
  - 标准 id 分支：`ACTIVITY_REACTION_STALE`
  - 文字 key 分支：无效反应 / 与选项不一致
  - 缺省返回 `{ id: '', name: '' }`
- `sales_crm.js` 转发并注入两条 SQL 回调，删除本地实现。
- `present.normalizeActivityReactionName` 经 options 透传 badRequest。

## 行为保证

- 四分支错误状态码/错误码/消息不变；返回形状不变。

## 测试

- 新增 2 项 reaction 契约测试（custom/by-id/by-key/无输入、stale/invalid/mismatch）。
- activity/customer 域测试 23/23 通过；全量 `node --test` 1443/1443 通过。

## 提交与回滚

- 提交：`51159a8 refactor(activity): extract reaction request resolution`
- Tag：`pilot/activity-request-v1`
- 工作区 clean，未 push。

## 下一步

activity 域已 4 刀（present/progress/serialize/request）。可进入 planning 域或继续 activity 幂等 `activityActionRequest` 内部哈希。
# Session Checkpoint：阶段 E-5 漏斗行白名单投影

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`9607123` / `pilot/lifecycle-account-whitelist-v1`

## 本次范围

把漏斗（pipeline）行动行也切换到字段级白名单投影，完成"账户行类"读取路径的脱敏统一。

## 迁移内容

- `CONTACT_SAFE_PIPELINE_KEYS` = 账户行白名单 ∪ 漏斗附加键（反应/进展/队列/计数）。
- `contactSafePipelineRecord` 复用账户行的 `state` 裁剪逻辑（隐藏 `nextAction.text`）。
- `listPipelineRows` 无 `view_contacts` 时改用白名单投影。

## 行为保证

- 白名单与黑名单对 pipeline 行输出严格等价（除 `state` DTO 外），由契约测试锁定。
- 反应/队列/星标字段继续可见，叙述文本与下一步动作隐藏。

## 测试

- 新增 `pipeline whitelist projection keeps reaction and queue fields like the blacklist`。
- 权限/过滤/漏斗/bootstrap 专项 82/82 通过；全量 `node --test` 1416/1416 通过。

## 提交与回滚

- 提交：`b6fd039 feat(lifecycle): whitelist pipeline rows on contact-restricted reads`
- Tag：`pilot/lifecycle-pipeline-whitelist-v1`
- 工作区 clean，未 push。

## 现状

客户列表、bootstrap、漏斗三类账户行读取已全部使用白名单投影；活动、时间线、评价、profile、alerts 等实体仍用黑名单，留待后续切片。下一步可按字段目录 schema 生成每页可见字段白名单。

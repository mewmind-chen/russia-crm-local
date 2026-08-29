# Session Checkpoint：阶段 E-4 账户行白名单投影

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`5de312b` / `pilot/lifecycle-frontend-dto-v3`

## 本次范围

阶段 E 字段投影收口第一步：把 CRM 账户行的脱敏从 `CONTACT_KEYS` 黑名单替换为字段级白名单投影。

## 新增能力

- `lib/access_control.js` 新增 `CONTACT_SAFE_ACCOUNT_KEYS` 显式白名单键集。
- 新增 `contactSafeAccountRecord(value)`：顶层按白名单过滤，支持数组；`state` DTO 保留结构但隐藏 `nextAction.text`（与黑名单递归隐藏叙述文本的语义一致）。
- identity facade 转发 `contactSafeAccountRecord`。

## 迁移内容

- 客户列表（`listCustomerAccounts`）与 bootstrap `accounts` 在无 `view_contacts` 时改用白名单投影。
- 活动、时间线、intake、报告等其他记录仍使用原黑名单（本切片不动）。

## 行为保证

- 白名单与黑名单对账户行输出严格等价（除 `state` DTO 有意保留结构、隐藏 nextAction 文本外），由契约测试锁定。
- 新敏感账户字段默认不下发（白名单显式枚举）。

## 测试

- 新增 `account whitelist projection matches the legacy blacklist apart from the state DTO`。
- 触发回归发现并修复：白名单曾泄露 `state.nextAction.text`（黑名单会递归删除），已隐藏。
- 权限/过滤/bootstrap 专项 74/74 通过；全量 `node --test` 1415/1415 通过。

## 提交与回滚

- 提交：`9607123 feat(lifecycle): whitelist account rows on contact-restricted reads`
- Tag：`pilot/lifecycle-account-whitelist-v1`
- 工作区 clean，未 push。

## 下一步

继续字段投影收口：活动/时间线/intake/报告等其他读取路径逐步切换白名单，或按字段目录 schema 生成每页可见字段白名单。

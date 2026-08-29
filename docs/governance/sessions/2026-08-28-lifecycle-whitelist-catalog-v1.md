# Session Checkpoint：阶段 E-6 白名单与字段目录对齐

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`b6fd039` / `pilot/lifecycle-pipeline-whitelist-v1`

## 本次范围

让账户行白名单的"可见字段"部分由字段目录（field_catalog）驱动，实现新增显示字段跟随目录、敏感字段永不泄露。

## 迁移内容

- `access_control.js` 引入 `FIELDS_CATALOG`，提取 `crm_drawer` + `customer_profile` 的 `sourceKey` 归一化集合。
- 过滤命中 `CONTACT_KEYS` 的敏感键后并入 `CONTACT_SAFE_ACCOUNT_KEYS`。
- 结构性业务键（id、external_customer_id、状态、负责人、时间、state、标签等）仍显式保留。

## 行为保证

- 与黑名单输出的等价性不变（等价测试继续锁定）。
- 新显示字段加入字段目录后自动进入白名单；新增敏感字段（含 email/phone/产品/叙述）默认不可见。
- 修复 `external_customer_id` 回归：该键不在目录页字段中，恢复为显式结构键。

## 测试

- 账户/漏斗白名单等价测试通过；权限/过滤/bootstrap 专项 75/75 通过。
- 全量 `node --test` 1416/1416 通过。

## 提交与回滚

- 提交：`a55dba3 feat(lifecycle): align account whitelist with field catalog`
- Tag：`pilot/lifecycle-whitelist-catalog-v1`
- 工作区 clean，未 push。

## 现状

账户行脱敏 = 字段目录可见字段 ∪ 显式结构键，敏感字段全部隐藏。下一步可将活动/时间线等其余读取路径的白名单也目录化，或扩展字段目录覆盖更多页面。

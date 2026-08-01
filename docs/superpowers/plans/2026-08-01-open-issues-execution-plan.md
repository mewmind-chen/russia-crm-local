# 现有 Issue 受控双轨并行实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在排除 #104 的前提下完成 #96、#168、#169、#170、#171、#172、#174，并以 #173 完成销售、主管、老板三角色端到端验收和生产发布。

**架构：** 轨道 A 负责数据一致性、身份注册表、暂未确定计划、主管任务、有效活动和更正事务；轨道 B 基于已合并契约负责移动端、管理员界面、业务流程界面、团队状态和最终验收。大型 `lib/sales_crm.js` 保持现有 API 兼容，通过专用服务模块降低共享文件冲突。数据库迁移全部只增不删，新增写入先受开关控制。

**技术栈：** Node.js 22、Express、SQLite/better-sqlite3、原生 HTML/CSS/JavaScript、Node `node:test`、GitHub CLI、Mac launchctl。

## 全局约束

- 所有实现分支从当时最新 `origin/main` 创建，禁止从落后或带本地修改的主工作树创建。
- 本计划评估基线为 `47a882e06f87b16d2959a13d2a3fdb26b8831a32`；执行时先确认没有新合并改变依赖关系。
- #104 不参与开发、合并、部署和验收。
- 迁移只增不删，必须幂等，并同时在空数据库和生产数据库副本上验证。
- 销售只能读取本人权限范围；汇总、导出、AI 和直接 API 都不得绕过后端范围。
- 下一步计划和再次复查时间必须晚于业务时区当前时间；历史实际发生时间可以按权限补录过去时间。
- 被更正原活动不参与业务计算，但时间线和审计继续显示原记录与替代关系。
- 桌面端和 320/375/390/430px 均不得出现页面级横向滚动、裁切操作或控制台错误。
- 每个 PR rebase 到最新 `origin/main` 后运行聚焦测试和 `npm test -- --test-concurrency=1`。
- 每个生产 release 先备份 SQLite，再验证本地/公网 `/healthz` SHA、数据库完整性、权限和真实操作。
- 新增写入开关固定为 `CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED=false`、`CRM_DEFERRED_PLAN_WRITES_ENABLED=false`、`CRM_ACTIVITY_CORRECTIONS_ENABLED=false`；首次部署保持关闭，生产读取和权限冒烟通过后逐项启用。

## 子计划

1. [基础、#169、#96、#168](2026-08-01-foundation-tasks-plan.md)
2. [#172 合作客户保护名单与身份唯一](2026-08-01-protected-customers-plan.md)
3. [#170 暂未确定计划与主管介入](2026-08-01-deferred-plan-workflow-plan.md)
4. [#171 跟进记录更正](2026-08-01-activity-correction-plan.md)
5. [#174 团队状态、#173 验收与部署](2026-08-01-team-status-release-plan.md)

## 受控双轨调度

```text
轨道 A（后端/数据）          轨道 B（前端/验收）
#96 状态唯一性        <->   #168 今日待办移动端
        |                       |
        +---- #96 先合并 -------+
                #168 rebase 后合并
                        |
#172-A -> #172-B        ->   #172-C
                        |
#170-A -> #170-B        ->   #170-C
                        |
#171-A -> #171-B        ->   #171-C
                        |
#174 数据               ->   #174 UI
                        |
                     #173 验收
```

允许的并行窗口：

- #96 后端和 #168 前端可以同时开发，但 #96 先合并，#168 随即 rebase、全量测试后合并。
- #172-A 的只读预检和测试可以与 #96/#168 同时准备，但集成必须等待 #96。
- #170、#171、#174 可以提前准备测试夹具与验收脚本，正式实现必须等待各自前置契约。
- 不允许 #170 与 #171 同时修改活动、计划、提醒和统计后端。
- 不允许 #172 与 #171 以两个完整全栈分支并行；#171 必须消费 #172 的保护身份契约。

## 固定 PR 与发布顺序

```text
#169
-> #96
-> #168
-> #172-A -> #172-B -> #172-C
-> #170-A -> #170-B -> #170-C
-> #171-A -> #171-B -> #171-C
-> #174 数据 -> #174 UI
-> #173 验收/集成修复
```

每个前置 PR 合并后，下游执行：

```bash
git fetch origin main
git rebase origin/main
npm test -- --test-concurrency=1
pr_number="$(gh pr view --repo mewmind-chen/russia-crm-local --json number --jq .number)"
gh pr checks "$pr_number" --repo mewmind-chen/russia-crm-local
```

预期：rebase 无冲突，测试全部通过，checks 全部为 `PASS`。失败时暂停后续合并和部署。

## 分支命名

```text
codex/execution-foundation
codex/issue-169-contact-lead-copy
codex/issue-96-intake-crm-invariant
codex/issue-168-today-task-mobile
codex/issue-172a-identity-preflight
codex/issue-172b-protected-customer-lifecycle
codex/issue-172c-protected-customer-ui
codex/issue-170a-deferred-plan-state
codex/issue-170b-manager-intervention
codex/issue-170c-deferred-plan-ui
codex/issue-171a-effective-activity
codex/issue-171b-activity-correction
codex/issue-171c-correction-ui
codex/issue-174-team-status-data
codex/issue-174-team-status-ui
codex/issue-173-e2e-acceptance
```

## 完成定义

- #96、#168、#169、#170、#171、#172、#174 分别满足 Issue 正文与评论的验收标准。
- #173 完成销售、主管、老板三条真实工作流，并提交截图、数据前后对照、权限、失败、重试和刷新证据。
- 生产环境报告预期最终 SHA，SQLite `integrity_check` 为 `ok`、`foreign_key_check` 无行。
- 原 Issue 正文与评论中的确认需求都能映射到一个子计划任务或 #173 验收条目。
- #104 保持不变。

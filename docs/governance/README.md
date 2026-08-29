# TradePulse 重构治理入口

更新时间：2026-08-29

本目录是 TradePulse 重构的现行治理入口。它描述“现在从哪里继续、哪些事实已验证、哪些事项仍未完成”。聊天记录和历史交接不能替代这里的当前状态。

## 权威性顺序

1. 当前 Git、代码与测试的可复现实证。
2. `CURRENT_STATE.md` 中最近一次核验结果。
3. `PROJECT_CHARTER.md`、`GOAL_PROMPT.md` 与 `WORK_PROTOCOL.md` 的长期边界。
4. 其余专题设计文档。
5. `sessions/` 中的历史 checkpoint。

发生冲突时，先停止实现并重新核验，不按较旧文档继续执行。

## 当前目录

| 用途 | 路径 | 规则 |
|---|---|---|
| 中心 clone | `/Users/ylf/Desktop/projects/tradepulse-refactor/repo` | 只同步远端和管理 worktree，不开发业务代码 |
| 重构前基线 | `/Users/ylf/Desktop/projects/tradepulse-refactor/before` | `baseline/pre-refactor@57c4c42`，只读对照 |
| 当前重构代码 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after` | `codex/frontend-widget-pilot`，后续重构唯一开发入口 |

旧目录 `/Users/ylf/Desktop/projects/tradepulse-development` 已退出当前重构治理范围，仅作为迁移来源保留，不再写入。生产目录不属于本工作区。

## 每次恢复工作时必读

1. `GOAL_PROMPT.md`
2. `CURRENT_STATE.md`
3. `WORK_PROTOCOL.md`
4. 最新的 `sessions/*.md`
5. 当前任务对应的专题文档

## 文档分工

- `CURRENT_STATE.md`：唯一滚动更新的进度、Git 和测试状态。
- `REPOSITORY_MAP.md`：目录职责、代码入口和开发边界。
- `REFACTOR_ROADMAP.md`：长期阶段、门禁和当前恢复点。
- `DECISION_LOG.md`：已经作出的关键决策，不覆盖旧决策。
- `RISK_REGISTER.md`：仍需管理的风险与动作。
- `sessions/`：一次工作过程的不可变证据；历史路径按当时事实保留。

## 历史记录规则

`sessions/` 内 2026-08-27、2026-08-28 的旧路径属于历史证据，不批量改写。2026-08-29 的工作区迁移记录建立了新旧路径边界；该日期之后的 session 必须使用 `tradepulse-refactor` 路径。

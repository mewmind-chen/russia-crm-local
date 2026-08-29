# Session Checkpoint：阶段 A 接线恢复批 7-13（A 组 14 模块 + B 组全部落地，接线恢复完成）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`af770f5` → `5c23b32`（批 7-13，7 个提交）

## 本轮切片（7 个提交）

| 提交 | 接线模块 | 形态 |
|---|---|---|
| `e9f29d0` | `activity/present`（7 helper） | 4 纯函数 drop-in + 3 注入式（10 调用点注入 `{ badRequest }`）；`PIPELINE_ACTION_QUEUE_KEYS` 随接线移入域模块 |
| `dab8168` | `customer/dedupe`（4 helper） | 逐字一致 drop-in；`canonicalDomain`/`canonicalHostname` 孤儿 import 移除 |
| `8a0ee7d` | `auth/user` safeUser、`intake/owner` chooseIntakeOwner、`insights/evaluation`（4 helper） | 逐字一致 drop-in |
| `47daed9` | `customer/normalize`（4 helper） | normalizeCountry 纯函数 drop-in + 3 注入式（6 调用点注入 `{ badRequest }`） |
| `f5eb7f2` | `activity/progress`（4 常量 + resolveActivityRequestSpec） | 常量逐字一致；resolveActivityRequestSpec 注入式（recordActivity 注入 `{ badRequest }`）；ACTIVITY_STAGE 仍经 exports 导出 |
| `0fcbf71` | `activity/request` resolveActivityReaction | 域版注入式 findReactionById/findReactionByKey 隔离 SQL，调用点注入闭包 |
| `5c23b32` | `customer/create`、`filter/errors`、`planning/today_task` | 注入式错误构造，调用点注入 `{ error: httpError }`/`{ httpError }`/`{ parseBusinessDateTime }` |

## 关键纪律

- **全量逐字一致性核验**先行：批 7-13 全部模块先做域文件与 sales_crm.js 内联版逐字比对（含依赖来源核对：`customer/dedupe` 依赖 `ai_stations/enrichment/dedupe` 常量与 `customer/normalize`，均已在域内），仅对一致部分接线。
- **注入式错误构造**：域版默认错误构造器为普通 `Error`，必须经调用点注入 `{ httpError }`/`{ badRequest }`/`{ error: httpError }`/SQL 闭包保持与原内联版相同的 HttpError 语义（statusCode + code）。
- **孤儿清理**：接线后不再被引用的内联常量/import（`PIPELINE_ACTION_QUEUE_KEYS`、`canonicalDomain`/`canonicalHostname`）一并移除。
- **契约测试**：import 断言 + `doesNotMatch(/^function X\(/m)` 锁定"不再内联" + 注入点断言。两处计数断言因跨切片漂移失稳（`{ badRequest }` 计数、`functionSlice` 终点函数被移出单体），已改为逐调用点/逐函数断言。

## 接线完成结论

42 个域模块中 **39 个已接线**（`sales_crm.js` require 38 个 + `lifecycle/state_projection` 经 `business_page_filters.js`）。仅剩 3 个按用户裁定保持内联/精简：

- `identity/index`：facade 精简（不再转发常量与白名单代理）
- `identity/middleware`：认证逻辑内联
- `filter/index`：调用方直连 `filter_authorization`

`sales_crm.js` 行数：13,970 → 12,973（-997 行）。

## 测试证据

- 接线契约 13 文件 24 断言全绿。
- 相关消费专项：recycle/mismatch/return 38/38、活动进展 36/36、客户规范化 76/76、今日任务/筛选 42/42、dedupe/线索/评价 63/63、活动反应 32/32。
- `node --test` 全量 `1913/1913`；`npm test` core `1552/1552`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- 未 push、未合并、未部署；未触碰 AI 内容与 intake 触发器。

## 修复记录

- `resolveActivityReaction` import 重复声明（两处 require），删除冗余。
- 契约测试函数边界更新：`duplicateFingerprint`→`customerCreateRequestHash`→`reserveCustomerCreate`（addOrder 终点）、`todayTaskError`→`deferAccountPlan`（manageIntake 终点）。
- `normalizeTodayTaskDate` 漏注一处（planOnlyActivity 的 `nextActionAt: ''` 校验路径），补注入 `{ parseBusinessDateTime }` 恢复 400 语义。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 A 接线恢复已完成；后续如需继续减单体，可评估已漂移模块或纯常量/配置类。
3. 阶段 B 收尾：§4 强化（assert*Transition 全面落地）、AI 写点（受红线约束）与种子收敛、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。

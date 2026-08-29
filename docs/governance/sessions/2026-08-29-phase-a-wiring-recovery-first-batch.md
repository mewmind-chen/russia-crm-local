# Session Checkpoint：阶段 A 接线恢复首批（纯 helper 域模块）

日期：2026-08-29
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`a76a58d` → 本轮三个接线提交 `0560e9c`、`d51596c`、`873d1b0`

## 目的与范围

按接线清单恢复被 `92c3879` WIP 回退的 domain 接线。本轮只处理**逐字一致**（与 sales_crm.js 内联版完全相同）的自包含纯 helper 模块，drop-in 恢复，行为零变化。每个模块先核对逐字一致性，再接线，配结构性契约测试。

## 本轮三个切片

### `0560e9c` 纯共享 helper（4 模块）
- `lib/domains/json/parse` → `json`/`parseJsonObject`
- `lib/domains/list/pagination` → `normalizeListQuery`/`listPage`
- `lib/domains/audit/redact` → `redactAuditPayload`
- `lib/domains/notifications/visibility` → `notificationVisibleForFeatures` + `AI_NOTIFICATION_CODES`/`SALES_PACK_NOTIFICATION_CODES`
- 契约测试：`test/domain_wiring_pure_helpers_contract.test.js`（4 断言）。

### `d51596c` http 域 helper（2 模块）
- `lib/domains/http/error` → `httpError`/`badRequest`/`notFound`/`conflictError`
- `lib/domains/http/routes` → `anonymousSalesRoute`
- 契约测试：`test/domain_wiring_http_helpers_contract.test.js`（2 断言）。

### `873d1b0` csv/洞察 helper（2 模块）
- `lib/domains/reporting/csv` → `csvCell`/`csvSerialize`；同时把 4 处内联 `\uFEFF` 序列化模板改为 `csvSerialize(headers, rows/body)` 调用。
- `lib/domains/insights/labels` → `safeEvaluationLabel`
- 契约测试：`test/domain_wiring_more_helpers_contract.test.js`（2 断言）。

## 核验方法（关键纪律）

- 候选模块必须与 sales_crm.js 内联版**逐字一致**才接线；发现不一致（如 `customer/recycle` 用注入式 `options.httpError`、`reporting/builders` 依赖 `auth/user` 交叉模块）则暂缓，避免接线引入行为漂移。
- 接线形态：`sales_crm.js` import 域模块并在模块作用域绑定同名标识符，删除内联定义；所有裸名调用点不变。
- 结构契约测试用 `doesNotMatch(/^function X\(/m)` 锁定"不再内联"，用 import 断言锁定"已接线"。

## 测试证据

- 接线契约 3 文件 8/8；相关消费专项（customer_normalize 75、issue205 分页、issue116 安全契约、report_files 报表）全绿。
- `node --test` 全量 `1889/1889`；`npm test` core `1528/1528`。
- `git diff --check` 通过；lint 无错误；工作区干净。
- `sales_crm.js` 行数：13,970 → 13,850（-120 行）。

## 提交

- `0560e9c` refactor(domains): re-wire pure shared helpers back to their lib/domains modules
- `d51596c` refactor(domains): re-wire http error and route helpers back to their domain modules
- `873d1b0` refactor(domains): re-wire csv and insight helpers back to their domain modules

## 风险与回滚

- 三个提交可分别 `git revert` 回滚；接线前后行为逐字一致，全量回归兜底。
- 未 push、未合并、未部署；未触碰 AI 内容与 intake 触发器；未创建新 runtime；未改生产数据。

## 下一步最小动作

1. 单独提交治理文档 checkpoint。
2. 阶段 A 接线恢复续：逐块核对 customer/activity/planning/intake/commerce/auth/reporting-builders 等被回退模块与内联版一致性，一致者 drop-in 恢复（注入式依赖模块需同步调用点）。
3. 阶段 B 收尾：§4 强化、AI 写点（受红线约束）与种子收敛、明确 `last_activity_at` 归属。
4. 收敛 pipeline 与 accounts 的 state DTO 边界差异。
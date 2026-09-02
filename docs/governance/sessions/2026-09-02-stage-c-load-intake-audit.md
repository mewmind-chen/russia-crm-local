# Stage C P1/P3：loadIntakeState 深层字段安全审计

日期：2026-09-02  
范围：`sales_crm.js:loadIntakeState` 的 P1/P3 复合返回，不改运行行为

## 目标

梳理线索池 bootstrap（P1）与 `GET /api/sales-crm/intake`（P3）共用的
`loadIntakeState` 返回结构，确认 `view_contacts=false` 的递归脱敏边界，判断是否能
安全改成字段级白名单，并把结论固化为契约测试。

## 双基线

- 远端 `repo/origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 三者一致；生产目录保持只读。

## 返回形状审计

`loadIntakeState` 的每个 item 不是 `crm_intake_items` 的扁平行，而是查询结果加上多源
enrichment：

| 形状 | 来源 | 风险结论 |
|---|---|---|
| `developmentTimeline[]` | 账户活动/商务历史 | 含 `summary`、下一步等叙事；递归黑名单能剥已登记键 |
| `developmentHistory` | 账户 + 活动/RFQ/报价/订单计数与摘要 | `lastActivitySummary` 是复合键，不在 `CONTACT_KEYS`，可保留联系人叙事，属于残余高风险 |
| `identityWarning` | 公开身份冲突提示 | 当前固定公开结构，可单独保留 |
| `customerTags[]` | `customer_tags` + `tags` | 当前字段有限，但值复制会让未来标签字段绕过形状边界 |
| `signals.fit/readiness` | AI station 固定摘要 | 由既有 AI 开关控制；AI 面冻结，本轮不改 |
| `arbitration.ruleDecision` | 仲裁规则 JSON | `reason`、`notes` 等敏感叙事位于嵌套对象内 |
| `arbitration.aiRecommendation.rankedCandidates[]` | 仲裁 AI JSON + 负责人名称补全 | 数组成员保留未知子键，不能用单层键集安全镜像 |
| `assignmentAudit[].ruleDecision` | 决策历史数组 | 与 arbitration 共享嵌套风险 |
| `complementaryInfo` | `supplement_pending_json` 任意 JSON | 递归黑名单只覆盖已登记键，未知别名仍可能保留 |
| `batches[]` | `SELECT * FROM crm_intake_batches` | 当前扁平，但未来 schema 扩展会自动进入返回 |

P1 bootstrap 与 P3 直读路由均调用同一个 `loadIntakeState`，并在无
`view_contacts` 时使用 `redactContactFields`；因此上述嵌套风险是共享边界，不是单一
路由问题。

## 契约证据

新增 `test/phase_c_load_intake_aggregate_audit.test.js`：

1. 锁定 `loadIntakeState` 的嵌套形状清单，防止后续新增 enrichment 未进入审计范围。
2. 用合成 item 证明“按黑名单保留顶层键、值原样复制”的白名单会泄漏
   `arbitration.ruleDecision.reason` 与 `assignmentAudit[].ruleDecision.reason`。
3. 用隔离 SQLite fixture 调用真实 P3 endpoint：无 `view_contacts` 时，已登记的
   `reason`/`notes`/`summary` 递归剥离；但带联系人叙事的
   `developmentHistory.lastActivitySummary` 哨兵值仍可见，复现残余风险。

## 决定

- P1/P3 **不进入本轮字段级白名单迁移**；顶层白名单会违反“不泄漏联系方式”不变量。
- 当前运行行为保持不变，继续由递归 `redactContactFields` 兜底。
- `lastActivitySummary` 及任意 `complementaryInfo` 未知键应另立合规修复/递归逐形状白名单
  子项目；在该子项目完成前不得把 P1/P3 标记为已迁移。
- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不动生产。

## 验收记录

- 专项审计测试：`node --test test/phase_c_load_intake_aggregate_audit.test.js`，`3/3` 通过。
- 全量：`node --test`，`2117/2117` 通过。
- 核心：`npm test`，`1755/1755` 通过。
- 治理权威：`node scripts/check-governance-authority.js` 通过。
- AI 边界：`node scripts/check-ai-boundary.js` 通过（210 个文件检查）。
- 语法：`node --check test/phase_c_load_intake_aggregate_audit.test.js` 通过。
- 差异：`git diff --check` 通过。
- 未 push、未 merge、未部署；生产目录保持只读。

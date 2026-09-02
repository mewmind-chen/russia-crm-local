# Stage C P1/P3：递归脱敏合规修复方案与契约

日期：2026-09-02  
范围：`loadIntakeState` 通过 P1 bootstrap 与 P3 intake 直读路由的无联系方式权限边界

## 目标与非目标

本切片修复审计发现的三个残余风险面：

- `developmentHistory.lastActivitySummary` 复合字段；
- `supplement_pending_json` 派生的 `complementaryInfo` 任意 JSON；
- `arbitration`、`assignmentAudit[]` 等动态对象/数组中的深层联系方式字段。

不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；不修改生产；不启动
P1/P3 顶层白名单迁移，也不改变有 `view_contacts` 用户的返回形状。

## 双基线

- 远端 `repo/origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`

三者一致；生产目录保持只读。

## 字段风险矩阵

| 风险面 | 真实来源 | 未授权风险 | 采用规则 | 保留范围 |
|---|---|---|---|---|
| `developmentHistory.lastActivitySummary` | `crm_activities.summary` 的最新活动聚合 | 复合键不在全局 `CONTACT_KEYS`，可携带联系人叙事 | `developmentHistory` 显式投影；额外把 `lastactivitysummary` 加入 P1/P3 局部拒绝键 | `accountId/companyName/stage/recycled/previousOwnerId`、四类计数、`lastActivityAt/lastActivityType` |
| `complementaryInfo` | `supplement_pending_json` 与身份冲突补充标记 | 任意 JSON 的未知别名、嵌套值、原始 JSON 字符串可绕过黑名单 | 严格对象投影，只接受 `website`、`industry` 布尔值；`contact`、未知键、嵌套/非布尔值丢弃；`supplement_pending_json` 原列不下发 | 两个已登记补充标记（按值类型校验） |
| `arbitration` 后代 | `crm_intake_decisions` 的 rule/AI/manual JSON | 只保留顶层 `arbitration` 会把深层 `reason/notes/emailAddress` 等复制出来 | 递归遍历每层对象和数组，规范化键后移除全局 `CONTACT_KEYS`、局部复合键及常见联系方式别名；非敏感未知键保留 | 现有规则/人工/推荐业务值；生产者和 AI 结构不改 |
| `assignmentAudit[]` 后代 | 决策历史 JSON + 负责人展示名 | 历史条目与 arbitration 同形状，容易出现深层叙事 | 与 arbitration 共用同一递归边界，不做顶层值复制 | 审计结构键和非敏感业务值 |

## 递归投影契约

`lib/access_control.js` 新增 `redactIntakeAggregate(value)`，仅由 P1/P3 在
`view_contacts=false` 时调用：

1. 先递归处理数组，再处理对象；所有返回值都是新对象，不修改源 payload。
2. 每层键统一转为小写字母数字形式后，与全局 `CONTACT_KEYS`、`lastactivitysummary`、
   `supplementpendingjson` 和联系方式别名集合匹配；命中即删除，深度不限。
3. `developmentHistory` 不走通用“保留未知键”路径，而只投影服务器生成的元数据字段；
   任何叙事、对象或数组字段（包括 `lastActivitySummary`）均不下发。
4. `complementaryInfo` 不递归保留未知值：仅保留 `website`/`industry` 且值必须为布尔；
   这样未知 JSON 不能靠别名或嵌套对象绕过边界，原始 `supplement_pending_json` 同步删除。
5. `arbitration`、`assignmentAudit` 继续递归而非顶层白名单；非敏感未知键可保留以避免改动
   AI/规则生产者，但任何已识别联系方式键在任意后代都必须消失。
6. 有 `view_contacts` 的用户仍返回原始 `loadIntakeState` 形状；该 helper 不用于其他 payload，
   不改变 pipeline 的 `latestActivitySummary` 等既有合同。

## 契约与证据

`test/phase_c_load_intake_aggregate_audit.test.js` 现在覆盖：

- 合成对象中 `lastActivitySummary`、嵌套 `reason/notes`、`emailAddress/phoneNumber` 递归移除；
- `complementaryInfo` 只保留两个布尔标记，未知/嵌套字段和原始 JSON 列不下发；
- P3 `/api/sales-crm/intake` 与 P1 `/api/sales-crm/bootstrap` 共享同一边界；
- 管理员（有 `view_contacts`）仍可读取完整仲裁与补充信息，受限用户看不到哨兵值。

## 验收门禁

- 专项：`node --test test/phase_c_load_intake_aggregate_audit.test.js`
- 全量：`node --test`
- 核心：`npm test`
- `node scripts/check-governance-authority.js`
- `node scripts/check-ai-boundary.js`
- `git diff --check`

本切片完成后，P1/P3 的**递归脱敏合规边界**已收口；P1/P3 的**顶层字段白名单迁移**仍需
另行逐形状等价评审，不能由本切片自动开启。

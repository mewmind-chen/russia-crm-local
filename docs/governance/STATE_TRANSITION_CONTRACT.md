# 阶段 B：客户状态转换契约（草案）

更新时间：2026-08-29
状态：只读盘点完成，契约草案待批准；本轮不改业务代码
范围：`crm_accounts` 的 `stage` / `lifecycle_status` / `assignment_status` / `next_action` / `next_action_at`

## 0. 目标

阶段 B 的目标不是“少写几个 UPDATE”，而是让列表、详情、漏斗、告警、报表、导出对同一客户得到同一状态解释，并把所有状态写入收敛到有签名的写网关，避免直接拼 `UPDATE crm_accounts SET ...`。

## 1. 已有写网关（真源载体）

`lib/domains/lifecycle/` 已经提供两类经过校验的写入封装，是阶段 B 的合法写入入口：

| 网关 | 文件 | 负责字段 | 校验 |
|---|---|---|---|
| `buildAccountStatePatch` / `buildAccountInsertState` / `applyAccountStatePatch` | `state_write.js` | `stage` / `lifecycle_status` / `assignment_status` / `owner_id` / `updated_at` | 状态必须是白名单值 |
| `buildPlanPatch` / `applyAccountPlanPatch` | `collaboration_write.js` | `next_action` / `next_action_at` / `next_action_time_basis` / `updated_at` | 仅文本（计划字段不耦合主状态） |
| `buildManagerPatch` / `applyManagerStatusPatch` | `collaboration_write.js` | `manager_required` / `manager_status` / `manager_id` | 仅文本 |

阶段 B 的完成门：**业务代码中对上表的写不得再直接 `UPDATE crm_accounts SET stage=.../lifecycle_status=.../assignment_status=.../next_action=.../next_action_at=...`，一律走上述网关。** 当前盘点显示仍存在数处直写（见 §2），属于待收敛点。

## 2. 写入点盘点（只读）

### stage（业务阶段）

| 触发场景 | 位置 | 写法 | 目标值 |
|---|---|---|---|
| 新客户领取 | `sales_crm.js createClaimedAccount`（~4493 INSERT） | `buildAccountInsertState` | `qualified` |
| 报价 | `sales_crm.js addQuote` | `applyAccountStatePatch` | `quoted` |
| 首单 | `sales_crm.js addOrder` | `applyAccountStatePatch` | `won` |
| 复购单 | `sales_crm.js addOrder` | `applyAccountStatePatch` | `repeat` |
| 标记放弃（terminal_stage） | `sales_crm.js managerTaskChange` type=terminal_stage | `applyAccountStatePatch` | `lost` |
| 不对口回收 | `sales_crm.js rejectCrmCustomer`（~9819 直写） | **直写** | `lost` |
| 手工删除回收 | `sales_crm.js trashManualCustomer`（~10295，不写 stage） | — | 保持不变 |
| 状态纠正/重建 | `lib/crm_account_rebuild.js` ~124/155/290-333 | reducer 重建 | 由活动历史推导 |
| 种子/演示数据 | `lib/smoke_test_data.js`、`seedAccounts` | 测试专用 | — |

> 注意：`rejectCrmCustomer` 目前直写 `stage='lost'`，是待收敛点之一；`trashManualCustomer` 不写 stage，行为需在网关层明确。

### lifecycle_status（生命周期）

| 触发场景 | 位置 | 写法 | 目标值 |
|---|---|---|---|
| 新客户领取 | `createClaimedAccount` | `applyAccountStatePatch`/`buildAccountInsertState` | `active` |
| 退回客户恢复领取 | `createClaimedAccount`（existing 分支） | `applyAccountStatePatch` | `active`（并清回收字段） |
| 不对口回收 | `rejectCrmCustomer` | **直写** `lifecycle_status='recycled',recycle_kind='mismatch'` | `recycled` |
| 手工删除回收 | `trashManualCustomer` | **直写** `lifecycle_status='recycled',recycle_kind='manual_delete'` | `recycled` |
| 不对口恢复 | `restoreMismatchRecord` | 恢复路径 | `active` |
| 手工删除恢复 | `restoreManualCustomer` | 恢复路径 | `active` |

### assignment_status（分配状态）

| 触发场景 | 位置 | 写法 | 目标值 |
|---|---|---|---|
| 新客户领取 | `createClaimedAccount` | 网关 | `claimed` |
| 重分配 | `sales_crm.js managerTaskChange` type=reassigned | `applyAccountStatePatch` | `claimed`，并改 owner |
| 退回线索池（可再分配） | `sales_crm.js applyCustomerReturn`（~5194 **直写**） | **直写** | `returned` |
| 不对口回收 | `rejectCrmCustomer` | 直写 | `returned` |
| 手工删除回收 | `trashManualCustomer` | 直写 | `returned` |
| 恢复 | `restoreMismatchRecord` / `restoreManualCustomer` | 恢复路径 | 恢复为 claimed/assigned |
| 线索-客户分配同步 | `installIntakeCrmStatusSync` SQL 触发器 | 触发同步 | 跟随 `crm_intake_items.status` |

> 退回线索池（`applyCustomerReturn`）只把 `assignment_status` 置为 `returned`，**不**置 `lifecycle_status=recycled` —— 这是“退回可再分配”与“回收不可再分配”的关键区分，阶段 B 必须显式建模，避免把两者混为同一状态。

### next_action / next_action_at（下一步计划）

| 触发场景 | 位置 | 写法 |
|---|---|---|
| 新客户领取 | `createClaimedAccount` INSERT | 直接写默认计划（本次读取为 INSERT 列） |
| 报价后 | `addQuote` + `recordExplicitPlanIfEnabled` | 直写 + 计划网关 |
| 下单后 | `addOrder` + `recordExplicitPlanIfEnabled` | 直写 + 计划网关 |
| 客户计划编辑 | `sales_crm.js` plan 分支 | `applyAccountPlanPatch` |
| 标记放弃（lost） | `managerTaskChange` terminal_stage | `applyAccountPlanPatch`（清空） |
| 活动登记 | `sales_crm.js addActivity`（~8174/8229 直写） | 直写 |
| 活动纠正 | 纠错流程 | 涉及 `next_action` 回滚 |
| AI 建议计划 | `lib/ai_stations/next_action.js` ~115 | 直写 |
| 延迟计划 | `lib/deferred_plan.js` | 计划路由 |

> `applyAccountPlanPatch` 存在，但 `addActivity`/`addQuote`/`addOrder`/`ai_stations/next_action.js` 仍有直写，属于待收敛点。

## 3. 状态转移矩阵（草案）

约定缩写：A=active，R_cycle=recycled；assigned/claimed/unassigned/returned；stage 只列关键终态。

### 3.1 lifecycle x assignment

| 事件 | 前态 | 后态 lifecycle | 后态 assignment | 说明 |
|---|---|---|---|---|
| 领取新客户 | 无 | active | claimed | 建客户 |
| 退回线索池 | active + claimed | active | returned | **可再分配**，保活 |
| 重分配 | active + claimed | active | claimed | 换 owner 或保留 |
| 标记不对口 | active + claimed | recycled(mismatch) | returned | 不可再分配 |
| 手工删除 | active + claimed | recycled(manual_delete) | returned | 不可再分配 |
| 不对口恢复 | recycled(mismatch) | active | claimed/assigned | 清 recycle 字段 |
| 手工删除恢复 | recycled(manual_delete) | active | claimed/assigned | 工作区还禁止领取自恢复 |

### 3.2 stage 关键推进

| 事件 | 前 stage | 后 stage |
|---|---|---|
| 领取 | — | qualified |
| 触达(纯活动) | 任意推进 | 由活动类型推导 |
| 报价 | ≤quoted | quoted |
| 首单 | ≤won | won |
| 复购单 | 任意 | repeat |
| 标记放弃 | 任意 | lost |
| 不对口 | 任意 | lost |

不变量：
- 正向推进只升不降（`advanceStage`）；`lost`/`disqualified` 为终态，可随时进入。
- `lost` 恢复后允许重新推进（`advanceStage` 当前实现允许 lost→任意）。
- 报价/订单写 stage 时，应对未达到前置阶段做判定（阶段 B 强化）；当前 `addQuote` 直接覆盖、`addOrder` 直接覆盖，需在网关加前置校验。

### 3.3 next_action 语义（沿用 `state_projection.projectNextAction`）

- `planned`：文本+时间都有。
- `degraded`：有文本无时间。
- `overdue`：有时间且早于 now。
- 终态（lost/disqualified/recycled）应清空或置 not-planned —— 当前 terminal_stage 清空，但回收路径需在网关统一处理。

## 4. 断言/守卫（阶段 B 落地内容）

1. 不允许生命周期 recycled + assignment claimed/assigned 同时成立。
2. 不允许 assignment=returned + 存在 owner（退回不应保留有效 owner）。
3. `next_action` 有值时必配 `next_action_time_basis`（否则 degraded）。
4. 报告/导出/告警统一消费 `state_projection` 投影，不再各自读裸列。
5. 所有写经 `state_write` / `collaboration_write` 网关；新增 `assert*Transition` 前置校验。

## 5. 下一步动作（待批准）

1. 确认 §2 中列出的直写点在哪个用例收敛，逐个用网关替换并配契约测试。
2. 优先处理无歧义切片：
   - `rejectCrmCustomer` 的 stage/lifecycle/assignment 收敛到网关。
   - `applyCustomerReturn` 只走 assignment 网关；明确不触动 lifecycle。
   - `addQuote`/`addOrder` 前加 stage 前置校验（先有 rfq/quoted 再报价/下单）。
3. 小步提交，每片可回滚，不直接触碰 `crm_intake_items` 同步触发器与 AI 触发点。

## 6. 回滚

- 所有收敛以独立提交推进；`state_write`/`collaboration_write` 已存在，替换直写点可逐个回滚。
- 不动 `installIntakeCrmStatusSync` 的 SQL 触发器语义（只读契约）。
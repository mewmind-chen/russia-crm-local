# TradePulse 状态模型（初始取证版）

更新时间：2026-08-27
状态：已识别状态维度；转换矩阵和真源仍待逐条核对

## 当前阶段枚举

`lib/customer_stages.js` 定义了以下销售阶段：

```text
new → qualified → contacted → replied → connected → meeting
    → manager → rfq → quoted → negotiating → won → repeat
```

终止/不再需要普通跟进的阶段：

- `won`：首次下单
- `repeat`：复购客户
- `lost`：暂停/流失
- `disqualified`：确认不对口

## CRM 账户状态维度

`crm_accounts` 至少同时保存以下维度：

| 字段 | 初步含义 |
|---|---|
| `stage` | 销售开发阶段，按 `customer_stages.js` 枚举 |
| `assignment_status` | 分配/领取状态，至少包含 `assigned`、`claimed`、`returned`、`unassigned` |
| `lifecycle_status` | CRM 账户生命周期，至少包含 `active`、`recycled` |
| `recycle_kind` | 回收原因/来源，如销售退回、手工删除 |
| `manager_status` | 经理协助状态 |
| `next_action` / `next_action_at` | 当前计划，不是客户生命周期状态 |

这些字段不是同一个状态机，查询时不能互相替代。

## 线索入库初步流程

```text
crm_intake_items.pending
  → assigned
  → claimed
  → linked to crm_accounts

assigned/claimed
  → returned

pending/assigned
  → rejected
```

初步证据：`crm_intake_items.status`、`assigned_owner_id`、`claimed_at`、`return_reason`，以及 `crm_accounts.assignment_status` 的同步逻辑。

## CRM 生命周期初步流程

```text
active CRM account
  → recycled (sales_return / manual_delete)
  → active (restore or reassign, depending on recycle kind)
```

回收与销售阶段不同：客户可能 `stage=lost`，也可能 `lifecycle_status=recycled`。需要继续确认推进动作台如何组合这些状态。

## 活动与阶段

写入客户活动时，系统保存：

- `activity_type`
- `occurred_at`
- `stage_after`
- `next_action`
- `next_action_at`
- `manager_required`

同时会更新 `crm_accounts.stage` 和当前计划字段。`stage_after` 是活动后的记录值，属于历史快照；`crm_accounts.stage` 是当前投影字段，但当前投影是否覆盖所有关键生命周期动作仍需验证。

## 已确认的阶段写入路径

| 入口 | 事件/动作 | 阶段写入规则 | 同步更新 |
|---|---|---|---|
| `recordActivity` | 邮件、电话、社媒、回复、会议、经理介入、询价、谈判、放弃 | 由 `ACTIVITY_STAGE` 生成候选阶段，再由 `advanceStage` 只允许向前推进；`lost` 可直接写入，当前为 `lost` 时新阶段可恢复 | 插入 `crm_activities`，更新 `last_activity_at`、下一步计划、经理标记 |
| 报价接口 | 报价发送 | 直接写入 `quoted` | 更新 RFQ、插入报价活动、更新计划 |
| 订单接口 | 首单/复购 | 直接写入 `won` 或 `repeat` | 插入订单和订单活动、更新计划 |
| 线索拒绝 | 标记不对口 | 直接写入 `lost` | 线索改为 `rejected`，写入原因；当前实现未同步 `lifecycle_status` |
| 线索重新分配 | 重新分配已存在账户 | 若阶段为 `lost` 则恢复为 `qualified`，否则保留原阶段 | 更新负责人、分配期限和领取状态 |
| 旧数据迁移 | 迁移旧跟进记录 | 新建账户默认为 `qualified`，历史状态进入活动的 `outcome` | 写入迁移活动和迁移复核记录 |

## 当前已发现的状态一致性风险

- `stage`、`lifecycle_status`、`assignment_status` 的组合没有集中状态解析器。
- `lost` 既可能表示销售阶段的“暂停/流失”，又在部分线索拒绝路径中被写入。
- 退回线索池会设置 `assignment_status='returned'`，但不同路径对 `stage` 和 `lifecycle_status` 的处理不同。
- 重新分配路径会把 `lost` 恢复为 `qualified`，说明“退回后重新进入”存在专门业务语义，但需要完整事件链确认。
- 统计和动作台部分使用阶段枚举直接过滤，部分同时使用生命周期和分配状态，可能形成口径差异。

## 重构前必须确认

1. 当前状态的唯一真源是账户字段、活动事件，还是二者组合。
2. 暂停、流失、退回、确认不对口的优先级。
3. 退回后重新分配时哪些状态必须重置，哪些历史必须保留。
4. 经理协助状态是否独立于客户阶段。
5. 任务完成条件是否由计划和活动共同决定。
6. 统计、动作台、抽屉、导出使用的状态投影是否应统一。

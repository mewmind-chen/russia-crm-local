# 问题 4：销售退回线索无法勾选重新分配

## 记录信息

- 状态：已定位，尚未修改代码
- 记录日期：2026-08-05
- 核对基线：`2ca86c800ff3da4e36fb2ba30ba278292116dd20`
- 调查分支：`codex/fix-sales-manager-assistance-tasks`
- 关联流程：Issue #221 退回线索复用原 CRM 客户；Issue #241 退回真正回到线索池

## 用户反馈

线索池中，销售退回的线索没有勾选框，主管或经理无法选择后重新分配。

业务期望是：销售退回后，该线索本质上重新成为待分配线索；与首次待分配相比，只多一个“曾经退回”的历史标签，不应失去勾选和分配能力。

## 定位结论

这是前端“可分配”判断与后端退回模型不一致导致的确定性缺陷，不是权限不足，也不是单条生产数据异常。

退回后的正常数据形态是：

```text
intake.status = returned
intake.crm_customer_id = 原 CRM 客户 ID
intake.in_crm = 1
crm_account.assignment_status = returned
crm_account.owner_id = NULL
```

后端把这种“与当前线索关联、状态为 returned 的 CRM 客户”识别为可复用账户，允许重新分配并在新销售领取时恢复原客户，保留活动、RFQ、报价、订单等历史。

但前端只有同时满足以下三个条件才渲染勾选框：

```text
status 属于 pending / approved / returned
in_crm 为 false
crm_customer_id 为空
```

销售退回线索虽然满足第一个条件，却必然不满足后两个条件，因此勾选框被隐藏。

## 直接代码证据

### 1. 前端错误地排除了有关联 CRM 客户的 returned 线索

`sales-assets/app.js:1960-1964`：

```js
function intakeItemAssignable(item) {
  return ['pending', 'approved', 'returned'].includes(item?.status)
    && !Boolean(item?.in_crm)
    && !String(item?.crm_customer_id || '').trim();
}
```

`sales-assets/app.js:2516-2519` 仅在 `intakeItemAssignable(item)` 为 true 时渲染行勾选框。

同一个判断还控制：

- 当前页可选数量；
- 表头全选框是否可用；
- 批量分配栏中的已选数量；
- 行操作是否被视为可分配。

因此，当当前页面全是销售退回线索时，不仅每行没有勾选框，表头全选框也会显示为不可用，前端没有可操作的重新分配入口。

### 2. 退回接口有意保留 CRM 关联

`lib/sales_crm.js:9154-9178` 的退回流程会：

- 把 intake 状态改为 `returned`；
- 清空 intake 负责人、建议负责人和领取时限；
- 把 CRM 客户负责人清空；
- 把 CRM 分配状态改为 `returned`；
- 保留 intake 与原 CRM 客户的关联。

保留 `crm_customer_id` 是正确的数据设计。`lib/sales_crm.js:3415-3456` 正是通过该 ID 汇总并展示客户的既往开发历史。

### 3. 后端明确允许关联原 CRM 客户的 returned 线索重新分配

`lib/sales_crm.js:4233-4268` 会识别“当前线索对应的 returned 客户”为 reusable，而不是普通的 CRM 重复客户。

`lib/sales_crm.js:4261` 的单条分配允许 `returned` 状态。

`lib/sales_crm.js:4655-4664` 的批量手动分配也把 `returned` 列为可分配状态，并允许存在可复用的 returned CRM 客户。

`lib/sales_crm.js:4315-4318` 在重新分配时继续保留 reusable CRM 客户 ID；新销售领取后恢复的是原客户记录，不会新建重复客户。

因此，后端业务规则是“已退回且关联原客户仍可分配”，前端规则却是“只要关联任何 CRM 客户就不可分配”。

## 最小接口复现

在最新基线测试环境中执行完整流程：

1. 创建已领取并关联 CRM 客户的线索；
2. 销售执行“退回线索池”；
3. 管理员重新读取线索池；
4. 使用同一线索请求手动分配预览。

返回的关键字段：

```json
{
  "returnedPayload": {
    "status": "returned",
    "crm_customer_id": "CRM-OTHER",
    "in_crm": 1,
    "crm_assignment_status": "returned",
    "hasDevelopmentHistory": true
  },
  "frontendAssignable": false,
  "backendPreview": {
    "status": 200,
    "eligibleCount": 1,
    "blockedCount": 0
  }
}
```

同一条线索被前端判定为不可分配，但后端预览判定为 1 条可分配、0 条阻断，问题可以稳定复现。

## 缺陷引入时间线

- `5a7a26a`（2026-07-30，Issue #143）新增前端 `intakeItemAssignable`，目的是防止普通“已在 CRM”的待分配线索继续被分配。
- `fad15e4`（2026-08-04，Issue #221）新增 returned 客户复用逻辑，使有关联 CRM 客户的退回线索成为合法可分配对象。
- `748d3c8`（2026-08-04，Issue #241）进一步把新销售退回改为 active + returned，并继续保留 CRM 关联。
- 后两次后端语义扩展后，前端仍沿用 Issue #143 的绝对排除条件，形成当前回归。

Issue #143 的防重复目标本身合理，但“任何 CRM 关联都不可分配”已经不适用于 returned 状态。普通重复客户与当前线索对应的可复用退回客户必须区分。

## 测试覆盖缺口

现有后端测试已经覆盖：

- returned 线索可以重新分配；
- 重新领取复用同一个 CRM 客户 ID；
- 开发历史保持不变。

现有前端测试只验证选择逻辑统一调用 `intakeItemAssignable`，没有验证以下关键场景：

```text
status = returned
crm_customer_id 非空
in_crm = 1
对应 CRM 客户 assignment_status = returned
```

因此，测试确认了前端内部使用同一个判断，却没有确认这个判断符合后端业务语义。

## 期望行为

- 具备 `manage_intake` 权限的主管、经理或管理员，可以勾选销售退回线索。
- 销售退回线索应进入与待分配相同的分配流程，可以单条、当前页或批量重新分配。
- 页面主状态应表达“待分配”；同时保留“曾退回”或“已退回线索池”的历史标签和退回原因。
- 重新分配和领取必须复用原 CRM 客户 ID，保留开发历史，不能为了显示勾选框而清空 `crm_customer_id`。
- 普通待分配线索如果命中另一个有效 CRM 客户，仍应保持不可分配，不能破坏 Issue #143 的防重复保护。

## 后续修复方向

前端不应继续用 `in_crm=false + crm_customer_id 为空` 推断全部可分配语义。建议由后端在线索池响应中返回统一的 `assignable` 和 `assignment_block_reason`，由后端现有的 reusable 判断生成，前端只负责展示。

如果暂时仍由前端判断，也必须至少区分：

- 普通有效 CRM 客户：不可分配；
- 与当前 intake 关联且 assignment_status=returned 的原 CRM 客户：可分配；
- 手工删除或不对口回收客户：按恢复权限和业务规则处理，不得自动等同于销售退回。

## 建议回归场景

1. pending/approved 且无 CRM 关联：显示勾选框，可分配。
2. returned 且关联当前 active + returned CRM 客户：显示勾选框，可分配。
3. returned 重新分配并领取：复用原 CRM ID，历史活动、RFQ、报价和订单不丢失。
4. pending/approved 命中其他有效 CRM 客户：不显示勾选框，并显示明确阻断原因。
5. 当前页只有 returned 线索：行勾选框和表头全选框均可用。
6. returned 与 pending 混合选择：批量预览数量、实际分配数量和页面选择数量一致。
7. 无 `manage_intake` 权限的销售账号：不显示管理分配勾选框。

## 本次处理范围

本次只完成最新基线代码、提交历史和测试接口的诊断，并新增问题记录。没有修改业务代码、测试、依赖、数据库或生产数据。

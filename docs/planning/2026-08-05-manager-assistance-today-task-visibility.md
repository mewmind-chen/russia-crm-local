# 问题 1：经理协助待办错误展示给销售

## 记录信息

- 状态：已定位，未修复
- 记录日期：2026-08-05
- 正式仓库：`mewmind-chen/russia-crm-local`
- 核对基线：`2ca86c800ff3da4e36fb2ba30ba278292116dd20`
- 调查分支：`codex/fix-sales-manager-assistance-tasks`
- 影响页面：销售工作台 -> 今日待办
- 影响角色：销售

## 用户反馈

销售在“记录新进展”中勾选“需要经理协助”并保存后，销售自己的“今日待办”会出现“需要管理者介入”任务。该行的唯一建议动作显示“当前账号无权处理”。

这条任务实际属于经理。销售发起协助请求后，不应在自己的今日待办中收到一条无法处理的经理任务。

## 实际行为

1. 销售记录客户进展并勾选“需要经理协助”。
2. 后端把客户状态更新为 `manager_required=1`、`manager_status='待介入'`。
3. 销售打开“今日待办”。
4. 页面展示一条“需要管理者介入”任务。
5. 该任务的 `actionKind` 是 `complete_manager_assistance`，但销售收到的 `allowedActions` 为空。
6. 前端因此显示“当前账号无权处理”。

用户截图中的关键现象：

- 今日待办角标为 `1`；
- 列表主要原因是经理协助请求；
- 唯一建议动作显示“当前账号无权处理”。

## 期望行为

- `MANAGER_NEEDED` 是经理或管理员处理的待办原因，只应进入有权处理该客户协助请求的经理/管理员待办。
- 发起请求的销售不应在“今日待办”中看到该经理专属原因。
- 如果同一客户同时存在销售本人需要处理的其他原因，销售仍应看到该客户行，但行内不得包含 `MANAGER_NEEDED`，主要原因、原因数、紧急程度和汇总计数均应按销售可见原因重新计算。
- 后端对销售执行 `complete_manager_assistance` 的 `403` 拒绝必须保留，不能用前端隐藏替代权限校验。
- 如需让销售查看“等待经理响应”的状态，应在客户状态、时间线或只读通知中表达，不应伪装成销售待办。

## 复现结果

在最新基线的临时测试数据库中，为销售 `U-OTHER` 名下客户设置一个未完成的经理协助请求，并分别以销售和经理身份请求：

- `GET /api/sales-crm/bootstrap`
- `GET /api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D`

两个接口的结果一致。

销售收到：

```json
{
  "code": "MANAGER_NEEDED",
  "title": "需要管理者介入",
  "actionKind": "complete_manager_assistance",
  "allowedActions": [],
  "reasonCodes": ["MANAGER_NEEDED"]
}
```

经理收到：

```json
{
  "code": "MANAGER_NEEDED",
  "title": "需要管理者介入",
  "actionKind": "complete_manager_assistance",
  "allowedActions": ["complete_manager_assistance"],
  "reasonCodes": ["MANAGER_NEEDED"]
}
```

结论：问题来自后端待办可见性，不是前端按钮判断错误。

## 根因定位

### 1. 待办先按客户可见范围生成，没有按待办接收角色过滤

`lib/sales_crm.js:2941` 在任何可见客户满足 `manager_required=1` 且尚未完成时，都会生成 `MANAGER_NEEDED`。

销售的客户范围由 `lib/sales_crm.js:2049-2055` 和 `lib/business_page_filters.js:202-215` 约束为本人负责的客户。由于协助请求正是销售本人客户上的状态，销售必然能进入这条待办的生成范围。

### 2. 权限处理只清空动作，没有移除经理专属待办原因

Bootstrap 路径在 `lib/sales_crm.js:6754-6760` 先生成并合并全部待办，再调用 `authorizeTodayTaskActions`。

`lib/sales_crm.js:3099-3123` 对销售只执行以下处理：

- 判定销售不能执行 `complete_manager_assistance`；
- 把顶层和原因中的 `allowedActions` 清空；
- 保留整条 `MANAGER_NEEDED` 及其汇总数据。

筛选列表路径在 `lib/business_page_filters.js:368-414` 重复了相同逻辑：先生成并合并全部原因，再清空无权动作，但不移除原因。

### 3. 前端忠实展示了后端返回的不可处理任务

`sales-assets/app.js:3923-3953` 根据 `allowedActions` 和角色判断是否渲染操作按钮。销售没有动作权限时，前端显示“当前账号无权处理”。

因此前端表现是后端数据契约的直接结果。只修改这段前端文案或隐藏按钮无法修复待办角标、汇总计数、分页和主要原因错误。

### 4. 现有测试把错误行为固化为期望

`test/issue116_business_page_filters.test.js:85-110` 明确使用销售角色请求今日待办，并断言销售客户的原因包含 `MANAGER_NEEDED`。

`test/issue157_today_task_actions.test.js:464-490` 只验证销售提交经理协助完成动作时返回 `403`，没有验证该经理专属待办不应对销售可见。

这导致“动作权限正确、待办可见性错误”的组合通过现有测试。

## 影响范围

- Bootstrap 初始载荷中的 `alerts`。
- `/api/sales-crm/lists/alerts` 分页列表。
- 今日待办侧边栏角标。
- 待处理对象、原因数、立即处理、今天完成、需要关注等汇总计数。
- 同一客户多原因合并后的主要原因、紧急程度和唯一建议动作。
- 销售体验：出现无法完成、无法消除的待办，容易误认为权限配置异常。

经理完成协助的写入接口当前有角色与权限校验，本次未发现销售可以越权完成任务或修改经理处理结果。

## 后续修复边界

后续实施时应在“原因进入分组和汇总之前”执行面向当前用户的待办原因可见性过滤，并同时覆盖以下两条数据路径：

1. `loadPayload` 的 bootstrap `alerts`；
2. `business_page_filters.allTodayTasks` 的授权列表。

不能仅在分组后删除整行，因为同一客户可能同时存在销售可处理原因和经理专属原因。正确边界是先过滤原因，再重新分组、选择主要原因并计算汇总。

## 建议回归场景

1. 销售发起经理协助后，bootstrap 与列表接口都不返回 `MANAGER_NEEDED`。
2. 有权限且能查看该客户的经理仍能看到并完成协助任务。
3. 同一客户同时存在 `MANAGER_NEEDED` 和销售可处理原因时，销售只看到可处理原因，经理看到完整授权范围内的原因。
4. 过滤后的 `reasonCount`、`urgency`、分页总数和顶部汇总正确。
5. 销售直接调用 `complete_manager_assistance` 仍返回 `403`，且客户状态不变。
6. 管理员身份检查、经理数据范围和无 `view_team` 权限的经理继续遵循现有权限边界。

## 本次处理范围

本次只完成问题定位与文档记录，没有修改业务代码、测试或生产数据。

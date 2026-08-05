# 问题 5：编辑客户资料被下一步计划校验阻断

## 记录信息

- 状态：已定位，尚未修改代码
- 记录日期：2026-08-05
- 核对基线：`2ca86c800ff3da4e36fb2ba30ba278292116dd20`
- 调查分支：`codex/fix-sales-manager-assistance-tasks`
- 关联 Issue：[#246 客户资料修改入口被拆成多个按钮，建议整合为单一编辑入口](https://github.com/mewmind-chen/russia-crm-local/issues/246)
- 关联 PR：[#253 feat: 客户资料编辑入口整合](https://github.com/mewmind-chen/russia-crm-local/pull/253)
- 引入提交：`800b122b9294a684d5f0d7187e2c3d2be0b989d0`

## 用户反馈

“编辑客户资料”不应该包含“下一步动作 / 计划时间”。当前把两者放进同一表单后，下一步计划的校验会导致客户基础资料无法保存。

此前 Issue #246 要求把多个客户编辑入口整合到一起，但“单一入口”不能破坏正常资料编辑，也不等于所有业务字段必须在每次保存时共同校验和提交。下一步计划属于跟进计划流程，应与客户静态资料编辑区分。

## 定位结论

这是 Issue #246 实现中的职责耦合缺陷，可以稳定复现。

当前“编辑客户资料”表单同时包含：

- 客户资料：国家、城市、官网、行业、客户类型、来源、成立年份、重点产品、昵称；
- 管理属性：阶段、负责人、优先级；
- 跟进计划：下一步动作、计划时间。

提交时前端把所有已渲染字段统一组装为一个 PATCH。只要客户原有计划时间已经到期，用户即使只修改国家、城市或官网，也会被计划时间校验阻断，资料字段不会保存。

问题有两道确定性的阻断：

1. 前端提交前会校验表单中所有 `data-future-datetime` 字段，历史计划时间小于当前时间时直接抛出“下一步时间必须晚于当前时间”；
2. 即使绕过前端校验，PATCH 仍携带 `nextAction` 和 `nextActionAt`，后端将其视为本次正在修改计划，再次以 `NEXT_ACTION_AT_MUST_BE_FUTURE` 拒绝整个请求。

## 直接代码证据

### 1. Issue #246 把计划字段并入客户资料表单

`sales-assets/app.js:9014-9032` 的 `customerProfileEditForm` 包含：

```text
nextAction
nextActionAt
```

其中计划时间带有 `data-future-datetime`，弹窗打开后立即调用：

```js
constrainFutureDateTimes($('#customerProfileEditForm'));
```

如果账户保存的是已到期计划，弹窗会把该历史值原样放入受“必须晚于现在”约束的输入框。

### 2. 全局提交校验不区分字段是否被用户修改

`sales-assets/app.js:9342-9349` 在任何表单提交前遍历全部 `data-future-datetime` 输入框：

```js
const invalidFuture = Array.from(form.querySelectorAll('[data-future-datetime]'))
  .filter(input => !input.disabled && !input.closest('.hidden'))
  .find(input => !validateFutureDateTime(input));
if (invalidFuture) throw new Error('下一步时间必须晚于当前时间');
```

这里只判断值是否过期，不判断计划字段是否被修改，也不判断用户本次是否只在编辑客户资料。

### 3. 统一表单每次都提交计划字段

`sales-assets/app.js:9789-9801` 使用 `formPayload(form)` 收集整个表单，并无 dirty-field 过滤：

```js
payload.nextActionAt = apiTime(payload.nextActionAt);
await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}`, {
  method: 'PATCH',
  body: JSON.stringify(payload),
});
```

因此，即使用户完全没有触碰计划字段，它们仍会出现在 PATCH 载荷中。

### 4. 后端只要看到计划字段就执行计划规则

`lib/sales_crm.js:8720-8738` 的判断是：

```js
const touchesPlan = payload.nextAction !== undefined
  || payload.nextActionAt !== undefined;
```

只要载荷里存在任一计划字段，后端就会校验计划和时间必须成对，并通过 `parseBusinessDateTime` 校验时间必须晚于当前时间。

`lib/deferred_plan.js:216-230` 对过去或等于当前时间返回：

```text
400 NEXT_ACTION_AT_MUST_BE_FUTURE
下一步时间必须晚于当前时间
```

这是正确的“新建或修改计划”规则，但不应由一次普通资料编辑意外触发。

## 最小接口对照复现

测试环境先给客户设置一条已经到期的历史计划，然后执行两次 PATCH。

### 仅提交资料字段

```json
{
  "profileOnly": {
    "status": 200,
    "ok": true,
    "savedCity": "资料字段可单独保存"
  }
}
```

说明后端资料编辑本身可以正常保存，并不强制要求计划。

### 提交资料字段，同时附带统一表单中的原历史计划

```json
{
  "unifiedWithUnchangedPastPlan": {
    "status": 400,
    "error": "下一步时间必须晚于当前时间",
    "code": "NEXT_ACTION_AT_MUST_BE_FUTURE",
    "cityAfterRejectedSave": ""
  }
}
```

同一资料字段因为载荷中多了未修改的历史计划而保存失败，能够完整复现用户反馈。

实际页面还会先经过前端同样的时间判断，因此正常操作通常在请求发出前就已被拦截。

## Issue #246 的实施偏差

Issue #246 的核心诉求是减少分散按钮，建立一个统一的“编辑客户资料”入口。Issue 原文建议统一弹窗包含计划字段，PR #253 也按字段全集实施并通过了当时测试。

但是验收只验证了：

- 页面只剩一个入口；
- 统一表单包含所有指定字段；
- 保存统一走一个 PATCH；
- `nextActionAt` 被转换后发送。

没有验证：

- 客户已有过期计划时能否只修改基础资料；
- 未修改的计划字段是否不应触发计划校验；
- 基础资料保存失败时是否被无关字段阻断；
- “统一入口”下不同业务职责是否仍保持独立。

因此，这是需求整合后的回归，不是计划时间校验本身错误。

## 修订后的业务边界

- “编辑客户资料”可以继续作为单一入口，避免恢复多个同名或含义模糊的按钮。
- “下一步动作 / 计划时间”不应出现在客户资料编辑区域，也不应随资料保存请求提交。
- 下一步计划应通过“记录新进展”“补充下一步计划”或其他明确的计划操作维护，并继续执行严格的未来时间校验。
- 客户资料编辑必须能够独立保存，不受已有计划为空、缺一项、已到期或历史时间基准影响。
- 如果阶段从终止状态重新激活，后端现有的“必须填写下一步计划”规则可保留，但界面应进入明确的重新激活流程，而不是把计划长期混在普通资料表单里。
- 单一入口不等于单一业务事务。资料、负责人分配、阶段流转和跟进计划可以共用入口或页面，但必须有清晰分区和独立校验边界。

## 后续修复方向

按当前用户确认的产品边界，建议：

1. 从 `customerProfileEditForm` 移除 `nextAction`、`nextActionAt` 和对应未来时间约束；
2. 资料表单 PATCH 不再发送任何计划字段；
3. 保留现有独立计划入口及后端计划校验；
4. 对重新激活客户提供显式流程，在该特定动作中要求新计划；
5. 后端继续使用“字段未出现即不修改”的 PATCH 语义，防止无关字段互相阻断。

## 建议回归场景

1. 客户无下一步计划时，编辑国家、行业或官网可以保存。
2. 客户下一步计划已过期时，编辑客户资料仍可以保存，原计划保持不变。
3. 客户只有历史计划文本或存在旧时间基准时，编辑资料不触发计划成对校验。
4. 客户资料 PATCH 载荷不包含 `nextAction` 和 `nextActionAt`。
5. 从独立计划入口创建或修改计划时，过去时间仍返回 `NEXT_ACTION_AT_MUST_BE_FUTURE`。
6. 从 lost/disqualified 重新激活时，通过明确流程填写未来计划，不能绕过现有后端规则。
7. Issue #246 的单一编辑入口、昵称权限、负责人权限和资料页刷新行为继续保留。

## 本次处理范围

本次只完成 GitHub Issue/PR、最新基线代码、提交历史和测试接口的诊断，并新增问题记录。没有修改业务代码、测试、依赖、数据库或生产数据。

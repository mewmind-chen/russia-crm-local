# 问题 3：Issue #241 实施结果与客户回收站现状不一致

## 记录信息

- 状态：已核查，当前实现仅完成新流程，用户可见验收未完整闭环
- 记录日期：2026-08-05
- 正式仓库：`mewmind-chen/russia-crm-local`
- 核对基线：`2ca86c800ff3da4e36fb2ba30ba278292116dd20`
- 生产运行版本：`2ca86c800ff3da4e36fb2ba30ba278292116dd20`
- GitHub Issue：[#241 退回线索池应真正回到线索池，不对口客户才进入回收站](https://github.com/mewmind-chen/russia-crm-local/issues/241)
- 合并 PR：[#250 fix: 退回回到线索池，不对口进入回收站](https://github.com/mewmind-chen/russia-crm-local/pull/250)
- 功能提交：`748d3c8a0c1a7ddaca62eda0605ef7a8c8234773`
- 合并提交：`ffd8f0273e8bc5b8638dbfebaab8d13182380adc`
- 调查分支：`codex/fix-sales-manager-assistance-tasks`

## 用户反馈

Issue #241 的业务要求是：

- “退回线索池”应真正回到线索池；
- “不对口”客户才进入客户回收站。

但当前生产页面的客户回收站仍然显示大量“销售退回”客户，因此用户无法确认 Issue 是否真正实现。

## 核查结论

代码已经实现了 #241 的**新写入流程**：

- 新的销售退回不会再写入客户回收站；
- 新的销售退回会保留 active 客户记录、清空负责人并把 assignment 状态设为 returned；
- 关联线索会变为 returned，可在线索池重新分配并复用同一个 CRM 客户 ID；
- 新增“标记不对口”，会把客户写入回收站并标记为 mismatch。

但是实现明确保留了合并前的 `sales_return` 历史数据，并继续在客户回收站中展示；页面进入回收站时还默认选择“销售退回”。因此，从用户可见结果看，Issue 中“回收站只放不对口和手动删除”的验收没有完整实现。

准确结论是：**核心新流程已实现，历史数据和展示收口未实现，Issue 只能视为部分完成。**

## GitHub 实施记录

Issue #241 于 2026-08-04 关闭，关闭评论记录：PR #250 已合并，声称“退回真正回到线索池，不对口进入回收站”。

PR #250 于 2026-08-04 合并，CI 成功。PR 正文同时注明：

> `sales_return` 仅保留历史数据。

这解释了为什么新逻辑正确，但现有回收站仍然能看到“销售退回”。

## 当前代码实现位置

### 1. 新退回已经真正回到线索池

`lib/sales_crm.js:9162-9185` 的 `applyCustomerReturn` 当前写入：

```text
lifecycle_status = active
recycle_kind = ''
owner_id = NULL
assignment_status = returned
```

同一事务还会把关联 `crm_intake_items` 更新为：

```text
status = returned
assigned_owner_id = ''
```

`returnCustomer` 和 `bulkReturnCustomers` 都复用这条路径，返回值包含 `returnedToPool: true`。

`lib/sales_crm.js:4233-4257` 允许 active + returned 客户通过线索池重新分配和领取，并复用原 CRM 客户记录。

### 2. 不对口已实现为回收站类型

`lib/sales_crm.js:9220-9253` 的 `rejectCrmCustomer` 当前写入：

```text
lifecycle_status = recycled
recycle_kind = mismatch
assignment_status = returned
stage = lost
intake.status = rejected
```

前端客户列表和抽屉已增加“标记不对口”入口，回收站筛选也支持 `mismatch -> 不对口`。

### 3. 历史销售退回仍被回收站查询

`lib/sales_crm.js:9256-9266` 仍允许 `sales_return`、`manual_delete` 和 `mismatch` 三种回收类型，并默认使用 `sales_return`。

`lib/business_page_filters.js:569-650` 的授权回收站列表也继续查询 `sales_return`。

这是兼容旧记录的有意实现，不是新退回写入失败。

### 4. 页面默认展示历史销售退回

当前前端存在以下行为：

- `sales-assets/app.js:171`：初始 `recycleKind` 是 `sales_return`；
- `sales-assets/app.js:10988`：每次进入客户回收站都重置为 `sales_return`；
- `sales-crm.html:269-273`：保留“销售退回 / 不对口 / 手动删除”三个分类，且“销售退回”默认激活；
- `sales-crm.html:264`：说明仍写着“退回和手动删除均为软回收”，与 #241 新语义不一致。

因此，只要生产库存在旧销售退回记录，用户每次进入回收站首先看到的必然全是销售退回客户。

## 最新基线测试结果

在最新 `origin/main` 上执行：

```text
node --test test/issue241_return_mismatch.test.js test/customer_recycle_bin.test.js
```

结果：`8/8` 通过。

专项测试验证了：

- 新退回客户不在销售退回回收站中；
- 新退回客户在线索池重新分配后复用原 CRM ID；
- 新标记不对口客户进入 mismatch 回收站；
- mismatch 客户可以重新分配恢复；
- 权限和前端入口存在。

这些测试没有要求清理、迁移或隐藏已有 `sales_return` 历史数据。

## 生产只读核对

生产健康检查返回：

```text
releaseSha = 2ca86c800ff3da4e36fb2ba30ba278292116dd20
database = ok
```

当前生产 `crm_accounts` 中 lifecycle 为 recycled 的数据：

| recycle_kind | 数量 | 最早回收时间 | 最晚回收时间 |
| --- | ---: | --- | --- |
| `sales_return` | 70 | 2026-07-28 04:23:03 | 2026-08-03 09:43:02 |
| `manual_delete` | 2 | 2026-08-03 07:03:41 | 2026-08-03 07:03:55 |
| `mismatch` | 0 | - | - |

#241 所在代码随当前版本于 2026-08-05 00:28（Asia/Shanghai）部署。现有 70 条 `sales_return` 的最晚时间早于部署时间，审计中也没有任何合并后新增的 `sales_return`。

生产事实说明：

- 用户看到的 70 条销售退回全部是 #241 部署前的历史数据；
- 当前没有不对口回收记录，所以“不对口”分类为空；
- 尚无证据表明 #241 部署后仍把新的销售退回写入回收站；
- 历史数据没有执行迁移或归档，页面又默认展示该分类。

## Issue 验收差距

Issue 原文的验收标准包含：

> 回收站只放“不对口”和“手动删除”两类。

当前实现与该标准的差距：

1. 回收站仍允许并展示 `sales_return`；
2. 70 条历史销售退回仍保持 lifecycle=recycled；
3. 默认视图仍是“销售退回”；
4. 页面说明仍沿用退回进入回收站的旧语义；
5. 没有历史数据迁移、归档说明或管理员确认流程；
6. 测试只覆盖新写入，不覆盖回收站最终只剩 mismatch/manual_delete 的产品结果。

## 期望行为

- 新退回继续保持当前正确实现：进入线索池，不进入客户回收站。
- 客户回收站的正常业务分类只包含“不对口”和“手动删除”。
- 页面默认进入“不对口”或不带旧类型的全量有效回收视图，不应默认打开历史销售退回。
- 页面说明必须明确：退回进入线索池；不对口和手动删除进入回收站。
- 历史 `sales_return` 必须有明确处置策略，不能无限期混在当前业务回收站中。

## 后续处理边界

### 历史数据不能直接批量改写

现有 70 条记录是生产业务数据。后续处理前必须：

1. 生成只读迁移清单；
2. 核对每条记录的 intake 关联、外部客户 ID、原负责人和历史审计；
3. 识别已重新分配、重复客户、缺失 intake 关联和手工数据；
4. 做数据库备份和可回滚迁移；
5. 经业务确认后，才能把符合条件的旧 sales_return 转换为 active + returned 并恢复到线索池；
6. 无法安全回池的历史记录应归档到独立历史视图，而不是静默删除。

### 展示层应与新语义一致

历史数据处置完成或具备独立归档入口后：

- 移除正常回收站中的“销售退回”分类；
- 默认分类改为“不对口”；
- 更新回收站说明；
- 增加回归测试，禁止新 sales_return 进入回收站并禁止默认展示旧分类。

## 建议回归场景

1. 单个退回后，客户只在线索池显示为已退回，回收站三个查询均不存在该客户。
2. 批量退回后，结果一致且页面跳转线索池。
3. 重新分配和领取复用同一 CRM 客户 ID，历史活动、联系人和审计不丢失。
4. 标记不对口后，只进入 mismatch 回收站。
5. 客户回收站默认显示不对口，不显示销售退回分类。
6. 历史 sales_return 迁移前后数量、关联关系和审计可核对、可回滚。
7. 生产部署后新增 `sales_return + recycled` 记录数保持为零。

## 本次处理范围

本次只完成 GitHub、代码、测试和生产数据库的只读核查，并记录实施差距。没有修改业务代码、测试、生产数据库或历史客户记录。

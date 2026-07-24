# A2-02 联系就绪触发验收证据

日期：2026-07-24

## 范围

- 分支：`codex/ai-contact-readiness-a2-02`
- 基线：`codex/ai-integration` @ `0add7f6363065a26753be28af1585b7943b0a554`
- 实现提交：`d96a48c`
- PR：[#44](https://github.com/mewmind-chen/russia-crm-local/pull/44)
- 本任务只接入 `contact_readiness` 触发、运行、失效和 enrichment 阻断。
- 未接入销售候选快照、销售匹配、自动分配、UI、外发或生产开关。

## 验收结论

1. `customer_fit` 成功后，Worker 维护扫描只处理 schema v8 应用之后完成的 fit，并按 fit 与
   联系人上下文幂等创建唯一 `contact_readiness` 后继。
2. enrichment 链为 `contact_collect -> customer_fit -> contact_readiness ->
   enrichment_finalize`，finalize 不会越过 readiness。
3. readiness 上下文合并联系人候选、本地 CRM 联系人和公司入口，输出联系人 ID 必须属于
   服务器白名单；`ready` 至少需要一个允许的联系人 ID。
4. Contact Recon、联系人字段实际发生变化的普通 Recon、手工联系人新增会原子地将旧结果
   标记 stale，并取消排队任务或请求取消运行任务；普通公司 Recon 更新不会误置 stale。
5. `partial/not_ready` 写入 `customer_pool.contact_next_action` 并让 enrichment 保持
   `missing_info`，即使还有字段待审核也不进入 `pending_assignment`。
6. readiness 不改变 CRM owner 或 assignment 状态，不创建 intake，也不创建
   `distribution_priority` 或 `sales_match` 任务。

## 验证

聚焦验收：

```text
node --test --test-concurrency=1 \
  test/ai_contact_readiness_trigger.test.js \
  test/ai_customer_enrichment_proposals.test.js

tests 9
pass 9
fail 0
```

完整回归：

```text
npm test

tests 427
pass 427
fail 0
skipped 0
duration_ms 29402.9005
```

静态校验：

- 所有改动 JavaScript 文件 `node --check` 通过。
- `lib/ai_stations/schemas/*.json` 全部可解析。
- `git diff --check` 通过。

## 集成状态

- PR #44 已合并到 `codex/ai-integration` @ `c6b21500b69008920948bdd238530b3eb4fbe0a8`，GitHub CI `test` 已通过。
- 尚未部署；生产 current/health 和全部 AI feature flags 未变化。

## 下一项

A2-03 销售候选快照。按用户要求，A2-02 完成后停止，不在本任务继续实施。

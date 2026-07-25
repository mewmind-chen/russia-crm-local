# A2-03 销售候选快照验收证据

日期：2026-07-24  
集成分支：`codex/ai-integration`  
实现分支：`codex/ai-candidate-snapshot-a2-03`  
实现提交：`8051847`  
合并提交：`51aecaa`  
PR：[#46](https://github.com/mewmind-chen/russia-crm-local/pull/46)

## 实现范围

- schema v9 新增 `crm_ai_candidate_snapshots` 快照元数据表和
  `crm_ai_candidate_snapshot_items` token 映射表。
- 服务端从 `sales_users` 的有效状态、生效权限、国家、语言、渠道、在手负荷和每日配额生成候选。
- 每次候选集映射为从 1 开始的一次性正整数；模型上下文只接收 token 和能力摘要，不接收真实销售 ID。
- 快照保存 context hash、候选状态 hash、创建时间、过期时间、可选 AI job 绑定和失效原因。
- 相同上下文幂等复用；销售停用、权限/能力/负荷变化或过期后，旧快照 fail-closed 并要求重新生成。
- 服务器解析排名时拒绝陌生、重复、不完整或已失效 token，再在服务端映射回真实销售 ID。

## 验收结果

聚焦 `node --test test/ai_candidate_snapshots.test.js`：3/3 通过。

完整 `npm test`：430/430 通过，包含多进程 Worker、A2-02 联系就绪触发和 enrichment
端到端流程。

额外检查：

- `node --check lib/ai_stations/candidate_snapshots.js`
- `node --check lib/ai_stations/schema.js`
- `git diff --check`
- GitHub Actions `test`：通过

## 明确未做

- 未修改 `chooseIntakeOwner` 的最终裁决逻辑。
- 未写入 owner、`crm_intake_items` 或 `crm_accounts` 的业务分配状态。
- 未接入页面、自动分配、外发、生产数据库或生产 feature flags。
- 本任务未执行部署。完成后只读核验生产 current/health 为
  `f8f0b165c5c80a18adc4616ef08f1da1fd884644`，与 `origin/main` 一致；previous 为
  `releases/73f2e7b3aa47`，`CRM_AI_STATIONS_ENABLED=false`。

下一项：A2-04 规则最终裁决。

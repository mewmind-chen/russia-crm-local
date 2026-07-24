# A2-04 规则最终裁决验收证据

日期：2026-07-24  
集成分支：`codex/ai-integration`  
实现分支：`codex/ai-rule-arbitration-a2-04`  
实现提交：`ea8fb8b`  
合并提交：`4e4619e`  
PR：[#49](https://github.com/mewmind-chen/russia-crm-local/pull/49)

## 实现范围

- 新增服务端 `assignment_arbitration` 裁决层，将 AI `sales_match` 排名限制为建议输入。
- 只有有效、`role='sales'` 且具备 `view_intake` 的销售可进入候选和 owner 校验。
- 裁决前在事务内重新读取授权销售、在手负荷和当日配额，避免使用过期分配状态。
- AI 与确定性 `chooseIntakeOwner` 一致且置信度足够时可自动分配；AI 不可用时继续使用确定性回退。
- AI 冲突、候选失去资格、低置信度、高价值、风险阻断、跨团队和重复客户进入经理审批或规则阻止。
- 快照 token 只通过服务端 A2-03 映射解析；快照过期、销售状态变化、非法或不完整排名均 fail-closed。
- `scanDailyIntake` 与 `bulk_assign` 接入裁决层；手动 intake、CRM owner 和迁移复核也复用授权销售校验。
- `saveResult` 将 `candidateEmployeeIds` 传入站点输出校验，为 `sales_match` 结果保存保留白名单边界。

## 验收结果

聚焦 `node --test test/ai_assignment_arbitration.test.js`：5/5 通过。

完整 `npm test`：435/435 通过，包含 A2-01、A2-02、A2-03、Worker、权限、任务中心和 CRM
端到端回归。

额外检查：

- `node --check lib/ai_stations/assignment_arbitration.js`
- `node --check lib/sales_crm.js`
- `node --check test/ai_assignment_arbitration.test.js`
- `git diff --check`
- GitHub Actions `test`：通过

## 明确未做

- 未实现 A2-05 页面、经理审批 UI 或完整审计展示。
- AI 不能绕过权限、配额、负荷、风险、重复客户和跨团队规则，也不能直接决定 owner。
- 未修改 `chooseIntakeOwner` 的确定性基础评分逻辑。
- 未执行生产数据库写入、生产部署或打开任何 AI feature flag。完成后生产 current/health、
  previous 和 `CRM_AI_STATIONS_ENABLED=false` 保持不变。

下一项：A2-05 页面与审计。

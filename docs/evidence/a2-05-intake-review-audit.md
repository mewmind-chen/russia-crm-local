# A2-05 页面与审计验收证据

日期：2026-07-24
集成分支：`codex/ai-integration`
实现分支：`codex/ai-assignment-a2-05`
实现提交：`2d04abc`
合并提交：`92e64cc`
PR：[#51](https://github.com/mewmind-chen/russia-crm-local/pull/51)

## 实现范围

- 新增 `crm_intake_decisions` 决策历史表，记录裁决类型、操作者、候选快照 ID、AI 推荐、
  规则结果和人工决定。
- 自动扫描、批量分配、经理重新分配以及销售领取/退回/标记不对口均写入决策历史；现有
  `crm_audit_log` 路由审计继续保留。
- bootstrap 的 intake item 返回 `signals`、`arbitration` 和 `assignmentAudit`：
  - Fit 分数/等级、Fit 置信度、readiness、priority 和风险状态。
  - AI 候选销售排名、置信度、快照绑定和规则裁决。
  - 人工最终决定、操作者和时间线。
- 入库队列表格展示 Fit/readiness/优先级、候选销售排名、负责人、规则裁决和阻断原因。
- 入库详情抽屉展示 AI 推荐、规则裁决、人工最终决定三层信息及审计轨迹。
- 无 `manage_intake` 的销售只看到自身已分配线索，候选排名按当前 owner 范围脱敏。

## 验收结果

专项 `node --test test/ai_assignment_audit.test.js test/ai_assignment_audit_ui.test.js test/ai_assignment_arbitration.test.js`：7/7 通过。

完整 `npm test`：437/437 通过。

额外检查：

- `node --check lib/sales_crm.js`
- `node --check sales-assets/app.js`
- `git diff --check`
- GitHub Actions `test`：通过

## 明确未做

- 未执行生产数据库迁移、生产部署或打开 AI feature flag。
- A2-06 并发、候选越权、规则阻断、AI 故障回退和三角色权限验收留到下一项。
- 不改变现有 owner 写入权限、AI 不越权和生产回滚边界。

下一项：A2-06 验收门。

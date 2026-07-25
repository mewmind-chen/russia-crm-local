# A4-04 阶段 4 验收门证据

日期：2026-07-25

## 验收范围

- 经理只能查看授权客户范围内的治理指标和团队 AI 任务。
- 销售无法查看团队报告、版本治理、经理异常或销售辅导等团队级敏感数据。
- 影子评估、发布审批和回滚只记录离线治理版本，不连接在线 Prompt Registry 或模型策略。
- 新旧模型、Prompt 和规则版本指标独立保留，可直接比较。
- 历史任务详情显示决策版本、上下文指纹、证据 ID、生成时间和过期状态。
- 追溯 API 不返回 Prompt 内容、策略配置、完整任务输入、幂等键、租约或 Worker 标识。

## 实现

- AI schema v16 为任务新增独立 `decision_trace_json` 快照，固化工作站、Prompt、Schema、
  规则和策略版本，同时保持原有 `input_json` 与幂等键比较不变。
- 任务详情通过 `decisionTrace` 白名单返回模型、版本、上下文、证据和 stale 元数据。
- 历史 v15 及更早任务使用明确的 `v1` 兼容值；新任务使用入队时不可变快照。
- 管理端任务详情新增“决策版本与证据”区，不展示 Prompt 正文或治理配置。

## 自动化验收

- A4-04、任务中心、治理、schema 和 UI 聚焦回归：`40/40`。
- 完整 Node 回归：`535/535`。
- 全部修改 JavaScript `node --check`：通过。
- `git diff --check`：通过。
- schema v10、v14、v15 和 legacy 四表布局增量迁移继续通过，并发迁移序列化通过。

## 页面验收

- 隔离临时数据库预置一条 `customer_fit` 历史结果，管理员从 AI 任务中心打开详情。
- 桌面页面显示工作站 `v1`、模型 `qwen3.7-flash`、Prompt `prompt-v1`、Schema `v1`、
  规则 `fit-rules-v3`、策略 `customer-fit-2026.07`、64 位上下文指纹和两个证据 ID。
- 桌面 modal `scrollWidth=clientWidth=605`，页面无组件横向溢出。
- 390px 单列追溯布局由 UI 静态回归覆盖；当前内置浏览器不能动态修改 viewport，
  发布 smoke 需再次在可调整 viewport 的浏览器核对。
- 页面验收只使用测试账号和临时数据库，不读取或修改生产数据。

## 发布状态

- 基线：`origin/main @ d03092ec8b257d24f63d4a0a0e7f7f64dc7e00d0`
- 功能分支：`codex/a4-04-stage-gate`
- 当前状态：开发和本地验收完成，待 PR、GitHub CI、合并、生产备份、`quick_check`、
  部署和 local/public smoke。

## 当前进度与下一项

正式进度仍为 `34/38`，剩余 4 项。A4-04 只有在合并并完成生产发布后才计为完成；
届时进度为 `35/38`，剩余 3 项，下一项为 `R5-01 影子运行`。

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
- Chrome `390×844` 实际 viewport 下，文档宽度为 `375/375`，modal
  `scrollWidth/clientWidth=335/335`，详情区为 `295/295`；版本字段按单列显示，
  长上下文指纹和证据 ID 未造成横向溢出。
- 桌面和 390px 页面控制台均无 warning 或 error。
- 页面验收只使用测试账号和临时数据库，不读取或修改生产数据。

## 发布状态

- 基线：`origin/main @ d03092ec8b257d24f63d4a0a0e7f7f64dc7e00d0`
- 功能分支：`codex/a4-04-stage-gate`
- PR [#87](https://github.com/mewmind-chen/russia-crm-local/pull/87) 通过 GitHub CI
  并合并，合并 SHA 为 `e1d3e611f5ef4ca3978f6f1c1e601ab337b52915`。
- 预发布备份 `crm-pre-e1d3e611f5ef-20260725T131513Z.db` 和自动部署备份
  `crm-before-e1d3e611f5ef-20260725T131709Z-83318.db` 均为 `quick_check=ok`。
- 功能发布 SHA 为 `e1d3e611f5ef`；发布记录 PR
  [#88](https://github.com/mewmind-chen/russia-crm-local/pull/88) 合并并同步生产后，
  `current=634372f750d7`、`previous=e1d3e611f5ef`。活动库 `quick_check=ok`，
  schema version 为 16，`decision_trace_json` 列存在；发布记录部署备份
  `crm-before-634372f750d7-20260725T133123Z-90036.db` 亦为 `quick_check=ok`。
- local/public `/healthz` 均报告完整目标 SHA；公网首页 200，未登录 bootstrap 401，
  公网 HTML、JavaScript 和 CSS 已命中 v19 追溯资源。
- 现有 AI Station、客户补全、自动触发、Qwen 在线和销售资料包运行时开关保持开启；
  Qwen Batch 继续因价格/汇率未配置而保持运行时关闭，本任务未放宽该保护。

## 当前进度与下一项

正式进度为 `35/38`，剩余 3 项。阶段 4 已完成，下一项为 `R5-01 影子运行`。

# Issue #81 Qwen 在线路由与 Batch 验收证据

日期：2026-07-25

## 在线通道

- 新增独立 DashScope/Qwen adapter，默认对话模型为 `qwen3.7-plus`。
- 轻量工作站使用 `qwen3.7-flash`，复杂生成工作站使用 `qwen3.7-plus`。
- 自动在线路由为 Qwen 主模型到一次 `deepseek-v4-pro` 降级。
- timeout、网络错误、429、provider 5xx 和 Schema invalid 允许降级；鉴权、取消、预算、
  本地配置、证据和非 429 请求错误禁止降级。
- 两次尝试分别保存 provider、model、request ID、usage、成本和结构化校验状态。
- 管理员可在运行模式中选择 auto、Qwen、Kimi、Hermes 或 DeepSeek，并通过独立运行时
  开关启停 Qwen 在线路由。

## Batch 通道

- DashScope Batch 使用官方文件式流程：上传 UTF-8 JSONL 到 `/files`，以
  `input_file_id` 创建 `/batches`，轮询状态后下载 `output_file_id` 和
  `error_file_id`。
- 数据库 schema v15 保存 batch run/item、input/output/error file ID、上下文快照、
  evidence、幂等键、预算预留、原币成本、汇率版本及导入结果。
- 支持部分失败、漏行、过期、取消、迟到结果、usage 缺失、Schema invalid、孤儿预留和
  Worker 重启恢复。
- 上下文变化时旧结果标记 stale，不写 CRM，并以最新 context hash/evidence 幂等重排。
- Batch 开关关闭后不提交新批次，但继续轮询和收敛已提交批次。
- 新增 `com.russia-crm.qwen-batch-worker`，每 5 分钟运行；默认 Worker ID 使用主机级稳定值。

## 成本和启用边界

- Qwen 价格目录和 CNY→USD 汇率均版本化；缺少有效价格或汇率时拒绝 Batch 提交，不能按
  0 成本执行。
- 管理面板的 Qwen 在线和 Batch 开关均完成桌面及 390px 验收，可即时切换并写审计。
- 生产可开启 Qwen 在线硬门禁和运行时开关。
- Batch 环境硬门禁可以随代码部署，但数据库运行时开关必须在生产存在有效价格目录、
  汇率配置和 `DASHSCOPE_API_KEY` 后才开启。
- 检查生产凭据时只确认变量是否存在，不读取、打印或写入密钥内容。

## 验证结果

- Qwen adapter、路由、模型策略、Schema fallback、Batch 生命周期、成本及 LaunchAgent
  均包含自动化测试。
- 本地完整回归：`530/530`。
- 全部修改和新增 JavaScript `node --check`：通过。
- `git diff --check`：通过。
- 隔离管理员页面显示 Qwen 引擎状态、在线开关和 Batch 开关；390px 页面无页面级横向溢出。

## 发布状态

- Issue：[#81](https://github.com/mewmind-chen/russia-crm-local/issues/81)
- 基线：`origin/main @ 2989bce`
- 功能分支：`codex/issue-81-a4-03-governance`
- PR、合并 SHA、生产配置、LaunchAgent、provider smoke 和 Issue 关闭：待发布后补充。

## 结论

Issue #81 的在线和 Batch 代码路径已完成本地验收。正式完成仍取决于 CI、生产备份与
`quick_check`、回滚确认、部署、LaunchAgent 安装、local/public smoke 和最小 provider
验证；在这些步骤完成前 Issue 保持开放。

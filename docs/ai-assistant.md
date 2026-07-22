# AI 工作助理

## 功能范围

AI 工作助理为 CRM 内有 `use_ai_assistant` 权限的用户提供问答、客户分析、线索筛选、Recon 摘要和下一步建议。助手始终在当前用户可访问的 CRM 数据范围内工作；没有联系人或 Recon 权限时，服务端会剔除相应字段和结果。

## 确定性与生成式流程

系统先识别可由 CRM 数据直接回答的请求，例如今日待跟进、逾期客户、重点客户、联系人入口、Recon 报告、制裁/风险，以及当前客户的明确问题。这些请求走确定性 SQL/快照查询，返回可追溯数据。

其余问题会组合 CRM 检索、向量检索和在允许时的外部搜索上下文，再交给选定 AI 引擎生成回答。生成式回答仍使用服务端权限范围；外部搜索被用户问题禁止时不会执行。继续对话会携带精简历史与当前会话信息。

## 引擎模式与优先级

管理员可选择四种全局模式：

- `auto`（自动）：按 `kimi-cli`、`hermes`、`deepseek` 的优先级选择健康引擎。
- `kimi-cli`：固定 Kimi CLI。
- `hermes`：固定 Hermes。
- `deepseek`：固定 DeepSeek。

自动模式会优先沿用当前会话的健康引擎，再按优先级选择其他健康引擎。固定模式不会改用其他提供方。

## 健康、断路与回退预算

运行时在启动时和固定周期内检测未知或到达重试时间的引擎。管理员的“重新检测”会强制检测全部引擎。每个引擎状态包含 `unknown`、`checking`、`healthy` 或 `unhealthy`，以及最近检测、延迟和管理员可见的已清理错误信息。

引擎发生可识别的提供方错误（包括 402、429、502、503、504）后会进入 `unhealthy`。在 `ASSISTANT_HEALTH_RETRY_MS` 到期前，该引擎处于断路状态，不参与自动路由。自动模式单次请求最多尝试 `ASSISTANT_ROUTER_MAX_ATTEMPTS` 个引擎，且整体不能超过 `ASSISTANT_ROUTER_TIMEOUT_MS`；每个自动尝试最多使用 `ASSISTANT_AUTO_ATTEMPT_TIMEOUT_MS`。默认值分别为 5 分钟、2 次、75 秒和 30 秒。

若没有可用引擎，接口返回 `ASSISTANT_ENGINES_UNAVAILABLE`（503）。调用者可稍后重试，管理员可检查状态并手动重新检测。

## 会话切换与历史

浏览器将最近 12 条消息、`sessionId`、`sessionEngine` 和范围保存在本地存储。请求仅在 `sessionId` 所属的 `sessionEngine` 与当前路由目标相同的时候向提供方传递该会话 ID。

当服务端响应不同的 `sessionEngine` 时，浏览器同时替换 `sessionEngine` 和 `sessionId`；若新提供方未返回原生会话 ID，旧 ID 会被清空。这样自动回退不会把一个提供方的会话 ID 交给另一个提供方。新对话、权限撤销和助手模块撤销都会清空两项会话状态和本地存储。

## 权限与管理员操作

所有助手对话请求仍由既有 CRM 权限控制。`GET /api/assistant/runtime` 需要 `use_ai_assistant`；只有拥有 `manage_users` 的用户能看到完整健康错误、切换模式或重新检测。用户与权限页面的运行时区域只会在此权限存在且不处于身份检查时加载。

管理员在“用户与权限”中可选择运行模式，然后等待 PATCH 完成；可点击“重新检测”触发健康检查。请求进行时选择器和按钮会禁用，避免并发覆盖。界面固定列出 Kimi、Hermes、DeepSeek 的状态、延迟、最近检测时间和已清理错误。

## 运行时接口

### `GET /api/assistant/runtime`

需要 `use_ai_assistant`。返回当前模式、优先级、活动引擎、是否正在检测和每个引擎的公开健康字段。管理员响应额外包含 `errorCode`、`errorMessage`、`updatedBy` 与 `updatedAt`。

```json
{
  "ok": true,
  "mode": "auto",
  "activeEngine": "kimi-cli",
  "checking": false,
  "engines": {
    "kimi-cli": { "status": "healthy", "latencyMs": 420, "lastCheckedAt": "2026-07-22T00:00:00.000Z" }
  }
}
```

### `PATCH /api/assistant/runtime`

需要 `manage_users`。请求体为 `{ "mode": "auto|kimi-cli|hermes|deepseek" }`，返回完整运行时状态。非法模式返回 400 和 `ASSISTANT_MODE_INVALID`。

### `POST /api/assistant/runtime/recheck`

需要 `manage_users`。请求体可为空，服务端立即强制检测全部引擎并返回完整运行时状态。

无权限操作返回 403 和 `ASSISTANT_RUNTIME_FORBIDDEN`。运行时意外失败返回 `ASSISTANT_RUNTIME_ERROR` 或具体错误码。聊天失败会返回 `{ "ok": false, "error": "...", "code": "..." }`；引擎诊断只对管理员展开。

## 配置

从 `.env.example` 复制配置并在部署环境填写真实凭据。路由相关变量如下：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ASSISTANT_ENGINE` | `auto` | 初次初始化时的模式；之后模式存入 CRM SQLite 运行时设置。 |
| `ASSISTANT_HEALTH_RETRY_MS` | `300000` | 失败引擎的断路重试时间。 |
| `ASSISTANT_HEALTH_INTERVAL_MS` | `300000` | 后台健康检查间隔。 |
| `ASSISTANT_HEALTH_PROBE_TIMEOUT_MS` | `12000` | 单个健康探测超时。 |
| `ASSISTANT_ROUTER_TIMEOUT_MS` | `75000` | 自动路由的整体时间预算。 |
| `ASSISTANT_ROUTER_MAX_ATTEMPTS` | `2` | 自动路由最多尝试的引擎数。 |
| `ASSISTANT_AUTO_ATTEMPT_TIMEOUT_MS` | `30000` | 自动模式中单次引擎调用时间预算。 |

Kimi 使用 `ASSISTANT_KIMI_*`，Hermes 使用 `ASSISTANT_HERMES_*`，DeepSeek 使用 `DEEPSEEK_API_KEY` 和可选的 `DEEPSEEK_MODEL`。不要把 API Key、凭据文件或提供方原始报错写入文档、前端或提交记录。

## 日志、部署与回滚

面向浏览器的失败响应会按权限脱敏：普通 AI 用户只收到通用错误消息和公开引擎状态；`manage_users` 用户可能收到包含敏感提供方文本的特权诊断，严禁转发或共享。`server.js` 同时将助手请求以 JSON 行写入 `logs/assistant.log`，包含请求 ID、耗时、精简输入、运行模式、选定引擎、尝试记录、`sessionEngine`、失败码，以及长度受限的内部错误消息和堆栈。提供方错误消息可能携带 stderr 或其他诊断内容；管理权限响应和服务端日志都不是已验证的密钥清洗边界，必须按敏感内部数据处理。

仅授予受控的运维人员读取日志目录的权限，不要将日志作为公开下载、工单附件或前端调试输出。为 `logs/assistant.log` 配置与组织安全策略一致的轮转和保留期限，并在导出、共享或排障前人工审查内容；当前代码只限制字段长度，不承诺对提供方文本中的密钥、令牌或凭据进行自动删除。

部署前运行完整测试并确认 `.env` 中的路径、凭据和端口。发布后以管理员账号打开“用户与权限”，确认自动模式和三个引擎状态，并用真实权限范围发送一次助手请求。保留上一个发布目录和 launchd 指向，回滚时切回旧版本后重启服务；运行时模式保存在 CRM 数据库，不会因仅回滚代码自动恢复，必要时由管理员重新设置。

## 504 与提供方故障排查

1. 先查看管理员运行时面板的状态、延迟、最近检测和已清理错误，再检查 `logs/assistant.log` 中对应请求 ID。
2. 对 504、502、429 或余额/凭据问题，确认提供方凭据、模型名、CLI 路径、网络可达性和本地进程权限；不要把完整密钥或原始报错贴到工单。
3. 在自动模式下，确认至少一个引擎健康；必要时点击“重新检测”。固定模式下故障不会自动改用其他引擎，改为 `auto` 或修复固定引擎后再试。
4. 若所有引擎均断路，等待重试窗口或修复配置后重新检测。检查 `ASSISTANT_ROUTER_TIMEOUT_MS` 与提供方调用时间是否匹配，避免用无限延长超时掩盖故障。
5. 若会话在回退后表现异常，开始新对话以清空本地 `sessionId` 和 `sessionEngine`。

## 测试检查清单

- 运行 `node --test test/assistant_router.test.js test/assistant_model_router.test.js test/assistant_runtime_api.test.js test/hermes_assistant.test.js test/kimi_assistant.test.js test/sales_menu.test.js`。
- 运行 `npm test` 和 `git diff --check`。
- 以无 `manage_users` 权限账号确认没有运行时网络请求和管理面板。
- 以管理员账号确认模式 PATCH、重新检测 POST、请求期间禁用和三行健康展示。
- 在自动模式中模拟引擎切换，确认后续请求的 `sessionId` 只与响应的 `sessionEngine` 匹配。

# CRM 权限隔离修复设计（Issue #4）

## 目标与范围

本设计修复生产环境中“拥有任一开发类权限即可读取整组数据”的越权问题。后端是最终安全边界；前端只负责不展示无权入口，不承担授权职责。

修复覆盖：内嵌开发工作台、legacy API、Sales CRM API、客户/联系人/Recon/报告的数据行范围、入库操作、外贸智能体、AI 助手、权限变更后的现有会话，以及权限组合集成测试。不引入 Redis、外部身份服务或新的数据库。

Issue #3 的多管理员与身份检查不进入本 PR；它将在本安全边界合并后单独设计和提交。

## 已确认根因

1. `server.js` 的 `/api` 通用中间件把 `view_development / view_pool / view_contacts / view_recon` 任意一项视为整组 legacy API 的访问许可。
2. `/development-workbench` 只校验 `view_development`，返回的 `Index.html` 静态包含所有模块入口。
3. `/api/initial` 调用无用户参数的 `getInitialData()`，读取并返回全量客户池、联系人、Recon、模板和智能体数据。
4. 联系人、Recon、报告、监控和客户查询接口没有目标对象的行级授权。
5. `accountScope()` 与 `canAccess()` 依据 `role === 'sales'` 决定是否限域，导致关闭 `view_all_customers` 的经理仍可访问全量数据。
6. `loadPayload()` 和研究列表把 `view_development` 当作联系人、Recon、客户池和入库数据的替代权限。
7. `answerAssistantQuestion()` 不接收当前用户或可见客户范围，SQL、向量检索和当前客户查询可覆盖全库。
8. 现有测试只验证权限布尔值，没有覆盖路由状态码、响应字段、数据行和写操作。

## 方案选择

采用“集中权限策略 + 统一访问上下文 + 数据层限域”。不采用仅隐藏菜单的补丁，也不把现有工作台拆成多个应用。

集中策略让每个路由和动作映射到明确权限；访问上下文把权限与可见客户集合一次计算后传入查询层；序列化前再做敏感字段裁剪作为纵深防御。`view_development` 只代表可以打开工作台外壳，不再授予任何业务数据权限。

## 组件设计

### 1. 集中访问控制模块

新增 `lib/access_control.js`，负责：

- `PERMISSION_DEFINITIONS`、`ROLE_PERMISSIONS`、权限覆盖合并。
- `hasPermission(user, permission)` 与 `assertPermission(user, permission)`。
- `buildAccessContext(db, user)`：返回当前用户、完整权限、`canViewAllCustomers`、允许的 CRM account ID 和 external customer ID。
- `canAccessAccount(context, account)`、`canAccessExternalCustomer(context, customerId)` 和相应断言函数。
- `redactContactFields(row)`：删除 `email`、`phone`、`contact`、联系人摘要、方法、证据等字段。
- 集中 route/action policy 常量，测试可以直接枚举，防止新增路由默认为放行。

当 `view_all_customers=false` 时，不论角色是 `sales`、`manager` 还是 `admin`，可见集合都只来自 `crm_accounts.owner_id = currentUser.id` 且未退回的客户。没有匹配 CRM account 的 legacy 客户、联系人、Recon 和报告默认不可见。

### 2. 会话与能力信息

`sessionUser()` 每次请求都从 `sales_users` 读取用户和最新 `permissions_json`，所以管理员修改权限后旧 session token 无需重新登录即可在下一请求生效。

新增只读端点 `GET /api/session/capabilities`，仅返回：

- 安全用户摘要；
- 权限布尔值；
- 是否全量客户范围；
- 当前可用的工作台模块 key。

不返回客户 ID、联系人或其他业务数据。内嵌工作台启动时先读取此端点，再请求允许模块的数据。接口返回 403 时，前端显示“权限已变更，请刷新工作台”，并移除对应模块状态。

### 3. 内嵌工作台

`/development-workbench` 仍要求 `view_development`，但它只返回壳页面。

壳页面和服务端渲染的 HTML 不嵌入任何客户、电话、邮箱、联系人或 Recon 业务数据。静态 JavaScript 可以保留通用模块定义和文案，但浏览器只实例化获准模块；被拒绝模块对应的业务数据既不进入 DOM，也不保留在全局变量、缓存或组件状态中。权限被撤销后，前端先清空该模块已有状态，再移除入口。

`Index.html` 的模块初始化改为能力驱动：

| 模块 | 权限 |
|---|---|
| 每日交付 | `view_intake` |
| CRM 客户列表/跟进 | `view_customers` |
| 未开发线索池 | `view_pool` |
| 负责人线索/联系方式 | `view_contacts` |
| Recon 列表、详情、报告、监控 | `view_recon` |
| 外贸智能体 | `use_prospect_agent` |
| AI 助手 | `use_ai_assistant` |

无权模块不加入可点击导航；Hash 指向无权模块时切换到第一个允许模块并显示拒绝提示。所有直接 API 调用仍由后端独立返回 403。

### 4. Legacy API 权限矩阵

移除当前“任一开发权限放行全部接口”的末尾总开关，改为默认拒绝和逐路由授权：

| 页面/接口 | 读取权限 | 额外约束 |
|---|---|---|
| `/development-workbench` | `view_development` | 仅壳页面 |
| `/api/session/capabilities` | 已登录 | 仅权限摘要 |
| `/api/initial` | `view_development` | 按各模块权限裁剪集合和字段，并应用行级范围 |
| `/api/customers` | `view_pool` | 该 Legacy 接口实际查询 `customer_pool`；仅返回可见 external customer ID |
| `/api/customers/:customerId/people` | `view_contacts` | customerId 必须在可见范围 |
| `/api/contact-recon/state` | `view_contacts` | jobs/people 仅可见范围 |
| `/api/recon/results/:jobId` | `view_recon` | job 对应客户必须可见 |
| `/api/report` | `view_recon` | job 对应客户必须可见；继续校验报告根目录 |
| `/api/recon-monitor` | `view_recon` | jobs、进程展示和日志不得包含其他客户；非全量用户不返回共享日志尾部 |
| `/api/quality/issues` | `view_recon` + `view_all_customers` | 仅管理全局质量指标 |
| `/api/delivery/latest`、`/api/delivery/file` | `view_intake` | 文件名校验保持不变 |
| `/api/assistant/chat` | `use_ai_assistant` | 所有数据库与向量结果应用访问上下文 |
| `/api/prospect-agent` | `use_prospect_agent` | 动作级写权限见下表 |

Worker token 接口 `/api/recon`、`/api/contact-recon` 继续使用独立 worker token，不接受浏览器 session，也不进入页面权限映射。带显式分享 token 的 `/share/*` 继续作为能力链接存在，其安全边界仍是不可猜测 token、路径校验和 `noindex`。

### 5. Legacy 动作权限矩阵

| 接口动作 | 权限 | 目标范围 |
|---|---|---|
| `/api/app: updateCustomer/createTag/setCustomerTags` | `edit_customer` | 目标客户可见 |
| `/api/app: createReconJob/retryReconJob` | `run_recon` + `view_recon` | 目标客户可见 |
| `/api/app: createContactReconJob` | `run_recon` + `view_contacts` | 目标客户可见 |
| `/api/prospect-agent: createTask/rerunTask` | `use_prospect_agent` | 无 CRM 客户读取时不附带全库数据 |
| `/api/prospect-agent: promoteCandidate` | `use_prospect_agent` + `edit_customer` | 若同时创建 Recon，再要求 `run_recon` + `view_recon` |

未知 route/action 默认 403，而不是进入业务函数后才返回 400。

### 6. `/api/initial` 数据裁剪

`getInitialData(accessContext)` 在 SQL 查询层应用范围，并在返回前再次裁剪：

- 无 `view_customers`：`customers` 为空。
- 无 `view_pool`：`customerPool`、pool stats 和 pool prospect 数据为空。
- 无 `view_contacts`：`people`、contact recon jobs、联系人证据为空；所有其他集合删除邮箱、电话、联系人姓名/职位、联系人摘要和方法字段。
- 无 `view_recon`：`reconJobs`、`reconResults`、Recon evidence、报告入口和 Recon stats 为空。
- 无 `use_prospect_agent`：prospect tasks/candidates/sources 为空。
- 模板只在具备 `view_development` 时返回，但模板内容不得嵌入客户数据。

伍伟组合（`view_development=true`、`view_contacts=false`）得到的 JSON 字符串不得包含 `people` 数据行、电话、邮箱、联系人证据或联系人摘要。

### 7. Sales CRM API

`bootstrap` 可以在登录后调用，但每个集合只由自己的 view 权限控制；`view_development` 不再替代 `view_intake/view_pool/view_contacts/view_recon`。登录、退出和本人改密属于身份接口，不套用业务读取权限；其余 `/api/sales-crm/*` 必须出现在集中策略中。

`bootstrap` 的集合映射如下：`summary/funnel` 由 `view_dashboard` 控制，`accounts/activities/rfqs/quotes/orders` 由 `view_customers` 控制，`alerts` 由 `view_alerts` 控制，`countryReport/cohortReport` 由 `view_markets` 控制，`teamReport` 由 `view_team` 控制，`insights` 由 `view_insights` 控制，`intake` 由 `view_intake` 控制，用户/审计/迁移复核由 `view_users` 控制。每个集合仍应用当前用户的数据行范围；不能因拥有驾驶舱、管道或市场视图权限而把完整客户明细一并返回。`view_pipeline` 只开放按范围聚合的管道数据，不隐式开放客户详情。

| 接口 | 权限 |
|---|---|
| `GET bootstrap` | 已登录；响应逐集合裁剪 |
| `GET research/pool` | `view_pool` |
| `GET research/people` | `view_contacts` |
| `GET research/recon` | `view_recon` |
| `POST accounts` | `create_customer` |
| `PATCH accounts/:id` | `edit_customer` + 目标可见 |
| `POST activities` | `record_activity` + 目标可见 |
| `POST quotes` | `record_quote` + 目标可见 |
| `POST orders` | `record_order` + 目标可见 |
| `POST contacts` | `view_contacts` + `edit_customer` + 目标可见 |
| `POST evaluations`、`POST evaluations/:id/retry` | `manage_evaluations` + 目标可见 |
| `POST users`、`PATCH users/:id`、迁移复核 | `view_users` + `manage_users` |
| `POST password` | 已登录，仅本人 |
| `POST intake/scan`、`PATCH intake/settings` | `view_intake` + `manage_intake` |

`intake/action` 单独处理：销售必须有 `view_intake`，只可 claim/return/reject 分配给自己的 item；管理类 assign/reassign/bulk 操作必须同时具备 `view_intake` 和 `manage_intake`。非销售没有 `manage_intake` 时不能利用角色捷径操作。

### 8. AI 助手限域

`answerAssistantQuestion(payload, accessContext)` 成为唯一入口。以下路径都必须接收并应用相同 access context：

- 当前客户确定性查询；
- 通用 SQL 意图查询和分页；
- Recon、证据和联系人摘要查询；
- 向量检索及相似客户；
- matched customers、sources、report excerpt；
- 上下文传入的 customerId/followId/jobId。

请求指定不可见客户时返回 403，不以“未找到”结果继续检索。无 `view_contacts` 时，即使用户拥有 AI 权限，输入和输出都不包含电话、邮箱、联系人、contact report excerpt。无 `view_recon` 时不读取 Recon 结果或报告正文。AI 日志继续脱敏，不记录 session、密码或完整联系人数据。

### 9. 测试架构

为避免真实业务数据进入测试，支持 `CRM_DB_PATH` 指向临时 SQLite 数据库，并把服务创建与端口监听分离为 `createApp()` 和 `startServer()`。集成测试使用 Node 内置 test runner、临时数据库和本地随机端口，不新增测试框架。

测试矩阵至少包含：

1. 伍伟组合：服务端 HTML 无业务数据，工作台运行时 DOM/内存状态无负责人入口和联系人数据；people/contact state 403；initial/bootstrap 无联系人集合和敏感字段。
2. 分别关闭 `view_pool`、`view_recon`、`view_intake` 时，对应页面状态和直接接口均拒绝。
3. `view_all_customers=false` 的经理只能读取/修改本人 owner_id 的客户；按 account ID、external customer ID、job ID、搜索、报告均不能越权。
4. 无各写权限时，直接 POST/PATCH 返回 403，数据库无变化。
5. `manage_intake=false` 的非销售不能执行管理动作；销售不能操作他人的 item。
6. AI 只返回可见客户；联系人和 Recon 权限分别关闭时不泄漏对应字段与报告。
7. route/action policy 枚举测试确保所有浏览器 API 都有显式策略，未知动作默认拒绝。
8. 修改用户 `permissions_json` 后复用原 session，下一请求立即按新权限返回 403 或裁剪响应。

在提交 PR 前，用生产数据库的一致性副本运行只读/回滚式验证；测试输出只记录状态码、行数、字段名和匿名 ID，不记录真实密码、电话、邮箱或联系人姓名。

## 错误处理与审计

- 未登录统一返回 401；缺少权限或目标超出范围统一返回 403；目标在允许范围内但不存在返回 404；输入错误返回 400。
- 403 响应只说明缺少的权限，不回显目标客户是否存在，避免对象枚举。
- 成功写操作继续进入审计日志；被拒绝的高风险写操作记录 permission、route/action、真实 user ID 和匿名化目标类型，不记录敏感 payload。
- 前端遇到 401 返回登录页；遇到 403 移除对应模块并提示权限已更新。

## 上线与回滚

1. 在生产数据库副本完成权限矩阵测试和伍伟场景浏览器验证。
2. 部署前用 SQLite `.backup` 创建一致性备份。
3. 合并后安装锁定依赖、运行完整测试、重启 CRM 服务并检查本机及公网健康。
4. 用伍伟场景确认联系人入口消失且接口 403，再用管理员确认允许路径不回归。
5. 本修复不修改业务表结构；回滚时 revert 本 PR 并重启服务。若新增测试用环境变量，不影响默认生产路径。

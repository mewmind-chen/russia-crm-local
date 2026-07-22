# CRM Data Maintenance Implementation Plan

**Goal:** 为 CRM 增加管理员专用、可预览、自动备份、事务执行且可审计的数据维护功能；第一版交付“重置客户分配”，让指定线索安全回到待分配状态。

**Architecture:** 新建 `lib/data_maintenance.js` 作为唯一的数据维护领域模块，负责 schema、目标解析、影响预览、fingerprint、备份、互斥和事务执行。`lib/sales_crm.js` 只注册受统一策略保护的 API。后台新增独立“数据维护”页面。现有重置脚本改为复用同一领域模块，避免 CLI 与 Web 语义分叉。

**Tech Stack:** Node.js 18+、Express 4、better-sqlite3 11、SQLite、浏览器原生 HTML/CSS/JavaScript、Node 内置测试运行器。

## 全局约束

- 第一版只实现 `reset_assignments`，不实现整库清空、研究数据清理或 Web 恢复。
- 保留 `customer_pool`、Recon、联系人研究、AI 索引、用户、权限、会话、配置和全部审计。
- 维护 API 必须同时满足 `manage_data_maintenance`、真实管理员和非身份检查状态。
- 空筛选永远拒绝；执行只能引用未过期的 preview，不能同时提交新筛选条件。
- 删除前必须成功创建 SQLite online backup。
- 删除和状态回退必须位于同一个 SQLite 事务。
- 运行日志不得包含密码、session、联系人详情或完整数据库路径。
- 不新增生产依赖，不引入队列或外部数据库。

---

## Task 1：锁定重置语义和测试夹具

**Files:**

- Create: `test/data_maintenance.test.js`
- Modify: `test/helpers/permission_fixture.js`
- Reference: `scripts/reset-crm-to-undeveloped-leads.js`
- Reference: `lib/sales_crm.js`

**Steps:**

- [ ] 在 fixture 中创建两个批次、两个销售、不同状态的 intake items，以及由其中部分 item 领取产生的 CRM 账户。
- [ ] 为目标账户填充 activity、RFQ、quote、order、CRM contact、manager evaluation 和 notification。
- [ ] 为非目标账户创建同类记录，作为隔离性断言。
- [ ] 为同一 external customer 创建需要保留的 customer_pool、Recon、联系人研究和 AI index 记录。
- [ ] 写失败测试：空筛选被拒绝。
- [ ] 写失败测试：目标解析只包含 `assigned / claimed / returned`。
- [ ] 写失败测试：手工创建、关系错配或悬空 `crm_customer_id` 返回冲突。
- [ ] 运行 `node --test test/data_maintenance.test.js`，确认因模块不存在而失败。

**Acceptance:** fixture 能同时验证删除范围、保留范围和冲突范围，测试不依赖生产数据库。

---

## Task 2：新增权限与路由策略

**Files:**

- Modify: `lib/access_control.js`
- Modify: `lib/permission_groups.js`
- Modify: `test/access_control.test.js`
- Modify: `test/permission_groups.test.js`
- Modify: `test/permission_integration.test.js`
- Modify: `test/impersonation_authorization.test.js`

**Steps:**

- [ ] 在 `PERMISSION_DEFINITIONS` 增加 `manage_data_maintenance`。
- [ ] 管理员默认允许，经理和销售默认拒绝。
- [ ] 为以下策略增加映射：
  - `GET /data-maintenance/capabilities`
  - `GET /data-maintenance/runs`
  - `POST /data-maintenance/preview`
  - `POST /data-maintenance/execute`
- [ ] 四个路由均要求 `manage_data_maintenance`、`realAdminOnly: true`、`blockedWhileImpersonating: true`。
- [ ] 更新路径规范化逻辑，确保动态或查询参数不绕过策略。
- [ ] 测试经理即使被个人 override 强制允许，也因 real-admin 边界被拒绝。
- [ ] 测试管理员处于身份检查时预览和执行均被拒绝。
- [ ] 运行相关权限测试。

**Acceptance:** 未映射路由 fail closed；只有真实管理员可进入维护边界。

---

## Task 3：实现维护 schema 与目标预览

**Files:**

- Create: `lib/data_maintenance.js`
- Modify: `lib/sales_crm.js`
- Modify: `test/data_maintenance.test.js`

**Interfaces:**

- `installDataMaintenance(db) -> void`
- `normalizeMaintenanceFilters(input) -> normalizedFilters`
- `resolveResetAssignmentTargets(db, filters) -> targetSet`
- `previewDataMaintenance(db, identity, sessionHash, request) -> preview`
- `listMaintenanceRuns(db, limit) -> run[]`

**Steps:**

- [ ] 创建 `crm_data_maintenance_runs` 和必要索引，安装过程可重复执行。
- [ ] 白名单解析 `operation`，第一版只接受 `reset_assignments`。
- [ ] 规范化数组、日期和 `allAssigned`；拒绝未知字段、无效用户/批次和空范围。
- [ ] 使用参数化 SQL 解析目标 intake items，不能拼接用户输入。
- [ ] 双向校验 `crm_intake_items.crm_customer_id` 与 `crm_accounts.intake_item_id`。
- [ ] 统计各子表和直接关联通知数量。
- [ ] 以稳定排序的目标 ID、状态、更新时间和计数生成 SHA-256 fingerprint。
- [ ] 生成 10 分钟 preview、动态确认文字和最小化运行摘要。
- [ ] 预览 token 只在进程 Map 中保存明文，数据库只保存 hash。
- [ ] 测试目标、跳过项、冲突、计数、fingerprint 稳定性和过期行为。

**Acceptance:** preview 只读业务表，返回的影响数量与 fixture 精确一致。

---

## Task 4：实现备份、互斥和事务执行

**Files:**

- Modify: `lib/data_maintenance.js`
- Modify: `test/data_maintenance.test.js`

**Interfaces:**

- `maintenanceCapabilities() -> capabilities`
- `executeDataMaintenance(dbFactory, identity, sessionHash, request) -> result`
- `recoverInterruptedMaintenanceRuns(db) -> count`

**Steps:**

- [ ] 解析并验证 `CRM_BACKUP_DIR`，默认使用 `backups/data-maintenance`。
- [ ] 使用不可预测 run ID 和服务端生成的文件名，拒绝任何客户端路径。
- [ ] 增加进程内执行互斥；并发执行返回 `MAINTENANCE_BUSY`。
- [ ] 校验 preview 归属、session、有效期、未使用状态和确认文字。
- [ ] 执行前重新解析目标并比较 fingerprint；变化时返回 `MAINTENANCE_PREVIEW_STALE`。
- [ ] 使用 `db.backup()` 生成完整 SQLite 快照，备份失败时不进入事务。
- [ ] 在 `IMMEDIATE` 事务中按目标 account ID 删除账户、清理通知、更新 intake items，并重算受影响批次的 `assigned_count`。
- [ ] 成功提交后将 run 标记为 completed 并销毁 preview。
- [ ] 失败时回滚业务事务、记录稳定错误码并保留已生成备份。
- [ ] 启动时将遗留 running 记录标记为 failed/interrupted。
- [ ] 测试备份存在且可由 SQLite 打开；测试业务数据删除与保留矩阵。
- [ ] 测试 stale、重复执行、确认错误、备份失败、事务失败和并发互斥。

**Acceptance:** 任意失败路径均不产生部分业务修改；成功路径可从备份恢复原始 fixture。

---

## Task 5：注册 API 并完成审计

**Files:**

- Modify: `lib/sales_crm.js`
- Modify: `server.js`
- Create: `test/data_maintenance_api.test.js`
- Modify: `test/permission_integration.test.js`

**Steps:**

- [ ] 在 Sales CRM 安装流程调用 `installDataMaintenance` 和 interrupted-run 恢复。
- [ ] 注册 capabilities、runs、preview、execute 四个端点。
- [ ] preview/execute 始终使用 `req.realUser`，并传入当前 session token hash 上下文。
- [ ] 所有错误通过现有 `sendApiError` 返回 JSON 和稳定错误码。
- [ ] 通用审计记录真实管理员、endpoint、run ID 和计数摘要；不记录 preview token 或确认文字。
- [ ] 若现有通用审计会记录敏感字段，在 `redactAuditPayload` 增加 `previewId / confirmationText` 脱敏。
- [ ] 测试 400、401、403、409、500 和成功响应均为 JSON。
- [ ] 测试权限拒绝、身份检查拒绝时不创建备份或维护 run。

**Acceptance:** API 契约与设计文档一致，审计可以关联维护 run 和真实管理员。

---

## Task 6：实现后台“数据维护”页面

**Files:**

- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Modify: `test/sales_access_ui.test.js`

**Steps:**

- [ ] 在系统菜单新增 `maintenance`，要求 `manage_data_maintenance`。
- [ ] 身份检查状态下隐藏入口；服务端权限仍为最终边界。
- [ ] 实现批次、负责人、时间、具体线索和“全部已分配/已领取”范围控件。
- [ ] 没有任何范围时禁用预览按钮。
- [ ] 调用 preview 后展示删除/保留矩阵、精确计数、跳过项和冲突。
- [ ] 有冲突时禁止执行并提供可复制的冲突 ID。
- [ ] 确认抽屉要求完整输入后端返回的动态确认文字。
- [ ] 执行期间禁用重复提交；处理 stale/busy/expired 并要求重新预览。
- [ ] 成功后清空表单、展示备份文件名和 run ID，重新加载 bootstrap。
- [ ] 展示最近 20 条维护记录，不提供备份下载按钮。
- [ ] 添加响应式和键盘可访问样式。
- [ ] 增加静态 UI 权限测试和关键 DOM/事件绑定测试。

**Acceptance:** 管理员能从后台完成“选择 → 预览 → 确认 → 执行 → 刷新”，其他用户看不到入口且 API 仍拒绝。

---

## Task 7：统一现有 CLI 重置脚本

**Files:**

- Modify: `scripts/reset-crm-to-undeveloped-leads.js`
- Modify: `package.json`
- Create: `test/data_maintenance_cli.test.js`
- Modify: `README.md`

**Steps:**

- [ ] 将脚本改为调用 `lib/data_maintenance.js`，不再维护独立删除 SQL。
- [ ] 默认 dry-run，只打印规范化范围、影响数量和确认命令。
- [ ] `--apply` 必须要求显式 `--all-assigned` 或批次/负责人/item 参数。
- [ ] CLI 走相同 backup、fingerprint、事务和运行日志逻辑，但身份记录为受控的 `system-cli` actor。
- [ ] 保留旧命令入口一段兼容期，输出新语义提示。
- [ ] 更新 README 的演练、执行和恢复说明。

**Acceptance:** Web 与 CLI 对同一 fixture 得到完全一致的目标和结果；CLI 无参数不会修改数据。

---

## Task 8：全量回归与安全复核

**Files:**

- Modify: `test/server_factory.test.js`（如需）
- Modify: `docs/permission-matrix.md`
- Create: `docs/evidence/data-maintenance-verification.md`

**Steps:**

- [ ] 运行 `node --test test/data_maintenance.test.js test/data_maintenance_api.test.js test/data_maintenance_cli.test.js`。
- [ ] 运行权限、身份检查、集成和 UI 测试。
- [ ] 运行 `npm test`。
- [ ] 检查 `git diff --check`。
- [ ] 人工验证 preview token、session 和确认文字不会进入日志。
- [ ] 人工验证备份目录不由 Express 静态托管。
- [ ] 人工验证直接请求 execute 时不能携带筛选条件绕过 preview。
- [ ] 人工验证数据库启用 foreign keys，目标经营子表无孤立记录。
- [ ] 在生产数据库副本上运行一次 dry-run，记录前后表计数。
- [ ] 从生成的备份恢复副本，并执行 `PRAGMA integrity_check` 与关键业务查询。
- [ ] 将命令、结果、计数和恢复验证写入 evidence 文档，不记录客户敏感内容。

**Acceptance:** 全量测试通过，副本演练与恢复成功，权限矩阵和验证证据完整。

---

## Task 9：部署与发布检查

**Files:**

- Modify: `README.md`
- Modify: `deploy/systemd/tradepulse.service`（仅在需要 `CRM_BACKUP_DIR` 时）

**Steps:**

- [ ] 部署前对生产 `data/crm.db` 再做一次独立运维备份。
- [ ] 确认 `backups/data-maintenance` 所在磁盘容量和服务用户写权限。
- [ ] 部署代码并重启服务，确认 schema 幂等安装成功。
- [ ] 管理员先做小批次预览，不立即执行，核对影响计数。
- [ ] 选择一条可验证的测试分配执行首次维护。
- [ ] 检查 CRM 页面、待分配队列、批次统计、研究数据和审计记录。
- [ ] 扩大到目标批次；每次维护保留 run ID 和备份文件名。
- [ ] 若异常，停止服务，按 README 使用对应备份恢复后再启动。

**Acceptance:** 首次生产维护在可控小范围内验证成功，存在明确恢复点和审计记录。

## 建议交付拆分

1. **PR A — Domain + Security:** Task 1–5，完成领域逻辑、权限和 API，不开放 UI。
2. **PR B — Admin UI + CLI:** Task 6–7，开放后台工作流并统一脚本。
3. **PR C — Verification + Deploy:** Task 8–9，完成全量证据和生产演练。

每个 PR 独立通过 `npm test`，不把未受 API 权限保护的危险按钮提前暴露给生产用户。

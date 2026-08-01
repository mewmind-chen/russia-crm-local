# Issue #172 合作客户保护名单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 建立管理员保护名单、Alpha/当前/历史昵称全公司唯一、批次预览导入、激活保号和销售端完全隔离。

**架构：** 标准化名称注册表将一个 canonical name 映射到唯一稳定外部客户编号；保护客户只存在于 `customer_pool` 和保护表，激活前不创建 `crm_accounts`。先只读预检，再启用事务性保护生命周期，最后上线管理员 UI。

**技术栈：** Node.js、SQLite、Express、原生前端、Node test。

## 全局约束

- 依赖 #96 已合并并在生产验证。
- `manage_protected_customers` 是独立权限，只给 admin 默认允许；不能由 `view_all_customers` 推导。
- 冲突未清零前不得在启动路径创建唯一索引。
- 销售搜索、错误、模糊候选、任务、通知、统计和普通导出不得泄露 Alpha 名称或保护状态。
- `CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED` 默认 `false`；首次部署只验证 schema、读取和权限，生产冒烟通过后再改为 `true` 并重启。

---

### Task 1：#172-A 标准化身份注册表和只读预检

**文件：**

- 创建：`lib/customer_identity_registry.js`
- 创建：`scripts/audit-protected-customer-identities.js`
- 修改：`lib/sales_crm.js: installSalesCrm、ensureCustomerMasterNicknameSchema`
- 修改：`lib/access_control.js`
- 修改：`.env.example`
- 创建：`test/issue172_identity_registry.test.js`
- 创建：`test/issue172_identity_migration.test.js`

**接口：**

- `normalizeCustomerName(input) -> string`：NFKC、trim、连续空白折叠、locale lower-case。
- `reserveCustomerIdentity(db,{externalCustomerId,name,source,actorId}) -> {normalizedName,created}`。
- `auditProtectedCustomerIdentities(db,{apply:false}) -> {aliases,conflicts,unresolved}`。

- [ ] **步骤 1：写标准化失败测试**

覆盖全角/半角、NFKC、大小写、首尾和连续空格、中文、西里尔字符、空昵称；同一标准名可绑定同一稳定客户的多个角色，不可绑定另一个客户。

运行：`node --test test/issue172_identity_registry.test.js`。

预期：模块不存在，测试失败。

- [ ] **步骤 2：写迁移冲突测试**

建立 pool/account/nickname audit 跨表冲突夹具；预检必须报告所有来源、稳定编号和冲突，但不猜测合并、不写数据库；重复扫描结果稳定。

- [ ] **步骤 3：实现注册表 schema 和权限**

创建 `crm_customer_identity_registry(normalized_name PRIMARY KEY,external_customer_id,source,first_seen_at,updated_at)`、迁移报告表和审计表；新增 `manage_protected_customers`，admin=true，manager/sales=false；在 `.env.example` 写入默认关闭的 `CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED=false`。

- [ ] **步骤 4：实现只读 CLI**

命令 `node scripts/audit-protected-customer-identities.js --db "$production_copy" --json` 扫描 pool/account/history 并输出 JSON。没有 `--apply` 时禁止执行 INSERT/UPDATE/CREATE UNIQUE INDEX。

- [ ] **步骤 5：运行测试和生产副本预检**

```bash
production_copy=/Users/ylf/Desktop/projects/tradepulse-production/state/preflight/crm-production-copy.db
mkdir -p /Users/ylf/Desktop/projects/tradepulse-production/state/preflight
sqlite3 /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db ".backup '$production_copy'"
node --test test/issue172_identity_registry.test.js test/issue172_identity_migration.test.js test/customer_nickname.test.js test/permission_integration.test.js
node scripts/audit-protected-customer-identities.js --db "$production_copy" --json
```

预期：测试通过；报告明确给出 `unresolved`，原副本哈希不变。

- [ ] **步骤 6：提交 PR #172-A**

```bash
git add lib/customer_identity_registry.js scripts/audit-protected-customer-identities.js lib/sales_crm.js lib/access_control.js .env.example test/issue172_identity_registry.test.js test/issue172_identity_migration.test.js
git commit -m "feat: add protected customer identity preflight"
git push -u origin codex/issue-172a-identity-preflight
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-172a-identity-preflight --title "feat: add protected customer identity preflight" --body "Refs #172. 建立标准化身份注册表、独立权限和只读冲突预检，不启用线上唯一约束。"
```

---

### Task 2：#172-B 批次导入、激活、唯一性和隔离

**文件：**

- 创建：`lib/protected_customers.js`
- 修改：`lib/sales_crm.js: addAccount、updateAccount、updateCustomerNickname、bulkAssign、restore/reassign、export、intake scan`
- 修改：`lib/ai_stations/enrichment/dedupe.js`
- 修改：`lib/ai_stations/enrichment/intake.js`
- 修改：`lib/access_control.js`
- 创建：`test/issue172_protected_customer_lifecycle.test.js`
- 创建：`test/issue172_protected_customer_concurrency.test.js`
- 创建：`test/issue172_protected_customer_privacy.test.js`

**接口：**

- `previewProtectedBatch(db,user,rows) -> {batchId,rows,conflicts}`。
- `commitProtectedBatch(db,user,batchId) -> {imported,rejected,auditId}`。
- `activateProtectedCustomer(db,user,externalCustomerId,payload) -> {customerId,accountId}`。
- `rollbackProtectedBatch(db,user,batchId) -> {rolledBack}`；激活或业务引用后返回 409。

- [ ] **步骤 1：写生命周期失败测试**

管理员可预览、提交、激活和条件回滚；保护客户没有 account；激活保留 pool customer ID 且只创建一个 account；重复提交/激活返回相同结果。

- [ ] **步骤 2：写隔离和隐私测试**

保护客户不出现在 intake、线索池、分配、CRM 搜索、今日待办、通知、dashboard、pipeline、team 和普通 export；销售 exact/fuzzy response 只返回通用重复提示，不包含姓名、score、状态或 owner；直接 API 403。

- [ ] **步骤 3：写双连接竞态测试**

两个 SQLite 连接同时创建/编辑/导入/恢复/激活同一标准名称，断言一方成功，另一方确定性冲突；不得出现两个 registry owner 或两个 account。

- [ ] **步骤 4：实现保护生命周期表和事务**

创建 batch、row、protected mapping 和 audit 表。保护状态限定 `protected|activated|withdrawn`；每个提交和激活使用 `BEGIN IMMEDIATE`、registry 主键和 idempotency key。

- [ ] **步骤 5：接入全部身份入口**

普通新增/编辑、昵称更新、恢复、重新分配、保护导入和激活统一调用 registry；普通 `normalizeMinimalCustomerInput` 继续要求公司或官网，保护导入使用独立 admin validator。

- [ ] **步骤 6：在冲突清零后启用 DB 约束**

生产副本预检 `unresolved=0` 后才创建唯一约束；未清零时 feature flag 保持关闭且部署不得进入写入启用阶段。

- [ ] **步骤 7：运行测试和提交 PR #172-B**

```bash
node --test test/issue172_protected_customer_lifecycle.test.js test/issue172_protected_customer_concurrency.test.js test/issue172_protected_customer_privacy.test.js test/customer_nickname.test.js test/issue158_duplicate_protection.test.js
npm test -- --test-concurrency=1
git add lib/protected_customers.js lib/sales_crm.js lib/access_control.js lib/ai_stations/enrichment/dedupe.js lib/ai_stations/enrichment/intake.js test/issue172_protected_customer_lifecycle.test.js test/issue172_protected_customer_concurrency.test.js test/issue172_protected_customer_privacy.test.js
git commit -m "feat: protect customer identities and activation"
git push -u origin codex/issue-172b-protected-customer-lifecycle
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-172b-protected-customer-lifecycle --title "feat: protect customer identities and activation" --body "Refs #172. 依赖 #172-A，提供批次、隔离、激活、唯一性和并发保护。"
```

---

### Task 3：#172-C 管理员界面和授权导出

**文件：**

- 修改：`sales-crm.html`
- 修改：`sales-assets/app.js`
- 修改：`sales-assets/app.css`
- 创建：`test/issue172_protected_customer_ui.test.js`

- [ ] **步骤 1：写 UI/权限失败测试**

管理员看到保护名单、模板、预览、冲突分组、提交、激活、回滚和映射导出；主管/销售不显示入口，直接路由 403；普通导出不含 Alpha 名称。

- [ ] **步骤 2：实现管理工作区**

复用“用户与权限/数据维护”导航模式；预览表显示行号、标准化结果、冲突原因、可执行状态；提交/激活/回滚有 pending、success、error，失败保留输入。

- [ ] **步骤 3：实现管理员专用映射导出**

导出包含稳定编号、Alpha 名称、当前名称和状态，仅 `manage_protected_customers` 可用；普通 export schema 不增加 Alpha 字段。

- [ ] **步骤 4：浏览器和端到端验证**

在 1280/430/390/375/320px 预览一批数据，激活一条临时保护客户；确认稳定编号不变，CRM/待办只出现一次，sales scope 不泄露其保护历史。

- [ ] **步骤 5：提交并关闭 #172**

```bash
node --test test/issue172_protected_customer_ui.test.js test/issue172_protected_customer_privacy.test.js test/permission_integration.test.js
npm test -- --test-concurrency=1
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/issue172_protected_customer_ui.test.js
git commit -m "feat: add protected customer admin workspace"
git push -u origin codex/issue-172c-protected-customer-ui
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-172c-protected-customer-ui --title "feat: add protected customer admin workspace" --body "Closes #172. 依赖 #172-A/B，提供管理员保护名单界面、授权导出和移动端回归。"
```

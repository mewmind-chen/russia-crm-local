# Permission Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Issue #4，使页面、Legacy API、Sales CRM API、报告、Recon 和 AI 助手统一遵守细粒度权限与客户负责人数据范围。

**Architecture:** 新增单一 `access_control` 模块定义权限、路由策略、访问上下文和字段脱敏；所有 HTTP 入口先授权，再把同一访问上下文传给查询与写入函数。服务改为可创建、可启动的两段式结构，集成测试使用临时 SQLite 数据库和随机本地端口，不接触生产数据。

**Tech Stack:** Node.js >=18、Express 4、better-sqlite3 11、Node 内置 `node:test`、原生 `fetch`、HTML/原生 JavaScript。

## Global Constraints

- 后端是最终授权边界，前端隐藏入口不能替代接口 403。
- 保持 Node.js + SQLite，不增加 Redis、外部身份服务或测试框架。
- `view_all_customers=false` 对 admin、manager、sales 一视同仁，只允许访问 `crm_accounts.owner_id=currentUser.id` 且未退回的客户。
- 未映射的浏览器 route/action 默认 403；worker token 与分享 token 保持独立安全边界。
- 无 `view_contacts` 时，响应、DOM、浏览器状态、AI 输入输出均不得包含电话、邮箱、联系人、职位、摘要、方法或证据。
- 401 表示未登录，403 表示缺少权限或目标越界，404 表示授权范围内资源不存在，400 表示输入无效。
- 除为 `prospect_tasks` 增加任务所有者元数据外，不修改客户业务表结构；不做无关界面重构，不在测试日志中输出真实客户或联系人信息。

## File Structure

- Create `lib/access_control.js`: 权限定义、角色默认值、策略矩阵、访问上下文、行级断言、脱敏。
- Create `test/helpers/permission_fixture.js`: 临时数据库、用户/客户夹具、登录 cookie、HTTP 请求助手。
- Create `test/access_control.test.js`: 纯函数权限与范围单元测试。
- Create `test/permission_integration.test.js`: 页面、Legacy API、Sales CRM、写入、会话刷新集成测试。
- Create `test/assistant_scope.test.js`: AI 确定性查询、向量/报告/联系人限域测试。
- Modify `server.js`: `createApp/startServer`、逐路由授权、能力端点、Legacy 查询范围。
- Modify `lib/db.js`: 可配置数据库路径、`getInitialData/getContactReconState/getCustomerPeople` 接收访问上下文。
- Modify `lib/sales_crm.js`: 复用集中权限、刷新会话、bootstrap 裁剪、写入和 intake 范围检查。
- Modify `lib/assistant.js`: `answerAssistantQuestion(payload, accessContext)` 并对所有检索分支限域。
- Modify `lib/assistant_index.js`: 向量候选按允许 external customer ID 过滤。
- Modify `Index.html`: 能力驱动导航、禁止模块不初始化、权限撤销后清空状态。
- Modify `sales-assets/app.js`: bootstrap 仅消费获准集合，403 后清理对应客户端状态。
- Modify `README.md`: 权限矩阵、测试命令、生产副本验证和回滚说明。

---

### Task 1: Isolated HTTP Test Harness

**Files:**
- Create: `test/helpers/permission_fixture.js`
- Create: `test/server_factory.test.js`
- Modify: `server.js`
- Modify: `lib/db.js`
- Modify: `lib/sales_crm.js`
- Modify: `lib/assistant.js`
- Modify: `lib/assistant_index.js`

**Interfaces:**
- Produces: `createApp(): Express`, `startServer(options?): http.Server`, `databasePath(): string`, `createPermissionFixture(): Promise<Fixture>`.
- `Fixture` exposes `{ dbPath, db, baseUrl, login(email,password), request(path, options), close() }`.

- [ ] **Step 1: Write the failing server factory test**

```js
// test/server_factory.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

test('server module creates an app without listening', () => {
  const { createApp, startServer } = require('../server');
  assert.equal(typeof createApp, 'function');
  assert.equal(typeof startServer, 'function');
  assert.equal(typeof createApp().listen, 'function');
});
```

- [ ] **Step 2: Run the test and verify the current eager listener fails**

Run: `node --test test/server_factory.test.js`

Expected: FAIL because `createApp` and `startServer` are not exported, and no test process may retain port 3000.

- [ ] **Step 3: Make database paths configurable and split app creation from listening**

Use this exact helper in `lib/db.js`, `lib/sales_crm.js`, `lib/assistant.js`, and `lib/assistant_index.js`:

```js
function databasePath() {
  return path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db'));
}
```

In `server.js`, use `path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, 'data', 'crm.db'))`, wrap the existing middleware and route registration between `function createApp() { const app = express();` and `return app; }`, replace every direct `data/crm.db` open with `databasePath()`, and replace the eager listener with:

```js
function startServer({ port = process.env.PORT || 3000, host = process.env.HOST || '127.0.0.1' } = {}) {
  const app = createApp();
  return app.listen(port, host, () => {
    console.log(`✅ Russia CRM running at http://${host}:${port}`);
  });
}

if (require.main === module) startServer();
module.exports = { createApp, startServer, databasePath };
```

Update `lib/db.js`, `lib/sales_crm.js`, `lib/assistant.js`, and `lib/assistant_index.js` so each call to `new Database` resolves `process.env.CRM_DB_PATH` at call time, not module-load time.

- [ ] **Step 4: Add the reusable fixture**

```js
// test/helpers/permission_fixture.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function createPermissionFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-permissions-'));
  const dbPath = path.join(dir, 'crm.db');
  if (process.env.CRM_FIXTURE_BASE_DB) fs.copyFileSync(path.resolve(process.env.CRM_FIXTURE_BASE_DB), dbPath);
  process.env.CRM_DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  const { installSalesCrm } = require('../../lib/sales_crm');
  const { createApp } = require('../../server');
  installSalesCrm();
  require('../../lib/db').ensureTables();
  const db = new Database(dbPath);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    dir, dbPath, db, baseUrl,
    async login(email, password) {
      const response = await fetch(`${baseUrl}/api/sales-auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return String(response.headers.get('set-cookie') || '').split(';')[0];
    },
    request(route, { cookie = '', method = 'GET', body } = {}) {
      return fetch(`${baseUrl}${route}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    async close() {
      db.close();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.CRM_DB_PATH;
    },
  };
}

module.exports = { createPermissionFixture };
```

Export `ensureTables` from `lib/db.js` for fixture setup only.

In the same helper, add deterministic sanitized seed functions used by every later task:

```js
async function seededFixture(options = {}) {
  const fx = await createPermissionFixture();
  const { hashPassword } = require('../../lib/sales_crm');
  const password = hashPassword('Password123!', '0123456789abcdef0123456789abcdef');
  const now = '2026-07-21 08:00:00';
  const insertUser = fx.db.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,
     languages_json,countries_json,channels_json,permissions_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,0,'[]','[]','[]',?,?,?)`);
  insertUser.run('U-WU','wu@example.com','Wu','manager',password.hash,password.salt,
    JSON.stringify({ view_development:true, view_contacts:false, ...options.permissions }),now,now);
  insertUser.run('U-MGR','manager@example.com','Manager','manager',password.hash,password.salt,
    JSON.stringify({ view_all_customers:options.managerViewAll !== false, ...options.permissions }),now,now);
  insertUser.run('U-OTHER','other@example.com','Other','sales',password.hash,password.salt,'{}',now,now);

  const insertAccount = fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,created_at,updated_at)
    VALUES (?,?,?,?,'qualified','claimed',?,?)`);
  insertAccount.run('CRM-WU','EXT-WU','Wu Fixture','U-WU',now,now);
  insertAccount.run('CRM-OWN','EXT-OWN','Owned Fixture','U-MGR',now,now);
  insertAccount.run('CRM-OTHER','EXT-OTHER','Other Fixture','U-OTHER',now,now);

  const insertCustomer = fx.db.prepare(`INSERT INTO customers
    (follow_id,customer_id,company_name,email,phone,contact,status) VALUES (?,?,?,?,?,?,?)`);
  insertCustomer.run('FOLLOW-WU','EXT-WU','Wu Fixture','person@secret.test','+7-secret','Verified Buyer','未分配');
  insertCustomer.run('FOLLOW-OWN','EXT-OWN','Owned Fixture','','','','未分配');
  insertCustomer.run('FOLLOW-OTHER','EXT-OTHER','Other Fixture','','','','未分配');
  fx.db.prepare(`INSERT INTO recon_results(job_id,customer_id,company_name,email,phone,updated_at)
    VALUES ('JOB-OWN','EXT-OWN','Owned Fixture','','','2026-07-21 08:00:00'),
           ('JOB-OTHER','EXT-OTHER','Other Fixture','hidden@secret.test','+7-other','2026-07-21 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO contact_recon_jobs(job_id,customer_id,company_name,status,created_at,updated_at)
    VALUES ('CONTACT-WU','EXT-WU','Wu Fixture','done',?,?)`).run(now,now);
  fx.db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,contact_recon_job_id,full_name,title,first_found_at,created_at,updated_at)
    VALUES ('PERSON-WU','EXT-WU','CONTACT-WU','Verified Buyer','Procurement',?,?,?)`).run(now,now,now);
  fx.db.prepare(`INSERT INTO contact_methods
    (contact_id,person_id,customer_id,method_type,value,normalized_value,status)
    VALUES ('METHOD-WU','PERSON-WU','EXT-WU','email','person@secret.test','person@secret.test','verified')`).run();

  const activeEmail = options.managerViewAll === false ? 'manager@example.com' : 'wu@example.com';
  fx.cookie = await fx.login(activeEmail, 'Password123!');
  return fx;
}

async function fixtureWithPermission(permission, value) {
  return seededFixture({ permissions:{ [permission]:value } });
}

module.exports = { createPermissionFixture, seededFixture, fixtureWithPermission };
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/server_factory.test.js && npm test`

Expected: focused test PASS; existing 34 tests remain PASS; no process remains listening.

- [ ] **Step 6: Commit**

```bash
git add server.js lib/db.js lib/sales_crm.js lib/assistant.js lib/assistant_index.js test/server_factory.test.js test/helpers/permission_fixture.js
git commit -m "test: isolate CRM permission integration harness"
```

### Task 2: Central Permission Policy and Access Context

**Files:**
- Create: `lib/access_control.js`
- Create: `test/access_control.test.js`
- Modify: `lib/sales_crm.js`

**Interfaces:**
- Produces: `PERMISSION_DEFINITIONS`, `ROLE_PERMISSIONS`, `permissionsFor(user)`, `hasPermission(user,key)`, `assertPermission(user,key)`, `forbidden(message)`, `buildAccessContext(db,user)`, `assertAccountAccess(context,account)`, `assertExternalCustomerAccess(context,id)`, `redactContactFields(value)`, `LEGACY_ROUTE_POLICIES`, `LEGACY_ACTION_POLICIES`, `SALES_ROUTE_POLICIES`.
- Access context shape: `{ user, permissions, canViewAllCustomers, accountIds:Set<string>, externalCustomerIds:Set<string> }`.

- [ ] **Step 1: Write failing unit tests for manager scoping, redaction, and default deny**

```js
// test/access_control.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  buildAccessContext, assertAccountAccess, redactContactFields,
  policyForLegacyRequest,
} = require('../lib/access_control');

test('view_all_customers false scopes a manager to owned accounts', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts(id TEXT, external_customer_id TEXT, owner_id TEXT, assignment_status TEXT)');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OWN','EXT-OWN','U1','claimed');
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?)').run('OTHER','EXT-OTHER','U2','claimed');
  const context = buildAccessContext(db, { id:'U1', role:'manager', permissions_json:'{"view_all_customers":false}' });
  assert.deepEqual([...context.accountIds], ['OWN']);
  assert.doesNotThrow(() => assertAccountAccess(context, { id:'OWN' }));
  assert.throws(() => assertAccountAccess(context, { id:'OTHER' }), error => error.statusCode === 403);
});

test('contact redaction recursively removes sensitive fields', () => {
  const output = redactContactFields({ email:'x@example.com', nested:[{ phone:'1', company_name:'Safe' }], contact_methods:'tg' });
  assert.deepEqual(output, { nested:[{ company_name:'Safe' }] });
});

test('unknown browser route is denied', () => {
  assert.deepEqual(policyForLegacyRequest('GET', '/unknown', ''), { deny: true });
});
```

- [ ] **Step 2: Run and verify missing-module failure**

Run: `node --test test/access_control.test.js`

Expected: FAIL with `Cannot find module '../lib/access_control'`.

- [ ] **Step 3: Implement the central module**

```js
// lib/access_control.js
const CONTACT_KEYS = new Set([
  'email','phone','contact','contact_name','contact_title','contact_methods',
  'full_name','full_name_local','title','person_summary','contact_summary',
  'evidence','evidence_urls','method','methods',
]);

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function buildAccessContext(db, user) {
  const permissions = permissionsFor(user);
  const rows = permissions.view_all_customers
    ? db.prepare('SELECT id,external_customer_id FROM crm_accounts').all()
    : db.prepare("SELECT id,external_customer_id FROM crm_accounts WHERE owner_id=? AND COALESCE(assignment_status,'')!='returned'").all(user.id);
  return {
    user, permissions,
    canViewAllCustomers: Boolean(permissions.view_all_customers),
    accountIds: new Set(rows.map(row => row.id)),
    externalCustomerIds: new Set(rows.map(row => row.external_customer_id).filter(Boolean)),
  };
}

function assertAccountAccess(context, account) {
  if (!account || !context.accountIds.has(account.id)) throw forbidden('无权访问该客户');
}

function redactContactFields(value) {
  if (Array.isArray(value)) return value.map(redactContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !CONTACT_KEYS.has(key.toLowerCase()))
    .map(([key, child]) => [key, redactContactFields(child)]));
}
```

Move `PERMISSION_DEFINITIONS`, `ROLE_PERMISSIONS`, normalization and permission helpers out of `lib/sales_crm.js`; re-export them there for compatibility. Define exact route/action maps from the approved design and implement lookup as exact method/path matching before parameter-pattern matching. Worker endpoints `/recon` and `/contact-recon` return `{ workerToken: true }`; unknown browser endpoints return `{ deny: true }`.

Export the existing `safeUser(row)` from `lib/sales_crm.js`; `server.js` imports it for the capability response so password hashes, salts and session data can never be serialized.

- [ ] **Step 4: Run tests**

Run: `node --test test/access_control.test.js test/sales_crm.test.js`

Expected: all access-control and existing Sales CRM unit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/access_control.js lib/sales_crm.js test/access_control.test.js
git commit -m "feat: centralize CRM access policies"
```

### Task 3: Fresh Sessions and Capability Endpoint

**Files:**
- Modify: `lib/sales_crm.js`
- Modify: `server.js`
- Modify: `test/helpers/permission_fixture.js`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Produces: `GET /api/session/capabilities` and `req.accessContext` for authenticated requests.
- Capability response: `{ ok, user, permissions, canViewAllCustomers, modules }` with no business IDs.

- [ ] **Step 1: Seed two users and write failing capability/session-refresh tests**

```js
test('capabilities contain permissions but no business data', async t => {
  const fx = await seededFixture(); t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/session/capabilities', { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.permissions.view_contacts, false);
  assert.equal(body.modules.includes('contacts'), false);
  assert.equal(JSON.stringify(body).includes('EXT-OWN'), false);
});

test('permission changes affect the existing session on the next request', async t => {
  const fx = await seededFixture(); t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  fx.db.prepare('UPDATE sales_users SET permissions_json=? WHERE email=?')
    .run('{"view_development":false}', 'wu@example.com');
  const response = await fx.request('/development-workbench', { cookie });
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: Run and verify failures**

Run: `node --test --test-name-pattern='capabilities|existing session' test/permission_integration.test.js`

Expected: capabilities returns 404 and cached session user allows the workbench.

- [ ] **Step 3: Refresh users in middleware and build access context**

Change `requireUnifiedUser` so the session lookup joins only session identity, then always fetches the current active `sales_users` row. Reject missing/inactive users with 401 and delete expired sessions. After loading the user:

```js
req.salesUser = user;
req.accessContext = buildAccessContext(value, user);
next();
```

Register:

```js
app.get('/api/session/capabilities', requireUnifiedUser, (req, res) => {
  const p = req.accessContext.permissions;
  const modules = [
    ['intake','view_intake'], ['customers','view_customers'], ['pool','view_pool'],
    ['contacts','view_contacts'], ['recon','view_recon'],
    ['prospect','use_prospect_agent'], ['assistant','use_ai_assistant'],
  ].filter(([, permission]) => p[permission]).map(([key]) => key);
  res.json({ ok:true, user:safeUser(req.salesUser), permissions:p,
    canViewAllCustomers:req.accessContext.canViewAllCustomers, modules });
});
```

- [ ] **Step 4: Run tests**

Run: `node --test --test-name-pattern='capabilities|existing session' test/permission_integration.test.js`

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sales_crm.js server.js test/helpers/permission_fixture.js test/permission_integration.test.js
git commit -m "fix: refresh session permissions per request"
```

### Task 4: Legacy Route Matrix and Initial Payload Redaction

**Files:**
- Modify: `server.js`
- Modify: `lib/db.js`
- Modify: `Index.html`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Consumes: `req.accessContext`, central legacy policies, `redactContactFields`.
- Produces: `getInitialData(accessContext)` and capability-driven workbench state.

- [ ] **Step 1: Write the failing Wu Wei and single-permission tests**

```js
test('Wu Wei cannot receive contact data through initial or direct contact routes', async t => {
  const fx = await seededFixture(); t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  const initial = await fx.request('/api/initial', { cookie });
  assert.equal(initial.status, 200);
  const text = await initial.text();
  for (const secret of ['person@secret.test','+7-secret','Verified Buyer']) assert.equal(text.includes(secret), false);
  assert.equal((await fx.request('/api/customers/EXT-OWN/people', { cookie })).status, 403);
  assert.equal((await fx.request('/api/contact-recon/state', { cookie })).status, 403);
});

for (const [permission, route] of [
  ['view_pool','/api/customers'],
  ['view_recon','/api/recon/results/JOB-OWN'],
  ['view_intake','/api/delivery/latest'],
]) test(`${permission}=false denies ${route}`, async t => {
  const fx = await fixtureWithPermission(permission, false); t.after(() => fx.close());
  assert.equal((await fx.request(route, { cookie:fx.cookie })).status, 403);
});
```

- [ ] **Step 2: Run and verify leaked data and incorrectly allowed routes**

Run: `node --test --test-name-pattern='Wu Wei|denies' test/permission_integration.test.js`

Expected: at least the Wu Wei direct routes and one single-permission case FAIL.

- [ ] **Step 3: Replace the broad `/api` allow switch with explicit policy middleware**

```js
app.use('/api', (req, res, next) => {
  if (isAuthRoute(req) || isWorkerRoute(req)) return next();
  return requireUnifiedUser(req, res, () => {
    const policy = policyForLegacyRequest(req.method, req.path, String(req.body?.action || ''));
    if (policy.deny) return res.status(403).json({ ok:false, error:'该接口未配置访问权限' });
    const missing = (policy.permissions || []).find(key => !req.accessContext.permissions[key]);
    if (missing) return res.status(403).json({ ok:false, error:`没有权限：${missing}` });
    req.accessPolicy = policy;
    next();
  });
});
```

Ensure `/api/app` and `/api/prospect-agent` select policy by action; unknown action returns 403 before calling business code.

- [ ] **Step 4: Scope and redact `getInitialData`**

Change signature to `getInitialData(accessContext)`. Filter customer IDs at SQL/query boundaries using `accessContext.externalCustomerIds`; return empty collections for missing module permissions. Apply final defense:

```js
const payload = { customers, customerPool, people, reconJobs, reconResults, contactReconJobs, prospectTasks, templates, stats };
if (!permissions.view_contacts) {
  payload.people = [];
  payload.contactReconJobs = [];
  return redactContactFields(payload);
}
return payload;
```

Do not use truthiness fallbacks from `view_development` to pool/contact/recon/intake permissions.

- [ ] **Step 5: Make workbench initialization capability-driven**

In `Index.html`, fetch capabilities before initial data and construct navigation from:

```js
const MODULE_PERMISSION = {
  delivery:'view_intake', customers:'view_customers', pool:'view_pool',
  contacts:'view_contacts', recon:'view_recon',
  prospect:'use_prospect_agent', assistant:'use_ai_assistant',
};
const allowedModules = Object.entries(MODULE_PERMISSION)
  .filter(([, permission]) => capabilities.permissions[permission])
  .map(([key]) => key);
```

On any module request 403, delete its state key, remove its navigation node, and select the first allowed module. Server HTML must not embed a serialized payload.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test --test-name-pattern='Wu Wei|denies' test/permission_integration.test.js && npm test`

Expected: focused cases and the complete suite PASS.

- [ ] **Step 7: Commit**

```bash
git add server.js lib/db.js Index.html test/permission_integration.test.js
git commit -m "fix: enforce legacy module permissions"
```

### Task 5: Row-Level Scope for Legacy Reads and Writes

**Files:**
- Modify: `server.js`
- Modify: `lib/db.js`
- Modify: `lib/access_control.js`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Produces: target resolvers `accountForExternalCustomer`, `externalCustomerForReconJob`, `externalCustomerForContactJob` and 403-before-read/write behavior.

- [ ] **Step 1: Write failing cross-owner tests**

```js
test('scoped manager cannot read or mutate another owner by any identifier', async t => {
  const fx = await seededFixture({ managerViewAll:false }); t.after(() => fx.close());
  const cookie = await fx.login('manager@example.com', 'Password123!');
  const checks = [
    ['/api/customers/EXT-OTHER/people'],
    ['/api/recon/results/JOB-OTHER'],
    ['/api/report?job_id=JOB-OTHER'],
  ];
  for (const [route] of checks) assert.equal((await fx.request(route, { cookie })).status, 403);
  const before = fx.db.prepare('SELECT status FROM customers WHERE customer_id=?').get('EXT-OTHER').status;
  const write = await fx.request('/api/app', { cookie, method:'POST', body:{ action:'updateCustomer', followId:'FOLLOW-OTHER', patch:{ status:'已报价' } } });
  assert.equal(write.status, 403);
  assert.equal(fx.db.prepare('SELECT status FROM customers WHERE customer_id=?').get('EXT-OTHER').status, before);
});
```

- [ ] **Step 2: Run and verify ID-based bypasses fail the test**

Run: `node --test --test-name-pattern='another owner' test/permission_integration.test.js`

Expected: at least one GET or POST returns 200 instead of 403.

- [ ] **Step 3: Add target resolution before every legacy operation**

For customer routes, resolve `customers.customer_id` or `customers.follow_id` to an external customer ID, then call `assertExternalCustomerAccess`. For Recon/report routes, resolve `recon_results.customer_id`; for contact jobs resolve `contact_recon_jobs.customer_id`. Perform the assertion before reading files, logs, people rows, or invoking any mutator.

Pass `accessContext` to:

```js
getCustomerPeople(customerId, accessContext)
getContactReconState({ accessContext })
updateCustomer(followId, patch, accessContext)
createReconJob(input, accessContext)
retryReconJob(jobId, accessContext)
createContactReconJob(input, accessContext)
```

For `/api/recon-monitor`, return only jobs whose customer ID is in `externalCustomerIds`; when `canViewAllCustomers` is false set shared worker log text to an empty string.

- [ ] **Step 4: Add anonymous denied-write audit records**

```js
function auditDeniedWrite(db, context, route, action, targetType) {
  db.prepare(`INSERT INTO crm_audit_log(id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,datetime('now'))`).run(
      crypto.randomUUID(), context.user.id, 'permission_denied', targetType, '',
      JSON.stringify({ route, action }),
    );
}
```

Call it only after authentication for high-risk POST/PATCH denials. Never include submitted payload or a real target ID.

- [ ] **Step 5: Run tests**

Run: `node --test --test-name-pattern='another owner|denied write' test/permission_integration.test.js && npm test`

Expected: all tests PASS; mutation assertion confirms database unchanged.

- [ ] **Step 6: Commit**

```bash
git add server.js lib/db.js lib/access_control.js test/permission_integration.test.js
git commit -m "fix: enforce legacy customer row scope"
```

### Task 6: Sales CRM Read, Write, and Intake Enforcement

**Files:**
- Modify: `lib/sales_crm.js`
- Modify: `sales-assets/app.js`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Consumes: centralized permissions and `buildAccessContext`.
- Produces: collection-specific `loadPayload(user, accessContext)` and exact permissions for every `/api/sales-crm/*` handler.

- [ ] **Step 1: Write failing bootstrap, write, and intake tests**

```js
test('bootstrap does not use view_development as a data permission', async t => {
  const fx = await seededFixture({ permissions:{ view_development:true, view_contacts:false, view_recon:false, view_intake:false } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/bootstrap', { cookie:fx.cookie });
  const body = await response.json();
  assert.deepEqual(body.people, []);
  assert.deepEqual(body.reconResults, []);
  assert.deepEqual(body.intake.items, []);
  assert.equal(JSON.stringify(body).includes('person@secret.test'), false);
});

test('manager without view_all_customers cannot patch another owner', async t => {
  const fx = await seededFixture({ managerViewAll:false }); t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER', {
    cookie:fx.cookie, method:'PATCH', body:{ priority:'A' },
  });
  assert.equal(response.status, 403);
});

test('intake actions have no non-sales role shortcut', async t => {
  const fx = await seededFixture({ permissions:{ view_intake:true, manage_intake:false } }); t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/intake/action', {
    cookie:fx.cookie, method:'POST', body:{ action:'assign', itemId:'INTAKE-OTHER', ownerId:'U1' },
  });
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: Run and verify failures**

Run: `node --test --test-name-pattern='bootstrap|cannot patch|role shortcut' test/permission_integration.test.js`

Expected: bootstrap leaks at least one collection or a scoped write/intake action is allowed.

- [ ] **Step 3: Replace role-based account scope with permission-based scope**

```js
function accountScope(user, alias = 'a') {
  return hasPermission(user, 'view_all_customers')
    ? { sql:'', params:[] }
    : { sql:`WHERE ${alias}.owner_id=? AND COALESCE(${alias}.assignment_status,'')!='returned'`, params:[user.id] };
}

function canAccess(user, account) {
  return hasPermission(user, 'view_all_customers')
    || (account.assignment_status !== 'returned' && account.owner_id === user.id);
}
```

Remove every `user.role === 'sales'` access shortcut from account lookup and writes. Roles may still choose UI defaults, but authorization must use permissions plus ownership.

- [ ] **Step 4: Apply collection-specific bootstrap and route permissions**

Set `accounts/activities/rfqs/quotes/orders` only with `view_customers`; summary/funnel with `view_dashboard`; alerts with `view_alerts`; markets/team/insights/intake/users with their exact view permission. Research kinds require exact `view_pool`, `view_contacts`, or `view_recon` with no `view_development` alternative.

Keep the naming distinction explicit: Legacy `GET /api/customers` reads `customer_pool` and requires `view_pool`; Sales CRM account collections require `view_customers`.

Before handlers, assert the approved matrix: `create_customer`, `edit_customer`, `record_activity`, `record_quote`, `record_order`, `view_contacts+edit_customer`, `manage_evaluations`, and `view_users+manage_users`. Preserve 403 status codes rather than converting them to 400 in catch blocks.

- [ ] **Step 5: Enforce intake ownership and management permission**

```js
const selfActions = new Set(['claim','return','reject']);
assertPermission(user, 'view_intake');
if (selfActions.has(action)) {
  if (item.assigned_owner_id !== user.id) throw forbidden('无权处理该入库任务');
} else {
  assertPermission(user, 'manage_intake');
}
```

Require both `view_intake` and `manage_intake` for scan/settings/assign/reassign/bulk actions.

- [ ] **Step 6: Clear forbidden Sales UI state on 403**

In `sales-assets/app.js`, map each response collection to its permission and replace unavailable collections with their empty shape. On 403, clear the related store slice before rendering the permission-change notice.

- [ ] **Step 7: Run tests**

Run: `node --test --test-name-pattern='bootstrap|cannot patch|role shortcut' test/permission_integration.test.js && npm test`

Expected: focused and full suites PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js test/permission_integration.test.js
git commit -m "fix: enforce Sales CRM permission boundaries"
```

### Task 7: AI Assistant and Search Scope

**Files:**
- Modify: `lib/assistant.js`
- Modify: `lib/assistant_index.js`
- Modify: `server.js`
- Create: `test/assistant_scope.test.js`

**Interfaces:**
- Produces: `answerAssistantQuestion(payload, accessContext)`; every deterministic, SQL, vector, report, source, and matched-customer result accepts allowed external IDs.

- [ ] **Step 1: Write failing owned/other and contact-redaction tests**

```js
test('assistant rejects an explicitly requested customer outside scope', async t => {
  const fx = await seededFixture({ permissions:{ use_ai_assistant:true, view_all_customers:false } });
  t.after(() => fx.close());
  const response = await fx.request('/api/assistant/chat', {
    cookie:fx.cookie, method:'POST',
    body:{ message:'查询 EXT-OTHER', context:{ customerId:'EXT-OTHER' } },
  });
  assert.equal(response.status, 403);
});

test('assistant never returns contacts without view_contacts', async t => {
  const fx = await seededFixture({ permissions:{ use_ai_assistant:true, view_contacts:false } });
  t.after(() => fx.close());
  const response = await fx.request('/api/assistant/chat', {
    cookie:fx.cookie, method:'POST', body:{ message:'我的客户联系人是谁' },
  });
  const text = await response.text();
  assert.equal(text.includes('person@secret.test'), false);
  assert.equal(text.includes('+7-secret'), false);
});
```

- [ ] **Step 2: Run and verify scope is absent**

Run: `node --test test/assistant_scope.test.js`

Expected: explicit other-customer query is not 403 or a contact secret appears.

- [ ] **Step 3: Thread access context through every assistant branch**

Change the only public signature:

```js
async function answerAssistantQuestion(payload, accessContext) {
  assertPermission(accessContext.user, 'use_ai_assistant');
  assertRequestedTargets(accessContext, payload.context || {});
  const allowedIds = [...accessContext.externalCustomerIds];
  // pass allowedIds and permission flags into deterministic, SQL and vector branches
}
```

For SQL queries, add `customer_id IN (...)` or join through allowed `crm_accounts.external_customer_id`; when allowed IDs are empty, return an empty result without executing a full-table query. In `assistant_index`, filter candidates before scoring and pagination. Before returning, apply `redactContactFields` unless `view_contacts`; omit Recon result/report/source excerpts unless `view_recon`.

Update `server.js` to call `answerAssistantQuestion(input, req.accessContext)` and preserve thrown 403 status.

- [ ] **Step 4: Sanitize assistant logging**

Replace logged context and results with counts and anonymous identifiers:

```js
const audit = {
  messageLength: String(body.message || '').length,
  historyCount: Array.isArray(body.history) ? body.history.length : 0,
  resultSetCount: Array.isArray(result.resultSets) ? result.resultSets.length : 0,
  sourceCount: Array.isArray(result.sources) ? result.sources.length : 0,
};
```

Do not log session IDs, full prompts, matched customer names, contact fields, report excerpts, or source bodies.

- [ ] **Step 5: Run tests**

Run: `node --test test/assistant_scope.test.js && npm test`

Expected: assistant scope tests and full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/assistant.js lib/assistant_index.js server.js test/assistant_scope.test.js
git commit -m "fix: scope AI assistant retrieval"
```

### Task 8: Complete Policy Coverage and Browser-State Regression

**Files:**
- Modify: `lib/access_control.js`
- Modify: `Index.html`
- Modify: `test/access_control.test.js`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Produces: policy enumeration test covering every browser API declared in `server.js` and `lib/sales_crm.js`.

- [ ] **Step 1: Write failing policy coverage and HTML-state tests**

```js
test('all browser APIs have an explicit policy', () => {
  const expected = [
    'GET /initial','GET /customers','GET /customers/:customerId/people',
    'GET /contact-recon/state','GET /recon/results/:jobId','GET /report',
    'GET /recon-monitor','GET /quality/issues','GET /delivery/latest','GET /delivery/file',
    'POST /app','POST /prospect-agent','POST /assistant/chat',
  ];
  for (const key of expected) assert.equal(Boolean(LEGACY_ROUTE_POLICIES[key]), true, key);
});

test('workbench HTML embeds no business records', async t => {
  const fx = await seededFixture(); t.after(() => fx.close());
  const html = await (await fx.request('/development-workbench', { cookie:fx.cookie })).text();
  for (const secret of ['EXT-OWN','person@secret.test','+7-secret']) assert.equal(html.includes(secret), false);
});
```

Add one integration assertion per policy for missing-permission 403 and one unknown action assertion for `/api/app` and `/api/prospect-agent`.

Use this table to drive the Legacy deny checks; for each row create a fixture with every listed permission set to false and assert status 403 before checking any business result:

```js
const legacyDenyCases = [
  ['view_development','GET','/api/initial'],
  ['view_pool','GET','/api/customers'],
  ['view_contacts','GET','/api/customers/EXT-WU/people'],
  ['view_contacts','GET','/api/contact-recon/state'],
  ['view_recon','GET','/api/recon/results/JOB-OWN'],
  ['view_recon','GET','/api/report?job_id=JOB-OWN'],
  ['view_recon','GET','/api/recon-monitor'],
  ['view_all_customers','GET','/api/quality/issues'],
  ['view_intake','GET','/api/delivery/latest'],
  ['use_ai_assistant','POST','/api/assistant/chat',{ message:'summary' }],
  ['use_prospect_agent','POST','/api/prospect-agent',{ action:'createTask' }],
  ['edit_customer','POST','/api/app',{ action:'updateCustomer', followId:'FOLLOW-WU', patch:{ status:'未分配' } }],
  ['run_recon','POST','/api/app',{ action:'createReconJob', customerId:'EXT-WU' }],
];

for (const [permission, method, route, body] of legacyDenyCases) {
  const fx = await seededFixture({ permissions:{ [permission]:false } });
  try {
    const response = await fx.request(route, { cookie:fx.cookie, method, body });
    assert.equal(response.status, 403, `${permission} ${method} ${route}`);
  } finally { await fx.close(); }
}

const unknownFx = await seededFixture();
try {
  const unknownApp = await unknownFx.request('/api/app', {
    cookie:unknownFx.cookie, method:'POST', body:{ action:'unmappedAction' },
  });
  const unknownProspect = await unknownFx.request('/api/prospect-agent', {
    cookie:unknownFx.cookie, method:'POST', body:{ action:'unmappedAction' },
  });
  assert.equal(unknownApp.status, 403);
  assert.equal(unknownProspect.status, 403);
} finally { await unknownFx.close(); }
```

Add corresponding allow checks with the required permission true. For resource-dependent requests, assert only `status !== 403`; a sanitized fixture may validly produce 400 or 404 after authorization, while seeded existing resources must return 200.

- [ ] **Step 2: Run and verify uncovered entries fail**

Run: `node --test test/access_control.test.js test/permission_integration.test.js`

Expected: coverage test identifies any missing policy or unknown action that is not denied.

- [ ] **Step 3: Complete maps and clear browser state**

Add only missing explicit entries to the maps. In `Index.html`, centralize forbidden-state disposal:

```js
function revokeModule(key) {
  delete state[key];
  document.querySelectorAll(`[data-module="${key}"]`).forEach(node => node.remove());
  if (activeModule === key) activateModule(allowedModules[0] || 'none');
}
```

Call it on capabilities refresh and every 403 response. Confirm no business data is serialized into HTML.

- [ ] **Step 4: Run full suite and static leak scan**

Run: `npm test && rg -n "view_development\s*\|\||view_development.*view_contacts|role\s*===\s*['\"]sales['\"]" server.js lib/sales_crm.js lib/assistant.js`

Expected: all tests PASS; search returns no authorization fallback from `view_development` and no role-based data-scope shortcut. Role checks used only for non-security UI/default behavior must be inspected and documented in the commit message.

- [ ] **Step 5: Commit**

```bash
git add lib/access_control.js Index.html test/access_control.test.js test/permission_integration.test.js
git commit -m "test: cover complete permission policy matrix"
```

### Task 9: Documentation, Production-Copy Evidence, and Final Verification

**Files:**
- Modify: `README.md`
- Create: `docs/permission-matrix.md`
- Create: `docs/evidence/issue-4-verification.md`
- Test: all test files

**Interfaces:**
- Produces: reviewable route/action/data/test matrix and anonymous verification evidence for the PR.

- [ ] **Step 1: Document the complete matrix**

Create `docs/permission-matrix.md` with columns:

```markdown
| Permission | Page/module | HTTP route/action | Data scope | Test name |
|---|---|---|---|---|
| `view_contacts` | 负责人线索 | `GET /api/customers/:customerId/people` | allowed external customer IDs | Wu Wei cannot receive contact data |
```

List every permission and every policy entry, including worker-token and share-token exemptions. Add README commands for isolated tests, database-copy verification, service restart, health check, and rollback.

- [ ] **Step 2: Run clean verification**

Run:

```bash
npm test
npm audit --omit=dev
git diff --check origin/main...HEAD
git status --short
```

Expected: all tests PASS; audit has no high/critical finding; diff check emits no output; status contains only the documentation files intended for this task.

- [ ] **Step 3: Verify against a consistent production database copy**

With the operator-provided copied database path, never the live database, let the fixture make a second disposable copy before it writes sanitized test rows:

```bash
CRM_FIXTURE_BASE_DB=/absolute/path/to/crm-production-copy.db NODE_ENV=test node --test test/permission_integration.test.js
```

Expected: all permission tests PASS. Record only test names, status codes, counts, field names, anonymous fixture IDs, timestamp, commit SHA, and database copy checksum in `docs/evidence/issue-4-verification.md`. Do not record names, passwords, emails, phones, prompts, or report bodies.

- [ ] **Step 4: Capture browser evidence locally**

Start the isolated app against a sanitized copy, log in as the Wu Wei permission combination, and capture:

- workbench without the contacts tab;
- people and contact-state requests returning 403;
- `/api/initial` field-name audit showing no forbidden fields;
- administrator allowed-path smoke test.

Store screenshots outside Git if they contain business data; put only redacted status/field evidence in the Markdown file.

- [ ] **Step 5: Commit documentation and evidence**

```bash
git add README.md docs/permission-matrix.md docs/evidence/issue-4-verification.md
git commit -m "docs: record permission isolation verification"
```

- [ ] **Step 6: Perform final review before push**

Run:

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git status --short
```

Expected: task commits are present in order, changed files are limited to Issue #4, and worktree is clean. Then use `superpowers:requesting-code-review`, fix any findings with new failing tests, rerun `superpowers:verification-before-completion`, and use `superpowers:finishing-a-development-branch` before pushing `codex/issue-4-permission-isolation` and opening a PR linked to Issue #4.

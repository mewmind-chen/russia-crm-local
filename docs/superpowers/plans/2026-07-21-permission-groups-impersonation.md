# Permission Groups and Identity Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Issue #3 with reusable permission groups, per-user allow/deny overrides, safe multi-admin account management, permanent admin password resets, and audited manager/sales identity inspection.

**Architecture:** Add a focused permission-group module that owns schema migration, effective-permission hydration, mutations, and the last-admin invariant. Add a focused impersonation module that owns session context lifecycle; existing access-control policies consume the resulting real/effective identities, while Sales CRM routes and the legacy workbench continue to enforce server-side permissions and customer scope.

**Tech Stack:** Node.js 18+, Express 4, better-sqlite3 11, SQLite, browser-native HTML/CSS/JavaScript, Node built-in test runner.

## Global Constraints

- Keep `admin / manager / sales` as identity-level roles.
- Every user belongs to exactly one group whose `role_key` matches the user role.
- Effective permissions are group defaults followed by per-user `allow` or `deny`; missing and unknown permissions deny access.
- Preserve `sales_users.permissions_json` for rollback, but never read or write it at runtime after migration.
- A valid administrator is active, has role `admin`, and has effective `view_users=true` and `manage_users=true`.
- No mutation may leave zero valid administrators.
- New users and administrator password resets set permanent passwords with `must_change_password=0`.
- Identity inspection lasts 30 minutes, targets only active manager/sales users, and never replaces the real session user.
- Identity inspection uses the target user's current permissions and customer scope for every request.
- Identity inspection blocks Recon, contact Recon, user/role/group management, all password changes, and nested inspection.
- Expired or invalid identity inspection returns `409` with code `IMPERSONATION_ENDED`; the original request must not execute as administrator.
- First version has no permission-group delete or deactivate endpoint.
- Do not add Redis, an external identity provider, a new test framework, or a new production dependency.

---

### Task 1: Permission Group Schema and Legacy Migration

**Files:**
- Create: `lib/permission_groups.js`
- Create: `test/permission_groups.test.js`
- Modify: `lib/sales_crm.js:122-422`

**Interfaces:**
- Produces: `installPermissionGroups(db) -> void`
- Produces: `hydrateUserPermissions(db, userRow) -> userRowWithPermissions`
- Produces: `hydrateUsersPermissions(db, rows) -> userRowWithPermissions[]`
- Produces: `effectivePermissionsFor(db, userId) -> Record<string, boolean>`
- Produces: `normalizeOverrideMap(value) -> Record<string, 'inherit'|'allow'|'deny'>`

- [ ] **Step 1: Write migration tests against a legacy user table**

```js
// test/permission_groups.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const {
  installPermissionGroups,
  effectivePermissionsFor,
  hydrateUserPermissions,
} = require('../lib/permission_groups');

function legacyDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sales_users (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    permissions_json TEXT NOT NULL DEFAULT '{}'
  )`);
  return db;
}

test('legacy migration preserves every effective permission and is idempotent', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)')
    .run('U1', 'manager', JSON.stringify({ view_contacts: false, create_customer: false }));
  const before = { ...ROLE_PERMISSIONS.manager, view_contacts: false, create_customer: false };
  installPermissionGroups(db);
  assert.deepEqual(effectivePermissionsFor(db, 'U1'), before);
  installPermissionGroups(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM permission_groups WHERE system_key='manager-default'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get('U1').n, 2);
  db.close();
});

test('hydrated permissions ignore later legacy permissions_json changes', () => {
  const db = legacyDb();
  db.prepare('INSERT INTO sales_users VALUES (?,?,1,?)').run('U1', 'sales', '{}');
  installPermissionGroups(db);
  db.prepare('UPDATE sales_users SET permissions_json=? WHERE id=?')
    .run('{"view_all_customers":true}', 'U1');
  const user = hydrateUserPermissions(db, db.prepare('SELECT * FROM sales_users WHERE id=?').get('U1'));
  assert.equal(user.permissions.view_all_customers, false);
  db.close();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `/opt/homebrew/bin/node --test test/permission_groups.test.js`

Expected: FAIL with `Cannot find module '../lib/permission_groups'`.

- [ ] **Step 3: Implement the schema, transaction, defaults, and exact legacy conversion**

```js
// lib/permission_groups.js
const { PERMISSION_DEFINITIONS, ROLE_PERMISSIONS, normalizePermissions } = require('./access_control');

const EFFECTS = new Set(['allow', 'deny']);

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch (_error) { return fallback; }
}

function groupPermissions(row) {
  const parsed = normalizePermissions(parseJson(row?.permissions_json, {}));
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, Boolean(parsed[key])]));
}

function installPermissionGroups(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      role_key TEXT NOT NULL CHECK(role_key IN ('admin','manager','sales')),
      permissions_json TEXT NOT NULL, system_key TEXT UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id TEXT NOT NULL, permission_key TEXT NOT NULL,
      effect TEXT NOT NULL CHECK(effect IN ('allow','deny')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, permission_key),
      FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(sales_users)').all().map(row => row.name));
  if (!columns.has('permission_group_id')) db.exec("ALTER TABLE sales_users ADD COLUMN permission_group_id TEXT NOT NULL DEFAULT ''");
  const migrate = db.transaction(() => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    for (const role of ['admin', 'manager', 'sales']) {
      const groupId = `PGRP-${role.toUpperCase()}-DEFAULT`;
      db.prepare(`INSERT OR IGNORE INTO permission_groups
        (id,name,description,role_key,permissions_json,system_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        groupId, `${role} default`, 'System role migration baseline', role,
        JSON.stringify(ROLE_PERMISSIONS[role]), `${role}-default`, now, now,
      );
      db.prepare("UPDATE sales_users SET permission_group_id=? WHERE role=? AND permission_group_id='' ")
        .run(groupId, role);
    }
    for (const user of db.prepare('SELECT * FROM sales_users').all()) {
      if (db.prepare('SELECT COUNT(*) n FROM user_permission_overrides WHERE user_id=?').get(user.id).n) continue;
      const legacy = normalizePermissions(parseJson(user.permissions_json, {}));
      for (const [key, value] of Object.entries(legacy)) {
        if (Boolean(value) === Boolean(ROLE_PERMISSIONS[user.role][key])) continue;
        db.prepare(`INSERT INTO user_permission_overrides
          (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,?,?,?)`)
          .run(user.id, key, value ? 'allow' : 'deny', now, now);
      }
    }
  });
  migrate();
}

function effectivePermissionsFor(db, userId) {
  const user = db.prepare(`SELECT u.*,g.permissions_json group_permissions_json,g.role_key group_role
    FROM sales_users u LEFT JOIN permission_groups g ON g.id=u.permission_group_id WHERE u.id=?`).get(userId);
  if (!user || user.group_role !== user.role) return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, false]));
  const permissions = groupPermissions({ permissions_json: user.group_permissions_json });
  for (const row of db.prepare('SELECT permission_key,effect FROM user_permission_overrides WHERE user_id=?').all(userId)) {
    if (PERMISSION_DEFINITIONS[row.permission_key] && EFFECTS.has(row.effect)) permissions[row.permission_key] = row.effect === 'allow';
  }
  return permissions;
}

function hydrateUserPermissions(db, row) {
  return row ? { ...row, permissions: effectivePermissionsFor(db, row.id) } : null;
}

function hydrateUsersPermissions(db, rows) {
  return rows.map(row => hydrateUserPermissions(db, row));
}

function normalizeOverrideMap(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const [key, effect] of Object.entries(source)) {
    if (!PERMISSION_DEFINITIONS[key]) {
      const error = new Error(`未知权限：${key}`); error.statusCode = 400; throw error;
    }
    if (!['inherit', 'allow', 'deny'].includes(effect)) {
      const error = new Error(`无效权限状态：${key}`); error.statusCode = 400; throw error;
    }
    result[key] = effect;
  }
  return result;
}

module.exports = {
  installPermissionGroups,
  effectivePermissionsFor,
  hydrateUserPermissions,
  hydrateUsersPermissions,
  normalizeOverrideMap,
};
```

Add a migration self-check inside `installPermissionGroups`: capture each user's legacy effective object before writes, compare it to `effectivePermissionsFor` after writes, and throw before transaction commit on any unequal permission key.

- [ ] **Step 4: Wire migration after `permissions_json` exists and before seeded users are consumed**

```js
// lib/sales_crm.js
const { installPermissionGroups } = require('./permission_groups');

// inside installSalesCrm(), after ensureUserPermissionColumns(value)
installPermissionGroups(value);
seedUsers(value);
installPermissionGroups(value); // assigns a group to first-run seeded users
```

- [ ] **Step 5: Run migration tests and the baseline suite**

Run: `/opt/homebrew/bin/node --test test/permission_groups.test.js`

Expected: PASS, 2 tests.

Run: `/opt/homebrew/bin/node --test`

Expected: all existing tests PASS before runtime permission reads are switched.

- [ ] **Step 6: Commit the schema and migration**

```bash
git add lib/permission_groups.js lib/sales_crm.js test/permission_groups.test.js
git commit -m "feat: migrate users to permission groups"
```

### Task 2: Effective Permission Runtime and Test Fixtures

**Files:**
- Modify: `lib/access_control.js:142-188`
- Modify: `lib/sales_crm.js:105-120, 515-560, 1398-1487`
- Modify: `server.js:60-102`
- Modify: `test/helpers/permission_fixture.js:6-133`
- Modify: `test/access_control.test.js`
- Modify: `test/sales_crm.test.js`
- Modify: `test/permission_integration.test.js`

**Interfaces:**
- Consumes: `hydrateUserPermissions(db, row)` and `hydrateUsersPermissions(db, rows)` from Task 1.
- Produces: `permissionsFor(user) -> user.permissions normalized to all known keys`
- Produces: fixture method `setUserPermissions(userId, desiredPatch) -> void`

- [ ] **Step 1: Change unit tests to require hydrated permissions and deny legacy-only input**

```js
// test/access_control.test.js
test('permissionsFor trusts only hydrated group permissions', () => {
  const { permissionsFor } = accessControl();
  assert.equal(permissionsFor({ role: 'admin', permissions_json: '{"view_users":true}' }).view_users, false);
  assert.equal(permissionsFor({ permissions: { view_users: true } }).view_users, true);
});
```

Update existing access-control fixtures to pass `permissions: { ...ROLE_PERMISSIONS.manager, view_all_customers: false }` instead of `permissions_json`.

- [ ] **Step 2: Run the unit test and verify the legacy input still grants permissions**

Run: `/opt/homebrew/bin/node --test test/access_control.test.js`

Expected: FAIL because `permissionsFor` still reads `permissions_json` and role defaults.

- [ ] **Step 3: Make hydrated permissions the only runtime source**

```js
// lib/access_control.js
function permissionsFor(user) {
  const source = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  return Object.fromEntries(Object.keys(PERMISSION_DEFINITIONS).map(key => [key, Boolean(source[key])]));
}
```

Keep `ROLE_PERMISSIONS` only as default-group seed data. `hasPermission`, `assertPermission`, and `buildAccessContext` continue to call `permissionsFor`.

- [ ] **Step 4: Hydrate real users at every database boundary**

```js
// lib/sales_crm.js
const { hydrateUserPermissions, hydrateUsersPermissions } = require('./permission_groups');

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie || '').sales_session || '';
  if (!token) return null;
  const value = db();
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = value.prepare(`SELECT u.* FROM sales_sessions s JOIN sales_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash, nowText());
    return hydrateUserPermissions(value, row);
  } finally { value.close(); }
}
```

In `loadPayload`, replace raw `allUsers` with `hydrateUsersPermissions(value, value.prepare(...).all())`. Ensure `safeUser`, login response, `requireSalesUser`, `requireUnifiedUser`, `accountScope`, and `server.js` capabilities receive hydrated users.

- [ ] **Step 5: Add fixture helpers and replace direct legacy JSON mutations**

```js
// test/helpers/permission_fixture.js, returned fixture object
setUserPermissions(userId, patch) {
  const group = db.prepare(`SELECT g.permissions_json FROM sales_users u
    JOIN permission_groups g ON g.id=u.permission_group_id WHERE u.id=?`).get(userId);
  const defaults = JSON.parse(group.permissions_json);
  const now = '2026-07-21 08:00:00';
  for (const [permission, desired] of Object.entries(patch)) {
    db.prepare('DELETE FROM user_permission_overrides WHERE user_id=? AND permission_key=?').run(userId, permission);
    if (Boolean(defaults[permission]) === Boolean(desired)) continue;
    db.prepare(`INSERT INTO user_permission_overrides
      (user_id,permission_key,effect,created_at,updated_at) VALUES (?,?,?,?,?)`)
      .run(userId, permission, desired ? 'allow' : 'deny', now, now);
  }
},
```

Update `seededFixture` inserts to include `permission_group_id`, and replace every test-side `UPDATE sales_users SET permissions_json` with `fx.setUserPermissions`. Re-run `installSalesCrm()` after fixture users are inserted only when a test intentionally exercises migration.

- [ ] **Step 6: Prove current sessions react to group and override changes**

```js
// test/permission_integration.test.js
test('group and personal permission changes affect an existing session immediately', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const cookie = await fx.login('wu@example.com', 'Password123!');
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 200);
  fx.setUserPermissions('U-WU', { view_development: false });
  assert.equal((await fx.request('/development-workbench', { cookie })).status, 403);
});
```

- [ ] **Step 7: Run permission and full tests**

Run: `/opt/homebrew/bin/node --test test/access_control.test.js test/sales_crm.test.js test/permission_integration.test.js`

Expected: PASS.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS with no test writing `permissions_json` except explicit migration/rollback tests.

- [ ] **Step 8: Commit the runtime switch**

```bash
git add lib/access_control.js lib/sales_crm.js server.js test/helpers/permission_fixture.js test/access_control.test.js test/sales_crm.test.js test/permission_integration.test.js
git commit -m "refactor: resolve permissions from groups and overrides"
```

### Task 3: Permission Group, User Override, and Last-Admin APIs

**Files:**
- Modify: `lib/permission_groups.js`
- Modify: `lib/access_control.js:120-140, 245-258`
- Modify: `lib/sales_crm.js:105-120, 1398-1487, 1708-1781, 1890-2026`
- Modify: `test/helpers/permission_fixture.js`
- Create: `test/permission_group_api.test.js`

**Interfaces:**
- Produces: `listPermissionGroups(db) -> PermissionGroup[]`
- Produces: `createPermissionGroup(db, actor, payload) -> { groupId }`
- Produces: `updatePermissionGroup(db, actor, groupId, payload) -> { groupId }`
- Produces: `replaceUserOverrides(db, actor, userId, overrideMap) -> { userId }`
- Produces: `assertValidAdminRemains(db) -> void`, throwing status 409.
- Produces: `adminFixture(options) -> fixture with adminCookie, otherCookie, group IDs, requestJson, and loginStatus`.
- Produces: `badRequest(message)` and `notFound(message)` HTTP error helpers for subsequent account APIs.

- [ ] **Step 1: Write API tests for groups, tri-state overrides, and every last-admin mutation path**

```js
// test/permission_group_api.test.js
test('group edits and allow/deny overrides affect members without relogin', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/permission-groups', {
    cookie: fx.adminCookie, method: 'POST', body: {
      name: 'Restricted sales', role: 'sales', description: 'No Recon',
      permissions: { ...ROLE_PERMISSIONS.sales, view_recon: false },
    },
  });
  await fx.requestJson('/api/sales-crm/users/U-OTHER', {
    cookie: fx.adminCookie, method: 'PATCH', body: { role: 'sales', permissionGroupId: created.groupId },
  });
  await fx.requestJson('/api/sales-crm/users/U-OTHER/permission-overrides', {
    cookie: fx.adminCookie, method: 'PUT', body: { view_recon: 'allow', view_contacts: 'deny' },
  });
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  assert.equal(bootstrap.user.permissions.view_recon, true);
  assert.equal(bootstrap.user.permissions.view_contacts, false);
});

test('role status group and override changes cannot remove the last valid administrator', async t => {
  const fx = await fixtures.adminFixture({ adminCount: 1 });
  t.after(() => fx.close());
  const cases = [
    ['/api/sales-crm/users/U-ADMIN', 'PATCH', { role: 'manager', permissionGroupId: fx.managerGroupId }],
    ['/api/sales-crm/users/U-ADMIN', 'PATCH', { active: false }],
    ['/api/sales-crm/users/U-ADMIN/permission-overrides', 'PUT', { manage_users: 'deny' }],
    [`/api/sales-crm/permission-groups/${fx.adminGroupId}`, 'PATCH', { permissions: { ...ROLE_PERMISSIONS.admin, view_users: false } }],
  ];
  for (const [route, method, body] of cases) {
    const response = await fx.request(route, { cookie: fx.adminCookie, method, body });
    assert.equal(response.status, 409, route);
  }
});
```

- [ ] **Step 2: Run the new API tests and verify routes are denied or missing**

Run: `/opt/homebrew/bin/node --test test/permission_group_api.test.js`

Expected: FAIL with 403 for unmapped routes or 404 for missing handlers.

- [ ] **Step 3: Extend the isolated fixture with administrator and JSON helpers**

```js
// test/helpers/permission_fixture.js
async function adminFixture(options = {}) {
  const fx = await seededFixture();
  const { hashPassword } = require('../../lib/sales_crm');
  const password = hashPassword('Admin123!', 'abcdef0123456789abcdef0123456789');
  fx.db.prepare(`UPDATE sales_users SET email='admin@example.com',password_hash=?,password_salt=?,
    must_change_password=0,active=1 WHERE id='USR-ADMIN'`).run(password.hash, password.salt);
  if (options.adminCount === 2) {
    fx.db.prepare(`INSERT INTO sales_users
      (id,email,name,role,password_hash,password_salt,active,must_change_password,
       languages_json,countries_json,channels_json,permissions_json,permission_group_id,created_at,updated_at)
      SELECT 'U-ADMIN2','admin2@example.com','Admin Two','admin',password_hash,password_salt,1,0,
       '[]','[]','[]','{}',permission_group_id,created_at,updated_at FROM sales_users WHERE id='USR-ADMIN'`).run();
  }
  fx.adminCookie = await fx.login('admin@example.com', 'Admin123!');
  fx.otherCookie = await fx.login('other@example.com', 'Password123!');
  fx.adminGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='admin-default'").get().id;
  fx.managerGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='manager-default'").get().id;
  fx.salesGroupId = fx.db.prepare("SELECT id FROM permission_groups WHERE system_key='sales-default'").get().id;
  fx.requestJson = async (route, options) => (await fx.request(route, options)).json();
  fx.loginStatus = async (email, candidate) => {
    const response = await fetch(`${fx.baseUrl}/api/sales-auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: candidate }),
    });
    return response.status;
  };
  return fx;
}
```

Export `adminFixture` with the existing helpers. Use `adminCount: 1` as the default; Task 3 tests may request `adminCount: 2` for positive multi-admin mutations.

- [ ] **Step 4: Add exact Sales route policies and route-key normalization**

```js
// lib/access_control.js
'GET /permission-groups': { permissions: ['view_users'] },
'POST /permission-groups': { permissions: ['view_users', 'manage_users'] },
'PATCH /permission-groups/:groupId': { permissions: ['view_users', 'manage_users'] },
'PUT /users/:userId/permission-overrides': { permissions: ['view_users', 'manage_users'] },
```

Teach `salesRouteKey` to normalize `/permission-groups/:groupId` and `/users/:userId/permission-overrides`. Extend the policy enumeration test with all four keys.

- [ ] **Step 5: Implement strict permission-group validation and last-admin transactions**

```js
// lib/permission_groups.js
function assertValidAdminRemains(db) {
  const admins = db.prepare("SELECT * FROM sales_users WHERE active=1 AND role='admin'").all();
  const valid = admins.filter(user => {
    const permissions = effectivePermissionsFor(db, user.id);
    return permissions.view_users && permissions.manage_users;
  });
  if (!valid.length) {
    const error = new Error('必须保留至少一个有效管理员');
    error.statusCode = 409;
    error.code = 'LAST_ADMIN_REQUIRED';
    throw error;
  }
}
```

For group and override writes, validate every permission key against `PERMISSION_DEFINITIONS`, validate all values as booleans or tri-state strings, run the mutation and `assertValidAdminRemains` inside one `better-sqlite3` transaction, and let an exception roll back the write.

- [ ] **Step 6: Split user account edits from personal permission edits**

```js
// lib/sales_crm.js, updateUser
function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}
const badRequest = message => httpError(400, message);
const notFound = message => httpError(404, message);

const allowed = new Set(['name', 'role', 'active', 'permissionGroupId', 'languages', 'countries', 'channels']);
for (const key of Object.keys(payload)) {
  if (!allowed.has(key)) throw badRequest(`不支持的账号字段：${key}`);
}
if (payload.role && !payload.permissionGroupId) throw badRequest('修改角色时必须同时选择权限组');
```

Remove password and permissions handling from `PATCH /users/:userId`. Validate the selected group's `role_key` against the resulting role and run the account update plus `assertValidAdminRemains` in one transaction.
Import `forbidden` from `lib/access_control.js` for role-specific 403 errors used by this task and Task 4.

- [ ] **Step 7: Return group metadata and user overrides in bootstrap**

```js
// safe user shape
permissionGroupId: row.permission_group_id,
permissionGroupName: row.permission_group_name || '',
permissionOverrides: row.permissionOverrides || {},
permissionOverrideCount: Object.keys(row.permissionOverrides || {}).length,
```

When `view_users` is true, return `permissionGroups` with `id`, `name`, `description`, `role`, `permissions`, and `memberCount`. Do not return legacy `permissions_json`.

- [ ] **Step 8: Register handlers and preserve status codes**

Add `GET/POST/PATCH /api/sales-crm/permission-groups` handlers and `PUT /api/sales-crm/users/:userId/permission-overrides`. Responses must include `error.code` when present and use `error.statusCode || 400`.

- [ ] **Step 9: Run API tests and the full suite**

Run: `/opt/homebrew/bin/node --test test/permission_group_api.test.js test/permission_integration.test.js`

Expected: PASS, including all last-admin cases and non-admin 403 cases.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 10: Commit permission management APIs**

```bash
git add lib/permission_groups.js lib/access_control.js lib/sales_crm.js test/permission_group_api.test.js test/access_control.test.js test/helpers/permission_fixture.js
git commit -m "feat: manage permission groups and user overrides"
```

### Task 4: Permanent User Passwords and Administrator Reset

**Files:**
- Modify: `lib/access_control.js:120-140, 245-258`
- Modify: `lib/sales_crm.js:1708-1799, 1962-2026`
- Modify: `test/helpers/permission_fixture.js`
- Create: `test/admin_password_reset.test.js`

**Interfaces:**
- Produces: `resetUserPassword(actor, userId, payload) -> { userId, changed: true }`
- Preserves: `changePassword(user, payload) -> { changed: true }` for self-service only.

- [ ] **Step 1: Write password lifecycle tests**

```js
test('new users and admin resets use permanent passwords and revoke old sessions', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const created = await fx.requestJson('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'new@example.com', name: 'New User', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Permanent123!',
    },
  });
  assert.equal(fx.db.prepare('SELECT must_change_password v FROM sales_users WHERE id=?').get(created.userId).v, 0);
  const oldCookie = await fx.login('other@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/users/U-OTHER/password-reset', {
    cookie: fx.adminCookie, method: 'POST',
    body: { password: 'Replacement123!', passwordConfirm: 'Replacement123!' },
  });
  assert.equal(response.status, 200);
  assert.equal((await fx.request('/api/sales-crm/bootstrap', { cookie: oldCookie })).status, 401);
  assert.equal(await fx.loginStatus('other@example.com', 'Password123!'), 401);
  assert.equal(await fx.loginStatus('other@example.com', 'Replacement123!'), 200);
});
```

Also test password mismatch is 400, self-target reset is 400, managers/sales receive 403, and audit JSON contains none of `Replacement123!`, `password_hash`, `password_salt`, or a session token.

- [ ] **Step 2: Run the password test and verify the reset route is unmapped**

Run: `/opt/homebrew/bin/node --test test/admin_password_reset.test.js`

Expected: FAIL with 403 or 404 for `/password-reset`.

- [ ] **Step 3: Add the password-reset policy and route normalization**

```js
'POST /users/:userId/password-reset': { permissions: ['view_users', 'manage_users'], adminOnly: true },
```

Normalize `/users/:userId/password-reset` before the generic `/users/:userId` route match.

- [ ] **Step 4: Make creation passwords permanent**

Change `createUser` to require a valid role-matching group, omit `permissions`, and insert `must_change_password=0`. Keep the existing scrypt hash and unique-email handling.

- [ ] **Step 5: Implement transactional administrator reset**

```js
function resetUserPassword(actor, userId, payload) {
  assertPermission(actor, 'view_users');
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') throw forbidden('只有管理员可以重置密码');
  if (actor.id === userId) throw badRequest('请使用本人修改密码功能');
  const password = String(payload.password || '');
  if (password !== String(payload.passwordConfirm || '')) throw badRequest('两次输入的新密码不一致');
  if (password.length < 8) throw badRequest('新密码至少8位');
  const value = db();
  try {
    const transaction = value.transaction(() => {
      if (!value.prepare('SELECT 1 FROM sales_users WHERE id=?').get(userId)) throw notFound('用户不存在');
      const pw = hashPassword(password);
      value.prepare(`UPDATE sales_users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?`)
        .run(pw.hash, pw.salt, nowText(), userId);
      value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(userId);
    });
    transaction();
    return { userId, changed: true };
  } finally { value.close(); }
}
```

- [ ] **Step 6: Register the reset endpoint and redact audit content**

The route must pass only `actor`, `userId`, and body to `resetUserPassword`. Existing `redactAuditPayload` remains defense in depth; add a specific audit test proving the raw password never appears.

- [ ] **Step 7: Run focused and full tests**

Run: `/opt/homebrew/bin/node --test test/admin_password_reset.test.js`

Expected: PASS.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 8: Commit permanent password behavior**

```bash
git add lib/access_control.js lib/sales_crm.js test/helpers/permission_fixture.js test/admin_password_reset.test.js
git commit -m "feat: add permanent admin password reset"
```

### Task 5: Identity Inspection Session Lifecycle

**Files:**
- Create: `lib/impersonation.js`
- Create: `test/impersonation_session.test.js`
- Modify: `lib/sales_crm.js:122-147, 515-551, 1816-1903`
- Modify: `lib/access_control.js:120-140, 245-258`

**Interfaces:**
- Produces: `installImpersonationSchema(db) -> void`
- Produces: `resolveSessionIdentity(db, sessionRow, now) -> { realUser, effectiveUser, impersonation }`
- Produces: `startImpersonation(db, realUser, tokenHash, targetUserId, now) -> ImpersonationContext`
- Produces: `stopImpersonation(db, realUser, tokenHash, reason, now) -> void`
- Produces: test fixture methods `startImpersonation(targetUserId)` and `expireCurrentImpersonation()`.

- [ ] **Step 1: Write lifecycle tests for start, stop, invalid target, and expiry**

```js
test('admin inspection keeps the real user and resolves the active target', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const start = await fx.requestJson('/api/sales-crm/impersonation/start', {
    cookie: fx.adminCookie, method: 'POST', body: { targetUserId: 'U-OTHER' },
  });
  assert.equal(start.impersonation.targetUser.id, 'U-OTHER');
  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  assert.equal(bootstrap.realUser.id, 'U-ADMIN');
  assert.equal(bootstrap.user.id, 'U-OTHER');
  assert.equal(bootstrap.impersonation.contextId, start.impersonation.contextId);
});

test('expired inspection aborts the request and never falls through as admin', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-OTHER');
  fx.expireCurrentImpersonation();
  const before = fx.db.prepare('SELECT COUNT(*) n FROM sales_users').get().n;
  const response = await fx.request('/api/sales-crm/users', {
    cookie: fx.adminCookie, method: 'POST', body: {
      email: 'must-not-exist@example.com', name: 'Blocked', role: 'sales',
      permissionGroupId: fx.salesGroupId, password: 'Password123!',
    },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'IMPERSONATION_ENDED');
  assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM sales_users').get().n, before);
});
```

- [ ] **Step 2: Run lifecycle tests and verify start is unmapped**

Run: `/opt/homebrew/bin/node --test test/impersonation_session.test.js`

Expected: FAIL with 403 or 404 for impersonation routes.

- [ ] **Step 3: Add inspection helpers to the isolated fixture**

```js
// test/helpers/permission_fixture.js, inside adminFixture before return
fx.startImpersonation = async targetUserId => {
  const response = await fx.request('/api/sales-crm/impersonation/start', {
    cookie: fx.adminCookie, method: 'POST', body: { targetUserId },
  });
  assert.equal(response.status, 200);
  return response.json();
};
fx.expireCurrentImpersonation = () => {
  fx.db.prepare(`UPDATE sales_sessions SET impersonation_expires_at='2000-01-01 00:00:00'
    WHERE impersonation_context_id!=''`).run();
};
```

Import `node:assert/strict` in the fixture helper for the start assertion.

- [ ] **Step 4: Add nullable session columns and audit identity columns**

```js
// lib/impersonation.js
function ensureColumn(db, table, name, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function installImpersonationSchema(db) {
  ensureColumn(db, 'sales_sessions', 'impersonated_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_started_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_expires_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_context_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'real_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'effective_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'impersonation_context_id', "TEXT NOT NULL DEFAULT ''");
}
```

Call `installImpersonationSchema(value)` from `installSalesCrm` after both base tables exist.

- [ ] **Step 5: Implement exact start and stop rules**

`startImpersonation` must require real role admin, real effective `view_users + manage_users`, no existing context, and an active target with role manager or sales. It writes a random `IMP-...` context ID, current time, and expiry exactly 30 minutes later to the current session row. `stopImpersonation` clears all four fields and writes a start/stop/expiry/invalidated audit row without payload secrets.

- [ ] **Step 6: Resolve real and effective users before business middleware**

```js
function sessionIdentity(req) {
  const token = parseCookies(req.headers.cookie || '').sales_session || '';
  if (!token) return null;
  const value = db();
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = value.prepare('SELECT * FROM sales_sessions WHERE token_hash=? AND expires_at>?')
      .get(tokenHash, nowText());
    return session ? resolveSessionIdentity(value, session, nowText()) : null;
  } finally { value.close(); }
}

function requireSalesUser(req, res, next) {
  const session = sessionIdentity(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录', code: 'AUTH_REQUIRED' });
  if (session.ended) return res.status(409).json({ ok: false, error: '身份检查已结束，请刷新页面', code: 'IMPERSONATION_ENDED' });
  req.realUser = session.realUser;
  req.salesUser = session.effectiveUser;
  req.impersonation = session.impersonation;
  // must-change-password and access context continue from effective user
  next();
}
```

On expiry, missing target, inactive target, target role admin, missing group, or role/group mismatch: clear the context, audit the end reason, return `ended: true`, and never return the real administrator as `effectiveUser` for that request.

- [ ] **Step 7: Add start/stop policies and handlers**

```js
'POST /impersonation/start': { permissions: ['view_users', 'manage_users'], realAdminOnly: true },
'POST /impersonation/stop': { permissions: [], impersonationControl: true },
```

The stop handler is allowed only when a context exists. The start handler receives `req.realUser` and the current session token hash, never `req.salesUser` as authority.

- [ ] **Step 8: Expose safe identity context in bootstrap**

```js
realUser: safeUser(req.realUser),
user: safeUser(req.salesUser),
impersonation: req.impersonation ? {
  contextId: req.impersonation.contextId,
  startedAt: req.impersonation.startedAt,
  expiresAt: req.impersonation.expiresAt,
  targetUser: safeUser(req.salesUser),
} : null,
```

Do not expose session token hashes or raw session rows.

- [ ] **Step 9: Run lifecycle and full tests**

Run: `/opt/homebrew/bin/node --test test/impersonation_session.test.js`

Expected: PASS.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 10: Commit session lifecycle support**

```bash
git add lib/impersonation.js lib/sales_crm.js lib/access_control.js test/impersonation_session.test.js test/helpers/permission_fixture.js
git commit -m "feat: add identity inspection sessions"
```

### Task 6: Inspection Authorization, Recon Blocking, Scope, and Audit

**Files:**
- Modify: `lib/access_control.js:89-140, 229-258`
- Modify: `lib/sales_crm.js:90-98, 1380-1487, 1864-1903`
- Modify: `server.js:60-103, 223-240, 645-684`
- Create: `test/impersonation_authorization.test.js`

**Interfaces:**
- Produces: policy property `blockedWhileImpersonating: boolean`
- Produces: `assertPolicyAllowed(policy, identityContext) -> void`
- Extends audit writes with `real_user_id`, `effective_user_id`, and `impersonation_context_id`.

- [ ] **Step 1: Write authorization tests covering scope, normal writes, Recon, security routes, and audit identities**

```js
test('sales inspection uses target scope and audits both identities on writes', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-OTHER');
  assert.equal((await fx.request('/api/sales-crm/accounts/CRM-OWN', {
    cookie: fx.adminCookie, method: 'PATCH', body: { priority: 'A' },
  })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/activities', {
    cookie: fx.adminCookie, method: 'POST', body: {
      customerId: 'CRM-OTHER', activityType: 'note', summary: 'Inspection write',
    },
  })).status, 200);
  const audit = fx.db.prepare("SELECT * FROM crm_audit_log WHERE action='POST /activities' ORDER BY created_at DESC LIMIT 1").get();
  assert.equal(audit.real_user_id, 'U-ADMIN');
  assert.equal(audit.effective_user_id, 'U-OTHER');
  assert.ok(audit.impersonation_context_id);
});

test('all Recon starts and security writes are blocked without creating work', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await fx.startImpersonation('U-MGR');
  const before = {
    recon: fx.db.prepare('SELECT COUNT(*) n FROM recon_jobs').get().n,
    contact: fx.db.prepare('SELECT COUNT(*) n FROM contact_recon_jobs').get().n,
  };
  const requests = [
    ['/api/app', { action: 'createReconJob', customerId: 'RU-9002' }],
    ['/api/app', { action: 'retryReconJob', jobId: 'JOB-OWN' }],
    ['/api/app', { action: 'createContactReconJob', customerId: 'RU-9002' }],
    ['/api/sales-crm/users/U-OTHER/permission-overrides', { view_contacts: 'allow' }, 'PUT'],
    ['/api/sales-crm/users/U-OTHER/password-reset', { password: 'Blocked123!', passwordConfirm: 'Blocked123!' }],
  ];
  for (const [route, body, method = 'POST'] of requests) {
    assert.equal((await fx.request(route, { cookie: fx.adminCookie, method, body })).status, 403, route);
  }
  assert.deepEqual({
    recon: fx.db.prepare('SELECT COUNT(*) n FROM recon_jobs').get().n,
    contact: fx.db.prepare('SELECT COUNT(*) n FROM contact_recon_jobs').get().n,
  }, before);
});
```

- [ ] **Step 2: Run authorization tests and observe missing explicit blocks/audit identities**

Run: `/opt/homebrew/bin/node --test test/impersonation_authorization.test.js`

Expected: FAIL because legacy Recon policies lack inspection blocks and audit rows lack dual identities.

- [ ] **Step 3: Mark every forbidden route/action explicitly**

Add `blockedWhileImpersonating: true` to legacy `createReconJob`, `retryReconJob`, and `createContactReconJob`; Sales user/group/override/password/self-password/migration-review/start-inspection/intake-setting security policies; and any other admin-only security route found by the policy enumeration test.

```js
function assertPolicyAllowed(policy, identity) {
  if (identity.isImpersonating && policy.blockedWhileImpersonating) {
    const error = forbidden('身份检查期间不能执行此操作');
    error.code = 'IMPERSONATION_ACTION_BLOCKED';
    throw error;
  }
}
```

Run this assertion before all route handlers in both Sales and legacy policy middleware.

- [ ] **Step 4: Use effective identity for every authorization and data-scope call**

Verify `req.salesUser`, `req.accessContext.user`, `loadPayload`, `loadResearchPage`, account writes, intake actions, AI, prospect tasks, workbench capabilities, and legacy row assertions all receive the target user during inspection. Only start/stop and audit use `req.realUser` directly.

- [ ] **Step 5: Write dual-identity audit rows without secrets**

```js
function auditIdentity(req) {
  return {
    userId: req.salesUser?.id || '',
    realUserId: req.realUser?.id || req.salesUser?.id || '',
    effectiveUserId: req.salesUser?.id || '',
    contextId: req.impersonation?.contextId || '',
  };
}
```

Update both `server.js` denied-write auditing and `lib/sales_crm.js` success/denied auditing to populate legacy `user_id` with the effective user plus the three new columns. Continue using `redactAuditPayload`; Recon denials must not include customer identifiers or request payloads.

- [ ] **Step 6: Query names for both identities in bootstrap audit rows**

Join `crm_audit_log.real_user_id` and `effective_user_id` to `sales_users` as `real_user_name` and `effective_user_name`. Keep legacy `user_name` for old rows.

- [ ] **Step 7: Run authorization, permission-isolation, and full tests**

Run: `/opt/homebrew/bin/node --test test/impersonation_authorization.test.js test/permission_integration.test.js`

Expected: PASS, including cross-scope 403, normal write success, no Recon jobs, and dual-identity audit.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 8: Commit inspection safety enforcement**

```bash
git add lib/access_control.js lib/sales_crm.js server.js test/impersonation_authorization.test.js test/access_control.test.js
git commit -m "fix: enforce inspection scope and blocked actions"
```

### Task 7: User, Group, Override, and Password Management UI

**Files:**
- Modify: `sales-crm.html:83-99, 272-280, 301`
- Modify: `sales-assets/app.js:6-20, 153-191, 761-796, 962-1016, 1081-1173, 1260-1371`
- Modify: `sales-assets/app.css`
- Create: `test/sales_access_ui.test.js`

**Interfaces:**
- Consumes: bootstrap `permissionGroups`, user `permissionGroupId`, `permissionOverrides`, and effective `permissions`.
- Produces: forms `editUserForm`, `permissionGroupForm`, `permissionOverrideForm`, and `adminPasswordResetForm`.

- [ ] **Step 1: Write source-level UI contract tests**

```js
test('access UI exposes groups tri-state overrides account edits and password reset', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(html, /id="permissionGroupTable"/);
  assert.match(js, /permissionOverrideForm/);
  assert.match(js, /value="inherit"/);
  assert.match(js, /value="allow"/);
  assert.match(js, /value="deny"/);
  assert.match(js, /adminPasswordResetForm/);
  assert.match(js, /passwordConfirm/);
  assert.match(js, /data-edit-user/);
});
```

- [ ] **Step 2: Run the UI contract test and verify it fails**

Run: `/opt/homebrew/bin/node --test test/sales_access_ui.test.js`

Expected: FAIL because the group table and new forms do not exist.

- [ ] **Step 3: Add the permission-group panel and stable containers**

```html
<article class="panel access-panel">
  <div class="panel-head">
    <div><p class="eyebrow">PERMISSION GROUPS</p><h2>权限组</h2></div>
    <button id="newPermissionGroupBtn" class="button secondary">新建权限组</button>
  </div>
  <div id="permissionGroupTable" class="data-table"></div>
</article>
```

Keep the user table and audit table as sibling panels, not nested cards. Add an empty `#impersonationBanner` in Task 8 rather than mixing inspection state into this panel.

- [ ] **Step 4: Render the expanded user table and actions**

Columns must be user, role, group, override count, status, and actions. Actions are “编辑账号”, “个人权限”, “修改密码”, “身份检查” for active manager/sales targets, and enable/disable. Hide mutation actions unless `manage_users` is effective. Render audit operators as `real_user_name -> effective_user_name` when the IDs differ, and as one name for ordinary requests.

- [ ] **Step 5: Build role-matched account and group forms**

`editUserForm` submits only name, role, active, group ID, languages, countries, and channels to `PATCH /users/:id`. `permissionGroupForm` submits name, description, role, and a complete boolean permission object to POST or PATCH group endpoints. When role changes, filter group options to the selected `role` and require a new selection.

- [ ] **Step 6: Replace checkbox personal permissions with tri-state controls**

```js
function permissionOverrideFields(user) {
  return Object.entries(state.data.permissionDefinitions || {}).map(([key, label]) => {
    const inherited = Boolean(state.data.permissionGroups.find(group => group.id === user.permissionGroupId)?.permissions[key]);
    const selected = user.permissionOverrides?.[key] || 'inherit';
    return `<div class="permission-override-row">
      <div><strong>${esc(label)}</strong><small>组默认：${inherited ? '允许' : '拒绝'} · 当前：${user.permissions[key] ? '允许' : '拒绝'}</small></div>
      <select name="override__${esc(key)}">
        <option value="inherit" ${selected === 'inherit' ? 'selected' : ''}>继承</option>
        <option value="allow" ${selected === 'allow' ? 'selected' : ''}>允许</option>
        <option value="deny" ${selected === 'deny' ? 'selected' : ''}>拒绝</option>
      </select>
    </div>`;
  }).join('');
}
```

Submit the complete tri-state map to `PUT /users/:id/permission-overrides`; never submit effective permissions.

- [ ] **Step 7: Add the administrator password-reset form**

Use two blank password fields named `password` and `passwordConfirm`, both `type=password`, `minlength=8`, and `autocomplete=new-password`. Verify equality client-side, POST to `/users/:id/password-reset`, close the modal, and refresh user/audit data. Do not render or cache the password after submission.

- [ ] **Step 8: Add restrained responsive styling**

Add compact action menus/rows, group summaries, and `.permission-override-row` layout. At `max-width:780px`, stack the permission label and select, wrap user actions, and guarantee no text overlaps the bottom navigation. Keep cards at the existing radius and palette; do not introduce a new dominant color.

- [ ] **Step 9: Update asset cache-buster versions**

Increment both `/sales-assets/app.css?v=...` and `/sales-assets/app.js?v=...` in `sales-crm.html` so production clients receive the new UI.

- [ ] **Step 10: Run UI and full tests**

Run: `/opt/homebrew/bin/node --test test/sales_access_ui.test.js test/permission_group_api.test.js test/admin_password_reset.test.js`

Expected: PASS.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 11: Commit the access-management UI**

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/sales_access_ui.test.js
git commit -m "feat: add permission group administration UI"
```

### Task 8: Identity Inspection Banner and Return Flow

**Files:**
- Modify: `sales-crm.html:75-105, 301`
- Modify: `sales-assets/app.js:6-20, 107-177, 180-191, 761-796, 1081-1092, 1260-1389`
- Modify: `sales-assets/app.css`
- Modify: `test/sales_access_ui.test.js`

**Interfaces:**
- Consumes: bootstrap `realUser`, effective `user`, and nullable `impersonation`.
- Produces: `startIdentityInspection(userId) -> Promise<void>`
- Produces: `stopIdentityInspection() -> Promise<void>`
- Produces: `renderImpersonationBanner() -> void`

- [ ] **Step 1: Extend UI tests for persistent banner, countdown, and return control**

```js
test('identity inspection UI has a persistent banner and explicit return flow', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(html, /id="impersonationBanner"/);
  assert.match(html, /id="stopImpersonationBtn"/);
  assert.match(js, /IMPERSONATION_ENDED/);
  assert.match(js, /\/api\/sales-crm\/impersonation\/start/);
  assert.match(js, /\/api\/sales-crm\/impersonation\/stop/);
  assert.match(js, /setInterval/);
});
```

- [ ] **Step 2: Run the UI test and verify the inspection contract fails**

Run: `/opt/homebrew/bin/node --test test/sales_access_ui.test.js`

Expected: FAIL because the banner and start/stop flow are absent.

- [ ] **Step 3: Add a top-level persistent banner**

```html
<div id="impersonationBanner" class="impersonation-banner hidden" role="status">
  <div><strong id="impersonationTitle"></strong><span id="impersonationRemaining"></span></div>
  <button id="stopImpersonationBtn" class="button secondary" type="button">返回管理员账号</button>
</div>
```

Place it inside `.main` before `.topbar`, so it remains visible across all views and is not inside a card.

- [ ] **Step 4: Render identity state and countdown from server timestamps**

```js
function renderImpersonationBanner() {
  clearInterval(state.impersonationTimer);
  const context = state.data?.impersonation;
  $('#impersonationBanner').classList.toggle('hidden', !context);
  if (!context) return;
  $('#impersonationTitle').textContent = `正在以 ${state.data.user.name}（${roleLabel(state.data.user.role)}）身份检查`;
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((new Date(context.expiresAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000));
    $('#impersonationRemaining').textContent = `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (!seconds) load();
  };
  tick();
  state.impersonationTimer = setInterval(tick, 1000);
}
```

Call this from `load`, `refresh`, and after start/stop. The server remains authoritative.

- [ ] **Step 5: Handle `IMPERSONATION_ENDED` without replaying the request**

In `api`, attach `result.code` to the thrown error. When code equals `IMPERSONATION_ENDED`, clear local business state, show “身份检查已结束，正在恢复管理员账号”, and call a fresh GET bootstrap. Never retry the failed write request.

- [ ] **Step 6: Add start and stop interactions**

Clicking a user's “身份检查” action POSTs `{ targetUserId }` to `/impersonation/start`, closes the modal if open, then performs one fresh bootstrap. The return button POSTs `{}` to `/impersonation/stop`, clears the countdown, and performs one fresh bootstrap.

- [ ] **Step 7: Suppress forbidden UI while inspecting**

When `state.data.impersonation` exists, hide the users navigation button, new-user/group/password/edit actions, intake settings actions, and all Recon start/retry buttons. Keep ordinary target-authorized customer, follow-up, quote, order, and intake actions available. Direct APIs remain protected by Task 6.

- [ ] **Step 8: Add responsive banner styling and cache-buster update**

Use a high-contrast full-width band with no dismiss icon. At mobile width, stack identity text and return button while preserving stable height and avoiding overlap with `.topbar`. Increment CSS and JS cache-buster versions again.

- [ ] **Step 9: Run UI, session, authorization, and full tests**

Run: `/opt/homebrew/bin/node --test test/sales_access_ui.test.js test/impersonation_session.test.js test/impersonation_authorization.test.js`

Expected: PASS.

Run: `/opt/homebrew/bin/node --test`

Expected: PASS.

- [ ] **Step 10: Commit the inspection UI**

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/sales_access_ui.test.js
git commit -m "feat: add identity inspection banner and return flow"
```

### Task 9: End-to-End Verification, Evidence, and Branch Readiness

**Files:**
- Create: `docs/evidence/issue-3-verification.md`
- Modify only if verification finds defects: files owned by Tasks 1-8 and their tests.

**Interfaces:**
- Consumes: all Issue #3 APIs and UI from Tasks 1-8.
- Produces: reproducible verification record with commands, anonymized results, and screenshot paths.

- [ ] **Step 1: Run formatting and placeholder checks**

Run: `git diff --check`

Expected: no output.

Run: `rg -n "T(BD)|TO(DO)|FIX(ME)|permissions_json" lib server.js sales-assets test`

Expected: no runtime read/write of `permissions_json`; matches are limited to schema compatibility and explicit migration tests.

- [ ] **Step 2: Run the complete automated suite with the supported runtime**

Run: `/opt/homebrew/bin/node --test`

Expected: all tests PASS with zero failures, skips, or cancellations.

- [ ] **Step 3: Verify migration against an isolated production database copy**

Run `ISSUE3_VERIFY_DIR=$(mktemp -d)` and use SQLite `.backup "$ISSUE3_VERIFY_DIR/crm.db"` from the production database. Set `CRM_DB_PATH="$ISSUE3_VERIFY_DIR/crm.db"`, run `npm run crm:setup`, and compare a generated per-user permission snapshot from before/after migration. Record only user IDs and permission booleans, never passwords, salts, tokens, emails, phones, or contact names.

Expected: every user's effective permission map is identical before and after migration.

- [ ] **Step 4: Start the local server for browser verification**

Run: `CRM_DB_PATH="$ISSUE3_VERIFY_DIR/crm.db" PORT=3310 /opt/homebrew/bin/node server.js`

Expected: server remains running on `http://127.0.0.1:3310` with no startup migration error.

- [ ] **Step 5: Verify desktop and mobile UI with the browser skill**

Use `browser:control-in-app-browser` to capture screenshots at desktop and mobile widths for:

- permission group list and edit form;
- user table with role, group, override count, status, and actions;
- tri-state override editor showing inherited default and effective value;
- password reset double-entry form;
- active identity-inspection banner and return flow;
- sales inspection with hidden unauthorized navigation and a direct cross-scope API returning 403.

Store screenshots under `docs/evidence/issue-3/` with descriptive filenames and no secrets.

- [ ] **Step 6: Verify critical browser workflows and database effects**

Create a second administrator; prove neither admin can remove the final valid admin. Reset a test sales password; prove old password and old session fail while new password succeeds without forced change. Inspect as sales and manager; create one ordinary follow-up write and confirm both audit identities. Attempt Recon and contact Recon; confirm 403 and unchanged job counts. Expire a context in the test database; submit a write and confirm `409 IMPERSONATION_ENDED` with no write.

- [ ] **Step 7: Write anonymized evidence**

Write `docs/evidence/issue-3-verification.md` with the exact output of `git rev-parse HEAD`, the final Node test summary, the counted migrated users and permission keys, the five last-admin status codes, password/session results, scope status codes, unchanged Recon job counts, expiry result, audit identity IDs, and the final screenshot filenames. Do not use estimated counts or example values.

- [ ] **Step 8: Run final verification after evidence changes**

Run: `git diff --check && /opt/homebrew/bin/node --test`

Expected: no diff errors and all tests PASS.

- [ ] **Step 9: Commit verification evidence**

```bash
git add docs/evidence/issue-3-verification.md docs/evidence/issue-3
git commit -m "docs: record issue 3 verification"
```

- [ ] **Step 10: Review branch scope**

Run: `git status --short --branch && git log --oneline origin/main..HEAD && git diff --stat origin/main...HEAD`

Expected: clean worktree; commits contain only the Issue #3 design, implementation plan, implementation, tests, and evidence.

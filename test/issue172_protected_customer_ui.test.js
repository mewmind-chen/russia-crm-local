'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const {
  SALES_ROUTE_POLICIES,
  policyForSalesRequest,
} = require('../lib/access_control');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
const frontend = `${html}\n${app}`;

const ALPHA_NAME = 'Alpha Issue 190 Private';
const TEMPLATE_COLUMNS = [
  'alphaNickname',
  'companyName',
  'country',
  'city',
  'website',
  'industry',
  'customerType',
  'productFocus',
];
const MAPPING_COLUMNS = [
  'externalCustomerId',
  'alphaNickname',
  'crmNickname',
  'companyName',
  'status',
];

function csvHeader(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split(',');
}

function assertPrivate(text, message = 'response must not leak the Alpha name') {
  assert.equal(String(text).includes(ALPHA_NAME), false, message);
}

async function protectedFixture(t, { writesEnabled = true } = {}) {
  const previousGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = writesEnabled ? 'true' : 'false';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previousGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
    else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousGate;
  });
  return fx;
}

async function createProtectedCustomer(fx, suffix = '190') {
  const previewResponse = await fx.request(
    '/api/sales-crm/protected-customers/batches/preview',
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: {
        idempotencyKey: `issue190-preview-${suffix}`,
        rows: [{
          alphaNickname: ALPHA_NAME,
          country: 'Russia',
          city: 'Moscow',
          website: 'https://issue190-draft.example',
          industry: 'Electronics',
          customerType: 'OEM',
          productFocus: 'MCU',
        }],
      },
    },
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  const commitResponse = await fx.request(
    `/api/sales-crm/protected-customers/batches/${encodeURIComponent(preview.batchId)}/commit`,
    {
      cookie: fx.adminCookie,
      method: 'POST',
      body: { idempotencyKey: `issue190-commit-${suffix}` },
    },
  );
  assert.equal(commitResponse.status, 200);
  const committed = await commitResponse.json();
  return {
    batchId: preview.batchId,
    externalCustomerId: committed.rows[0].externalCustomerId,
  };
}

test('protected-customer management APIs use one explicit real-admin permission policy', () => {
  const routes = [
    ['GET', '/protected-customers/template', 'GET /protected-customers/template'],
    ['GET', '/protected-customers/export', 'GET /protected-customers/export'],
    ['GET', '/protected-customers/RU-1001', 'GET /protected-customers/:externalCustomerId'],
    ['PATCH', '/protected-customers/RU-1001', 'PATCH /protected-customers/:externalCustomerId'],
    ['POST', '/protected-customer-conflicts/rescan', 'POST /protected-customer-conflicts/rescan'],
  ];

  for (const [method, route, key] of routes) {
    assert.deepEqual(policyForSalesRequest(method, route), SALES_ROUTE_POLICIES[key], key);
    assert.deepEqual(SALES_ROUTE_POLICIES[key], {
      permissions: ['manage_protected_customers'],
      realAdminOnly: true,
      blockedWhileImpersonating: true,
    }, key);
  }
});

test('manager, sales, and impersonation cannot call any new management API or read Alpha data', async t => {
  const fx = await protectedFixture(t);
  const { externalCustomerId } = await createProtectedCustomer(fx, 'privacy');
  const routes = [
    { route: '/api/sales-crm/protected-customers/template' },
    { route: '/api/sales-crm/protected-customers/export' },
    { route: `/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}` },
    {
      route: `/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`,
      method: 'PATCH',
      body: { companyName: ALPHA_NAME, country: 'Forbidden' },
    },
    {
      route: '/api/sales-crm/protected-customer-conflicts/rescan',
      method: 'POST',
      body: { note: ALPHA_NAME },
    },
  ];

  fx.setUserPermissions('USR-ADMIN', { manage_protected_customers: false });
  for (const options of routes) {
    const response = await fx.request(options.route, { cookie: fx.adminCookie, ...options });
    assert.equal(response.status, 403, `admin-without-permission:${options.method || 'GET'}:${options.route}`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assertPrivate(await response.text());
  }
  fx.setUserPermissions('USR-ADMIN', { manage_protected_customers: true });

  // A manager remains blocked even if an override grants the named permission.
  fx.setUserPermissions('U-WU', { manage_protected_customers: true });
  for (const actor of [
    ['manager', fx.cookie],
    ['sales', fx.otherCookie],
  ]) {
    for (const options of routes) {
      const response = await fx.request(options.route, { cookie: actor[1], ...options });
      assert.equal(response.status, 403, `${actor[0]}:${options.method || 'GET'}:${options.route}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assertPrivate(await response.text());
    }
  }

  await fx.startImpersonation('U-OTHER');
  for (const options of routes) {
    const response = await fx.request(options.route, { cookie: fx.adminCookie, ...options });
    assert.equal(response.status, 403, `impersonation:${options.method || 'GET'}:${options.route}`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assertPrivate(await response.text());
  }
});

test('the CSV template is read-only, has the supported columns, and ignores the write gate', async t => {
  const fx = await protectedFixture(t, { writesEnabled: false });
  const before = {
    batches: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customer_batches').get().count,
    rows: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customer_batch_rows').get().count,
    customers: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customers').get().count,
  };
  const response = await fx.request('/api/sales-crm/protected-customers/template', {
    cookie: fx.adminCookie,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/csv(?:;|$)/);
  assert.match(response.headers.get('content-disposition'), /protected-customer-template\.csv/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(csvHeader(await response.text()), TEMPLATE_COLUMNS);
  assert.deepEqual({
    batches: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customer_batches').get().count,
    rows: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customer_batch_rows').get().count,
    customers: fx.db.prepare('SELECT COUNT(*) count FROM crm_protected_customers').get().count,
  }, before);
});

test('protected list searches every identity name and returns the fields needed by the workspace', async t => {
  const fx = await protectedFixture(t);
  const { batchId, externalCustomerId } = await createProtectedCustomer(fx, 'search');
  const crmNickname = 'CRM Issue 190 Nickname';
  const companyName = 'Issue 190 Official LLC';
  fx.db.prepare('UPDATE customer_pool SET nickname=?,company_name=? WHERE customer_id=?')
    .run(crmNickname, companyName, externalCustomerId);

  for (const query of [ALPHA_NAME, crmNickname, companyName, externalCustomerId]) {
    const response = await fx.request(
      `/api/sales-crm/protected-customers?status=protected&query=${encodeURIComponent(query)}`,
      { cookie: fx.adminCookie },
    );
    assert.equal(response.status, 200, query);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const result = await response.json();
    assert.equal(result.total, 1, query);
    assert.equal(result.items[0].externalCustomerId, externalCustomerId, query);
  }

  const listed = await fx.requestJson(
    `/api/sales-crm/protected-customers?query=${encodeURIComponent(externalCustomerId)}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(listed.writeEnabled, true);
  assert.deepEqual(
    Object.fromEntries([
      'externalCustomerId', 'alphaNickname', 'crmNickname', 'companyName', 'country',
      'batchId', 'status',
    ].map(key => [key, listed.items[0][key]])),
    {
      externalCustomerId,
      alphaNickname: ALPHA_NAME,
      crmNickname,
      companyName,
      country: 'Russia',
      batchId,
      status: 'protected',
    },
  );
  assert.match(listed.items[0].createdAt, /^\d{4}-\d{2}-\d{2}/);
});

test('detail supplementation fails closed without writes and persists with an audit when enabled', async t => {
  const fx = await protectedFixture(t);
  const { externalCustomerId } = await createProtectedCustomer(fx, 'supplement');
  const route = `/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`;
  const initial = await fx.request(route, { cookie: fx.adminCookie });
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).customer.alphaNickname, ALPHA_NAME);

  const beforeMaster = fx.db.prepare('SELECT * FROM customer_pool WHERE customer_id=?')
    .get(externalCustomerId);
  const beforeAudit = fx.db.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_audit
    WHERE external_customer_id=?`).get(externalCustomerId).count;
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const blocked = await fx.request(route, {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { companyName: 'Must Not Persist LLC', city: 'Blocked City' },
  });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
  assert.deepEqual(
    fx.db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get(externalCustomerId),
    beforeMaster,
  );
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_audit
    WHERE external_customer_id=?`).get(externalCustomerId).count, beforeAudit);

  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  const updatedResponse = await fx.request(route, {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: {
      companyName: 'Issue 190 Official LLC',
      country: 'Russia',
      city: 'Saint Petersburg',
      website: 'https://issue190.example',
      industry: 'Industrial Electronics',
      customerType: 'OEM',
      productFocus: 'Sensors',
    },
  });
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).customer;
  assert.equal(updated.companyName, 'Issue 190 Official LLC');
  assert.equal(updated.city, 'Saint Petersburg');
  assert.equal(updated.productFocus, 'Sensors');
  assert.equal(
    fx.db.prepare('SELECT company_name FROM customer_pool WHERE customer_id=?')
      .get(externalCustomerId).company_name,
    'Issue 190 Official LLC',
  );
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_protected_customer_audit
    WHERE external_customer_id=?`).get(externalCustomerId).count, beforeAudit + 1);
  const requestAudit = fx.db.prepare(`SELECT entity_id,detail_json FROM crm_audit_log
    WHERE action='PATCH /protected-customers/:externalCustomerId'
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).get();
  assert.ok(requestAudit);
  assert.equal(requestAudit.entity_id, '');
  assert.deepEqual(JSON.parse(requestAudit.detail_json), {
    route: 'PATCH /protected-customers/:externalCustomerId',
  });
  assertPrivate(JSON.stringify(requestAudit));
  assert.equal(JSON.stringify(requestAudit).includes(externalCustomerId), false);
  assert.equal(JSON.stringify(requestAudit).includes('Issue 190 Official LLC'), false);
});

test('mapping export is admin-only, contains the private mapping, and ordinary export stays Alpha-free', async t => {
  const fx = await protectedFixture(t);
  const { externalCustomerId } = await createProtectedCustomer(fx, 'export');
  fx.db.prepare('UPDATE customer_pool SET nickname=?,company_name=? WHERE customer_id=?')
    .run('CRM Current 190', 'Issue 190 Export Official LLC', externalCustomerId);

  const response = await fx.request('/api/sales-crm/protected-customers/export', {
    cookie: fx.adminCookie,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/csv(?:;|$)/);
  assert.match(response.headers.get('content-disposition'), /protected-customer-mapping\.csv/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const mapping = await response.text();
  const header = csvHeader(mapping);
  for (const column of MAPPING_COLUMNS) assert.ok(header.includes(column), column);
  assert.match(mapping, new RegExp(externalCustomerId));
  assert.match(mapping, new RegExp(ALPHA_NAME));
  assert.match(mapping, /CRM Current 190/);
  assert.match(mapping, /Issue 190 Export Official LLC/);
  assert.match(mapping, /protected/);

  const ordinary = await fx.request('/api/sales-crm/export', { cookie: fx.adminCookie });
  assert.equal(ordinary.status, 200);
  assertPrivate(await ordinary.text(), 'ordinary export must not include any Alpha field or value');
});

test('conflict rescan returns the established blocking gate and is protected by the write switch', async t => {
  const fx = await protectedFixture(t);
  const route = '/api/sales-crm/protected-customer-conflicts/rescan';
  const response = await fx.request(route, { cookie: fx.adminCookie, method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json();
  assert.equal(result.rescanned, true);
  assert.equal(Number.isInteger(result.unresolved), true);
  assert.equal(Number.isInteger(result.leadWarnings), true);
  assert.equal(Number.isInteger(result.blockingUnresolved), true);
  assert.equal(result.blockingUnresolved, result.unresolved - result.leadWarnings);
  assert.equal(result.canEnter172B, result.blockingUnresolved === 0);
  assert.ok(Array.isArray(result.items));

  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  const blocked = await fx.request(route, { cookie: fx.adminCookie, method: 'POST' });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
});

test('combined identity workspace keeps the protected lifecycle behind its named permission', () => {
  assert.match(html, /data-view="protectedCustomers"[^>]*>[\s\S]*?客户保护与查重/);
  assert.match(html, /id="protectedCustomersView"[^>]*class="[^"]*view/);
  assert.match(app, /protectedCustomers:\s*\{/);
  const protectedState = app.slice(
    app.indexOf('protectedCustomers: {'),
    app.indexOf('assistantRuntime:', app.indexOf('protectedCustomers: {')),
  );
  assert.match(protectedState, /\berror\b/);
  assert.match(protectedState, /\bpendingAction\b/);
  assert.match(app, /function canAccessProtectionAndDedupe\(/);
  assert.match(app, /protectedAdminWorkspace[^\n]*canManageProtectedCustomers/);
  assert.match(html, /id="protectedCsvInput"[^>]*type="file"[^>]*accept="[^"]*\.csv/);
  assert.match(app, /function parseProtectedCustomerCsv\(/);
  assert.match(app, /function loadProtectedCustomerCsv\(/);
  assert.match(app, /item\.leadNames/);
  assert.match(app, /data-save-protected-conflict/);
  assert.match(app, /conflictPage:\s*1/);
  assert.match(app, /conflictTotalPages/);
  assert.match(html, /id="pendingQueuePagination"[^>]*data-pagination="protected_conflicts"/);
  assert.match(app, /renderPagination\('#pendingQueuePagination', 'protected_conflicts'/);
  assert.match(app, /protectedConflictStatus[\s\S]{0,300}conflictPage\s*=\s*1/);
  assert.match(app, /targetPage\s*>\s*lastPage[\s\S]{0,180}conflictPage\s*=\s*lastPage/);

  for (const endpoint of [
    '/protected-customers',
    '/protected-customers/template',
    '/protected-customers/export',
    '/protected-customers/batches/preview',
    '/protected-customer-conflicts',
    '/protected-customer-conflicts/rescan',
  ]) {
    assert.ok(app.includes(endpoint), endpoint);
  }
  for (const operation of [
    '客户保护与查重', '下载导入模板', '预览', '冲突', '关联已有', '确认为新身份',
    '补充资料', '重新扫描', '提交', '激活', '回滚', '导出身份映射',
  ]) {
    assert.ok(frontend.includes(operation), operation);
  }
  assert.match(app, /editDraft|formDraft|draft/);
  assert.match(app, /pendingAction|pending/);
  assert.match(app, /success/);
  assert.match(app, /catch\s*\([^)]*\)\s*\{[\s\S]{0,500}(?:protectedCustomers|protected).*error/);
});

test('link_existing targets the selected comparable identity record', () => {
  const start = app.indexOf('function protectedConflictIdentityRecords');
  const end = app.indexOf('\n  function protectedConflictPendingOptions', start);
  assert.ok(start >= 0 && end > start);
  const targetFor = Function(`${app.slice(start, end)}\nreturn protectedConflictTargetExternalCustomerId;`)();
  const leadOnly = {
    identityRecords: [
      { externalCustomerId: 'LEAD-NEW', recordType: 'lead' },
      { externalCustomerId: 'LEAD-OLD', recordType: 'lead' },
    ],
  };
  assert.equal(targetFor(leadOnly, 'link_existing'), 'LEAD-OLD');
  assert.equal(targetFor(leadOnly, 'link_existing', 'LEAD-OLD'), 'LEAD-OLD');
  assert.equal(targetFor({
    identityRecords: [
      { externalCustomerId: 'LEAD-NEW', recordType: 'lead' },
      { externalCustomerId: 'CRM-1', recordType: 'crm' },
      { externalCustomerId: 'LEAD-OLD', recordType: 'lead' },
    ],
  }, 'link_existing'), 'CRM-1');
  assert.equal(targetFor(leadOnly, 'confirm_new'), '');
  assert.equal(targetFor(leadOnly, 'supplement_and_retry'), '');
  assert.equal(targetFor({ identityRecords: [] }, 'link_existing'), '');
});

test('protected workspace CSS keeps wide data inside the workspace at desktop and mobile widths', () => {
  assert.match(css, /\.protected-(?:customers-view|customer-workspace|workspace|layout)[^{]*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.protected-[^{]*(?:table|scroll|overflow)[^{]*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.protected-[^{]*(?:actions|toolbar)[^{]*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@media\s*\(max-width:\s*(?:780|700|640|600|430|420)px\)[\s\S]*\.protected-/);
  assert.doesNotMatch(css, /\.protected-(?:customers-view|customer-workspace|workspace|layout)[^{]*\{[^}]*(?:width|min-width):\s*(?:8\d\d|9\d\d|\d{4,})px/);
  assert.doesNotMatch(html, /<(?:section|article|div)[^>]*protected[^>]*style="[^"]*(?:width|min-width):\s*\d+px/i);
});

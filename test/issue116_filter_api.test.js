'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { FILTER_DEFINITIONS } = require('../lib/filter_catalog');

function encodeFilters(filters) {
  return encodeURIComponent(JSON.stringify(filters));
}

test('Issue #116 serves a scoped schema and rejects forged filters identically', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const salesSchemaResponse = await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  });
  assert.equal(salesSchemaResponse.status, 200);
  const salesSchema = await salesSchemaResponse.json();
  const salesKeys = salesSchema.schema.fields.map(item => item.key);
  assert.equal(salesKeys.includes('search'), true);
  assert.equal(salesKeys.includes('owner'), false);
  assert.equal(salesKeys.includes('creator'), false);

  const unknown = await fx.request(
    `/api/sales-crm/accounts?filters=${encodeFilters({
      secret_field: { operator: 'contains', value: 'secret' },
    })}`,
    { cookie: fx.otherCookie },
  );
  const unauthorized = await fx.request(
    `/api/sales-crm/accounts?filters=${encodeFilters({
      owner: { operator: 'in', values: ['U-WU'] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(unknown.status, 403);
  assert.equal(unauthorized.status, 403);
  const unknownBody = await unknown.json();
  const unauthorizedBody = await unauthorized.json();
  assert.deepEqual(
    { code: unknownBody.code, error: unknownBody.error },
    { code: unauthorizedBody.code, error: unauthorizedBody.error },
  );
  assert.doesNotMatch(JSON.stringify(unknownBody), /secret_field/);
  assert.doesNotMatch(JSON.stringify(unauthorizedBody), /owner/);

  const forgedQuickView = await fx.request(
    '/api/sales-crm/accounts?quickView=unassigned',
    { cookie: fx.otherCookie },
  );
  assert.equal(forgedQuickView.status, 403);
  assert.equal((await forgedQuickView.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue #116 management updates are versioned and immediately change user schemas', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const stateResponse = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.definitions.length, FILTER_DEFINITIONS.length);
  assert.deepEqual(state.availableSources.map(item => item.key), ['city']);
  assert.ok(state.permissionGroups.some(group => group.id === fx.salesGroupId));
  assert.ok(state.users.some(user => user.id === 'U-OTHER'));

  const updateResponse = await fx.request(
    `/api/sales-crm/filter-permissions/groups/${fx.salesGroupId}`,
    {
      cookie: fx.adminCookie,
      method: 'PUT',
      body: {
        expectedVersion: state.version,
        filterKeys: ['country', 'stage'],
        note: 'Issue 116 API acceptance',
      },
    },
  );
  assert.equal(updateResponse.status, 200);
  const update = await updateResponse.json();
  assert.equal(update.version, state.version + 1);

  const schema = await (await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  })).json();
  assert.deepEqual(schema.schema.fields.map(item => item.key), ['country', 'stage']);

  const conflict = await fx.request(
    `/api/sales-crm/filter-permissions/groups/${fx.salesGroupId}`,
    {
      cookie: fx.adminCookie,
      method: 'PUT',
      body: { expectedVersion: state.version, filterKeys: ['search'] },
    },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'FILTER_VERSION_CONFLICT');
});

test('Issue #116 administrators create only registered filter sources without implicit grants', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const before = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  const response = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      sourceKey: 'city',
      label: '所在城市',
      displayMode: 'more',
      requiredPermissions: ['view_customers'],
      pages: ['customers'],
      expectedVersion: before.version,
      note: 'Issue 116 create API acceptance',
    },
  });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.filterKey, 'city');
  assert.equal(created.definition.key, 'city');
  assert.equal(created.definition.label, '所在城市');
  assert.equal(created.version, before.version + 1);
  assert.equal(
    fx.db.prepare(`SELECT COUNT(*) count FROM permission_group_filter_grants
      WHERE filter_key='city'`).get().count,
    0,
  );
  const audit = fx.db.prepare(`SELECT action,note,version FROM filter_permission_audit
    WHERE target_type='filter_definition' AND target_id='city'`).get();
  assert.deepEqual(audit, {
    action: 'definition_created',
    note: 'Issue 116 create API acceptance',
    version: created.version,
  });

  const after = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  assert.equal(after.definitions.some(item => item.key === 'city'), true);
  assert.deepEqual(after.availableSources.map(item => item.key), []);
  const salesSchema = await (await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  })).json();
  assert.equal(salesSchema.schema.fields.some(item => item.key === 'city'), false);

  fx.db.prepare("UPDATE crm_accounts SET city='莫斯科' WHERE id='CRM-OTHER'").run();
  const grantResponse = await fx.request(
    `/api/sales-crm/filter-permissions/groups/${fx.salesGroupId}`,
    {
      cookie: fx.adminCookie,
      method: 'PUT',
      body: { expectedVersion: created.version, filterKeys: ['city'] },
    },
  );
  assert.equal(grantResponse.status, 200);
  const grantedSchema = await (await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  })).json();
  const cityField = grantedSchema.schema.fields.find(item => item.key === 'city');
  assert.ok(cityField);
  assert.equal(cityField.options.some(item => item.value === '莫斯科'), true);
  const filtered = await fx.request(
    `/api/sales-crm/accounts?filters=${encodeFilters({
      city: { operator: 'in', values: ['莫斯科'] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(filtered.status, 200);
  assert.deepEqual((await filtered.json()).rows.map(item => item.id), ['CRM-OTHER']);
});

test('Issue #116 create filter API rejects non-admin and impersonated administration', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const nonAdmin = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { sourceKey: 'city' },
  });
  assert.equal(nonAdmin.status, 403);

  fx.setUserPermissions('U-WU', { view_users: true, manage_users: true });
  await fx.startImpersonation('U-WU');
  const impersonated = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { sourceKey: 'city' },
  });
  assert.equal(impersonated.status, 403);
  assert.equal((await impersonated.json()).code, 'IMPERSONATION_ACTION_BLOCKED');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM filter_definitions WHERE filter_key='city'").get().count,
    0,
  );
});

test('Issue #116 hidden definitions remain enabled but disappear from schema and query authorization', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const before = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  const response = await fx.request(
    '/api/sales-crm/filter-permissions/definitions/country',
    {
      cookie: fx.adminCookie,
      method: 'PATCH',
      body: {
        displayMode: 'hidden',
        expectedVersion: before.version,
        note: 'hide country without disabling it',
      },
    },
  );
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.definition.enabled, true);
  assert.equal(updated.definition.displayMode, 'hidden');

  const state = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  const definition = state.definitions.find(item => item.key === 'country');
  assert.equal(definition.enabled, true);
  assert.equal(definition.displayMode, 'hidden');

  const schema = await (await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  })).json();
  assert.equal(schema.schema.fields.some(item => item.key === 'country'), false);
  const forged = await fx.request(
    `/api/sales-crm/accounts?filters=${encodeFilters({
      country: { operator: 'in', values: ['俄罗斯'] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(forged.status, 403);
  assert.equal((await forged.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue #116 administration remains restricted to a real administrator', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { view_users: true, manage_users: true });
  const managerCookie = await fx.login('wu@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: managerCookie,
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'FILTER_ADMIN_REQUIRED');
});

test('Issue #116 rejects mixed legacy and authorized export filters', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const response = await fx.request(
    `/api/sales-crm/export?filters=${encodeFilters({})}&owners=U-WU`,
    { cookie: fx.adminCookie },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Issue #116 customer list redacts contact-derived narratives and product fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts
    SET product_focus='ISSUE116-SECRET-PRODUCT',
      next_action='ISSUE116-SECRET-NEXT-ACTION'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE customer_pool
    SET products='ISSUE116-SECRET-POOL-PRODUCT',
      description='ISSUE116-SECRET-POOL-DESCRIPTION',
      deep_report='ISSUE116-SECRET-DEEP-REPORT'
    WHERE customer_id='RU-9003'`).run();
  fx.setUserPermissions('U-OTHER', { view_contacts: false });

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/customers', {
    cookie: fx.otherCookie,
  });
  assert.equal(schemaResponse.status, 200);
  const schema = await schemaResponse.json();
  const serializedSchema = JSON.stringify(schema);
  assert.doesNotMatch(serializedSchema, /产品|联系人/);
  assert.equal(schema.schema.fields.some(field =>
    ['tag_business_product', 'tag_demand_product'].includes(field.key)), false);

  const response = await fx.request('/api/sales-crm/accounts?page=1&pageSize=20', {
    cookie: fx.otherCookie,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const row = payload.rows.find(item => item.id === 'CRM-OTHER');
  assert.ok(row);
  for (const key of [
    'product_focus', 'next_action', 'description', 'master_description', 'deep_report',
  ]) {
    assert.equal(Object.hasOwn(row, key), false, key);
  }
  assert.doesNotMatch(JSON.stringify(row), /ISSUE116-SECRET/);
});

test('Issue #116 list and bootstrap expose only granted tag categories', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-28 12:00:00';
  const insertTag = fx.db.prepare(`INSERT INTO tags(name,category,color,is_preset,created_at)
    VALUES (?,?,'#2563eb',0,?)`);
  const allowedTag = insertTag.run('Issue116 系统集成商', '客户类型', now).lastInsertRowid;
  const hiddenTag = insertTag.run('Issue116 战略名单', '名单标签', now).lastInsertRowid;
  const link = fx.db.prepare(`INSERT INTO customer_tags(customer_id,tag_id,created_at)
    VALUES (?,?,?)`);
  link.run('RU-9003', allowedTag, now);
  link.run('RU-9003', hiddenTag, now);

  const state = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  await fx.request(`/api/sales-crm/filter-permissions/groups/${fx.salesGroupId}`, {
    cookie: fx.adminCookie,
    method: 'PUT',
    body: {
      expectedVersion: state.version,
      filterKeys: ['search', 'tag_customer_type'],
    },
  });

  const bootstrap = await (await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.otherCookie,
  })).json();
  const bootstrapAccount = bootstrap.accounts.find(item => item.id === 'CRM-OTHER');
  assert.deepEqual(bootstrapAccount.customerTags.map(item => item.category), ['客户类型']);

  const list = await (await fx.request('/api/sales-crm/accounts?page=1&pageSize=20', {
    cookie: fx.otherCookie,
  })).json();
  const listAccount = list.rows.find(item => item.id === 'CRM-OTHER');
  assert.deepEqual(listAccount.customerTags.map(item => item.category), ['客户类型']);

  const forbiddenTag = await fx.request(
    `/api/sales-crm/accounts?filters=${encodeFilters({
      tag_list: { operator: 'in', values: [String(hiddenTag)] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(forbiddenTag.status, 403);
  assert.equal((await forbiddenTag.json()).code, 'FILTER_NOT_AUTHORIZED');
});

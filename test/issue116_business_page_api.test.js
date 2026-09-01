'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function encodedFilters(filters) {
  return encodeURIComponent(JSON.stringify(filters));
}

test('authorized business list API dispatches every connected page with schema and pagination', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  for (const pageKey of [
    'intake', 'lead_flow', 'pipeline', 'alerts', 'insights', 'recycle_bin',
  ]) {
    const schemaResponse = await fx.request(`/api/sales-crm/filter-schema/${pageKey}`, {
      cookie: fx.adminCookie,
    });
    assert.equal(schemaResponse.status, 200, pageKey);
    const schema = (await schemaResponse.json()).schema;
    assert.equal(schema.pageKey, pageKey);
    assert.ok(schema.permissionVersion);

    const response = await fx.request(
      `/api/sales-crm/lists/${pageKey}?page=1&pageSize=20`
        + `&permissionVersion=${schema.permissionVersion}&filters=${encodedFilters({})}`,
      { cookie: fx.adminCookie },
    );
    assert.equal(response.status, 200, pageKey);
    const body = await response.json();
    assert.equal(body.schema.pageKey, pageKey);
    assert.equal(body.schema.permissionVersion, schema.permissionVersion);
    assert.equal(body.page, 1);
    assert.ok(Array.isArray(body.rows));
    assert.equal(typeof body.total, 'number');
    assert.equal(typeof body.hasMore, 'boolean');
  }
});

test('business list API validates boolean intake filters, versions, and forged fields uniformly', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const schema = (await (await fx.request('/api/sales-crm/filter-schema/intake', {
    cookie: fx.adminCookie,
  })).json()).schema;
  const websiteField = schema.fields.find(field => field.key === 'has_website');
  assert.equal(websiteField.type, 'facet');
  assert.deepEqual(websiteField.options.map(option => option.value), ['true', 'false']);

  const filtered = await fx.request(
    `/api/sales-crm/lists/intake?permissionVersion=${schema.permissionVersion}`
      + `&filters=${encodedFilters({
        has_website: { operator: 'in', values: ['true'] },
      })}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).rows.every(row => String(row.website || '').trim()), true);

  const stale = await fx.request(
    `/api/sales-crm/lists/intake?permissionVersion=0&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'FILTER_VERSION_CONFLICT');

  for (const [pageKey, filters] of [
    ['intake', { secret_intake: { operator: 'contains', value: 'secret' } }],
    ['pipeline', { secret_pipeline: { operator: 'in', values: ['secret'] } }],
  ]) {
    const response = await fx.request(
      `/api/sales-crm/lists/${pageKey}?filters=${encodedFilters(filters)}`,
      { cookie: fx.otherCookie },
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'FILTER_NOT_AUTHORIZED');
    assert.doesNotMatch(JSON.stringify(body), /secret_intake|secret_pipeline/);
  }

  const legacy = await fx.request('/api/sales-crm/lists/pipeline?country=RU', {
    cookie: fx.adminCookie,
  });
  assert.equal(legacy.status, 403);
  assert.equal((await legacy.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('recycle list accepts only authorized server-side sort presets', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='Z reason',previous_owner_id='U-WU',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 08:00:00' WHERE id='CRM-WU'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='A reason',previous_owner_id='U-MGR',recycled_by='USR-ADMIN',
    recycled_at='2026-08-06 08:00:00' WHERE id='CRM-OWN'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='manual_delete',
    recycle_reason='M reason',previous_owner_id='U-OTHER',recycled_by='USR-ADMIN',
    recycled_at='2026-08-05 12:00:00' WHERE id='CRM-OTHER'`).run();
  const schema = await fx.requestJson('/api/sales-crm/filter-schema/recycle_bin', {
    cookie: fx.adminCookie,
  });
  const sorted = await fx.requestJson(
    `/api/sales-crm/lists/recycle_bin?sort=company_asc&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(sorted.rows.map(row => row.customerId), ['CRM-OTHER', 'CRM-OWN', 'CRM-WU']);
  const invalid = await fx.request(
    `/api/sales-crm/lists/recycle_bin?sort=contact_email&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.json()).code, 'SORT_NOT_AUTHORIZED');
});

test('pipeline list accepts only authorized server-side sort presets', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare('UPDATE customer_pool SET company_name=? WHERE customer_id=?').run('Zeta Fixture', 'RU-9001');
  fx.db.prepare('UPDATE customer_pool SET company_name=? WHERE customer_id=?').run('Alpha Fixture', 'RU-9002');
  fx.db.prepare('UPDATE customer_pool SET company_name=? WHERE customer_id=?').run('Mid Fixture', 'RU-9003');
  const schema = await fx.requestJson('/api/sales-crm/filter-schema/pipeline', {
    cookie: fx.adminCookie,
  });
  const sorted = await fx.requestJson(
    `/api/sales-crm/lists/pipeline?sort=company_asc&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(sorted.rows.map(row => row.id), ['CRM-OWN', 'CRM-OTHER', 'CRM-WU']);
  const invalid = await fx.request(
    `/api/sales-crm/lists/pipeline?sort=contact_email&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.json()).code, 'SORT_NOT_AUTHORIZED');
});

test('intake list accepts only authorized server-side sort presets', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-21 08:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-ALPHA','BATCH-TEST','BR-9005','Alpha Lead','pending','',?,?),
           ('INTAKE-ZETA','BATCH-TEST','BR-9006','Zeta Lead','approved','',?,?)`).run(now, now, now, now);
  const schema = await fx.requestJson('/api/sales-crm/filter-schema/intake', {
    cookie: fx.adminCookie,
  });
  const sorted = await fx.requestJson(
    `/api/sales-crm/lists/intake?sort=company_asc&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.deepEqual(sorted.rows.map(row => row.id), ['INTAKE-ALPHA', 'INTAKE-OTHER', 'INTAKE-ZETA']);
  const invalid = await fx.request(
    `/api/sales-crm/lists/intake?sort=contact_email&permissionVersion=${schema.schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.adminCookie },
  );
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.json()).code, 'SORT_NOT_AUTHORIZED');
});

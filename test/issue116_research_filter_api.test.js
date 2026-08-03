'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function encodedFilters(filters) {
  return encodeURIComponent(JSON.stringify(filters));
}

function insertOwnedResearchRows(fx, count = 25) {
  const insert = fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,industry,customer_type,current_pool,score,
     email,phone,contact_name,contact_title,contacts_summary,opportunity_summary,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let index = 0; index < count; index += 1) {
    insert.run(
      `JOB-OTHER-${index}`,
      'RU-9003',
      `Other Fixture ${index}`,
      index % 2 ? 'Automotive' : 'Industrial',
      'Manufacturer',
      index % 2 ? 'B' : 'A',
      String(70 + index),
      `issue116-secret-${index}@example.test`,
      `+7-secret-${index}`,
      `Secret Buyer ${index}`,
      'Procurement Director',
      `issue116-secret-summary-${index}`,
      `issue116-secret-opportunity-${index}`,
      `2026-07-${String(20 + (index % 8)).padStart(2, '0')} 10:00:00`,
    );
  }
}

test('research APIs enforce authorized AST, permission version, scope, pagination, and totals', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertOwnedResearchRows(fx);
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,is_test_data,
     created_at,updated_at)
    VALUES ('CRM-TEST-RECON','RU-TEST-RECON','Test Recon','U-OTHER','qualified','claimed',1,
      '2026-07-28 10:00:00','2026-07-28 10:00:00')`).run();
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,industry,customer_type,updated_at)
    VALUES ('JOB-TEST-RECON','RU-TEST-RECON','Test Recon','Industrial','Manufacturer',
      '2026-07-28 10:00:00')`).run();

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/recon', {
    cookie: fx.otherCookie,
  });
  assert.equal(schemaResponse.status, 200);
  const schema = (await schemaResponse.json()).schema;
  assert.equal(schema.pageKey, 'recon');
  assert.ok(schema.permissionVersion);
  assert.deepEqual(
    schema.fields.map(field => field.key),
    ['search', 'current_pool', 'customer_type', 'score', 'industry', 'updated_at'],
  );
  assert.deepEqual(
    schema.fields.find(field => field.key === 'industry').options,
    [
      { value: 'Automotive', label: 'Automotive', count: 12 },
      { value: 'Industrial', label: 'Industrial', count: 13 },
    ],
  );
  assert.doesNotMatch(JSON.stringify(schema), /Owned Fixture/);

  const filters = encodedFilters({
    industry: { operator: 'in', values: ['Industrial'] },
  });
  const firstResponse = await fx.request(
    `/api/sales-crm/research/recon?page=1&pageSize=20&permissionVersion=${schema.permissionVersion}&filters=${filters}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.page, 1);
  assert.equal(first.pageSize, 50);
  assert.equal(first.total, 13);
  assert.equal(first.rows.length, 13);
  assert.equal(first.hasMore, false);
  assert.ok(first.rows.every(row => row.customer_id === 'RU-9003'));
  assert.equal(first.schema.permissionVersion, schema.permissionVersion);

  const unfiltered = await (await fx.request(
    `/api/sales-crm/research/recon?page=1&pageSize=20&permissionVersion=${schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.otherCookie },
  )).json();
  assert.equal(unfiltered.total, 26);
  assert.equal(unfiltered.rows.length, 26);
  assert.equal(unfiltered.hasMore, false);
  const second = await (await fx.request(
    `/api/sales-crm/research/recon?page=2&pageSize=20&permissionVersion=${schema.permissionVersion}&filters=${encodedFilters({})}`,
    { cookie: fx.otherCookie },
  )).json();
  assert.equal(second.total, 26);
  assert.equal(second.rows.length, 0);
  assert.equal(second.hasMore, false);
  const bootstrap = await (await fx.request('/api/sales-crm/bootstrap', {
    cookie: fx.otherCookie,
  })).json();
  assert.equal(bootstrap.researchTotals.recon, unfiltered.total);

  const stale = await fx.request(
    `/api/sales-crm/research/recon?permissionVersion=0&filters=${encodedFilters({})}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'FILTER_VERSION_CONFLICT');

  for (const forged of [
    { secret_field: { operator: 'contains', value: 'secret' } },
    { contact_level: { operator: 'in', values: ['L3'] } },
  ]) {
    const response = await fx.request(
      `/api/sales-crm/research/recon?filters=${encodedFilters(forged)}`,
      { cookie: fx.otherCookie },
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'FILTER_NOT_AUTHORIZED');
    assert.doesNotMatch(JSON.stringify(body), /secret_field|contact_level|L3/);
  }
  const legacy = await fx.request('/api/sales-crm/research/recon?industry=Industrial', {
    cookie: fx.otherCookie,
  });
  assert.equal(legacy.status, 403);
  assert.equal((await legacy.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('Recon neither searches nor returns contact-derived data without view_contacts', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  insertOwnedResearchRows(fx, 1);
  fx.db.prepare(`UPDATE recon_results SET
    email='issue116-hidden@example.test',phone='+7-hidden',contact_name='Hidden Buyer',
    contact_title='Hidden Director',contacts_summary='issue116-hidden-contact',
    opportunity_summary='issue116-hidden-opportunity',notes='issue116-hidden-notes',
    recommended_products='issue116-hidden-product',report_path='/tmp/issue116-hidden-report'
    WHERE job_id='JOB-OTHER-0'`).run();
  fx.setUserPermissions('U-OTHER', { view_contacts: false, view_recon: true });
  const cookie = await fx.login('other@example.com', 'Password123!');

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/recon', { cookie });
  assert.equal(schemaResponse.status, 200);
  const schema = (await schemaResponse.json()).schema;
  assert.doesNotMatch(JSON.stringify(schema), /联系人|机会|issue116-hidden/);

  const hiddenSearch = await fx.request(
    `/api/sales-crm/research/recon?filters=${encodedFilters({
      search: { operator: 'contains', value: 'issue116-hidden' },
    })}`,
    { cookie },
  );
  assert.equal(hiddenSearch.status, 200);
  assert.equal((await hiddenSearch.json()).total, 0);

  const visibleSearch = await fx.request(
    `/api/sales-crm/research/recon?filters=${encodedFilters({
      search: { operator: 'contains', value: 'Other Fixture 0' },
    })}`,
    { cookie },
  );
  assert.equal(visibleSearch.status, 200);
  const visible = await visibleSearch.json();
  assert.equal(visible.total, 1);
  assert.equal(visible.rows.length, 1);
  assert.doesNotMatch(JSON.stringify(visible), /issue116-hidden|Hidden Buyer|Hidden Director/);

  assert.equal((await fx.request('/api/sales-crm/research/people', { cookie })).status, 403);
  assert.equal((await fx.request('/api/sales-crm/filter-schema/contacts', { cookie })).status, 403);
});

test('contacts API uses its authorized schema and only returns the sales user data scope', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const now = '2026-07-28 10:00:00';
  fx.db.prepare(`INSERT INTO contact_recon_jobs
    (job_id,customer_id,company_name,status,created_at,updated_at)
    VALUES ('CONTACT-OTHER','RU-9003','Other Fixture','done',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,contact_recon_job_id,full_name,department,title,contact_level,
     sales_ready,first_found_at,created_at,updated_at)
    VALUES ('PERSON-OTHER','RU-9003','CONTACT-OTHER','Other Buyer','Procurement',
      'Director','L3',1,?,?,?)`).run(now, now, now);

  const schema = (await (await fx.request('/api/sales-crm/filter-schema/contacts', {
    cookie: fx.otherCookie,
  })).json()).schema;
  assert.deepEqual(
    schema.fields.map(field => field.key),
    ['search', 'contact_level', 'department', 'sales_ready', 'updated_at'],
  );
  const response = await fx.request(
    `/api/sales-crm/research/people?permissionVersion=${schema.permissionVersion}&filters=${encodedFilters({
      contact_level: { operator: 'in', values: ['L3'] },
      department: { operator: 'in', values: ['Procurement'] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 1);
  assert.equal(payload.rows[0].person_id, 'PERSON-OTHER');
  assert.equal(payload.rows[0].customer_id, 'RU-9003');
  assert.equal(payload.schema.permissionVersion, schema.permissionVersion);

  const legacy = await fx.request('/api/sales-crm/research/people?level=L3', {
    cookie: fx.otherCookie,
  });
  assert.equal(legacy.status, 403);
  assert.equal((await legacy.json()).code, 'FILTER_NOT_AUTHORIZED');
});

test('filter permission admin API lists and creates registered sources with versioning', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const stateResponse = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.deepEqual(state.availableSources.map(source => source.key), ['city']);
  assert.equal(state.availableSources[0].label, '城市');

  const createdResponse = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      expectedVersion: state.version,
      note: 'enable city through API',
      sourceKey: 'city',
      label: '所在城市',
      displayMode: 'more',
    },
  });
  assert.equal(createdResponse.status, 200);
  const created = await createdResponse.json();
  assert.equal(created.version, state.version + 1);
  assert.equal(created.definition.key, 'city');
  assert.equal(created.definition.label, '所在城市');

  const refreshed = await (await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
  })).json();
  assert.deepEqual(refreshed.availableSources, []);
  assert.ok(refreshed.definitions.some(definition => definition.key === 'city'));

  const duplicate = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { sourceKey: 'city', expectedVersion: created.version },
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'FILTER_DEFINITION_EXISTS');

  const stale = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { sourceKey: 'city', expectedVersion: state.version },
  });
  assert.equal(stale.status, 409);

  const denied = await fx.request('/api/sales-crm/filter-permissions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { sourceKey: 'city' },
  });
  assert.equal(denied.status, 403);
});

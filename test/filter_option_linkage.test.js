'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const {
  renderFilterComponent,
} = require('../sales-assets/filter-component.js');

function encodeFilters(filters) {
  return encodeURIComponent(JSON.stringify(filters));
}

function fieldOptions(schema, key) {
  return (schema.fields.find(field => field.key === key)?.options || [])
    .map(option => [option.value, Number(option.count || 0)]);
}

function seedLinkedCustomers(fx) {
  fx.db.prepare(`UPDATE crm_accounts SET country=?, industry=? WHERE id=?`)
    .run('俄罗斯', '电子制造', 'CRM-OWN');
  fx.db.prepare(`UPDATE crm_accounts SET country=?, industry=? WHERE id=?`)
    .run('德国', '工业自动化', 'CRM-OTHER');
  fx.db.prepare(`UPDATE crm_accounts SET country=?, industry=? WHERE id=?`)
    .run('俄罗斯', '电子制造', 'CRM-WU');
  fx.db.prepare(`UPDATE customer_pool SET country=?, industry=? WHERE customer_id=?`)
    .run('俄罗斯', '电子制造', 'RU-9002');
  fx.db.prepare(`UPDATE customer_pool SET country=?, industry=? WHERE customer_id=?`)
    .run('德国', '工业自动化', 'RU-9003');
  fx.db.prepare(`UPDATE customer_pool SET country=?, industry=? WHERE customer_id=?`)
    .run('俄罗斯', '电子制造', 'RU-9001');
}

test('linked schema keeps authorized fields and greys zero-count cross-field options', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedLinkedCustomers(fx);

  const open = await fx.requestJson('/api/sales-crm/filter-schema/customers', {
    cookie: fx.adminCookie,
  });
  const linked = await fx.requestJson(
    `/api/sales-crm/filter-schema/customers?filters=${encodeFilters({
      country: { operator: 'in', values: ['俄罗斯'] },
    })}`,
    { cookie: fx.adminCookie },
  );

  assert.equal(open.ok, true);
  assert.equal(linked.ok, true);
  assert.deepEqual(
    open.schema.fields.map(field => field.key),
    linked.schema.fields.map(field => field.key),
  );
  assert.equal(open.schema.permissionVersion, linked.schema.permissionVersion);

  const openIndustries = Object.fromEntries(fieldOptions(open.schema, 'industry'));
  const linkedIndustries = Object.fromEntries(fieldOptions(linked.schema, 'industry'));
  assert.ok(openIndustries['电子制造'] > 0);
  assert.ok(openIndustries['工业自动化'] > 0);
  assert.ok(linkedIndustries['电子制造'] > 0);
  assert.equal(linkedIndustries['工业自动化'], 0);
  assert.deepEqual(
    fieldOptions(open.schema, 'industry').map(([value]) => value).sort(),
    fieldOptions(linked.schema, 'industry').map(([value]) => value).sort(),
  );

  const linkedCountries = Object.fromEntries(fieldOptions(linked.schema, 'country'));
  assert.ok(linkedCountries['俄罗斯'] > 0);
  assert.ok(linkedCountries['德国'] > 0);
});

test('linked schema still rejects unauthorized filter fields', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const forged = await fx.request(
    `/api/sales-crm/filter-schema/customers?filters=${encodeFilters({
      owner: { operator: 'in', values: ['U-WU'] },
    })}`,
    { cookie: fx.otherCookie },
  );
  assert.equal(forged.status, 403);
  const body = await forged.json();
  assert.equal(body.code, 'FILTER_NOT_AUTHORIZED');
  assert.doesNotMatch(JSON.stringify(body), /owner/);
});

test('intake linked schema greys unmatched industries without dropping countries', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_intake_items SET country='俄罗斯',industry='电子制造' WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,industry,status,assigned_owner_id,created_at,updated_at)
    VALUES ('INTAKE-LINK','BATCH-TEST','LEAD-LINK','Link Industrial','德国','工业自动化','assigned','U-WU',?,?)`)
    .run('2026-07-28 09:00:00', '2026-07-28 09:00:00');

  const linked = await fx.requestJson(
    `/api/sales-crm/filter-schema/intake?filters=${encodeFilters({
      country: { operator: 'in', values: ['俄罗斯'] },
    })}`,
    { cookie: fx.adminCookie },
  );
  const industries = Object.fromEntries(fieldOptions(linked.schema, 'industry'));
  const countries = Object.fromEntries(fieldOptions(linked.schema, 'country'));
  assert.ok(industries['电子制造'] > 0);
  assert.equal(industries['工业自动化'], 0);
  assert.ok(countries['俄罗斯'] > 0);
  assert.ok(countries['德国'] > 0);
});

test('zero-count options render disabled unless already selected', () => {
  const html = renderFilterComponent({
    schema: {
      schemaVersion: 'schema-link',
      permissionVersion: 'permission-link',
      fields: [
        {
          key: 'search',
          label: '关键词',
          type: 'search',
          operator: 'contains',
          placement: 'search',
        },
        {
          key: 'industry',
          label: '行业',
          type: 'facet',
          operator: 'in',
          placement: 'facet',
          multi: true,
          options: [
            { value: 'electronics', label: '电子制造', count: 2 },
            { value: 'automation', label: '工业自动化', count: 0 },
          ],
        },
      ],
    },
    state: {
      draft: { industry: ['automation'] },
      applied: {},
    },
  });
  assert.match(
    html,
    /data-filter-value="electronics"[^>]*><span>电子制造<\/span><small>2<\/small>/,
  );
  assert.match(
    html,
    /data-filter-value="automation"[^>]*aria-pressed="true"/,
  );
  assert.doesNotMatch(
    html,
    /data-filter-value="electronics"[^>]*disabled/,
  );
  const unmatched = html.match(/data-filter-value="automation"[^>]*>/)[0];
  assert.doesNotMatch(unmatched, /disabled/);

  const empty = renderFilterComponent({
    schema: {
      schemaVersion: 'schema-link',
      permissionVersion: 'permission-link',
      fields: [
        {
          key: 'industry',
          label: '行业',
          type: 'facet',
          operator: 'in',
          placement: 'more',
          multi: true,
          options: [
            { value: 'electronics', label: '电子制造', count: 2 },
            { value: 'automation', label: '工业自动化', count: 0 },
          ],
        },
      ],
    },
    state: { draft: {}, applied: {} },
  });
  assert.match(
    empty,
    /data-filter-value="automation"[^>]*disabled/,
  );
});

test('shared filter component schedules linked option refresh from draft changes', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'filter-component.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  assert.match(js, /fetchLinkedSchema/);
  assert.match(js, /disabled/);
  assert.match(app, /fetchLinkedSchema/);
  assert.match(app, /filter-schema\/\$\{pageKey\}\?/);
});

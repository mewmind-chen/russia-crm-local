const test = require('node:test');
const assert = require('node:assert/strict');

function fieldCatalog() {
  try { return require('../lib/field_catalog'); }
  catch (_error) { return {}; }
}

function permissions(...keys) {
  return Object.fromEntries(keys.map(key => [key, true]));
}

test('unknown pageKey yields null schema', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  assert.equal(effectiveFieldSchema({
    pageKey: 'not_a_page',
    user: { role: 'admin' },
    permissions: {},
    features: {},
  }), null);
});

test('sales role cannot see source and evaluation_tags fields', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'crm_drawer',
    user: { role: 'sales' },
    permissions: permissions('view_customers'),
    features: {},
  });
  assert.ok(schema);
  const keys = schema.fields.map(field => field.key);
  assert.ok(keys.includes('owner'));
  assert.ok(keys.includes('website'));
  assert.ok(!keys.includes('source'), 'sales must not see customer source');
  assert.ok(!keys.includes('evaluation_tags'), 'sales must not see AI evaluation tags');
});

test('manager role sees source when granted, hides evaluation_tags without ai_stations', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'crm_drawer',
    user: { role: 'manager' },
    permissions: permissions('view_all_customers', 'view_customers'),
    features: {},
  });
  assert.ok(schema.fields.some(field => field.key === 'source'));
  assert.ok(!schema.fields.some(field => field.key === 'evaluation_tags'));
});

test('evaluation_tags appears only when ai_stations feature is on', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'crm_drawer',
    user: { role: 'manager' },
    permissions: permissions('view_all_customers'),
    features: { ai_stations: true },
  });
  assert.ok(schema.fields.some(field => field.key === 'evaluation_tags'));
});

test('fields are sorted by sortOrder and carry schema metadata', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'crm_drawer',
    user: { role: 'admin' },
    permissions: permissions('view_all_customers'),
    features: { ai_stations: true },
  });
  const order = schema.fields.map(field => field.key);
  assert.deepEqual(order, [...order].sort((left, right) => (
    schema.fields.find(field => field.key === left).sortOrder
    - schema.fields.find(field => field.key === right).sortOrder
  )));
  assert.equal(schema.version, 'field-schema-v1');
  assert.ok(schema.fields.every(field => typeof field.label === 'string' && field.label.length > 0));
  const website = schema.fields.find(field => field.key === 'website');
  assert.equal(website.kind, 'website');
  assert.equal(website.sourceKey, 'website');
});

test('intake hides contact fields without view_contacts', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'intake',
    user: { role: 'sales' },
    permissions: permissions('view_intake'),
    features: { ai_stations: false },
  });
  assert.ok(schema);
  const keys = schema.fields.map(field => field.key);
  assert.ok(keys.includes('company_name'));
  assert.ok(keys.includes('status'));
  assert.ok(keys.includes('assigned_owner_name'));
  assert.ok(!keys.includes('contact_name'), 'sales without view_contacts must not see contact_name');
  assert.ok(!keys.includes('contact_methods'));
  assert.ok(!keys.includes('contact_level'));
  assert.ok(!keys.includes('fit_score'), 'ai_stations off must hide fit_score');
  assert.ok(!keys.includes('fit_grade'));
});

test('intake shows contact fields with view_contacts', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'intake',
    user: { role: 'manager' },
    permissions: permissions('view_intake', 'view_contacts'),
    features: { ai_stations: false },
  });
  const keys = schema.fields.map(field => field.key);
  assert.ok(keys.includes('contact_name'));
  assert.ok(keys.includes('contact_methods'));
  assert.ok(!keys.includes('fit_score'));
  const contact = schema.fields.find(field => field.key === 'contact_methods');
  assert.equal(contact.sensitive, true);
});

test('intake shows fit fields only when ai_stations is on', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const schema = effectiveFieldSchema({
    pageKey: 'intake',
    user: { role: 'manager' },
    permissions: permissions('view_intake', 'view_contacts'),
    features: { ai_stations: true },
  });
  const keys = schema.fields.map(field => field.key);
  assert.ok(keys.includes('fit_score'));
  assert.ok(keys.includes('fit_grade'));
  assert.ok(keys.includes('readiness'));
  assert.ok(keys.includes('priority'));
});

test('lead_flow aliases the intake catalog', () => {
  const { effectiveFieldSchema } = fieldCatalog();
  const lead = effectiveFieldSchema({
    pageKey: 'lead_flow',
    user: { role: 'admin' },
    permissions: permissions('view_intake', 'view_contacts'),
    features: { ai_stations: true },
  });
  const intake = effectiveFieldSchema({
    pageKey: 'intake',
    user: { role: 'admin' },
    permissions: permissions('view_intake', 'view_contacts'),
    features: { ai_stations: true },
  });
  assert.ok(lead);
  assert.deepEqual(lead.fields.map(field => field.key), intake.fields.map(field => field.key));
});

// —— 渲染一致性：schema 驱动的列与旧权限/开关门控必须一致 ——
const { intakeColumnKeys } = require('../sales-assets/field-widget');

function schemaFor(role, keys, features) {
  const { effectiveFieldSchema } = fieldCatalog();
  return effectiveFieldSchema({
    pageKey: 'intake',
    user: { role },
    permissions: permissions(...keys),
    features,
  });
}

test('intakeColumnKeys returns null without schema (legacy fallback path)', () => {
  assert.equal(intakeColumnKeys(null), null);
  assert.equal(intakeColumnKeys({ fields: [] }), null);
});

test('intake columns match legacy gates: fit iff ai_stations, contact iff view_contacts', () => {
  const cases = [
    {
      label: 'sales without view_contacts, ai off',
      schema: schemaFor('sales', ['view_intake'], { ai_stations: false }),
      fit: false, contact: false,
    },
    {
      label: 'sales without view_contacts, ai on',
      schema: schemaFor('sales', ['view_intake'], { ai_stations: true }),
      fit: true, contact: false,
    },
    {
      label: 'manager with view_contacts, ai off',
      schema: schemaFor('manager', ['view_intake', 'view_contacts'], { ai_stations: false }),
      fit: false, contact: true,
    },
    {
      label: 'manager with view_contacts, ai on',
      schema: schemaFor('manager', ['view_intake', 'view_contacts'], { ai_stations: true }),
      fit: true, contact: true,
    },
  ];
  for (const item of cases) {
    const keys = intakeColumnKeys(item.schema);
    assert.ok(keys, item.label);
    assert.equal(keys.includes('fit'), item.fit, `${item.label}: fit column`);
    assert.equal(keys.includes('contact'), item.contact, `${item.label}: contact column`);
    for (const always of ['company', 'owner', 'status']) {
      assert.ok(keys.includes(always), `${item.label}: ${always} column must always exist`);
    }
  }
});

test('intake schema column order matches legacy render order', () => {
  const keys = intakeColumnKeys(schemaFor('manager', ['view_intake', 'view_contacts'], { ai_stations: true }));
  assert.deepEqual(keys, ['company', 'fit', 'contact', 'owner', 'status']);
});

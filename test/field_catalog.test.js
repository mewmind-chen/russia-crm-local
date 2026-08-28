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
const { intakeColumnKeys, profileSections, renderProfileFacts, PROFILE_SECTION_LABELS } = require('../sales-assets/field-widget');

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

// —— customer_profile 回归守卫：31字段/6分组/权限/section 变更即时防漏 ——
function customerProfileSchema(role, keys, features = {}) {
  const { effectiveFieldSchema } = fieldCatalog();
  return effectiveFieldSchema({ pageKey: 'customer_profile', user: { role }, permissions: permissions(...keys), features });
}

test('customer_profile admin sees 31 fields across 6 sections with expected section sizes', () => {
  const { effectiveFieldSchema, FIELDS_CATALOG } = fieldCatalog();
  const raw = FIELDS_CATALOG.customer_profile;
  assert.equal(raw.length, 31, 'customer_profile must be 31 fields');
  const bySection = raw.reduce((acc, f) => { acc[f.section] = (acc[f.section] || 0) + 1; return acc; }, {});
  assert.deepEqual(bySection, { identity_region: 8, business_profile: 6, product_focus: 2, contact_channels: 5, compliance: 2, source_record: 8 });
  const admin = effectiveFieldSchema({ pageKey: 'customer_profile', user: { role: 'admin' }, permissions: permissions('view_contacts', 'view_recon', 'view_all_customers'), features: {} });
  assert.equal(admin.fields.length, 31);
  assert.equal(admin.version, 'field-schema-v1');
  assert.ok(admin.fields.every(f => typeof f.section === 'string' && f.section.length > 0), 'section must be serialized');
  assert.ok(admin.fields.every(f => typeof f.label === 'string' && f.label.length > 0));
});

test('customer_profile hides contact_channels without view_contacts', () => {
  const without = customerProfileSchema('sales', []);
  assert.equal(without.fields.some(f => f.key === 'email'), false);
  assert.equal(without.fields.some(f => f.key === 'phone'), false);
  assert.equal(without.fields.some(f => f.key === 'contactCount'), false);
  const withContact = customerProfileSchema('sales', ['view_contacts']);
  assert.equal(withContact.fields.some(f => f.key === 'email'), true);
  assert.equal(withContact.fields.some(f => f.key === 'phone'), true);
  const email = withContact.fields.find(f => f.key === 'email');
  assert.equal(email.sensitive, true);
  assert.equal(without.fields.length, 22, 'sales without any view_* must see 22 fields');
});

test('customer_profile hides deepReport/sourceFile without view_recon and creatorName/customerSource without view_all_customers', () => {
  const base = customerProfileSchema('sales', ['view_contacts']);
  assert.equal(base.fields.some(f => f.key === 'deepReport'), false);
  assert.equal(base.fields.some(f => f.key === 'sourceFile'), false);
  assert.equal(base.fields.some(f => f.key === 'creatorName'), false);
  assert.equal(base.fields.some(f => f.key === 'customerSource'), false);
  const withRecon = customerProfileSchema('sales', ['view_contacts', 'view_recon']);
  assert.equal(withRecon.fields.some(f => f.key === 'deepReport'), true);
  assert.equal(withRecon.fields.some(f => f.key === 'sourceFile'), true);
  const withAll = customerProfileSchema('admin', ['view_contacts', 'view_recon', 'view_all_customers']);
  assert.equal(withAll.fields.some(f => f.key === 'creatorName'), true);
  assert.equal(withAll.fields.some(f => f.key === 'customerSource'), true);
});

test('customer_profile is visible in listFieldPages and profileSections groups correctly', () => {
  const { listFieldPages } = fieldCatalog();
  assert.ok(listFieldPages().includes('customer_profile'));
  const admin = customerProfileSchema('admin', ['view_contacts', 'view_recon', 'view_all_customers']);
  const sections = profileSections(admin);
  assert.equal(sections.length, 6);
  assert.deepEqual(sections.map(s => s.section), ['identity_region', 'business_profile', 'product_focus', 'contact_channels', 'compliance', 'source_record']);
  assert.deepEqual(sections.map(s => s.label), ['身份与地区', '业务画像', '产品关注', '联系渠道', '合规信息', '来源与记录']);
  sections.forEach(sec => assert.ok(PROFILE_SECTION_LABELS[sec.section], `unknown section ${sec.section}`));
  assert.equal(profileSections(null).length, 0);
  assert.equal(profileSections({ fields: [] }).length, 0);
});

test('renderProfileFacts produces 6 sections for admin and respects permission filtering', () => {
  const admin = customerProfileSchema('admin', ['view_contacts', 'view_recon', 'view_all_customers']);
  const salesRestricted = customerProfileSchema('sales', []);
  const data = { companyName: 'ACME', country: '俄罗斯', email: 'a@b.c', phone: '+7', deepReport: 'r1', creatorName: '系统导入', sanctionStatus: '未制裁', website: 'https://example.com' };
  const html = renderProfileFacts({ schema: admin, data });
  assert.match(html, /身份与地区/);
  assert.match(html, /联系渠道/);
  assert.match(html, /来源与记录/);
  assert.equal((html.match(/profile-widget-section/g) || []).length, 6);
  const htmlRestricted = renderProfileFacts({ schema: salesRestricted, data });
  assert.doesNotMatch(htmlRestricted, /a@b\.c/);
  assert.doesNotMatch(htmlRestricted, /系统导入/);
  assert.equal(renderProfileFacts({ schema: null, data }), '');
  assert.equal(renderProfileFacts({ schema: { fields: [] }, data }), '');
});

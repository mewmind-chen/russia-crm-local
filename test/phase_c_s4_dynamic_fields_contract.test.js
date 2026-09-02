'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { redactContactFields, redactContactDynamicFields } = require('../lib/access_control');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const accessSource = read('lib/access_control.js');
const dbSource = read('lib/db.js');
const salesCrmSource = read('lib/sales_crm.js');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

function parseJsonContainer(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function assertNoContactKeys(value, label) {
  const sensitiveKeys = new Set([
    'email', 'phone', 'contact', 'contactname', 'contacttitle', 'emailaddress',
    'phonenumber', 'mobilephone', 'telephone', 'tel', 'mobile', 'contactemail',
    'contactphone', 'contactinfo', 'contactdetails', 'personemail', 'personphone',
    'personalemail', 'personalphone', 'workemail', 'workphone', 'emailvalue',
    'phonevalue', 'reason', 'notes', 'summary',
  ]);
  const keys = [];
  const visit = (current, prefix = '') => {
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, `${prefix}[${index}]`));
      return;
    }
    const parsed = parseJsonContainer(current);
    if (parsed) {
      visit(parsed, prefix);
      return;
    }
    if (!current || typeof current !== 'object') return;
    Object.entries(current).forEach(([key, child]) => {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sensitiveKeys.has(normalized)) keys.push(currentPath);
      visit(child, currentPath);
    });
  };
  visit(value);
  assert.deepEqual(keys, [], `${label} leaked dynamic contact keys: ${keys.join(', ')}`);
}

test('S4/P4 account, commerce and timeline dynamic boundaries are explicit', () => {
  const recycle = functionSlice(salesCrmSource, 'buildRecycleAccountProfile', 'loadRecycleProfile');
  const timeline = functionSlice(salesCrmSource, 'buildCustomerTimeline', 'loadPayload');
  const loadPayload = functionSlice(salesCrmSource, 'loadPayload', 'getAccountForUser');
  const profile = functionSlice(dbSource, 'getCustomerProfileData', 'updateCustomer');

  // The risk is driven by SELECT * / public row spreading, not by AI. Keep
  // the resource/permission boundary first, then apply the opt-in dynamic
  // recursive rule to all account/commerce/timeline descendants.
  for (const pattern of [
    /SELECT \* FROM crm_rfqs/, /SELECT \* FROM crm_quotes/, /SELECT \* FROM crm_orders/,
    /timeline:\s*buildCustomerTimeline\(/,
    /redactContactDynamicFields\(payload\)/,
  ]) assert.match(recycle, pattern);
  assert.match(loadPayload, /SELECT a\.\*,u\.name owner_name/);
  for (const pattern of [
    /const contactSafe = payload => permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\)/,
    /contactSafe\(buildCustomerTimeline\(/,
  ]) assert.match(loadPayload, pattern);
  assert.match(profile, /return permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\);/);
  assert.match(timeline, /provenance: linkedActivity\?\.provenance \|\| null/);
  assert.match(accessSource, /function redactContactJsonText\(/);
  assert.match(accessSource, /options\.parseJsonText === true/);
  assert.match(accessSource, /function redactContactDynamicFields\(/);
});

test('dynamic contact projection recursively redacts hydrated values and JSON text', () => {
  const input = {
    safeBusinessField: 'keep',
    nested: {
      emailAddress: 'DYNAMIC-EMAIL-OBJECT',
      safe: 'keep-object',
      list: [{ phoneNumber: 'DYNAMIC-PHONE-OBJECT', safe: 7 }],
    },
    metadata_json: JSON.stringify({
      futureBusinessField: 'keep-json',
      email: 'DYNAMIC-EMAIL-JSON',
      nested: [{ mobilePhone: 'DYNAMIC-MOBILE-JSON', safe: true }],
      encoded: JSON.stringify({ contactPhone: 'DYNAMIC-PHONE-DOUBLE', safe: 'keep-encoded' }),
    }),
    malformed_json: '{"email":"DYNAMIC-MALFORMED"',
  };
  const original = structuredClone(input);
  const projected = redactContactDynamicFields(input);

  assert.equal(projected.safeBusinessField, 'keep');
  assert.equal(projected.nested.emailAddress, undefined);
  assert.equal(projected.nested.list[0].phoneNumber, undefined);
  assert.equal(projected.nested.list[0].safe, 7);
  const metadata = JSON.parse(projected.metadata_json);
  assert.equal(metadata.email, undefined);
  assert.equal(metadata.nested[0].mobilePhone, undefined);
  assert.equal(metadata.nested[0].safe, true);
  assert.equal(metadata.encoded, JSON.stringify({ safe: 'keep-encoded' }));
  assert.equal(projected.malformed_json, input.malformed_json, 'malformed JSON stays byte-for-byte');
  assert.deepEqual(input, original, 'projection must not mutate the source');
  assertNoContactKeys(projected, 'dynamic projection');

  // The legacy helper remains unchanged unless the dynamic option is opted in.
  const legacy = redactContactFields({ metadata_json: input.metadata_json });
  assert.equal(JSON.parse(legacy.metadata_json).email, 'DYNAMIC-EMAIL-JSON');
});

function seedDynamicFixtures(fx, now = '2026-09-03 10:00:00') {
  fx.db.exec(`
    ALTER TABLE crm_accounts ADD COLUMN dynamic_profile_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_activities ADD COLUMN dynamic_activity_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_rfqs ADD COLUMN dynamic_rfq_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_quotes ADD COLUMN dynamic_quote_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE crm_orders ADD COLUMN dynamic_order_json TEXT NOT NULL DEFAULT '';
  `);
  const dynamicJson = JSON.stringify({
    futureField: 'keep-dynamic-business',
    nested: [{ emailAddress: 'S4-DYNAMIC-ACCOUNT-EMAIL', safe: 'keep-account' }],
  });
  fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',recycle_kind='mismatch',
    recycle_reason='safe recycle reason',recycled_by='U-WU',recycled_at=?,previous_owner_id='U-WU',
    owner_id=NULL,assignment_status='returned',dynamic_profile_json=? WHERE id='CRM-WU'`)
    .run(now, dynamicJson);
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,summary,occurred_at,created_at,dynamic_activity_json)
    VALUES ('ACT-S4-DYNAMIC','CRM-WU','U-WU','note','safe activity',?,?,?)`)
    .run(now, now, JSON.stringify({ phoneNumber: 'S4-DYNAMIC-ACTIVITY-PHONE', safe: true }));
  fx.db.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,received_at,created_at,dynamic_rfq_json)
    VALUES ('RFQ-S4-DYNAMIC','CRM-WU','U-WU','S4-DYNAMIC-RFQ',?,?,?)`)
    .run(now, now, JSON.stringify({ contactEmail: 'S4-DYNAMIC-RFQ-EMAIL', safe: 'rfq' }));
  fx.db.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,sent_at,created_at,dynamic_quote_json)
    VALUES ('QUOTE-S4-DYNAMIC','RFQ-S4-DYNAMIC','CRM-WU','U-WU',123,?,?,?)`)
    .run(now, now, JSON.stringify({ mobilePhone: 'S4-DYNAMIC-QUOTE-PHONE', safe: 'quote' }));
  fx.db.prepare(`INSERT INTO crm_orders
    (id,customer_id,user_id,amount,ordered_at,created_at,dynamic_order_json)
    VALUES ('ORDER-S4-DYNAMIC','CRM-WU','U-WU',456,?,?,?)`)
    .run(now, now, JSON.stringify({ personEmail: 'S4-DYNAMIC-ORDER-EMAIL', safe: 'order' }));
}

test('restricted recycle/profile aggregates redact dynamic account, commerce and activity descendants', async t => {
  const fx = await adminFixture({ appOptions: { salesCrm: { aiStationsEnabled: false } } });
  t.after(() => fx.close());
  seedDynamicFixtures(fx);
  fx.setUserPermissions('U-WU', {
    manage_customer_recycle: true,
    view_contacts: false,
    view_recon: true,
    view_insights: true,
  });
  const restrictedCookie = await fx.login('wu@example.com', 'Password123!');

  const recycleResponse = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: restrictedCookie,
  });
  const recycle = await recycleResponse.json();
  assert.equal(recycleResponse.status, 200, recycle.error);
  assert.equal(recycle.account.dynamic_profile_json, JSON.stringify({
    futureField: 'keep-dynamic-business',
    nested: [{ safe: 'keep-account' }],
  }));
  assert.equal(recycle.activities.find(row => row.id === 'ACT-S4-DYNAMIC').dynamic_activity_json,
    JSON.stringify({ safe: true }));
  assert.equal(recycle.rfqs.find(row => row.id === 'RFQ-S4-DYNAMIC').dynamic_rfq_json,
    JSON.stringify({ safe: 'rfq' }));
  assert.equal(recycle.quotes.find(row => row.id === 'QUOTE-S4-DYNAMIC').dynamic_quote_json,
    JSON.stringify({ safe: 'quote' }));
  assert.equal(recycle.orders.find(row => row.id === 'ORDER-S4-DYNAMIC').dynamic_order_json,
    JSON.stringify({ safe: 'order' }));
  assertNoContactKeys(recycle, 'restricted recycle profile');
  assert.doesNotMatch(JSON.stringify(recycle), /S4-DYNAMIC-(?:ACCOUNT-EMAIL|ACTIVITY-PHONE|RFQ-EMAIL|QUOTE-PHONE|ORDER-EMAIL)/);

  // The general bootstrap path contains the same raw activity/commerce rows;
  // the dynamic boundary must hold there too without exposing AI-only data.
  const initialResponse = await fx.request('/api/initial', { cookie: restrictedCookie });
  const initial = await initialResponse.json();
  assert.equal(initialResponse.status, 200, initial.error);
  assert.doesNotMatch(JSON.stringify(initial), /S4-DYNAMIC-(?:ACCOUNT-EMAIL|ACTIVITY-PHONE|RFQ-EMAIL|QUOTE-PHONE|ORDER-EMAIL)/);
});

test('authorized recycle profile preserves dynamic JSON text byte-for-byte', async t => {
  const fx = await adminFixture({ appOptions: { salesCrm: { aiStationsEnabled: false } } });
  t.after(() => fx.close());
  seedDynamicFixtures(fx);

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU/recycle-profile', {
    cookie: fx.adminCookie,
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.account.dynamic_profile_json.includes('S4-DYNAMIC-ACCOUNT-EMAIL'), true);
  assert.equal(body.activities.find(row => row.id === 'ACT-S4-DYNAMIC').dynamic_activity_json.includes('S4-DYNAMIC-ACTIVITY-PHONE'), true);
  assert.equal(body.rfqs.find(row => row.id === 'RFQ-S4-DYNAMIC').dynamic_rfq_json.includes('S4-DYNAMIC-RFQ-EMAIL'), true);
  assert.equal(body.quotes.find(row => row.id === 'QUOTE-S4-DYNAMIC').dynamic_quote_json.includes('S4-DYNAMIC-QUOTE-PHONE'), true);
  assert.equal(body.orders.find(row => row.id === 'ORDER-S4-DYNAMIC').dynamic_order_json.includes('S4-DYNAMIC-ORDER-EMAIL'), true);
});

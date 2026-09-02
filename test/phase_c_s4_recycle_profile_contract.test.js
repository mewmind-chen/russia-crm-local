'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const salesCrmSource = read('lib/sales_crm.js');
const dbSource = read('lib/db.js');
const accountRoutesSource = read('lib/sales_crm_account_routes.js');
const accessControlSource = read('lib/access_control.js');
const designSource = read('docs/governance/PHASE_C_AGGREGATE_WHITELIST_DESIGN.md');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

test('S4/P4 profile and recycle payloads keep every shape in an explicit assembly boundary', () => {
  const profile = functionSlice(dbSource, 'getCustomerProfileData', 'updateCustomer');
  const recycle = functionSlice(salesCrmSource, 'buildRecycleAccountProfile', 'loadRecycleProfile');
  const recycleLoader = functionSlice(salesCrmSource, 'loadRecycleProfile', 'mismatchAccountDto');

  // Shared profile leaves remain explicit and are not replaced by a generic
  // top-level copy: customer rows, pool/recon rows and contact-heavy sources
  // each have their own projection or source permission gate.
  assert.match(profile, /legacyCustomers[\s\S]*\.map\(row => \(\{ \.\.\.buildCustomer\(row\), tags: profileTags \}\)\)/);
  assert.match(profile, /const customers = permissions\.view_contacts\s*\?/);
  assert.match(profile, /legacyCustomers\.map\(contactSafeCustomerRecord\)/);
  assert.match(profile, /reconResults = reconResults\.map\(contactSafeReconRecord\)/);
  assert.match(profile, /const contactReconJobs = permissions\.view_contacts/);
  assert.match(profile, /const people = permissions\.view_contacts/);
  assert.match(profile, /profileAccess\s*:/);

  // Recycle profile is a deliberate composite of master profile, account,
  // activity, commerce, timeline, insights, audit and action state.
  assert.match(recycle, /masterProfile = getCustomerProfileData\(/);
  for (const pattern of [
    /account\s*,/, /activities\s*,/, /rfqs\s*,/, /quotes\s*,/, /orders\s*,/,
    /timeline\s*:/, /insights\s*:/, /auditLog\s*,/, /recycle\s*:/,
    /profileAccess\s*:/, /actions\s*:/,
  ]) assert.match(recycle, pattern, `recycle payload missing ${pattern}`);
  assert.match(recycle, /return hasPermission\(user, 'view_contacts'\) \? payload : redactContactFields\(payload\);/);

  // The loader is a separate authorization boundary and delegates only after
  // live recycle scope/lifecycle validation.
  assert.match(recycleLoader, /assertPermission\(user, 'manage_customer_recycle'\)/);
  assert.match(recycleLoader, /const account = findRecycleAccount\(value, user, customerId\)/);
  assert.match(recycleLoader, /RECYCLED_CUSTOMER_NOT_FOUND/);
  assert.match(recycleLoader, /RECYCLED_CUSTOMER_FORBIDDEN/);
  assert.match(recycleLoader, /return buildRecycleAccountProfile\(value, user, account, options\)/);
});

test('S4/P4 permission and read-only gates remain explicit for sales, manager and admin shapes', () => {
  const recycle = functionSlice(salesCrmSource, 'buildRecycleAccountProfile', 'loadRecycleProfile');

  // Recycle records are always read-only; actions are advertised only after
  // the same role/permission/impersonation checks used by the existing route.
  assert.match(recycle, /readOnly:\s*true/);
  assert.match(recycle, /const canRestore = account\.recycle_kind === 'manual_delete'/);
  assert.match(recycle, /hasPermission\(user, 'manage_manual_customer_deletion'\)/);
  assert.match(recycle, /!options\.isImpersonating/);
  assert.match(recycle, /const canReassign = \['sales_return', 'mismatch'\]\.includes\(account\.recycle_kind\)/);
  assert.match(recycle, /contacts: hasPermission\(user, 'view_contacts'\) \? loadedInsights\.contacts : \[\]/);
  assert.match(recycle, /evaluations: hasPermission\(user, 'view_insights'\) \? evaluations : \[\]/);

  // The public account route preserves no-store semantics and the same
  // `loadRecycleProfile` authorization boundary for every role.
  assert.match(accountRoutesSource, /app\.get\('\/api\/sales-crm\/accounts\/:customerId\/recycle-profile'/);
  assert.match(accountRoutesSource, /loadRecycleProfile\(req\.salesUser, req\.params\.customerId/);
  assert.match(accountRoutesSource, /Cache-Control', 'private, no-store/);
  assert.match(salesCrmSource, /app\.get\('\/api\/sales-crm\/profile\/:customerId'/);
  assert.match(salesCrmSource, /getCustomerProfileData\(/);
});

test('S4/P4 leaf projections remain blacklist-equivalent for flat contact-safe shapes', () => {
  const {
    redactContactFields,
    contactSafeActivityRecord,
    contactSafeCommerceRecord,
    contactSafeTimelineRecord,
    contactSafeAuditLogRecord,
    contactSafeInsightsRecord,
  } = require('../lib/access_control');

  const cases = [
    {
      name: 'activity',
      project: contactSafeActivityRecord,
      row: { id: 'ACT-S4', customerId: 'CRM-S4', activityType: 'call', occurredAt: '2026-09-02', email: 'hidden@example.test' },
    },
    {
      name: 'commerce',
      project: contactSafeCommerceRecord,
      row: { id: 'RFQ-S4', customerId: 'CRM-S4', reference: 'S4-RFQ', amount: 100, currency: 'USD', summary: 'hidden narrative' },
    },
    {
      name: 'timeline',
      project: contactSafeTimelineRecord,
      row: { id: 'activity:ACT-S4', customerId: 'CRM-S4', kind: 'activity', actorName: 'Wu', summary: 'hidden narrative' },
    },
    {
      name: 'audit',
      project: contactSafeAuditLogRecord,
      row: { id: 'AUD-S4', entityId: 'CRM-S4', userId: 'U-WU', action: 'hidden audit copy' },
    },
    {
      name: 'insights',
      project: contactSafeInsightsRecord,
      row: { customerId: 'RU-S4', companyName: 'S4 Fixture', subjectType: 'company', evaluationCount: 1, evaluationText: 'hidden evaluation' },
    },
  ];

  for (const { name, project, row } of cases) {
    const original = structuredClone(row);
    assert.deepEqual(project(row), redactContactFields(row), `${name} projection diverged from recursive boundary`);
    assert.deepEqual(row, original, `${name} source row must remain available to callers`);
  }
});

test('S4 migration gate keeps the high-coupled composite on recursive redaction until a full proof exists', () => {
  assert.doesNotMatch(accessControlSource, /contactSafeRecycleProfilePayload/);
  assert.match(designSource, /S4 recycle-profile、S6 bootstrap 和 P1\/P3[\s\S]*逐形状结构\/等价\/嵌套泄漏契约/);
  assert.match(designSource, /S4 recycle-profile、S6 bootstrap 和 P1\/P3[\s\S]*不能由本轮审计自动开启/);
  assert.match(designSource, /S4 收尾|S4 recycle-profile/);
});

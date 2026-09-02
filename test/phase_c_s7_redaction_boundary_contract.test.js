'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const salesCrmSource = read('lib/sales_crm.js');
const dbSource = read('lib/db.js');
const readRoutesSource = read('lib/sales_crm_read_routes.js');
const businessFiltersSource = read('lib/business_page_filters.js');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

test('S7 redaction inventory has explicit decisions for every remaining production call shape', () => {
  const initialData = functionSlice(dbSource, 'getInitialData', 'profileEvaluationTags');
  const customerProfile = functionSlice(dbSource, 'getCustomerProfileData', 'updateCustomer');
  const loadPayload = functionSlice(salesCrmSource, 'loadPayload', 'getAccountForUser');
  const recycleProfile = functionSlice(salesCrmSource, 'buildRecycleAccountProfile', 'loadRecycleProfile');
  const exportBody = functionSlice(salesCrmSource, 'exportCrmData', 'exportCrmCsv');

  // P1/P3 intake: the route and bootstrap use the dedicated recursive helper;
  // no top-level whitelist is substituted for the nested aggregate.
  assert.match(loadPayload, /const contactSafeIntake = payload => permissions\.view_contacts \? payload : redactIntakeAggregate\(payload\);/);
  assert.match(readRoutesSource, /typeof redactIntakeAggregate === 'function'[\s\S]*redactIntakeAggregate\(payload\)/);
  assert.match(salesCrmSource, /registerSalesCrmIntakeResearchRoutes\(app, \{[\s\S]*redactIntakeAggregate,/);

  // P2 bootstrap and the shared profile shape stay as high-coupled outer
  // aggregates, while their already-safe leaf rows keep their projections and
  // source permission gates.
  assert.match(initialData, /const visibleCustomers = permissions\.view_contacts\s*\?/);
  assert.match(initialData, /customers\.map\(contactSafeCustomerRecord\)/);
  assert.match(initialData, /customerPool = customerPool\.map\(contactSafePoolRecord\)/);
  assert.match(initialData, /reconResults = reconResults\.map\(contactSafeReconRecord\)/);
  assert.match(initialData, /const contactReconJobs = permissions\.view_contacts/);
  assert.match(initialData, /const people = permissions\.view_contacts/);
  assert.match(initialData, /return permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\);/);
  assert.match(customerProfile, /legacyCustomers\.map\(contactSafeCustomerRecord\)/);
  assert.match(customerProfile, /reconResults = reconResults\.map\(contactSafeReconRecord\)/);
  assert.match(customerProfile, /const contactReconJobs = permissions\.view_contacts/);
  assert.match(customerProfile, /const people = permissions\.view_contacts/);
  assert.match(customerProfile, /return permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\);/);

  // P4 recycle profile composes master profile, account, activity, commerce,
  // timeline, insight, audit and action state; it remains one high-coupled
  // boundary rather than an unsafe top-level value-copy whitelist.
  assert.match(recycleProfile, /masterProfile = getCustomerProfileData\(/);
  for (const key of ['account', 'activities', 'rfqs', 'quotes', 'orders', 'timeline', 'insights', 'auditLog', 'recycle', 'profileAccess']) {
    assert.match(recycleProfile, new RegExp(`\\b${key}\\s*[:,]`), `recycle profile missing ${key} shape`);
  }
  assert.match(recycleProfile, /return hasPermission\(user, 'view_contacts'\) \? payload : redactContactDynamicFields\(payload\);/);

  // S5 is the sole remaining specialized export boundary: contact projection
  // runs first, followed by the credential projection for every role/format.
  assert.match(exportBody, /const contactSafePayload = contactsAllowed \? payload : redactContactDynamicFields\(payload\);/);
  assert.match(exportBody, /return redactExportCredentials\(contactSafePayload\);/);
});

test('S7 standalone list candidates use shape-specific permission and redaction projections', () => {
  const listCustomerAccounts = functionSlice(salesCrmSource, 'listCustomerAccounts', 'loadPayload');
  const loadResearchPage = functionSlice(salesCrmSource, 'loadResearchPage', 'buildAccountHistory');
  const listPipeline = functionSlice(businessFiltersSource, 'listPipelineRows', 'scopedAccounts');
  const listAlerts = functionSlice(businessFiltersSource, 'listTodayTasks', 'insightCte');
  const listInsights = functionSlice(businessFiltersSource, 'listManagerEvaluationCustomers', 'listRecycleRows');
  const listNotifications = functionSlice(businessFiltersSource, 'listNotificationRows', 'businessFilterOptions');

  assert.match(listCustomerAccounts, /contactSafeAccountRecord/);
  assert.doesNotMatch(listCustomerAccounts, /redactContactFields\(/);
  assert.match(loadResearchPage, /kind === 'pool'[\s\S]*contactSafePoolRecord/);
  assert.match(loadResearchPage, /kind === 'recon'[\s\S]*contactSafeReconRecord/);
  assert.match(loadResearchPage, /requiredPermission = \{[\s\S]*people: permissions\.view_contacts/);
  assert.doesNotMatch(loadResearchPage, /redactContactFields\(/);
  assert.match(listPipeline, /contactSafePipelineRecord/);
  assert.doesNotMatch(listPipeline, /redactContactFields\(/);
  assert.match(listAlerts, /contactSafeAlertsRecord/);
  assert.doesNotMatch(listAlerts, /redactContactFields\(/);
  assert.match(listInsights, /contactSafeInsightsRecord/);
  assert.doesNotMatch(listInsights, /redactContactFields\(/);
  assert.match(listNotifications, /contactSafeNotificationRecord/);
  assert.doesNotMatch(listNotifications, /redactContactFields\(/);
});

test('S7 marks AI redaction callsites as frozen and excludes them from migration', () => {
  const assistantSource = read('lib/assistant.js');
  const taskCenterSource = read('lib/ai_stations/task_center.js');
  assert.match(assistantSource, /!accessContext\.permissions\?\.view_contacts\) return redactContactFields\(result\)/);
  assert.match(taskCenterSource, /accessContext\.permissions\.view_contacts \? rawResult\.value : redactContactFields\(rawResult\.value\)/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixtures = require('./helpers/permission_fixture');

const appPath = path.join(__dirname, '..', 'sales-assets', 'app.js');
const htmlPath = path.join(__dirname, '..', 'sales-crm.html');
const source = fs.readFileSync(appPath, 'utf8');

function dateHelpers(timezone) {
  const start = source.indexOf('function businessTimezone()');
  const end = source.indexOf('function stageLabel(', start);
  assert.ok(start >= 0 && end > start, 'business date helper block must remain discoverable');
  const context = {
    Date,
    Intl,
    state: { data: { businessTimezone: timezone } },
  };
  vm.runInNewContext(`${source.slice(start, end)};helpers={
    businessTimezone,businessDateInput,shortDate,storedPlanDateInputWithBasis,
    storedPlanDateLabel,suggestedPlanDateInput
  };`, context);
  return context.helpers;
}

test('business date helpers round-trip UTC storage and preserve unmarked legacy wall time', () => {
  const helpers = dateHelpers('Asia/Shanghai');
  assert.equal(helpers.businessTimezone(), 'Asia/Shanghai');
  assert.equal(helpers.businessDateInput(new Date('2099-08-02T01:30:00Z')),
    '2099-08-02T09:30');
  assert.equal(helpers.storedPlanDateInputWithBasis('2099-08-02 01:30:00', 'utc'),
    '2099-08-02T09:30');
  assert.equal(helpers.storedPlanDateInputWithBasis('2099-08-02 09:30:00', ''),
    '2099-08-02T09:30');
  assert.match(helpers.storedPlanDateLabel('2099-08-02 01:30:00', 'utc'), /09:30/);
  assert.match(helpers.storedPlanDateLabel('2099-08-02 09:30:00', ''), /09:30/);
});

test('AI datetime-local values normalize local, Z, and offset forms exactly once', () => {
  const helpers = dateHelpers('Asia/Shanghai');
  assert.equal(helpers.suggestedPlanDateInput('2099-07-28 09:00:00'),
    '2099-07-28T09:00');
  assert.equal(helpers.suggestedPlanDateInput('2099-07-28T01:00:00Z'),
    '2099-07-28T09:00');
  assert.equal(helpers.suggestedPlanDateInput('2099-07-28T09:00:00+08:00'),
    '2099-07-28T09:00');
  assert.equal(helpers.suggestedPlanDateInput('not-a-date'), '');
});

test('invalid bootstrap timezone falls back safely in the browser helpers', () => {
  const helpers = dateHelpers('Not/A-Timezone');
  assert.equal(helpers.businessTimezone(), 'Asia/Shanghai');
  assert.equal(helpers.businessDateInput(new Date('2099-08-02T01:30:00Z')),
    '2099-08-02T09:30');
});

test('server rejects an invalid CRM business timezone before exposing bootstrap data', async t => {
  const previous = process.env.CRM_BUSINESS_TIMEZONE;
  process.env.CRM_BUSINESS_TIMEZONE = 'Not/A-Timezone';
  const fx = await fixtures.adminFixture();
  t.after(async () => {
    await fx.close();
    if (previous === undefined) delete process.env.CRM_BUSINESS_TIMEZONE;
    else process.env.CRM_BUSINESS_TIMEZONE = previous;
  });
  const response = await fx.request('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, '业务时区配置无效');
});

test('plan UI uses basis-aware conversion, AI normalization, and the current JS cache key', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(source, /function storedPlanDateInputWithBasis\(value, basis\)/);
  assert.match(source, /suggestedPlanDateInput\(value\.nextActionAt\)/);
  assert.match(source, /历史时间待确认/);
  const nextActionModule = html.indexOf('/sales-assets/next-action-time.js?v=');
  const appModule = html.indexOf('/sales-assets/app.js?v=');
  assert.ok(nextActionModule >= 0 && nextActionModule < appModule);
  assert.match(html, /sales-assets\/app\.js\?v=20260815-issue306-identity-workbench/);
  assert.match(html, /sales-assets\/app\.css\?v=20260815-issue306-identity-workbench/);
});

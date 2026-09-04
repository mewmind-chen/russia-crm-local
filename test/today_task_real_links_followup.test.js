'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function block(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing ${end}`);
  return source.slice(startAt, endAt);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

test('today-task customer and lead names produce real source-preserving detail links', () => {
  const helper = block(app, 'function todayTaskCustomerMarkup(item, account, view = \'alerts\')', 'function renderTodayTaskMobileCard(item, account)');
  const todayTaskCustomerMarkup = Function(
    'accountDisplayName',
    'esc',
    'intakeDrawerHref',
    'customerDrawerHref',
    `${helper}; return todayTaskCustomerMarkup;`,
  )(
    value => value?.externalCustomerId || value?.companyName || '—',
    escapeHtml,
    (id, view) => `/?intake=${encodeURIComponent(id)}#${view}`,
    (id, view) => `/?customer=${encodeURIComponent(id)}#${view}`,
  );

  const customer = todayTaskCustomerMarkup(
    { customerId: 'CRM-0001' },
    { externalCustomerId: 'RU-0001' },
  );
  assert.match(customer, /^<a class="today-task-customer-link tp-company-anchor internal-detail-link" href="\/\?customer=CRM-0001#alerts" data-open-customer="CRM-0001">RU-0001<\/a>$/);
  assert.doesNotMatch(customer, /<article|<button/);

  const lead = todayTaskCustomerMarkup(
    { intakeItemId: 'INT-0001', companyName: '待领取线索' },
    undefined,
  );
  assert.match(lead, /^<a class="today-task-customer-link tp-company-anchor internal-detail-link" href="\/\?intake=INT-0001#alerts" data-intake-profile="INT-0001">待领取线索<\/a>$/);
  assert.doesNotMatch(lead, /<article|<button/);
});
test('today-task desktop and mobile surfaces link only the name, leaving actions outside the link', () => {
  const mobile = block(app, 'function renderTodayTaskMobileCard(item, account)', 'function todayTaskActionMarkup(item)');
  const desktop = block(app, 'function renderAlerts()', 'function notificationAccount');
  assert.match(mobile, /<article class="today-task-mobile-card"/);
  assert.match(mobile, /todayTaskCustomerMarkup\(item, account\)/);
  assert.match(mobile, /<div class="today-task-mobile-action">\${todayTaskActionMarkup\(item\)}<\/div>/);
  assert.match(desktop, /company: `<div class="company-cell">\${todayTaskCustomerMarkup\(item, account\)\}/);
  assert.match(desktop, /actions: todayTaskActionMarkup\(item\)/);
});

test('plain clicks use the SPA handler while modified clicks remain browser-native', () => {
  const click = block(app, 'function isPlainPrimaryClick(event)', 'function handleInternalNavigationClick(event)');
  const isPlainPrimaryClick = Function(`${click}; return isPlainPrimaryClick;`)();
  assert.equal(isPlainPrimaryClick({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), true);
  for (const event of [
    { button: 1, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
    { button: 0, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
    { button: 0, ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
    { button: 0, ctrlKey: false, metaKey: false, shiftKey: true, altKey: false },
  ]) assert.equal(isPlainPrimaryClick(event), false);
});

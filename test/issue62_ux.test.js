'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');
const backend = fs.readFileSync(path.join(__dirname, '..', 'lib', 'sales_crm.js'), 'utf8');
const access = fs.readFileSync(path.join(__dirname, '..', 'lib', 'access_control.js'), 'utf8');

test('Issue #62 funnel drill-down remains while unified pool defaults to all', () => {
  assert.match(js, /到达过该阶段的客户数/);
  assert.match(js, /stageReached/);
  assert.doesNotMatch(js, /salesLanding/);
  assert.match(js, /canonicalView === 'pool' \? '' : state\.intakeStatus/);
  assert.match(js, /navIntakeLabel/);
});

test('Issue #62 intake is searchable, paginated and permission routed server-side', () => {
  assert.match(html, /id="intakeSearch"/);
  assert.match(html, /id="intakePagination"/);
  assert.match(js, /\/api\/sales-crm\/intake\?/);
  assert.match(js, /state\.intakeHasMore/);
  assert.match(backend, /app\.get\(['"]\/api\/sales-crm\/intake/);
  assert.match(access, /GET \/intake.*view_intake/);
});

test('Issue #62 export and bulk assignment expose safe user confirmation and filtered CSV', () => {
  assert.match(js, /format: 'csv'/);
  assert.match(js, /openBulkCustomerAssignmentModal/);
  assert.match(js, /id="bulkCustomerAssignForm"/);
  assert.match(backend, /text\/csv; charset=utf-8/);
  assert.match(backend, /dataset === 'activities' \? 'activities' : 'customers'/);
  assert.match(backend, /\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.csv/);
  assert.match(backend, /function exportCrmCsv/);
});

test('Issue #62 profile keeps one AI entry and a direct follow-up action', () => {
  assert.match(html, /id="customerProfileActivity"/);
  assert.match(js, /assistant=0/);
  assert.match(js, /customerProfileActivity/);
});

test('Issue #62 navigation restores browser history and mobile affordances', () => {
  assert.match(js, /history\.pushState\(null, '', `#\$\{canonicalView\}`\)/);
  assert.match(js, /history\.replaceState\(null, '', `#\$\{canonicalView\}`\)/);
  assert.match(js, /window\.scrollTo\?\.\(0, 0\)/);
  assert.match(html, /href="#dashboard"/);
  assert.match(css, /左右滑动查看更多/);
  assert.match(css, /position:sticky;bottom:0/);
});

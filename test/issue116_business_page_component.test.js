'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('six remaining business lists mount the shared authorized filter component', () => {
  for (const id of [
    'intakeAuthorizedFilters',
    'pipelineAuthorizedFilters',
    'alertsAuthorizedFilters',
    'insightsAuthorizedFilters',
    'recycleAuthorizedFilters',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(html, /data-authorized-intake-page|intakeAuthorizedPageTabs/);
  for (const pageKey of [
    'intake', 'pipeline', 'alerts', 'insights', 'recycle_bin',
  ]) {
    assert.match(app, new RegExp(`${pageKey}: \\{`), pageKey);
  }
  assert.match(app, /function initializeAuthorizedBusinessFilters\(pageKey/);
  assert.match(app, /function loadAuthorizedBusinessPage\(pageKey/);
  assert.match(app, /createFilterController\(\{/);
  assert.match(app, /const endpoint = config\.endpoint \|\| `\/lists\/\$\{pageKey\}`/);
  assert.match(app, /await api\(`\$\{endpoint\}\?\$\{params\}`/);
});

test('authorized business lists have independent pagination, version conflict, and stale response state', () => {
  assert.match(app, /authorizedBusinessLists: Object\.fromEntries/);
  assert.match(app, /requestEpoch: 0, initializeEpoch: 0/);
  assert.match(app, /permissionVersion: String\(payload\.permissionVersion/);
  assert.match(app, /requestEpoch !== meta\.requestEpoch/);
  assert.match(app, /error\.code === 'FILTER_VERSION_CONFLICT'/);
  assert.match(app, /loadAuthorizedBusinessPage\(pageKey, \{ reset: true \}\)/);
  assert.match(app, /renderPagination\(config\?\.pagination/);
  assert.doesNotMatch(app, /data-load-business-page/);
});

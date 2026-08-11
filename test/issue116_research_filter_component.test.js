'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

test('contacts and Recon mount the shared authorized filter component', () => {
  for (const id of ['peopleAuthorizedFilters', 'reconAuthorizedFilters']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-live="polite"`));
  }
  for (const obsoleteId of ['peopleSearch', 'peopleLevelFilter', 'reconSearch']) {
    assert.doesNotMatch(html, new RegExp(`id="${obsoleteId}"`));
  }

  assert.match(js, /contacts:\s*\{\s*pageKey:\s*'contacts'/);
  assert.match(js, /endpointKind:\s*'people'/);
  assert.match(js, /recon:\s*\{\s*pageKey:\s*'recon'/);
  assert.match(js, /createFilterController\(\{\s*pageKey:\s*config\.pageKey/);
  assert.match(js, /mountFilterComponent\(root/);
});

test('research filtering is server-side, versioned, paginated and stale-response safe', () => {
  const start = js.indexOf('async function loadResearch(');
  const end = js.indexOf('async function initializeResearchFilters(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = js.slice(start, end);

  assert.match(source, /meta\.filterController\.serialize\('applied'\)/);
  assert.match(source, /permissionVersion:\s*String\(payload\.permissionVersion/);
  assert.match(source, /filters:\s*JSON\.stringify\(componentPayloadToRaw\(payload\)\)/);
  assert.match(source, /page:\s*String\(reset \? 1 : Math\.max\(1, Number\(page \|\| meta\.page \|\| 1\)\)\)/);
  assert.doesNotMatch(source, /meta\.page\s*\+\s*1/);
  assert.match(source, /\/api\/sales-crm\/research\/\$\{config\.endpointKind\}/);
  assert.match(source, /const requestEpoch = \+\+meta\.requestEpoch/);
  assert.match(source, /requestEpoch !== meta\.requestEpoch/);
  assert.match(source, /FILTER_VERSION_CONFLICT/);
  assert.match(source, /meta\.filterMount\?\.setResultMeta\(\{\s*total:\s*meta\.total/);
  assert.match(source, /meta\.error\s*=\s*error\.message/);
  assert.doesNotMatch(source, /researchQuery|peopleSearch|peopleLevelFilter|reconSearch/);
});

test('research initialization invalidates stale permission state and stale schema responses', () => {
  const start = js.indexOf('function invalidateStaleResearchFilterState(');
  const end = js.indexOf('function researchLoading(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = js.slice(start, end);

  assert.match(source, /saved\.permissionVersion/);
  assert.match(source, /schema\.permissionVersion/);
  assert.match(source, /removeItem\(storageKey\)/);
  assert.match(source, /const initializeEpoch = \+\+meta\.initializeEpoch/);
  assert.match(source, /initializeEpoch !== meta\.initializeEpoch/);
  assert.match(source, /meta\.initializing && !force/);
  assert.match(source, /state\.data\[config\.dataKey\] = \[\]/);
  assert.match(source, /data-retry-research-schema/);
});

test('research pages expose retry, empty, and 390px-safe host layout states', () => {
  const start = js.indexOf('function researchLoading(');
  const end = js.indexOf('function renderUnifiedPeople(', start);
  const source = js.slice(start, end);
  assert.match(source, /meta\.error && !meta\.loaded/);
  assert.match(source, /data-retry-research/);
  assert.match(js, /closest\('\[data-retry-research\]'\)/);
  assert.match(js, /closest\('\[data-retry-research-schema\]'\)/);
  assert.match(css, /\.authorized-filter-host\s*\{/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /\.authorized-filter-host\{margin-right:-12px;margin-left:-12px\}/);
  assert.match(html, /app\.js\?v=20260811-issue275-master-profile-form/);
  assert.match(html, /app\.css\?v=20260811-issue275-master-profile-form/);
});

test('research navigation uses canonical page keys and exposes only permission-scoped entries', () => {
  assert.match(html, /data-view="contacts" data-permission="view_contacts"/);
  assert.match(html, /data-view="recon" data-permission="view_recon"/);
  assert.match(html, /data-pagination="contacts"/);
  assert.match(html, /data-pagination="recon"/);
  assert.doesNotMatch(html, /data-load-research/);
  assert.match(js, /state\.research\.contacts\.total/);
  assert.doesNotMatch(js, /state\.research\.people/);
});

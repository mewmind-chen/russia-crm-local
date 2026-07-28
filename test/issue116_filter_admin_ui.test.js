'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

function functionSlice(functionName, nextFunctionName) {
  const start = js.indexOf(`function ${functionName}(`);
  const end = js.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return js.slice(start, end);
}

test('filter permission panel exposes creation only when the server reports available sources', () => {
  assert.match(html, /id="newFilterDefinitionBtn"[^>]*disabled/);
  assert.equal(html.split('id="newFilterDefinitionBtn"').length - 1, 1);
  const renderSource = functionSlice('renderFilterPermissionAdmin', 'loadFilterPermissionAdmin');
  assert.match(renderSource, /syncNewFilterDefinitionButton\(admin\)/);

  const syncSource = functionSlice('syncNewFilterDefinitionButton', 'syncFilterPermissionTargets');
  assert.match(syncSource, /admin\?\.availableSources \|\| \[\]/);
  assert.match(syncSource, /button\.disabled = !admin \|\| Boolean\(state\.data\.impersonation\) \|\| !available\.length/);
});

test('create dialog is driven by server source constraints and uses Chinese display labels', () => {
  const source = functionSlice('syncFilterDefinitionSourceFields', 'openFilterDefinitionCreator');
  assert.match(source, /state\.filterPermissionAdmin\?\.availableSources/);
  assert.match(source, /form\.elements\.label\.value = source\.label/);
  assert.match(source, /form\.elements\.displayMode\.value = source\.displayMode/);
  assert.match(source, /data-source-type/);
  assert.match(source, /data-source-operators/);
  assert.match(source, /data-source-pages/);
  assert.match(source, /data-source-permissions/);

  const creator = functionSlice('openFilterDefinitionCreator', 'openCustomer');
  assert.match(creator, /id="filterDefinitionCreateForm"/);
  assert.match(creator, /id="filterDefinitionSource" name="sourceKey"/);
  assert.match(creator, /syncFilterDefinitionSourceFields\(\)/);
  assert.match(js, /filterDefinitionSource'\) syncFilterDefinitionSourceFields\(\)/);
  assert.match(js, /horizontal: '横向筛选'/);
  assert.match(js, /more: '更多筛选'/);
  assert.match(js, /date_range: '日期范围'/);
  assert.match(js, /hidden: '不显示'/);
  assert.match(js, /filterDisplayModeOptions\(definition\.displayMode\)/);
});

test('create submission posts the current version and exposes pending, error and conflict recovery states', () => {
  const start = js.indexOf("form.id === 'filterDefinitionCreateForm'");
  const end = js.indexOf("form.id === 'adminPasswordResetForm'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = js.slice(start, end);

  assert.match(source, /submitButton\.disabled = true/);
  assert.match(source, /submitButton\.textContent = '正在创建…'/);
  assert.match(source, /await api\('\/filter-permissions', \{\s*method: 'POST'/);
  assert.match(source, /expectedVersion: state\.filterPermissionAdmin\?\.version/);
  assert.match(source, /sourceKey: payload\.sourceKey/);
  assert.match(source, /enabled: Boolean\(payload\.enabled\)/);
  assert.match(source, /sensitive: Boolean\(payload\.sensitive\)/);
  assert.match(source, /await loadFilterPermissionAdmin\(\{ force: true \}\)/);
  assert.match(source, /error\.code === 'FILTER_VERSION_CONFLICT'/);
  assert.match(source, /formStatus\.textContent = `创建失败：\$\{error\.message\}`/);
  assert.match(source, /submitButton\.disabled = false/);
  assert.match(source, /invalidateAuthorizedFilterMounts\(\)/);
});

test('filter permission changes invalidate every mounted authorized list', () => {
  const start = js.indexOf('function invalidateAuthorizedFilterMounts()');
  const end = js.indexOf('\n  async function saveFilterPermissions', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = js.slice(start, end);
  assert.match(source, /state\.customerFilterMount\?\.destroy\(\)/);
  assert.match(source, /resetResearchState\(\)/);
});

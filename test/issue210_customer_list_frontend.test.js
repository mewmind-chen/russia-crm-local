'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');
const filters = fs.readFileSync(path.join(root, 'sales-assets', 'filter-component.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('Issue #210 exposes exactly the five server-backed business sorts', () => {
  const sort = html.match(/<select id="customerSort"[\s\S]*?<\/select>/)?.[0] || '';
  assert.deepEqual(
    [...sort.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(match => [match[1], match[2]]),
    [
      ['pending_priority', '待处理优先'],
      ['oldest_activity', '最久未跟进'],
      ['recent_progress', '最近有进展'],
      ['newest', '最近创建'],
      ['company', '公司名称'],
    ],
  );
  assert.match(app, /sort:\s*'pending_priority'/);
  assert.match(app, /#customerSort'\)\?\.value \|\| 'pending_priority'/);
});

test('Issue #210 removes potential-value remnants while preserving established year', () => {
  assert.doesNotMatch(`${html}\n${app}`, /potential_desc|potential_value|potentialValue|潜力|潜在金额|US\$0/);
  assert.match(app, /'优先级'/);
  assert.match(app, /成立年份（选填）/);
  assert.match(app, /\['成立年份', account\.established_year \|\| '未填写'\]/);
});

test('Issue #210 disambiguates filters from customer selection controls', () => {
  assert.match(filters, /data-filter-clear>清空筛选<\/button>/);
  assert.match(app, /field\.key === 'owner'[\s\S]*?label: '负责人筛选'/);
  assert.doesNotMatch(html, /id="selectFilteredCustomers"|id="clearCustomerSelection"|id="bulkCustomerOwner"/);
  assert.match(html, /id="bulkAssignCustomers"[\s\S]*?>批量分配<\/button>/);
});

test('Issue #210 renders a current-page checkbox with checked and indeterminate states', () => {
  const render = functionBlock(app, 'renderCustomers');
  assert.match(render, /id="selectCustomerPage"/);
  assert.match(render, /selectedVisibleCount === selectableIds\.length/);
  assert.match(render, /pageCheckbox\.indeterminate = selectedVisibleCount > 0/);
  assert.match(render, /canSelectCustomers && canSelectCustomer\(account\)/);
  assert.match(app, /event\.target\.id === 'selectCustomerPage'/);
  assert.match(app, /selectedVisibleCustomerIds\(\)\.forEach/);
  assert.match(css, /#customerTable input\[type="checkbox"\]/);
});

test('Issue #210 makes all-filtered selection an explicit capped second step', () => {
  assert.match(app, /已选择本页 \$\{esc\(selectedVisibleCount\)\} 条，可选择全部筛选结果/);
  assert.match(app, /data-select-all-filtered-customers/);
  assert.match(app, /total > 500[\s\S]*?请缩小筛选范围/);
  assert.match(app, /window\.confirm\(`将选择全部筛选结果/);
  assert.match(app, /customerSelectionMode = 'filtered'/);
  assert.match(app, /permissionVersion: String\(payload\.permissionVersion/);
  assert.match(app, /filters: componentPayloadToRaw\(payload\)/);
  assert.match(app, /onApply: \(\) => \{[\s\S]*?resetCustomerSelection\(\)/);
  assert.match(app, /customerSelectionMode === 'filtered'[\s\S]*?customerSelectionMode = 'explicit'/);
});

test('Issue #210 shares one selection payload across assignment and return', () => {
  const payload = functionBlock(app, 'customerSelectionPayload');
  assert.match(payload, /filterScope: state\.customerSelectionFilterScope/);
  assert.match(payload, /customerIds: \[\.\.\.state\.selectedCustomerIds\]/);
  assert.match(app, /id="bulkCustomerAssignForm"/);
  assert.match(app, /state\.data\.todayTaskAssignmentCandidates \|\| \[\]/);
  assert.match(app, /form\.id === 'bulkCustomerAssignForm'[\s\S]*?customerSelectionPayload\(\)/);
  assert.match(app, /action === 'bulk'[\s\S]*?customerSelectionPayload\(\)/);
  assert.match(app, /title = selectionCount \? '' : '请先勾选客户'/);
  assert.match(app, /!selectionCount[\s\S]*?'请先勾选客户'/);
});

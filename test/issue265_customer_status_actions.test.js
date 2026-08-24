'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

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

test('Issue 265 primary status maps codes to short labels', () => {
  const fn = functionBlock(app, 'customerPrimaryStatus');
  assert.match(fn, /UNCLAIMED/);
  assert.match(fn, /领取超期/);
  assert.match(fn, /OVERDUE/);
  assert.match(fn, /跟进超期/);
  assert.match(fn, /MANAGER_NEEDED/);
  assert.match(fn, /需要主管协助/);
  assert.match(fn, /正常推进/);
  assert.match(fn, /primary\?\.title/);
  assert.match(fn, /tone: 'red'/);
  assert.match(fn, /tone: 'amber'/);
});

test('Issue 265 customer table headers split status and actions columns', () => {
  const render = functionBlock(app, 'renderCustomers');
  assert.match(render, /'优先级', '状态', '操作'/);
});

test('Issue 265 lifecycle actions live only in the actions column', () => {
  const render = functionBlock(app, 'renderCustomers');
  assert.match(render, /lifecycleActions = \[[\s\S]*?data-return-customer[\s\S]*?data-reject-customer[\s\S]*?data-trash-customer/);
  assert.match(render, /const primaryStatus = customerPrimaryStatus\(alert\)/);
  const statusCellEnd = render.search(/lifecycleActions(?:\.length)? \?/);
  const statusCell = render.slice(
    render.indexOf("primaryStatus.tone === 'good'"),
    statusCellEnd,
  );
  assert.match(statusCell, /good-text/);
  assert.doesNotMatch(statusCell, /data-return-customer|data-reject-customer|data-trash-customer|assignment-actions/);
  const actionsCell = render.slice(statusCellEnd, statusCellEnd + 160);
  assert.match(actionsCell, /lifecycleActions/);
  assert.match(actionsCell, /assignment-actions/);
});

test('Issue 265 drawer lists alert details with time and overdue hours', () => {
  const drawer = functionBlock(app, 'renderDrawer');
  assert.match(drawer, /alert-details/);
  assert.match(drawer, /alertReasons\(alert\)\.length > 1/);
  assert.match(drawer, /overdueHours/);
  assert.match(drawer, /reason\.dueAt/);
  assert.match(css, /\.alert-details\{/);
  assert.match(css, /\.alert-detail-row\{/);
});

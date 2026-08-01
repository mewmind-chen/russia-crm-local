'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');

function block(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing ${end}`);
  return source.slice(startAt, endAt);
}

test('today tasks render a desktop table and a dedicated mobile card list from the same rows', () => {
  const render = block(app, 'function renderAlerts()', 'function notificationAccount');
  assert.match(render, /class="today-task-desktop-table"/);
  assert.match(render, /class="today-task-mobile-list"/);
  assert.match(render, /renderTodayTaskMobileCard\(\s*item,/);
  assert.match(render, /todayTaskActionMarkup\(item\)/);
  const action = block(app, 'function todayTaskActionMarkup(item)', 'function renderAlerts()');
  assert.match(action, /data-today-task-action=/);
  assert.match(action, /data-today-task-id=/);
});

test('mobile task cards contain the full decision context and one real action', () => {
  const context = block(app, 'function todayTaskContext(item, account)', 'function renderTodayTaskMobileCard(item, account)');
  assert.match(context, /filter\(Boolean\)\.join\(' · '\)/);
  const todayTaskContext = Function(
    'accountIdentity',
    'stageLabel',
    `${context}; return todayTaskContext;`,
  )(
    value => value?.externalCustomerId || '',
    stage => stage || '—',
  );
  const cases = [
    [{ intakeItemId: 'lead-1', externalCustomerId: 'RU-1' }, undefined, 'RU-1 · 未开发线索 · 待领取'],
    [{ intakeItemId: 'lead-2' }, undefined, '未开发线索 · 待领取'],
    [{ stage: '确认对口' }, { externalCustomerId: 'RU-2', country: '俄罗斯' }, 'RU-2 · 俄罗斯 · 确认对口'],
    [{ stage: '确认对口' }, { externalCustomerId: 'RU-2' }, 'RU-2 · 确认对口'],
    [{ stage: '确认对口' }, { country: '俄罗斯' }, '俄罗斯 · 确认对口'],
    [{}, {}, '—'],
  ];
  for (const [item, account, expected] of cases) {
    assert.equal(todayTaskContext(item, account), expected);
  }
  const card = block(app, 'function renderTodayTaskMobileCard(item, account)', 'function todayTaskActionMarkup(item)');
  for (const copy of ['主要原因', '其他原因', '计划时间', '当前负责人']) {
    assert.match(card, new RegExp(copy));
  }
  assert.match(card, /urgencyLabel/);
  assert.match(card, /accountDisplayName/);
  assert.match(card, /todayTaskContext\(item, account\)/);
  assert.match(card, /todayTaskActionMarkup\(item\)/);
  assert.match(card, /data-intake-profile=/);
  assert.match(card, /data-customer=/);
  const desktop = block(app, 'function renderAlerts()', 'function notificationAccount');
  assert.match(desktop, /todayTaskContext\(item, account\)/);
});

test('narrow screens switch from the wide table to stable single-column cards', () => {
  assert.match(css, /\.today-task-mobile-list\{display:none/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.today-task-desktop-table\{display:none/);
  assert.match(css, /\.today-task-mobile-list\{display:grid/);
  assert.match(css, /\.today-task-mobile-card\{[^}]*min-width:0/);
  assert.match(css, /\.today-task-mobile-action \.text-button\{[^}]*min-height:44px[^}]*width:100%/);
  assert.match(css, /overflow-wrap:anywhere/);
});

test('mobile severity tabs use the confirmed short labels and assets are cache-busted', () => {
  for (const label of ['全部', '立即', '今天', '关注']) {
    assert.match(html, new RegExp(`severity-label-short">${label}<`));
  }
  for (const label of ['全部异常', '立即处理', '今天完成', '需要关注']) {
    assert.match(html, new RegExp(`severity-label-full">${label}<`));
  }
  assert.match(css, /\.severity-label-full\{display:none\}/);
  assert.match(css, /\.severity-label-short\{display:inline\}/);
  assert.match(html, /app\.css\?v=[^"]+/);
  assert.match(html, /app\.js\?v=[^"]+/);
});

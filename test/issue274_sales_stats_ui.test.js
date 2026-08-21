'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');

test('sales dashboard, intake cards, and navigation use the same pending assignment metric', () => {
  const dashboardStart = app.indexOf('function renderDashboard()');
  const dashboardEnd = app.indexOf('function percent(', dashboardStart);
  const dashboard = app.slice(dashboardStart, dashboardEnd);
  assert.match(dashboard, /const intakeStats = state\.data\.intake\?\.stats \|\| \{\}/);
  assert.match(dashboard, /\['assigned', '未开发线索', intakeStats\.assigned \|\| 0, '等待领取'/);
  assert.doesNotMatch(dashboard, /researchTotals\?\.poolAvailable/);
  assert.match(app, /intakeSalesView\s*\? Number\(intakeStats\?\.assigned \|\| 0\)/);
});

test('sales today card uses assignment time while manager import card remains unchanged', () => {
  assert.match(app, /\['today', '今日收到线索', stats\.todayAssigned,/);
  assert.match(app, /\['today', '今日同步线索', stats\.todayImported,/);
});

test('statistics release uses a fresh production cache token', () => {
  assert.match(html, /sales-assets\/app\.js\?v=20260821-issue335-action-command-v1/);
  assert.match(html, /sales-assets\/app\.css\?v=20260821-issue335-action-command-v1/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（activity/planning 批）：逐字一致模块必须从 lib/domains import，不得内联。
test('activity serializers are imported from lib/domains/activity/serialize, not inlined', () => {
  assert.match(source, /const \{ publicActivityRecord, publicActivityRecords \} = require\('\.\/domains\/activity\/serialize'\);/);
  assert.doesNotMatch(source, /^function publicActivityRecord\(/m);
  assert.doesNotMatch(source, /^function publicActivityRecords\(/m);
});

test('planning alert helpers are imported from lib/domains/planning/alerts, not inlined', () => {
  assert.match(source, /const \{ reasonOrder, urgencyFor, groupAlerts \} = require\('\.\/domains\/planning\/alerts'\);/);
  assert.doesNotMatch(source, /^function reasonOrder\(/m);
  assert.doesNotMatch(source, /^function urgencyFor\(/m);
  assert.doesNotMatch(source, /^function groupAlerts\(/m);
});

test('planning risk helper is imported from lib/domains/planning/risk, not inlined', () => {
  assert.match(source, /const \{ emptyCustomerPlanRisk \} = require\('\.\/domains\/planning\/risk'\);/);
  assert.doesNotMatch(source, /^function emptyCustomerPlanRisk\(/m);
});

test('planning streak helper is imported from lib/domains/planning/streak, not inlined', () => {
  assert.match(source, /const \{ noPlanStreakForActivities \} = require\('\.\/domains\/planning\/streak'\);/);
  assert.doesNotMatch(source, /^function noPlanStreakForActivities\(/m);
});
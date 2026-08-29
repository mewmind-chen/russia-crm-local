'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（customer/create + filter/errors + planning/today_task 批）：
// 三个域模块的注入式 helper 必须从各自域模块 import，不得内联。
test('customer create, filter errors and today-task helpers are wired from domain modules, not inlined', () => {
  assert.match(source, /const \{ customerCreateRequestHash \} = require\('\.\/domains\/customer\/create'\);/);
  assert.match(source, /const \{ filterVersionError \} = require\('\.\/domains\/filter\/errors'\);/);
  assert.match(source, /const \{ todayTaskError, normalizeTodayTaskDate \} = require\('\.\/domains\/planning\/today_task'\);/);
  assert.doesNotMatch(source, /^function customerCreateRequestHash\(/m);
  assert.doesNotMatch(source, /^function filterVersionError\(/m);
  assert.doesNotMatch(source, /^function todayTaskError\(/m);
  assert.doesNotMatch(source, /^function normalizeTodayTaskDate\(/m);
  // 注入式调用点：filterVersionError 2 处注入 { httpError }，normalizeTodayTaskDate 3 处注入 { parseBusinessDateTime }
  assert.match(source, /filterVersionError\(\{ httpError \}\)/);
  assert.match(source, /normalizeTodayTaskDate\(payload\.nextActionAt, \{ parseBusinessDateTime \}\)/);
  // todayTaskError 调用点注入 { error: httpError }
  assert.match(source, /todayTaskError\([^)]*\{ error: httpError \}\)/);
});

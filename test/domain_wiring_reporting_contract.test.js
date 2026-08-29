'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（reporting 批）：报表构建器必须从 lib/domains/reporting/builders import，不得内联。
test('reporting builders are imported from lib/domains/reporting/builders, not inlined', () => {
  assert.match(source, /const \{ buildCountryReport, buildCohortReport, buildTeamReport, rate \} = require\('\.\/domains\/reporting\/builders'\);/);
  assert.doesNotMatch(source, /^function rate\(/m);
  assert.doesNotMatch(source, /^function buildCountryReport\(/m);
  assert.doesNotMatch(source, /^function buildCohortReport\(/m);
  assert.doesNotMatch(source, /^function buildTeamReport\(/m);
});
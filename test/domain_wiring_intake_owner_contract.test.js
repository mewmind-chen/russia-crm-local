'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（intake/owner 批）：确定性线索负责人选择必须从
// lib/domains/intake/owner import，不得内联。
test('chooseIntakeOwner is wired from domain module, not inlined', () => {
  assert.match(source, /const \{ chooseIntakeOwner \} = require\('\.\/domains\/intake\/owner'\);/);
  assert.doesNotMatch(source, /^function chooseIntakeOwner\(/m);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（auth/user 批）：safeUser 用户安全投影必须从
// lib/domains/auth/user import，不得内联。
test('safeUser is wired from domain module, not inlined', () => {
  assert.match(source, /const \{ safeUser \} = require\('\.\/domains\/auth\/user'\);/);
  assert.doesNotMatch(source, /^function safeUser\(/m);
});

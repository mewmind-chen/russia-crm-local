'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（auth/customer 批）：逐字一致模块必须从 lib/domains import，不得内联。
function assertWired(modulePath, names, label) {
  assert.match(source, new RegExp(`require\\('${modulePath}'\\)`), `${label}: must require ${modulePath}`);
  for (const name of names) {
    assert.match(source, new RegExp(name), `${label}: must destructure ${name}`);
    assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, 'm'), `${label}: ${name} must not be a local function`);
  }
}

test('auth access/credential/session helpers are imported, not inlined', () => {
  assertWired('./domains/auth/access', ['inaccessibleOrMissing'], 'auth/access');
  assertWired('./domains/auth/credentials', ['hashPassword'], 'auth/credentials');
  assertWired('./domains/auth/session', ['parseCookies'], 'auth/session');
});

test('customer contact helpers are imported, not inlined', () => {
  assertWired('./domains/customer/contacts', ['cleanContactFields', 'publicAccountContact'], 'customer/contacts');
});

test('customer identity helper is imported, not inlined', () => {
  assertWired('./domains/customer/identity', ['identityConflictNote'], 'customer/identity');
});

test('customer summary helpers are imported, not inlined', () => {
  assertWired('./domains/customer/summary', ['creatorDisplayName', 'historyAccountSummary', 'changedFieldLabels'], 'customer/summary');
});
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约：http 域 helper 必须从 lib/domains 域模块 import，不得在 sales_crm.js 内联定义。
test('http error constructors are imported from lib/domains/http/error, not inlined', () => {
  assert.match(
    source,
    /const \{ httpError, badRequest, notFound, conflictError \} = require\('\.\/domains\/http\/error'\);/,
  );
  assert.doesNotMatch(source, /^function httpError\(/m);
  assert.doesNotMatch(source, /^const badRequest =/m);
  assert.doesNotMatch(source, /^const notFound =/m);
  assert.doesNotMatch(source, /^const conflictError =/m);
});

test('anonymous route normalization is imported from lib/domains/http/routes, not inlined', () => {
  assert.match(
    source,
    /const \{ anonymousSalesRoute \} = require\('\.\/domains\/http\/routes'\);/,
  );
  assert.doesNotMatch(source, /^function anonymousSalesRoute\(/m);
});
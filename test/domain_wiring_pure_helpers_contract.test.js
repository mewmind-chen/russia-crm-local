'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约：纯共享 helper 必须从 lib/domains 域模块 import，不得在 sales_crm.js 内联定义。
test('pure JSON helpers are imported from lib/domains/json/parse, not inlined', () => {
  assert.match(source, /const \{ json, parseJsonObject \} = require\('\.\/domains\/json\/parse'\);/);
  assert.doesNotMatch(source, /^function json\(/m, 'json must not be a local function');
  assert.doesNotMatch(source, /^function parseJsonObject\(/m);
});

test('list pagination helpers are imported from lib/domains/list/pagination, not inlined', () => {
  assert.match(source, /const \{ normalizeListQuery, listPage \} = require\('\.\/domains\/list\/pagination'\);/);
  assert.doesNotMatch(source, /^function normalizeListQuery\(/m);
  assert.doesNotMatch(source, /^function listPage\(/m);
});

test('audit redaction is imported from lib/domains/audit/redact, not inlined', () => {
  assert.match(source, /const \{ redactAuditPayload \} = require\('\.\/domains\/audit\/redact'\);/);
  assert.doesNotMatch(source, /^function redactAuditPayload\(/m);
});

test('notification visibility helpers are imported from lib/domains/notifications/visibility, not inlined', () => {
  assert.match(
    source,
    /require\('\.\/domains\/notifications\/visibility'\)/,
    'must require the notifications/visibility domain module',
  );
  assert.match(
    source,
    /notificationVisibleForFeatures,\s*AI_NOTIFICATION_CODES,\s*SALES_PACK_NOTIFICATION_CODES/,
    'must destructure the visibility helpers',
  );
  assert.doesNotMatch(source, /^function notificationVisibleForFeatures\(/m);
  assert.doesNotMatch(source, /^const AI_NOTIFICATION_CODES = new Set/m);
  assert.doesNotMatch(source, /^const SALES_PACK_NOTIFICATION_CODES = new Set/m);
});
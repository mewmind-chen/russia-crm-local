'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（intake/assignment 批）：逐字一致模块必须从 lib/domains import，不得内联。
function assertWired(modulePath, names, source) {
  assert.match(source, new RegExp(`require\\('${modulePath}'\\)`), `must require ${modulePath}`);
  for (const name of names) {
    assert.match(source, new RegExp(name), `must destructure ${name}`);
    assert.doesNotMatch(source, new RegExp(`^function ${name}\\(`, 'm'), `${name} must not be a local function`);
  }
}

test('intake assignment helpers are imported from lib/domains/intake/assignment, not inlined', () => {
  assertWired('./domains/intake/assignment', ['intakeActionIdempotencyKey', 'manualAssignmentRequestHash', 'manualAssignmentRequiresPreview'], source);
});

test('intake decision helpers are imported from lib/domains/intake/decision, not inlined', () => {
  assertWired('./domains/intake/decision', ['serializeArbitrationDecision', 'withoutArbitrationAI', 'serializeRecommendation'], source);
});

test('intake query helpers are imported from lib/domains/intake/query, not inlined', () => {
  assertWired('./domains/intake/query', ['intakeQueryValues', 'intakeQueryBoolean', 'intakeQueryDate'], source);
});

test('assignment link helpers are imported from lib/domains/assignment/link, not inlined', () => {
  assertWired('./domains/assignment/link', ['isCurrentIntakeAccount', 'isReturnedAccountForIntake', 'reusableReturnedAccountForIntake'], source);
});
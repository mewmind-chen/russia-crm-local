'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { buildAlerts } = require('../lib/sales_crm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? sourceText.indexOf(`function ${nextFunctionName}(`, start + 1)
    : sourceText.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'buildAlerts', 'filterTodayTaskAlertsForUser');

// 阶段 B §4.4：告警必须消费 state_projection 的 projectNextAction 判定，
// 不得自行裸比较 next_action/next_action_at（否则缺 time_basis 的行漏判）。
test('buildAlerts consumes projectNextAction instead of comparing raw columns', () => {
  assert.match(body, /projectNextAction\(/, 'buildAlerts must use the projection');
  assert.doesNotMatch(
    body,
    /!account\.next_action \|\| !account\.next_action_at/,
    'buildAlerts must not compare raw next_action columns',
  );
});

// 行为契约：有文本+时间但缺 time_basis 的活跃客户 → 仍产出 NO_NEXT 告警。
test('alerts flag a missing time basis as NO_NEXT (projection semantics)', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const account = fx.db.prepare(`SELECT * FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  const alerts = buildAlerts(
    [{ ...account, next_action: '跟进报价', next_action_at: '2099-08-28 09:00:00', next_action_time_basis: '' }],
    [], [], [], [], [],
  );
  assert.ok(alerts.some(alert => alert.code === 'NO_NEXT'), 'missing time basis must surface as NO_NEXT');
  assert.ok(!alerts.some(alert => alert.code === 'OVERDUE'));
});

// 对照：有文本+时间+basis 齐全 → 不产生 NO_NEXT，且时间未到时也不 OVERDUE。
test('a complete plan does not produce NO_NEXT', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const account = fx.db.prepare(`SELECT * FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  const alerts = buildAlerts(
    [{ ...account, next_action: '跟进报价', next_action_at: '2099-08-28 09:00:00', next_action_time_basis: 'utc' }],
    [], [], [], [], [],
  );
  assert.ok(!alerts.some(alert => alert.code === 'NO_NEXT'), 'complete plan must not be NO_NEXT');
  assert.ok(!alerts.some(alert => alert.code === 'OVERDUE'));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');
const { buildTeamReport } = require('../lib/domains/reporting/builders');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'domains', 'reporting', 'builders.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = nextFunctionName
    ? sourceText.indexOf(`function ${nextFunctionName}(`, start + 1)
    : sourceText.length;
  if (nextFunctionName) assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'buildTeamReport');

// 阶段 B §4.4：报表（buildTeamReport）必须消费 state_projection 的 projectNextAction，
// 不得自行把 next_action_at 解析为 overdue / 把 next_action+next_action_at 当 planned
//（planned 需含 time_basis 维度，否则与 §4.3 发散）。
test('buildTeamReport consumes projectNextAction instead of re-deriving from raw columns', () => {
  assert.match(source, /state_projection/, 'builders must import the projection');
  assert.match(body, /projectNextAction\(/, 'buildTeamReport must use the projection');
  assert.doesNotMatch(
    body,
    /new Date\(String\(row\.next_action_at\)/,
    'must not parse raw next_action_at itself',
  );
});

// 行为契约：planned 只计 text+time+basis 齐全（§4.3）；overdue 计时间已过的行。
test('team report planned/overdue follow projection semantics', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const user = fx.db.prepare(`SELECT * FROM sales_users WHERE id='U-OTHER'`).get();
  const base = fx.db.prepare(`SELECT * FROM crm_accounts WHERE id='CRM-OTHER'`).get();
  const mk = id => overrides => ({ ...base, id, owner_id: 'U-OTHER', stage: 'quoted', ...overrides });

  const noBasis = mk('c1')({ next_action: '跟进报价', next_action_at: '2099-08-28 09:00:00', next_action_time_basis: '' });
  const complete = mk('c2')({ next_action: '跟进报价', next_action_at: '2099-08-28 09:00:00', next_action_time_basis: 'utc' });
  const pastDue = mk('c3')({ next_action: '跟进报价', next_action_at: '2020-01-01 09:00:00', next_action_time_basis: 'utc' });

  const report = buildTeamReport([user], [noBasis, complete, pastDue], [], [], [], [])[0];
  assert.equal(report.metrics.planned, 2, 'only complete (text+time+basis) plans count as planned');
  assert.equal(report.metrics.overdue, 1, 'rows with a past next_action_at count as overdue');
});
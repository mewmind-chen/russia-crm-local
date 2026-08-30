'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');
const {
  SMOKE_ACCOUNT_ID,
  cleanupNextActionSmoke,
  prepareNextActionSmoke,
} = require('../lib/smoke_test_data');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'smoke_test_data.js'), 'utf8');

// 阶段 B §4.3：生产冒烟夹具（smoke_test_data.js）建立 next_action 计划时
// 必须同时写 next_action_time_basis（生产写点一律 PLAN_TIME_BASIS='utc'），
// 否则冒烟客户被投影判为 degraded，与生产语义不一致。
test('smoke fixture writes time basis whenever it establishes or clears a plan', () => {
  assert.match(
    source,
    /INSERT INTO crm_accounts[^)]*next_action_time_basis/,
    'smoke account INSERT must include next_action_time_basis',
  );
  assert.match(
    source,
    /next_action_at,\s*next_action_time_basis/s,
    'plan INSERT must place the basis column next to next_action_at',
  );
  assert.match(
    source,
    /next_action_at=\?,next_action_time_basis='utc'/,
    'plan UPDATE must write utc basis alongside the plan',
  );
  assert.match(
    source,
    /next_action_at='',next_action_time_basis=''/,
    'legacy plan cleanup must clear the basis alongside the plan',
  );
  assert.match(
    source,
    /nextActionTimeBasis: current\.next_action_time_basis/,
    'cleanup snapshot must capture the time basis for restore',
  );
  assert.match(
    source,
    /next_action_at=\?,next_action_time_basis=\?,/,
    'snapshot restore must write the basis alongside the plan',
  );
});

// 行为契约：prepare 后冒烟客户为 utc 计划；cleanup 后三字段一并清空。
test('smoke prepare writes a utc-basis plan and cleanup clears it', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const runId = 'smoke-basis-contract-001';
  const prepared = prepareNextActionSmoke(fx.db, {
    runId,
    actorId: 'USR-ADMIN',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  assert.equal(prepared.status, 'queued');
  const row = fx.db.prepare(
    `SELECT next_action,next_action_at,next_action_time_basis FROM crm_accounts WHERE id=?`,
  ).get(SMOKE_ACCOUNT_ID);
  assert.ok(String(row.next_action || '').length > 0, 'smoke plan text must be set');
  assert.equal(row.next_action_time_basis, 'utc');

  assert.equal(cleanupNextActionSmoke(fx.db, { runId, actorId: 'USR-ADMIN' }).status, 'cleaned');
  const cleaned = fx.db.prepare(
    `SELECT next_action,next_action_at,next_action_time_basis FROM crm_accounts WHERE id=?`,
  ).get(SMOKE_ACCOUNT_ID);
  assert.deepEqual(cleaned, { next_action: '', next_action_at: '', next_action_time_basis: '' });
});
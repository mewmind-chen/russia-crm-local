'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  createCandidateSnapshot,
  createSalesMatchSnapshotContext,
  getCandidateSnapshot,
  resolveCandidateEmployeeIds,
} = require('../lib/ai_stations/candidate_snapshots');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, permissions_json TEXT NOT NULL DEFAULT '{}',
      languages_json TEXT NOT NULL DEFAULT '[]', countries_json TEXT NOT NULL DEFAULT '[]',
      channels_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'qualified', owner_id TEXT NOT NULL DEFAULT '',
      assignment_status TEXT NOT NULL DEFAULT 'claimed'
    );
    CREATE TABLE crm_intake_settings (
      id TEXT PRIMARY KEY, daily_per_sales INTEGER NOT NULL DEFAULT 5
    );
    CREATE TABLE crm_intake_items (
      id TEXT PRIMARY KEY, assigned_owner_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', assigned_at TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('C-1','Fixture')").run();
  db.prepare("INSERT INTO crm_intake_settings(id,daily_per_sales) VALUES ('default',2)").run();
  const insert = db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permissions_json,languages_json,countries_json,channels_json)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const salesPermissions = JSON.stringify({ view_intake: true });
  insert.run('S-RU', 'ru@example.test', 'Russia', 'sales', 1, salesPermissions,
    '["俄语"]', '["俄罗斯"]', '["Telegram"]');
  insert.run('S-BR', 'br@example.test', 'Brazil', 'sales', 1, salesPermissions,
    '["葡萄牙语"]', '["巴西"]', '["WhatsApp"]');
  insert.run('S-DENY', 'deny@example.test', 'Denied', 'sales', 1, '{"view_intake":false}',
    '["俄语"]', '["俄罗斯"]', '["Telegram"]');
  insert.run('S-OFF', 'off@example.test', 'Inactive', 'sales', 0, salesPermissions,
    '["俄语"]', '["俄罗斯"]', '["Telegram"]');
  return db;
}

test('candidate snapshots select authorized sales and expose only one-time tokens', t => {
  const db = fixture();
  t.after(() => db.close());
  const snapshot = createCandidateSnapshot(db, {
    customerId: 'C-1',
    createdBy: 'USR-MGR',
    context: { country: '俄罗斯', languages: ['俄语'], channels: ['Telegram'] },
    idFactory: () => 'SNAP-1',
    now: '2026-07-24T10:00:00.000Z',
  });

  assert.equal(snapshot.snapshotId, 'SNAP-1');
  assert.deepEqual(snapshot.candidateEmployeeIds, [1, 2]);
  assert.deepEqual(snapshot.candidates.map(item => item.name), ['Russia', 'Brazil']);
  assert.equal(JSON.stringify(snapshot).includes('S-RU'), false);
  assert.equal(JSON.stringify(snapshot).includes('S-BR'), false);
  assert.equal(snapshot.candidates[0].matchScore > snapshot.candidates[1].matchScore, true);

  const rows = db.prepare(`SELECT token,sales_user_id FROM crm_ai_candidate_snapshot_items
    WHERE snapshot_id=? ORDER BY token`).all(snapshot.snapshotId);
  assert.deepEqual(rows, [
    { token: 1, sales_user_id: 'S-RU' },
    { token: 2, sales_user_id: 'S-BR' },
  ]);

  const promptContext = createSalesMatchSnapshotContext(db, {
    customerId: 'C-1',
    context: { country: '俄罗斯' },
    idFactory: () => 'SNAP-PROMPT',
    now: '2026-07-24T10:00:00.000Z',
  });
  assert.deepEqual(promptContext.candidateEmployeeIds, [1, 2]);
  assert.equal(JSON.stringify(promptContext).includes('S-RU'), false);
});

test('same candidate state is idempotent and state changes invalidate the old snapshot', t => {
  const db = fixture();
  t.after(() => db.close());
  const options = {
    customerId: 'C-1',
    context: { country: '俄罗斯', languages: ['俄语'] },
    now: '2026-07-24T10:00:00.000Z',
  };
  const first = createCandidateSnapshot(db, { ...options, idFactory: () => 'SNAP-1' });
  const same = createCandidateSnapshot(db, { ...options, idFactory: () => 'SNAP-2' });
  assert.equal(same.snapshotId, first.snapshotId);

  db.prepare("UPDATE sales_users SET active=0 WHERE id='S-RU'").run();
  const stale = getCandidateSnapshot(db, first.snapshotId, options);
  assert.equal(stale.status, 'invalidated');
  assert.equal(db.prepare('SELECT status,invalidated_reason FROM crm_ai_candidate_snapshots WHERE id=?')
    .get(first.snapshotId).invalidated_reason, 'sales_state_changed');

  const replacement = createCandidateSnapshot(db, { ...options, idFactory: () => 'SNAP-3' });
  assert.equal(replacement.snapshotId, 'SNAP-3');
  assert.deepEqual(replacement.candidateEmployeeIds, [1]);
});

test('expired snapshots and incomplete rankings fail closed', t => {
  const db = fixture();
  t.after(() => db.close());
  const options = {
    customerId: 'C-1',
    context: { country: '俄罗斯' },
    now: '2026-07-24T10:00:00.000Z',
    ttlMs: 60_000,
    idFactory: () => 'SNAP-EXPIRY',
  };
  const snapshot = createCandidateSnapshot(db, options);
  const expired = getCandidateSnapshot(db, snapshot.snapshotId, {
    ...options,
    now: '2026-07-24T10:01:01.000Z',
  });
  assert.equal(expired.status, 'expired');
  assert.throws(() => resolveCandidateEmployeeIds(db, snapshot.snapshotId, [1], options), /not active/);

  const fresh = createCandidateSnapshot(db, {
    ...options,
    now: '2026-07-24T11:00:00.000Z',
    idFactory: () => 'SNAP-RANK',
  });
  assert.throws(() => resolveCandidateEmployeeIds(db, fresh.snapshotId, [1], {
    now: '2026-07-24T11:00:00.000Z',
  }), /complete snapshot/);
  assert.throws(() => resolveCandidateEmployeeIds(db, fresh.snapshotId, [1, 1], {
    now: '2026-07-24T11:00:00.000Z',
  }), /unique/);
  assert.deepEqual(resolveCandidateEmployeeIds(db, fresh.snapshotId, [2, 1], {
    now: '2026-07-24T11:00:00.000Z',
  }), ['S-BR', 'S-RU']);
});

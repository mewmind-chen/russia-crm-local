'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  buildAccountStatePatch,
  applyAccountStatePatch,
} = require('../lib/domains/lifecycle/state_write');

test('buildAccountStatePatch normalizes a valid state transition', () => {
  assert.deepEqual(buildAccountStatePatch({
    stage: 'lost',
    lifecycleStatus: 'recycled',
    assignmentStatus: 'returned',
    ownerId: null,
    updatedAt: '2026-08-28 10:00:00',
  }), {
    stage: 'lost',
    lifecycle_status: 'recycled',
    assignment_status: 'returned',
    owner_id: null,
    updated_at: '2026-08-28 10:00:00',
  });
});

test('buildAccountStatePatch rejects unknown state values before SQL executes', () => {
  assert.throws(() => buildAccountStatePatch({ assignmentStatus: 'returned-ish' }), /无效的分配状态/);
  assert.throws(() => buildAccountStatePatch({ lifecycleStatus: 'deleted' }), /无效的生命周期状态/);
  assert.throws(() => buildAccountStatePatch({ stage: 'unknown' }), /无效的客户阶段/);
});

test('applyAccountStatePatch updates only requested state columns in one SQL operation', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, stage TEXT, lifecycle_status TEXT,
    assignment_status TEXT, owner_id TEXT, updated_at TEXT
  )`);
  db.prepare('INSERT INTO crm_accounts VALUES (?,?,?,?,?,?)')
    .run('CRM-1', 'qualified', 'active', 'claimed', 'U-1', 'before');
  const result = applyAccountStatePatch(db, 'CRM-1', {
    assignmentStatus: 'returned', ownerId: null, updatedAt: 'after',
  });
  assert.deepEqual(result, {
    changed: true,
    patch: { assignment_status: 'returned', owner_id: null, updated_at: 'after' },
  });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-1'), {
    id: 'CRM-1', stage: 'qualified', lifecycle_status: 'active',
    assignment_status: 'returned', owner_id: null, updated_at: 'after',
  });
  db.close();
});

test('applyAccountStatePatch reports missing accounts without changing data', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, stage TEXT)');
  const result = applyAccountStatePatch(db, 'missing', { stage: 'lost' });
  assert.deepEqual(result, { changed: false, patch: { stage: 'lost' } });
  db.close();
});

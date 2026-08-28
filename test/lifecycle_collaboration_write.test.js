'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  buildPlanPatch,
  buildManagerPatch,
  applyAccountPlanPatch,
  applyManagerStatusPatch,
} = require('../lib/domains/lifecycle/collaboration_write');

test('buildPlanPatch normalizes a plan write without touching other state', () => {
  assert.deepEqual(buildPlanPatch({
    nextAction: '确认采购周期',
    nextActionAt: '2026-08-28 09:00:00',
    timeBasis: 'utc',
    updatedAt: '2026-08-27 10:00:00',
  }), {
    next_action: '确认采购周期',
    next_action_at: '2026-08-28 09:00:00',
    next_action_time_basis: 'utc',
    updated_at: '2026-08-27 10:00:00',
  });
  assert.deepEqual(buildPlanPatch({ nextAction: '仅动作' }), { next_action: '仅动作' });
});

test('buildManagerPatch converts required flag and status consistently', () => {
  assert.deepEqual(buildManagerPatch({ required: true, status: '待介入' }), {
    manager_required: 1,
    manager_status: '待介入',
  });
  assert.deepEqual(buildManagerPatch({ required: false, status: '已完成', managerId: 'U-MGR' }), {
    manager_required: 0,
    manager_status: '已完成',
    manager_id: 'U-MGR',
  });
});

test('applyAccountPlanPatch updates only plan columns', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, stage TEXT, lifecycle_status TEXT, assignment_status TEXT,
    next_action TEXT, next_action_at TEXT, next_action_time_basis TEXT,
    manager_status TEXT, manager_required INTEGER, updated_at TEXT
  )`);
  db.prepare(`INSERT INTO crm_accounts VALUES
    ('CRM-1','qualified','active','claimed','旧计划','2026-08-01 00:00:00','utc','已介入',0,'before')`).run();
  const result = applyAccountPlanPatch(db, 'CRM-1', {
    nextAction: '新计划',
    nextActionAt: '2026-08-30 00:00:00',
    timeBasis: 'utc',
    updatedAt: 'after',
  });
  assert.deepEqual(result, {
    changed: true,
    patch: {
      next_action: '新计划',
      next_action_at: '2026-08-30 00:00:00',
      next_action_time_basis: 'utc',
      updated_at: 'after',
    },
  });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-1'), {
    id: 'CRM-1', stage: 'qualified', lifecycle_status: 'active', assignment_status: 'claimed',
    next_action: '新计划', next_action_at: '2026-08-30 00:00:00', next_action_time_basis: 'utc',
    manager_status: '已介入', manager_required: 0, updated_at: 'after',
  });
  db.close();
});

test('applyAccountPlanPatch can clear a plan without losing the owner assignment', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, owner_id TEXT, assignment_status TEXT,
    next_action TEXT, next_action_at TEXT, next_action_time_basis TEXT
  )`);
  db.prepare(`INSERT INTO crm_accounts VALUES ('CRM-2','U-1','claimed','旧计划','2026-08-01 00:00:00','utc')`).run();
  applyAccountPlanPatch(db, 'CRM-2', { nextAction: '', nextActionAt: '', timeBasis: '' });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-2'), {
    id: 'CRM-2', owner_id: 'U-1', assignment_status: 'claimed',
    next_action: '', next_action_at: '', next_action_time_basis: '',
  });
  db.close();
});

test('applyManagerStatusPatch updates only manager columns', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, stage TEXT, next_action TEXT, next_action_at TEXT,
    manager_required INTEGER, manager_status TEXT, manager_id TEXT, updated_at TEXT
  )`);
  db.prepare(`INSERT INTO crm_accounts VALUES
    ('CRM-3','meeting','旧计划','2026-08-01 00:00:00',1,'待介入','', 'before')`).run();
  applyManagerStatusPatch(db, 'CRM-3', {
    required: false,
    status: '已完成',
    managerId: 'U-MGR',
    updatedAt: 'after',
  });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-3'), {
    id: 'CRM-3', stage: 'meeting', next_action: '旧计划', next_action_at: '2026-08-01 00:00:00',
    manager_required: 0, manager_status: '已完成', manager_id: 'U-MGR', updated_at: 'after',
  });
  db.close();
});

test('plan and manager patches leave each other untouched when applied together', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_accounts (
    id TEXT PRIMARY KEY, next_action TEXT, next_action_at TEXT, next_action_time_basis TEXT,
    manager_required INTEGER, manager_status TEXT, manager_id TEXT, updated_at TEXT
  )`);
  db.prepare(`INSERT INTO crm_accounts VALUES
    ('CRM-4','','','',1,'待介入','','before')`).run();
  applyAccountPlanPatch(db, 'CRM-4', {
    nextAction: '回执确认',
    nextActionAt: '2026-08-29 00:00:00',
    timeBasis: 'utc',
    updatedAt: 'after',
  });
  applyManagerStatusPatch(db, 'CRM-4', { required: false, status: '已完成' });
  assert.deepEqual(db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-4'), {
    id: 'CRM-4',
    next_action: '回执确认',
    next_action_at: '2026-08-29 00:00:00',
    next_action_time_basis: 'utc',
    manager_required: 0,
    manager_status: '已完成',
    manager_id: '',
    updated_at: 'after',
  });
  db.close();
});

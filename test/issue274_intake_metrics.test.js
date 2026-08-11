'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { businessDayUtcRange, loadIntakeMetrics } = require('../lib/intake_metrics');

test('business day uses the configured timezone instead of the server calendar date', () => {
  assert.deepEqual(
    businessDayUtcRange(new Date('2026-08-10T16:30:00Z'), 'Asia/Shanghai'),
    {
      localDate: '2026-08-11',
      start: '2026-08-10 16:00:00',
      end: '2026-08-11 16:00:00',
    },
  );
});

test('business day range follows daylight-saving boundaries', () => {
  assert.deepEqual(
    businessDayUtcRange(new Date('2026-03-08T16:00:00Z'), 'America/New_York'),
    {
      localDate: '2026-03-08',
      start: '2026-03-08 05:00:00',
      end: '2026-03-09 04:00:00',
    },
  );
});

test('intake metrics distinguish import time, assignment time, and current assigned state', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE crm_intake_items (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    assigned_owner_id TEXT NOT NULL DEFAULT '',
    assigned_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`);
  const insert = db.prepare(`INSERT INTO crm_intake_items
    (id,status,assigned_owner_id,assigned_at,created_at) VALUES (?,?,?,?,?)`);
  insert.run('OWN-TODAY', 'assigned', 'U-SALES',
    '2026-08-10 17:00:00', '2026-08-09 08:00:00');
  insert.run('OTHER-TODAY', 'assigned', 'U-OTHER',
    '2026-08-10 18:00:00', '2026-08-10 18:00:00');
  insert.run('OWN-OLD', 'claimed', 'U-SALES',
    '2026-08-09 08:00:00', '2026-08-10 19:00:00');

  const metrics = loadIntakeMetrics(db, { id: 'U-SALES', role: 'sales' }, {
    filters: ["i.status IN ('assigned','claimed')", 'i.assigned_owner_id=?'],
    params: ['U-SALES'],
  }, {
    now: new Date('2026-08-10T16:30:00Z'),
    timezone: 'Asia/Shanghai',
  });

  assert.deepEqual(metrics, {
    assigned: 1,
    todayAssigned: 1,
    todayImported: 1,
    businessDate: '2026-08-11',
  });
  db.close();
});

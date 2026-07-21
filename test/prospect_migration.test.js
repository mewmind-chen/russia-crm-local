'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('legacy prospect tasks are assigned to an active admin during upgrade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-prospect-upgrade-'));
  const dbPath = path.join(dir, 'crm.db');
  const previousDbPath = process.env.CRM_DB_PATH;
  const previousOwner = process.env.CRM_LEGACY_PROSPECT_OWNER_ID;
  try {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sales_users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO sales_users(id,role,active) VALUES
        ('U-ADMIN','admin',1),
        ('U-SALES','sales',1);
      CREATE TABLE prospect_tasks (
        task_id TEXT PRIMARY KEY,
        query TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'done',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO prospect_tasks(task_id,query,status,created_at,updated_at)
      VALUES ('TASK-LEGACY','legacy fixture','done','2026-07-21 08:00:00','2026-07-21 08:00:00');
    `);
    db.close();
    process.env.CRM_DB_PATH = dbPath;
    delete process.env.CRM_LEGACY_PROSPECT_OWNER_ID;

    const { ensureTables, getProspectTask } = require('../lib/db');
    ensureTables();

    const verify = new Database(dbPath);
    assert.equal(
      verify.prepare("SELECT created_by FROM prospect_tasks WHERE task_id='TASK-LEGACY'").get().created_by,
      'U-ADMIN',
    );
    verify.close();
    assert.equal(getProspectTask('TASK-LEGACY', 'U-ADMIN').taskId, 'TASK-LEGACY');
    assert.throws(
      () => getProspectTask('TASK-LEGACY', 'U-SALES'),
      error => error.statusCode === 403,
    );
  } finally {
    if (previousDbPath === undefined) delete process.env.CRM_DB_PATH;
    else process.env.CRM_DB_PATH = previousDbPath;
    if (previousOwner === undefined) delete process.env.CRM_LEGACY_PROSPECT_OWNER_ID;
    else process.env.CRM_LEGACY_PROSPECT_OWNER_ID = previousOwner;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

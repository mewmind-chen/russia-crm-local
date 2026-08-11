'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reconcile-mismatch-recycle.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue273-mismatch-repair-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE crm_intake_items (
      id TEXT PRIMARY KEY, external_customer_id TEXT NOT NULL DEFAULT '',
      crm_customer_id TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', assigned_owner_id TEXT NOT NULL DEFAULT '',
      previous_owner_id TEXT NOT NULL DEFAULT '', rejected_by TEXT NOT NULL DEFAULT '',
      rejected_at TEXT NOT NULL DEFAULT '', return_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,
      entity_type TEXT NOT NULL,entity_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,
      real_user_id TEXT NOT NULL DEFAULT '',effective_user_id TEXT NOT NULL DEFAULT '',
      impersonation_context_id TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO crm_intake_items
      (id,external_customer_id,company_name,status,assigned_owner_id,return_reason,updated_at)
    VALUES ('IN-RB-1786216512032-243','RU-0157','Mikron Group','rejected','U-WU',
      '原厂不对口','2026-08-11 10:25:00');
  `);
  db.close();
  return { dir, dbPath };
}

function run(fx, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CRM_PRODUCTION_ROOT: path.join(fx.dir, 'production-never-used'),
      CRM_RUNTIME_ROOT: fx.dir,
      CRM_DB_PATH: fx.dbPath,
      CRM_BACKUP_DIR: path.join(fx.dir, 'backups'),
    },
  });
}

test('mismatch reconciliation is dry-run by default and repairs Mikron-shaped lineage explicitly', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));
  const before = fs.readFileSync(fx.dbPath);

  const preview = run(fx);
  assert.equal(preview.status, 0, preview.stderr);
  const report = JSON.parse(preview.stdout);
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.orphanedRejected, 1);
  assert.equal(report.rows[0].externalCustomerId, 'RU-0157');
  assert.equal(report.rows[0].intakeItemId, 'IN-RB-1786216512032-243');
  assert.deepEqual(fs.readFileSync(fx.dbPath), before);

  const applied = run(fx, ['--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.appliedCount, 1);
  assert.equal(appliedReport.remainingCount, 0);
  assert.equal(fs.existsSync(appliedReport.backupPath), true);

  const db = new Database(fx.dbPath, { readonly: true });
  assert.deepEqual(
    db.prepare(`SELECT status,assigned_owner_id,previous_owner_id,rejected_by,rejected_at
      FROM crm_intake_items WHERE id='IN-RB-1786216512032-243'`).get(),
    {
      status: 'rejected', assigned_owner_id: '', previous_owner_id: 'U-WU',
      rejected_by: 'U-WU', rejected_at: '2026-08-11 10:25:00',
    },
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM crm_audit_log WHERE action='mismatch_recycle_reconciled'").get().count,
    1,
  );
  db.close();
});

test('package exposes separate mismatch check and apply commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['crm:mismatch:check'], 'node scripts/reconcile-mismatch-recycle.js');
  assert.equal(pkg.scripts['crm:mismatch:apply'], 'node scripts/reconcile-mismatch-recycle.js --apply');
});

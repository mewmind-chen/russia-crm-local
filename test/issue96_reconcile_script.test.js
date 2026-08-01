'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  listIntakeCrmConflicts,
  reconcileIntakeCrmInvariant,
} = require('../lib/intake_crm_invariant');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reconcile-intake-crm-invariant.js');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue96-reconcile-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      intake_item_id TEXT NOT NULL DEFAULT '',
      lifecycle_status TEXT NOT NULL DEFAULT 'active',
      assignment_status TEXT NOT NULL DEFAULT 'claimed',
      owner_id TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_intake_items (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      crm_customer_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      suggested_owner_id TEXT NOT NULL DEFAULT '',
      assigned_owner_id TEXT NOT NULL DEFAULT '',
      assigned_at TEXT NOT NULL DEFAULT '',
      claim_due_at TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      decision_reason TEXT NOT NULL DEFAULT '',
      return_reason TEXT NOT NULL DEFAULT '',
      duplicate_state TEXT NOT NULL DEFAULT '',
      duplicate_review_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    INSERT INTO crm_accounts
      (id,external_customer_id,intake_item_id,assignment_status,owner_id,claimed_at)
      VALUES
      ('CRM-DUP','RU-9601','','claimed','U-ACCOUNT-DUP','2026-07-19 11:00:00'),
      ('CRM-CLAIM','RU-9602','INTAKE-CLAIM','claimed','U-ACCOUNT-CLAIM','2026-07-19 12:00:00'),
      ('CRM-LEGAL-ASSIGNED','RU-9603','INTAKE-LEGAL-ASSIGNED','assigned','U-3',''),
      ('CRM-LEGAL-RETURNED','RU-9604','INTAKE-LEGAL-RETURNED','returned','',''),
      ('CRM-INACTIVE','RU-9605','INTAKE-INACTIVE','claimed','U-5','2026-07-19 13:00:00');
    UPDATE crm_accounts SET lifecycle_status='recycled' WHERE id='CRM-INACTIVE';
    INSERT INTO crm_intake_items
      (id,external_customer_id,crm_customer_id,status,suggested_owner_id,assigned_owner_id,
       assigned_at,claim_due_at,claimed_at,decision_reason,return_reason,
       duplicate_state,duplicate_review_id,updated_at)
      VALUES
      ('INTAKE-DUP','RU-9601','','assigned','U-1','U-1',
       '2026-07-19 08:00:00','2026-07-20 00:00:00','2026-07-19 10:00:00',
       'old decision','old return','review','REVIEW-1','2026-07-19 00:00:00'),
      ('INTAKE-CLAIM','RU-9602','','assigned','U-2','U-2',
       '2026-07-19 08:00:00','2026-07-20 00:00:00','','claim decision','',
       'cleared','','2026-07-19 00:00:00'),
      ('INTAKE-LEGAL-ASSIGNED','RU-9603','CRM-LEGAL-ASSIGNED','assigned','U-3','U-3',
       '2026-07-19 08:00:00','2026-07-20 00:00:00','','reassigned','',
       '','','2026-07-19 00:00:00'),
      ('INTAKE-LEGAL-RETURNED','RU-9604','CRM-LEGAL-RETURNED','returned','','',
       '','','','returned','normal return','','','2026-07-19 00:00:00');
    INSERT INTO crm_intake_items
      (id,external_customer_id,status,suggested_owner_id,assigned_owner_id,
       assigned_at,claim_due_at,updated_at)
      VALUES ('INTAKE-INACTIVE','RU-9605','assigned','U-5','U-5',
       '2026-07-19 08:00:00','2026-07-20 00:00:00','2026-07-19 00:00:00');
  `);
  db.close();
  return { dir, dbPath };
}

function run({ dir, dbPath }, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CRM_PRODUCTION_ROOT: path.join(dir, 'production-never-used'),
      CRM_RUNTIME_ROOT: dir,
      CRM_DB_PATH: dbPath,
      RECON_OUTPUT_DIR: path.join(dir, 'recon-runs'),
      CONTACT_RECON_OUTPUT_DIR: path.join(dir, 'contact-recon-runs'),
      CONTACT_RECON_REPORT_DIR: path.join(dir, 'contact-recon-reports'),
      CRM_REPORTS_DIR: path.join(dir, 'reports'),
      CRM_BACKUP_DIR: path.join(dir, 'backups'),
      CRM_LOGS_DIR: path.join(dir, 'logs'),
      CRM_OUTPUT_DIR: path.join(dir, 'output'),
      CRM_TMP_DIR: path.join(dir, 'tmp'),
    },
  });
}

test('reconciliation is read-only by default and apply backs up, fixes, and audits once', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));
  const before = fs.readFileSync(fx.dbPath);

  const preview = run(fx);
  assert.equal(preview.status, 0, preview.stderr);
  const previewReport = JSON.parse(preview.stdout);
  assert.equal(previewReport.mode, 'dry-run');
  assert.equal(previewReport.conflictCount, 2);
  assert.deepEqual(previewReport.conflicts.map(item => item.resolution), ['claimed', 'duplicate']);
  assert.deepEqual(fs.readFileSync(fx.dbPath), before);
  assert.equal(fs.existsSync(path.join(fx.dir, 'backups')), false);

  const applied = run(fx, ['--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  const appliedReport = JSON.parse(applied.stdout);
  assert.equal(appliedReport.mode, 'apply');
  assert.equal(appliedReport.appliedCount, 2);
  assert.equal(appliedReport.remainingConflictCount, 0);
  assert.equal(fs.existsSync(appliedReport.backupPath), true);

  const db = new Database(fx.dbPath, { readonly: true });
  assert.deepEqual(
    db.prepare(`SELECT id,status,crm_customer_id,assigned_owner_id,assigned_at,claim_due_at,
      claimed_at,return_reason,duplicate_state,duplicate_review_id
      FROM crm_intake_items ORDER BY id`).all(),
    [
      {
        id: 'INTAKE-CLAIM', status: 'claimed', crm_customer_id: 'CRM-CLAIM',
        assigned_owner_id: 'U-ACCOUNT-CLAIM', assigned_at: '2026-07-19 08:00:00',
        claim_due_at: '2026-07-20 00:00:00', claimed_at: '2026-07-19 12:00:00', return_reason: '',
        duplicate_state: 'cleared', duplicate_review_id: '',
      },
      {
        id: 'INTAKE-DUP', status: 'duplicate', crm_customer_id: 'CRM-DUP',
        assigned_owner_id: '', assigned_at: '', claim_due_at: '', claimed_at: '',
        return_reason: '', duplicate_state: 'exact', duplicate_review_id: '',
      },
      {
        id: 'INTAKE-INACTIVE', status: 'assigned', crm_customer_id: '',
        assigned_owner_id: 'U-5', assigned_at: '2026-07-19 08:00:00',
        claim_due_at: '2026-07-20 00:00:00', claimed_at: '', return_reason: '',
        duplicate_state: '', duplicate_review_id: '',
      },
      {
        id: 'INTAKE-LEGAL-ASSIGNED', status: 'assigned',
        crm_customer_id: 'CRM-LEGAL-ASSIGNED', assigned_owner_id: 'U-3',
        assigned_at: '2026-07-19 08:00:00', claim_due_at: '2026-07-20 00:00:00',
        claimed_at: '', return_reason: '', duplicate_state: '', duplicate_review_id: '',
      },
      {
        id: 'INTAKE-LEGAL-RETURNED', status: 'returned',
        crm_customer_id: 'CRM-LEGAL-RETURNED', assigned_owner_id: '', assigned_at: '',
        claim_due_at: '', claimed_at: '', return_reason: 'normal return',
        duplicate_state: '', duplicate_review_id: '',
      },
    ],
  );
  const audits = db.prepare(`SELECT action,entity_id,detail_json FROM crm_audit_log
    ORDER BY entity_id`).all();
  assert.equal(audits.length, 2);
  assert.equal(audits.every(row => row.action === 'intake_crm_invariant_reconciled'), true);
  assert.deepEqual(audits.map(row => JSON.parse(row.detail_json).after.status), ['claimed', 'duplicate']);
  const duplicateAudit = JSON.parse(audits.find(row => row.entity_id === 'INTAKE-DUP').detail_json);
  assert.deepEqual(
    {
      assignedAt: duplicateAudit.before.assignedAt,
      claimedAt: duplicateAudit.before.claimedAt,
      returnReason: duplicateAudit.before.returnReason,
      duplicateState: duplicateAudit.before.duplicateState,
      duplicateReviewId: duplicateAudit.before.duplicateReviewId,
    },
    {
      assignedAt: '2026-07-19 08:00:00',
      claimedAt: '2026-07-19 10:00:00',
      returnReason: 'old return',
      duplicateState: 'review',
      duplicateReviewId: 'REVIEW-1',
    },
  );
  db.close();

  const repeated = run(fx, ['--apply']);
  assert.equal(repeated.status, 0, repeated.stderr);
  const repeatedReport = JSON.parse(repeated.stdout);
  assert.equal(repeatedReport.appliedCount, 0);
  assert.equal(repeatedReport.remainingConflictCount, 0);
  assert.equal(fs.existsSync(repeatedReport.backupPath), true);
  assert.notEqual(repeatedReport.backupPath, appliedReport.backupPath);
  assert.equal(fs.readdirSync(path.join(fx.dir, 'backups')).length, 2);
  const verified = new Database(fx.dbPath, { readonly: true });
  assert.equal(verified.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count, 2);
  verified.close();
});

test('apply rescans under its transaction and ignores stale preview status and lineage', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));
  const db = new Database(fx.dbPath);
  t.after(() => db.close());

  const stalePreview = listIntakeCrmConflicts(db);
  assert.equal(stalePreview.length, 2);
  db.prepare("UPDATE crm_accounts SET assignment_status='returned' WHERE id='CRM-CLAIM'").run();
  db.prepare(`UPDATE crm_accounts SET intake_item_id='INTAKE-DUP',owner_id='U-CURRENT',claimed_at=''
    WHERE id='CRM-DUP'`).run();

  const result = reconcileIntakeCrmInvariant(db, { at: '2026-08-01 14:30:00' });
  assert.equal(result.scannedCount, 1);
  assert.equal(result.appliedCount, 1);
  assert.equal(result.remainingConflictCount, 0);
  assert.deepEqual(result.conflicts.map(item => [item.intakeItemId, item.resolution]), [
    ['INTAKE-DUP', 'claimed'],
  ]);
  assert.deepEqual(
    db.prepare(`SELECT id,status,crm_customer_id,assigned_owner_id,assigned_at,claim_due_at,claimed_at
      FROM crm_intake_items
      WHERE id IN ('INTAKE-DUP','INTAKE-CLAIM') ORDER BY id`).all(),
    [
      {
        id: 'INTAKE-CLAIM', status: 'assigned', crm_customer_id: '',
        assigned_owner_id: 'U-2', assigned_at: '2026-07-19 08:00:00',
        claim_due_at: '2026-07-20 00:00:00', claimed_at: '',
      },
      {
        id: 'INTAKE-DUP', status: 'claimed', crm_customer_id: 'CRM-DUP',
        assigned_owner_id: 'U-CURRENT', assigned_at: '2026-07-19 08:00:00',
        claim_due_at: '2026-07-20 00:00:00', claimed_at: '2026-07-19 10:00:00',
      },
    ],
  );
});

test('claimed reconciliation backfills empty CRM assignment metadata before updating intake', t => {
  const fx = fixture();
  t.after(() => fs.rmSync(fx.dir, { recursive: true, force: true }));
  const db = new Database(fx.dbPath);
  t.after(() => db.close());

  db.prepare(`UPDATE crm_accounts
    SET intake_item_id='INTAKE-DUP',owner_id='',claimed_at=''
    WHERE id='CRM-DUP'`).run();
  const result = reconcileIntakeCrmInvariant(db, { at: '2026-08-01 14:30:00' });
  assert.equal(result.appliedCount, 2);

  const metadata = db.prepare(`SELECT
      i.assigned_owner_id intake_owner_id,i.claimed_at intake_claimed_at,
      a.owner_id account_owner_id,a.claimed_at account_claimed_at
    FROM crm_intake_items i JOIN crm_accounts a ON a.id=i.crm_customer_id
    WHERE i.id='INTAKE-DUP'`).get();
  assert.deepEqual(metadata, {
    intake_owner_id: 'U-1',
    intake_claimed_at: '2026-07-19 10:00:00',
    account_owner_id: 'U-1',
    account_claimed_at: '2026-07-19 10:00:00',
  });
});

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { databasePath, runtimePaths } = require('../lib/runtime_paths');

const apply = process.argv.includes('--apply');

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function backupStamp() {
  return `${new Date().toISOString().replace(/[-:T.Z]/g, '')}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

function requiredColumnsPresent(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name),
  );
  return ['previous_owner_id', 'rejected_by', 'rejected_at']
    .every(column => columns.has(column));
}

function orphanedRejectedRows(db) {
  if (!requiredColumnsPresent(db)) {
    const error = new Error('当前数据库尚未安装不对口回收元数据字段，请先部署应用更新');
    error.code = 'MISMATCH_SCHEMA_NOT_READY';
    throw error;
  }
  return db.prepare(`SELECT id intakeItemId,external_customer_id externalCustomerId,
      company_name companyName,assigned_owner_id assignedOwnerId,
      previous_owner_id previousOwnerId,rejected_by rejectedBy,rejected_at rejectedAt,
      return_reason reason,updated_at updatedAt
    FROM crm_intake_items
    WHERE status='rejected' AND COALESCE(crm_customer_id,'')=''
      AND (COALESCE(previous_owner_id,'')='' OR COALESCE(rejected_by,'')=''
        OR COALESCE(rejected_at,'')='')
    ORDER BY updated_at,id`).all().map(row => ({
      ...row,
      recoverableOwnerId: row.previousOwnerId || row.assignedOwnerId || '',
      recoverableRejectedBy: row.rejectedBy || row.previousOwnerId || row.assignedOwnerId || '',
      recoverableRejectedAt: row.rejectedAt || row.updatedAt || '',
    }));
}

function applyRepairs(db) {
  const rows = orphanedRejectedRows(db);
  const repairable = rows.filter(row => row.recoverableOwnerId
    && row.recoverableRejectedBy && row.recoverableRejectedAt);
  const repairedAt = nowText();
  let appliedCount = 0;
  db.transaction(() => {
    for (const row of repairable) {
      const changed = db.prepare(`UPDATE crm_intake_items SET assigned_owner_id='',
        previous_owner_id=?,rejected_by=?,rejected_at=?,updated_at=?
        WHERE id=? AND status='rejected' AND COALESCE(crm_customer_id,'')=''
          AND (COALESCE(previous_owner_id,'')='' OR COALESCE(rejected_by,'')=''
            OR COALESCE(rejected_at,'')='')`).run(
        row.recoverableOwnerId, row.recoverableRejectedBy, row.recoverableRejectedAt,
        repairedAt, row.intakeItemId,
      );
      if (changed.changes !== 1) continue;
      appliedCount += 1;
      db.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at,
         real_user_id,effective_user_id,impersonation_context_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        uniqueId('AUD'), 'system', 'mismatch_recycle_reconciled', 'crm_intake_item',
        row.intakeItemId, JSON.stringify({
          externalCustomerId: row.externalCustomerId,
          previousOwnerId: row.recoverableOwnerId,
          rejectedBy: row.recoverableRejectedBy,
          rejectedAt: row.recoverableRejectedAt,
          reason: row.reason,
        }), repairedAt, 'system', 'system', '',
      );
    }
  }).immediate();
  return { rows, repairableCount: repairable.length, appliedCount };
}

async function main() {
  const dbPath = databasePath();
  const preview = new Database(dbPath, { readonly: true, fileMustExist: true });
  let rows;
  try {
    rows = orphanedRejectedRows(preview);
  } finally { preview.close(); }

  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run', databasePath: dbPath, orphanedRejected: rows.length, rows,
    }, null, 2)}\n`);
    return;
  }

  const backupDir = runtimePaths().backupDir;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDir, `crm-before-issue273-mismatch-${backupStamp()}.db`);
  const db = new Database(dbPath, { fileMustExist: true });
  let result;
  try {
    db.pragma('busy_timeout = 10000');
    await db.backup(backupPath);
    result = applyRepairs(db);
    result.remainingCount = orphanedRejectedRows(db).length;
  } finally { db.close(); }

  process.stdout.write(`${JSON.stringify({
    mode: 'apply', databasePath: dbPath, orphanedRejected: rows.length,
    repairableCount: result.repairableCount, appliedCount: result.appliedCount,
    remainingCount: result.remainingCount, backupPath, rows: result.rows,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { orphanedRejectedRows, applyRepairs };

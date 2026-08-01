#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { listIntakeCrmConflicts, reconcileIntakeCrmInvariant } = require('../lib/intake_crm_invariant');
const { databasePath, runtimePaths } = require('../lib/runtime_paths');

const apply = process.argv.includes('--apply');

function stamp() {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '');
  return `${timestamp}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

async function main() {
  const dbPath = databasePath();
  const previewDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  let conflicts;
  try {
    conflicts = listIntakeCrmConflicts(previewDb);
  } finally {
    previewDb.close();
  }

  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run',
      databasePath: dbPath,
      conflictCount: conflicts.length,
      conflicts,
    }, null, 2)}\n`);
    return;
  }

  const backupDir = runtimePaths().backupDir;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(backupDir, `crm-before-issue96-reconcile-${stamp()}.db`);
  const db = new Database(dbPath, { fileMustExist: true });
  let result;
  try {
    db.pragma('busy_timeout = 10000');
    await db.backup(backupPath);
    result = reconcileIntakeCrmInvariant(db);
  } finally {
    db.close();
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'apply',
    databasePath: dbPath,
    previewConflictCount: conflicts.length,
    conflictCount: result.scannedCount,
    appliedCount: result.appliedCount,
    remainingConflictCount: result.remainingConflictCount,
    backupPath,
    conflicts: result.conflicts,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

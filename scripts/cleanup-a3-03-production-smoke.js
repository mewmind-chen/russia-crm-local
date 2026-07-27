#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { cleanupLegacyA303Smoke, LEGACY_A303_NEXT_ACTION } = require('../lib/smoke_test_data');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : String(process.argv[index + 1] || '').trim();
}

const dbPath = path.resolve(argument('--db'));
const backupPath = path.resolve(argument('--backup'));
const accountId = argument('--account-id');
const expectedUpdatedAt = argument('--expected-updated-at');
const actorId = argument('--actor-id');
const apply = process.argv.includes('--apply');

if (!argument('--db') || !argument('--backup') || !accountId || !expectedUpdatedAt || !actorId) {
  throw new Error('required: --db --backup --account-id --expected-updated-at --actor-id [--apply]');
}
if (dbPath === backupPath || !fs.existsSync(dbPath) || !fs.existsSync(backupPath)) {
  throw new Error('source database and an existing separate backup are required');
}
const backup = new Database(backupPath, { readonly: true });
try {
  if (backup.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('backup quick_check failed');
} finally {
  backup.close();
}

const db = new Database(dbPath, { readonly: !apply });
try {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('source quick_check failed');
  const account = db.prepare('SELECT id,company_name,next_action,next_action_at,updated_at FROM crm_accounts WHERE id=?')
    .get(accountId);
  const preview = {
    mode: apply ? 'apply' : 'dry-run',
    account,
    exactLegacyValue: account?.next_action === LEGACY_A303_NEXT_ACTION,
    expectedUpdatedAtMatches: account?.updated_at === expectedUpdatedAt,
    backupPath,
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
  } else {
    const result = cleanupLegacyA303Smoke(db, { accountId, expectedUpdatedAt, actorId });
    const quickCheck = db.pragma('quick_check', { simple: true });
    process.stdout.write(`${JSON.stringify({ ...preview, result, quickCheck }, null, 2)}\n`);
  }
} finally {
  db.close();
}

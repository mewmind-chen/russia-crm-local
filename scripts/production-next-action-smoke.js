#!/usr/bin/env node
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const { databasePath } = require('../lib/runtime_paths');
const { installSalesCrm } = require('../lib/sales_crm');
const { cleanupNextActionSmoke, prepareNextActionSmoke } = require('../lib/smoke_test_data');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : String(process.argv[index + 1] || '').trim();
}

const action = argument('--action');
const runId = argument('--run-id');
const actorId = argument('--actor-id') || 'USR-ADMIN';
if (!['prepare', 'cleanup'].includes(action) || !runId || !process.argv.includes('--apply')) {
  throw new Error('required: --action prepare|cleanup --run-id <unique-id> --apply [--actor-id <admin-id>]');
}
installSalesCrm();
const db = new Database(databasePath());
try {
  const result = action === 'prepare'
    ? prepareNextActionSmoke(db, { runId, actorId })
    : cleanupNextActionSmoke(db, { runId, actorId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  db.close();
}

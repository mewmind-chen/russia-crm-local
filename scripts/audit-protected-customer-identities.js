#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  auditProtectedCustomerIdentities,
} = require('../lib/customer_identity_registry');

function usage() {
  process.stderr.write(
    'Usage: node scripts/audit-protected-customer-identities.js --db ABSOLUTE_PATH [--json]\n',
  );
}

function cliError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function canonicalSnapshotPath(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  const realPath = fs.realpathSync.native(resolvedPath);
  if (realPath !== resolvedPath) {
    throw cliError(
      '--db must be a canonical path without symlinks',
      'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL',
    );
  }
  if (fs.statSync(resolvedPath).nlink !== 1) {
    throw cliError(
      '--db must be an independent snapshot file with one filesystem link',
      'CUSTOMER_IDENTITY_DB_HARDLINK_NOT_ALLOWED',
    );
  }
  return resolvedPath;
}

function parseArgs(argv) {
  const options = { database: '', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      if (options.database || !argv[index + 1]) {
        throw cliError('--db requires one value', 'CUSTOMER_IDENTITY_DB_ARGUMENT_INVALID');
      }
      options.database = argv[index + 1];
      index += 1;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else if (argument === '--apply') {
      throw cliError(
        'This preflight is read-only; --apply is not supported',
        'CUSTOMER_IDENTITY_APPLY_NOT_SUPPORTED',
      );
    } else {
      throw cliError(`unknown argument: ${argument}`, 'CUSTOMER_IDENTITY_ARGUMENT_UNKNOWN');
    }
  }
  if (!options.database) {
    throw cliError('--db is required', 'CUSTOMER_IDENTITY_DB_REQUIRED');
  }
  if (!path.isAbsolute(options.database)) {
    throw cliError(
      '--db must be an absolute path',
      'CUSTOMER_IDENTITY_DB_PATH_NOT_ABSOLUTE',
    );
  }
  if (!fs.existsSync(options.database) || !fs.statSync(options.database).isFile()) {
    throw cliError(
      '--db must identify an existing database file',
      'CUSTOMER_IDENTITY_DB_NOT_FOUND',
    );
  }
  options.database = canonicalSnapshotPath(options.database);
  return options;
}

function statEvidence(filePath) {
  const stat = fs.statSync(filePath, { bigint: true });
  return {
    device: stat.dev,
    inode: stat.ino,
    links: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

function sameEvidence(left, right) {
  return Object.keys(left).every(key => left[key] === right[key]);
}

function existingSidecarEvidence(filePath) {
  try {
    return statEvidence(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function snapshotStateError() {
  return cliError(
    'Database is not a completed standalone snapshot; create a SQLite online backup first',
    'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
  );
}

function readStandaloneSnapshot(databasePath) {
  const canonicalPath = canonicalSnapshotPath(databasePath);
  if (canonicalPath !== databasePath) {
    throw cliError(
      '--db must be a canonical path without symlinks',
      'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL',
    );
  }
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const journalPath = `${databasePath}-journal`;
  const walBefore = existingSidecarEvidence(walPath);
  if ((walBefore && walBefore.size > 0n)
    || existingSidecarEvidence(shmPath)
    || existingSidecarEvidence(journalPath)) {
    throw snapshotStateError();
  }
  const databaseBefore = statEvidence(databasePath);
  const image = fs.readFileSync(databasePath);
  const databaseAfter = statEvidence(databasePath);
  const walAfter = existingSidecarEvidence(walPath);
  if (!sameEvidence(databaseBefore, databaseAfter)
    || Boolean(walBefore) !== Boolean(walAfter)
    || (walBefore && !sameEvidence(walBefore, walAfter))
    || (walAfter && walAfter.size > 0n)
    || existingSidecarEvidence(shmPath)
    || existingSidecarEvidence(journalPath)) {
    throw snapshotStateError();
  }
  canonicalSnapshotPath(databasePath);
  if (image.length < 100 || image.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
    throw cliError('Database snapshot is not a valid SQLite file', 'CUSTOMER_IDENTITY_DB_INVALID');
  }
  const writeVersion = image[18];
  const readVersion = image[19];
  if (![1, 2].includes(writeVersion) || ![1, 2].includes(readVersion)
    || writeVersion !== readVersion) {
    throw cliError('Database snapshot has unsupported SQLite header values', 'CUSTOMER_IDENTITY_DB_INVALID');
  }
  if (writeVersion === 2) {
    // The source remains untouched. A completed, WAL-free snapshot can use rollback mode in memory.
    image[18] = 1;
    image[19] = 1;
  }
  return image;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new Database(readStandaloneSnapshot(options.database), { readonly: true });
  try {
    db.pragma('query_only = ON');
    const report = auditProtectedCustomerIdentities(db, { apply: false });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(
        `aliases=${report.aliases.length} conflicts=${report.conflicts.length} unresolved=${report.unresolved}\n`,
      );
    }
  } finally {
    db.close();
  }
}

const jsonRequested = process.argv.slice(2).includes('--json');
try {
  main();
} catch (error) {
  if (jsonRequested) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: String(error.code || 'CUSTOMER_IDENTITY_PREFLIGHT_FAILED'),
        message: String(error.message || 'Identity preflight failed'),
      },
    })}\n`);
  } else {
    usage();
    process.stderr.write(`identity preflight failed: ${error.message}\n`);
  }
  process.exitCode = 1;
}

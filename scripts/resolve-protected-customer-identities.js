#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  auditProtectedCustomerIdentities,
} = require('../lib/customer_identity_registry');
const {
  installProtectedCustomerConflicts,
  listProtectedIdentityConflicts,
  resolveProtectedIdentityConflict,
} = require('../lib/protected_customer_conflicts');

const DECISIONS = new Set([
  'link_existing',
  'confirm_new',
  'supplement_and_retry',
]);

function usage() {
  process.stderr.write(
    'Usage: node scripts/resolve-protected-customer-identities.js '
      + '--db ABSOLUTE_PATH --conflict-id ID --decision DECISION '
      + '--expected-version VERSION --details REASON '
      + '[--target-external-customer-id ID] [--apply] [--json]\n',
  );
}

function cliError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readValue(argv, index, argument) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw cliError(
      `${argument} requires one value`,
      'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_INVALID',
    );
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    apply: false,
    conflictId: '',
    database: '',
    decision: '',
    details: '',
    expectedVersion: '',
    json: false,
    targetExternalCustomerId: '',
  };
  const valueArguments = new Map([
    ['--db', 'database'],
    ['--conflict-id', 'conflictId'],
    ['--decision', 'decision'],
    ['--expected-version', 'expectedVersion'],
    ['--details', 'details'],
    ['--target-external-customer-id', 'targetExternalCustomerId'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueArguments.has(argument)) {
      const key = valueArguments.get(argument);
      if (options[key]) {
        throw cliError(
          `${argument} may only be provided once`,
          'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_INVALID',
        );
      }
      options[key] = readValue(argv, index, argument).trim();
      index += 1;
    } else if (argument === '--apply') {
      if (options.apply) {
        throw cliError(
          '--apply may only be provided once',
          'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_INVALID',
        );
      }
      options.apply = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      usage();
      process.exit(0);
    } else {
      throw cliError(
        `unknown argument: ${argument}`,
        'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_UNKNOWN',
      );
    }
  }

  const required = [
    ['database', '--db'],
    ['conflictId', '--conflict-id'],
    ['decision', '--decision'],
    ['expectedVersion', '--expected-version'],
    ['details', '--details'],
  ];
  const missing = required.find(([key]) => !options[key]);
  if (missing) {
    throw cliError(
      `${missing[1]} is required`,
      'CUSTOMER_IDENTITY_RESOLUTION_ARGUMENT_REQUIRED',
    );
  }
  if (!DECISIONS.has(options.decision)) {
    throw cliError(
      '--decision must be link_existing, confirm_new, or supplement_and_retry',
      'CUSTOMER_IDENTITY_RESOLUTION_DECISION_INVALID',
    );
  }
  if (['link_existing', 'confirm_new'].includes(options.decision)
    && !options.targetExternalCustomerId) {
    throw cliError(
      '--target-external-customer-id is required for link_existing and confirm_new',
      'CUSTOMER_IDENTITY_RESOLUTION_TARGET_REQUIRED',
    );
  }
  if (options.decision === 'supplement_and_retry' && options.targetExternalCustomerId) {
    throw cliError(
      '--target-external-customer-id is not valid for supplement_and_retry',
      'CUSTOMER_IDENTITY_RESOLUTION_TARGET_NOT_ALLOWED',
    );
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
  assertNotProductionLiveDatabase(options.database);
  return options;
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

function configuredProductionRoot() {
  const configured = path.resolve(
    String(process.env.CRM_PRODUCTION_ROOT || '').trim()
      || path.join(os.homedir(), 'Desktop', 'projects', 'tradepulse-production'),
  );
  try {
    return fs.realpathSync.native(configured);
  } catch (error) {
    if (error.code === 'ENOENT') return configured;
    throw error;
  }
}

function canonicalConfiguredPath(input) {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync.native(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') return resolved;
    throw error;
  }
}

function assertNotProductionLiveDatabase(databasePath) {
  const candidates = [
    path.join(configuredProductionRoot(), 'shared', 'data', 'crm.db'),
  ];
  if (String(process.env.CRM_PRODUCTION_DB_PATH || '').trim()) {
    candidates.push(canonicalConfiguredPath(process.env.CRM_PRODUCTION_DB_PATH));
  }
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
    && String(process.env.CRM_DB_PATH || '').trim()) {
    candidates.push(canonicalConfiguredPath(process.env.CRM_DB_PATH));
  }
  if (candidates.some(candidate => path.resolve(candidate) === databasePath)) {
    throw cliError(
      'The production live database cannot be used by the conflict resolution CLI; create an independent SQLite backup first',
      'CUSTOMER_IDENTITY_PRODUCTION_DB_NOT_ALLOWED',
    );
  }
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
    const stat = fs.lstatSync(filePath, { bigint: true });
    return {
      device: stat.dev,
      inode: stat.ino,
      links: stat.nlink,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertTrustedApplyPath(databasePath) {
  if (typeof process.getuid !== 'function') return;
  const expectedUid = BigInt(process.getuid());
  const databaseStat = fs.statSync(databasePath, { bigint: true });
  const directoryStat = fs.statSync(path.dirname(databasePath), { bigint: true });
  const unsafeMode = 0o022n;
  if (databaseStat.uid !== expectedUid
      || directoryStat.uid !== expectedUid
      || (databaseStat.mode & unsafeMode) !== 0n
      || (directoryStat.mode & unsafeMode) !== 0n) {
    throw cliError(
      'Apply requires a snapshot file and parent directory owned by the current user and not writable by group or others',
      'CUSTOMER_IDENTITY_DB_PATH_UNTRUSTED',
    );
  }
}

function snapshotStateError() {
  return cliError(
    'Database is not a completed standalone snapshot; create a SQLite online backup first',
    'CUSTOMER_IDENTITY_SNAPSHOT_NOT_STANDALONE',
  );
}

function assertNoSidecars(databasePath) {
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const journalPath = `${databasePath}-journal`;
  if (existingSidecarEvidence(walPath)
    || existingSidecarEvidence(shmPath)
    || existingSidecarEvidence(journalPath)) {
    throw snapshotStateError();
  }
}

function readStandaloneSnapshot(databasePath, options = {}) {
  const canonicalPath = canonicalSnapshotPath(databasePath);
  if (canonicalPath !== databasePath) {
    throw cliError(
      '--db must be a canonical path without symlinks',
      'CUSTOMER_IDENTITY_DB_PATH_NOT_CANONICAL',
    );
  }
  assertNotProductionLiveDatabase(canonicalPath);
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  const journalPath = `${databasePath}-journal`;
  const walBefore = existingSidecarEvidence(walPath);
  assertNoSidecars(databasePath);
  const databaseBefore = statEvidence(databasePath);
  const image = fs.readFileSync(databasePath);
  const databaseAfter = statEvidence(databasePath);
  const walAfter = existingSidecarEvidence(walPath);
  if (!sameEvidence(databaseBefore, databaseAfter)
    || Boolean(walBefore) !== Boolean(walAfter)
    || walAfter
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
    if (!options.allowWalHeader) throw snapshotStateError();
    image[18] = 1;
    image[19] = 1;
  }
  return { databaseBefore, image };
}

function cliAdmin() {
  let username = 'unknown';
  try {
    username = os.userInfo().username || username;
  } catch (_error) {
    // Keep audit attribution stable even in a restricted service account.
  }
  return {
    id: `identity-resolution-cli:${username}`,
    role: 'admin',
    permissions: { manage_protected_customers: true },
    isImpersonating: false,
  };
}

function withResolutionWriteGate(callback) {
  // This dedicated process reaches here only after the target passes every snapshot boundary check.
  const key = 'CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED';
  const hadValue = Object.hasOwn(process.env, key);
  const previousValue = process.env[key];
  process.env[key] = 'true';
  try {
    return callback();
  } finally {
    if (hadValue) process.env[key] = previousValue;
    else delete process.env[key];
  }
}

function resolveOnDatabase(db, options) {
  installProtectedCustomerConflicts(db);
  const user = cliAdmin();
  const resolution = withResolutionWriteGate(() => resolveProtectedIdentityConflict(db, user, {
    conflictId: options.conflictId,
    decision: options.decision,
    targetExternalCustomerId: options.targetExternalCustomerId,
    details: options.details,
    expectedVersion: options.expectedVersion,
  }));
  const unresolved = listProtectedIdentityConflicts(db, user, {
    status: 'unresolved',
    page: 1,
  });
  const rawReport = auditProtectedCustomerIdentities(db, { apply: false });
  const unresolvedCount = Math.max(
    Number(unresolved.unresolved || 0),
    Number(rawReport.unresolved || 0),
  );
  return {
    ok: true,
    mode: options.apply ? 'apply' : 'preview',
    applied: options.apply,
    resolution,
    gate: {
      unresolved: unresolvedCount,
      canEnter172B: unresolvedCount === 0,
      rawConflicts: rawReport.conflicts.length,
      auditUnresolved: rawReport.unresolved,
      reportVersion: rawReport.reportVersion,
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = readStandaloneSnapshot(options.database, {
    allowWalHeader: !options.apply,
  });
  let db;
  if (options.apply) {
    assertTrustedApplyPath(options.database);
    if (!sameEvidence(snapshot.databaseBefore, statEvidence(options.database))) {
      throw snapshotStateError();
    }
    db = new Database(options.database, { fileMustExist: true });
    if (canonicalSnapshotPath(options.database) !== options.database
      || !sameEvidence(snapshot.databaseBefore, statEvidence(options.database))) {
      db.close();
      throw snapshotStateError();
    }
    try {
      assertNoSidecars(options.database);
    } catch (error) {
      db.close();
      throw error;
    }
  } else {
    db = new Database(snapshot.image);
  }
  let result;
  try {
    if (options.apply) db.exec('BEGIN IMMEDIATE');
    try {
      result = resolveOnDatabase(db, options);
      if (options.apply) db.exec('COMMIT');
    } catch (error) {
      if (options.apply && db.inTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `mode=${result.mode} decision=${result.resolution.decision} `
      + `unresolved=${result.gate.unresolved} canEnter172B=${result.gate.canEnter172B}\n`,
  );
}

const jsonRequested = process.argv.slice(2).includes('--json');
try {
  main();
} catch (error) {
  if (jsonRequested) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: String(error.code || 'CUSTOMER_IDENTITY_RESOLUTION_FAILED'),
        message: String(error.message || 'Identity conflict resolution failed'),
      },
    })}\n`);
  } else {
    usage();
    process.stderr.write(`identity conflict resolution failed: ${error.message}\n`);
  }
  process.exitCode = 1;
}

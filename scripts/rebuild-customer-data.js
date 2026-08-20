#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  loadRebuildPackage,
  planCustomerRebuild,
  createRebuildManifest,
  applyCustomerRebuild,
  hashFile,
} = require('../lib/customer_rebuild');

const EXACT_RERUN_CONTRACT = Object.freeze({
  customers: 1895,
  excluded: 6,
  total: 1901,
  ready: 1334,
  review: 561,
});

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        args[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args[key] = next;
          i += 1;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function requireFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`file not found: ${absolute}`);
  }
  return absolute;
}

function readPackageSha(filePath) {
  return fs
    .readFileSync(requireFile(filePath), 'utf8')
    .trim()
    .split(/\s+/)[0];
}

function sameInode(a, b) {
  return fs.statSync(a).ino === fs.statSync(b).ino;
}

function onlineBackup(sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    const source = new Database(sourcePath, { readonly: true });
    source
      .backup(destPath)
      .then(() => {
        source.close();
        resolve(destPath);
      })
      .catch((err) => {
        source.close();
        reject(err);
      });
  });
}

function integrityOk(db) {
  const checks = sqliteChecks(db);
  return checks.quickCheck === 'ok' && checks.integrityCheck === 'ok';
}

function sqliteChecks(db) {
  const quick = db.pragma('quick_check') || [];
  const integrity = db.pragma('integrity_check') || [];
  const quickResult = quick[0] && typeof quick[0] === 'object'
    ? quick[0].quick_check
    : quick[0];
  const integrityResult = integrity[0] && typeof integrity[0] === 'object'
    ? integrity[0].integrity_check
    : integrity[0];
  return {
    quickCheck: String(quickResult || '').toLowerCase(),
    integrityCheck: String(integrityResult || '').toLowerCase(),
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function openDatabase(filePath, mode) {
  const db = new Database(filePath, {
    readonly: mode === 'readonly',
    fileMustExist: true,
  });
  db.pragma('foreign_keys = ON');
  return db;
}

function exactContractError(message) {
  return new Error(`exact rerun package contract failed: ${message}`);
}

function assertExactRerunPackageContract(pkg) {
  const readyIds = pkg.customers
    .filter((customer) => customer.dataStatus === 'READY')
    .map((customer) => customer.customerId);
  const reviewIds = pkg.customers
    .filter((customer) => customer.dataStatus === 'REVIEW')
    .map((customer) => customer.customerId);
  if (pkg.customers.length !== EXACT_RERUN_CONTRACT.customers) {
    throw exactContractError(
      `customers must equal ${EXACT_RERUN_CONTRACT.customers}; got ${pkg.customers.length}`,
    );
  }
  if (pkg.excluded.length !== EXACT_RERUN_CONTRACT.excluded) {
    throw exactContractError(
      `excluded must equal ${EXACT_RERUN_CONTRACT.excluded}; got ${pkg.excluded.length}`,
    );
  }
  if (pkg.customers.length + pkg.excluded.length !== EXACT_RERUN_CONTRACT.total) {
    throw exactContractError(
      `partition must equal ${EXACT_RERUN_CONTRACT.total}`,
    );
  }
  if (
    readyIds.length !== EXACT_RERUN_CONTRACT.ready ||
    reviewIds.length !== EXACT_RERUN_CONTRACT.review
  ) {
    throw exactContractError(
      `READY/REVIEW must equal ${EXACT_RERUN_CONTRACT.ready}/${EXACT_RERUN_CONTRACT.review}; got ${readyIds.length}/${reviewIds.length}`,
    );
  }
  const invalidExcluded = pkg.excluded.find(
    (customer) => customer.dataStatus !== 'EXCLUDED',
  );
  if (invalidExcluded) {
    throw exactContractError(
      `excluded customer ${invalidExcluded.customerId} must have dataStatus EXCLUDED`,
    );
  }
  const reviewQueue = pkg.reviewQueue || [];
  const reviewSet = new Set(reviewIds);
  const queueCounts = new Map();
  for (const item of reviewQueue) {
    queueCounts.set(item.customerId, (queueCounts.get(item.customerId) || 0) + 1);
  }
  const invalidQueueIds = [...queueCounts.keys()].filter(
    (customerId) => !reviewSet.has(customerId),
  );
  const missingOrDuplicate = reviewIds.filter(
    (customerId) => queueCounts.get(customerId) !== 1,
  );
  if (
    reviewQueue.length !== EXACT_RERUN_CONTRACT.review ||
    invalidQueueIds.length > 0 ||
    missingOrDuplicate.length > 0
  ) {
    throw exactContractError(
      `reviewQueue must contain every REVIEW customer exactly once and no others`,
    );
  }
  const hasUnresolved = Object.prototype.hasOwnProperty.call(
    pkg,
    'unresolvedDuplicateGroups',
  );
  const unresolved = pkg.unresolvedDuplicateGroups;
  if (
    !hasUnresolved ||
    typeof unresolved !== 'number' ||
    !Number.isFinite(unresolved) ||
    !Number.isInteger(unresolved) ||
    unresolved !== 0
  ) {
    throw exactContractError(
      'unresolvedDuplicateGroups must be present as the exact numeric integer 0',
    );
  }
}

function assertNoBackupSidecars(absolute) {
  if (fs.existsSync(`${absolute}-wal`) || fs.existsSync(`${absolute}-shm`)) {
    throw new Error('backup WAL/SHM artifacts are not allowed');
  }
}

function assertBackupFileShape(absolute, sourcePath) {
  const lstat = fs.lstatSync(absolute);
  if (!lstat.isFile()) {
    throw new Error('backup must be a distinct regular file');
  }
  if (lstat.size === 0) throw new Error('backup is empty');
  if (lstat.nlink !== 1) {
    throw new Error('backup link count must equal one');
  }
  const stat = fs.statSync(absolute);
  if (sourcePath) {
    const sourceStat = fs.statSync(path.resolve(sourcePath));
    if (sourceStat.dev === stat.dev && sourceStat.ino === stat.ino) {
      throw new Error('backup must be a distinct regular file');
    }
  }
  return stat;
}

function validateProvenanceInputs(context) {
  const inputs = [context.pkg, context.packageSha256, context.planManifest];
  const hasAny = inputs.some((value) => value !== undefined);
  const hasAll = inputs.every((value) => value !== undefined);
  if (hasAny && !hasAll) {
    throw new Error('backup manifest provenance inputs are incomplete');
  }
  return hasAll;
}

function inspectReadonlyBackup(filePath, context, requireProvenance) {
  let db;
  try {
    db = openDatabase(filePath, 'readonly');
    const checks = sqliteChecks(db);
    if (checks.quickCheck !== 'ok' || checks.integrityCheck !== 'ok') {
      throw new Error(
        `quick_check=${checks.quickCheck}, integrity_check=${checks.integrityCheck}`,
      );
    }
    let provenanceManifest;
    if (requireProvenance) {
      provenanceManifest = createRebuildManifest(
        planCustomerRebuild(db, context.pkg, context.packageSha256),
      );
      if (provenanceManifest !== context.planManifest) {
        throw new Error('manifest provenance mismatch');
      }
    }
    return {
      quickCheck: checks.quickCheck,
      integrityCheck: checks.integrityCheck,
      ...(provenanceManifest ? { planManifest: provenanceManifest } : {}),
    };
  } finally {
    if (db) db.close();
  }
}

function validateBackupFile(backupFile, context = {}) {
  try {
    const absolute = path.resolve(backupFile);
    const requireProvenance = validateProvenanceInputs(context);
    const initialStat = assertBackupFileShape(absolute, context.sourcePath);
    const sha256 = hashFile(absolute);
    const afterHashStat = assertBackupFileShape(absolute, context.sourcePath);
    if (
      initialStat.dev !== afterHashStat.dev ||
      initialStat.ino !== afterHashStat.ino
    ) {
      throw new Error('backup file identity changed during validation');
    }

    let restoreDir;
    try {
      restoreDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'crm-rebuild-main-file-restore-'),
      );
      const restoredPath = path.join(restoreDir, 'rollback.db');
      fs.copyFileSync(absolute, restoredPath, fs.constants.COPYFILE_EXCL);
      assertBackupFileShape(restoredPath);
      assertNoBackupSidecars(restoredPath);
      const restoredSha256 = hashFile(restoredPath);
      if (restoredSha256 !== sha256) {
        throw new Error('main-file-only restore SHA mismatch');
      }
      const restored = inspectReadonlyBackup(
        restoredPath,
        context,
        requireProvenance,
      );
      assertBackupFileShape(restoredPath);
      const finalStat = assertBackupFileShape(absolute, context.sourcePath);
      if (
        finalStat.dev !== initialStat.dev ||
        finalStat.ino !== initialStat.ino ||
        finalStat.size !== initialStat.size ||
        hashFile(absolute) !== sha256
      ) {
        throw new Error('backup changed during validation');
      }
      return {
        path: absolute,
        sha256,
        size: finalStat.size,
        mtimeMs: finalStat.mtimeMs,
        mtime: finalStat.mtime.toISOString(),
        quickCheck: restored.quickCheck,
        integrityCheck: restored.integrityCheck,
        ...(restored.planManifest ? { planManifest: restored.planManifest } : {}),
        mainFileRestore: {
          sha256: restoredSha256,
          quickCheck: restored.quickCheck,
          integrityCheck: restored.integrityCheck,
          ...(restored.planManifest
            ? { planManifest: restored.planManifest }
            : {}),
        },
      };
    } finally {
      if (restoreDir) {
        fs.rmSync(restoreDir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    throw new Error(`rollback backup validation failed: ${err.message}`);
  }
}

const REHEARSAL_GATE_FIELDS = [
  'sourceUnchanged',
  'sourceHashUnchanged',
  'schemaFingerprintStable',
  'preservedHashesStable',
  'reconciliationOk',
  'quickCheckOk',
  'integrityCheckOk',
];

function assertRehearsalGates(evidence) {
  const failed = REHEARSAL_GATE_FIELDS.filter((field) => evidence[field] !== true);
  if (failed.length > 0) {
    throw new Error(`rehearsal gates failed: ${failed.join(', ')}`);
  }
}

function writeAndAssertRehearsalEvidence(filePath, evidence) {
  writeJson(filePath, evidence);
  assertRehearsalGates(evidence);
}

async function cmdPlan(args) {
  const database = requireFile(args.database);
  const packagePath = requireFile(args.package);
  const sha = readPackageSha(args['package-sha256-file']);
  const outputDir = path.resolve(args.output || 'tmp/customer-rebuild/plan');
  if (args['package-sha256'] && args['package-sha256'] !== sha) {
    throw new Error('--package-sha256 does not match file');
  }
  const pkg = loadRebuildPackage(packagePath, sha);
  assertExactRerunPackageContract(pkg);
  const db = openDatabase(database, 'readonly');
  let plan;
  try {
    plan = planCustomerRebuild(db, pkg, sha);
  } finally {
    db.close();
  }
  const manifest = createRebuildManifest(plan);
  writeJson(path.join(outputDir, 'plan.json'), plan);
  fs.writeFileSync(path.join(outputDir, 'manifest.txt'), manifest);
  console.log(
    JSON.stringify(
      {
        mode: 'plan',
        schemaFingerprint: plan.schemaFingerprint,
        clearedTables: plan.clearedTables.length,
        replacedTables: plan.replacedTables.length,
        preservedTables: plan.preservedTables.length,
        unclassified: plan.unclassifiedCustomerTables.length,
        beforeCounts: plan.beforeCounts,
        manifest,
        outputDir,
      },
      null,
      2,
    ),
  );
}

async function cmdRehearse(args) {
  const database = requireFile(args.database);
  const packagePath = requireFile(args.package);
  const sha = readPackageSha(args['package-sha256-file']);
  const pkg = loadRebuildPackage(packagePath, sha);
  assertExactRerunPackageContract(pkg);
  const outputDir = path.resolve(
    args.output || 'tmp/customer-rebuild/rehearsal',
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const rehearsalDb = path.join(outputDir, 'rehearsed.db');
  const beforeStat = fs.statSync(database);
  const beforeHash = hashFile(database);
  await onlineBackup(database, rehearsalDb);
  const backup = validateBackupFile(rehearsalDb, { sourcePath: database });

  const db = openDatabase(rehearsalDb, 'readwrite');
  let manifest;
  let report;
  let reconciliation;
  try {
    const plan = planCustomerRebuild(db, pkg, sha);
    manifest = createRebuildManifest(plan);
    writeJson(path.join(outputDir, 'plan.json'), plan);
    fs.writeFileSync(path.join(outputDir, 'manifest.txt'), manifest);
    report = applyCustomerRebuild(db, pkg, {
      packageSha256: sha,
      planManifest: manifest,
      actorId: args.actor || 'rehearsal',
      backupFile: rehearsalDb,
      backupEvidence: backup,
      packagePath,
    });
    const afterPlan = planCustomerRebuild(db, pkg, sha);
    writeJson(path.join(outputDir, 'before.json'), { counts: plan.beforeCounts });
    writeJson(path.join(outputDir, 'after.json'), {
      counts: report.checks,
      preservedHashes: report.preservedHashes,
    });
    const afterSourceStat = fs.statSync(database);
    reconciliation = {
      sourceUnchanged:
        afterSourceStat.mtimeMs === beforeStat.mtimeMs &&
        afterSourceStat.size === beforeStat.size,
      sourceHashUnchanged: hashFile(database) === beforeHash,
      schemaFingerprintStable:
        afterPlan.schemaFingerprint === plan.schemaFingerprint,
      preservedHashesStable: Object.keys(plan.preservedHashes)
        .filter((table) => table !== 'crm_data_maintenance_runs')
        .every(
          (table) => report.preservedHashes[table] === plan.preservedHashes[table],
        ),
      reconciliationOk: report.checks.passed === true,
      quickCheckOk: String(report.checks.quickCheck).toLowerCase() === 'ok',
      integrityCheckOk:
        String(report.checks.integrityCheck).toLowerCase() === 'ok',
      integrityOk:
        String(report.checks.quickCheck).toLowerCase() === 'ok' &&
        String(report.checks.integrityCheck).toLowerCase() === 'ok',
      backup,
      checks: report.checks,
    };
  } finally {
    db.close();
  }
  writeAndAssertRehearsalEvidence(
    path.join(outputDir, 'reconciliation.json'),
    reconciliation,
  );
  console.log(
    JSON.stringify(
      {
        mode: 'rehearse',
        rehearsalDb,
        planManifest: manifest,
        checks: report.checks,
        sourceUnchanged: reconciliation.sourceUnchanged,
      },
      null,
      2,
    ),
  );
}

async function cmdApply(args, dependencies = {}) {
  if (!args.apply) {
    throw new Error('--apply is required to perform a production apply');
  }
  const database = requireFile(args.database);
  const packagePath = requireFile(args.package);
  const sha = readPackageSha(args['package-sha256-file']);
  const manifest = fs
    .readFileSync(requireFile(args.manifest), 'utf8')
    .trim();
  if (!args.actor) throw new Error('--actor is required');
  if (sameInode(database, packagePath)) {
    throw new Error('package and database must not be the same file');
  }
  const pkg = loadRebuildPackage(packagePath, sha);
  assertExactRerunPackageContract(pkg);
  const backupDir = path.resolve(
    args['backup-dir'] || 'backups/customer-rebuild',
  );
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `crm-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
  );
  const backupImpl = dependencies.onlineBackup || onlineBackup;
  await backupImpl(database, backupFile);
  const backup = validateBackupFile(backupFile, {
    sourcePath: database,
    pkg,
    packageSha256: sha,
    planManifest: manifest,
  });

  const db = openDatabase(database, 'readwrite');
  let report;
  try {
    if (!integrityOk(db)) {
      throw new Error('source database failed integrity_check before apply');
    }
    report = applyCustomerRebuild(db, pkg, {
      packageSha256: sha,
      planManifest: manifest,
      actorId: args.actor,
      backupFile,
      backupEvidence: backup,
      packagePath,
    });
  } finally {
    db.close();
  }
  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        backupFile,
        backup,
        checks: report.checks,
        preservedHashes: report.preservedHashes,
      },
      null,
      2,
    ),
  );
}

async function cmdVerify(args) {
  const database = requireFile(args.database);
  const db = openDatabase(database, 'readonly');
  const integrity = integrityOk(db);
  const counts = {};
  for (const table of [
    'customer_pool',
    'crm_intake_items',
    'crm_intake_batches',
    'crm_accounts',
    'crm_activities',
    'crm_rfqs',
    'crm_quotes',
    'crm_orders',
    'crm_notifications',
    'contacts',
    'customer_tags',
    'tags',
  ]) {
    try {
      counts[table] = db
        .prepare(`SELECT COUNT(*) n FROM ${JSON.stringify(table)}`)
        .get().n;
    } catch {
      counts[table] = null;
    }
  }
  db.close();
  console.log(JSON.stringify({ mode: 'verify', integrity, counts }, null, 2));
  if (!integrity) process.exit(1);
}

const MODES = {
  plan: cmdPlan,
  rehearse: cmdRehearse,
  apply: cmdApply,
  verify: cmdVerify,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  const command = MODES[mode];
  if (!command) {
    console.error(`unknown mode: ${mode || '(missing)'}; modes: ${Object.keys(MODES).join(', ')}`);
    process.exit(1);
  }
  try {
    await command(args);
  } catch (err) {
    console.error(`error: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assertExactRerunPackageContract,
  assertRehearsalGates,
  writeAndAssertRehearsalEvidence,
  validateBackupFile,
  cmdApply,
  cmdRehearse,
  cmdPlan,
  sqliteChecks,
};

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const {
  loadRebuildPackage,
  planCustomerRebuild,
  createRebuildManifest,
  applyCustomerRebuild,
  hashFile,
} = require('../lib/customer_rebuild');

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
  const quick = db.pragma('quick_check') || [];
  const integrity = db.pragma('integrity_check') || [];
  const quickOk = quick[0] ? quick[0].quick_check : quick[0];
  const integrityOk = integrity[0] ? integrity[0].integrity_check : integrity[0];
  return (
    String(quickOk).toLowerCase() === 'ok' &&
    String(integrityOk).toLowerCase() === 'ok'
  );
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function openDatabase(filePath, mode) {
  const db = new Database(filePath, { readonly: mode === 'readonly' });
  db.pragma('foreign_keys = ON');
  return db;
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
  const db = openDatabase(database, 'readonly');
  const plan = planCustomerRebuild(db, pkg);
  const manifest = createRebuildManifest(plan);
  db.close();
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
  const outputDir = path.resolve(
    args.output || 'tmp/customer-rebuild/rehearsal',
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const rehearsalDb = path.join(outputDir, 'rehearsed.db');
  const beforeStat = fs.statSync(database);
  const beforeHash = hashFile(database);
  await onlineBackup(database, rehearsalDb);

  const db = openDatabase(rehearsalDb, 'readwrite');
  if (!integrityOk(db)) {
    db.close();
    throw new Error('rehearsal backup failed integrity_check');
  }
  const pkg = loadRebuildPackage(packagePath, sha);
  const plan = planCustomerRebuild(db, pkg);
  const manifest = createRebuildManifest(plan);
  writeJson(path.join(outputDir, 'plan.json'), plan);
  fs.writeFileSync(path.join(outputDir, 'manifest.txt'), manifest);
  const report = applyCustomerRebuild(db, pkg, {
    packageSha256: sha,
    planManifest: manifest,
    actorId: args.actor || 'rehearsal',
    backupFile: rehearsalDb,
    packagePath,
  });
  const afterPlan = planCustomerRebuild(db, pkg);
  const afterManifest = createRebuildManifest(afterPlan);
  writeJson(path.join(outputDir, 'before.json'), { counts: plan.beforeCounts });
  writeJson(path.join(outputDir, 'after.json'), {
    counts: report.checks,
    preservedHashes: report.preservedHashes,
  });
  writeJson(path.join(outputDir, 'reconciliation.json'), {
    sourceUnchanged:
      fs.statSync(database).mtimeMs === beforeStat.mtimeMs &&
      fs.statSync(database).size === beforeStat.size,
    sourceHashUnchanged: hashFile(database) === beforeHash,
    manifestStable: afterManifest === manifest,
    integrityOk: integrityOk(db),
    checks: report.checks,
  });
  db.close();
  console.log(
    JSON.stringify(
      {
        mode: 'rehearse',
        rehearsalDb,
        planManifest: manifest,
        checks: report.checks,
        sourceUnchanged: fs.statSync(database).mtimeMs === beforeStat.mtimeMs,
      },
      null,
      2,
    ),
  );
}

async function cmdApply(args) {
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
  const backupDir = path.resolve(
    args['backup-dir'] || 'backups/customer-rebuild',
  );
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(
    backupDir,
    `crm-rebuild-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
  );
  await onlineBackup(database, backupFile);

  const db = openDatabase(database, 'readwrite');
  if (!integrityOk(db)) {
    db.close();
    throw new Error('source database failed integrity_check before apply');
  }
  const pkg = loadRebuildPackage(packagePath, sha);
  const plan = planCustomerRebuild(db, pkg);
  if (createRebuildManifest(plan) !== manifest) {
    db.close();
    throw new Error('plan manifest mismatch; apply aborted');
  }
  const report = applyCustomerRebuild(db, pkg, {
    packageSha256: sha,
    planManifest: manifest,
    actorId: args.actor,
    backupFile,
    packagePath,
  });
  db.close();
  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        backupFile,
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
    process.exit(1);
  }
}

main();

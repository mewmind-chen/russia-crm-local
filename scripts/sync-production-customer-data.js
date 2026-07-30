'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalPath, isWithin, runtimePaths } = require('../lib/runtime_paths');

const COPY_TABLES = Object.freeze([
  'customer_pool', 'customers', 'company_screening', 'company_entry_points', 'company_identifiers',
  'website_checks', 'sanction_checks', 'contacts', 'recon_jobs', 'recon_results', 'recon_evidence',
  'contact_recon_jobs', 'contact_recon_audit', 'person_candidates', 'contact_methods', 'person_evidence',
  'crm_intake_batches', 'crm_intake_items', 'crm_accounts', 'crm_account_contacts',
  'crm_activity_reaction_options', 'crm_activities',
  'crm_rfqs', 'crm_quotes', 'crm_orders', 'crm_manager_evaluations', 'tags', 'customer_tags',
]);

const CLEAR_ONLY_TABLES = Object.freeze([
  'crm_activity_action_requests',
  'crm_ai_field_provenance', 'crm_ai_enrichment_evidence',
  'crm_ai_enrichment_events', 'crm_ai_enrichment_node_links', 'crm_ai_enrichment_runs',
  'crm_ai_budget_alerts', 'crm_ai_usage_ledger', 'crm_ai_budget_reservations',
  'crm_ai_interaction_runs', 'crm_ai_task_reviews',
  'crm_ai_evidence_bindings', 'crm_ai_model_runs', 'crm_ai_station_results',
  'crm_ai_job_dependencies', 'crm_ai_resource_slots', 'crm_ai_customer_locks',
  'crm_ai_dispatch_fairness', 'crm_ai_resource_rate_windows', 'crm_ai_jobs',
  'crm_notifications', 'crm_migration_review', 'crm_data_maintenance_runs', 'crm_audit_log',
  'prospect_sources', 'prospect_candidates', 'prospect_tasks',
]);

const USER_REFERENCE_COLUMNS = new Set([
  'owner_id', 'manager_id', 'user_id', 'author_id', 'created_by', 'requested_by',
  'suggested_owner_id', 'assigned_owner_id', 'updated_by',
]);

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error('invalid SQL identifier');
  return `"${value}"`;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function rowsByRole(db) {
  const rows = db.prepare('SELECT id,role FROM sales_users WHERE active=1 ORDER BY id').all();
  return rows.reduce((groups, row) => {
    if (!groups[row.role]) groups[row.role] = [];
    groups[row.role].push(row.id);
    return groups;
  }, {});
}

function createUserMap(source, destination) {
  const sourceRoles = rowsByRole(source);
  const destinationRoles = rowsByRole(destination);
  for (const role of ['admin', 'manager', 'sales']) {
    if ((sourceRoles[role] || []).length && !(destinationRoles[role] || []).length) {
      throw new Error(`development database has no active ${role} account for ownership mapping`);
    }
  }
  const mapping = new Map();
  for (const [role, sourceIds] of Object.entries(sourceRoles)) {
    const targets = destinationRoles[role] || destinationRoles.admin || [];
    sourceIds.forEach((sourceId, index) => mapping.set(sourceId, targets[index % targets.length]));
  }
  return Object.freeze({
    mapping,
    fallbackAdminId: destinationRoles.admin?.[0] || '',
    fallbackSalesId: destinationRoles.sales?.[0] || destinationRoles.manager?.[0] || destinationRoles.admin?.[0] || '',
  });
}

function remapUserReferences(row, userMap) {
  const mapped = { ...row };
  for (const column of USER_REFERENCE_COLUMNS) {
    const value = String(mapped[column] || '');
    if (!value || value === 'system') continue;
    if (userMap.mapping.has(value)) {
      mapped[column] = userMap.mapping.get(value);
    } else if (/^USR-/i.test(value)) {
      mapped[column] = ['owner_id', 'suggested_owner_id', 'assigned_owner_id'].includes(column)
        ? userMap.fallbackSalesId
        : userMap.fallbackAdminId;
    }
  }
  return mapped;
}

function prepareRowForImport(row, table, userMap) {
  const mapped = remapUserReferences(row, userMap);
  if (table === 'customer_pool') {
    mapped.rating = '';
    mapped.current_pool = '未分池';
  }
  return mapped;
}

function copyTable(source, destination, table, transform = value => value) {
  if (!tableExists(source, table) || !tableExists(destination, table)) return { table, copied: 0, skipped: true };
  const sourceColumns = source.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => row.name);
  const destinationColumns = new Set(destination.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => row.name));
  const columns = sourceColumns.filter(column => destinationColumns.has(column));
  if (!columns.length) throw new Error(`no compatible columns for ${table}`);
  const columnSql = columns.map(quoteIdentifier).join(',');
  const insert = destination.prepare(`INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${columns.map(() => '?').join(',')})`);
  const rows = source.prepare(`SELECT ${columnSql} FROM ${quoteIdentifier(table)}`).all();
  for (const sourceRow of rows) {
    const row = transform(sourceRow, table);
    insert.run(...columns.map(column => row[column]));
  }
  return { table, copied: rows.length, skipped: false };
}

function assertSyncBoundaries({ environment, sourcePath, destinationPath, productionRoot }) {
  if (environment !== 'development') throw new Error('customer snapshot sync requires NODE_ENV=development');
  if (!isWithin(sourcePath, canonicalPath(path.join(productionRoot, 'shared', 'data')))) {
    throw new Error('source database must be inside production shared/data');
  }
  if (isWithin(destinationPath, productionRoot)) throw new Error('development destination cannot be inside production');
  if (sourcePath === destinationPath) throw new Error('source and destination databases must differ');
}

function syncCustomerTables(source, destination) {
  const userMap = createUserMap(source, destination);
  const copied = [];
  destination.pragma('foreign_keys = OFF');
  const apply = destination.transaction(() => {
    for (const table of [...COPY_TABLES].reverse()) {
      if (tableExists(source, table) && tableExists(destination, table)) {
        destination.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
      }
    }
    for (const table of [...CLEAR_ONLY_TABLES].reverse()) {
      if (tableExists(destination, table)) destination.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
    }
    for (const table of COPY_TABLES) {
      copied.push(copyTable(source, destination, table, row => prepareRowForImport(row, table, userMap)));
    }
    let restoredGrades = 0;
    if (tableExists(source, 'customer_pool') && tableExists(destination, 'customer_pool')) {
      const updateGrade = destination.prepare('UPDATE customer_pool SET rating=?,current_pool=? WHERE customer_id=?');
      const grades = source.prepare(`SELECT customer_id,rating,current_pool FROM customer_pool
        WHERE COALESCE(rating,'')!='' OR COALESCE(current_pool,'') NOT IN ('','未分池')`).all();
      for (const row of grades) restoredGrades += updateGrade.run(row.rating, row.current_pool, row.customer_id).changes;
    }
    const violations = destination.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`customer snapshot violates ${violations.length} foreign key constraints`);
    copied.push({ table: 'customer_pool_grades', copied: restoredGrades, skipped: false });
  });
  try {
    apply.immediate();
  } finally {
    destination.pragma('foreign_keys = ON');
  }
  return {
    copied,
    mappedUsers: userMap.mapping.size,
    totalRows: copied.reduce((sum, item) => sum + item.copied, 0),
  };
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function createPrivateBackup(database, targetPath) {
  await database.backup(targetPath);
  fs.chmodSync(targetPath, 0o600);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const paths = runtimePaths();
  const sourcePath = canonicalPath(process.env.CRM_PRODUCTION_DB_PATH
    || path.join(paths.productionRoot, 'shared', 'data', 'crm.db'));
  const destinationPath = canonicalPath(paths.databasePath);
  assertSyncBoundaries({
    environment: paths.environment,
    sourcePath,
    destinationPath,
    productionRoot: paths.productionRoot,
  });

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const destination = new Database(destinationPath, { fileMustExist: true });
  try {
    const preview = {
      apply,
      sourceCustomers: source.prepare('SELECT COUNT(*) count FROM customer_pool').get().count,
      sourceAccounts: source.prepare('SELECT COUNT(*) count FROM crm_accounts').get().count,
      sourceReconResults: source.prepare('SELECT COUNT(*) count FROM recon_results').get().count,
      sourcePeople: source.prepare('SELECT COUNT(*) count FROM person_candidates').get().count,
      preservedDevelopmentUsers: destination.prepare('SELECT COUNT(*) count FROM sales_users').get().count,
      preservedPermissionGroups: destination.prepare('SELECT COUNT(*) count FROM permission_groups').get().count,
    };
    if (!apply) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }

    fs.mkdirSync(paths.tmpDir, { recursive: true, mode: 0o700 });
    const tempDir = fs.mkdtempSync(path.join(paths.tmpDir, 'production-customer-sync-'));
    const backupDir = path.join(paths.runtimeRoot, 'backups', 'customer-sync');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(backupDir, `crm-before-production-customer-sync-${stamp()}.db`);
    const snapshotPath = path.join(tempDir, 'production-customer-snapshot.db');
    try {
      await createPrivateBackup(source, snapshotPath);
      await createPrivateBackup(destination, backupPath);
      source.close();
      const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
      try {
        const result = syncCustomerTables(snapshot, destination);
        process.stdout.write(`${JSON.stringify({ ...preview, ...result, backupPath }, null, 2)}\n`);
      } finally {
        snapshot.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } finally {
    if (source.open) source.close();
    if (destination.open) destination.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CLEAR_ONLY_TABLES,
  COPY_TABLES,
  assertSyncBoundaries,
  copyTable,
  createPrivateBackup,
  createUserMap,
  prepareRowForImport,
  remapUserReferences,
  syncCustomerTables,
};

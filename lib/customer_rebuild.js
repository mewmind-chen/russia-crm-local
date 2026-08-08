'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_COLUMNS = [
  'customer_id',
  'external_customer_id',
  'crm_customer_id',
  'intake_item_id',
  'account_id',
];

const PRESERVED_TABLES = [
  'sales_users',
  'sales_sessions',
  'permission_groups',
  'permission_group_filter_grants',
  'permission_group_migrations',
  'filter_definitions',
  'filter_catalog_migrations',
  'filter_permission_audit',
  'filter_permission_state',
  'user_filter_extra_grants',
  'user_permission_overrides',
  'crm_intake_settings',
  'crm_intake_assignment_rule_drafts',
  'crm_intake_assignment_rule_versions',
  'crm_intake_assignment_rule_state',
  'crm_manager_task_settings',
  'crm_manager_task_settings_audit',
  'crm_ai_feature_flags',
  'crm_ai_budget_policies',
  'crm_ai_pricing_catalog',
  'crm_ai_fx_rates',
  'crm_ai_resource_rate_windows',
  'crm_ai_strategy_versions',
  'crm_ai_schema_migrations',
  'crm_data_maintenance_runs',
  'crm_audit_log',
  'assistant_runtime_settings',
  'assistant_conversations',
  'assistant_conversation_messages',
  'tags',
  'templates',
  'wecom_user_bindings',
  'wecom_bot_tasks',
  'wecom_bot_audit_log',
  'crm_team_status_views',
  'crm_activity_reaction_options',
  'crm_migration_review',
  'prospect_sources',
  'prospect_candidates',
  'prospect_tasks',
];

const REPLACED_TABLES = [
  'customer_pool',
  'company_identifiers',
  'company_screening',
  'contacts',
  'contact_methods',
  'company_entry_points',
  'website_checks',
  'sanction_checks',
  'recon_evidence',
  'customer_tags',
];

const CLEARED_TABLES = [
  'crm_intake_batches',
  'crm_intake_items',
  'crm_intake_decisions',
  'crm_intake_action_requests',
  'crm_intake_assignment_previews',
  'crm_intake_manual_assignment_requests',
  'crm_intake_assignment_rule_rotation',
  'crm_intake_assignment_rule_usage',
  'crm_accounts',
  'crm_account_contacts',
  'crm_activities',
  'crm_activity_action_requests',
  'crm_activity_correction_notification_relations',
  'crm_activity_correction_proposals',
  'crm_activity_correction_decisions',
  'crm_activity_correction_locks',
  'crm_activity_corrections',
  'crm_manager_evaluations',
  'crm_manager_tasks',
  'crm_manager_interventions',
  'crm_deferred_plan_events',
  'crm_next_plan_events',
  'crm_rfqs',
  'crm_quotes',
  'crm_orders',
  'crm_notifications',
  'crm_notification_deliveries',
  'crm_today_task_action_requests',
  'crm_commerce_action_requests',
  'crm_collaboration_events',
  'crm_smoke_runs',
  'crm_duplicate_reviews',
  'crm_customer_create_requests',
  'crm_customer_identity_audit',
  'crm_customer_identity_conflict_audit',
  'crm_customer_identity_conflicts',
  'crm_customer_identity_migration_reports',
  'crm_customer_identity_name_tombstones',
  'crm_customer_identity_registry',
  'crm_protected_customer_action_requests',
  'crm_protected_customer_audit',
  'crm_protected_customer_batch_rows',
  'crm_protected_customer_batches',
  'crm_protected_customers',
  'customer_nickname_audit',
  'customer_nickname_migration_audit',
  'customer_tag_history',
  'customer_assignments',
  'customers',
  'person_candidates',
  'person_evidence',
  'recon_jobs',
  'recon_results',
  'recon_submission_audit',
  'contact_recon_jobs',
  'contact_recon_audit',
  'assistant_documents',
  'assistant_embeddings',
  'crm_ai_action_proposal_consumptions',
  'crm_ai_batch_items',
  'crm_ai_batch_runs',
  'crm_ai_budget_alerts',
  'crm_ai_budget_reservations',
  'crm_ai_candidate_snapshot_items',
  'crm_ai_candidate_snapshots',
  'crm_ai_customer_locks',
  'crm_ai_dispatch_fairness',
  'crm_ai_enrichment_events',
  'crm_ai_enrichment_evidence',
  'crm_ai_enrichment_node_links',
  'crm_ai_enrichment_runs',
  'crm_ai_evidence_bindings',
  'crm_ai_feedback_labels',
  'crm_ai_field_proposals',
  'crm_ai_field_provenance',
  'crm_ai_interaction_runs',
  'crm_ai_job_dependencies',
  'crm_ai_jobs',
  'crm_ai_model_runs',
  'crm_ai_next_action_consumptions',
  'crm_ai_resource_slots',
  'crm_ai_shadow_evaluations',
  'crm_ai_station_results',
  'crm_ai_task_reviews',
  'crm_ai_usage_ledger',
];

const PRESERVED_HASH_TABLES = [
  'sales_users',
  'permission_groups',
  'permission_group_filter_grants',
  'filter_definitions',
  'crm_intake_settings',
  'crm_manager_task_settings',
  'crm_ai_feature_flags',
  'wecom_user_bindings',
];

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hashFile(filePath) {
  return sha256Text(fs.readFileSync(path.resolve(filePath)));
}

function tableInfo(db, table) {
  const quoted = JSON.stringify(table);
  const columns = db
    .prepare(`PRAGMA table_info(${quoted})`)
    .all()
    .map((row) => row.name);
  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list(${quoted})`)
    .all()
    .map((row) => ({ from: row.from, table: row.table, to: row.to }));
  return { columns, foreignKeys };
}

function allTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function allTriggers(db) {
  return db
    .prepare(
      "SELECT name, tbl_name AS tblName, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name",
    )
    .all();
}

function schemaFingerprint(db) {
  const parts = [];
  for (const table of allTables(db)) {
    const info = tableInfo(db, table);
    parts.push(
      `${table}:${info.columns.join(',')};${info.foreignKeys
        .map((fk) => `${fk.from}->${fk.table}.${fk.to}`)
        .join(',')}`,
    );
  }
  for (const trigger of allTriggers(db)) {
    parts.push(`trigger:${trigger.name}:${trigger.sql}`);
  }
  return sha256Text(parts.join('\n'));
}

function immutableTriggersFor(db, tables) {
  const target = new Set(tables);
  return allTriggers(db)
    .filter(
      (trigger) =>
        target.has(trigger.tblName) &&
        /RAISE\s*\(\s*ABORT/i.test(trigger.sql) &&
        /immutable/i.test(trigger.sql),
    )
    .map((trigger) => ({ name: trigger.name, sql: trigger.sql }));
}

function countTable(db, table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${JSON.stringify(table)}`).get()
    .n;
}

function tableHash(db, table) {
  const rows = db
    .prepare(`SELECT * FROM ${JSON.stringify(table)} ORDER BY 1`)
    .all();
  return sha256Text(JSON.stringify(rows));
}

function customerLinkedTables(db) {
  const tables = allTables(db);
  const info = new Map(tables.map((t) => [t, tableInfo(db, t)]));
  const linked = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [table, meta] of info) {
      if (linked.has(table)) continue;
      if (
        meta.columns.some((column) => KEY_COLUMNS.includes(column)) ||
        meta.foreignKeys.some((fk) => linked.has(fk.table))
      ) {
        linked.add(table);
        changed = true;
      }
    }
  }
  return linked;
}

function classifyRebuildTables(db) {
  const preserved = new Set(PRESERVED_TABLES);
  const replaced = new Set(REPLACED_TABLES);
  const cleared = new Set(CLEARED_TABLES);
  const linked = customerLinkedTables(db);
  const classification = { preserved: [], replaced: [], cleared: [], unclassifiedCustomerTables: [] };

  for (const table of allTables(db)) {
    if (preserved.has(table)) {
      classification.preserved.push(table);
    } else if (replaced.has(table)) {
      classification.replaced.push(table);
    } else if (cleared.has(table)) {
      classification.cleared.push(table);
    } else if (linked.has(table)) {
      classification.unclassifiedCustomerTables.push(table);
    }
  }
  classification.preserved.sort();
  classification.replaced.sort();
  classification.cleared.sort();
  classification.unclassifiedCustomerTables.sort();
  return classification;
}

function assertClassificationComplete(db, classification) {
  if (classification.unclassifiedCustomerTables.length > 0) {
    throw new Error(
      `unclassified customer tables: ${classification.unclassifiedCustomerTables.join(', ')}`,
    );
  }
}

function dependencyOrder(db, tables) {
  const info = new Map(
    tables.map((table) => [table, tableInfo(db, table)]),
  );
  const visited = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (table) => {
    if (visited.has(table)) return;
    if (visiting.has(table)) return; // cycle: handled by explicit order later
    visiting.add(table);
    for (const fk of info.get(table).foreignKeys) {
      if (info.has(fk.table)) visit(fk.table);
    }
    visiting.delete(table);
    visited.add(table);
    order.push(table);
  };
  for (const table of tables) visit(table);
  return order; // children first (parents after children in FK graph)
}

function createRebuildManifest(plan) {
  return sha256Text(JSON.stringify(plan, null, 2));
}

function loadRebuildPackage(filePath, expectedSha256) {
  const absolute = path.resolve(filePath);
  const actual = hashFile(absolute);
  if (expectedSha256 && actual !== expectedSha256) {
    throw new Error('package sha256 mismatch');
  }
  const pkg = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  validatePackage(pkg);
  return pkg;
}

function validatePackage(pkg) {
  if (!Array.isArray(pkg.customers) || !Array.isArray(pkg.excluded)) {
    throw new Error('package must contain customers and excluded arrays');
  }
  const ids = new Set();
  for (const customer of [...pkg.customers, ...pkg.excluded]) {
    if (!customer.customerId) throw new Error('customerId is required');
    if (ids.has(customer.customerId)) {
      throw new Error(`duplicate customerId: ${customer.customerId}`);
    }
    ids.add(customer.customerId);
  }
  for (const customer of pkg.customers) {
    if (!['READY', 'REVIEW'].includes(customer.dataStatus)) {
      throw new Error(
        `invalid dataStatus for ${customer.customerId}: ${customer.dataStatus}`,
      );
    }
  }
  for (const collection of ['contacts', 'tags', 'screening', 'evidence', 'reviewQueue']) {
    for (const item of pkg[collection] || []) {
      if (item.customerId && !ids.has(item.customerId)) {
        throw new Error(
          `orphan ${collection} row for ${item.customerId}`,
        );
      }
    }
  }
}

function planCustomerRebuild(db, pkg) {
  const classification = classifyRebuildTables(db);
  assertClassificationComplete(db, classification);
  const beforeCounts = {};
  for (const table of [...classification.cleared, ...classification.replaced]) {
    beforeCounts[table] = countTable(db, table);
  }
  const packageCounts = {
    customers: pkg.customers.length,
    excluded: pkg.excluded.length,
    ready: pkg.customers.filter((c) => c.dataStatus === 'READY').length,
    review: pkg.customers.filter((c) => c.dataStatus === 'REVIEW').length,
    contacts: (pkg.contacts || []).length,
    tags: (pkg.tags || []).length,
    evidence: (pkg.evidence || []).length,
  };
  const orphans = [];
  const ids = new Set(pkg.customers.map((c) => c.customerId));
  for (const collection of ['contacts', 'tags', 'screening', 'evidence']) {
    for (const item of pkg[collection] || []) {
      if (item.customerId && !ids.has(item.customerId)) orphans.push(item.customerId);
    }
  }
  const plan = {
    schemaFingerprint: schemaFingerprint(db),
    preservedTables: classification.preserved,
    clearedTables: classification.cleared,
    replacedTables: classification.replaced,
    unclassifiedCustomerTables: classification.unclassifiedCustomerTables,
    beforeCounts,
    packageCounts,
    orphans: [...new Set(orphans)],
    preservedHashes: {},
  };
  for (const table of PRESERVED_HASH_TABLES) {
    if (allTables(db).includes(table)) {
      plan.preservedHashes[table] = tableHash(db, table);
    }
  }
  return plan;
}

function nowIso() {
  return new Date().toISOString();
}

function insertRow(db, table, values) {
  if (process.env.DEBUG) console.error('insert into', table);
  const columns = db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all();
  const row = {};
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(values, column.name)) {
      row[column.name] = values[column.name];
    } else if (column.notnull && column.dflt_value === null) {
      row[column.name] = /INT/i.test(column.type)
        ? 0
        : /JSON/i.test(column.type)
          ? '[]'
          : '';
    }
  }
  const names = Object.keys(row);
  let info;
  try {
    info = db
      .prepare(
        `INSERT INTO ${JSON.stringify(table)} (${names
          .map((name) => JSON.stringify(name))
          .join(',')}) VALUES (${names.map(() => '?').join(',')})`,
      )
      .run(...names.map((name) => row[name]));
  } catch (err) {
    err.message = `${table}: ${err.message}`;
    throw err;
  }
  return info;
}

function insertReplacedData(db, pkg) {
  const ts = nowIso();
  const screening = new Map(
    (pkg.screening || []).map((row) => [row.customerId, row]),
  );
  const tagInsert = db.prepare(`
    INSERT OR IGNORE INTO tags (name, category, color, is_preset, created_at)
    VALUES (@name, @category, '', 0, @ts)
  `);
  const tagLookup = db.prepare('SELECT id FROM tags WHERE name = ?');
  const customerTagInsert = db.prepare(`
    INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at)
    VALUES (@customerId, @tagId, @ts)
  `);

  const insert = db.transaction(() => {
    for (const customer of pkg.customers) {
      const scr = screening.get(customer.customerId) || {};
      insertRow(db, 'customer_pool', {
        customer_id: customer.customerId,
        domain: customer.domain || '',
        company_name: customer.standardName || customer.companyName,
        russian_name: customer.localName || '',
        english_name: customer.englishName || '',
        country: customer.country || '',
        country_code: customer.countryCode || '',
        city: customer.city || '',
        website: customer.website || '',
        industry: customer.industry || '',
        customer_type: customer.customerType || '',
        description: customer.description || '',
        products: customer.products || '',
        phone: customer.phone || '',
        email: customer.email || '',
        inn: customer.inn || '',
        established_year: customer.foundedYear || '',
        risk_status: customer.sanctionsStatus || '',
        website_verification: customer.websiteVerified ? 'verified' : 'pending',
        notes: (customer.reviewReasons || []).join(';'),
        created_at: ts,
        updated_at: ts,
      });
      insertRow(db, 'company_screening', {
        customer_id: customer.customerId,
        business_summary: customer.description || '',
        company_type: customer.customerType || '',
        product_categories_json: JSON.stringify(
          (customer.products || '').split(/[;，,]/).map((s) => s.trim()).filter(Boolean),
        ),
        match_score: 0,
        match_group: '',
        risk_level: scr.riskLevel || 'review',
        screening_status: 'verified',
        checked_at: ts,
        created_at: ts,
        updated_at: ts,
      });
      if (customer.inn) {
        insertRow(db, 'company_identifiers', {
          customer_id: customer.customerId,
          identifier_type: 'inn',
          identifier_value: customer.inn,
          country_code: customer.countryCode || '',
          source_url: '',
          checked_at: ts,
        });
      }
      if (customer.ogrn) {
        insertRow(db, 'company_identifiers', {
          customer_id: customer.customerId,
          identifier_type: 'ogrn',
          identifier_value: customer.ogrn,
          country_code: customer.countryCode || '',
          source_url: '',
          checked_at: ts,
        });
      }
      if (customer.website) {
        insertRow(db, 'website_checks', {
          customer_id: customer.customerId,
          url: customer.website,
          status: customer.websiteVerified ? 'ok' : 'pending',
          method: 'package',
          checked_at: ts,
          details_json: '{}',
        });
      }
      insertRow(db, 'sanction_checks', {
        customer_id: customer.customerId,
        provider: 'pipeline',
        result: customer.sanctionsStatus || 'unknown',
        review_status: customer.sanctionsStatus === 'hit' ? 'open' : 'clear',
        checked_at: ts,
        created_at: ts,
      });
    }

    let contactSeq = 0;
    for (const contact of pkg.contacts || []) {
      contactSeq += 1;
      const contactId = `CT-${Date.now()}-${contactSeq}`;
      const info = insertRow(db, 'contacts', {
        contact_id: contactId,
        customer_id: contact.customerId,
        name: contact['联系人姓名'] || '',
        title: contact['职位'] || '',
        department: contact['部门'] || '',
        decision_role: contact['决策角色'] || '',
        role_category: contact['角色类别'] || '',
        contact_level: contact['联系等级'] || '',
        employment_status: contact['在职状态'] || '',
        employment_confidence: contact['在职置信度'] || '',
        quality_status:
          contact['数据状态'] === '可导入' ? 'verified' : 'review',
        source_url: contact['联系人证据网址'] || '',
        person_id: contact['人员ID'] || '',
        created_at: ts,
        updated_at: ts,
      });
      for (const [methodType, value] of [
        ['email', contact['邮箱'] || ''],
        ['phone', contact['电话'] || ''],
      ]) {
        if (!value) continue;
        insertRow(db, 'contact_methods', {
          contact_id: contactId,
          customer_id: contact.customerId,
          method_type: methodType,
          value,
          normalized_value:
            methodType === 'email' ? value.toLowerCase() : value.replace(/\D/g, ''),
          status: 'ok',
          source_url: contact['联系人证据网址'] || '',
          person_id: contact['人员ID'] || '',
          discovery_type: 'package',
          verification_status:
            contact['数据状态'] === '可导入' ? 'verified' : 'unverified',
          confidence: 1.0,
          is_direct: 1,
          is_generic: 0,
          is_inferred: 0,
          source_date: ts,
        });
      }
    }

    for (const item of pkg.evidence || []) {
      insertRow(db, 'recon_evidence', {
        customer_id: item.customerId,
        field_name: item.step || item.type || 'evidence',
        value: String(item.text || item.title || item.snippet || item.value || ''),
        source_url: item.url || item.evidence_url || '',
        source_title: item.title || '',
        checked_at: ts,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
        extractor: 'customer-rebuild-package',
      });
    }

    for (const tag of pkg.tags || []) {
      const name = String(tag.tag || tag['标签'] || '').trim();
      if (!name) continue;
      try {
        tagInsert.run({
          name,
          category: String(tag['标签分类'] || tag.category || 'pipeline').trim(),
          ts,
        });
      } catch (err) {
        err.message = `tags: ${err.message}`;
        throw err;
      }
      const row = tagLookup.get(name);
      if (row) {
        try {
          customerTagInsert.run({
            customerId: tag.customerId,
            tagId: row.id,
            ts,
          });
        } catch (err) {
          err.message = `customer_tags: ${err.message}`;
          throw err;
        }
      }
    }
  });
  insert();
}

function insertIntakeData(db, pkg, actorId) {
  const ts = nowIso();
  const run = db.transaction(() => {
    const batchId = `RB-${Date.now()}`;
    const batch = insertRow(db, 'crm_intake_batches', {
      id: batchId,
      batch_date: ts.slice(0, 10),
      source: 'customer-rebuild-package',
      status: 'completed',
      candidate_count: pkg.customers.length,
      imported_count: pkg.customers.length,
      assigned_count: 0,
      skipped_count: 0,
      created_by: actorId || '',
      created_at: ts,
      finished_at: ts,
    });
    for (let index = 0; index < pkg.customers.length; index += 1) {
      const customer = pkg.customers[index];
      insertRow(db, 'crm_intake_items', {
        id: `IN-${batchId}-${index + 1}`,
        batch_id: batchId,
        external_customer_id: customer.customerId,
        company_name: customer.standardName || customer.companyName,
        country: customer.country || '',
        website: customer.website || '',
        industry: customer.industry || '',
        customer_type: customer.customerType || '',
        product_focus: customer.products || '',
        status: customer.dataStatus === 'READY' ? 'approved' : 'pending',
        decision_reason: customer.dataStatus === 'REVIEW' ? '数据待核实' : '',
        created_at: ts,
        updated_at: ts,
      });
    }
    insertRow(db, 'crm_data_maintenance_runs', {
      id: `RBR-${Date.now()}`,
      operation: 'rebuild_customer_master',
      status: 'completed',
      result_counts_json: JSON.stringify({
        customers: pkg.customers.length,
        ready: pkg.customers.filter((c) => c.dataStatus === 'READY').length,
        review: pkg.customers.filter((c) => c.dataStatus === 'REVIEW').length,
      }),
      backup_file: '',
      real_user_id: actorId || '',
      started_at: ts,
      finished_at: ts,
      created_at: ts,
    });
  });
  run();
}

function reconcileAfter(db, pkg) {
  const checks = {};
  checks.customerPool = countTable(db, 'customer_pool');
  checks.intakeItems = countTable(db, 'crm_intake_items');
  checks.approvedIntake = db
    .prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status = 'approved'")
    .get().n;
  checks.pendingIntake = db
    .prepare("SELECT COUNT(*) n FROM crm_intake_items WHERE status = 'pending'")
    .get().n;
  checks.duplicateCustomerIds = db
    .prepare(
      'SELECT COUNT(*) n FROM (SELECT customer_id FROM customer_pool GROUP BY customer_id HAVING COUNT(*) > 1)',
    )
    .get().n;
  checks.foreignKeyViolations = (db.pragma('foreign_key_check') || []).length;
  const quick = db.pragma('quick_check') || [];
  checks.quickCheck = quick[0] ? quick[0].quick_check || quick[0] : '';
  return checks;
}

function applyCustomerRebuild(db, pkg, options) {
  const { packageSha256, planManifest, actorId, backupFile } = options;
  if (!packageSha256 || !planManifest) {
    throw new Error('packageSha256 and planManifest are required');
  }
  if (options.packagePath && hashFile(options.packagePath) !== packageSha256) {
    throw new Error('package sha256 mismatch');
  }

  const plan = planCustomerRebuild(db, pkg);
  if (createRebuildManifest(plan) !== planManifest) {
    throw new Error('plan manifest mismatch');
  }

  const beforeHashes = { ...plan.preservedHashes };
  const immutableTriggers = immutableTriggersFor(db, plan.clearedTables);
  const deleteOrder = [
    ...dependencyOrder(db, [...plan.clearedTables, ...plan.replacedTables]),
  ].reverse();

  const run = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    for (const trigger of immutableTriggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${JSON.stringify(trigger.name)}`);
    }
    for (const table of deleteOrder) {
      db.prepare(`DELETE FROM ${JSON.stringify(table)}`).run();
    }
    const violations = db.pragma('foreign_key_check') || [];
    if (violations.length > 0) {
      throw new Error(`foreign key violations after clear: ${JSON.stringify(violations.slice(0, 5))}`);
    }
    insertReplacedData(db, pkg);
    insertIntakeData(db, pkg, actorId);
    for (const trigger of immutableTriggers) {
      db.exec(trigger.sql);
    }
  });
  run();

  const afterHashes = {};
  for (const table of Object.keys(beforeHashes)) {
    afterHashes[table] = tableHash(db, table);
    if (afterHashes[table] !== beforeHashes[table]) {
      throw new Error(`preserved table hash changed: ${table}`);
    }
  }
  if (schemaFingerprint(db) !== plan.schemaFingerprint) {
    throw new Error('schema fingerprint changed during apply');
  }
  const checks = reconcileAfter(db, pkg);
  if (
    checks.customerPool !== pkg.customers.length ||
    checks.intakeItems !== pkg.customers.length ||
    checks.approvedIntake !==
      pkg.customers.filter((c) => c.dataStatus === 'READY').length ||
    checks.pendingIntake !==
      pkg.customers.filter((c) => c.dataStatus === 'REVIEW').length ||
    checks.duplicateCustomerIds !== 0 ||
    checks.foreignKeyViolations !== 0 ||
    String(checks.quickCheck).toLowerCase() !== 'ok'
  ) {
    throw new Error(`reconciliation failed: ${JSON.stringify(checks)}`);
  }
  return {
    plan,
    beforeCounts: plan.beforeCounts,
    checks,
    preservedHashes: afterHashes,
    backupFile: backupFile || '',
  };
}

module.exports = {
  loadRebuildPackage,
  planCustomerRebuild,
  classifyRebuildTables,
  assertClassificationComplete,
  createRebuildManifest,
  applyCustomerRebuild,
  schemaFingerprint,
  immutableTriggersFor,
  sha256Text,
  hashFile,
  PRESERVED_TABLES,
  REPLACED_TABLES,
  CLEARED_TABLES,
  PRESERVED_HASH_TABLES,
};

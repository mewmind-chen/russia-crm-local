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
  'crm_customer_stars',
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
  'crm_plan_only_action_requests',
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

const PRESERVED_HASH_TABLES = [...PRESERVED_TABLES];

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
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
         AND (
           type IN ('table', 'view', 'trigger')
           OR (type = 'index' AND sql IS NOT NULL)
         )
       ORDER BY
         type COLLATE BINARY,
         name COLLATE BINARY,
         tbl_name COLLATE BINARY,
         COALESCE(sql, '') COLLATE BINARY`,
    )
    .all()
    .map((row) => [row.type, row.name, row.tbl_name, row.sql]);
  return sha256Text(JSON.stringify(rows));
}

function assertNoTempSchema(db) {
  const objects = db
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_temp_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all();
  if (objects.length > 0) {
    throw new Error(`temporary schema objects are not allowed: ${objects.map((row) => row.name).join(', ')}`);
  }
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

function canonicalCell(type, value) {
  if (type === 'null') return 'N';
  if (type === 'integer') return `I:${value.toString()}`;
  if (type === 'real') {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return `R:${bytes.toString('hex')}`;
  }
  if (type === 'text' || type === 'blob') {
    if (!Buffer.isBuffer(value)) {
      throw new Error(`expected raw bytes for SQLite ${type}`);
    }
    return `${type === 'text' ? 'T' : 'B'}:${value.length}:${value.toString('hex')}`;
  }
  throw new Error(`unsupported SQLite storage class: ${type}`);
}

function canonicalTableHash(db, table, whereClause = '', params = []) {
  const columns = tableInfo(db, table).columns;
  const projection = columns.flatMap((column, index) => {
    const quoted = JSON.stringify(column);
    return [
      `typeof(${quoted}) AS ${JSON.stringify(`__type_${index}`)}`,
      `CASE typeof(${quoted}) WHEN 'text' THEN CAST(${quoted} AS BLOB) WHEN 'blob' THEN ${quoted} ELSE ${quoted} END AS ${JSON.stringify(`__value_${index}`)}`,
    ];
  }).join(', ');
  const statement = db.prepare(
    `SELECT ${projection} FROM ${JSON.stringify(table)} ${whereClause}`,
  );
  statement.safeIntegers(true);
  const rows = statement.all(...params).map((row) => JSON.stringify(
    columns.map((_, index) => canonicalCell(
      row[`__type_${index}`],
      row[`__value_${index}`],
    )),
  ));
  rows.sort();
  return sha256Text(JSON.stringify(rows));
}

function tableHash(db, table) {
  return canonicalTableHash(db, table);
}

function tableHashExcludingId(db, table, excludedId) {
  return canonicalTableHash(db, table, 'WHERE id <> ?', [excludedId]);
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
  const present = new Set(allTables(db));
  for (const [kind, expected] of [
    ['preserved', PRESERVED_TABLES],
    ['cleared', CLEARED_TABLES],
    ['replaced', REPLACED_TABLES],
  ]) {
    const missing = expected.filter((table) => !present.has(table)).sort();
    if (missing.length > 0) {
      throw new Error(`missing expected ${kind} tables: ${missing.join(', ')}`);
    }
  }
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
  if (pkg.customers.length === 0) {
    throw new Error('package contains no importable customers');
  }
  const allPartitionIds = new Set();
  const importableCustomerIds = new Set();
  const numericParts = new Set();
  for (const customer of [...pkg.customers, ...pkg.excluded]) {
    if (!customer.customerId) throw new Error('customerId is required');
    if (!/^[A-Z]{2}-\d{4}$/.test(customer.customerId)) {
      throw new Error(`invalid customerId format: ${customer.customerId}`);
    }
    const numericPart = customer.customerId.slice(3, 7);
    if (numericParts.has(numericPart)) {
      throw new Error(
        `duplicate customerId numeric part: ${numericPart} (${customer.customerId})`,
      );
    }
    numericParts.add(numericPart);
    if (allPartitionIds.has(customer.customerId)) {
      throw new Error(`duplicate customerId: ${customer.customerId}`);
    }
    allPartitionIds.add(customer.customerId);
  }
  for (const customer of pkg.customers) {
    importableCustomerIds.add(customer.customerId);
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
      if (!importableCustomerIds.has(item.customerId)) {
        throw new Error(
          `orphan ${collection} row for ${item.customerId}`,
        );
      }
    }
  }
}

function requiredTagNames(pkg) {
  return [...new Set(
    (pkg.tags || [])
      .map((tag) => String(tag.tag || tag['标签'] || '').trim())
      .filter(Boolean),
  )].sort();
}

function assertRequiredTagDefinitions(db, pkg) {
  const missing = [];
  const findTag = db.prepare('SELECT 1 FROM tags WHERE name = ? LIMIT 1');
  for (const name of requiredTagNames(pkg)) {
    if (!findTag.get(name)) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`required tag definitions missing: ${missing.join(', ')}`);
  }
}

function expectedAfterCounts(classification, pkg) {
  const counts = {};
  for (const table of classification.cleared) counts[table] = 0;
  counts.crm_intake_batches = 1;
  counts.crm_intake_items = pkg.customers.length;

  for (const table of classification.replaced) counts[table] = 0;
  counts.customer_pool = pkg.customers.length;
  counts.company_identifiers = pkg.customers.reduce(
    (total, customer) => total + (customer.inn ? 1 : 0) + (customer.ogrn ? 1 : 0),
    0,
  );
  counts.company_screening = pkg.customers.length;
  counts.contacts = (pkg.contacts || []).length;
  counts.contact_methods = (pkg.contacts || []).reduce(
    (total, contact) =>
      total + (contact['邮箱'] ? 1 : 0) + (contact['电话'] ? 1 : 0),
    0,
  );
  counts.company_entry_points = 0;
  counts.website_checks = pkg.customers.filter((customer) => customer.website).length;
  counts.sanction_checks = pkg.customers.length;
  counts.recon_evidence = (pkg.evidence || []).length;
  counts.customer_tags = new Set(
    (pkg.tags || [])
      .map((tag) => {
        const name = String(tag.tag || tag['标签'] || '').trim();
        return name ? `${tag.customerId}\u0000${name}` : '';
      })
      .filter(Boolean),
  ).size;
  return counts;
}

function planCustomerRebuild(db, pkg, packageSha256) {
  if (!/^[a-f0-9]{64}$/.test(packageSha256 || '')) {
    throw new Error('verified packageSha256 is required');
  }
  validatePackage(pkg);
  assertNoTempSchema(db);
  const classification = classifyRebuildTables(db);
  assertClassificationComplete(db, classification);
  assertRequiredTagDefinitions(db, pkg);
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
    identifiers: pkg.customers.reduce(
      (total, customer) => total + (customer.inn ? 1 : 0) + (customer.ogrn ? 1 : 0),
      0,
    ),
    websites: pkg.customers.filter((customer) => customer.website).length,
    contactMethods: (pkg.contacts || []).reduce(
      (total, contact) =>
        total + (contact['邮箱'] ? 1 : 0) + (contact['电话'] ? 1 : 0),
      0,
    ),
    customerTags: new Set(
      (pkg.tags || [])
        .map((tag) => {
          const name = String(tag.tag || tag['标签'] || '').trim();
          return name ? `${tag.customerId}\u0000${name}` : '';
        })
        .filter(Boolean),
    ).size,
  };
  const plan = {
    packageSha256,
    schemaFingerprint: schemaFingerprint(db),
    preservedTables: classification.preserved,
    clearedTables: classification.cleared,
    replacedTables: classification.replaced,
    unclassifiedCustomerTables: classification.unclassifiedCustomerTables,
    beforeCounts,
    expectedAfterCounts: expectedAfterCounts(classification, pkg),
    packageCounts,
    orphans: [],
    preservedHashes: {},
    sourceTableHashes: {},
  };
  for (const table of classification.preserved) {
    plan.preservedHashes[table] = tableHash(db, table);
  }
  const classifiedTables = [
    ...classification.preserved,
    ...classification.cleared,
    ...classification.replaced,
  ].sort();
  for (const table of classifiedTables) {
    plan.sourceTableHashes[table] = tableHash(db, table);
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
  const tagLookup = db.prepare(
    'SELECT id FROM tags WHERE name = ? LIMIT 1',
  );
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
      const row = tagLookup.get(name);
      if (!row) {
        throw new Error(`required tag definition missing during apply: ${name}`);
      }
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
  });
  insert();
}

function insertIntakeData(db, pkg, actorId, options = {}) {
  const ts = nowIso();
  const run = db.transaction(() => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const batchId = `RB-${uniqueSuffix}`;
    insertRow(db, 'crm_intake_batches', {
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
    const maintenanceRunId = `RBR-${uniqueSuffix}`;
    const filters = {
      packageSha256: options.packageSha256 || '',
      planManifest: options.planManifest || '',
      backup: options.backupEvidence || null,
    };
    const resultCounts = {
      customers: pkg.customers.length,
      ready: pkg.customers.filter((c) => c.dataStatus === 'READY').length,
      review: pkg.customers.filter((c) => c.dataStatus === 'REVIEW').length,
    };
    const expectedMaintenanceRow = {
      id: maintenanceRunId,
      operation: 'rebuild_customer_master',
      status: 'completed',
      filters_json: JSON.stringify(filters),
      target_fingerprint: '',
      preview_counts_json: '{}',
      result_counts_json: JSON.stringify(resultCounts),
      backup_file: options.backupFile || '',
      error_code: '',
      error_message: '',
      real_user_id: String(actorId || ''),
      session_hash_prefix: '',
      preview_token_hash: '',
      preview_expires_at: '',
      started_at: ts,
      finished_at: ts,
      created_at: ts,
    };
    insertRow(db, 'crm_data_maintenance_runs', expectedMaintenanceRow);
    return {
      batchId,
      maintenanceRunId,
      filters,
      resultCounts,
      expectedMaintenanceRow,
    };
  });
  return run();
}

function countOwnershipOrphans(db, table, column = 'customer_id') {
  return db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM ${JSON.stringify(table)} AS child
      LEFT JOIN customer_pool AS parent
        ON parent.customer_id = child.${JSON.stringify(column)}
      WHERE parent.customer_id IS NULL
    `)
    .get().n;
}

function pragmaResult(db, name) {
  const rows = db.pragma(name) || [];
  const first = rows[0];
  return first && typeof first === 'object' ? first[name] : first;
}

function projectionRows(db, table, columns, orderBy = columns) {
  const rows = db
    .prepare(
      `SELECT ${columns.map((column) => JSON.stringify(column)).join(', ')}
       FROM ${JSON.stringify(table)}
       ORDER BY ${orderBy.map((column) => JSON.stringify(column)).join(', ')}`,
    )
    .all();
  return rows.map((row) => columns.map((column) => row[column]));
}

function sortedProjection(rows) {
  const normalize = (value) => {
    if (typeof value === 'number') return Number(value).toPrecision(15);
    if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
      return Number(value).toPrecision(15);
    }
    return value === null ? null : String(value);
  };
  return rows.map((row) => JSON.stringify(row.map(normalize))).sort();
}

function businessProjectionMismatches(db, pkg, actorId) {
  const expected = {};
  expected.customer_pool = pkg.customers.map((customer) => [
    customer.customerId,
    customer.domain || '',
    customer.standardName || customer.companyName,
    customer.localName || '',
    customer.englishName || '',
    customer.country || '',
    customer.countryCode || '',
    customer.city || '',
    customer.website || '',
    customer.industry || '',
    customer.customerType || '',
    customer.description || '',
    customer.products || '',
    customer.phone || '',
    customer.email || '',
    customer.inn || '',
    customer.foundedYear || '',
    customer.sanctionsStatus || '',
    customer.websiteVerified ? 'verified' : 'pending',
    (customer.reviewReasons || []).join(';'),
  ]);
  expected.company_identifiers = pkg.customers.flatMap((customer) =>
    ['inn', 'ogrn']
      .filter((type) => customer[type])
      .map((type) => [
        customer.customerId,
        type,
        customer[type],
        customer.countryCode || '',
      ]),
  );
  const screening = new Map((pkg.screening || []).map((row) => [row.customerId, row]));
  expected.company_screening = pkg.customers.map((customer) => {
    const scr = screening.get(customer.customerId) || {};
    return [
      customer.customerId,
      customer.description || '',
      customer.customerType || '',
      JSON.stringify((customer.products || '').split(/[;，,]/).map((value) => value.trim()).filter(Boolean)),
      0,
      '',
      scr.riskLevel || 'review',
      'verified',
    ];
  });
  expected.contacts = (pkg.contacts || []).map((contact) => [
    contact.customerId,
    contact['联系人姓名'] || '',
    contact['职位'] || '',
    contact['部门'] || '',
    contact['决策角色'] || '',
    contact['角色类别'] || '',
    contact['联系等级'] || '',
    contact['在职状态'] || '',
    contact['在职置信度'] || '',
    contact['数据状态'] === '可导入' ? 'verified' : 'review',
    contact['联系人证据网址'] || '',
    contact['人员ID'] || '',
  ]);
  expected.contact_methods = (pkg.contacts || []).flatMap((contact) =>
    [['email', contact['邮箱'] || ''], ['phone', contact['电话'] || '']]
      .filter(([, value]) => value)
      .map(([type, value]) => [
        contact.customerId,
        type,
        value,
        type === 'email' ? value.toLowerCase() : value.replace(/\D/g, ''),
        'ok',
        contact['联系人证据网址'] || '',
        contact['人员ID'] || '',
        'package',
        contact['数据状态'] === '可导入' ? 'verified' : 'unverified',
        1,
        1,
        0,
        0,
      ]),
  );
  expected.company_entry_points = [];
  expected.website_checks = pkg.customers.filter((customer) => customer.website).map((customer) => [
    customer.customerId,
    customer.website,
    customer.websiteVerified ? 'ok' : 'pending',
    'package',
    '{}',
  ]);
  expected.sanction_checks = pkg.customers.map((customer) => [
    customer.customerId,
    'pipeline',
    customer.sanctionsStatus || 'unknown',
    customer.sanctionsStatus === 'hit' ? 'open' : 'clear',
  ]);
  expected.recon_evidence = (pkg.evidence || []).map((item) => [
    item.customerId,
    item.step || item.type || 'evidence',
    String(item.text || item.title || item.snippet || item.value || ''),
    item.url || item.evidence_url || '',
    item.title || '',
    typeof item.confidence === 'number' ? item.confidence : 0.5,
    'customer-rebuild-package',
  ]);
  expected.customer_tags = [...new Set(
    (pkg.tags || [])
      .map((tag) => [tag.customerId, String(tag.tag || tag['标签'] || '').trim()])
      .filter(([, name]) => name)
      .map((row) => JSON.stringify(row)),
  )].map((row) => JSON.parse(row));
  expected.crm_intake_items = pkg.customers.map((customer) => [
    customer.customerId,
    customer.standardName || customer.companyName,
    customer.country || '',
    customer.website || '',
    customer.industry || '',
    customer.customerType || '',
    customer.products || '',
    customer.dataStatus === 'READY' ? 'approved' : 'pending',
    customer.dataStatus === 'REVIEW' ? '数据待核实' : '',
  ]);
  expected.crm_intake_batches = [[
    'customer-rebuild-package',
    'completed',
    pkg.customers.length,
    pkg.customers.length,
    0,
    0,
    String(actorId || ''),
  ]];

  const actual = {
    customer_pool: projectionRows(db, 'customer_pool', ['customer_id', 'domain', 'company_name', 'russian_name', 'english_name', 'country', 'country_code', 'city', 'website', 'industry', 'customer_type', 'description', 'products', 'phone', 'email', 'inn', 'established_year', 'risk_status', 'website_verification', 'notes']),
    company_identifiers: projectionRows(db, 'company_identifiers', ['customer_id', 'identifier_type', 'identifier_value', 'country_code']),
    company_screening: projectionRows(db, 'company_screening', ['customer_id', 'business_summary', 'company_type', 'product_categories_json', 'match_score', 'match_group', 'risk_level', 'screening_status']),
    contacts: projectionRows(db, 'contacts', ['customer_id', 'name', 'title', 'department', 'decision_role', 'role_category', 'contact_level', 'employment_status', 'employment_confidence', 'quality_status', 'source_url', 'person_id']),
    contact_methods: projectionRows(db, 'contact_methods', ['customer_id', 'method_type', 'value', 'normalized_value', 'status', 'source_url', 'person_id', 'discovery_type', 'verification_status', 'confidence', 'is_direct', 'is_generic', 'is_inferred']),
    company_entry_points: projectionRows(db, 'company_entry_points', ['customer_id']),
    website_checks: projectionRows(db, 'website_checks', ['customer_id', 'url', 'status', 'method', 'details_json']),
    sanction_checks: projectionRows(db, 'sanction_checks', ['customer_id', 'provider', 'result', 'review_status']),
    recon_evidence: projectionRows(db, 'recon_evidence', ['customer_id', 'field_name', 'value', 'source_url', 'source_title', 'confidence', 'extractor']),
    customer_tags: projectionRows(db, 'customer_tags', ['customer_id', 'tag_id']).map(([customerId, tagId]) => [customerId, db.prepare('SELECT name FROM tags WHERE id = ?').get(tagId).name]),
    crm_intake_items: projectionRows(db, 'crm_intake_items', ['external_customer_id', 'company_name', 'country', 'website', 'industry', 'customer_type', 'product_focus', 'status', 'decision_reason']),
    crm_intake_batches: projectionRows(db, 'crm_intake_batches', ['source', 'status', 'candidate_count', 'imported_count', 'assigned_count', 'skipped_count', 'created_by']),
  };
  const mismatches = {};
  for (const table of Object.keys(expected)) {
    if (JSON.stringify(sortedProjection(actual[table])) !== JSON.stringify(sortedProjection(expected[table]))) {
      mismatches[table] = {
        expected: expected[table].length,
        actual: actual[table].length,
      };
    }
  }
  return mismatches;
}

function reconcileAfter(db, pkg, plan, context) {
  const checks = {};
  checks.expectedTableCounts = { ...plan.expectedAfterCounts };
  checks.tableCounts = {};
  checks.tableCountMismatches = {};
  for (const table of [...plan.clearedTables, ...plan.replacedTables].sort()) {
    const actual = countTable(db, table);
    const expected = plan.expectedAfterCounts[table];
    checks.tableCounts[table] = actual;
    if (actual !== expected) {
      checks.tableCountMismatches[table] = { expected, actual };
    }
  }
  checks.customerPool = checks.tableCounts.customer_pool;
  checks.intakeItems = checks.tableCounts.crm_intake_items;
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
  checks.ownershipOrphans = {
    companyIdentifiersCustomer: countOwnershipOrphans(db, 'company_identifiers'),
    companyScreeningCustomer: countOwnershipOrphans(db, 'company_screening'),
    contactsCustomer: countOwnershipOrphans(db, 'contacts'),
    contactMethodsCustomer: countOwnershipOrphans(db, 'contact_methods'),
    companyEntryPointsCustomer: countOwnershipOrphans(db, 'company_entry_points'),
    websiteChecksCustomer: countOwnershipOrphans(db, 'website_checks'),
    sanctionChecksCustomer: countOwnershipOrphans(db, 'sanction_checks'),
    evidenceCustomer: countOwnershipOrphans(db, 'recon_evidence'),
    customerTagsCustomer: countOwnershipOrphans(db, 'customer_tags'),
    intakeItemsCustomer: countOwnershipOrphans(
      db,
      'crm_intake_items',
      'external_customer_id',
    ),
    contactMethodsContact: db
      .prepare(`
        SELECT COUNT(*) AS n
        FROM contact_methods AS method
        LEFT JOIN contacts AS contact ON contact.contact_id = method.contact_id
        WHERE contact.contact_id IS NULL
      `)
      .get().n,
    customerTagsTag: db
      .prepare(`
        SELECT COUNT(*) AS n
        FROM customer_tags AS customer_tag
        LEFT JOIN tags AS tag ON tag.id = customer_tag.tag_id
        WHERE tag.id IS NULL
      `)
      .get().n,
    intakeItemsBatch: db
      .prepare(`
        SELECT COUNT(*) AS n
        FROM crm_intake_items AS item
        LEFT JOIN crm_intake_batches AS batch ON batch.id = item.batch_id
        WHERE batch.id IS NULL
      `)
      .get().n,
  };
  checks.foreignKeyViolations = (db.pragma('foreign_key_check') || []).length;
  checks.businessProjectionMismatches = businessProjectionMismatches(db, pkg, context.actorId);
  checks.quickCheck = pragmaResult(db, 'quick_check') || '';
  checks.integrityCheck = pragmaResult(db, 'integrity_check') || '';
  const maintenanceRow = db
    .prepare('SELECT * FROM crm_data_maintenance_runs WHERE id = ?')
    .get(context.maintenanceRunId);
  const maintenanceKeys = maintenanceRow ? Object.keys(maintenanceRow) : [];
  const exactMaintenanceRecord = Boolean(
    maintenanceRow &&
      maintenanceKeys.length === Object.keys(context.expectedMaintenanceRow).length &&
      maintenanceKeys.every(
        (key) => maintenanceRow[key] === context.expectedMaintenanceRow[key],
      ),
  );
  checks.maintenanceAppend = {
    beforeCount: context.maintenanceBeforeCount,
    afterCount: countTable(db, 'crm_data_maintenance_runs'),
    countDelta:
      countTable(db, 'crm_data_maintenance_runs') - context.maintenanceBeforeCount,
    previousRowsStable:
      tableHashExcludingId(
        db,
        'crm_data_maintenance_runs',
        context.maintenanceRunId,
      ) === context.maintenanceBeforeHash,
    exactRecord: exactMaintenanceRecord,
  };
  checks.passed =
    Object.keys(checks.tableCountMismatches).length === 0 &&
    checks.approvedIntake === pkg.customers.filter((c) => c.dataStatus === 'READY').length &&
    checks.pendingIntake === pkg.customers.filter((c) => c.dataStatus === 'REVIEW').length &&
    checks.duplicateCustomerIds === 0 &&
    Object.values(checks.ownershipOrphans).every((count) => count === 0) &&
    Object.keys(checks.businessProjectionMismatches).length === 0 &&
    checks.foreignKeyViolations === 0 &&
    String(checks.quickCheck).toLowerCase() === 'ok' &&
    String(checks.integrityCheck).toLowerCase() === 'ok' &&
    checks.maintenanceAppend.countDelta === 1 &&
    checks.maintenanceAppend.previousRowsStable &&
    checks.maintenanceAppend.exactRecord;
  return checks;
}

function applyCustomerRebuild(db, pkg, options) {
  if (db.inTransaction) {
    throw new Error('apply requires transaction ownership');
  }
  const { packageSha256, planManifest, actorId, backupFile } = options;
  if (!packageSha256 || !planManifest) {
    throw new Error('packageSha256 and planManifest are required');
  }
  if (options.packagePath && hashFile(options.packagePath) !== packageSha256) {
    throw new Error('package sha256 mismatch');
  }

  const run = db.transaction(() => {
    assertNoTempSchema(db);
    const plan = planCustomerRebuild(db, pkg, packageSha256);
    if (createRebuildManifest(plan) !== planManifest) {
      throw new Error('plan manifest mismatch');
    }
    const beforeHashes = { ...plan.preservedHashes };
    const maintenanceBeforeCount = countTable(db, 'crm_data_maintenance_runs');
    const maintenanceBeforeHash = tableHash(db, 'crm_data_maintenance_runs');
    const immutableTriggers = immutableTriggersFor(db, plan.clearedTables);
    const deleteOrder = [
      ...dependencyOrder(db, [...plan.clearedTables, ...plan.replacedTables]),
    ].reverse();

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
    const intakeContext = insertIntakeData(db, pkg, actorId, {
      packageSha256,
      planManifest,
      backupFile: backupFile || '',
      backupEvidence: options.backupEvidence || null,
    });
    for (const trigger of immutableTriggers) {
      db.exec(trigger.sql);
    }

    const afterHashes = {};
    for (const table of Object.keys(beforeHashes)) {
      if (table === 'crm_data_maintenance_runs') continue;
      afterHashes[table] = tableHash(db, table);
      if (afterHashes[table] !== beforeHashes[table]) {
        throw new Error(`preserved table hash changed: ${table}`);
      }
    }
    if (schemaFingerprint(db) !== plan.schemaFingerprint) {
      throw new Error('schema fingerprint changed during apply');
    }
    const checks = reconcileAfter(db, pkg, plan, {
      ...intakeContext,
      maintenanceBeforeCount,
      maintenanceBeforeHash,
      backupFile: backupFile || '',
      actorId,
    });
    if (!checks.passed) {
      throw new Error(`reconciliation failed: ${JSON.stringify(checks)}`);
    }
    return {
      plan,
      beforeCounts: plan.beforeCounts,
      checks,
      preservedHashes: afterHashes,
      backupFile: backupFile || '',
      backupEvidence: options.backupEvidence || null,
    };
  });
  return run.immediate();
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
  tableHash,
  PRESERVED_TABLES,
  REPLACED_TABLES,
  CLEARED_TABLES,
  PRESERVED_HASH_TABLES,
};

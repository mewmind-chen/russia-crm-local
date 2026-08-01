'use strict';

const crypto = require('node:crypto');
const { allocateCustomerId, normalizeCountryPrefix } = require('./customer_ids');
const { hasPermission } = require('./access_control');
const {
  assertProtectedCustomerWritesEnabled,
  installCustomerIdentityRegistry,
  normalizeCustomerName,
  protectedCustomerWritesEnabled,
  reserveCustomerIdentity,
} = require('./customer_identity_registry');

function nowText() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function lifecycleError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function hasTable(db, table) {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function installProtectedCustomers(db) {
  installCustomerIdentityRegistry(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_protected_customer_batches (
      batch_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'previewed'
        CHECK(status IN ('previewed','committing','committed','rolled_back')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      committed_at TEXT NOT NULL DEFAULT '',
      rolled_back_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS crm_protected_customer_batch_rows (
      row_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      row_number INTEGER NOT NULL,
      input_version TEXT NOT NULL,
      alpha_nickname TEXT NOT NULL DEFAULT '',
      normalized_name TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'ready'
        CHECK(status IN ('ready','imported','rejected','rolled_back')),
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id,row_number),
      FOREIGN KEY(batch_id) REFERENCES crm_protected_customer_batches(batch_id)
    );
    CREATE INDEX IF NOT EXISTS crm_protected_batch_rows_batch_idx
      ON crm_protected_customer_batch_rows(batch_id,row_number);
    CREATE TABLE IF NOT EXISTS crm_protected_customers (
      external_customer_id TEXT PRIMARY KEY,
      normalized_name TEXT NOT NULL,
      alpha_nickname TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'protected'
        CHECK(status IN ('protected','activated','withdrawn')),
      activated_account_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      activated_by TEXT NOT NULL DEFAULT '',
      activated_at TEXT NOT NULL DEFAULT '',
      withdrawn_by TEXT NOT NULL DEFAULT '',
      withdrawn_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY(batch_id) REFERENCES crm_protected_customer_batches(batch_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_protected_customers_live_name_idx
      ON crm_protected_customers(normalized_name) WHERE status!='withdrawn';
    CREATE INDEX IF NOT EXISTS crm_protected_customers_status_idx
      ON crm_protected_customers(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS crm_protected_customer_audit (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      batch_id TEXT NOT NULL DEFAULT '',
      row_id TEXT NOT NULL DEFAULT '',
      external_customer_id TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_protected_customer_audit_customer_idx
      ON crm_protected_customer_audit(external_customer_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS crm_protected_customer_action_requests (
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('commit','activate','rollback')),
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed')),
      response_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(actor_id,idempotency_key)
    );
  `);
}

function assertProtectedCustomerAdmin(user) {
  if (user?.role !== 'admin' || !hasPermission(user, 'manage_protected_customers')
      || user?.isImpersonating) {
    throw lifecycleError('只有真实管理员可以管理合作客户保护', 'PROTECTED_CUSTOMER_ADMIN_REQUIRED', 403);
  }
}

function normalizeProtectedRow(input = {}, rowNumber = 0) {
  const alphaNickname = String(input.alphaNickname ?? input.nickname ?? '').normalize('NFKC').trim()
    .replace(/\s+/gu, ' ');
  const normalizedName = normalizeCustomerName(alphaNickname);
  const payload = {
    alphaNickname,
    companyName: String(input.companyName || '').trim(),
    country: String(input.country || '').trim(),
    city: String(input.city || '').trim(),
    website: String(input.website || '').trim(),
    industry: String(input.industry || '').trim(),
    customerType: String(input.customerType || '').trim(),
    productFocus: String(input.productFocus || '').trim(),
  };
  const error = !normalizedName
    ? {
      code: 'PROTECTED_CUSTOMER_ALPHA_NICKNAME_REQUIRED',
      message: 'Alpha 客户昵称不能为空',
    }
    : null;
  return {
    rowNumber,
    alphaNickname,
    normalizedName,
    payload,
    inputVersion: `sha256:${digest(payload)}`,
    error,
  };
}

function identityOwnersForName(db, normalizedName, excludeExternalCustomerId = '') {
  if (!normalizedName) return [];
  const owners = new Set();
  const specs = [
    ['customer_pool', 'customer_id', ['company_name', 'nickname', 'russian_name', 'english_name']],
    ['crm_accounts', 'external_customer_id', ['company_name', 'nickname']],
    ['customer_nickname_audit', 'external_customer_id', ['old_nickname', 'new_nickname']],
  ];
  for (const [table, idColumn, candidates] of specs) {
    const columns = tableColumns(db, table);
    if (!columns.has(idColumn)) continue;
    const nameColumns = candidates.filter(column => columns.has(column));
    if (!nameColumns.length) continue;
    const rows = db.prepare(`SELECT ${idColumn} external_customer_id,${nameColumns.join(',')}
      FROM ${table} WHERE TRIM(COALESCE(${idColumn},''))!=''`).all();
    for (const row of rows) {
      const externalCustomerId = String(row.external_customer_id || '').trim();
      if (!externalCustomerId || externalCustomerId === excludeExternalCustomerId) continue;
      if (nameColumns.some(column => normalizeCustomerName(row[column]) === normalizedName)) {
        owners.add(externalCustomerId);
      }
    }
  }
  const registry = db.prepare(`SELECT external_customer_id FROM crm_customer_identity_registry
    WHERE normalized_name=?`).get(normalizedName);
  if (registry?.external_customer_id && registry.external_customer_id !== excludeExternalCustomerId) {
    owners.add(registry.external_customer_id);
  }
  return [...owners].sort();
}

function assertCustomerIdentityAvailable(db, payload = {}) {
  const normalizedName = normalizeCustomerName(payload.name);
  if (!normalizedName) return { normalizedName: '', reserved: false };
  const externalCustomerId = String(payload.externalCustomerId || '').trim();
  if (identityOwnersForName(db, normalizedName, externalCustomerId).length) {
    throw lifecycleError(
      '客户名称需要管理员核验后才能使用',
      'CUSTOMER_IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
  if (hasTable(db, 'crm_customer_identity_name_tombstones')) {
    const tombstone = db.prepare(`SELECT 1 FROM crm_customer_identity_name_tombstones
      WHERE normalized_name=? AND released_at=''`).get(normalizedName);
    if (tombstone) {
      throw lifecycleError(
        '客户名称需要管理员核验后才能使用',
        'CUSTOMER_IDENTITY_REVIEW_REQUIRED',
        409,
      );
    }
  }
  if (!protectedCustomerWritesEnabled()) return { normalizedName, reserved: false };
  reserveCustomerIdentity(db, {
    externalCustomerId,
    name: payload.name,
    source: String(payload.source || 'crm_customer_identity'),
    actorId: String(payload.actorId || ''),
  });
  return { normalizedName, reserved: true };
}

function rowView(row) {
  return {
    rowId: row.row_id,
    rowNumber: row.row_number,
    inputVersion: row.input_version,
    alphaNickname: row.alpha_nickname,
    normalizedName: row.normalized_name,
    externalCustomerId: row.external_customer_id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function batchResult(db, batchId) {
  const batch = db.prepare('SELECT * FROM crm_protected_customer_batches WHERE batch_id=?').get(batchId);
  if (!batch) throw lifecycleError('保护客户批次不存在', 'PROTECTED_CUSTOMER_BATCH_NOT_FOUND', 404);
  const rows = db.prepare(`SELECT * FROM crm_protected_customer_batch_rows
    WHERE batch_id=? ORDER BY row_number`).all(batchId).map(rowView);
  return {
    batchId,
    status: batch.status,
    imported: rows.filter(row => row.status === 'imported').length,
    rejected: rows.filter(row => row.status === 'rejected').length,
    rows,
  };
}

function previewProtectedBatch(db, user, rows, options = {}) {
  assertProtectedCustomerAdmin(user);
  assertProtectedCustomerWritesEnabled();
  installProtectedCustomers(db);
  if (!Array.isArray(rows) || !rows.length) {
    throw lifecycleError('至少需要一条保护客户资料', 'PROTECTED_CUSTOMER_BATCH_EMPTY');
  }
  if (rows.length > 5000) {
    throw lifecycleError('单批最多导入 5000 条保护客户', 'PROTECTED_CUSTOMER_BATCH_TOO_LARGE');
  }
  const normalizedRows = rows.map((row, index) => normalizeProtectedRow(row, index + 1));
  const inputHash = `sha256:${digest(normalizedRows.map(row => row.payload))}`;
  const idempotencyKey = String(options.idempotencyKey || '').trim() || `preview:${inputHash}`;
  const existing = db.prepare(`SELECT batch_id,input_hash FROM crm_protected_customer_batches
    WHERE idempotency_key=?`).get(idempotencyKey);
  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw lifecycleError('幂等键对应的预览内容已变化', 'PROTECTED_CUSTOMER_IDEMPOTENCY_MISMATCH', 409);
    }
    return batchResult(db, existing.batch_id);
  }

  const duplicateNames = new Map();
  for (const row of normalizedRows) {
    if (!row.normalizedName) continue;
    duplicateNames.set(row.normalizedName, (duplicateNames.get(row.normalizedName) || 0) + 1);
  }
  const batchId = createId('PCB');
  const timestamp = nowText();
  db.transaction(() => {
    db.prepare(`INSERT INTO crm_protected_customer_batches
      (batch_id,idempotency_key,input_hash,status,created_by,created_at)
      VALUES (?,?,?,?,?,?)`).run(batchId, idempotencyKey, inputHash, 'previewed', user.id, timestamp);
    const insert = db.prepare(`INSERT INTO crm_protected_customer_batch_rows
      (row_id,batch_id,row_number,input_version,alpha_nickname,normalized_name,payload_json,
       status,error_code,error_message,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of normalizedRows) {
      let error = row.error;
      if (!error && duplicateNames.get(row.normalizedName) > 1) {
        error = { code: 'PROTECTED_CUSTOMER_BATCH_DUPLICATE_NAME', message: '本批次存在重复 Alpha 客户昵称' };
      }
      if (!error && identityOwnersForName(db, row.normalizedName).length) {
        error = { code: 'PROTECTED_CUSTOMER_IDENTITY_REVIEW_REQUIRED', message: '名称已存在，请先完成管理员身份核验' };
      }
      insert.run(
        createId('PCR'), batchId, row.rowNumber, row.inputVersion, row.alphaNickname,
        row.normalizedName, JSON.stringify(row.payload), error ? 'rejected' : 'ready',
        error?.code || '', error?.message || '', timestamp, timestamp,
      );
    }
  }).immediate();
  return batchResult(db, batchId);
}

function allocateProtectedCustomerId(db, payload) {
  const usedIds = new Set(db.prepare('SELECT customer_id FROM customer_pool').all()
    .map(row => row.customer_id));
  return allocateCustomerId(usedIds, normalizeCountryPrefix(payload.country || 'XX', 'XX'), {});
}

function insertProtectedPoolRow(db, externalCustomerId, payload, timestamp) {
  db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,nickname,country,city,website,industry,customer_type,products,
     current_pool,source_file,first_found,last_found,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    externalCustomerId,
    '',
    '',
    payload.country,
    payload.city,
    payload.website,
    payload.industry,
    payload.customerType,
    payload.productFocus,
    '未分池',
    '合作客户保护名单',
    timestamp.slice(0, 10),
    timestamp.slice(0, 10),
    timestamp,
    timestamp,
  );
}

function commitProtectedRow(db, user, row) {
  const payload = JSON.parse(row.payload_json || '{}');
  return db.transaction(() => {
    const latest = db.prepare('SELECT * FROM crm_protected_customer_batch_rows WHERE row_id=?').get(row.row_id);
    if (latest.status === 'imported') return rowView(latest);
    if (latest.status !== 'ready') return rowView(latest);
    const owners = identityOwnersForName(db, latest.normalized_name);
    if (owners.length) {
      throw lifecycleError('名称已存在，请先完成管理员身份核验', 'PROTECTED_CUSTOMER_IDENTITY_REVIEW_REQUIRED', 409);
    }
    const externalCustomerId = allocateProtectedCustomerId(db, payload);
    const timestamp = nowText();
    reserveCustomerIdentity(db, {
      externalCustomerId,
      name: latest.alpha_nickname,
      source: 'protected_alpha_nickname',
      actorId: user.id,
    });
    insertProtectedPoolRow(db, externalCustomerId, payload, timestamp);
    db.prepare(`INSERT INTO crm_protected_customers
      (external_customer_id,normalized_name,alpha_nickname,batch_id,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      externalCustomerId, latest.normalized_name, latest.alpha_nickname, latest.batch_id,
      'protected', user.id, timestamp, timestamp,
    );
    db.prepare(`UPDATE crm_protected_customer_batch_rows
      SET external_customer_id=?,status='imported',updated_at=? WHERE row_id=?`)
      .run(externalCustomerId, timestamp, latest.row_id);
    db.prepare(`INSERT INTO crm_protected_customer_audit
      (id,action,batch_id,row_id,external_customer_id,actor_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      createId('PCA'), 'protected_customer_imported', latest.batch_id, latest.row_id,
      externalCustomerId, user.id, JSON.stringify({ inputVersion: latest.input_version }), timestamp,
    );
    return rowView(db.prepare('SELECT * FROM crm_protected_customer_batch_rows WHERE row_id=?').get(latest.row_id));
  })();
}

function readActionReplay(db, actorId, action, idempotencyKey, requestHash) {
  if (!idempotencyKey) return null;
  const existing = db.prepare(`SELECT * FROM crm_protected_customer_action_requests
    WHERE actor_id=? AND idempotency_key=?`).get(actorId, idempotencyKey);
  if (!existing) return null;
  if (existing.action !== action || existing.request_hash !== requestHash) {
    throw lifecycleError('幂等键对应的操作内容已变化', 'PROTECTED_CUSTOMER_IDEMPOTENCY_MISMATCH', 409);
  }
  if (existing.status !== 'completed') {
    throw lifecycleError('相同操作正在处理中', 'PROTECTED_CUSTOMER_ACTION_IN_PROGRESS', 409);
  }
  return JSON.parse(existing.response_json || '{}');
}

function startAction(db, actorId, action, idempotencyKey, requestHash) {
  if (!idempotencyKey) return;
  const timestamp = nowText();
  db.prepare(`INSERT INTO crm_protected_customer_action_requests
    (actor_id,idempotency_key,action,request_hash,status,response_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    actorId, idempotencyKey, action, requestHash, 'started', '{}', timestamp, timestamp,
  );
}

function completeAction(db, actorId, idempotencyKey, response) {
  if (!idempotencyKey) return;
  db.prepare(`UPDATE crm_protected_customer_action_requests
    SET status='completed',response_json=?,updated_at=? WHERE actor_id=? AND idempotency_key=?`)
    .run(JSON.stringify(response), nowText(), actorId, idempotencyKey);
}

function commitProtectedBatch(db, user, batchId, options = {}) {
  assertProtectedCustomerAdmin(user);
  assertProtectedCustomerWritesEnabled();
  installProtectedCustomers(db);
  const cleanBatchId = String(batchId || '').trim();
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  const requestHash = `sha256:${digest({ batchId: cleanBatchId })}`;
  return db.transaction(() => {
    const replay = readActionReplay(db, user.id, 'commit', idempotencyKey, requestHash);
    if (replay) return replay;
    const batch = db.prepare('SELECT * FROM crm_protected_customer_batches WHERE batch_id=?').get(cleanBatchId);
    if (!batch) throw lifecycleError('保护客户批次不存在', 'PROTECTED_CUSTOMER_BATCH_NOT_FOUND', 404);
    if (batch.status === 'committed') return batchResult(db, cleanBatchId);
    if (batch.status === 'rolled_back') {
      throw lifecycleError('保护客户批次已回滚', 'PROTECTED_CUSTOMER_BATCH_ROLLED_BACK', 409);
    }
    startAction(db, user.id, 'commit', idempotencyKey, requestHash);
    db.prepare("UPDATE crm_protected_customer_batches SET status='committing' WHERE batch_id=?")
      .run(cleanBatchId);
    const readyRows = db.prepare(`SELECT * FROM crm_protected_customer_batch_rows
      WHERE batch_id=? AND status='ready' ORDER BY row_number`).all(cleanBatchId);
    for (const row of readyRows) {
      try {
        commitProtectedRow(db, user, row);
      } catch (error) {
        const expected = String(error.code || '').startsWith('PROTECTED_CUSTOMER_')
          || String(error.code || '').startsWith('CUSTOMER_IDENTITY_')
          || String(error.code || '').startsWith('SQLITE_CONSTRAINT');
        if (!expected) throw error;
        db.prepare(`UPDATE crm_protected_customer_batch_rows
          SET status='rejected',error_code=?,error_message=?,updated_at=? WHERE row_id=?`)
          .run(
            String(error.code || 'PROTECTED_CUSTOMER_ROW_REJECTED'),
            String(error.message || '该行导入失败'),
            nowText(),
            row.row_id,
          );
      }
    }
    db.prepare(`UPDATE crm_protected_customer_batches
      SET status='committed',committed_at=? WHERE batch_id=?`).run(nowText(), cleanBatchId);
    const result = batchResult(db, cleanBatchId);
    completeAction(db, user.id, idempotencyKey, result);
    return result;
  }).immediate();
}

function activateProtectedCustomer(db, user, externalCustomerId, payload = {}) {
  assertProtectedCustomerAdmin(user);
  assertProtectedCustomerWritesEnabled();
  installProtectedCustomers(db);
  const cleanId = String(externalCustomerId || '').trim();
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const requestHash = `sha256:${digest({
    externalCustomerId: cleanId,
    ownerId: String(payload.ownerId || '').trim(),
    companyName: String(payload.companyName || '').trim(),
    country: String(payload.country || '').trim(),
    city: String(payload.city || '').trim(),
    website: String(payload.website || '').trim(),
    industry: String(payload.industry || '').trim(),
    customerType: String(payload.customerType || '').trim(),
    productFocus: String(payload.productFocus || '').trim(),
    priority: String(payload.priority || 'B'),
    stage: String(payload.stage || 'qualified'),
  })}`;
  return db.transaction(() => {
    const replay = readActionReplay(db, user.id, 'activate', idempotencyKey, requestHash);
    if (replay) return replay;
    const protectedRow = db.prepare(`SELECT * FROM crm_protected_customers
      WHERE external_customer_id=?`).get(cleanId);
    if (!protectedRow || protectedRow.status === 'withdrawn') {
      throw lifecycleError('保护客户不存在', 'PROTECTED_CUSTOMER_NOT_FOUND', 404);
    }
    if (protectedRow.status === 'activated') {
      return {
        externalCustomerId: cleanId,
        accountId: protectedRow.activated_account_id,
        status: 'activated',
      };
    }
    startAction(db, user.id, 'activate', idempotencyKey, requestHash);
    const ownerId = String(payload.ownerId || '').trim();
    if (!ownerId || !db.prepare("SELECT 1 FROM sales_users WHERE id=? AND active=1").get(ownerId)) {
      throw lifecycleError('请选择有效的在职销售负责人', 'PROTECTED_CUSTOMER_OWNER_REQUIRED');
    }
    const existingAccount = db.prepare(`SELECT id FROM crm_accounts
      WHERE external_customer_id=? AND COALESCE(lifecycle_status,'active')='active' LIMIT 1`).get(cleanId);
    if (existingAccount) {
      throw lifecycleError('该保护客户已经存在 CRM 主档', 'PROTECTED_CUSTOMER_ACCOUNT_EXISTS', 409);
    }
    if (identityOwnersForName(db, protectedRow.normalized_name, cleanId).length) {
      throw lifecycleError('名称已存在，请先完成管理员身份核验', 'PROTECTED_CUSTOMER_IDENTITY_REVIEW_REQUIRED', 409);
    }
    reserveCustomerIdentity(db, {
      externalCustomerId: cleanId,
      name: protectedRow.alpha_nickname,
      source: 'protected_activation',
      actorId: user.id,
    });
    const master = db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get(cleanId);
    const timestamp = nowText();
    const companyName = String(payload.companyName || '').trim();
    if (!companyName) {
      throw lifecycleError(
        '激活保护客户前必须填写 CRM 正式公司名称',
        'PROTECTED_CUSTOMER_COMPANY_NAME_REQUIRED',
      );
    }
    reserveCustomerIdentity(db, {
      externalCustomerId: cleanId,
      name: companyName,
      source: 'protected_activation_company_name',
      actorId: user.id,
    });
    const accountId = createId('CRM');
    db.prepare(`UPDATE customer_pool SET company_name=?,country=?,city=?,website=?,industry=?,
      customer_type=?,products=?,updated_at=? WHERE customer_id=?`).run(
      companyName,
      String(payload.country ?? master?.country ?? ''),
      String(payload.city ?? master?.city ?? ''),
      String(payload.website ?? master?.website ?? ''),
      String(payload.industry ?? master?.industry ?? ''),
      String(payload.customerType ?? master?.customer_type ?? ''),
      String(payload.productFocus ?? master?.products ?? ''),
      timestamp,
      cleanId,
    );
    db.prepare(`INSERT INTO crm_accounts
      (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,
       product_focus,priority,potential_value,stage,owner_id,created_by,manager_id,manager_required,
       manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,
       assignment_status,assigned_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      accountId, cleanId, companyName,
      String(payload.country ?? master?.country ?? ''),
      String(payload.city ?? master?.city ?? ''),
      String(payload.website ?? master?.website ?? ''),
      String(payload.industry ?? master?.industry ?? ''),
      String(payload.customerType ?? master?.customer_type ?? ''),
      '合作客户保护激活', String(payload.productFocus ?? master?.products ?? ''),
      String(payload.priority || 'B'), Number(payload.potentialValue || 0),
      String(payload.stage || 'qualified'), ownerId, user.id, String(payload.managerId || 'USR-MGR'),
      0, '', '', String(payload.nextAction || '完成首次触达'), String(payload.nextActionAt || ''),
      '', timestamp, timestamp, 'assigned', timestamp,
    );
    db.prepare(`UPDATE crm_protected_customers SET status='activated',activated_account_id=?,
      activated_by=?,activated_at=?,updated_at=? WHERE external_customer_id=?`)
      .run(accountId, user.id, timestamp, timestamp, cleanId);
    db.prepare(`INSERT INTO crm_protected_customer_audit
      (id,action,batch_id,external_customer_id,actor_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      createId('PCA'), 'protected_customer_activated', protectedRow.batch_id, cleanId,
      user.id, JSON.stringify({ accountId, ownerId }), timestamp,
    );
    const result = { externalCustomerId: cleanId, accountId, status: 'activated' };
    completeAction(db, user.id, idempotencyKey, result);
    return result;
  }).immediate();
}

const BUSINESS_REFERENCE_SPECS = Object.freeze([
  ['crm_accounts', 'external_customer_id'],
  ['crm_intake_items', 'external_customer_id'],
  ['customers', 'customer_id'],
  ['recon_jobs', 'customer_id'],
  ['recon_results', 'customer_id'],
  ['person_candidates', 'customer_id'],
  ['contact_methods', 'customer_id'],
]);

function hasBusinessReference(db, externalCustomerId) {
  return BUSINESS_REFERENCE_SPECS.some(([table, column]) => {
    const columns = tableColumns(db, table);
    if (!columns.has(column)) return false;
    return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(externalCustomerId));
  });
}

function rollbackProtectedBatch(db, user, batchId, options = {}) {
  assertProtectedCustomerAdmin(user);
  assertProtectedCustomerWritesEnabled();
  installProtectedCustomers(db);
  const cleanBatchId = String(batchId || '').trim();
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  const requestHash = `sha256:${digest({ batchId: cleanBatchId, reason: String(options.reason || '') })}`;
  return db.transaction(() => {
    const replay = readActionReplay(db, user.id, 'rollback', idempotencyKey, requestHash);
    if (replay) return replay;
    const batch = db.prepare('SELECT * FROM crm_protected_customer_batches WHERE batch_id=?').get(cleanBatchId);
    if (!batch) throw lifecycleError('保护客户批次不存在', 'PROTECTED_CUSTOMER_BATCH_NOT_FOUND', 404);
    if (batch.status === 'rolled_back') return { batchId: cleanBatchId, rolledBack: true };
    const protectedRows = db.prepare(`SELECT * FROM crm_protected_customers
      WHERE batch_id=? AND status!='withdrawn'`).all(cleanBatchId);
    if (protectedRows.some(row => row.status !== 'protected' || hasBusinessReference(db, row.external_customer_id))) {
      throw lifecycleError(
        '批次包含已激活或已有业务引用的客户，不能回滚',
        'PROTECTED_CUSTOMER_BATCH_NOT_ROLLBACKABLE',
        409,
      );
    }
    startAction(db, user.id, 'rollback', idempotencyKey, requestHash);
    const timestamp = nowText();
    for (const row of protectedRows) {
      db.prepare(`DELETE FROM crm_customer_identity_registry
        WHERE external_customer_id=? AND source IN (
          'protected_alpha_nickname','protected_activation','protected_activation_company_name'
        )`)
        .run(row.external_customer_id);
      db.prepare(`UPDATE customer_pool SET company_name='',nickname='',russian_name='',english_name='',
        country='',city='',website='',industry='',customer_type='',products='',source_file='保护客户批次已回滚',
        updated_at=? WHERE customer_id=?`).run(timestamp, row.external_customer_id);
      db.prepare(`UPDATE crm_protected_customers SET status='withdrawn',withdrawn_by=?,
        withdrawn_at=?,updated_at=? WHERE external_customer_id=?`)
        .run(user.id, timestamp, timestamp, row.external_customer_id);
      db.prepare(`INSERT INTO crm_protected_customer_audit
        (id,action,batch_id,external_customer_id,actor_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        createId('PCA'), 'protected_customer_withdrawn', cleanBatchId, row.external_customer_id,
        user.id, JSON.stringify({ reason: String(options.reason || '') }), timestamp,
      );
    }
    db.prepare(`UPDATE crm_protected_customer_batch_rows SET status='rolled_back',updated_at=?
      WHERE batch_id=? AND status='imported'`).run(timestamp, cleanBatchId);
    db.prepare(`UPDATE crm_protected_customer_batches SET status='rolled_back',rolled_back_at=?
      WHERE batch_id=?`).run(timestamp, cleanBatchId);
    const result = { batchId: cleanBatchId, rolledBack: true };
    completeAction(db, user.id, idempotencyKey, result);
    return result;
  }).immediate();
}

function listProtectedCustomers(db, user, options = {}) {
  assertProtectedCustomerAdmin(user);
  installProtectedCustomers(db);
  const status = String(options.status || 'all');
  const query = String(options.query || '').trim();
  const conditions = ["p.status!='withdrawn'"];
  const params = [];
  if (['protected', 'activated'].includes(status)) {
    conditions.push('p.status=?');
    params.push(status);
  }
  if (query) {
    conditions.push('(p.alpha_nickname LIKE ? OR p.external_customer_id LIKE ? OR m.company_name LIKE ?)');
    params.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const rows = db.prepare(`SELECT p.external_customer_id externalCustomerId,
      p.alpha_nickname alphaNickname,p.status,p.activated_account_id accountId,
      p.created_at createdAt,p.activated_at activatedAt,m.company_name companyName,m.nickname
    FROM crm_protected_customers p
    LEFT JOIN customer_pool m ON m.customer_id=p.external_customer_id
    WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC,p.external_customer_id`).all(...params);
  return { items: rows, total: rows.length };
}

function isProtectedCustomer(db, externalCustomerId) {
  if (!hasTable(db, 'crm_protected_customers')) return false;
  return Boolean(db.prepare(`SELECT 1 FROM crm_protected_customers
    WHERE external_customer_id=? AND status IN ('protected','withdrawn')`)
    .get(String(externalCustomerId || '').trim()));
}

module.exports = {
  activateProtectedCustomer,
  assertCustomerIdentityAvailable,
  assertProtectedCustomerAdmin,
  commitProtectedBatch,
  identityOwnersForName,
  installProtectedCustomers,
  isProtectedCustomer,
  listProtectedCustomers,
  previewProtectedBatch,
  rollbackProtectedBatch,
};

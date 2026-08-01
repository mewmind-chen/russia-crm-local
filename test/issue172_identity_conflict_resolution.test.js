'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  auditProtectedCustomerIdentities,
  installCustomerIdentityRegistry,
  reserveCustomerIdentity,
} = require('../lib/customer_identity_registry');
const {
  installProtectedCustomerConflicts,
  listProtectedIdentityConflicts,
  resolveProtectedIdentityConflict,
} = require('../lib/protected_customer_conflicts');

const ADMIN = Object.freeze({
  id: 'USR-ADMIN',
  role: 'admin',
  permissions: { manage_protected_customers: true },
});
const MANAGER = Object.freeze({
  id: 'USR-MANAGER',
  role: 'manager',
  permissions: { manage_protected_customers: false },
});
const previousWriteGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
test.before(() => {
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
});
test.after(() => {
  if (previousWriteGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousWriteGate;
});

function installSources(db) {
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE customer_nickname_audit (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      old_nickname TEXT NOT NULL DEFAULT '',
      new_nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE customer_nickname_migration_audit (
      external_customer_id TEXT PRIMARY KEY,
      candidates_json TEXT NOT NULL DEFAULT '[]'
    );
  `);
  installCustomerIdentityRegistry(db);
  installProtectedCustomerConflicts(db);
}

function addConflict(db, name, leftId, rightId, sequence) {
  db.prepare(`INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES (?,?,?)`).run(leftId, `${leftId} Official`, name);
  db.prepare(`INSERT INTO crm_accounts(id,external_customer_id,company_name,nickname)
    VALUES (?,?,?,?)`).run(`ACCOUNT-${sequence}`, rightId, `${rightId} Official`, name);
}

function memoryFixture() {
  const db = new Database(':memory:');
  installSources(db);
  addConflict(db, 'Shared Alpha', 'EXT-A1', 'EXT-A2', 1);
  addConflict(db, 'Shared Beta', 'EXT-B1', 'EXT-B2', 2);
  db.prepare(`INSERT INTO customer_nickname_audit
    (id,external_customer_id,old_nickname,new_nickname) VALUES (?,?,?,?)`)
    .run('AUDIT-A', 'EXT-A1', 'Legacy Alpha', 'Shared Alpha');
  db.prepare(`INSERT INTO customer_nickname_migration_audit
    (external_customer_id,candidates_json) VALUES (?,?)`).run(
    'EXT-A2',
    JSON.stringify([{
      accountId: 'LEGACY-ACCOUNT-A2',
      nickname: 'Shared Alpha',
      updatedAt: '2026-07-02 00:00:00',
      createdAt: '2026-07-01 00:00:00',
    }]),
  );
  return db;
}

function listAll(db, options = {}) {
  return listProtectedIdentityConflicts(db, ADMIN, { page: 1, ...options });
}

function conflict(db, normalizedName) {
  return listAll(db, { status: 'all' }).items
    .find(item => item.normalizedName === normalizedName);
}

function assertPrivateError(error, expectedCode, statusCode) {
  assert.equal(error.code, expectedCode);
  assert.equal(error.statusCode, statusCode);
  assert.doesNotMatch(error.message, /shared|alpha|beta|EXT-/i);
  return true;
}

test('admin can search and page original conflict evidence without an automatic winner', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const databaseBefore = db.serialize();

  const firstPage = listProtectedIdentityConflicts(db, ADMIN, {
    status: 'unresolved',
    query: 'alpha',
    page: 1,
  });
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 20);
  assert.equal(firstPage.total, 1);
  assert.equal(firstPage.unresolved, 2);
  assert.equal(firstPage.items[0].normalizedName, 'shared alpha');
  assert.deepEqual(firstPage.items[0].externalCustomerIds, ['EXT-A1', 'EXT-A2']);
  assert.equal(firstPage.items[0].status, 'pending');
  assert.match(firstPage.items[0].expectedVersion, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(firstPage.items[0], 'winnerExternalCustomerId'), false);
  assert.equal(Object.hasOwn(firstPage.items[0], 'selectedExternalCustomerId'), false);
  assert.deepEqual(
    [...new Set(firstPage.items[0].aliases.map(item => item.sourceTable))].sort(),
    [
      'crm_accounts',
      'customer_nickname_audit',
      'customer_nickname_migration_audit',
      'customer_pool',
    ],
  );

  listAll(db);
  assert.deepEqual(db.serialize(), databaseBefore);
});

test('write gate blocks every resolution without changing conflict state', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared alpha');
  const before = db.serialize();
  process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'false';
  try {
    assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
      conflictId: item.conflictId,
      decision: 'link_existing',
      targetExternalCustomerId: 'EXT-A1',
      details: '人工核验完成',
      expectedVersion: item.expectedVersion,
    }), error => {
      assert.equal(error.code, 'PROTECTED_CUSTOMER_WRITES_DISABLED');
      assert.equal(error.statusCode, 409);
      return true;
    });
  } finally {
    process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true';
  }
  assert.deepEqual(db.serialize(), before);
});

test('manager, sales, and impersonated admin receive private 403 errors before conflict lookup', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const unknownPayload = {
    conflictId: 'identity-conflict:not-a-real-conflict',
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-SECRET',
    details: 'not authorized',
    expectedVersion: 'sha256:not-a-real-version',
  };

  for (const user of [
    MANAGER,
    { ...MANAGER, permissions: { manage_protected_customers: true } },
    { id: 'USR-SALES', role: 'sales', permissions: {} },
    { ...ADMIN, isImpersonating: true },
  ]) {
    assert.throws(
      () => listProtectedIdentityConflicts(db, user, { query: 'Shared Alpha' }),
      error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_FORBIDDEN', 403),
    );
    assert.throws(
      () => resolveProtectedIdentityConflict(db, user, unknownPayload),
      error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_FORBIDDEN', 403),
    );
  }
});

test('link_existing reuses an explicit candidate, preserves evidence, audits versions, and is idempotent', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const before = conflict(db, 'shared alpha');
  const payload = {
    conflictId: before.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-A1',
    details: { reason: '管理员核对合同和税号后确认同一客户', ticket: 'OPS-172' },
    expectedVersion: before.expectedVersion,
  };

  const resolved = resolveProtectedIdentityConflict(db, ADMIN, payload);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.decision, 'link_existing');
  assert.equal(resolved.targetExternalCustomerId, 'EXT-A1');
  assert.equal(resolved.version, 2);
  assert.match(resolved.expectedVersion, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(resolved.expectedVersion, before.expectedVersion);
  assert.equal(resolved.idempotent, false);
  assert.equal(
    auditProtectedCustomerIdentities(db, { apply: false }).unresolved,
    1,
  );
  assert.deepEqual(
    db.prepare(`SELECT normalized_name,external_customer_id,source
      FROM crm_customer_identity_registry WHERE normalized_name=?`).all('shared alpha'),
    [{
      normalized_name: 'shared alpha',
      external_customer_id: 'EXT-A1',
      source: 'identity_conflict_resolution',
    }],
  );
  const evidenceBefore = db.prepare(`SELECT evidence_json
    FROM crm_customer_identity_conflicts WHERE conflict_id=?`).get(before.conflictId).evidence_json;
  assert.deepEqual(JSON.parse(evidenceBefore).aliases, before.aliases);

  const audit = db.prepare(`SELECT actor_id,before_json,after_json,evidence_json,details_json
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?`).get(before.conflictId);
  assert.equal(audit.actor_id, ADMIN.id);
  assert.equal(JSON.parse(audit.before_json).expectedVersion, before.expectedVersion);
  assert.equal(JSON.parse(audit.after_json).expectedVersion, resolved.expectedVersion);
  assert.equal(JSON.parse(audit.details_json).reason, payload.details.reason);
  assert.equal(audit.evidence_json, evidenceBefore);

  const repeated = resolveProtectedIdentityConflict(db, ADMIN, payload);
  assert.deepEqual(repeated, { ...resolved, idempotent: true });
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
      WHERE conflict_id=?`).get(before.conflictId).count,
    1,
  );
  const history = conflict(db, 'shared alpha').history;
  assert.equal(history.length, 1);
  assert.equal(history[0].actorId, ADMIN.id);
  assert.equal(history[0].decision, 'link_existing');
  assert.equal(history[0].targetExternalCustomerId, 'EXT-A1');
  assert.equal(history[0].before.expectedVersion, before.expectedVersion);
  assert.equal(history[0].after.expectedVersion, resolved.expectedVersion);
  assert.equal(history[0].evidence.expectedVersion, before.sourceExpectedVersion);

  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    ...payload,
    targetExternalCustomerId: 'EXT-A2',
  }), error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE', 409));
  assert.equal(
    db.prepare(`SELECT COUNT(DISTINCT external_customer_id) count
      FROM crm_customer_identity_registry WHERE normalized_name=?`).get('shared alpha').count,
    1,
  );
});

test('resolver rejects missing or non-candidate winners and stale versions without leaking evidence', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared alpha');
  const base = {
    conflictId: item.conflictId,
    decision: 'link_existing',
    details: '人工核验完成',
    expectedVersion: item.expectedVersion,
  };

  assert.throws(
    () => resolveProtectedIdentityConflict(db, ADMIN, base),
    error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_TARGET_REQUIRED', 422),
  );
  assert.throws(
    () => resolveProtectedIdentityConflict(db, ADMIN, {
      ...base,
      targetExternalCustomerId: 'EXT-A1',
      details: { reason: true },
    }),
    error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_DETAILS_REQUIRED', 422),
  );
  assert.throws(
    () => resolveProtectedIdentityConflict(db, ADMIN, {
      ...base,
      targetExternalCustomerId: 'EXT-NOT-A-CANDIDATE',
    }),
    error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_TARGET_INVALID', 422),
  );
  assert.throws(
    () => resolveProtectedIdentityConflict(db, ADMIN, {
      ...base,
      targetExternalCustomerId: 'EXT-A1',
      expectedVersion: 'sha256:stale',
    }),
    error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE', 409),
  );
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_customer_identity_registry').get().count, 0);
});

test('list and idempotent resolution require the current registry owner and dedicated audit', t => {
  const databases = [];
  t.after(() => databases.forEach(db => db.close()));
  const mutations = [
    {
      apply: (db, item) => db.prepare(`DELETE FROM crm_customer_identity_conflict_audit
        WHERE conflict_id=?`).run(item.conflictId),
      repeatedCode: 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE',
    },
    {
      apply: db => db.prepare(`UPDATE crm_customer_identity_registry
        SET external_customer_id='EXT-A2' WHERE normalized_name='shared alpha'`).run(),
      repeatedCode: 'PROTECTED_IDENTITY_CONFLICT_INTEGRITY_INVALID',
    },
  ];
  for (const mutation of mutations) {
    const db = memoryFixture();
    databases.push(db);
    const item = conflict(db, 'shared alpha');
    const payload = {
      conflictId: item.conflictId,
      decision: 'link_existing',
      targetExternalCustomerId: 'EXT-A1',
      details: '人工核验完成',
      expectedVersion: item.expectedVersion,
    };
    resolveProtectedIdentityConflict(db, ADMIN, payload);
    assert.equal(
      auditProtectedCustomerIdentities(db, { apply: false }).unresolved,
      1,
    );
    mutation.apply(db, item);
    assert.equal(
      auditProtectedCustomerIdentities(db, { apply: false }).unresolved,
      2,
    );
    const listed = listAll(db, { status: 'unresolved' });
    assert.equal(listed.unresolved, 2);
    assert.equal(listed.total, 2);
    assert.equal(
      listed.items.find(row => row.conflictId === item.conflictId).status,
      'pending',
    );
    assert.throws(
      () => resolveProtectedIdentityConflict(db, ADMIN, payload),
      error => assertPrivateError(
        error,
        mutation.repeatedCode,
        409,
      ),
    );
  }
});

test('confirm_new succeeds only after the normalized source identity no longer conflicts', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const payload = {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '已补齐法定名称，确认这是独立的新客户',
    expectedVersion: item.expectedVersion,
  };

  assert.throws(
    () => resolveProtectedIdentityConflict(db, ADMIN, payload),
    error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_STILL_PRESENT', 409),
  );

  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '需要先补齐法定名称',
    expectedVersion: item.expectedVersion,
  });

  db.prepare(`UPDATE crm_accounts SET nickname=? WHERE external_customer_id=?`)
    .run('Distinct Beta Company', 'EXT-B2');
  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    ...payload,
    expectedVersion: retry.expectedVersion,
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.decision, 'confirm_new');
  assert.equal(resolved.targetExternalCustomerId, 'EXT-B1');
  assert.equal(
    db.prepare(`SELECT external_customer_id FROM crm_customer_identity_registry
      WHERE normalized_name=?`).get('shared beta').external_customer_id,
    'EXT-B1',
  );
  const audit = db.prepare(`SELECT source_version,evidence_json
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?
    ORDER BY rowid DESC LIMIT 1`).get(item.conflictId);
  assert.deepEqual(JSON.parse(audit.evidence_json).externalCustomerIds, ['EXT-B1']);
  assert.equal(JSON.parse(audit.evidence_json).expectedVersion, audit.source_version);
});

test('confirm_new accepts a new stable ID from the current unique source snapshot', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '等待新客户资料归一',
    expectedVersion: item.expectedVersion,
  });
  db.prepare(`UPDATE customer_pool SET nickname='Distinct B1'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Distinct B2'
    WHERE external_customer_id='EXT-B2'`).run();
  db.prepare(`INSERT INTO customer_pool(customer_id,company_name,nickname)
    VALUES ('EXT-B3','EXT-B3 Official','Shared Beta')`).run();

  const beforeConfirmation = auditProtectedCustomerIdentities(db, { apply: false });
  assert.equal(beforeConfirmation.unresolved, 2);
  assert.deepEqual(beforeConfirmation.storedUnresolved, [{
    conflictId: item.conflictId,
    status: 'retry',
  }]);
  const visible = conflict(db, 'shared beta');
  assert.deepEqual(visible.externalCustomerIds, ['EXT-B3']);
  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B3',
    details: '补资料后的唯一来源属于新客户 B3',
    expectedVersion: retry.expectedVersion,
  });
  assert.equal(resolved.targetExternalCustomerId, 'EXT-B3');
  const audit = db.prepare(`SELECT source_version,evidence_json
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?
    ORDER BY rowid DESC LIMIT 1`).get(item.conflictId);
  assert.deepEqual(JSON.parse(audit.evidence_json).externalCustomerIds, ['EXT-B3']);
  assert.equal(JSON.parse(audit.evidence_json).expectedVersion, audit.source_version);
});

function resolveZeroSourceConflict(db) {
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '两个来源都需要改为真实法定名称',
    expectedVersion: item.expectedVersion,
  });
  db.prepare(`UPDATE customer_pool SET nickname='Distinct B1'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Distinct B2'
    WHERE external_customer_id='EXT-B2'`).run();
  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '旧泛称已从两个真实客户资料中清除',
    expectedVersion: retry.expectedVersion,
  });
  return { item, resolved, retry };
}

test('zero-source confirm_new creates an audited tombstone without a registry owner', t => {
  const db = memoryFixture();
  t.after(() => db.close());

  const { item, resolved, retry } = resolveZeroSourceConflict(db);

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.targetExternalCustomerId, 'EXT-B1');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_registry
    WHERE normalized_name='shared beta'`).get().count, 0);
  const tombstone = db.prepare(`SELECT normalized_name,origin_conflict_id,
    origin_source_version,origin_audit_id,anchor_external_customer_id,
    resolution_audit_id,version,
    created_by,released_by,released_at
    FROM crm_customer_identity_name_tombstones WHERE normalized_name='shared beta'`).get();
  assert.equal(tombstone.origin_conflict_id, item.conflictId);
  assert.equal(tombstone.anchor_external_customer_id, 'EXT-B1');
  assert.equal(tombstone.created_by, ADMIN.id);
  assert.equal(tombstone.released_by, '');
  assert.equal(tombstone.released_at, '');
  assert.match(tombstone.resolution_audit_id, /^[0-9a-f-]{36}$/);
  assert.match(tombstone.origin_audit_id, /^[0-9a-f-]{36}$/);
  const originAudit = db.prepare(`SELECT decision,source_version,evidence_json
    FROM crm_customer_identity_conflict_audit WHERE id=?`).get(tombstone.origin_audit_id);
  assert.equal(originAudit.decision, 'supplement_and_retry');
  assert.equal(originAudit.source_version, tombstone.origin_source_version);
  assert.ok(JSON.parse(originAudit.evidence_json).externalCustomerIds.includes('EXT-B1'));
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
      WHERE id=? AND conflict_id=? AND decision='confirm_new'`).get(
      tombstone.resolution_audit_id,
      item.conflictId,
    ).count,
    1,
  );
  assert.equal(auditProtectedCustomerIdentities(db).unresolved, 1);
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 1);

  const repeated = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '旧泛称已从两个真实客户资料中清除',
    expectedVersion: retry.expectedVersion,
  });
  assert.deepEqual(repeated, { ...resolved, idempotent: true });
  assert.equal(db.prepare(`SELECT COUNT(*) count
    FROM crm_customer_identity_name_tombstones`).get().count, 1);

  assert.throws(() => reserveCustomerIdentity(db, {
    externalCustomerId: 'EXT-B3',
    name: 'Shared Beta',
    source: 'customer_pool.company_name',
    actorId: 'USR-IMPORT',
  }), error => assertPrivateError(
    error,
    'CUSTOMER_IDENTITY_NAME_TOMBSTONED',
    409,
  ));
});

test('zero-source confirmation rejects an existing registry owner and rolls back', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '先补充真实法定名称',
    expectedVersion: item.expectedVersion,
  });
  db.prepare(`UPDATE customer_pool SET nickname='Distinct B1'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Distinct B2'
    WHERE external_customer_id='EXT-B2'`).run();
  db.prepare(`INSERT INTO crm_customer_identity_registry
    (normalized_name,external_customer_id,source,first_seen_at,updated_at)
    VALUES ('shared beta','EXT-B2','test','2026-08-01','2026-08-01')`).run();

  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '不能覆盖已有 owner',
    expectedVersion: retry.expectedVersion,
  }), error => assertPrivateError(
    error,
    'PROTECTED_IDENTITY_CONFLICT_OWNER_EXISTS',
    409,
  ));
  assert.equal(db.prepare(`SELECT COUNT(*) count
    FROM crm_customer_identity_name_tombstones`).get().count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
    WHERE conflict_id=?`).get(item.conflictId).count, 1);
});

test('tombstone origin version and candidate audit are integrity-gated', t => {
  for (const mutation of [
    db => db.prepare(`UPDATE crm_customer_identity_name_tombstones
      SET origin_source_version='sha256:tampered'`).run(),
    db => db.prepare(`UPDATE crm_customer_identity_conflict_audit SET evidence_json='{}'
      WHERE id=(SELECT origin_audit_id FROM crm_customer_identity_name_tombstones)`).run(),
  ]) {
    const db = memoryFixture();
    t.after(() => db.close());
    const { item } = resolveZeroSourceConflict(db);
    mutation(db);
    const raw = auditProtectedCustomerIdentities(db);
    assert.equal(raw.unresolved, 2);
    assert.equal(raw.invalidResolutions[0].conflictId, item.conflictId);
    assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 2);
  }
});

test('one source reappearing under a tombstoned name reopens the gate until admin confirms it', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const { item, resolved } = resolveZeroSourceConflict(db);

  db.prepare(`UPDATE crm_accounts SET nickname='Shared Beta'
    WHERE external_customer_id='EXT-B2'`).run();
  const audit = auditProtectedCustomerIdentities(db);
  assert.equal(audit.unresolved, 2);
  assert.deepEqual(audit.reopenedTombstones, [{
    conflictId: item.conflictId,
    normalizedName: 'shared beta',
    externalCustomerIds: ['EXT-B2'],
  }]);
  const reopened = conflict(db, 'shared beta');
  assert.equal(reopened.status, 'pending');
  assert.deepEqual(reopened.externalCustomerIds, ['EXT-B2']);
  assert.notEqual(reopened.expectedVersion, resolved.expectedVersion);

  const activated = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B2',
    details: '同名资料重新出现，已人工确认唯一稳定客户',
    expectedVersion: reopened.expectedVersion,
  });
  assert.equal(activated.status, 'resolved');
  assert.equal(
    db.prepare(`SELECT external_customer_id FROM crm_customer_identity_registry
      WHERE normalized_name='shared beta'`).get().external_customer_id,
    'EXT-B2',
  );
  const tombstone = db.prepare(`SELECT released_by,released_at,version
    FROM crm_customer_identity_name_tombstones WHERE normalized_name='shared beta'`).get();
  assert.equal(tombstone.released_by, ADMIN.id);
  assert.ok(tombstone.released_at);
  assert.equal(tombstone.version, 2);
  assert.equal(auditProtectedCustomerIdentities(db).unresolved, 1);
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 1);
});

test('multiple sources reappearing under a tombstoned name remain unresolved', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const { item } = resolveZeroSourceConflict(db);
  db.prepare(`UPDATE customer_pool SET nickname='Shared Beta'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Shared Beta'
    WHERE external_customer_id='EXT-B2'`).run();

  const reopened = conflict(db, 'shared beta');
  assert.equal(reopened.status, 'pending');
  assert.deepEqual(reopened.externalCustomerIds, ['EXT-B1', 'EXT-B2']);
  assert.equal(auditProtectedCustomerIdentities(db).unresolved, 2);
  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '仍有两个同名来源，不能激活',
    expectedVersion: reopened.expectedVersion,
  }), error => assertPrivateError(
    error,
    'PROTECTED_IDENTITY_CONFLICT_STILL_PRESENT',
    409,
  ));
  assert.equal(db.prepare(`SELECT released_at FROM crm_customer_identity_name_tombstones
    WHERE normalized_name='shared beta'`).get().released_at, '');
});

test('link_existing after a multi-source tombstone reopen releases it and aligns gates', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const { item } = resolveZeroSourceConflict(db);
  db.prepare(`UPDATE customer_pool SET nickname='Shared Beta'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Shared Beta'
    WHERE external_customer_id='EXT-B2'`).run();
  const reopened = conflict(db, 'shared beta');

  resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-B1',
    details: '同名再次出现，人工关联至现有稳定客户',
    expectedVersion: reopened.expectedVersion,
  });

  const tombstone = db.prepare(`SELECT released_by,released_at,version
    FROM crm_customer_identity_name_tombstones WHERE normalized_name='shared beta'`).get();
  assert.equal(tombstone.released_by, ADMIN.id);
  assert.ok(tombstone.released_at);
  assert.equal(tombstone.version, 2);
  assert.equal(auditProtectedCustomerIdentities(db).unresolved, 1);
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 1);
  assert.deepEqual(reserveCustomerIdentity(db, {
    externalCustomerId: 'EXT-B1',
    name: 'Shared Beta',
    source: 'customer_pool.company_name',
    actorId: 'USR-IMPORT',
  }), { normalizedName: 'shared beta', created: false });
});

test('a failed tombstone release rolls back owner, conflict, and resolution audit together', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const { item } = resolveZeroSourceConflict(db);
  db.prepare(`UPDATE customer_pool SET nickname='Shared Beta'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Shared Beta'
    WHERE external_customer_id='EXT-B2'`).run();
  const reopened = conflict(db, 'shared beta');
  const auditCount = db.prepare(`SELECT COUNT(*) count
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?`).get(item.conflictId).count;
  db.exec(`CREATE TRIGGER block_tombstone_release
    BEFORE UPDATE OF released_at ON crm_customer_identity_name_tombstones
    WHEN NEW.released_at <> ''
    BEGIN SELECT RAISE(ABORT, 'blocked tombstone release'); END`);

  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-B1',
    details: '本次事务必须完整回滚',
    expectedVersion: reopened.expectedVersion,
  }), /blocked tombstone release/);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_registry
    WHERE normalized_name='shared beta'`).get().count, 0);
  assert.equal(db.prepare(`SELECT released_at FROM crm_customer_identity_name_tombstones
    WHERE normalized_name='shared beta'`).get().released_at, '');
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
    WHERE conflict_id=?`).get(item.conflictId).count, auditCount);
  assert.equal(auditProtectedCustomerIdentities(db).unresolved, 2);
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 2);
});

test('supplement_and_retry stays unresolved, records exact details, and supports a later decision', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: { reason: '缺少税号', requestedFields: ['inn', 'officialName'] },
    expectedVersion: item.expectedVersion,
  });
  assert.equal(retry.status, 'retry');
  assert.equal(retry.targetExternalCustomerId, '');
  const repeated = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: { reason: '缺少税号', requestedFields: ['inn', 'officialName'] },
    expectedVersion: item.expectedVersion,
  });
  assert.deepEqual(repeated, { ...retry, idempotent: true });
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 2);
  assert.equal(listAll(db, { status: 'retry' }).total, 1);

  db.prepare(`UPDATE crm_accounts SET nickname=? WHERE external_customer_id=?`)
    .run('Distinct Beta Company', 'EXT-B2');
  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '资料已补全并人工复核',
    expectedVersion: retry.expectedVersion,
  });
  assert.equal(resolved.status, 'resolved');
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 1);
  assert.equal(
    db.prepare(`SELECT COUNT(*) count FROM crm_customer_identity_conflict_audit
      WHERE conflict_id=?`).get(item.conflictId).count,
    2,
  );
});

test('a refreshed conflict accepts current candidates and audits the matching latest evidence', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '等待客户正式名称',
    expectedVersion: item.expectedVersion,
  });

  db.prepare(`UPDATE customer_pool SET nickname='Distinct B1'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Distinct B2'
    WHERE external_customer_id='EXT-B2'`).run();
  addConflict(db, 'Shared Beta', 'EXT-B3', 'EXT-B4', 4);
  const refreshed = conflict(db, 'shared beta');
  assert.deepEqual(refreshed.externalCustomerIds, ['EXT-B3', 'EXT-B4']);
  assert.notEqual(refreshed.expectedVersion, retry.expectedVersion);

  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: refreshed.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-B3',
    details: '管理员按本轮最新来源确认',
    expectedVersion: refreshed.expectedVersion,
  });
  assert.equal(resolved.targetExternalCustomerId, 'EXT-B3');
  const latestAudit = db.prepare(`SELECT source_version,evidence_json
    FROM crm_customer_identity_conflict_audit WHERE conflict_id=?
    ORDER BY rowid DESC LIMIT 1`).get(item.conflictId);
  assert.equal(latestAudit.source_version, refreshed.sourceExpectedVersion);
  assert.deepEqual(
    JSON.parse(latestAudit.evidence_json).externalCustomerIds,
    ['EXT-B3', 'EXT-B4'],
  );
});

test('resolved confirmation reopens when its sole current source drifts to another customer', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared beta');
  const retry = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'supplement_and_retry',
    details: '先移除重复昵称',
    expectedVersion: item.expectedVersion,
  });
  db.prepare(`UPDATE crm_accounts SET nickname='Distinct B2'
    WHERE external_customer_id='EXT-B2'`).run();
  resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'confirm_new',
    targetExternalCustomerId: 'EXT-B1',
    details: '当前唯一来源属于 B1',
    expectedVersion: retry.expectedVersion,
  });
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 1);

  db.prepare(`UPDATE customer_pool SET nickname='Distinct B1'
    WHERE customer_id='EXT-B1'`).run();
  db.prepare(`UPDATE crm_accounts SET nickname='Shared Beta'
    WHERE external_customer_id='EXT-B2'`).run();
  const auditAfterDrift = auditProtectedCustomerIdentities(db, { apply: false });
  assert.equal(auditAfterDrift.unresolved, 2);
  assert.deepEqual(auditAfterDrift.invalidResolutions, [{
    conflictId: item.conflictId,
    reason: 'current_source_owner_mismatch',
  }]);
  const afterDrift = listAll(db, { status: 'unresolved' });
  assert.equal(afterDrift.unresolved, 2);
  assert.equal(
    afterDrift.items.find(row => row.conflictId === item.conflictId).status,
    'pending',
  );
});

test('failed resolution rolls back conflict schema installation', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT ''
    );
  `);
  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: 'identity-conflict:missing',
    decision: 'supplement_and_retry',
    details: '不存在的冲突',
    expectedVersion: 'sha256:missing',
  }), error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_NOT_FOUND', 404));
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM sqlite_master
    WHERE name LIKE 'crm_customer_identity_conflict%'`).get().count, 0);
});

test('two database connections cannot create two registry owners from one expected version', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue172r-'));
  const filename = path.join(directory, 'conflicts.db');
  const first = new Database(filename);
  installSources(first);
  addConflict(first, 'Concurrent Name', 'EXT-C1', 'EXT-C2', 1);
  const second = new Database(filename);
  t.after(() => {
    second.close();
    first.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const item = conflict(first, 'concurrent name');

  resolveProtectedIdentityConflict(first, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-C1',
    details: 'connection one reviewed evidence',
    expectedVersion: item.expectedVersion,
  });
  assert.throws(() => resolveProtectedIdentityConflict(second, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-C2',
    details: 'connection two reviewed evidence',
    expectedVersion: item.expectedVersion,
  }), error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE', 409));

  assert.deepEqual(
    second.prepare(`SELECT external_customer_id FROM crm_customer_identity_registry
      WHERE normalized_name=?`).all('concurrent name'),
    [{ external_customer_id: 'EXT-C1' }],
  );
});

test('a resolved mapping is reopened when the same conflict ID returns with new raw evidence', t => {
  const db = memoryFixture();
  t.after(() => db.close());
  const item = conflict(db, 'shared alpha');
  const resolved = resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-A1',
    details: '第一轮人工核验',
    expectedVersion: item.expectedVersion,
  });
  assert.equal(resolved.status, 'resolved');

  db.prepare(`INSERT INTO crm_accounts(id,external_customer_id,company_name,nickname)
    VALUES (?,?,?,?)`).run('ACCOUNT-NEW', 'EXT-A3', 'Third Official', 'Shared Alpha');
  const reopened = conflict(db, 'shared alpha');
  assert.equal(reopened.status, 'pending');
  assert.deepEqual(reopened.externalCustomerIds, ['EXT-A1', 'EXT-A2', 'EXT-A3']);
  assert.notEqual(reopened.expectedVersion, resolved.expectedVersion);
  assert.equal(listAll(db, { status: 'unresolved' }).unresolved, 2);
  assert.throws(() => resolveProtectedIdentityConflict(db, ADMIN, {
    conflictId: item.conflictId,
    decision: 'link_existing',
    targetExternalCustomerId: 'EXT-A1',
    details: '第一轮人工核验',
    expectedVersion: item.expectedVersion,
  }), error => assertPrivateError(error, 'PROTECTED_IDENTITY_CONFLICT_VERSION_STALE', 409));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');
const { installSalesCrm } = require('../lib/sales_crm');

function insertAssignedIntake(db, {
  id,
  externalCustomerId,
  ownerId = 'U-MGR',
  companyName = 'Issue 96 Fixture',
} = {}) {
  db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,suggested_owner_id,assigned_owner_id,
     assigned_at,claim_due_at,created_at,updated_at)
    VALUES (?,'BATCH-TEST',?,?,'assigned',?,?,
      '2026-07-20 00:00:00','2026-07-21 00:00:00','2026-07-20 00:00:00','2026-07-20 00:00:00')`)
    .run(id, externalCustomerId, companyName, ownerId, ownerId);
}

function insertAccount(db, {
  id,
  externalCustomerId,
  ownerId = 'U-MGR',
  intakeItemId = '',
  assignmentStatus = 'claimed',
  lifecycleStatus = 'active',
  claimedAt = '',
  companyName = 'Issue 96 Fixture',
} = {}) {
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,owner_id,stage,assignment_status,lifecycle_status,intake_item_id,
     claimed_at,created_at,updated_at)
    VALUES (?,?,?,?,'qualified',?,?,?,?, '2026-07-22 00:00:00','2026-07-22 00:00:00')`)
    .run(id, externalCustomerId, companyName, ownerId || null,
      assignmentStatus, lifecycleStatus, intakeItemId, claimedAt);
}

test('install replaces legacy triggers and only active claimed CRM resolves open intake', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.exec(`
    DROP TRIGGER IF EXISTS crm_accounts_sync_intake_insert;
    DROP TRIGGER IF EXISTS crm_accounts_sync_intake_external_update;
    CREATE TRIGGER crm_accounts_sync_intake_insert AFTER INSERT ON crm_accounts BEGIN
      UPDATE crm_intake_items SET status='duplicate'
      WHERE external_customer_id=NEW.external_customer_id AND status IN ('pending','approved');
    END;
    CREATE TRIGGER crm_accounts_sync_intake_external_update AFTER UPDATE OF external_customer_id ON crm_accounts BEGIN
      UPDATE crm_intake_items SET status='duplicate'
      WHERE external_customer_id=NEW.external_customer_id AND status IN ('pending','approved');
    END;
  `);
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,created_at,updated_at)
    VALUES ('CRM-96-HISTORICAL','RU-9600','Historical CRM',
      '2026-07-19 00:00:00','2026-07-19 00:00:00')`).run();
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,created_at,updated_at)
    VALUES ('INTAKE-96-HISTORICAL','BATCH-TEST','RU-9600','Historical Intake','pending',
      '2026-07-20 00:00:00','2026-07-20 00:00:00')`).run();

  installSalesCrm();

  for (const triggerName of [
    'crm_accounts_sync_intake_insert',
    'crm_accounts_sync_intake_external_update',
  ]) {
    const triggerSql = fx.db.prepare(`SELECT sql FROM sqlite_master
      WHERE type='trigger' AND name=?`).get(triggerName).sql;
    assert.match(triggerSql, /'assigned'/);
    assert.match(triggerSql, /NEW\.intake_item_id/);
    assert.match(triggerSql, /NEW\.assignment_status/);
    assert.match(triggerSql, /NEW\.lifecycle_status/);
  }
  assert.equal(
    fx.db.prepare("SELECT status FROM crm_intake_items WHERE id='INTAKE-96-HISTORICAL'").get().status,
    'pending',
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-DUP', externalCustomerId: 'RU-9601' });
  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',duplicate_review_id='REVIEW-96',
    assigned_at='2026-07-20 00:00:00',claimed_at='2026-07-20 12:00:00',return_reason='old reason'
    WHERE id='INTAKE-96-DUP'`).run();
  insertAccount(fx.db, { id: 'CRM-96-DUP', externalCustomerId: 'RU-9601' });
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,suggested_owner_id,assigned_owner_id,assigned_at,
      claim_due_at,claimed_at,return_reason,duplicate_state,duplicate_review_id
      FROM crm_intake_items WHERE id='INTAKE-96-DUP'`).get(),
    {
      status: 'duplicate',
      crm_customer_id: 'CRM-96-DUP',
      suggested_owner_id: '',
      assigned_owner_id: '',
      assigned_at: '',
      claim_due_at: '',
      claimed_at: '',
      return_reason: '',
      duplicate_state: 'exact',
      duplicate_review_id: '',
    },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-CLAIM', externalCustomerId: 'RU-9602' });
  insertAccount(fx.db, {
    id: 'CRM-96-CLAIM',
    externalCustomerId: 'RU-9602',
    intakeItemId: 'INTAKE-96-CLAIM',
    ownerId: 'U-OTHER',
    claimedAt: '2026-07-22 09:30:00',
  });
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id,claimed_at
      FROM crm_intake_items WHERE id='INTAKE-96-CLAIM'`).get(),
    {
      status: 'claimed', crm_customer_id: 'CRM-96-CLAIM',
      assigned_owner_id: 'U-OTHER', claimed_at: '2026-07-22 09:30:00',
    },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-EMPTY-CLAIM', externalCustomerId: 'RU-9608' });
  insertAccount(fx.db, {
    id: 'CRM-96-EMPTY-CLAIM', externalCustomerId: 'RU-9608',
    intakeItemId: 'INTAKE-96-EMPTY-CLAIM', ownerId: '', claimedAt: '',
  });
  const emptyInsertMetadata = fx.db.prepare(`SELECT
      i.status,i.assigned_owner_id intake_owner_id,i.claimed_at intake_claimed_at,
      a.owner_id account_owner_id,a.claimed_at account_claimed_at
    FROM crm_intake_items i JOIN crm_accounts a ON a.id=i.crm_customer_id
    WHERE i.id='INTAKE-96-EMPTY-CLAIM'`).get();
  assert.equal(emptyInsertMetadata.status, 'claimed');
  assert.equal(emptyInsertMetadata.account_owner_id, emptyInsertMetadata.intake_owner_id);
  assert.equal(emptyInsertMetadata.account_claimed_at, emptyInsertMetadata.intake_claimed_at);
  assert.equal(emptyInsertMetadata.account_owner_id, 'U-MGR');
  assert.notEqual(emptyInsertMetadata.account_claimed_at, '');

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-ASSIGNED', externalCustomerId: 'RU-9605' });
  fx.db.prepare("UPDATE crm_intake_items SET crm_customer_id='CRM-96-ASSIGNED' WHERE id='INTAKE-96-ASSIGNED'").run();
  insertAccount(fx.db, {
    id: 'CRM-96-ASSIGNED', externalCustomerId: 'RU-9605',
    intakeItemId: 'INTAKE-96-ASSIGNED', assignmentStatus: 'assigned',
  });
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-96-ASSIGNED'`).get(),
    { status: 'assigned', crm_customer_id: 'CRM-96-ASSIGNED', assigned_owner_id: 'U-MGR' },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-RETURNED', externalCustomerId: 'RU-9606' });
  fx.db.prepare(`UPDATE crm_intake_items SET status='returned',crm_customer_id='CRM-96-RETURNED',
    suggested_owner_id='',assigned_owner_id='',assigned_at='',claim_due_at='',return_reason='normal return'
    WHERE id='INTAKE-96-RETURNED'`).run();
  insertAccount(fx.db, {
    id: 'CRM-96-RETURNED', externalCustomerId: 'RU-9606',
    intakeItemId: 'INTAKE-96-RETURNED', assignmentStatus: 'returned',
  });
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,return_reason
      FROM crm_intake_items WHERE id='INTAKE-96-RETURNED'`).get(),
    { status: 'returned', crm_customer_id: 'CRM-96-RETURNED', return_reason: 'normal return' },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-INACTIVE', externalCustomerId: 'RU-9607' });
  insertAccount(fx.db, {
    id: 'CRM-96-INACTIVE', externalCustomerId: 'RU-9607',
    intakeItemId: 'INTAKE-96-INACTIVE', lifecycleStatus: 'recycled',
  });
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-96-INACTIVE'`).get(),
    { status: 'assigned', crm_customer_id: '', assigned_owner_id: 'U-MGR' },
  );
});

test('external customer ID updates unlink OLD identity and resolve only claimed NEW identity', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-OLD', externalCustomerId: 'RU-9610' });
  insertAccount(fx.db, {
    id: 'CRM-96-MOVE', externalCustomerId: 'RU-9610', intakeItemId: 'INTAKE-96-OLD',
  });
  insertAssignedIntake(fx.db, { id: 'INTAKE-96-NEW', externalCustomerId: 'RU-9611' });
  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='RU-9611' WHERE id='CRM-96-MOVE'").run();

  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id,claim_due_at
      FROM crm_intake_items WHERE id='INTAKE-96-OLD'`).get(),
    { status: 'returned', crm_customer_id: '', assigned_owner_id: '', claim_due_at: '' },
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-96-NEW'`).get(),
    { status: 'duplicate', crm_customer_id: 'CRM-96-MOVE', assigned_owner_id: '' },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-A-OLD', externalCustomerId: 'RU-9612' });
  fx.db.prepare("UPDATE crm_intake_items SET crm_customer_id='CRM-96-A-MOVE' WHERE id='INTAKE-96-A-OLD'").run();
  insertAccount(fx.db, {
    id: 'CRM-96-A-MOVE', externalCustomerId: 'RU-9612', intakeItemId: 'INTAKE-96-A-OLD',
    assignmentStatus: 'assigned',
  });
  insertAssignedIntake(fx.db, { id: 'INTAKE-96-A-NEW', externalCustomerId: 'RU-9613' });
  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='RU-9613' WHERE id='CRM-96-A-MOVE'").run();
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-96-A-OLD'`).get(),
    { status: 'assigned', crm_customer_id: '', assigned_owner_id: 'U-MGR' },
  );
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id
      FROM crm_intake_items WHERE id='INTAKE-96-A-NEW'`).get(),
    { status: 'assigned', crm_customer_id: '', assigned_owner_id: 'U-MGR' },
  );

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-EMPTY-UPDATE', externalCustomerId: 'RU-9618' });
  insertAccount(fx.db, {
    id: 'CRM-96-EMPTY-UPDATE', externalCustomerId: 'RU-9619',
    intakeItemId: 'INTAKE-96-EMPTY-UPDATE', ownerId: '', claimedAt: '',
  });
  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='RU-9618' WHERE id='CRM-96-EMPTY-UPDATE'").run();
  const emptyUpdateMetadata = fx.db.prepare(`SELECT
      i.status,i.assigned_owner_id intake_owner_id,i.claimed_at intake_claimed_at,
      a.owner_id account_owner_id,a.claimed_at account_claimed_at
    FROM crm_intake_items i JOIN crm_accounts a ON a.id=i.crm_customer_id
    WHERE i.id='INTAKE-96-EMPTY-UPDATE'`).get();
  assert.equal(emptyUpdateMetadata.status, 'claimed');
  assert.equal(emptyUpdateMetadata.account_owner_id, emptyUpdateMetadata.intake_owner_id);
  assert.equal(emptyUpdateMetadata.account_claimed_at, emptyUpdateMetadata.intake_claimed_at);
  assert.equal(emptyUpdateMetadata.account_owner_id, 'U-MGR');
  assert.notEqual(emptyUpdateMetadata.account_claimed_at, '');

  insertAssignedIntake(fx.db, { id: 'INTAKE-96-DUP-OLD', externalCustomerId: 'RU-9614' });
  insertAccount(fx.db, {
    id: 'CRM-96-DUP-MOVE', externalCustomerId: 'RU-9614',
  });
  fx.db.prepare(`UPDATE crm_intake_items
    SET suggested_owner_id='U-MGR',assigned_owner_id='U-MGR',
        assigned_at='2026-07-20 00:00:00',claim_due_at='2026-07-21 00:00:00',
        claimed_at='2026-07-22 00:00:00',duplicate_review_id='REVIEW-ORPHAN'
    WHERE id='INTAKE-96-DUP-OLD'`).run();
  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='RU-9615' WHERE id='CRM-96-DUP-MOVE'").run();
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,suggested_owner_id,assigned_owner_id,
      assigned_at,claim_due_at,claimed_at,return_reason,duplicate_state,duplicate_review_id
      FROM crm_intake_items WHERE id='INTAKE-96-DUP-OLD'`).get(),
    {
      status: 'returned',
      crm_customer_id: '',
      suggested_owner_id: '',
      assigned_owner_id: '',
      assigned_at: '',
      claim_due_at: '',
      claimed_at: '',
      return_reason: 'CRM客户身份已变更，原线索已退回',
      duplicate_state: '',
      duplicate_review_id: '',
    },
  );

  fx.db.exec(`
    DROP INDEX IF EXISTS crm_accounts_external_unique_idx;
    CREATE INDEX IF NOT EXISTS crm_accounts_external_idx
      ON crm_accounts(external_customer_id);
  `);
  insertAssignedIntake(fx.db, { id: 'INTAKE-96-DUP-RELINK', externalCustomerId: 'RU-9616' });
  insertAccount(fx.db, {
    id: 'CRM-96-DUP-KEEP', externalCustomerId: 'RU-9616',
  });
  insertAccount(fx.db, {
    id: 'CRM-96-DUP-LEAVE', externalCustomerId: 'RU-9616',
  });
  fx.db.prepare("UPDATE crm_accounts SET external_customer_id='RU-9617' WHERE id='CRM-96-DUP-LEAVE'").run();
  assert.deepEqual(
    fx.db.prepare(`SELECT status,crm_customer_id,assigned_owner_id,duplicate_state
      FROM crm_intake_items WHERE id='INTAKE-96-DUP-RELINK'`).get(),
    {
      status: 'duplicate',
      crm_customer_id: 'CRM-96-DUP-KEEP',
      assigned_owner_id: '',
      duplicate_state: 'exact',
    },
  );
});

test('bootstrap and authorized alert list group dirty intake and CRM state by stable identity', async t => {
  const fx = await adminFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', { view_alerts: true, record_activity: true });
  fx.db.prepare(`UPDATE crm_accounts SET next_action='',next_action_at='',manager_required=0
    WHERE id='CRM-OWN'`).run();

  // This simulates historical corruption by bypassing the normal assignment and CRM-create flows.
  insertAssignedIntake(fx.db, {
    id: 'INTAKE-96-DIRTY',
    externalCustomerId: 'RU-9002',
    companyName: 'Owned Fixture',
  });

  const bootstrap = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  const matching = bootstrap.alerts.filter(item => item.externalCustomerId === 'RU-9002');
  assert.equal(matching.length, 1);
  assert.equal(matching[0].reasonCount >= 2, true);
  assert.equal(matching[0].reasons.some(reason => reason.code === 'UNCLAIMED_LEAD'), true);
  assert.equal(matching[0].reasons.some(reason => reason.code === 'NO_NEXT'), true);
  assert.equal(bootstrap.alerts.some(item => item.externalCustomerId === 'RU-9003'), false);

  const listResponse = await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=20&filters=%7B%7D', {
    cookie: fx.cookie,
  });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200, list.error);
  assert.equal(list.rows.filter(item => item.externalCustomerId === 'RU-9002').length, 1);
  assert.equal(list.summary.objects, bootstrap.alerts.length);
  assert.equal(list.summary.reasons, bootstrap.alerts.reduce((sum, item) => sum + item.reasonCount, 0));
});

test('assigned intake and CRM expose one overdue-claim business reason', async t => {
  const fx = await adminFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.setUserPermissions('U-MGR', { view_alerts: true, record_activity: true });

  insertAssignedIntake(fx.db, {
    id: 'INTAKE-96-ASSIGNED-PAIR',
    externalCustomerId: 'RU-9002',
    companyName: 'Owned Fixture',
  });
  fx.db.prepare(`UPDATE crm_intake_items SET crm_customer_id='CRM-OWN'
    WHERE id='INTAKE-96-ASSIGNED-PAIR'`).run();
  fx.db.prepare(`UPDATE crm_accounts
    SET assignment_status='assigned',intake_item_id='INTAKE-96-ASSIGNED-PAIR',
        owner_id='U-MGR',assigned_at='2026-07-20 00:00:00',
        claim_due_at='2026-07-21 00:00:00',claimed_at=''
    WHERE id='CRM-OWN'`).run();

  const bootstrap = await (await fx.request('/api/sales-crm/bootstrap', { cookie: fx.cookie })).json();
  const matching = bootstrap.alerts.find(item => item.externalCustomerId === 'RU-9002');
  assert.ok(matching);
  assert.equal(
    matching.reasons.filter(reason => ['UNCLAIMED', 'UNCLAIMED_LEAD'].includes(reason.code)).length,
    1,
  );
  assert.equal(matching.reasonCount, 2);
  assert.deepEqual(matching.reasons.map(reason => reason.code), ['UNCLAIMED_LEAD', 'NO_NEXT']);

  const listResponse = await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=20&filters=%7B%7D', {
    cookie: fx.cookie,
  });
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200, list.error);
  const listed = list.rows.find(item => item.externalCustomerId === 'RU-9002');
  assert.ok(listed);
  assert.equal(
    listed.reasons.filter(reason => ['UNCLAIMED', 'UNCLAIMED_LEAD'].includes(reason.code)).length,
    1,
  );
  assert.equal(listed.reasonCount, 2);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const AT = '2026-08-04 08:00:00';

function addIntake(fx, id, externalCustomerId, companyName) {
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,created_at,updated_at)
    VALUES (?,'BATCH-TEST',?,?,'pending','',?,?)`)
    .run(id, externalCustomerId, companyName, AT, AT);
}

function addReview(fx, {
  id, intakeId, companyName, website, evaluatedRuleVersion = 'legacy-v1',
}) {
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,
     created_rule_version,evaluated_rule_version,current_candidates_json,created_at,updated_at)
    VALUES (?, 'intake_item', ?, 'legacy-fingerprint', 'U-OTHER', ?, ?, 'pending',
      ?, ?, ?, ?, ?)`)
    .run(
      id,
      intakeId,
      JSON.stringify({
        companyName, website, country: 'Brazil', industry: 'Industrial electronics',
      }),
      JSON.stringify([{
        customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'DBTEC',
        matchedBy: 'fuzzy_domain', score: 0.75,
      }]),
      evaluatedRuleVersion,
      evaluatedRuleVersion,
      JSON.stringify([{
        customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'DBTEC',
        matchedBy: 'fuzzy_domain', score: 0.75,
      }]),
      AT,
      AT,
    );
  fx.db.prepare(`UPDATE crm_intake_items SET company_name=?,website=?,country='Brazil',
      industry='Industrial electronics',status='pending',assigned_owner_id='',duplicate_state='review',
      duplicate_review_id=?,decision_reason='资料已提交管理层核验',updated_at=? WHERE id=?`)
    .run(companyName, website, id, AT, intakeId);
}

test('startup upgrades only stale duplicate reviews and preserves real duplicate blocking', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customer_pool SET company_name='DBTEC',website='https://dbtec.com.br',
    country='Brazil',industry='Industrial electronics' WHERE customer_id='RU-9002'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET company_name='DBTEC',website='https://dbtec.com.br',
    country='Brazil',industry='Industrial electronics' WHERE id='CRM-OWN'`).run();

  addReview(fx, {
    id: 'DUPREV-262-FALSE', intakeId: 'INTAKE-OTHER',
    companyName: 'Pyrotec', website: 'https://pyrotec.com.br',
  });
  addIntake(fx, 'INTAKE-262-EXACT', 'BR-9262', 'DBTEC Brazil');
  addReview(fx, {
    id: 'DUPREV-262-EXACT', intakeId: 'INTAKE-262-EXACT',
    companyName: 'DBTEC Brazil', website: 'https://www.dbtec.com.br/contact',
  });
  addIntake(fx, 'INTAKE-262-CURRENT', 'BR-9263', 'Current Review');
  addReview(fx, {
    id: 'DUPREV-262-CURRENT', intakeId: 'INTAKE-262-CURRENT',
    companyName: 'Current Review', website: 'https://current-review.example',
    evaluatedRuleVersion: 'duplicate-v2',
  });

  const { installSalesCrm } = require('../lib/sales_crm');
  installSalesCrm();

  assert.deepEqual(fx.db.prepare(`SELECT status,evaluated_rule_version,resolution_source
    FROM crm_duplicate_reviews WHERE id='DUPREV-262-FALSE'`).get(), {
    status: 'confirmed_distinct',
    evaluated_rule_version: 'duplicate-v2',
    resolution_source: 'rule_upgrade',
  });
  assert.deepEqual(fx.db.prepare(`SELECT status,duplicate_state,decision_reason
    FROM crm_intake_items WHERE id='INTAKE-OTHER'`).get(), {
    status: 'approved',
    duplicate_state: 'cleared',
    decision_reason: '查重核验已放行',
  });

  assert.deepEqual(fx.db.prepare(`SELECT status,evaluated_rule_version,resolution_source
    FROM crm_duplicate_reviews WHERE id='DUPREV-262-EXACT'`).get(), {
    status: 'pending',
    evaluated_rule_version: 'duplicate-v2',
    resolution_source: '',
  });
  assert.deepEqual(fx.db.prepare(`SELECT status,duplicate_state,decision_reason
    FROM crm_intake_items WHERE id='INTAKE-262-EXACT'`).get(), {
    status: 'pending',
    duplicate_state: 'review',
    decision_reason: '资料已提交管理层核验',
  });

  assert.deepEqual(fx.db.prepare(`SELECT status,evaluated_rule_version,recalculated_at
    FROM crm_duplicate_reviews WHERE id='DUPREV-262-CURRENT'`).get(), {
    status: 'pending',
    evaluated_rule_version: 'duplicate-v2',
    recalculated_at: '',
  });
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action='duplicate_review_rule_upgrade_completed'`).get().count, 1);

  const listed = await fx.request('/api/sales-crm/intake?pageSize=100', { cookie: fx.adminCookie });
  const listedBody = await listed.json();
  assert.equal(listed.status, 200, listedBody.error);
  const byId = new Map(listedBody.items.map(item => [item.id, item]));
  assert.deepEqual({
    assignable: byId.get('INTAKE-OTHER').assignable,
    assignmentBlockReason: byId.get('INTAKE-OTHER').assignmentBlockReason,
  }, { assignable: true, assignmentBlockReason: '' });
  assert.deepEqual({
    assignable: byId.get('INTAKE-262-EXACT').assignable,
    assignmentBlockReason: byId.get('INTAKE-262-EXACT').assignmentBlockReason,
  }, { assignable: false, assignmentBlockReason: '待管理层查重核验' });

  const preview = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { action: 'manual_assign_preview', itemIds: ['INTAKE-OTHER'] },
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json().then(body => ({
    eligibleCount: body.eligibleCount, blockedCount: body.blockedCount,
  })), { eligibleCount: 1, blockedCount: 0 });

  const assigned = await fx.request('/api/sales-crm/intake/action', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      action: 'manual_assign', itemIds: ['INTAKE-OTHER'], ownerId: 'U-OTHER', amount: 1,
      idempotencyKey: 'issue262-released-lead-assignment',
    },
  });
  assert.equal(assigned.status, 200);
  assert.deepEqual(await assigned.json().then(body => ({
    assigned: body.assigned, blocked: body.blocked,
  })), { assigned: 1, blocked: 0 });

  const auditCount = fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action LIKE 'duplicate_review_rule_upgrade%'`).get().count;
  installSalesCrm();
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE action LIKE 'duplicate_review_rule_upgrade%'`).get().count, auditCount);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');
const { auditProtectedCustomerIdentities } = require('../lib/customer_identity_registry');
const {
  applyIdentitySupplement,
  skipIdentitySupplement,
} = require('../lib/protected_customer_conflicts');

const PERMS = { manage_intake: true, view_all_customers: true, manage_protected_customers: true };
const CONFLICT_MANAGER = Object.freeze({
  id: 'USR-ADMIN',
  role: 'admin',
  permissions: { manage_protected_customers: true },
});
const NOW = '2026-08-01 08:00:00';

const previousWriteGate = process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
test.before(() => { process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = 'true'; });
test.after(() => {
  if (previousWriteGate === undefined) delete process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED;
  else process.env.CRM_PROTECTED_CUSTOMERS_WRITES_ENABLED = previousWriteGate;
});

// Seed a pool lead + CRM account sharing one normalized name (via nickname), plus
// the intake item that hydrates the lead, then return the live identity conflict.
function seedIdentityConflict(fx, {
  leadId, masterId, intakeId, name = 'Shared Alpha',
  leadCompany = 'Lead Co', masterCompany = 'Master Co',
  intake = {}, masterWebsite = '', masterIndustry = '',
}) {
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run(leadId, leadCompany, name);
  // The master's pool row keeps the shared nickname, which the CRM account
  // nickname write-through trigger mirrors onto the master account.
  fx.db.prepare('INSERT INTO customer_pool(customer_id,company_name,nickname) VALUES (?,?,?)')
    .run(masterId, masterCompany, name);
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,nickname,website,industry,stage,owner_id,next_action,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`ACCT-${masterId}`, masterId, masterCompany, name, masterWebsite, masterIndustry,
      'contacted', 'U-WU', 'follow-up', NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,contact_name,website,industry,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(intakeId, 'BATCH-TEST', leadId, leadCompany, 'pending',
      intake.contact_name || '', intake.website || '', intake.industry || '', NOW, NOW);
  const conflict = auditProtectedCustomerIdentities(fx.db).conflicts
    .find(item => item.leadExternalCustomerIds.includes(leadId));
  assert.ok(conflict, `conflict should exist for ${name}`);
  return conflict;
}

function intakeItem(body, intakeId) {
  return body.items.find(item => item.id === intakeId);
}

async function resolve(fx, conflictId, payload) {
  const response = await fx.request(`/api/sales-crm/protected-customer-conflicts/${conflictId}/resolve`, {
    cookie: fx.adminCookie, method: 'POST', body: payload,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('identity warning carries conflictId and conflict list exposes leadNames/crmNames', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9301', masterId: 'RU-9401', intakeId: 'INTAKE-1',
    leadCompany: 'Lead One Co', masterCompany: 'Master One Co',
  });

  const listed = await (await fx.request('/api/sales-crm/intake?status=pending', { cookie: fx.adminCookie })).json();
  const item = intakeItem(listed, 'INTAKE-1');
  assert.ok(item.identityWarning, 'unresolved lead has a warning');
  assert.equal(item.identityWarning.active, true);
  assert.equal(item.identityWarning.code, 'LEAD_IDENTITY_REVIEW_REQUIRED');
  assert.equal(item.identityWarning.conflictId, conflict.conflictId);

  const conflicts = await (await fx.request('/api/sales-crm/protected-customer-conflicts', { cookie: fx.adminCookie })).json();
  const row = conflicts.items.find(entry => entry.conflictId === conflict.conflictId);
  assert.ok(row, 'conflict list exposes the conflict');
  assert.ok(row.leadNames.some(entry => entry.externalCustomerId === 'RU-9301' && entry.rawName === 'Shared Alpha'));
  assert.ok(row.crmNames.some(entry => entry.externalCustomerId === 'RU-9401' && entry.rawName === 'Shared Alpha'));
  assert.equal(row.complementaryInfo, null);
});

test('hydration exposes link_existing resolution fields and complementaryInfo', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9302', masterId: 'RU-9402', intakeId: 'INTAKE-2',
    leadCompany: 'Lead Two Co', masterCompany: 'Master Two Co',
    intake: { contact_name: '张三', website: 'https://lead.example.com', industry: '电子' },
  });

  const resolution = await resolve(fx, conflict.conflictId, {
    decision: 'link_existing',
    targetExternalCustomerId: conflict.crmExternalCustomerIds[0],
    expectedVersion: conflict.expectedVersion,
    details: '同一客户',
  });
  assert.equal(resolution.resolution.status, 'resolved');
  assert.equal(resolution.resolution.decision, 'link_existing');

  const listed = await (await fx.request('/api/sales-crm/intake?status=pending', { cookie: fx.adminCookie })).json();
  const item = intakeItem(listed, 'INTAKE-2');
  assert.equal(item.identityWarning, null);
  assert.equal(item.assignable, false);
  assert.equal(item.claimBlocked, true);
  assert.equal(item.linkedMasterName, 'Master Two Co');
  assert.equal(item.linkedMasterExternalId, 'RU-9402');
  assert.deepEqual(item.complementaryInfo, { contact: true, website: true, industry: true });
});

test('link_existing writes a timeline note on the master without touching stage/owner/next_action', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9303', masterId: 'RU-9403', intakeId: 'INTAKE-3',
    leadCompany: 'Lead Three Co', masterCompany: 'Master Three Co',
  });

  await resolve(fx, conflict.conflictId, {
    decision: 'link_existing',
    targetExternalCustomerId: conflict.crmExternalCustomerIds[0],
    expectedVersion: conflict.expectedVersion,
    details: '已确认同一客户',
  });

  const master = fx.db.prepare("SELECT * FROM crm_accounts WHERE external_customer_id='RU-9403'").get();
  assert.equal(master.stage, 'contacted');
  assert.equal(master.owner_id, 'U-WU');
  assert.equal(master.next_action, 'follow-up');

  const activity = fx.db.prepare(
    "SELECT * FROM crm_activities WHERE customer_id=? AND activity_type='note'",
  ).get(master.id);
  assert.ok(activity, 'timeline note written');
  assert.equal(activity.summary, '确认与线索 RU-9303 为同一客户并已关联：已确认同一客户');
  assert.equal(activity.stage_before, 'contacted');
  assert.equal(activity.stage_after, 'contacted');
  assert.equal(activity.next_action, '');
});

test('retry resolution surfaces supplementRequirement from details', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9304', masterId: 'RU-9404', intakeId: 'INTAKE-4',
    leadCompany: 'Lead Four Co', masterCompany: 'Master Four Co',
  });

  await resolve(fx, conflict.conflictId, {
    decision: 'supplement_and_retry',
    details: '请补充联系人后再核验',
    expectedVersion: conflict.expectedVersion,
  });

  const listed = await (await fx.request('/api/sales-crm/intake?status=pending', { cookie: fx.adminCookie })).json();
  const item = intakeItem(listed, 'INTAKE-4');
  assert.equal(item.identityWarning, null);
  assert.equal(item.supplementRequirement, '请补充联系人后再核验');
  assert.equal(item.assignable, false);
  assert.equal(item.claimBlocked, true);
});

test('confirm_new restores lead assignability', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9305', masterId: 'RU-9405', intakeId: 'INTAKE-5',
    leadCompany: 'Lead Five Co', masterCompany: 'Master Five Co',
  });

  const before = await (await fx.request('/api/sales-crm/intake?status=pending', { cookie: fx.adminCookie })).json();
  assert.equal(intakeItem(before, 'INTAKE-5').assignable, false);

  const retry = await resolve(fx, conflict.conflictId, {
    decision: 'supplement_and_retry',
    details: '需要先补齐法定名称',
    expectedVersion: conflict.expectedVersion,
  });

  fx.db.prepare('UPDATE customer_pool SET nickname=? WHERE customer_id=?').run('Distinct Lead', 'RU-9305');
  fx.db.prepare('UPDATE customer_pool SET nickname=? WHERE customer_id=?').run('Distinct Master', 'RU-9405');

  await resolve(fx, conflict.conflictId, {
    decision: 'confirm_new',
    targetExternalCustomerId: 'RU-9305',
    details: '已确认独立客户',
    expectedVersion: retry.resolution.expectedVersion,
  });

  const after = await (await fx.request('/api/sales-crm/intake?status=pending', { cookie: fx.adminCookie })).json();
  const item = intakeItem(after, 'INTAKE-5');
  assert.equal(item.identityWarning, null);
  assert.equal(item.assignable, true);
  assert.ok(!item.claimBlocked);
});

test('applyIdentitySupplement appends contact and fills only empty fields; skip audits only', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,website,industry,stage,owner_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run('ACCT-SUP', 'RU-9406', 'Master Co', 'https://master.example.com', '', 'contacted', 'U-WU', NOW, NOW);
  fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,contact_name,website,industry,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('INTAKE-SUP', 'BATCH-TEST', 'RU-9306', 'Lead Co', 'pending', '张三', 'https://lead.example.com', '电子', NOW, NOW);

  const applied = applyIdentitySupplement(fx.db, CONFLICT_MANAGER, {
    leadExternalCustomerId: 'RU-9306',
    masterExternalCustomerId: 'RU-9406',
    fields: { contact: '张三', website: 'https://lead.example.com', industry: '电子' },
  });
  assert.deepEqual(applied.applied, { contact: true, industry: true });
  assert.deepEqual(applied.skipped, { website: true });

  const contact = fx.db.prepare("SELECT * FROM crm_account_contacts WHERE customer_id='ACCT-SUP'").get();
  assert.equal(contact.name, '张三');
  assert.equal(fx.db.prepare("SELECT website FROM crm_accounts WHERE id='ACCT-SUP'").get().website, 'https://master.example.com');
  assert.equal(fx.db.prepare("SELECT industry FROM crm_accounts WHERE id='ACCT-SUP'").get().industry, '电子');
  assert.ok(fx.db.prepare("SELECT 1 FROM crm_customer_identity_audit WHERE action='identity_supplement_applied'").get());

  const skipped = skipIdentitySupplement(fx.db, CONFLICT_MANAGER, {
    leadExternalCustomerId: 'RU-9306', masterExternalCustomerId: 'RU-9406',
  });
  assert.equal(skipped.skipped, true);
  assert.ok(fx.db.prepare("SELECT 1 FROM crm_customer_identity_audit WHERE action='identity_supplement_skipped'").get());
  assert.equal(fx.db.prepare("SELECT COUNT(*) n FROM crm_account_contacts WHERE customer_id='ACCT-SUP'").get().n, 1);
});

test('/supplement endpoint applies for a conflict manager and rejects non-managers', async t => {
  const fx = await fixtures.adminFixture({ permissions: PERMS });
  t.after(() => fx.close());
  const conflict = seedIdentityConflict(fx, {
    leadId: 'RU-9307', masterId: 'RU-9407', intakeId: 'INTAKE-7',
    leadCompany: 'Lead Seven Co', masterCompany: 'Master Seven Co',
    intake: { contact_name: '李四', website: 'https://lead7.example.com', industry: '机械' },
  });
  await resolve(fx, conflict.conflictId, {
    decision: 'link_existing',
    targetExternalCustomerId: conflict.crmExternalCustomerIds[0],
    expectedVersion: conflict.expectedVersion,
    details: '同一客户',
  });

  const forbidden = await fx.request(`/api/sales-crm/protected-customer-conflicts/${conflict.conflictId}/supplement`, {
    cookie: fx.otherCookie, method: 'POST', body: { action: 'apply' },
  });
  assert.equal(forbidden.status, 403);

  const applyResp = await fx.request(`/api/sales-crm/protected-customer-conflicts/${conflict.conflictId}/supplement`, {
    cookie: fx.adminCookie, method: 'POST', body: { action: 'apply' },
  });
  assert.equal(applyResp.status, 200, await applyResp.clone().text());
  const applyBody = await applyResp.json();
  assert.equal(applyBody.ok, true);
  assert.deepEqual(applyBody.applied, { contact: true, website: true, industry: true });

  const contact = fx.db.prepare("SELECT * FROM crm_account_contacts WHERE external_customer_id='RU-9407'").get();
  assert.equal(contact.name, '李四');
  assert.equal(fx.db.prepare("SELECT website FROM crm_accounts WHERE external_customer_id='RU-9407'").get().website, 'https://lead7.example.com');
  assert.equal(fx.db.prepare("SELECT industry FROM crm_accounts WHERE external_customer_id='RU-9407'").get().industry, '机械');
});

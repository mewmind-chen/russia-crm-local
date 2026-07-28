const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function tagByName(fx, category, name) {
  return fx.db.prepare('SELECT * FROM tags WHERE category=? AND name=?').get(category, name);
}

function addManualTag(fx, name, category = '客户标签') {
  fx.db.prepare(`INSERT INTO tags (name,category,color,is_preset,created_at)
    VALUES (?,?,'#475467',0,'2026-07-20 08:00:00')`).run(name, category);
  return tagByName(fx, category, name);
}

function bindings(fx, customerId) {
  return fx.db.prepare(`SELECT ct.tag_id tagId,ct.created_at createdAt,t.name,t.category,t.is_preset isPreset
    FROM customer_tags ct JOIN tags t ON t.id=ct.tag_id
    WHERE ct.customer_id=? ORDER BY ct.tag_id`).all(customerId);
}

async function setTags(fx, customerId, tagIds, cookie = fx.cookie) {
  return fx.request('/api/app', {
    cookie,
    method: 'POST',
    body: { action: 'setCustomerTags', customerId, tagIds },
  });
}

async function removeTag(fx, customerId, tagId, cookie = fx.cookie) {
  return fx.request('/api/app', {
    cookie,
    method: 'POST',
    body: { action: 'removeCustomerTag', customerId, tagId },
  });
}

test('tag updates are differential, idempotent, and record the real actor', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const first = addManualTag(fx, '长期合作');
  const second = addManualTag(fx, '重点跟进');
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 09:30:00')`).run(first.id);

  const added = await setTags(fx, 'RU-9001', [first.id, second.id]);
  assert.equal(added.status, 200);
  assert.deepEqual((await added.json()).diff, {
    added: [second.id],
    removed: [],
    unchanged: [first.id],
  });
  assert.equal(bindings(fx, 'RU-9001').find(row => row.tagId === first.id).createdAt, '2026-07-01 09:30:00');
  assert.deepEqual(
    fx.db.prepare(`SELECT tag_id tagId,action,actor_id actorId FROM customer_tag_history
      WHERE customer_id='RU-9001' ORDER BY id`).all(),
    [{ tagId: second.id, action: 'added', actorId: 'U-WU' }],
  );

  const repeated = await setTags(fx, 'RU-9001', [first.id, second.id]);
  assert.equal(repeated.status, 200);
  assert.deepEqual((await repeated.json()).diff, {
    added: [],
    removed: [],
    unchanged: [first.id, second.id],
  });
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'").get().count,
    1,
  );

  const removed = await setTags(fx, 'RU-9001', [second.id]);
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).diff.removed, [first.id]);
  const removal = fx.db.prepare(`SELECT tag_name tagName,tag_category tagCategory,action,actor_id actorId
    FROM customer_tag_history WHERE customer_id='RU-9001' ORDER BY id DESC LIMIT 1`).get();
  assert.deepEqual(removal, {
    tagName: '长期合作',
    tagCategory: '客户标签',
    action: 'removed',
    actorId: 'U-WU',
  });
});

test('tag diff rolls back bindings and history when a history write fails', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const first = addManualTag(fx, '原绑定');
  const second = addManualTag(fx, '新绑定');
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 09:30:00')`).run(first.id);
  fx.db.exec(`CREATE TRIGGER fail_added_tag_history
    BEFORE INSERT ON customer_tag_history
    WHEN NEW.action='added'
    BEGIN SELECT RAISE(ABORT,'forced tag history failure'); END`);

  const response = await setTags(fx, 'RU-9001', [second.id]);
  assert.equal(response.status, 400);
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [first.id]);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'").get().count,
    0,
  );
});

test('tag history query applies view permission and customer row scope', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO customer_tag_history
    (customer_id,tag_id,tag_name,tag_category,action,actor_id,created_at)
    VALUES ('RU-9002',1,'可见','客户标签','added','U-MGR','2026-07-28 08:00:00'),
           ('RU-9003',1,'不可见','客户标签','added','U-OTHER','2026-07-28 08:00:00')`).run();

  const allowed = await fx.request('/api/sales-crm/profile/RU-9002/tag-history', { cookie: fx.cookie });
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).history.map(row => row.tagName), ['可见']);
  const denied = await fx.request('/api/sales-crm/profile/RU-9003/tag-history', { cookie: fx.cookie });
  assert.equal(denied.status, 403);

  fx.setUserPermissions('U-MGR', { view_customers: false, view_all_customers: false });
  const noPermission = await fx.request('/api/sales-crm/profile/RU-9002/tag-history', { cookie: fx.cookie });
  assert.equal(noPermission.status, 403);
});

test('tag writes require edit permission and reject malformed or oversized sets', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const tag = addManualTag(fx, '权限标签');
  fx.setUserPermissions('U-WU', { edit_customer: false });
  const denied = await setTags(fx, 'RU-9001', [tag.id]);
  assert.equal(denied.status, 403);
  assert.deepEqual(bindings(fx, 'RU-9001'), []);

  fx.setUserPermissions('U-WU', { edit_customer: true });
  const malformed = await setTags(fx, 'RU-9001', [tag.id, 1.5]);
  assert.equal(malformed.status, 400);
  const oversized = await setTags(fx, 'RU-9001', Array.from({ length: 101 }, (_, index) => index + 1));
  assert.equal(oversized.status, 400);
  assert.deepEqual(bindings(fx, 'RU-9001'), []);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM customer_tag_history').get().count, 0);
});

test('impersonated tag edits are blocked without changing bindings or history', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const tag = addManualTag(fx, '身份审计');
  const session = await fx.startImpersonation('U-WU');
  const response = await setTags(fx, 'RU-9001', [tag.id], session.cookie || fx.adminCookie);
  assert.equal(response.status, 403);
  assert.deepEqual(bindings(fx, 'RU-9001'), []);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'").get().count,
    0,
  );
});

test('manual tag removal uses tag ID, writes actor history, and preserves other bindings', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const first = addManualTag(fx, '同名标签', '客户标签');
  const second = addManualTag(fx, '同名标签', '其他');
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00'),('RU-9001',?,'2026-07-02 08:00:00')`)
    .run(first.id, second.id);

  const response = await removeTag(fx, 'RU-9001', first.id);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.removedTagId, first.id);
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [second.id]);
  assert.deepEqual(
    fx.db.prepare(`SELECT tag_id tagId,tag_name tagName,action,actor_id actorId
      FROM customer_tag_history WHERE customer_id='RU-9001' ORDER BY id`).all(),
    [{ tagId: first.id, tagName: '同名标签', action: 'removed', actorId: 'U-WU' }],
  );
});

test('manual removal rejects preset tags and rolls back when history cannot be written', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const preset = tagByName(fx, '客户类型', '贸易公司');
  const manual = addManualTag(fx, '事务回滚');
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00'),('RU-9001',?,'2026-07-02 08:00:00')`)
    .run(preset.id, manual.id);

  const presetResponse = await removeTag(fx, 'RU-9001', preset.id);
  assert.equal(presetResponse.status, 400);
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [preset.id, manual.id].sort((a, b) => a - b));

  fx.db.exec(`CREATE TRIGGER fail_removed_tag_history
    BEFORE INSERT ON customer_tag_history
    WHEN NEW.action='removed'
    BEGIN SELECT RAISE(ABORT,'forced tag removal history failure'); END`);
  const failed = await removeTag(fx, 'RU-9001', manual.id);
  assert.equal(failed.status, 400);
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [preset.id, manual.id].sort((a, b) => a - b));
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM customer_tag_history').get().count, 0);
});

test('manual removal requires edit permission and is blocked while impersonating', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const tag = addManualTag(fx, '权限删除');
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00')`).run(tag.id);
  fx.setUserPermissions('U-WU', { edit_customer: false });
  assert.equal((await removeTag(fx, 'RU-9001', tag.id)).status, 403);
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [tag.id]);

  const admin = await fixtures.adminFixture();
  t.after(() => admin.close());
  const adminTag = addManualTag(admin, '身份检查删除');
  admin.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00')`).run(adminTag.id);
  const session = await admin.startImpersonation('U-WU');
  assert.equal(
    (await removeTag(admin, 'RU-9001', adminTag.id, session.cookie || admin.adminCookie)).status,
    403,
  );
  assert.deepEqual(bindings(admin, 'RU-9001').map(row => row.tagId), [adminTag.id]);
});

test('customer type updates structured fields and only its preset binding', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const oldPreset = tagByName(fx, '客户类型', '贸易公司');
  const newPreset = tagByName(fx, '客户类型', '系统集成商');
  const sameNameManual = addManualTag(fx, '系统集成商');
  fx.db.prepare("UPDATE crm_accounts SET customer_type='贸易公司' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE customer_pool SET customer_type='贸易公司' WHERE customer_id='RU-9001'").run();
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00'),('RU-9001',?,'2026-07-02 08:00:00')`)
    .run(oldPreset.id, sameNameManual.id);

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { customerType: '系统集成商' },
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(fx.db.prepare("SELECT customer_type FROM crm_accounts WHERE id='CRM-WU'").get().customer_type, '系统集成商');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customer_pool WHERE customer_id='RU-9001'").get().customer_type, '系统集成商');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customers WHERE customer_id='RU-9001'").get().customer_type, '系统集成商');
  const rows = bindings(fx, 'RU-9001');
  assert.equal(rows.some(row => row.tagId === oldPreset.id), false);
  assert.equal(rows.some(row => row.tagId === newPreset.id && row.isPreset === 1), true);
  assert.equal(rows.some(row => row.tagId === sameNameManual.id && row.isPreset === 0), true);
  assert.deepEqual(
    fx.db.prepare(`SELECT action,actor_id actorId FROM customer_tag_history
      WHERE customer_id='RU-9001' ORDER BY id`).all(),
    [
      { action: 'removed', actorId: 'U-WU' },
      { action: 'added', actorId: 'U-WU' },
    ],
  );
  const audit = fx.db.prepare(`SELECT user_id userId,detail_json detailJson FROM crm_audit_log
    WHERE action='customer_type_changed' AND entity_id='CRM-WU'`).get();
  assert.equal(audit.userId, 'U-WU');
  assert.deepEqual(JSON.parse(audit.detailJson), {
    oldCustomerType: '贸易公司',
    newCustomerType: '系统集成商',
    tagId: newPreset.id,
  });

  const createdAt = rows.find(row => row.tagId === newPreset.id).createdAt;
  const historyCount = fx.db.prepare(
    "SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'"
  ).get().count;
  const repeated = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { customerType: '系统集成商' },
  });
  assert.equal(repeated.status, 200);
  assert.equal(bindings(fx, 'RU-9001').find(row => row.tagId === newPreset.id).createdAt, createdAt);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'").get().count,
    historyCount,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_audit_log WHERE action='customer_type_changed' AND entity_id='CRM-WU'").get().count,
    1,
  );
});

test('profile edits accept unchanged legacy customer types and allow clearing the type', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE crm_accounts SET customer_type='制造商' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE customer_pool SET customer_type='制造商' WHERE customer_id='RU-9001'").run();
  fx.db.prepare("UPDATE customers SET customer_type='制造商' WHERE customer_id='RU-9001'").run();

  const profileEdit = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { website: 'https://legacy-type.example', customerType: '制造商' },
  });
  assert.equal(profileEdit.status, 200, await profileEdit.text());
  assert.equal(
    fx.db.prepare("SELECT website FROM crm_accounts WHERE id='CRM-WU'").get().website,
    'https://legacy-type.example',
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_audit_log WHERE action='customer_type_changed'").get().count,
    0,
  );

  const cleared = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { customerType: '' },
  });
  assert.equal(cleared.status, 200, await cleared.text());
  assert.equal(fx.db.prepare("SELECT customer_type FROM crm_accounts WHERE id='CRM-WU'").get().customer_type, '');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customer_pool WHERE customer_id='RU-9001'").get().customer_type, '');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customers WHERE customer_id='RU-9001'").get().customer_type, '');
});

test('customer type synchronization does not fabricate a missing legacy follow-up row', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const oldPreset = tagByName(fx, '客户类型', '贸易公司');
  const newPreset = tagByName(fx, '客户类型', '系统集成商');
  fx.db.prepare("UPDATE crm_accounts SET customer_type='贸易公司' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE customer_pool SET customer_type='贸易公司' WHERE customer_id='RU-9001'").run();
  fx.db.prepare("DELETE FROM customers WHERE customer_id='RU-9001'").run();
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00')`).run(oldPreset.id);

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { customerType: '系统集成商' },
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(fx.db.prepare("SELECT customer_type FROM crm_accounts WHERE id='CRM-WU'").get().customer_type, '系统集成商');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customer_pool WHERE customer_id='RU-9001'").get().customer_type, '系统集成商');
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM customers WHERE customer_id='RU-9001'").get().count, 0);
  const rows = bindings(fx, 'RU-9001');
  assert.equal(rows.some(row => row.tagId === oldPreset.id), false);
  assert.equal(rows.some(row => row.tagId === newPreset.id), true);
});

test('customer type update rolls back fields, bindings, history, and audit together', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  const oldPreset = tagByName(fx, '客户类型', '贸易公司');
  fx.db.prepare("UPDATE crm_accounts SET customer_type='贸易公司' WHERE id='CRM-WU'").run();
  fx.db.prepare("UPDATE customer_pool SET customer_type='贸易公司' WHERE customer_id='RU-9001'").run();
  fx.db.prepare("UPDATE customers SET customer_type='贸易公司' WHERE customer_id='RU-9001'").run();
  fx.db.prepare(`INSERT INTO customer_tags (customer_id,tag_id,created_at)
    VALUES ('RU-9001',?,'2026-07-01 08:00:00')`).run(oldPreset.id);
  fx.db.exec(`CREATE TRIGGER fail_customer_type_audit
    BEFORE INSERT ON crm_audit_log
    WHEN NEW.action='customer_type_changed'
    BEGIN SELECT RAISE(ABORT,'forced customer type audit failure'); END`);

  const response = await fx.request('/api/sales-crm/accounts/CRM-WU', {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { customerType: '系统集成商' },
  });
  assert.equal(response.status, 400);
  assert.equal(fx.db.prepare("SELECT customer_type FROM crm_accounts WHERE id='CRM-WU'").get().customer_type, '贸易公司');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customer_pool WHERE customer_id='RU-9001'").get().customer_type, '贸易公司');
  assert.equal(fx.db.prepare("SELECT customer_type FROM customers WHERE customer_id='RU-9001'").get().customer_type, '贸易公司');
  assert.deepEqual(bindings(fx, 'RU-9001').map(row => row.tagId), [oldPreset.id]);
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM customer_tag_history WHERE customer_id='RU-9001'").get().count,
    0,
  );
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) count FROM crm_audit_log WHERE action='customer_type_changed'").get().count,
    0,
  );
});

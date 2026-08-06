const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function seedLeadPool(fx) {
  const now = '2026-07-28 08:00:00';
  fx.db.prepare(`INSERT INTO crm_intake_batches
    (id,batch_date,source,status,created_at)
    VALUES ('BATCH-103','2026-07-28','manual-import','done',?)`).run(now);
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,country,website,industry,
     customer_type,product_focus,contact_name,contact_title,contact_methods,
     contact_level,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run(
    'INTAKE-103-PENDING', 'BATCH-103', 'LEAD-103-PENDING', 'Pending Components',
    '俄罗斯', '', '电子制造', '制造商', '功率器件', '', '', '', 'L0',
    'pending', now, now,
  );
  insert.run(
    'INTAKE-103-APPROVED', 'BATCH-103', 'LEAD-103-APPROVED', 'Approved Electronics',
    '俄罗斯', 'https://approved.example', '电子制造', '制造商', '连接器',
    'Anna Buyer', 'Procurement', 'email:anna@example.test', 'L3',
    'approved', now, now,
  );
  insert.run(
    'INTAKE-103-DUPLICATE', 'BATCH-103', 'LEAD-103-DUPLICATE', 'Duplicate Electronics',
    '俄罗斯', '', '电子制造', '制造商', '连接器', '', '', '', 'L0',
    'duplicate', now, now,
  );
  const tagId = fx.db.prepare(`INSERT INTO tags(name,category,color,is_preset,created_at)
    VALUES ('重点客户','客户类型','#2563eb',0,?)`).run(now).lastInsertRowid;
  fx.db.prepare(`INSERT INTO customer_tags(customer_id,tag_id,created_at)
    VALUES ('LEAD-103-PENDING',?,?)`).run(tagId, now);
}

test('unified lead pool merges pending and approved with filter-aligned counts', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedLeadPool(fx);

  const merged = await fx.requestJson(
    '/api/sales-crm/intake?status=unassigned&sourceBatch=BATCH-103&pageSize=50',
    { cookie: fx.adminCookie },
  );
  assert.equal(merged.total, 2);
  assert.deepEqual(
    merged.items.map(item => item.status).sort(),
    ['approved', 'pending'],
  );
  assert.equal(merged.stats.unassigned, 2);
  assert.equal(merged.stats.pending, 1);
  assert.equal(merged.stats.approved, 1);

  const allBusinessStatuses = await fx.requestJson(
    '/api/sales-crm/intake?sourceBatch=BATCH-103&pageSize=50',
    { cookie: fx.adminCookie },
  );
  assert.equal(allBusinessStatuses.total, 2);
  assert.doesNotMatch(allBusinessStatuses.items.map(item => item.status).join(','), /duplicate/);

  const withoutWebsite = await fx.requestJson(
    '/api/sales-crm/intake?status=unassigned&sourceBatch=BATCH-103&hasWebsite=0',
    { cookie: fx.adminCookie },
  );
  assert.equal(withoutWebsite.total, 1);
  assert.equal(withoutWebsite.items[0].id, 'INTAKE-103-PENDING');
  assert.equal(withoutWebsite.stats.unassigned, 1);

  const withContact = await fx.requestJson(
    '/api/sales-crm/intake?status=unassigned&sourceBatch=BATCH-103&hasNamedContact=1',
    { cookie: fx.adminCookie },
  );
  assert.equal(withContact.total, 1);
  assert.equal(withContact.items[0].id, 'INTAKE-103-APPROVED');
  assert.equal(withContact.stats.approved, 1);
  assert.equal(withContact.stats.pending, 0);

  const tagged = await fx.requestJson(
    '/api/sales-crm/intake?status=unassigned&sourceBatch=BATCH-103&customerTag=%E9%87%8D%E7%82%B9%E5%AE%A2%E6%88%B7',
    { cookie: fx.adminCookie },
  );
  assert.equal(tagged.total, 1);
  assert.equal(tagged.items[0].id, 'INTAKE-103-PENDING');
  assert.deepEqual(tagged.items[0].customerTags.map(tag => tag.name), ['重点客户']);
});

test('single return rejects returned customers and accepts active unassigned CRM customers', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts
    SET assignment_status='returned',lifecycle_status='active'
    WHERE id='CRM-OTHER'`).run();
  const returned = await fx.request('/api/sales-crm/accounts/CRM-OTHER/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '不允许重复退回' },
  });
  assert.equal(returned.status, 409);
  assert.equal((await returned.json()).code, 'CUSTOMER_RETURN_STATE_INVALID');

  fx.db.prepare(`UPDATE crm_accounts
    SET owner_id=NULL,assignment_status='unassigned',lifecycle_status='active'
    WHERE id='CRM-OWN'`).run();
  const unassigned = await fx.request('/api/sales-crm/accounts/CRM-OWN/return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { reason: '未分配客户正常退回线索池' },
  });
  assert.equal(unassigned.status, 200);
  assert.deepEqual(
    fx.db.prepare(`SELECT owner_id,previous_owner_id,lifecycle_status,recycle_kind,assignment_status
      FROM crm_accounts WHERE id='CRM-OWN'`).get(),
    {
      owner_id: null,
      previous_owner_id: '',
      lifecycle_status: 'active',
      recycle_kind: '',
      assignment_status: 'returned',
    },
  );
});

test('bulk return rejects an invalid member atomically', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  fx.db.prepare(`UPDATE crm_accounts
    SET assignment_status='returned',lifecycle_status='active'
    WHERE id='CRM-OTHER'`).run();
  const before = fx.db.prepare(`SELECT id,owner_id,lifecycle_status,assignment_status
    FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OTHER') ORDER BY id`).all();
  const response = await fx.request('/api/sales-crm/accounts/bulk-return', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      customerIds: ['CRM-WU', 'CRM-OTHER'],
      reason: '批量操作必须整体拒绝',
    },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'CUSTOMER_RETURN_STATE_INVALID');
  assert.deepEqual(
    fx.db.prepare(`SELECT id,owner_id,lifecycle_status,assignment_status
      FROM crm_accounts WHERE id IN ('CRM-WU','CRM-OTHER') ORDER BY id`).all(),
    before,
  );
});

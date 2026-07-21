const test = require('node:test');
const assert = require('node:assert/strict');
const { seededFixture } = require('./helpers/permission_fixture');
const { buildAccessContext } = require('../lib/access_control');
const { hydrateUserPermissions } = require('../lib/permission_groups');
const { searchCrmContext, fetchWebPagesContext } = require('../lib/assistant');
const { ensureAssistantTables, vectorSearch, vectorToBlob } = require('../lib/assistant_index');

async function json(response) {
  return { response, body: await response.json() };
}

test('assistant rejects an explicitly requested customer outside the account scope', async () => {
  const fx = await seededFixture({ managerViewAll: false, permissions: { use_ai_assistant: true } });
  try {
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '分析当前客户', context: { scope: 'customer', customerId: 'RU-9003' } },
    }));
    assert.equal(response.status, 403);
    assert.match(body.error, /无权访问该客户/);
  } finally {
    await fx.close();
  }
});

test('assistant rejects an out-of-scope customer ID written in the question', async () => {
  const fx = await seededFixture({ managerViewAll: false, permissions: { use_ai_assistant: true } });
  try {
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '查询 RU-9003 的客户画像' },
    }));
    assert.equal(response.status, 403);
    assert.match(body.error, /无权访问该客户/);
  } finally {
    await fx.close();
  }
});

test('assistant deterministic queries only return customers in the account scope', async () => {
  const fx = await seededFixture({ managerViewAll: false, permissions: { use_ai_assistant: true } });
  try {
    fx.db.prepare("UPDATE customers SET email='outside@secret.test', contact='Outside Buyer' WHERE customer_id='RU-9001'").run();
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '列出联系人' },
    }));
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /RU-9001|outside@secret\.test|Outside Buyer/);
    assert.doesNotMatch(serialized, /RU-9003/);
  } finally {
    await fx.close();
  }
});

test('assistant generic SQL context is cropped before prompt construction', async () => {
  const fx = await seededFixture({ managerViewAll: false, permissions: { use_ai_assistant: true } });
  try {
    const user = hydrateUserPermissions(fx.db, fx.db.prepare('SELECT * FROM sales_users WHERE id=?').get('U-MGR'));
    const accessContext = buildAccessContext(fx.db, user);
    const context = searchCrmContext('Fixture', accessContext);
    const serialized = JSON.stringify(context);
    assert.match(serialized, /RU-9002/);
    assert.doesNotMatch(serialized, /RU-9001|RU-9003|person@secret\.test|hidden@secret\.test/);
    assert.equal(context.stats.customers, 1);
    assert.equal(context.stats.customer_pool, 1);
    assert.equal(context.stats.recon_results, 1);
  } finally {
    await fx.close();
  }
});

test('assistant never retrieves contact fields without view_contacts', async () => {
  const fx = await seededFixture({ permissions: { use_ai_assistant: true, view_contacts: false } });
  try {
    fx.db.prepare("UPDATE customers SET notes='hidden-note person@secret.test' WHERE customer_id='RU-9001'").run();
    fx.db.prepare(`UPDATE customer_pool SET
      description='assistant-description-marker assistant-description@secret.test',
      products='assistant-products-marker +7-assistant-products'
      WHERE customer_id='RU-9001'`).run();
    const user = hydrateUserPermissions(fx.db, fx.db.prepare('SELECT * FROM sales_users WHERE id=?').get('U-WU'));
    const accessContext = buildAccessContext(fx.db, user);
    const scopedContext = searchCrmContext('hidden-note', accessContext);
    assert.doesNotMatch(JSON.stringify(scopedContext), /person@secret\.test/);
    assert.equal(scopedContext.customers.length, 0);
    const narrativeContext = searchCrmContext('assistant-description-marker assistant-products-marker', accessContext);
    assert.doesNotMatch(JSON.stringify({
      customers: narrativeContext.customers,
      recon: narrativeContext.recon,
      evidence: narrativeContext.evidence,
      intentLists: narrativeContext.intentLists,
    }), /assistant-(?:description|products)/);
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '列出联系人' },
    }));
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /person@secret\.test|\+7-secret|Verified Buyer|Procurement|assistant-(?:description|products)|\+7-assistant/);
  } finally {
    await fx.close();
  }
});

test('assistant does not fetch direct URLs when contacts are forbidden', async () => {
  assert.equal(typeof fetchWebPagesContext, 'function');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error('network should not be called');
  };
  try {
    const result = await fetchWebPagesContext(
      '打开 https://example.test/contact',
      {},
      null,
      { permissions: { view_contacts: false } },
    );
    assert.equal(calls, 0);
    assert.deepEqual(result, { ok: false, skipped: true, reason: 'contact_permission', pages: [] });
  } finally {
    global.fetch = originalFetch;
  }
});

test('assistant never retrieves Recon rows without view_recon', async () => {
  const fx = await seededFixture({ permissions: { use_ai_assistant: true, view_recon: false } });
  try {
    fx.db.prepare("UPDATE recon_results SET report_path='reports/secret.html', opportunity_summary='Hidden Recon Finding' WHERE job_id='JOB-OWN'").run();
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '列出 Recon 报告' },
    }));
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /JOB-OWN|Hidden Recon Finding|reports\/secret\.html/);
  } finally {
    await fx.close();
  }
});

test('assistant vector retrieval is disabled when contacts are forbidden', async () => {
  const fx = await seededFixture();
  try {
    ensureAssistantTables(fx.db);
    const info = fx.db.prepare(`INSERT INTO assistant_documents
      (doc_key,doc_type,source_table,source_id,customer_id,title,content,content_hash,updated_at)
      VALUES ('secret-doc','customer_pool','customer_pool','RU-9001','RU-9001','Wu Fixture',
              '联系方式: person@secret.test +7-secret','hash','2026-07-21 08:00:00')`).run();
    fx.db.prepare(`INSERT INTO assistant_embeddings
      (document_id,provider,model,dimensions,embedding,content_hash,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      info.lastInsertRowid, 'qwen', 'qwen3-vl-embedding', 1024,
      vectorToBlob(Array(1024).fill(0)), 'hash', '2026-07-21 08:00:00',
    );
    const result = await vectorSearch('联系方式', {
      allowedCustomerIds: ['RU-9001'], canViewContacts: false, canViewRecon: true,
    });
    assert.deepEqual(result.results, []);
  } finally {
    await fx.close();
  }
});

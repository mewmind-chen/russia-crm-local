const test = require('node:test');
const assert = require('node:assert/strict');
const { seededFixture } = require('./helpers/permission_fixture');
const { buildAccessContext } = require('../lib/access_control');
const { searchCrmContext } = require('../lib/assistant');

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
    const user = fx.db.prepare('SELECT * FROM sales_users WHERE id=?').get('U-MGR');
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
    const { response, body } = await json(await fx.request('/api/assistant/chat', {
      cookie: fx.cookie,
      method: 'POST',
      body: { message: '列出联系人' },
    }));
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /person@secret\.test|\+7-secret|Verified Buyer|Procurement/);
  } finally {
    await fx.close();
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./helpers/permission_fixture');

async function putStar(fx, cookie, customerId, active, reason = '') {
  const response = await fx.request(`/api/sales-crm/customer-stars/${customerId}`, {
    cookie, method: 'PUT', body: { active, reason },
  });
  return { response, body: await response.json() };
}

async function accounts(fx, cookie, starView = 'all') {
  const response = await fx.request(`/api/sales-crm/accounts?page=1&pageSize=50&starView=${starView}`, { cookie });
  return { response, body: await response.json() };
}

test('multiple users can independently star the same scoped customer with reasons and audits', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());

  const salesStar = await putStar(fx, fx.otherCookie, 'CRM-OTHER', true, '大客户潜力');
  assert.equal(salesStar.response.status, 200, JSON.stringify(salesStar.body));
  assert.equal(salesStar.body.starState.isStarred, true);
  assert.equal(salesStar.body.starState.myStar.reason, '大客户潜力');
  const repeatedSalesStar = await putStar(fx, fx.otherCookie, 'CRM-OTHER', true, '大客户潜力');
  assert.equal(repeatedSalesStar.response.status, 200);
  assert.equal(repeatedSalesStar.body.unchanged, true);

  const managerStar = await putStar(fx, fx.cookie, 'CRM-OTHER', true, '老板关注');
  assert.equal(managerStar.response.status, 200, JSON.stringify(managerStar.body));
  assert.equal(managerStar.body.starState.starCount, 2);
  assert.deepEqual(new Set(managerStar.body.starState.starUsers.map(item => item.userName)), new Set(['Other', 'Wu']));
  assert.ok(managerStar.body.starState.starUsers.every(item => item.starredAt));

  const salesMine = await accounts(fx, fx.otherCookie, 'mine');
  assert.equal(salesMine.response.status, 200);
  assert.deepEqual(salesMine.body.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(salesMine.body.rows[0].starCount, 1);
  assert.deepEqual(salesMine.body.rows[0].starUsers.map(item => item.userName), ['Other']);
  assert.equal(salesMine.body.rows[0].myStar.reason, '大客户潜力');
  assert.deepEqual(salesMine.body.rows[0].starUsers.map(item => item.reason), ['大客户潜力']);

  const salesBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.otherCookie });
  const salesBootstrapAccount = salesBootstrap.accounts.find(row => row.id === 'CRM-OTHER');
  assert.equal(salesBootstrapAccount.myStar.reason, '大客户潜力');
  assert.deepEqual(salesBootstrapAccount.starUsers.map(item => item.reason), ['大客户潜力']);

  const managerTeam = await accounts(fx, fx.cookie, 'team');
  assert.equal(managerTeam.response.status, 200);
  assert.deepEqual(managerTeam.body.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(managerTeam.body.rows[0].starCount, 2);

  const exportTeam = await fx.request('/api/sales-crm/export?starView=team', { cookie: fx.adminCookie });
  const exportBody = await exportTeam.json();
  assert.equal(exportTeam.status, 200, JSON.stringify(exportBody));
  assert.deepEqual(exportBody.customers.map(row => row.id), ['CRM-OTHER']);

  const salesTeam = await accounts(fx, fx.otherCookie, 'team');
  assert.equal(salesTeam.response.status, 403);
  assert.equal(salesTeam.body.code, 'FILTER_NOT_AUTHORIZED');

  const removed = await putStar(fx, fx.otherCookie, 'CRM-OTHER', false);
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.starState.isStarred, false);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_customer_stars WHERE customer_id='CRM-OTHER' AND active=1").get().count, 1);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_audit_log WHERE entity_type='customer_star' AND entity_id='CRM-OTHER'").get().count, 3);
});

test('star writes and lists never expand customer scope', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const forbidden = await putStar(fx, fx.otherCookie, 'CRM-OWN', true, '越权关注');
  assert.equal(forbidden.response.status, 403);
  assert.equal(fx.db.prepare("SELECT COUNT(*) count FROM crm_customer_stars WHERE customer_id='CRM-OWN'").get().count, 0);
});

test('pipeline supports mine and team star views without replacing automatic queues', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  await putStar(fx, fx.otherCookie, 'CRM-OTHER', true, '需要持续盯');
  await putStar(fx, fx.cookie, 'CRM-OTHER', true, '老板关注');
  const mine = await fx.request('/api/sales-crm/lists/pipeline?page=1&pageSize=50&starView=mine', { cookie: fx.otherCookie });
  const mineBody = await mine.json();
  assert.equal(mine.status, 200, JSON.stringify(mineBody));
  assert.deepEqual(mineBody.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(Array.isArray(mineBody.rows[0].actionQueueKeys), true);
  assert.equal(mineBody.rows[0].myStar.reason, '需要持续盯');

  const team = await fx.request('/api/sales-crm/lists/pipeline?page=1&pageSize=50&starView=team', { cookie: fx.cookie });
  const teamBody = await team.json();
  assert.equal(team.status, 200, JSON.stringify(teamBody));
  assert.deepEqual(teamBody.rows.map(row => row.id), ['CRM-OTHER']);
  assert.equal(teamBody.summary.stars.team, 1);
  assert.ok(teamBody.summary.stars.teamQueueDistribution);
});

test('CRM list, customer detail, profile page and action workbench expose neutral star controls', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
  assert.match(html, /data-customer-star-view="mine"/);
  assert.match(html, /data-customer-star-view="team"/);
  assert.match(html, /id="customerProfileStar"/);
  assert.match(html, /id="drawerStarBtn"/);
  assert.match(app, /data-toggle-customer-star/);
  assert.match(app, /data-pipeline-star-view/);
  assert.match(app, /星标分布/);
  assert.match(app, /关注原因（可选）/);
  assert.doesNotMatch(app, /星标等级|D级客户/);
});

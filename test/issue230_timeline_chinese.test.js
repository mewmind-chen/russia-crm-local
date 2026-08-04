'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('Issue 230 claim event renders Chinese title and factual summary', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET assignment_status='claimed',claimed_at=?
    WHERE id='CRM-OWN'`).run('2026-08-04 08:00:00');

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', {
    cookie: fx.adminCookie,
  });
  const claimEvent = (bootstrap.timeline || []).find(event => event.kind === 'claim'
    && event.customer_id === 'CRM-OWN');
  assert.ok(claimEvent, 'claim event missing from timeline');
  assert.equal(claimEvent.title, '领取客户');
  assert.match(claimEvent.summary, /领取该线索并进入 CRM/);
  assert.doesNotMatch(claimEvent.summary, /无补充说明/);
});

test('Issue 230 nickname, reassign and intake-assign events join the timeline with Chinese labels', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const insertAudit = fx.db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insertAudit.run('AUD-230-N', 'U-WU', 'customer_nickname_updated', 'crm_account', 'CRM-OWN',
    JSON.stringify({ oldNickname: '旧名', newNickname: '新名' }), '2026-08-04 08:00:00', 'U-WU', 'U-WU', '');
  insertAudit.run('AUD-230-R', 'USR-ADMIN', 'customer_reassigned', 'crm_account', 'CRM-OWN',
    JSON.stringify({ ownerId: 'U-OTHER' }), '2026-08-04 08:10:00', 'USR-ADMIN', 'USR-ADMIN', '');

  fx.db.prepare(`UPDATE crm_accounts SET intake_item_id='INTAKE-OTHER' WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_intake_decisions
    (id,intake_item_id,decision_type,actor_id,manual_decision_json,created_at)
    VALUES (?,?,?,?,?,?)`).run(
    'DEC-230-ASSIGN', 'INTAKE-OTHER', 'manual', 'USR-ADMIN',
    JSON.stringify({ action: 'manual_assign', status: 'assigned', ownerId: 'U-OTHER', reason: '管理员指定分配' }),
    '2026-08-04 08:20:00',
  );

  const bootstrap = await fx.requestJson('/api/sales-crm/bootstrap', {
    cookie: fx.adminCookie,
  });
  const nick = (bootstrap.timeline || []).find(event => event.kind === 'nickname_update'
    && event.customer_id === 'CRM-OWN');
  const reassign = (bootstrap.timeline || []).find(event => event.kind === 'reassign'
    && event.customer_id === 'CRM-OWN');
  assert.ok(nick, 'nickname_update event missing');
  assert.equal(nick.title, '修改客户昵称');
  assert.match(nick.summary, /Wu修改了客户昵称/);
  assert.ok(reassign, 'reassign event missing');
  assert.equal(reassign.title, '重新分配');
  assert.match(reassign.summary, /将客户重新分配给 Other/);

  const otherBootstrap = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const assign = (otherBootstrap.timeline || []).find(event => event.kind === 'assign'
    && event.customer_id === 'CRM-OTHER');
  assert.ok(assign, 'assign event missing');
  assert.equal(assign.title, '分配线索');
  assert.match(assign.summary, /将线索分配给 Other/);
});

test('Issue 230 frontend routes every timeline event through a shared Chinese map', () => {
  assert.match(app, /EVENT_LABELS[\s\S]*?claim:\s*\{[\s\S]*?title: '领取客户'/);
  assert.match(app, /function timelineEventTitle\(event\)[\s\S]*?系统记录/);
  assert.match(app, /function timelineEventSummary\(event\)/);
  assert.doesNotMatch(app, /\|\| '无补充说明'/);
  assert.match(app, /raw !== '无补充说明'/);
  assert.doesNotMatch(app, /event\.title \|\| event\.kind/);
  assert.match(app, /timelineEventTitle\(event\)/);
  assert.match(app, /timelineEventSummary\(event\)/);
});

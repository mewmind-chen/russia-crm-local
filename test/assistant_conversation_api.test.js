'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const permissionFixtures = require('./helpers/permission_fixture');

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test('assistant conversation API persists deterministic chats and deduplicates client turns', async t => {
  const fx = await permissionFixtures.seededFixture();
  t.after(() => fx.close());

  const first = await json(await fx.request('/api/assistant/chat', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      message: '列出逾期未跟进客户',
      clientMessageId: 'client-turn-1',
      context: { scope: 'view', view: 'dashboard' },
    },
  }));
  assert.equal(first.status, 200);
  assert.ok(first.body.conversationId);
  assert.equal(first.body.duplicate, false);

  const repeated = await json(await fx.request('/api/assistant/chat', {
    cookie: fx.cookie,
    method: 'POST',
    body: {
      message: '列出逾期未跟进客户',
      conversationId: first.body.conversationId,
      clientMessageId: 'client-turn-1',
      context: { scope: 'view', view: 'dashboard' },
    },
  }));
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.duplicate, true);
  assert.equal(repeated.body.answer, first.body.answer);

  const detail = await json(await fx.request(`/api/assistant/conversations/${first.body.conversationId}`, {
    cookie: fx.cookie,
  }));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.conversation.messages.length, 2);
  assert.equal(detail.body.conversation.messages[0].content, '列出逾期未跟进客户');
  assert.equal(detail.body.conversation.messages[1].content, first.body.answer);
});

test('manager, administrator and sales conversation scopes and audit remain isolated', async t => {
  const fx = await permissionFixtures.adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { use_ai_assistant: true });
  const managerCookie = fx.cookie;
  const secondManagerCookie = await fx.login('manager@example.com', 'Password123!');
  const salesCookie = fx.otherCookie;

  const managerConversation = await json(await fx.request('/api/assistant/conversations', {
    cookie: managerCookie,
    method: 'POST',
    body: { title: '经理私密会话', scope: { scope: 'view' } },
  }));
  assert.equal(managerConversation.status, 201);
  const managerId = managerConversation.body.conversation.id;

  const salesConversation = await json(await fx.request('/api/assistant/conversations', {
    cookie: salesCookie,
    method: 'POST',
    body: { title: '销售会话', scope: { scope: 'customer', customerId: 'RU-9003' } },
  }));
  assert.equal(salesConversation.status, 201);
  const salesId = salesConversation.body.conversation.id;

  const managerSeesSales = await json(await fx.request(`/api/assistant/conversations/${salesId}`, {
    cookie: managerCookie,
  }));
  assert.equal(managerSeesSales.status, 200);
  assert.equal(managerSeesSales.body.conversation.ownerUserId, 'U-OTHER');

  const managerCannotSeePeer = await json(await fx.request(`/api/assistant/conversations/${managerId}`, {
    cookie: secondManagerCookie,
  }));
  assert.equal(managerCannotSeePeer.status, 403);

  const salesCannotSeeManager = await json(await fx.request(`/api/assistant/conversations/${managerId}`, {
    cookie: salesCookie,
  }));
  assert.equal(salesCannotSeeManager.status, 403);

  const adminSeesManager = await json(await fx.request(`/api/assistant/conversations/${managerId}`, {
    cookie: fx.adminCookie,
  }));
  assert.equal(adminSeesManager.status, 200);

  const managerCannotArchiveSales = await json(await fx.request(`/api/assistant/conversations/${salesId}`, {
    cookie: managerCookie,
    method: 'PATCH',
    body: { archived: true },
  }));
  assert.equal(managerCannotArchiveSales.status, 403);

  assert.ok(fx.db.prepare(`SELECT 1 FROM crm_audit_log
    WHERE action='assistant_conversation_view' AND entity_id=?`).get(salesId));
  assert.ok(fx.db.prepare(`SELECT 1 FROM crm_audit_log
    WHERE action='assistant_conversation_view' AND entity_id=?`).get(managerId));
});

test('archive hides an active conversation without deleting messages and restore brings it back', async t => {
  const fx = await permissionFixtures.seededFixture();
  t.after(() => fx.close());
  const chat = await json(await fx.request('/api/assistant/chat', {
    cookie: fx.cookie,
    method: 'POST',
    body: { message: '今日待跟进客户', clientMessageId: 'archive-turn', context: { scope: 'view' } },
  }));
  const conversationId = chat.body.conversationId;

  const archived = await json(await fx.request(`/api/assistant/conversations/${conversationId}`, {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { archived: true },
  }));
  assert.equal(archived.status, 200);
  assert.equal(archived.body.conversation.status, 'archived');

  const activeList = await json(await fx.request('/api/assistant/conversations', { cookie: fx.cookie }));
  assert.equal(activeList.body.conversations.some(item => item.id === conversationId), false);

  const detail = await json(await fx.request(`/api/assistant/conversations/${conversationId}`, {
    cookie: fx.cookie,
  }));
  assert.equal(detail.body.conversation.messages.length, 2);

  const restored = await json(await fx.request(`/api/assistant/conversations/${conversationId}`, {
    cookie: fx.cookie,
    method: 'PATCH',
    body: { archived: false },
  }));
  assert.equal(restored.status, 200);
  assert.equal(restored.body.conversation.status, 'active');
});

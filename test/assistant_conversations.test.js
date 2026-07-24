'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  createAssistantConversationStore,
  installAssistantConversationSchema,
} = require('../lib/assistant_conversations');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sales_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE crm_audit_log (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO sales_users(id,name,role) VALUES
      ('S-1','Sales One','sales'),('S-2','Sales Two','sales'),
      ('M-1','Manager','manager'),('A-1','Admin','admin');
  `);
  installAssistantConversationSchema(db);
  return db;
}

function result(answer, engine = 'hermes') {
  return {
    answer,
    engine,
    model: 'fixture-model',
    sessionId: `${engine}-session`,
    sessionEngine: engine,
    sources: [{ type: 'crm', title: 'Fixture', url: 'https://example.test' }],
    matchedCustomers: [{ customerId: 'RU-1001', companyName: 'Fixture' }],
    resultSets: [{ name: 'fixture', total: 1, returned: 1 }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    retrievalMode: 'deterministic',
  };
}

test('conversation history persists, new conversation does not delete the old one, and summary is bounded', () => {
  const db = fixture();
  const store = createAssistantConversationStore(db, { idFactory: prefix => `${prefix}-fixed-${Math.random()}` });
  const owner = { id: 'S-1', role: 'sales' };
  const first = store.create(owner, { title: '第一段' });
  store.appendTurn(first.id, { clientMessageId: 'turn-1', message: '问题一', context: { scope: 'view' }, result: result('回答一') });
  const second = store.create(owner, { title: '第二段' });
  assert.equal(store.list(owner).length, 2);
  assert.equal(store.getForActor(first.id, owner, { messages: true }).messages.length, 2);
  assert.equal(store.getForActor(second.id, owner, { messages: true }).messages.length, 0);
  for (let i = 2; i <= 6; i += 1) {
    store.appendTurn(first.id, {
      clientMessageId: `turn-${i}`,
      message: `问题${i}`,
      result: result(`回答${i}`),
    });
  }
  const prepared = store.prepare(first.id, owner);
  assert.match(prepared.summary, /问题一/);
  assert.ok(prepared.history.some(item => item.role === 'system' && item.content.includes('历史滚动摘要')));
  assert.ok(prepared.history.filter(item => item.role !== 'system').length <= 6);
  db.close();
});

test('duplicate client turn returns the stored answer without creating another pair', () => {
  const db = fixture();
  const store = createAssistantConversationStore(db);
  const owner = { id: 'S-1', role: 'sales' };
  const conversation = store.create(owner);
  const first = store.appendTurn(conversation.id, {
    clientMessageId: 'same-turn',
    message: '重复问题',
    result: result('唯一回答'),
  });
  const duplicate = store.appendTurn(conversation.id, {
    clientMessageId: 'same-turn',
    message: '重复问题',
    result: result('不应保存'),
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.assistantMessage.content, '唯一回答');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM assistant_conversation_messages WHERE conversation_id=?').get(conversation.id).n, 2);
  assert.equal(first.assistantMessage.id, duplicate.assistantMessage.id);
  db.close();
});

test('engine switches persist while a summary failure does not lose the conversation turn', () => {
  const db = fixture();
  const store = createAssistantConversationStore(db, {
    summaryBuilder() {
      throw new Error('summary unavailable');
    },
  });
  const owner = { id: 'S-1', role: 'sales' };
  const conversation = store.create(owner);
  for (let i = 1; i <= 5; i += 1) {
    store.appendTurn(conversation.id, {
      clientMessageId: `engine-${i}`,
      message: `切换测试 ${i}`,
      result: result(`回答 ${i}`, i < 5 ? 'hermes' : 'deepseek'),
    });
  }
  const detail = store.getForActor(conversation.id, owner, { messages: true });
  assert.equal(detail.messages.length, 10);
  assert.equal(detail.nativeSessionEngine, 'deepseek');
  assert.equal(detail.rollingSummary, '');
  assert.equal(detail.title, '切换测试 1');
  const renamed = store.rename(conversation.id, owner, '重点客户复盘');
  assert.equal(renamed.title, '重点客户复盘');
  assert.equal(store.setFavorite(conversation.id, owner, true).favorite, true);
  db.close();
});

test('sales, managers, and administrators receive the intended conversation scope', () => {
  const db = fixture();
  const store = createAssistantConversationStore(db);
  const salesOne = { id: 'S-1', role: 'sales' };
  const salesTwo = { id: 'S-2', role: 'sales' };
  const manager = { id: 'M-1', role: 'manager' };
  const admin = { id: 'A-1', role: 'admin' };
  const own = store.create(salesOne, { title: '销售私密' });
  const other = store.create(salesTwo, { title: '另一销售' });
  assert.equal(store.getForActor(own.id, salesTwo), null);
  assert.ok(store.getForActor(own.id, manager));
  assert.ok(store.getForActor(own.id, admin));
  assert.throws(() => store.setArchived(own.id, manager), /只有本人/);
  store.audit(manager, store.rowById(own.id), 'assistant_conversation_view');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_audit_log WHERE action=?').get('assistant_conversation_view').n, 1);
  assert.equal(store.list(manager).length, 2);
  assert.equal(store.list(salesOne).length, 1);
  assert.equal(store.list(admin).length, 2);
  assert.ok(other.id);
  db.close();
});

'use strict';

const crypto = require('crypto');

const RECENT_MESSAGE_LIMIT = 6;
const SUMMARY_TRIGGER = 10;
const MAX_TITLE_LENGTH = 120;

function text(value, limit = 20000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function json(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed;
  } catch (_error) {
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function installAssistantConversationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_conversations (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      favorite INTEGER NOT NULL DEFAULT 0,
      scope_json TEXT NOT NULL DEFAULT '{}',
      native_session_id TEXT NOT NULL DEFAULT '',
      native_session_engine TEXT NOT NULL DEFAULT '',
      rolling_summary TEXT NOT NULL DEFAULT '',
      summary_message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT '',
      archived_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_conversations_owner_idx
      ON assistant_conversations(owner_user_id,status,updated_at DESC);
    CREATE TABLE IF NOT EXISTS assistant_conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      client_message_id TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      matched_customers_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      result_sets_json TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT '{}',
      retrieval_mode TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      UNIQUE(conversation_id,sequence_no)
    );
    CREATE INDEX IF NOT EXISTS assistant_conversation_messages_idx
      ON assistant_conversation_messages(conversation_id,sequence_no);
    CREATE UNIQUE INDEX IF NOT EXISTS assistant_conversation_messages_client_idx
      ON assistant_conversation_messages(conversation_id,client_message_id)
      WHERE client_message_id!='';
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(assistant_conversations)').all().map(row => row.name));
  if (!columns.has('favorite')) {
    db.exec('ALTER TABLE assistant_conversations ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }
}

function publicMessage(row) {
  return {
    id: row.id,
    sequence: row.sequence_no,
    clientMessageId: row.client_message_id || '',
    role: row.role,
    content: row.content,
    sources: json(row.sources_json, []),
    matchedCustomers: json(row.matched_customers_json, []),
    actions: json(row.actions_json, []),
    resultSets: json(row.result_sets_json, []),
    context: json(row.context_json, {}),
    retrievalMode: row.retrieval_mode || '',
    engine: row.engine || '',
    model: row.model || '',
    usage: json(row.usage_json, {}),
    costUsd: Number(row.cost_usd || 0),
    createdAt: row.created_at,
  };
}

function publicConversation(row, options = {}) {
  const result = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name || '',
    ownerRole: row.owner_role || '',
    title: row.title,
    status: row.status,
    favorite: Boolean(row.favorite),
    scope: json(row.scope_json, {}),
    nativeSessionEngine: row.native_session_engine || '',
    rollingSummary: row.rolling_summary || '',
    messageCount: Number(row.message_count || 0),
    lastMessageAt: row.last_message_at || '',
    archivedAt: row.archived_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (options.messages) result.messages = (options.messages || []).map(publicMessage);
  return result;
}

function actorCanReadConversation(db, actor, row) {
  if (!actor?.id) return false;
  if (String(actor.role) === 'admin') return true;
  if (String(actor.id) === String(row.owner_user_id)) return true;
  return String(actor.role) === 'manager'
    && String(row.owner_role || '') === 'sales';
}

function actorCanMutateConversation(actor, row) {
  return Boolean(actor?.id)
    && (String(actor.role) === 'admin' || String(actor.id) === String(row.owner_user_id));
}

function safeScope(scope = {}) {
  const value = scope && typeof scope === 'object' ? scope : {};
  return {
    scope: ['view', 'all', 'customer'].includes(String(value.scope)) ? String(value.scope) : 'view',
    view: text(value.view, 80),
    customerId: text(value.customerId, 80),
    followId: text(value.followId, 80),
    jobId: text(value.jobId, 120),
  };
}

function safeList(value, limit = 30) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function normalizeTitle(value, fallback = '新对话') {
  const title = text(value, MAX_TITLE_LENGTH);
  return title || fallback;
}

function summarizeRows(rows) {
  const turns = rows.map(row => `${row.role === 'user' ? '用户' : 'AI'}：${text(row.content, 420)}`);
  return text(turns.join('\n'), 3500);
}

function createAssistantConversationStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('database is required');
  installAssistantConversationSchema(db);
  const idFactory = options.idFactory || id;
  const clock = options.now || now;
  const summaryBuilder = options.summaryBuilder || summarizeRows;

  function rowById(conversationId) {
    return db.prepare(`SELECT c.*,u.name owner_name,u.role owner_role,
      (SELECT COUNT(*) FROM assistant_conversation_messages m WHERE m.conversation_id=c.id) message_count
      FROM assistant_conversations c LEFT JOIN sales_users u ON u.id=c.owner_user_id
      WHERE c.id=?`).get(String(conversationId || ''));
  }

  function getForActor(conversationId, actor, options = {}) {
    const row = rowById(conversationId);
    if (!row || !actorCanReadConversation(db, actor, row)) return null;
    let messages;
    if (options.messages) {
      messages = db.prepare(`SELECT * FROM assistant_conversation_messages
        WHERE conversation_id=? ORDER BY sequence_no`).all(row.id);
    }
    return publicConversation(row, { messages });
  }

  function list(actor, options = {}) {
    if (!actor?.id) return [];
    const includeArchived = Boolean(options.includeArchived);
    const search = text(options.search, 100);
    const params = [];
    let where = includeArchived ? '1=1' : "c.status='active'";
    if (String(actor.role) === 'sales') {
      where += ' AND c.owner_user_id=?';
      params.push(actor.id);
    } else if (String(actor.role) === 'manager') {
      where += " AND (c.owner_user_id=? OR u.role='sales')";
      params.push(actor.id);
    }
    if (search) {
      where += ' AND (c.title LIKE ? OR c.rolling_summary LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    return db.prepare(`SELECT c.*,u.name owner_name,u.role owner_role,
      (SELECT COUNT(*) FROM assistant_conversation_messages m WHERE m.conversation_id=c.id) message_count
      FROM assistant_conversations c JOIN sales_users u ON u.id=c.owner_user_id
      WHERE ${where}
      ORDER BY c.favorite DESC,COALESCE(c.last_message_at,c.updated_at) DESC,c.id DESC LIMIT 200`).all(...params)
      .map(row => publicConversation(row));
  }

  function create(actor, input = {}) {
    if (!actor?.id) throw Object.assign(new Error('请先登录'), { statusCode: 401 });
    const at = clock();
    const conversationId = idFactory('ASSTC');
    const scope = safeScope(input.scope || {});
    db.prepare(`INSERT INTO assistant_conversations
      (id,owner_user_id,title,status,scope_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      conversationId, actor.id, normalizeTitle(input.title), 'active', JSON.stringify(scope), at, at,
    );
    return getForActor(conversationId, actor, { messages: true });
  }

  function prepare(conversationId, actor, input = {}) {
    let row = conversationId ? rowById(conversationId) : null;
    if (row && !actorCanReadConversation(db, actor, row)) {
      throw Object.assign(new Error('无权访问该 AI 会话'), { statusCode: 403, code: 'ASSISTANT_CONVERSATION_FORBIDDEN' });
    }
    if (row && row.status === 'archived') {
      throw Object.assign(new Error('该会话已归档'), { statusCode: 409, code: 'ASSISTANT_CONVERSATION_ARCHIVED' });
    }
    if (!row) {
      if (conversationId) throw Object.assign(new Error('AI 会话不存在'), { statusCode: 404, code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
      const created = create(actor, { scope: input.scope, title: input.title });
      row = rowById(created.id);
    }
    const messages = db.prepare(`SELECT * FROM assistant_conversation_messages
      WHERE conversation_id=? ORDER BY sequence_no DESC LIMIT ?`).all(row.id, RECENT_MESSAGE_LIMIT).reverse();
    return {
      conversation: publicConversation(row),
      conversationId: row.id,
      summary: row.rolling_summary || '',
      history: [
        ...(row.rolling_summary ? [{ role: 'system', content: `历史滚动摘要：${row.rolling_summary}` }] : []),
        ...messages.map(item => ({ role: item.role, content: item.content })),
      ],
      nativeSessionId: row.native_session_id || '',
      nativeSessionEngine: row.native_session_engine || '',
    };
  }

  function existingTurn(conversationId, clientMessageId) {
    if (!clientMessageId) return null;
    const row = db.prepare(`SELECT a.* FROM assistant_conversation_messages u
      JOIN assistant_conversation_messages a
        ON a.conversation_id=u.conversation_id AND a.sequence_no=u.sequence_no+1 AND a.role='assistant'
      WHERE u.conversation_id=? AND u.client_message_id=? AND u.role='user'
      ORDER BY u.sequence_no DESC LIMIT 1`).get(conversationId, clientMessageId);
    return row ? publicMessage(row) : null;
  }

  function appendTurn(conversationId, input = {}) {
    const row = rowById(conversationId);
    if (!row) throw Object.assign(new Error('AI 会话不存在'), { statusCode: 404 });
    const clientMessageId = text(input.clientMessageId, 160);
    const duplicate = existingTurn(conversationId, clientMessageId);
    if (duplicate) return { duplicate: true, assistantMessage: duplicate };
    const at = clock();
    const title = row.title === '新对话' ? normalizeTitle(input.message, row.title).slice(0, 48) : row.title;
    const userMessageId = idFactory('ASSTM');
    const assistantMessageId = idFactory('ASSTM');
    const nextSequence = Number(db.prepare(
      'SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM assistant_conversation_messages WHERE conversation_id=?',
    ).get(conversationId).next);
    const context = safeScope(input.context || {});
    const usage = input.result?.usage && typeof input.result.usage === 'object' ? input.result.usage : {};
    const cost = Number(input.result?.costUsd || usage.costUsd || usage.cost || 0) || 0;
    const insert = db.prepare(`INSERT INTO assistant_conversation_messages
      (id,conversation_id,sequence_no,client_message_id,role,content,context_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    const insertAssistant = db.prepare(`INSERT INTO assistant_conversation_messages
      (id,conversation_id,sequence_no,client_message_id,role,content,sources_json,matched_customers_json,
       actions_json,result_sets_json,context_json,retrieval_mode,engine,model,usage_json,cost_usd,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    try {
      db.transaction(() => {
        insert.run(userMessageId, conversationId, nextSequence, clientMessageId, 'user', text(input.message, 20000), JSON.stringify(context), at);
        insertAssistant.run(
          assistantMessageId, conversationId, nextSequence + 1, '', 'assistant',
          text(input.result?.answer, 30000), JSON.stringify(safeList(input.result?.sources)),
          JSON.stringify(safeList(input.result?.matchedCustomers)), JSON.stringify(safeList(input.result?.actions, 10)),
          JSON.stringify(safeList(input.result?.resultSets, 20)), JSON.stringify(context),
          text(input.result?.retrievalMode, 80), text(input.result?.engine, 80), text(input.result?.model, 160),
          JSON.stringify(usage), cost, at,
        );
        db.prepare(`UPDATE assistant_conversations
          SET title=?,scope_json=?,native_session_id=?,native_session_engine=?,last_message_at=?,updated_at=? WHERE id=?`).run(
          title,
          JSON.stringify(context),
          text(input.result?.sessionId, 160),
          text(input.result?.sessionEngine, 80),
          at,
          at,
          conversationId,
        );
      })();
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE')) {
        const retry = existingTurn(conversationId, clientMessageId);
        if (retry) return { duplicate: true, assistantMessage: retry };
      }
      throw error;
    }
    try {
      const count = Number(db.prepare('SELECT COUNT(*) n FROM assistant_conversation_messages WHERE conversation_id=?').get(conversationId).n);
      if (count >= SUMMARY_TRIGGER) {
        const oldRows = db.prepare(`SELECT role,content FROM assistant_conversation_messages
          WHERE conversation_id=? ORDER BY sequence_no ASC LIMIT ?`).all(conversationId, count - RECENT_MESSAGE_LIMIT);
        db.prepare(`UPDATE assistant_conversations SET rolling_summary=?,summary_message_count=?,updated_at=? WHERE id=?`)
          .run(summaryBuilder(oldRows), count - RECENT_MESSAGE_LIMIT, at, conversationId);
      }
    } catch (_error) {
      // Message persistence must remain successful when summary maintenance is unavailable.
    }
    return {
      duplicate: false,
      userMessageId,
      assistantMessage: publicMessage(db.prepare('SELECT * FROM assistant_conversation_messages WHERE id=?').get(assistantMessageId)),
    };
  }

  function setArchived(conversationId, actor, archived) {
    const row = rowById(conversationId);
    if (!row) throw Object.assign(new Error('AI 会话不存在'), { statusCode: 404 });
    if (!actorCanMutateConversation(actor, row)) {
      throw Object.assign(new Error('只有本人或管理员可以归档会话'), { statusCode: 403, code: 'ASSISTANT_CONVERSATION_MUTATION_FORBIDDEN' });
    }
    const at = clock();
    db.prepare(`UPDATE assistant_conversations SET status=?,archived_at=?,updated_at=? WHERE id=?`)
      .run(archived ? 'archived' : 'active', archived ? at : '', at, row.id);
    return getForActor(row.id, actor);
  }

  function rename(conversationId, actor, title) {
    const row = rowById(conversationId);
    if (!row) throw Object.assign(new Error('AI 会话不存在'), { statusCode: 404 });
    if (!actorCanMutateConversation(actor, row)) {
      throw Object.assign(new Error('只有本人或管理员可以重命名会话'), { statusCode: 403, code: 'ASSISTANT_CONVERSATION_MUTATION_FORBIDDEN' });
    }
    const at = clock();
    db.prepare('UPDATE assistant_conversations SET title=?,updated_at=? WHERE id=?')
      .run(normalizeTitle(title, row.title), at, row.id);
    return getForActor(row.id, actor);
  }

  function setFavorite(conversationId, actor, favorite) {
    const row = rowById(conversationId);
    if (!row) throw Object.assign(new Error('AI 会话不存在'), { statusCode: 404 });
    if (!actorCanMutateConversation(actor, row)) {
      throw Object.assign(new Error('只有本人或管理员可以收藏会话'), { statusCode: 403, code: 'ASSISTANT_CONVERSATION_MUTATION_FORBIDDEN' });
    }
    db.prepare('UPDATE assistant_conversations SET favorite=?,updated_at=? WHERE id=?')
      .run(favorite ? 1 : 0, clock(), row.id);
    return getForActor(row.id, actor);
  }

  function audit(actor, target, action) {
    try {
      db.prepare(`INSERT INTO crm_audit_log
        (id,user_id,action,entity_type,entity_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        idFactory('AUDIT'), actor?.id || '', action, 'assistant_conversation', target.id,
        JSON.stringify({ targetUserId: target.owner_user_id }), clock(),
      );
    } catch (_error) {
      // Audit failure must not expose conversation content or break a read.
    }
  }

  return {
    installSchema: () => installAssistantConversationSchema(db),
    rowById,
    getForActor,
    list,
    create,
    prepare,
    appendTurn,
    existingTurn,
    setArchived,
    rename,
    setFavorite,
    audit,
    actorCanReadConversation,
    actorCanMutateConversation,
  };
}

module.exports = {
  RECENT_MESSAGE_LIMIT,
  SUMMARY_TRIGGER,
  installAssistantConversationSchema,
  createAssistantConversationStore,
  publicMessage,
  publicConversation,
};

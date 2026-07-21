const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function databasePath() {
  return path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db'));
}
const DEFAULT_EMBEDDING_MODEL = 'qwen3-vl-embedding';
const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_EMBEDDING_BATCH_SIZE = 10;
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 200;

function getDb(readonly = false) {
  return new Database(databasePath(), readonly ? { readonly: true } : {});
}

function nowText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const clean = cleanText(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(clean.length, start + size);
    chunks.push(clean.slice(start, end));
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function reportUrl(jobId) {
  return jobId ? `/api/report?job_id=${encodeURIComponent(jobId)}` : '';
}

function makeDoc(base, chunk, chunkIndex) {
  const content = cleanText(chunk);
  const docKey = [
    base.doc_type,
    base.source_table,
    base.source_id,
    chunkIndex,
  ].join(':');
  return {
    doc_key: docKey,
    doc_type: base.doc_type,
    source_table: base.source_table,
    source_id: base.source_id,
    customer_id: base.customer_id || '',
    follow_id: base.follow_id || '',
    job_id: base.job_id || '',
    title: base.title || '',
    url: base.url || '',
    chunk_index: chunkIndex,
    content,
    content_hash: hashText(content),
    metadata_json: JSON.stringify(base.metadata || {}),
  };
}

function textBlock(title, pairs) {
  const lines = [title].filter(Boolean);
  pairs.forEach(([label, value]) => {
    const clean = cleanText(value);
    if (clean) lines.push(`${label}: ${clean}`);
  });
  return lines.join('\n');
}

function readReportText(reportPath) {
  const cleanPath = String(reportPath || '').trim();
  if (!cleanPath || !fs.existsSync(cleanPath)) return '';
  try {
    return cleanText(fs.readFileSync(cleanPath, 'utf8'));
  } catch (_e) {
    return '';
  }
}

function buildAssistantDocuments(db) {
  const docs = [];
  const addChunks = base => {
    chunkText(base.content).forEach((chunk, idx) => docs.push(makeDoc(base, chunk, idx)));
  };

  db.prepare('SELECT * FROM customer_pool ORDER BY customer_id').all().forEach(row => {
    addChunks({
      doc_type: 'customer_pool',
      source_table: 'customer_pool',
      source_id: row.customer_id,
      customer_id: row.customer_id,
      title: row.company_name || row.russian_name || row.english_name || row.customer_id,
      url: row.website || row.domain || '',
      metadata: { current_pool: row.current_pool, rating: row.rating, city: row.city },
      content: textBlock(`客户池 ${row.customer_id} ${row.company_name || ''}`, [
        ['俄文名称', row.russian_name],
        ['英文名称', row.english_name],
        ['城市', row.city],
        ['官网', row.website || row.domain],
        ['行业', row.industry],
        ['客户类型', row.customer_type],
        ['简介', row.description],
        ['产品/需求', row.products],
        ['评级/池子', [row.rating, row.current_pool].filter(Boolean).join(' / ')],
        ['联系方式', [row.email, row.phone].filter(Boolean).join(' / ')],
        ['INN', row.inn],
        ['风险', row.risk_status],
        ['备注', row.notes],
      ]),
    });
  });

  db.prepare('SELECT * FROM customers ORDER BY follow_id').all().forEach(row => {
    addChunks({
      doc_type: 'customer_followup',
      source_table: 'customers',
      source_id: row.follow_id,
      customer_id: row.customer_id,
      follow_id: row.follow_id,
      title: row.company_name || row.follow_id,
      url: row.website || '',
      metadata: { status: row.status, owner: row.owner, rating: row.rating },
      content: textBlock(`跟进客户 ${row.follow_id} ${row.company_name || ''}`, [
        ['客户ID', row.customer_id],
        ['官网', row.website],
        ['行业', row.industry],
        ['客户类型', row.customer_type],
        ['产品/需求', row.products],
        ['推荐理由', row.reason],
        ['联系方式', [row.contact, row.email, row.phone].filter(Boolean).join(' / ')],
        ['负责人/状态', [row.owner, row.status].filter(Boolean).join(' / ')],
        ['最近/下次跟进', [row.last_follow_date, row.next_follow_date].filter(Boolean).join(' / ')],
        ['客户反馈', row.feedback],
        ['下一步', row.next_action],
        ['备注', row.notes],
      ]),
    });
  });

  db.prepare('SELECT * FROM recon_results ORDER BY updated_at DESC').all().forEach(row => {
    addChunks({
      doc_type: 'recon_result',
      source_table: 'recon_results',
      source_id: row.job_id,
      customer_id: row.customer_id,
      job_id: row.job_id,
      title: row.company_name || row.customer_id || row.job_id,
      url: reportUrl(row.job_id),
      metadata: { score: row.score, compliance_status: row.compliance_status, sanctioned: row.sanctioned },
      content: textBlock(`Recon结果 ${row.customer_id} ${row.company_name || ''}`, [
        ['Job ID', row.job_id],
        ['官网', row.website],
        ['评分/优先级', [row.score, row.priority].filter(Boolean).join(' / ')],
        ['合规状态', [row.compliance_status, row.sanctioned, row.sanction_source, row.sanction_program].filter(Boolean).join(' / ')],
        ['机会摘要', row.opportunity_summary],
        ['联系人摘要', row.contacts_summary],
        ['推荐产品', row.recommended_products],
        ['外联角度', row.outreach_angle],
        ['下一步', row.next_action],
        ['证据URL', row.evidence_url],
      ]),
    });

    const reportText = readReportText(row.report_path);
    if (reportText) {
      addChunks({
        doc_type: 'recon_report',
        source_table: 'recon_results',
        source_id: `${row.job_id}:report`,
        customer_id: row.customer_id,
        job_id: row.job_id,
        title: `${row.company_name || row.customer_id || row.job_id} 报告正文`,
        url: reportUrl(row.job_id),
        metadata: { report_path: row.report_path },
        content: reportText,
      });
    }
  });

  db.prepare('SELECT * FROM recon_evidence ORDER BY id').all().forEach(row => {
    addChunks({
      doc_type: 'recon_evidence',
      source_table: 'recon_evidence',
      source_id: String(row.id),
      customer_id: row.customer_id,
      job_id: row.job_id,
      title: row.field_name || row.source_title || `证据 ${row.id}`,
      url: row.source_url || reportUrl(row.job_id),
      metadata: { confidence: row.confidence, extractor: row.extractor },
      content: textBlock(`Recon证据 ${row.customer_id} ${row.field_name || ''}`, [
        ['Job ID', row.job_id],
        ['字段', row.field_name],
        ['值', row.value],
        ['来源标题', row.source_title],
        ['来源URL', row.source_url],
        ['置信度', row.confidence],
        ['抽取器', row.extractor],
      ]),
    });
  });

  return docs;
}

function ensureAssistantTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_key TEXT NOT NULL UNIQUE,
      doc_type TEXT NOT NULL DEFAULT '',
      source_table TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      customer_id TEXT NOT NULL DEFAULT '',
      follow_id TEXT NOT NULL DEFAULT '',
      job_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS assistant_embeddings (
      document_id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 0,
      embedding BLOB NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (document_id) REFERENCES assistant_documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_assistant_documents_customer ON assistant_documents(customer_id);
    CREATE INDEX IF NOT EXISTS idx_assistant_documents_job ON assistant_documents(job_id);
    CREATE INDEX IF NOT EXISTS idx_assistant_documents_type ON assistant_documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_assistant_embeddings_model ON assistant_embeddings(provider, model, dimensions);
  `);
}

function assistantTablesExist(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('assistant_documents', 'assistant_embeddings')
  `).get();
  return Number(row?.total || 0) === 2;
}

function upsertDocuments(db, docs) {
  ensureAssistantTables(db);
  const now = nowText();
  const upsert = db.prepare(`
    INSERT INTO assistant_documents (
      doc_key, doc_type, source_table, source_id, customer_id, follow_id, job_id,
      title, url, chunk_index, content, content_hash, metadata_json, updated_at
    ) VALUES (
      @doc_key, @doc_type, @source_table, @source_id, @customer_id, @follow_id, @job_id,
      @title, @url, @chunk_index, @content, @content_hash, @metadata_json, @updated_at
    )
    ON CONFLICT(doc_key) DO UPDATE SET
      doc_type = excluded.doc_type,
      source_table = excluded.source_table,
      source_id = excluded.source_id,
      customer_id = excluded.customer_id,
      follow_id = excluded.follow_id,
      job_id = excluded.job_id,
      title = excluded.title,
      url = excluded.url,
      chunk_index = excluded.chunk_index,
      content = excluded.content,
      content_hash = excluded.content_hash,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const keys = new Set(docs.map(doc => doc.doc_key));
  const save = db.transaction(() => {
    docs.forEach(doc => upsert.run({ ...doc, updated_at: now }));
    if (keys.size) {
      const existing = db.prepare('SELECT doc_key FROM assistant_documents').all();
      const remove = db.prepare('DELETE FROM assistant_documents WHERE doc_key = ?');
      existing.forEach(row => {
        if (!keys.has(row.doc_key)) remove.run(row.doc_key);
      });
    }
  });
  save();
}

function embeddingDimensions() {
  const n = Number(process.env.EMBEDDING_DIMENSIONS || DEFAULT_EMBEDDING_DIMENSIONS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_EMBEDDING_DIMENSIONS;
}

function embeddingModel() {
  return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function embeddingBatchSize() {
  const n = Number(process.env.EMBEDDING_BATCH_SIZE || DEFAULT_EMBEDDING_BATCH_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : DEFAULT_EMBEDDING_BATCH_SIZE;
}

function normalizeVector(values) {
  const vector = Array.from(values || []).map(Number);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map(value => value / norm);
}

function vectorToBlob(values) {
  const normalized = normalizeVector(values);
  const buffer = Buffer.alloc(normalized.length * 4);
  normalized.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function blobToVector(blob) {
  if (!blob) return [];
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const vector = [];
  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) {
    vector.push(buffer.readFloatLE(offset));
  }
  return vector;
}

function dot(a, b) {
  const len = Math.min(a.length, b.length);
  let score = 0;
  for (let i = 0; i < len; i += 1) score += a[i] * b[i];
  return score;
}

function parseEmbeddingResponse(data) {
  const embeddings = data?.output?.embeddings || data?.data || data?.embeddings || [];
  return embeddings
    .map(item => item.embedding || item.vector || item)
    .filter(item => Array.isArray(item));
}

async function embedTexts(texts) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    const err = new Error('未配置 DASHSCOPE_API_KEY，无法构建或查询 Qwen 向量索引。');
    err.statusCode = 503;
    throw err;
  }
  const model = embeddingModel();
  const isMultimodal = model.includes('vl') || model.includes('multimodal');
  const apiUrl = isMultimodal
    ? 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding'
    : 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      input: isMultimodal
        ? { contents: texts.map(text => ({ text })) }
        : { texts: texts },
      parameters: {
        dimension: embeddingDimensions(),
      },
    }),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_e) {
    throw new Error(`Qwen embedding 返回了非 JSON 响应：${raw.slice(0, 180)}`);
  }
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `Qwen embedding 请求失败：${response.status}`);
  }
  const vectors = parseEmbeddingResponse(data);
  if (vectors.length !== texts.length) {
    throw new Error(`Qwen embedding 返回数量不匹配：请求 ${texts.length}，返回 ${vectors.length}`);
  }
  return vectors;
}

async function indexAssistantDocuments(options = {}) {
  const db = getDb(false);
  try {
    ensureAssistantTables(db);
    const docs = buildAssistantDocuments(db);
    upsertDocuments(db, docs);

    const provider = process.env.EMBEDDING_PROVIDER || 'qwen';
    const model = embeddingModel();
    const dimensions = embeddingDimensions();
    const pending = db.prepare(`
      SELECT d.id, d.content, d.content_hash
      FROM assistant_documents d
      LEFT JOIN assistant_embeddings e
        ON e.document_id = d.id
       AND e.provider = ?
       AND e.model = ?
       AND e.dimensions = ?
       AND e.content_hash = d.content_hash
      WHERE e.document_id IS NULL
      ORDER BY d.id
      LIMIT ?
    `).all(provider, model, dimensions, Number(options.limit || 100000));

    const saveEmbedding = db.prepare(`
      INSERT INTO assistant_embeddings (
        document_id, provider, model, dimensions, embedding, content_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        provider = excluded.provider,
        model = excluded.model,
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `);

    let embedded = 0;
    const batchSize = embeddingBatchSize();
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const vectors = await embedTexts(batch.map(row => row.content));
      const now = nowText();
      const tx = db.transaction(() => {
        batch.forEach((row, idx) => {
          saveEmbedding.run(row.id, provider, model, dimensions, vectorToBlob(vectors[idx]), row.content_hash, now);
          embedded += 1;
        });
      });
      tx();
    }

    return {
      ok: true,
      documents: docs.length,
      pending: pending.length,
      embedded,
      provider,
      model,
      dimensions,
    };
  } finally {
    db.close();
  }
}

function getIndexStats() {
  const db = getDb(false);
  try {
    ensureAssistantTables(db);
    const docs = db.prepare('SELECT COUNT(*) AS total FROM assistant_documents').get().total;
    const embeddings = db.prepare('SELECT COUNT(*) AS total FROM assistant_embeddings').get().total;
    return { documents: docs, embeddings };
  } finally {
    db.close();
  }
}

async function vectorSearch(query, options = {}) {
  const db = getDb(true);
  try {
    if (!assistantTablesExist(db)) {
      return { ok: false, reason: 'missing_index', results: [], provider: process.env.EMBEDDING_PROVIDER || 'qwen', model: embeddingModel(), dimensions: embeddingDimensions() };
    }
    const provider = process.env.EMBEDDING_PROVIDER || 'qwen';
    const model = embeddingModel();
    const dimensions = embeddingDimensions();
    const filters = [];
    const params = [provider, model, dimensions];
    const customerId = cleanText(options.customerId || options.followId);
    const jobId = cleanText(options.jobId);
    const allowedCustomerIds = Array.isArray(options.allowedCustomerIds)
      ? Array.from(new Set(options.allowedCustomerIds.map(cleanText).filter(Boolean)))
      : null;
    if (allowedCustomerIds) {
      if (!allowedCustomerIds.length) filters.push('0');
      else {
        filters.push(`d.customer_id IN (${allowedCustomerIds.map(() => '?').join(',')})`);
        params.push(...allowedCustomerIds);
      }
    }
    if (options.canViewRecon === false) filters.push("lower(d.doc_type) NOT LIKE '%recon%' AND lower(d.doc_type) NOT LIKE '%report%'");
    if (options.canViewContacts === false) filters.push("lower(d.doc_type) NOT LIKE '%contact%' AND lower(d.doc_type) NOT LIKE '%person%'");
    if (customerId) {
      filters.push('(d.customer_id = ? OR d.follow_id = ?)');
      params.push(customerId, customerId);
    }
    if (jobId) {
      filters.push('d.job_id = ?');
      params.push(jobId);
    }
    const rows = db.prepare(`
      SELECT d.*, e.embedding
      FROM assistant_documents d
      JOIN assistant_embeddings e ON e.document_id = d.id
      WHERE e.provider = ? AND e.model = ? AND e.dimensions = ?
      ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
    `).all(...params);
    if (!rows.length) {
      return { ok: false, reason: 'empty_index', results: [], provider, model, dimensions };
    }
    const [queryVectorRaw] = await embedTexts([query]);
    const queryVector = normalizeVector(queryVectorRaw);
    const limit = Math.max(1, Math.min(Number(options.limit || 8), 30));
    const minScore = Number(options.minScore || 0.18);
    const results = rows
      .map(row => ({
        id: row.id,
        doc_key: row.doc_key,
        doc_type: row.doc_type,
        customer_id: row.customer_id,
        follow_id: row.follow_id,
        job_id: row.job_id,
        title: row.title,
        url: row.url,
        content: row.content,
        score: dot(queryVector, blobToVector(row.embedding)),
        metadata: safeJson(row.metadata_json),
      }))
      .filter(row => row.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { ok: true, results, provider, model, dimensions };
  } finally {
    db.close();
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch (_e) {
    return {};
  }
}

module.exports = {
  ensureAssistantTables,
  buildAssistantDocuments,
  indexAssistantDocuments,
  vectorSearch,
  getIndexStats,
  embedTexts,
  cleanText,
  chunkText,
  vectorToBlob,
  blobToVector,
};

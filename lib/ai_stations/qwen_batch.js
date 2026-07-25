'use strict';

const crypto = require('node:crypto');
const { createAIBudgetStore } = require('./budgets');
const { createAIJobStore } = require('./jobs');
const { installAIStationSchema } = require('./schema');
const { onlineModelPolicy } = require('./model_policy');
const { asIso, parseJson, summarizeError } = require('./audit');

const BATCH_ELIGIBLE_STATIONS = Object.freeze([
  'customer_fit',
  'contact_readiness',
  'distribution_priority',
  'manager_anomaly',
  'sales_coaching',
]);
const BATCH_FORBIDDEN_STATIONS = Object.freeze([
  'assistant_chat',
  'next_action',
  'sales_match',
  'action_proposal',
]);
const TERMINAL_ITEM_STATES = new Set([
  'succeeded', 'review_required', 'failed', 'stale', 'requeued',
  'expired', 'cancelled', 'missing_usage', 'dead_letter',
]);

function batchError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function positiveInteger(value, fallback, name) {
  const selected = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < 1) throw new Error(`${name} must be a positive integer`);
  return selected;
}

function validTimezone(value) {
  const timezone = String(value || '').trim();
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    throw new Error('CRM_AI_QWEN_BATCH_TIMEZONE is invalid');
  }
}

function batchConfigurationFromEnvironment(env = process.env) {
  const schedule = String(env.CRM_AI_QWEN_BATCH_SCHEDULE || '02:00').trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule)) {
    throw new Error('CRM_AI_QWEN_BATCH_SCHEDULE must use HH:mm');
  }
  return Object.freeze({
    schedule,
    timezone: validTimezone(env.CRM_AI_QWEN_BATCH_TIMEZONE || 'Asia/Shanghai'),
    maxItems: positiveInteger(env.CRM_AI_QWEN_BATCH_MAX_ITEMS, 100, 'CRM_AI_QWEN_BATCH_MAX_ITEMS'),
    staleRequeueLimit: positiveInteger(
      env.CRM_AI_QWEN_BATCH_STALE_REQUEUE_LIMIT,
      2,
      'CRM_AI_QWEN_BATCH_STALE_REQUEUE_LIMIT',
    ),
    reserveInputTokens: positiveInteger(env.CRM_AI_QWEN_BATCH_RESERVE_INPUT_TOKENS, 3_000, 'reserveInputTokens'),
    reserveOutputTokens: positiveInteger(env.CRM_AI_QWEN_BATCH_RESERVE_OUTPUT_TOKENS, 1_500, 'reserveOutputTokens'),
  });
}

function localTimeParts(at, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(at));
  return Object.fromEntries(parts.filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
}

function withinSchedule(at, schedule, timezone, windowMinutes = 15) {
  const parts = localTimeParts(at, timezone);
  const [hour, minute] = schedule.split(':').map(Number);
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const target = hour * 60 + minute;
  return current >= target && current < target + windowMinutes;
}

function createPricingStore(db, options = {}) {
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);

  function upsertPricing(input) {
    const at = asIso(input.createdAt || now());
    const row = {
      id: String(input.id || idFactory('AIPC')),
      version: String(input.version || '').trim(),
      provider: String(input.provider || 'qwen').trim(),
      model: String(input.model || '').trim(),
      executionType: String(input.executionType || 'batch').trim(),
      currency: String(input.currency || 'CNY').trim().toUpperCase(),
      inputPerMillion: Number(input.inputPerMillion),
      outputPerMillion: Number(input.outputPerMillion),
      effectiveFrom: asIso(input.effectiveFrom || at),
      effectiveTo: input.effectiveTo ? asIso(input.effectiveTo) : '',
      promotionEndsAt: input.promotionEndsAt ? asIso(input.promotionEndsAt) : '',
    };
    if (!row.version || !row.model) throw new Error('pricing version and model are required');
    if (!['online', 'batch'].includes(row.executionType)) throw new Error('invalid pricing execution type');
    if (!['CNY', 'USD'].includes(row.currency)) throw new Error('invalid pricing currency');
    if (![row.inputPerMillion, row.outputPerMillion].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('pricing rates must be positive');
    }
    db.prepare(`INSERT INTO crm_ai_pricing_catalog
      (id,version,provider,model,execution_type,currency,input_per_million,output_per_million,
       effective_from,effective_to,promotion_ends_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(version,provider,model,execution_type) DO UPDATE SET
        currency=excluded.currency,input_per_million=excluded.input_per_million,
        output_per_million=excluded.output_per_million,effective_from=excluded.effective_from,
        effective_to=excluded.effective_to,promotion_ends_at=excluded.promotion_ends_at`)
      .run(row.id, row.version, row.provider, row.model, row.executionType, row.currency,
        row.inputPerMillion, row.outputPerMillion, row.effectiveFrom, row.effectiveTo,
        row.promotionEndsAt, at);
    return db.prepare(`SELECT * FROM crm_ai_pricing_catalog
      WHERE version=? AND provider=? AND model=? AND execution_type=?`)
      .get(row.version, row.provider, row.model, row.executionType);
  }

  function upsertFx(input) {
    const at = asIso(input.createdAt || now());
    const version = String(input.version || '').trim();
    const base = String(input.baseCurrency || 'CNY').trim().toUpperCase();
    const quote = String(input.quoteCurrency || 'USD').trim().toUpperCase();
    const rate = Number(input.rate);
    if (!version || !Number.isFinite(rate) || rate <= 0) throw new Error('valid FX version and rate are required');
    db.prepare(`INSERT INTO crm_ai_fx_rates
      (id,version,base_currency,quote_currency,rate,effective_from,effective_to,source,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(version) DO UPDATE SET base_currency=excluded.base_currency,
        quote_currency=excluded.quote_currency,rate=excluded.rate,effective_from=excluded.effective_from,
        effective_to=excluded.effective_to,source=excluded.source`)
      .run(String(input.id || idFactory('AIFX')), version, base, quote, rate,
        asIso(input.effectiveFrom || at), input.effectiveTo ? asIso(input.effectiveTo) : '',
        String(input.source || ''), at);
    return db.prepare('SELECT * FROM crm_ai_fx_rates WHERE version=?').get(version);
  }

  function quote(input) {
    const at = asIso(input.at || now());
    const pricing = db.prepare(`SELECT * FROM crm_ai_pricing_catalog
      WHERE provider=? AND model=? AND execution_type=? AND effective_from<=?
        AND (effective_to='' OR effective_to>?)
        AND (promotion_ends_at='' OR promotion_ends_at>?)
      ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1`)
      .get(String(input.provider || 'qwen'), String(input.model || ''), String(input.executionType || 'batch'), at, at, at);
    if (!pricing) throw batchError(
      `No active pricing for ${input.model}`,
      'AI_BATCH_PRICING_MISSING',
      409,
    );
    const inputTokens = positiveInteger(input.inputTokens, 1, 'inputTokens');
    const outputTokens = positiveInteger(input.outputTokens, 1, 'outputTokens');
    const originalCost = (
      inputTokens * Number(pricing.input_per_million)
      + outputTokens * Number(pricing.output_per_million)
    ) / 1_000_000;
    let usdCost = originalCost;
    let fx = null;
    if (pricing.currency === 'CNY') {
      fx = db.prepare(`SELECT * FROM crm_ai_fx_rates
        WHERE base_currency='CNY' AND quote_currency='USD' AND effective_from<=?
          AND (effective_to='' OR effective_to>?)
        ORDER BY effective_from DESC,created_at DESC,id DESC LIMIT 1`).get(at, at);
      if (!fx) throw batchError('No active CNY to USD FX policy', 'AI_BATCH_FX_MISSING', 409);
      usdCost = originalCost * Number(fx.rate);
    }
    return Object.freeze({
      pricingVersion: pricing.version,
      fxVersion: fx?.version || 'USD-identity',
      originalCost,
      originalCurrency: pricing.currency,
      usdCost,
      inputTokens,
      outputTokens,
    });
  }

  return Object.freeze({ upsertPricing, upsertFx, quote });
}

function providerError(message, status, requestId = '') {
  const error = batchError(message, status === 429 ? 'QWEN_BATCH_RATE_LIMITED'
    : status >= 500 ? 'QWEN_BATCH_PROVIDER_ERROR'
      : [401, 403].includes(status) ? 'QWEN_BATCH_AUTH_ERROR' : 'QWEN_BATCH_REQUEST_ERROR', status);
  error.requestId = requestId;
  return error;
}

function normalizeBatchBaseUrl(value) {
  return String(value || 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    .trim().replace(/\/+$/, '').replace(/\/batches$/, '');
}

function parseJsonLines(value, fileId) {
  const rows = [];
  for (const [index, line] of String(value || '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (_error) {
      throw batchError(
        `Qwen Batch result file ${fileId} has invalid JSON on line ${index + 1}`,
        'QWEN_BATCH_INVALID_RESPONSE',
        502,
      );
    }
  }
  return rows;
}

function normalizeRemoteItem(row, failed = false) {
  const response = row?.response && typeof row.response === 'object' ? row.response : {};
  const body = response.body && typeof response.body === 'object' ? response.body : {};
  const statusCode = Number(response.status_code || 0);
  const error = row?.error || body?.error || null;
  const succeeded = !failed && !error && statusCode >= 200 && statusCode < 300;
  return {
    custom_id: String(row?.custom_id || ''),
    id: String(row?.id || body?.id || ''),
    requestId: String(response.request_id || body.request_id || ''),
    status: succeeded ? 'succeeded' : 'failed',
    usage: body.usage,
    response: body,
    error,
  };
}

function createQwenBatchProvider(options = {}) {
  const apiKey = String(options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '').trim();
  const baseUrl = normalizeBatchBaseUrl(
    options.baseUrl
      || options.endpoint
      || process.env.QWEN_BATCH_BASE_URL
      || process.env.QWEN_BATCH_ENDPOINT,
  );
  const fetchImpl = options.fetch || global.fetch;
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? process.env.QWEN_BATCH_TIMEOUT_MS,
    30_000,
    'QWEN_BATCH_TIMEOUT_MS',
  );
  const completionWindow = String(
    options.completionWindow || process.env.QWEN_BATCH_COMPLETION_WINDOW || '24h',
  ).trim();

  async function request(path, requestOptions = {}) {
    if (!apiKey) throw batchError('DASHSCOPE_API_KEY is required for Qwen Batch', 'QWEN_NOT_CONFIGURED', 503);
    const controller = new AbortController();
    const externalSignal = requestOptions.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const body = requestOptions.form
        || (requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body));
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: requestOptions.method || 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(requestOptions.form ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      const text = await response.text();
      const requestId = String(response.headers?.get?.('x-request-id') || '');
      if (!response.ok) {
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (_error) { /* use status below */ }
        throw providerError(
          String(data?.error?.message || data?.message || `Qwen Batch failed: ${response.status}`).slice(0, 300),
          response.status,
          String(data?.request_id || requestId),
        );
      }
      if (requestOptions.responseType === 'text') return text;
      try {
        const data = text ? JSON.parse(text) : {};
        return { ...data, requestId: String(data.request_id || requestId) };
      } catch (_error) {
        throw providerError('Qwen Batch returned invalid JSON', 502, requestId);
      }
    } catch (caught) {
      if (caught?.code && String(caught.code).startsWith('QWEN_')) throw caught;
      if (caught?.name === 'AbortError' || controller.signal.aborted) {
        if (!timedOut && externalSignal?.aborted) {
          throw batchError('Qwen Batch request was cancelled', 'QWEN_BATCH_CANCELLED', 499);
        }
        throw batchError('Qwen Batch request timed out', 'QWEN_BATCH_TIMEOUT', 504);
      }
      throw batchError('Qwen Batch network request failed', 'QWEN_BATCH_NETWORK_ERROR', 502);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abortFromCaller);
    }
  }

  async function upload(items, input = {}) {
    const content = `${items.map(item => JSON.stringify(item)).join('\n')}\n`;
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append('file', new Blob([content], { type: 'application/jsonl' }), 'tradepulse-qwen-batch.jsonl');
    const file = await request('/files', { method: 'POST', form, signal: input.signal });
    if (!String(file.id || '').trim()) {
      throw batchError('Qwen Batch upload response is missing file ID', 'QWEN_BATCH_INVALID_RESPONSE', 502);
    }
    return file;
  }

  async function download(fileId, signal) {
    if (!String(fileId || '').trim()) return [];
    const content = await request(`/files/${encodeURIComponent(fileId)}/content`, {
      responseType: 'text',
      signal,
    });
    return parseJsonLines(content, fileId);
  }

  async function submit(items, input = {}) {
    const file = await upload(items, input);
    const batch = await request('/batches', {
      method: 'POST',
      signal: input.signal,
      body: {
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: completionWindow,
        metadata: { tradepulse_idempotency_key: String(input.idempotencyKey || '') },
      },
    });
    return { ...batch, input_file_id: String(batch.input_file_id || file.id) };
  }

  async function findByIdempotencyKey(key) {
    const result = await request('/batches?limit=100');
    const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.batches) ? result.batches : [];
    const found = rows.find(row => String(row?.metadata?.tradepulse_idempotency_key || '') === String(key || ''));
    if (!found) throw providerError('Qwen Batch idempotency key was not found', 404);
    return found;
  }

  async function poll(id, input = {}) {
    const batch = await request(`/batches/${encodeURIComponent(id)}`, { signal: input.signal });
    const outputRows = await download(batch.output_file_id, input.signal);
    const errorRows = await download(batch.error_file_id, input.signal);
    return {
      ...batch,
      items: [
        ...outputRows.map(row => normalizeRemoteItem(row)),
        ...errorRows.map(row => normalizeRemoteItem(row, true)),
      ],
    };
  }

  return Object.freeze({
    submit,
    findByIdempotencyKey,
    poll,
    cancel: id => request(`/batches/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  });
}

function createQwenBatchCoordinator(db, options = {}) {
  installAIStationSchema(db);
  const config = { ...batchConfigurationFromEnvironment(options.env || process.env), ...(options.config || {}) };
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);
  const jobs = options.jobs || createAIJobStore(db, options.jobStoreOptions);
  const budgets = options.budgets || createAIBudgetStore(db, options.budgetOptions);
  const pricing = options.pricing || createPricingStore(db, { now, idFactory });
  const provider = options.provider;
  const workerId = String(options.workerId || `qwen-batch-${process.pid}`);

  function timestamp() {
    return asIso(now());
  }

  function enabled() {
    return typeof options.enabled === 'function' ? Boolean(options.enabled()) : Boolean(options.enabled);
  }

  function candidateRows(limit = config.maxItems) {
    const at = timestamp();
    return db.prepare(`SELECT * FROM crm_ai_jobs
      WHERE execution_mode='batch_eligible' AND control_state=''
        AND state IN ('queued','retry_wait') AND next_run_at<=?
        AND (batch_not_before='' OR batch_not_before<=?)
        AND NOT EXISTS (
          SELECT 1 FROM crm_ai_job_dependencies d
          JOIN crm_ai_jobs parent ON parent.id=d.depends_on_job_id
          WHERE d.job_id=crm_ai_jobs.id
            AND (CASE WHEN parent.control_state IN ('blocked','cancel_requested','cancelled')
              THEN parent.control_state ELSE parent.state END) != d.required_state
        )
      ORDER BY priority DESC,queued_at,created_at,id LIMIT ?`).all(at, at, limit)
      .filter(row => BATCH_ELIGIBLE_STATIONS.includes(row.station));
  }

  function snapshotFor(job) {
    const supplied = typeof options.snapshotForJob === 'function'
      ? options.snapshotForJob(job)
      : {
        contextHash: job.contextHash,
        evidenceIds: job.input.evidenceIds || [],
        request: job.input.batchRequest || {},
      };
    if (!supplied || supplied.contextHash !== job.contextHash) {
      throw batchError('Batch job context is stale before submission', 'AI_BATCH_CONTEXT_STALE', 409);
    }
    if (!Array.isArray(supplied.evidenceIds)) {
      throw batchError('Batch evidence IDs are required', 'AI_BATCH_EVIDENCE_REQUIRED', 409);
    }
    return supplied;
  }

  function groupCandidates(rows) {
    const groups = new Map();
    for (const row of rows) {
      const model = onlineModelPolicy(row.station, options.modelPolicy).qwen;
      const key = `${model}\0v1\0v1`;
      if (!groups.has(key)) groups.set(key, { model, promptVersion: 'v1', schemaVersion: 'v1', rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }

  function createRun(group, claimed) {
    const at = timestamp();
    const identity = crypto.createHash('sha256')
      .update(claimed.map(item => `${item.job.id}:${item.job.contextHash}`).sort().join('|'))
      .digest('hex');
    const key = `qwen-batch:${group.model}:v1:${identity}`;
    const existing = db.prepare('SELECT * FROM crm_ai_batch_runs WHERE idempotency_key=?').get(key);
    if (existing) return existing;
    const runId = idFactory('AIBATCH');
    const quote = claimed[0].quote;
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO crm_ai_batch_runs
        (id,provider,idempotency_key,state,model,prompt_version,schema_version,pricing_version,
         fx_version,schedule,timezone,item_count,created_at,updated_at)
        VALUES (?,'qwen',?,'reserving',?,?,?,?,?,?,?,?,?,?)`).run(
        runId, key, group.model, group.promptVersion, group.schemaVersion,
        quote.pricingVersion, quote.fxVersion, config.schedule, config.timezone,
        claimed.length, at, at,
      );
      claimed.forEach((item, index) => db.prepare(`INSERT INTO crm_ai_batch_items
        (id,run_id,job_id,custom_id,state,station,model,prompt_version,schema_version,context_hash,
         evidence_ids_json,idempotency_key,reservation_id,reserved_micros,pricing_version,fx_version,
         created_at,updated_at)
        VALUES (?,?,?,?,'reserved',?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        idFactory('AIBI'), runId, item.job.id, `${runId}:${index + 1}`, item.job.station,
        group.model, group.promptVersion, group.schemaVersion, item.job.contextHash,
        JSON.stringify(item.snapshot.evidenceIds), `${key}:item:${item.job.id}`,
        item.reservation.id, item.reservation.reserved_micros, item.quote.pricingVersion,
        item.quote.fxVersion, at, at,
      ));
    });
    transaction.immediate();
    return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(runId);
  }

  async function submitGroup(group, submitOptions = {}) {
    const claimed = [];
    for (const row of group.rows) {
      const job = jobs.claimById(row.id, workerId);
      if (!job) continue;
      try {
        if (typeof options.authorizeJob === 'function') await options.authorizeJob(job);
        const snapshot = snapshotFor(job);
        const quote = pricing.quote({
          provider: 'qwen',
          model: group.model,
          executionType: 'batch',
          inputTokens: snapshot.estimatedInputTokens || config.reserveInputTokens,
          outputTokens: snapshot.estimatedOutputTokens || config.reserveOutputTokens,
        });
        const reservation = budgets.reserve({
          jobId: job.id,
          attempt: job.attempts,
          actorId: job.createdBy,
          teamId: snapshot.teamId,
          station: job.station,
          maxEngineAttempts: 1,
          estimatedCost: quote.usdCost,
        });
        claimed.push({ job, snapshot, quote, reservation });
      } catch (error) {
        const current = jobs.getJob(job.id);
        if (current?.state === 'running' && current.leaseOwner === workerId) jobs.fail(job.id, workerId, error);
        throw error;
      }
    }
    if (!claimed.length) return null;
    const run = createRun(group, claimed);
    if (submitOptions.dryRun) return { ...run, dryRun: true };
    if (!provider) throw new Error('Qwen Batch provider is required');
    const items = db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=? ORDER BY id').all(run.id);
    let remote;
    try {
      remote = await provider.submit(items.map((item, index) => ({
        custom_id: item.custom_id,
        method: 'POST',
        url: '/chat/completions',
        body: {
          model: item.model,
          messages: claimed[index]?.snapshot?.request?.messages || [],
          response_format: { type: 'json_object' },
        },
      })), { idempotencyKey: run.idempotency_key, signal: submitOptions.signal });
    } catch (error) {
      const recoverable = ['QWEN_BATCH_NETWORK_ERROR', 'QWEN_BATCH_TIMEOUT', 'QWEN_BATCH_PROVIDER_ERROR']
        .includes(String(error?.code || ''));
      if (!recoverable || typeof provider.findByIdempotencyKey !== 'function') throw error;
      try {
        remote = await provider.findByIdempotencyKey(run.idempotency_key);
      } catch (lookupError) {
        if (Number(lookupError?.statusCode) === 404) throw error;
        throw lookupError;
      }
    }
    const providerBatchId = String(remote.id || remote.batch_id || '').trim();
    if (!providerBatchId) throw batchError('Qwen Batch response is missing batch ID', 'QWEN_BATCH_INVALID_RESPONSE', 502);
    const at = timestamp();
    db.transaction(() => {
      db.prepare(`UPDATE crm_ai_batch_runs SET provider_batch_id=?,provider_input_file_id=?,
        state='submitted',submitted_at=?,expires_at=?,updated_at=? WHERE id=?`)
        .run(providerBatchId, String(remote.input_file_id || ''), at, String(remote.expires_at || ''), at, run.id);
      db.prepare(`UPDATE crm_ai_batch_items SET state='submitted',submitted_at=?,updated_at=?
        WHERE run_id=? AND state='reserved'`).run(at, at, run.id);
    }).immediate();
    return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
  }

  async function resumeSubmission(runId, input = {}) {
    const run = db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(String(runId || ''));
    if (!run) throw batchError('Batch run not found', 'AI_BATCH_NOT_FOUND', 404);
    if (run.state !== 'reserving') return run;
    if (!provider) throw new Error('Qwen Batch provider is required');
    const items = db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=? ORDER BY id').all(run.id);
    let remote = null;
    if (typeof provider.findByIdempotencyKey === 'function') {
      try { remote = await provider.findByIdempotencyKey(run.idempotency_key); }
      catch (error) {
        if (![404, 409].includes(Number(error?.statusCode))) throw error;
      }
    }
    if (!remote) {
      const requests = [];
      for (const item of items) {
        const job = jobs.getJob(item.job_id);
        if (!job || job.state !== 'running' || job.leaseOwner !== workerId) {
          throw batchError('Batch reservation lease cannot be resumed by this worker', 'AI_BATCH_LEASE_NOT_OWNED', 409);
        }
        if (typeof options.authorizeJob === 'function') await options.authorizeJob(job);
        const snapshot = snapshotFor(job);
        requests.push({
          custom_id: item.custom_id,
          method: 'POST',
          url: '/chat/completions',
          body: {
            model: item.model,
            messages: snapshot.request?.messages || [],
            response_format: { type: 'json_object' },
          },
        });
      }
      remote = await provider.submit(requests, {
        idempotencyKey: run.idempotency_key,
        signal: input.signal,
      });
    }
    const providerBatchId = String(remote.id || remote.batch_id || '').trim();
    if (!providerBatchId) throw batchError('Qwen Batch response is missing batch ID', 'QWEN_BATCH_INVALID_RESPONSE', 502);
    const at = timestamp();
    db.transaction(() => {
      db.prepare(`UPDATE crm_ai_batch_runs SET provider_batch_id=?,provider_input_file_id=?,
        state='submitted',submitted_at=?,expires_at=?,updated_at=? WHERE id=? AND state='reserving'`)
        .run(providerBatchId, String(remote.input_file_id || ''), at, String(remote.expires_at || ''), at, run.id);
      db.prepare(`UPDATE crm_ai_batch_items SET state='submitted',submitted_at=?,updated_at=?
        WHERE run_id=? AND state='reserved'`).run(at, at, run.id);
    }).immediate();
    return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
  }

  async function submitReady(input = {}) {
    const rows = candidateRows(input.limit);
    const preview = groupCandidates(rows).map(group => ({
      model: group.model,
      jobIds: group.rows.map(row => row.id),
      count: group.rows.length,
    }));
    if (input.dryRun) return Object.freeze({ dryRun: true, schedule: config.schedule, timezone: config.timezone, groups: preview });
    if (!enabled()) throw batchError('Qwen Batch is disabled', 'AI_BATCH_DISABLED', 409);
    if (!input.ignoreSchedule && !withinSchedule(now(), config.schedule, config.timezone)) {
      return Object.freeze({ skipped: true, reason: 'outside_schedule', groups: preview });
    }
    const runs = [];
    for (const group of groupCandidates(rows)) {
      const run = await submitGroup(group, input);
      if (run) runs.push(run);
    }
    return Object.freeze({ skipped: false, runs });
  }

  function settleItem(item, remote) {
    const usage = remote.usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
      throw batchError('Provider usage is missing; manual reconciliation is required', 'AI_BATCH_USAGE_MISSING', 409);
    }
    const pricingRow = db.prepare(`SELECT currency,input_per_million,output_per_million
      FROM crm_ai_pricing_catalog
      WHERE version=? AND provider='qwen' AND model=? AND execution_type='batch'`)
      .get(item.pricing_version, item.model);
    if (!pricingRow) throw batchError('Batch pricing version is unavailable', 'AI_BATCH_PRICING_MISSING', 409);
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens);
    if (![inputTokens, outputTokens].every(value => Number.isFinite(value) && value >= 0)) {
      throw batchError('Provider token usage is incomplete', 'AI_BATCH_USAGE_MISSING', 409);
    }
    const suppliedCost = Number(remote.originalCost ?? remote.cost_cny);
    const originalCost = Number.isFinite(suppliedCost) && suppliedCost >= 0
      ? suppliedCost
      : (
        inputTokens * Number(pricingRow.input_per_million)
        + outputTokens * Number(pricingRow.output_per_million)
      ) / 1_000_000;
    let usdCost = originalCost;
    if (pricingRow.currency === 'CNY') {
      const fx = db.prepare('SELECT rate FROM crm_ai_fx_rates WHERE version=?').get(item.fx_version);
      if (!fx) throw batchError('Batch FX version is unavailable', 'AI_BATCH_FX_MISSING', 409);
      usdCost *= Number(fx.rate);
    }
    const settlement = budgets.settle(item.reservation_id, [{
      engine: 'qwen',
      model: item.model,
      status: 'succeeded',
      usage,
      cost: usdCost,
    }]);
    return { usage, originalCost, originalCurrency: pricingRow.currency, usdCost, settlement };
  }

  async function importRemoteItem(run, item, remote) {
    if (TERMINAL_ITEM_STATES.has(item.state)) return item;
    const job = jobs.getJob(item.job_id);
    if (!job) throw batchError('Batch job no longer exists', 'AI_BATCH_JOB_MISSING', 409);
    if (job.state === 'cancelled' || job.state === 'cancel_requested' || run.state === 'cancel_requested') {
      let charged = null;
      try { charged = settleItem(item, remote); }
      catch (_error) { budgets.release(item.reservation_id, 'cancelled batch result has no reconcilable usage'); }
      db.prepare(`UPDATE crm_ai_batch_items SET state=?,usage_json=?,original_cost=?,
        original_currency=?,converted_cost_usd=?,response_json=?,error_summary=?,imported_at=?,updated_at=?
        WHERE id=?`).run(
        charged ? 'cancelled' : 'missing_usage',
        JSON.stringify(charged?.usage || {}),
        charged?.originalCost ?? null,
        charged?.originalCurrency || '',
        charged?.usdCost ?? null,
        JSON.stringify(remote || {}),
        charged ? 'late result discarded after cancellation' : 'late result usage requires reconciliation',
        timestamp(), timestamp(), item.id,
      );
      if (job.state === 'cancel_requested' && job.leaseOwner === workerId) jobs.completeCancellation(job.id, workerId);
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    if (remote.status === 'failed') {
      budgets.release(item.reservation_id, summarizeError(remote.error || 'provider item failed'));
      jobs.fail(job.id, workerId, batchError('Qwen Batch item failed', 'QWEN_BATCH_ITEM_FAILED', 502));
      db.prepare(`UPDATE crm_ai_batch_items SET state='failed',error_summary=?,response_json=?,
        imported_at=?,updated_at=? WHERE id=?`).run(
        summarizeError(remote.error || 'provider item failed'), JSON.stringify(remote), timestamp(), timestamp(), item.id,
      );
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    let charged;
    try {
      charged = settleItem(item, remote);
    } catch (error) {
      db.prepare(`UPDATE crm_ai_batch_items SET state='missing_usage',error_summary=?,response_json=?,
        imported_at=?,updated_at=? WHERE id=?`).run(
        summarizeError(error), JSON.stringify(remote || {}), timestamp(), timestamp(), item.id,
      );
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    let current;
    try {
      if (typeof options.authorizeJob === 'function') await options.authorizeJob(job);
      current = typeof options.currentSnapshot === 'function'
        ? await options.currentSnapshot(job, item)
        : { contextHash: job.contextHash, evidenceIds: parseJson(item.evidence_ids_json, []) };
    } catch (error) {
      const currentJob = jobs.getJob(job.id);
      if (currentJob?.state === 'running' && currentJob.leaseOwner === workerId) {
        jobs.fail(job.id, workerId, error);
      }
      db.prepare(`UPDATE crm_ai_batch_items SET state='failed',usage_json=?,original_cost=?,
        original_currency=?,converted_cost_usd=?,response_json=?,error_summary=?,imported_at=?,updated_at=?
        WHERE id=?`).run(JSON.stringify(charged.usage), charged.originalCost, charged.originalCurrency,
        charged.usdCost, JSON.stringify(remote), summarizeError(error), timestamp(), timestamp(), item.id);
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    const submittedEvidence = parseJson(item.evidence_ids_json, []);
    const stale = current?.contextHash !== item.context_hash
      || JSON.stringify([...(current?.evidenceIds || [])].sort()) !== JSON.stringify([...submittedEvidence].sort());
    if (stale) {
      const count = Number(job.staleRequeueCount || 0) + 1;
      db.prepare('UPDATE crm_ai_jobs SET stale_requeue_count=? WHERE id=?').run(count, job.id);
      const error = batchError('Batch result is stale', 'AI_BATCH_RESULT_STALE', 409);
      jobs.fail(job.id, workerId, error);
      const state = count > config.staleRequeueLimit ? 'dead_letter' : 'stale';
      if (state === 'dead_letter') {
        db.prepare(`UPDATE crm_ai_jobs SET state='dead_letter',next_run_at=?,finished_at=?,
          queued_at='',error_summary=?,updated_at=?
          WHERE id=? AND state='retry_wait'`).run(
            timestamp(), timestamp(), 'Batch result exceeded stale requeue limit', timestamp(), job.id,
          );
      } else {
        const nextInput = { ...job.input, evidenceIds: [...(current?.evidenceIds || [])] };
        db.prepare(`UPDATE crm_ai_jobs SET context_hash=?,input_json=?,updated_at=?
          WHERE id=? AND state='retry_wait' AND control_state=''`)
          .run(current.contextHash, JSON.stringify(nextInput), timestamp(), job.id);
      }
      db.prepare(`UPDATE crm_ai_batch_items SET state=?,usage_json=?,original_cost=?,
        original_currency=?,converted_cost_usd=?,response_json=?,error_summary=?,imported_at=?,updated_at=?
        WHERE id=?`).run(state, JSON.stringify(charged.usage), charged.originalCost,
        charged.originalCurrency, charged.usdCost, JSON.stringify(remote), summarizeError(error),
        timestamp(), timestamp(), item.id);
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    let importState = 'review_required';
    try {
      if (typeof options.validateResult === 'function') await options.validateResult(job, remote.response, current, item);
      if (typeof options.importResult === 'function') {
        const imported = await options.importResult({ job, item, remote, current, workerId, jobs, budgets });
        importState = imported?.state === 'succeeded' ? 'succeeded' : 'review_required';
      } else {
        jobs.complete(job.id, workerId, { state: 'needs_review' });
      }
    } catch (error) {
      const currentJob = jobs.getJob(job.id);
      if (currentJob?.state === 'running' && currentJob.leaseOwner === workerId) {
        jobs.fail(job.id, workerId, error);
      }
      db.prepare(`UPDATE crm_ai_batch_items SET state='failed',usage_json=?,original_cost=?,
        original_currency=?,converted_cost_usd=?,response_json=?,error_summary=?,imported_at=?,updated_at=?
        WHERE id=?`).run(JSON.stringify(charged.usage), charged.originalCost, charged.originalCurrency,
        charged.usdCost, JSON.stringify(remote), summarizeError(error), timestamp(), timestamp(), item.id);
      return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
    }
    db.prepare(`UPDATE crm_ai_batch_items SET state=?,provider_item_id=?,usage_json=?,original_cost=?,
      original_currency=?,converted_cost_usd=?,response_json=?,imported_at=?,updated_at=? WHERE id=?`)
      .run(importState, String(remote.id || remote.item_id || ''), JSON.stringify(charged.usage),
        charged.originalCost, charged.originalCurrency, charged.usdCost, JSON.stringify(remote),
        timestamp(), timestamp(), item.id);
    return db.prepare('SELECT * FROM crm_ai_batch_items WHERE id=?').get(item.id);
  }

  async function pollAndImport(runId) {
    const run = db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(String(runId || ''));
    if (!run) throw batchError('Batch run not found', 'AI_BATCH_NOT_FOUND', 404);
    if (!run.provider_batch_id) throw batchError('Batch run was not submitted', 'AI_BATCH_NOT_SUBMITTED', 409);
    const remote = await provider.poll(run.provider_batch_id);
    db.prepare(`UPDATE crm_ai_batch_runs SET provider_input_file_id=COALESCE(NULLIF(?,''),provider_input_file_id),
      provider_output_file_id=COALESCE(NULLIF(?,''),provider_output_file_id),
      provider_error_file_id=COALESCE(NULLIF(?,''),provider_error_file_id),updated_at=? WHERE id=?`)
      .run(String(remote.input_file_id || ''), String(remote.output_file_id || ''),
        String(remote.error_file_id || ''), timestamp(), run.id);
    if (['expired', 'cancelled', 'failed'].includes(remote.status)) {
      const state = remote.status === 'failed' ? 'dead_letter' : remote.status;
      const items = db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=?').all(run.id);
      for (const item of items.filter(value => !TERMINAL_ITEM_STATES.has(value.state))) {
        budgets.release(item.reservation_id, `batch ${remote.status}`);
        const job = jobs.getJob(item.job_id);
        if (job?.state === 'running' && job.leaseOwner === workerId) jobs.fail(job.id, workerId, batchError(`Batch ${remote.status}`, 'QWEN_BATCH_TERMINAL', 502));
        db.prepare(`UPDATE crm_ai_batch_items SET state=?,error_summary=?,updated_at=? WHERE id=?`)
          .run(remote.status === 'cancelled' ? 'cancelled' : remote.status === 'expired' ? 'expired' : 'dead_letter',
            `batch ${remote.status}`, timestamp(), item.id);
      }
      db.prepare('UPDATE crm_ai_batch_runs SET state=?,finished_at=?,updated_at=? WHERE id=?')
        .run(state, timestamp(), timestamp(), run.id);
      return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
    }
    if (!['completed', 'succeeded', 'partial_failed'].includes(remote.status)) {
      db.prepare(`UPDATE crm_ai_batch_runs SET state='running',updated_at=? WHERE id=?`).run(timestamp(), run.id);
      for (const item of db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=?').all(run.id)) {
        const job = jobs.getJob(item.job_id);
        if (job?.state === 'running' && job.leaseOwner === workerId) {
          try { jobs.heartbeat(job.id, workerId); } catch (_error) { /* lease recovery remains authoritative */ }
        }
      }
      return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
    }
    db.prepare(`UPDATE crm_ai_batch_runs SET state='importing',updated_at=? WHERE id=?`).run(timestamp(), run.id);
    const byCustomId = new Map((remote.items || []).map(item => [String(item.custom_id || item.customId), item]));
    const items = db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=? ORDER BY id').all(run.id);
    for (const item of items) {
      const remoteItem = byCustomId.get(item.custom_id);
      if (!remoteItem && !TERMINAL_ITEM_STATES.has(item.state)) {
        db.prepare(`UPDATE crm_ai_batch_items SET state='missing_usage',
          error_summary='provider result files omitted this item',imported_at=?,updated_at=? WHERE id=?`)
          .run(timestamp(), timestamp(), item.id);
        continue;
      }
      if (!remoteItem) continue;
      await importRemoteItem(run, item, remoteItem);
    }
    const states = db.prepare('SELECT state FROM crm_ai_batch_items WHERE run_id=?').all(run.id).map(item => item.state);
    const failures = states.some(state => ['failed', 'stale', 'expired', 'missing_usage', 'dead_letter'].includes(state));
    const reviews = states.some(state => state === 'review_required');
    const finalState = failures ? 'partial_failed' : reviews ? 'review_required' : 'succeeded';
    db.prepare('UPDATE crm_ai_batch_runs SET state=?,finished_at=?,updated_at=? WHERE id=?')
      .run(finalState, timestamp(), timestamp(), run.id);
    return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
  }

  async function cancel(runId) {
    const run = db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(String(runId || ''));
    if (!run) throw batchError('Batch run not found', 'AI_BATCH_NOT_FOUND', 404);
    db.prepare(`UPDATE crm_ai_batch_runs SET state='cancel_requested',updated_at=? WHERE id=?`)
      .run(timestamp(), run.id);
    for (const item of db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=?').all(run.id)) {
      const job = jobs.getJob(item.job_id);
      if (job && !['succeeded', 'needs_review', 'cancelled'].includes(job.state)) {
        try { jobs.requestCancel(job.id); } catch (_error) { /* concurrent terminal state wins */ }
      }
    }
    if (run.provider_batch_id) await provider.cancel(run.provider_batch_id);
    return db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(run.id);
  }

  function reconcile() {
    return Object.freeze({
      releasedReservations: budgets.releaseOrphanedReservations(),
      expiredLeases: jobs.releaseExpiredLeases(),
    });
  }

  return Object.freeze({
    config,
    pricing,
    candidateRows,
    submitReady,
    resumeSubmission,
    pollAndImport,
    cancel,
    reconcile,
    getRun: id => db.prepare('SELECT * FROM crm_ai_batch_runs WHERE id=?').get(String(id || '')),
    listItems: id => db.prepare('SELECT * FROM crm_ai_batch_items WHERE run_id=? ORDER BY id').all(String(id || '')),
  });
}

module.exports = {
  BATCH_ELIGIBLE_STATIONS,
  BATCH_FORBIDDEN_STATIONS,
  batchConfigurationFromEnvironment,
  createPricingStore,
  createQwenBatchCoordinator,
  createQwenBatchProvider,
  withinSchedule,
};

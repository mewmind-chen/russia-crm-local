const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { databasePath } = require('./runtime_paths');

const VALID_ASSISTANT_MODES = new Set(['auto', 'qwen', 'kimi-cli', 'hermes', 'deepseek']);
const DEFAULT_ENGINE_PRIORITY = Object.freeze(['qwen', 'deepseek']);
const LEGACY_ENGINE_PRIORITY = Object.freeze(['kimi-cli', 'hermes', 'deepseek']);
const ALL_ASSISTANT_ENGINES = Object.freeze(['qwen', 'kimi-cli', 'hermes', 'deepseek']);
const MAX_ROUTER_TIMEOUT_MS = 75000;
const MAX_ROUTER_ATTEMPTS = 2;

let singleton = null;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function validMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase();
  return VALID_ASSISTANT_MODES.has(mode) ? mode : fallback;
}

function explicitBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function nowIso(value) {
  return new Date(value).toISOString();
}

function emptyHealth() {
  return {
    status: 'unknown',
    latencyMs: 0,
    lastCheckedAt: '',
    lastSuccessAt: '',
    lastFailureAt: '',
    retryAfter: '',
    errorCode: '',
    errorMessage: '',
  };
}

function sanitizeError(error) {
  return {
    code: String(error?.code || `HTTP_${error?.statusCode || 500}`).slice(0, 80),
    message: String(error?.message || error || 'AI engine failed').replace(/\s+/g, ' ').trim().slice(0, 300),
    statusCode: Number(error?.statusCode || 502),
  };
}

function isEngineError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  return /(HERMES|KIMI|DEEPSEEK|QWEN|ASSISTANT_ENGINE)/.test(code)
    || [402, 429, 502, 503, 504].includes(Number(error.statusCode));
}

function isOnlineFallbackEligible(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (['QWEN_CANCELLED', 'QWEN_AUTH_ERROR', 'QWEN_REQUEST_ERROR', 'QWEN_NOT_CONFIGURED'].includes(code)) return false;
  if (code === 'AI_STATION_INVALID_OUTPUT') return true;
  if (['QWEN_TIMEOUT', 'QWEN_NETWORK_ERROR', 'QWEN_RATE_LIMITED', 'QWEN_PROVIDER_ERROR', 'QWEN_INVALID_RESPONSE'].includes(code)) {
    return true;
  }
  const status = Number(error.statusCode || 0);
  return status === 429 || status >= 500;
}

function attemptMetadata(engine, source, startedAt, finishedAt, ok, extra = {}) {
  return {
    engine,
    model: String(source?.model || extra.model || 'unknown'),
    ok,
    durationMs: Math.max(0, finishedAt - startedAt),
    usage: source?.usage || null,
    requestId: String(source?.requestId || extra.requestId || ''),
    finishReason: String(source?.finishReason || extra.finishReason || ''),
    traceId: String(source?.traceId || extra.traceId || ''),
    ...extra,
  };
}

function createAssistantRouter(options = {}) {
  const dbPath = databasePath(options.dbPath
    ? { ...process.env, CRM_DB_PATH: options.dbPath }
    : process.env);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const configuredPriority = Array.isArray(options.priority) && options.priority.length
    ? options.priority.filter(engine => ALL_ASSISTANT_ENGINES.includes(engine))
    : null;
  const healthRetryMs = boundedInteger(options.healthRetryMs ?? process.env.ASSISTANT_HEALTH_RETRY_MS, 300000, 1, 3600000);
  const healthIntervalMs = boundedInteger(options.healthIntervalMs ?? process.env.ASSISTANT_HEALTH_INTERVAL_MS, 300000, 1000, 3600000);
  const probeTimeoutMs = boundedInteger(options.probeTimeoutMs ?? process.env.ASSISTANT_HEALTH_PROBE_TIMEOUT_MS, 12000, 1, 120000);
  const routerTimeoutMs = boundedInteger(
    options.routerTimeoutMs ?? process.env.ASSISTANT_ROUTER_TIMEOUT_MS,
    MAX_ROUTER_TIMEOUT_MS,
    100,
    MAX_ROUTER_TIMEOUT_MS,
  );
  const maxAttempts = boundedInteger(
    options.maxAttempts ?? process.env.ASSISTANT_ROUTER_MAX_ATTEMPTS,
    MAX_ROUTER_ATTEMPTS,
    1,
    MAX_ROUTER_ATTEMPTS,
  );
  const autoAttemptTimeoutMs = boundedInteger(options.autoAttemptTimeoutMs ?? process.env.ASSISTANT_AUTO_ATTEMPT_TIMEOUT_MS, 30000, 1, 90000);
  const health = Object.fromEntries(ALL_ASSISTANT_ENGINES.map(engine => [engine, emptyHealth()]));
  let refreshPromise = null;
  let monitor = null;
  let stopped = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_runtime_settings (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'auto',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
  const initialMode = validMode(options.mode ?? process.env.ASSISTANT_ENGINE, 'auto');
  db.prepare(`
    INSERT OR IGNORE INTO assistant_runtime_settings (id, mode, updated_by, updated_at)
    VALUES ('default', ?, '', ?)
  `).run(initialMode, nowIso(now()));

  function settings() {
    const row = db.prepare(`
      SELECT mode, updated_by AS updatedBy, updated_at AS updatedAt
      FROM assistant_runtime_settings WHERE id = 'default'
    `).get() || {};
    return {
      mode: validMode(row.mode, 'auto'),
      updatedBy: row.updatedBy || '',
      updatedAt: row.updatedAt || '',
    };
  }

  function qwenOnlineEnabled() {
    const configured = typeof options.qwenOnlineEnabled === 'function'
      ? options.qwenOnlineEnabled()
      : options.qwenOnlineEnabled;
    const hardEnabled = explicitBoolean(
      configured ?? process.env.CRM_AI_QWEN_ONLINE_ENABLED,
      false,
    );
    if (!hardEnabled) return false;
    try {
      const installed = db.prepare(`SELECT 1 FROM sqlite_master
        WHERE type='table' AND name='crm_ai_feature_flags'`).get();
      if (!installed) return true;
      const row = db.prepare(`SELECT enabled FROM crm_ai_feature_flags
        WHERE feature_key='qwen_online'`).get();
      return row ? Boolean(row.enabled) : true;
    } catch (_error) {
      return false;
    }
  }

  function activePriority() {
    if (configuredPriority) return [...configuredPriority];
    return qwenOnlineEnabled() ? [...DEFAULT_ENGINE_PRIORITY] : [...LEGACY_ENGINE_PRIORITY];
  }

  function detailedHealth(engine) {
    return { ...health[engine] };
  }

  function publicHealth(engine, detailed) {
    const item = health[engine];
    const base = {
      status: item.status,
      latencyMs: item.latencyMs,
      lastCheckedAt: item.lastCheckedAt,
      lastSuccessAt: item.lastSuccessAt,
      lastFailureAt: item.lastFailureAt,
      retryAfter: item.retryAfter,
    };
    return detailed ? { ...base, errorCode: item.errorCode, errorMessage: item.errorMessage } : base;
  }

  function getRuntimeState(stateOptions = {}) {
    const current = settings();
    const priority = activePriority();
    const engines = Object.fromEntries(ALL_ASSISTANT_ENGINES
      .map(engine => [engine, publicHealth(engine, Boolean(stateOptions.detailed))]));
    const activeEngine = current.mode === 'auto'
      ? priority.find(engine => health[engine].status === 'healthy') || ''
      : current.mode;
    return {
      ok: true,
      ...current,
      priority: [...priority],
      activeEngine,
      engines,
      checking: Boolean(refreshPromise),
    };
  }

  function setMode(mode, actor = '') {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!VALID_ASSISTANT_MODES.has(normalized)) {
      const error = new Error(`不支持的 AI 引擎模式：${mode}`);
      error.code = 'ASSISTANT_MODE_INVALID';
      error.statusCode = 400;
      throw error;
    }
    db.prepare(`
      UPDATE assistant_runtime_settings SET mode = ?, updated_by = ?, updated_at = ? WHERE id = 'default'
    `).run(normalized, String(actor || '').slice(0, 120), nowIso(now()));
    return getRuntimeState({ detailed: true });
  }

  function markChecking(engine) {
    health[engine] = { ...health[engine], status: 'checking', errorCode: '', errorMessage: '' };
  }

  function markSuccess(engine, startedAt) {
    const at = now();
    health[engine] = {
      status: 'healthy',
      latencyMs: Math.max(0, at - startedAt),
      lastCheckedAt: nowIso(at),
      lastSuccessAt: nowIso(at),
      lastFailureAt: health[engine].lastFailureAt,
      retryAfter: '',
      errorCode: '',
      errorMessage: '',
    };
  }

  function markFailure(engine, error, startedAt) {
    const at = now();
    const clean = sanitizeError(error);
    health[engine] = {
      status: 'unhealthy',
      latencyMs: Math.max(0, at - startedAt),
      lastCheckedAt: nowIso(at),
      lastSuccessAt: health[engine].lastSuccessAt,
      lastFailureAt: nowIso(at),
      retryAfter: nowIso(at + healthRetryMs),
      errorCode: clean.code,
      errorMessage: clean.message,
    };
  }

  function circuitOpen(engine) {
    const item = health[engine];
    if (item.status !== 'unhealthy' || !item.retryAfter) return false;
    return Date.parse(item.retryAfter) > now();
  }

  async function probeEngine(engine, adapters) {
    const adapter = adapters?.[engine];
    const startedAt = now();
    markChecking(engine);
    if (typeof adapter !== 'function') {
      const error = new Error(`AI engine adapter is unavailable: ${engine}`);
      error.code = 'ASSISTANT_ENGINE_ADAPTER_MISSING';
      error.statusCode = 503;
      markFailure(engine, error, startedAt);
      return false;
    }
    try {
      await adapter([{ role: 'user', content: '只回复 OK' }], {
        probe: true,
        scope: 'view',
        externalAllowed: false,
        sessionId: '',
        sessionEngine: '',
        timeoutMs: probeTimeoutMs,
      });
      markSuccess(engine, startedAt);
      return true;
    } catch (error) {
      markFailure(engine, error, startedAt);
      return false;
    }
  }

  async function refreshHealth(adapters, refreshOptions = {}) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const candidates = ALL_ASSISTANT_ENGINES.filter(engine => {
        if (refreshOptions.force) return true;
        if (health[engine].status === 'unknown') return true;
        return health[engine].status === 'unhealthy' && !circuitOpen(engine);
      });
      await Promise.all(candidates.map(engine => probeEngine(engine, adapters)));
      return getRuntimeState({ detailed: true });
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function firstProbedEngine(adapters, candidates) {
    for (const engine of candidates) {
      if (circuitOpen(engine)) continue;
      if (health[engine].status === 'healthy') return engine;
      if (await probeEngine(engine, adapters)) return engine;
    }
    return '';
  }

  function candidateOrder(requestOptions = {}, priority = activePriority()) {
    const sessionEngine = validMode(requestOptions.sessionEngine, '');
    const ordered = [];
    if (sessionEngine && sessionEngine !== 'auto' && health[sessionEngine]?.status === 'healthy' && !circuitOpen(sessionEngine)) {
      ordered.push(sessionEngine);
    }
    priority.forEach(engine => {
      if (!ordered.includes(engine) && health[engine].status === 'healthy' && !circuitOpen(engine)) ordered.push(engine);
    });
    return ordered;
  }

  async function invoke(engine, messages, requestOptions, adapters, timeoutMs) {
    const adapter = adapters?.[engine];
    if (typeof adapter !== 'function') {
      const error = new Error(`AI engine adapter is unavailable: ${engine}`);
      error.code = 'ASSISTANT_ENGINE_ADAPTER_MISSING';
      error.statusCode = 503;
      throw error;
    }
    const sameSession = requestOptions.sessionEngine === engine;
    return adapter(messages, {
      ...requestOptions,
      probe: false,
      timeoutMs,
      model: requestOptions.engineModels?.[engine] || requestOptions.model,
      sessionId: sameSession ? String(requestOptions.sessionId || '') : '',
      sessionEngine: engine,
    });
  }

  async function route(messages, requestOptions = {}, adapters = {}) {
    if (stopped) throw new Error('Assistant router is stopped');
    const current = settings();
    if (current.mode !== 'auto') {
      const engine = current.mode;
      if (circuitOpen(engine)) {
        const error = new Error(health[engine].errorMessage || `${engine} 当前不可用`);
        error.code = health[engine].errorCode || 'ASSISTANT_ENGINE_UNHEALTHY';
        error.statusCode = 503;
        throw error;
      }
      const startedAt = now();
      let providerResult = null;
      try {
        const effectiveTimeout = boundedInteger(requestOptions.timeoutMs, routerTimeoutMs, 1, routerTimeoutMs);
        const result = await invoke(engine, messages, requestOptions, adapters, effectiveTimeout);
        providerResult = result;
        const validatedValue = typeof requestOptions.validateResult === 'function'
          ? await requestOptions.validateResult(result, engine)
          : undefined;
        markSuccess(engine, startedAt);
        const finishedAt = now();
        return {
          ...result,
          ...(validatedValue === undefined ? {} : { validatedValue }),
          engine,
          sessionEngine: engine,
          engineAttempts: [attemptMetadata(engine, result, startedAt, finishedAt, true)],
          fallbackReason: '',
        };
      } catch (error) {
        if (isEngineError(error)) markFailure(engine, error, startedAt);
        if (!Array.isArray(error.engineAttempts) || !error.engineAttempts.length) {
          const clean = sanitizeError(error);
          const structuredInvalid = clean.code === 'AI_STATION_INVALID_OUTPUT';
          error.engineAttempts = [attemptMetadata(engine, providerResult || error, startedAt, now(), false, {
            code: clean.code,
            error: clean.message,
            status: structuredInvalid ? 'invalid_output' : 'failed',
          })];
          if (providerResult) {
            error.engine = engine;
            error.model = providerResult.model;
            error.usage = providerResult.usage;
            error.requestId = providerResult.requestId;
            error.finishReason = providerResult.finishReason;
          }
        }
        throw error;
      }
    }

    const priority = activePriority();
    const qwenRoute = !configuredPriority && priority[0] === 'qwen';
    let candidates = qwenRoute
      ? priority.filter(engine => !circuitOpen(engine))
      : candidateOrder(requestOptions, priority);
    if (!qwenRoute && !candidates.length) {
      const probed = await firstProbedEngine(adapters, priority);
      if (probed) candidates = [probed, ...candidateOrder(requestOptions, priority).filter(engine => engine !== probed)];
    }
    const startedRouteAt = now();
    const attempts = [];
    let firstFailure = '';
    for (const engine of candidates) {
      if (attempts.length >= maxAttempts) break;
      const remainingMs = routerTimeoutMs - (now() - startedRouteAt);
      if (remainingMs <= 0) break;
      const startedAt = now();
      try {
        const result = await invoke(engine, messages, requestOptions, adapters, Math.min(autoAttemptTimeoutMs, remainingMs));
        let validatedValue;
        try {
          validatedValue = typeof requestOptions.validateResult === 'function'
            ? await requestOptions.validateResult(result, engine)
            : undefined;
        } catch (validationError) {
          validationError.engine = engine;
          validationError.model = result?.model;
          validationError.usage = result?.usage;
          validationError.requestId = result?.requestId;
          validationError.finishReason = result?.finishReason;
          validationError.providerResult = result;
          throw validationError;
        }
        markSuccess(engine, startedAt);
        const finishedAt = now();
        attempts.push(attemptMetadata(engine, result, startedAt, finishedAt, true));
        return {
          ...result,
          ...(validatedValue === undefined ? {} : { validatedValue }),
          engine,
          sessionEngine: engine,
          engineAttempts: attempts,
          fallbackReason: firstFailure,
        };
      } catch (error) {
        const structuredInvalid = String(error?.code || '') === 'AI_STATION_INVALID_OUTPUT';
        if (!isEngineError(error) && !structuredInvalid) throw error;
        const clean = sanitizeError(error);
        markFailure(engine, error, startedAt);
        const result = error.providerResult;
        attempts.push(attemptMetadata(engine, result || error, startedAt, now(), false, {
          code: clean.code,
          error: clean.message,
          status: clean.code === 'AI_STATION_INVALID_OUTPUT' ? 'invalid_output' : 'failed',
        }));
        if (!firstFailure) firstFailure = clean.code;
        if (qwenRoute && engine === 'qwen' && !isOnlineFallbackEligible(error)) {
          error.engineAttempts = attempts;
          throw error;
        }
      }
    }
    const error = new Error('当前没有可用的 AI 引擎，请稍后重试或让管理员重新检测。');
    error.code = 'ASSISTANT_ENGINES_UNAVAILABLE';
    error.statusCode = 503;
    error.engineAttempts = attempts;
    error.engines = getRuntimeState({ detailed: true }).engines;
    throw error;
  }

  function start(adapters) {
    if (monitor || stopped) return;
    refreshHealth(adapters).catch(() => {});
    monitor = setInterval(() => {
      refreshHealth(adapters).catch(() => {});
    }, healthIntervalMs);
    if (typeof monitor.unref === 'function') monitor.unref();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (monitor) clearInterval(monitor);
    monitor = null;
    db.close();
  }

  return {
    getRuntimeState,
    setMode,
    refreshHealth,
    route,
    start,
    stop,
  };
}

function getAssistantRouter(options = {}) {
  if (!singleton) singleton = createAssistantRouter(options);
  return singleton;
}

module.exports = {
  VALID_ASSISTANT_MODES,
  DEFAULT_ENGINE_PRIORITY,
  LEGACY_ENGINE_PRIORITY,
  createAssistantRouter,
  getAssistantRouter,
  isEngineError,
  isOnlineFallbackEligible,
  sanitizeError,
};

const { hasPermission: defaultHasPermission } = require('./access_control');
const { isEngineError } = require('./assistant_router');

const PUBLIC_ASSISTANT_ENGINE_ERROR = 'AI 引擎暂时不可用，请稍后重试或联系管理员。';

function isProviderDiagnosticError(error) {
  const code = String(error?.code || '').toUpperCase();
  const providerCode = /^(HERMES|KIMI|DEEPSEEK|QWEN)(?:_|$)/.test(code)
    || /^ASSISTANT_ENGINES?(?:_|$)/.test(code);
  const engineEvidence = error?.engines && typeof error.engines === 'object';
  return Boolean(engineEvidence || (providerCode && isEngineError(error)));
}

function forbidden(res, message) {
  return res.status(403).json({
    ok: false,
    error: message,
    code: 'ASSISTANT_RUNTIME_FORBIDDEN',
  });
}

function errorResponse(res, error) {
  return res.status(error?.statusCode || 500).json({
    ok: false,
    error: error?.message || String(error),
    code: error?.code || 'ASSISTANT_RUNTIME_ERROR',
  });
}

function runtimeEngines(engines, detailed = false) {
  return Object.fromEntries(Object.entries(engines || {}).map(([engine, health]) => {
    if (detailed) return [engine, { ...(health || {}) }];
    const { errorCode, errorMessage, ...safeHealth } = health || {};
    return [engine, safeHealth];
  }));
}

function publicRuntimeState(state) {
  return { ...(state || {}), engines: runtimeEngines(state?.engines) };
}

function serializeAssistantEngineError(error, detailed = false) {
  const payload = {
    ok: false,
    error: !detailed && isProviderDiagnosticError(error)
      ? PUBLIC_ASSISTANT_ENGINE_ERROR
      : error?.message || String(error),
    code: error?.code || 'ASSISTANT_ERROR',
  };
  if (error?.engines) payload.engines = runtimeEngines(error.engines, detailed);
  return payload;
}

function createAssistantRuntimeHandlers(options = {}) {
  const hasPermission = options.hasPermission || defaultHasPermission;
  const runtimeState = options.runtimeState || options.getRuntimeState;
  const setMode = options.setMode || options.setAssistantRuntimeMode;
  const recheck = options.recheck || options.recheckAssistantEngines;

  if (typeof runtimeState !== 'function' || typeof setMode !== 'function' || typeof recheck !== 'function') {
    throw new TypeError('Assistant runtime handlers require runtimeState, setMode, and recheck functions');
  }

  function canUseAssistant(req) {
    return hasPermission(req.salesUser, 'use_ai_assistant');
  }

  function canManageRuntime(req) {
    return hasPermission(req.salesUser, 'manage_users');
  }

  return {
    get(req, res) {
      if (!canUseAssistant(req)) return forbidden(res, '没有使用 AI 助手的权限');
      const detailed = canManageRuntime(req);
      const state = runtimeState({ detailed });
      return res.json(detailed ? state : publicRuntimeState(state));
    },

    patch(req, res) {
      if (!canManageRuntime(req)) return forbidden(res, '没有管理 AI 运行时的权限');
      try {
        return res.json(setMode(req.body?.mode, req.salesUser?.id || ''));
      } catch (error) {
        return errorResponse(res, error);
      }
    },

    async recheck(req, res) {
      if (!canManageRuntime(req)) return forbidden(res, '没有管理 AI 运行时的权限');
      try {
        return res.json(await recheck());
      } catch (error) {
        return errorResponse(res, error);
      }
    },
  };
}

module.exports = {
  createAssistantRuntimeHandlers,
  publicRuntimeState,
  serializeAssistantEngineError,
};

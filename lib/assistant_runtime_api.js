const { hasPermission: defaultHasPermission } = require('./access_control');

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

function publicRuntimeState(state) {
  const engines = Object.fromEntries(Object.entries(state?.engines || {}).map(([engine, health]) => {
    const { errorCode, errorMessage, ...safeHealth } = health || {};
    return [engine, safeHealth];
  }));
  return { ...(state || {}), engines };
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

module.exports = { createAssistantRuntimeHandlers, publicRuntimeState };

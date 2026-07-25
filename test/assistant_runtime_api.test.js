const test = require('node:test');
const assert = require('node:assert/strict');

const { createAssistantRuntimeHandlers, serializeAssistantEngineError } = require('../lib/assistant_runtime_api');
const { policyForLegacyRequest } = require('../lib/access_control');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(handler, { salesUser, body = {} } = {}) {
  const res = response();
  await handler({ salesUser, body }, res);
  return res;
}

function fakeRuntime() {
  const calls = { getState: [], setMode: [], recheck: [] };
  const state = {
    ok: true,
    mode: 'auto',
    updatedBy: 'USR-ADMIN',
    updatedAt: '2026-07-22T00:00:00.000Z',
    priority: ['kimi-cli', 'hermes', 'deepseek'],
    activeEngine: 'kimi-cli',
    checking: false,
    engines: {
      'kimi-cli': {
        status: 'unhealthy',
        errorCode: 'KIMI_CLI_TIMEOUT',
        errorMessage: 'Kimi endpoint timed out',
      },
    },
  };
  return {
    calls,
    state,
    runtimeState(options) {
      calls.getState.push(options);
      return state;
    },
    setMode(mode, actor) {
      calls.setMode.push({ mode, actor });
      return { ...state, mode };
    },
    async recheck() {
      calls.recheck.push(true);
      return state;
    },
  };
}

test('assistant runtime mutation requires manage_users', async () => {
  const runtime = fakeRuntime();
  const handler = createAssistantRuntimeHandlers(runtime);

  const result = await invoke(handler.patch, {
    salesUser: { permissions: { use_ai_assistant: true, manage_users: false } },
    body: { mode: 'kimi-cli' },
  });

  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, {
    ok: false,
    error: '没有管理 AI 运行时的权限',
    code: 'ASSISTANT_RUNTIME_FORBIDDEN',
  });
  assert.equal(runtime.calls.setMode.length, 0);
});

test('ordinary AI users receive a redacted runtime view', async () => {
  const runtime = fakeRuntime();
  const handler = createAssistantRuntimeHandlers(runtime);

  const result = await invoke(handler.get, {
    salesUser: { permissions: { use_ai_assistant: true, manage_users: false } },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(runtime.calls.getState.length, 1);
  assert.equal(runtime.calls.getState[0].detailed, false);
  assert.equal(result.body.engines['kimi-cli'].status, 'unhealthy');
  assert.equal('errorCode' in result.body.engines['kimi-cli'], false);
  assert.equal('errorMessage' in result.body.engines['kimi-cli'], false);
});

test('runtime managers receive detailed state', async () => {
  const runtime = fakeRuntime();
  const handler = createAssistantRuntimeHandlers(runtime);

  const result = await invoke(handler.get, {
    salesUser: { permissions: { use_ai_assistant: true, manage_users: true } },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(runtime.calls.getState[0].detailed, true);
  assert.equal(result.body.engines['kimi-cli'].errorCode, 'KIMI_CLI_TIMEOUT');
});

test('administrator can persist auto mode and force recheck', async () => {
  const runtime = fakeRuntime();
  const handler = createAssistantRuntimeHandlers(runtime);
  const admin = { id: 'USR-ADMIN', permissions: { use_ai_assistant: true, manage_users: true } };

  const patch = await invoke(handler.patch, { salesUser: admin, body: { mode: 'auto' } });
  const recheck = await invoke(handler.recheck, { salesUser: admin });

  assert.equal(patch.statusCode, 200);
  assert.equal(recheck.statusCode, 200);
  assert.deepEqual(runtime.calls.setMode, [{ mode: 'auto', actor: 'USR-ADMIN' }]);
  assert.equal(runtime.calls.recheck.length, 1);
});

test('runtime routes are restricted to AI governance administrators', () => {
  assert.deepEqual(policyForLegacyRequest('GET', '/assistant/runtime'), {
    permissions: ['manage_ai_governance'],
    realAdminOnly: true,
  });
  assert.deepEqual(policyForLegacyRequest('PATCH', '/assistant/runtime'), {
    permissions: ['manage_ai_governance'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  });
  assert.deepEqual(policyForLegacyRequest('POST', '/assistant/runtime/recheck'), {
    permissions: ['manage_ai_governance'],
    realAdminOnly: true,
    blockedWhileImpersonating: true,
  });
});

test('ordinary chat users receive a generic message for direct provider failures', () => {
  const error = Object.assign(new Error('Kimi CLI failed: stderr=token rejected at /private/provider/config'), {
    code: 'KIMI_CLI_FAILED',
    statusCode: 502,
  });

  const ordinary = serializeAssistantEngineError(error, false);
  const manager = serializeAssistantEngineError(error, true);

  assert.deepEqual(ordinary, {
    ok: false,
    error: 'AI 引擎暂时不可用，请稍后重试或联系管理员。',
    code: 'KIMI_CLI_FAILED',
  });
  assert.equal(manager.error, 'Kimi CLI failed: stderr=token rejected at /private/provider/config');
  assert.equal(manager.code, 'KIMI_CLI_FAILED');
});

test('ordinary chat users receive a generic message for normalized DeepSeek network failures', () => {
  const error = Object.assign(new Error('socket reset with sensitive upstream detail'), {
    code: 'DEEPSEEK_NETWORK_ERROR',
    statusCode: 502,
  });

  assert.deepEqual(serializeAssistantEngineError(error, false), {
    ok: false,
    error: 'AI 引擎暂时不可用，请稍后重试或联系管理员。',
    code: 'DEEPSEEK_NETWORK_ERROR',
  });
});

test('ordinary chat users receive generic and redacted exhausted-engine failures', () => {
  const error = Object.assign(new Error('all providers failed: kimi stderr and hermes trace'), {
    code: 'ASSISTANT_ENGINES_UNAVAILABLE',
    statusCode: 503,
    engines: {
      'kimi-cli': {
        status: 'unhealthy',
        errorCode: 'KIMI_CLI_TIMEOUT',
        errorMessage: 'Kimi endpoint timed out',
      },
    },
  });

  const ordinary = serializeAssistantEngineError(error, false);
  const manager = serializeAssistantEngineError(error, true);

  assert.deepEqual(ordinary, {
    ok: false,
    error: 'AI 引擎暂时不可用，请稍后重试或联系管理员。',
    code: 'ASSISTANT_ENGINES_UNAVAILABLE',
    engines: { 'kimi-cli': { status: 'unhealthy' } },
  });
  assert.equal(manager.error, 'all providers failed: kimi stderr and hermes trace');
  assert.equal(manager.engines['kimi-cli'].errorCode, 'KIMI_CLI_TIMEOUT');
  assert.equal(manager.engines['kimi-cli'].errorMessage, 'Kimi endpoint timed out');
});

test('ordinary chat users retain non-provider validation and application messages', () => {
  const validationError = Object.assign(new Error('请输入问题。'), {
    code: 'ASSISTANT_INPUT_INVALID',
    statusCode: 400,
  });
  const applicationError = Object.assign(new Error('CRM 数据服务暂时不可用'), {
    code: 'CRM_DEPENDENCY_UNAVAILABLE',
    statusCode: 503,
  });

  assert.deepEqual(serializeAssistantEngineError(validationError, false), {
    ok: false,
    error: '请输入问题。',
    code: 'ASSISTANT_INPUT_INVALID',
  });
  assert.deepEqual(serializeAssistantEngineError(applicationError, false), {
    ok: false,
    error: 'CRM 数据服务暂时不可用',
    code: 'CRM_DEPENDENCY_UNAVAILABLE',
  });
});

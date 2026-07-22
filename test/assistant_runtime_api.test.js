const test = require('node:test');
const assert = require('node:assert/strict');

const { createAssistantRuntimeHandlers } = require('../lib/assistant_runtime_api');
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

test('runtime routes have explicit legacy permission policies', () => {
  assert.deepEqual(policyForLegacyRequest('GET', '/assistant/runtime'), { permissions: ['use_ai_assistant'] });
  assert.deepEqual(policyForLegacyRequest('PATCH', '/assistant/runtime'), { permissions: ['manage_users'] });
  assert.deepEqual(policyForLegacyRequest('POST', '/assistant/runtime/recheck'), { permissions: ['manage_users'] });
});

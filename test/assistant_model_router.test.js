const test = require('node:test');
const assert = require('node:assert/strict');

const { callAssistantModel, callDeepSeek } = require('../lib/assistant');

test('callAssistantModel delegates to the supplied router and returns session engine metadata', async () => {
  const calls = [];
  const router = {
    async route(messages, options, adapters) {
      calls.push({ messages, options, adapterNames: Object.keys(adapters) });
      return {
        ok: true,
        answer: 'ok',
        engine: 'kimi-cli',
        model: 'Kimi CLI · k3',
        sessionId: 'session_3653163d-8e1d-4d83-84e2-baca17d110d4',
        sessionEngine: 'kimi-cli',
        engineAttempts: [{ engine: 'kimi-cli', ok: true, durationMs: 7 }],
        fallbackReason: '',
        usage: null,
        guardrails: { readOnly: true },
      };
    },
  };
  const adapters = {
    'kimi-cli': async () => ({ answer: 'kimi', engine: 'kimi-cli' }),
    hermes: async () => ({ answer: 'hermes', engine: 'hermes' }),
    deepseek: async () => ({ answer: 'deepseek', engine: 'deepseek' }),
  };
  const oldEngine = process.env.ASSISTANT_ENGINE;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.ASSISTANT_ENGINE = 'deepseek';
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = await callAssistantModel([{ role: 'user', content: 'test' }], {
      router,
      adapters,
      scope: 'view',
      sessionEngine: '',
    });
    assert.equal(result.engine, 'kimi-cli');
    assert.equal(result.sessionEngine, 'kimi-cli');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].adapterNames, ['kimi-cli', 'hermes', 'deepseek']);
  } finally {
    if (oldEngine === undefined) delete process.env.ASSISTANT_ENGINE;
    else process.env.ASSISTANT_ENGINE = oldEngine;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

test('DeepSeek uses the per-call timeout when its request aborts', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  let timeoutDelay;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.setTimeout = (callback, delay) => {
    timeoutDelay = delay;
    callback();
    return 1;
  };
  global.clearTimeout = () => {};
  global.fetch = async (_url, options) => {
    assert.equal(options.signal.aborted, true);
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };
  try {
    await assert.rejects(
      () => callDeepSeek([{ role: 'user', content: 'test' }], { timeoutMs: 12000 }),
      error => error.code === 'DEEPSEEK_TIMEOUT' && error.statusCode === 504 && /12/.test(error.message),
    );
    assert.equal(timeoutDelay, 12000);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

test('DeepSeek tags HTTP failures before exposing them to the router', async () => {
  const originalFetch = global.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'Incorrect API key: sk-secret' } }),
  });
  try {
    await assert.rejects(
      () => callDeepSeek([{ role: 'user', content: 'test' }]),
      error => error.code === 'DEEPSEEK_HTTP_ERROR'
        && error.statusCode === 401
        && /sk-secret/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

test('DeepSeek tags non-JSON upstream responses before exposing them to the router', async () => {
  const originalFetch = global.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => 'upstream trace with secret detail',
  });
  try {
    await assert.rejects(
      () => callDeepSeek([{ role: 'user', content: 'test' }]),
      error => error.code === 'DEEPSEEK_INVALID_RESPONSE'
        && error.statusCode === 502
        && /secret detail/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

test('DeepSeek tags network failures before exposing them to the router', async () => {
  const originalFetch = global.fetch;
  const oldKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  global.fetch = async () => { throw new Error('socket failed with provider detail'); };
  try {
    await assert.rejects(
      () => callDeepSeek([{ role: 'user', content: 'test' }]),
      error => error.code === 'DEEPSEEK_REQUEST_FAILED'
        && error.statusCode === 502
        && /provider detail/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = oldKey;
  }
});

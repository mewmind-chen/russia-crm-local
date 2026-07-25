const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createAssistantRouter,
  DEFAULT_ENGINE_PRIORITY,
  LEGACY_ENGINE_PRIORITY,
} = require('../lib/assistant_router');

function testRouter(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-router-'));
  const router = createAssistantRouter({
    dbPath: path.join(dir, 'crm.db'),
    healthRetryMs: 1000,
    probeTimeoutMs: 50,
    routerTimeoutMs: 1000,
    autoAttemptTimeoutMs: 250,
    ...options,
  });
  return {
    router,
    cleanup() {
      router.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function engineResult(engine, answer = engine) {
  return {
    ok: true,
    answer,
    engine,
    model: `${engine}-model`,
    sessionId: `${engine.replace(/[^a-z]/g, '')}_session_1234`,
    usage: null,
    guardrails: { readOnly: true },
  };
}

function engineError(code, message = code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function healthyAdapters() {
  return {
    'kimi-cli': async () => engineResult('kimi-cli'),
    hermes: async () => engineResult('hermes'),
    deepseek: async () => engineResult('deepseek'),
  };
}

test('defaults to automatic mode with Kimi, Hermes, DeepSeek priority', () => {
  const ctx = testRouter();
  try {
    const state = ctx.router.getRuntimeState({ detailed: true });
    assert.equal(state.mode, 'auto');
    assert.deepEqual(state.priority, ['kimi-cli', 'hermes', 'deepseek']);
    assert.deepEqual(LEGACY_ENGINE_PRIORITY, ['kimi-cli', 'hermes', 'deepseek']);
    assert.deepEqual(DEFAULT_ENGINE_PRIORITY, ['qwen', 'deepseek']);
  } finally {
    ctx.cleanup();
  }
});

test('Qwen online route uses Qwen then one direct DeepSeek Pro fallback', async () => {
  const ctx = testRouter({ qwenOnlineEnabled: true });
  try {
    const calls = [];
    const result = await ctx.router.route([{ role: 'user', content: 'test' }], {
      engineModels: { qwen: 'qwen3.7-plus', deepseek: 'deepseek-v4-pro' },
    }, {
      qwen: async (_messages, options) => {
        calls.push(['qwen', options.model, options.probe]);
        if (options.probe) return engineResult('qwen');
        throw engineError('QWEN_RATE_LIMITED', 'limited', 429);
      },
      deepseek: async (_messages, options) => {
        calls.push(['deepseek', options.model, options.probe]);
        return { ...engineResult('deepseek'), model: options.model, requestId: 'deepseek-request' };
      },
    });
    assert.equal(result.engine, 'deepseek');
    assert.equal(result.model, 'deepseek-v4-pro');
    assert.deepEqual(result.engineAttempts.map(item => item.engine), ['qwen', 'deepseek']);
    assert.equal(result.engineAttempts[1].requestId, 'deepseek-request');
    assert.deepEqual(calls, [
      ['qwen', 'qwen3.7-plus', false],
      ['deepseek', 'deepseek-v4-pro', false],
    ]);
  } finally {
    ctx.cleanup();
  }
});

test('Qwen online route does not fallback for auth, cancellation or non-429 request errors', async () => {
  for (const [code, status] of [
    ['QWEN_AUTH_ERROR', 401],
    ['QWEN_REQUEST_ERROR', 400],
    ['QWEN_CANCELLED', 499],
    ['QWEN_NOT_CONFIGURED', 503],
  ]) {
    const ctx = testRouter({ qwenOnlineEnabled: true });
    let deepseekCalls = 0;
    try {
      await assert.rejects(() => ctx.router.route([], {}, {
        qwen: async (_messages, options) => {
          if (options.probe) return engineResult('qwen');
          throw engineError(code, code, status);
        },
        deepseek: async () => {
          deepseekCalls += 1;
          return engineResult('deepseek');
        },
      }), error => error.code === code);
      assert.equal(deepseekCalls, 0);
    } finally {
      ctx.cleanup();
    }
  }
});

test('Qwen schema-invalid result falls back once and keeps both attempt metadata records', async () => {
  const ctx = testRouter({ qwenOnlineEnabled: true });
  try {
    const result = await ctx.router.route([], {
      validateResult(response) {
        if (response.model === 'qwen-invalid') {
          throw engineError('AI_STATION_INVALID_OUTPUT', 'schema rejected', 422);
        }
        return { accepted: true };
      },
    }, {
      qwen: async (_messages, options) => options.probe
        ? engineResult('qwen')
        : {
          answer: '{}',
          model: 'qwen-invalid',
          usage: { prompt_tokens: 10, completion_tokens: 2 },
          requestId: 'qwen-request',
          finishReason: 'stop',
        },
      deepseek: async () => ({
        answer: '{"accepted":true}',
        model: 'deepseek-v4-pro',
        usage: { prompt_tokens: 11, completion_tokens: 3 },
        requestId: 'deepseek-request',
        finishReason: 'stop',
      }),
    });
    assert.deepEqual(result.validatedValue, { accepted: true });
    assert.deepEqual(result.engineAttempts.map(item => [item.engine, item.status || 'succeeded']), [
      ['qwen', 'invalid_output'],
      ['deepseek', 'succeeded'],
    ]);
    assert.equal(result.engineAttempts[0].requestId, 'qwen-request');
    assert.equal(result.engineAttempts[1].requestId, 'deepseek-request');
  } finally {
    ctx.cleanup();
  }
});

test('fixed Qwen mode preserves billable metadata when schema validation rejects the result', async () => {
  const ctx = testRouter({ qwenOnlineEnabled: true });
  try {
    ctx.router.setMode('qwen', 'admin-1');
    await assert.rejects(() => ctx.router.route([], {
      validateResult() {
        throw engineError('AI_STATION_INVALID_OUTPUT', 'schema rejected', 422);
      },
    }, {
      qwen: async () => ({
        answer: '{}',
        model: 'qwen3.7-plus',
        usage: { prompt_tokens: 9, completion_tokens: 1 },
        requestId: 'qwen-fixed-request',
        finishReason: 'stop',
      }),
    }), error => {
      assert.equal(error.code, 'AI_STATION_INVALID_OUTPUT');
      assert.equal(error.model, 'qwen3.7-plus');
      assert.equal(error.requestId, 'qwen-fixed-request');
      assert.equal(error.engineAttempts.length, 1);
      assert.ok(error.engineAttempts[0].durationMs >= 0);
      assert.deepEqual({ ...error.engineAttempts[0], durationMs: 0 }, {
        engine: 'qwen',
        model: 'qwen3.7-plus',
        ok: false,
        durationMs: 0,
        usage: { prompt_tokens: 9, completion_tokens: 1 },
        requestId: 'qwen-fixed-request',
        finishReason: 'stop',
        traceId: '',
        code: 'AI_STATION_INVALID_OUTPUT',
        error: 'schema rejected',
        status: 'invalid_output',
      });
      return true;
    });
  } finally {
    ctx.cleanup();
  }
});

test('persists a validated global mode across router instances', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-router-persist-'));
  const dbPath = path.join(dir, 'crm.db');
  const first = createAssistantRouter({ dbPath });
  try {
    const changed = first.setMode('kimi-cli', 'admin-1');
    assert.equal(changed.mode, 'kimi-cli');
    assert.equal(changed.updatedBy, 'admin-1');
    const second = createAssistantRouter({ dbPath });
    try {
      assert.equal(second.getRuntimeState().mode, 'kimi-cli');
    } finally {
      second.stop();
    }
    assert.throws(() => first.setMode('fastest', 'admin-1'), /不支持的 AI 引擎模式/);
  } finally {
    first.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('automatic mode selects Kimi before faster lower-priority engines', async () => {
  const ctx = testRouter();
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    const calls = [];
    const adapters = {
      'kimi-cli': async (_messages, options) => { calls.push(['kimi-cli', options.probe]); return engineResult('kimi-cli'); },
      hermes: async (_messages, options) => { calls.push(['hermes', options.probe]); return engineResult('hermes'); },
      deepseek: async (_messages, options) => { calls.push(['deepseek', options.probe]); return engineResult('deepseek'); },
    };
    const result = await ctx.router.route([{ role: 'user', content: 'test' }], {}, adapters);
    assert.equal(result.engine, 'kimi-cli');
    assert.equal(result.sessionEngine, 'kimi-cli');
    assert.deepEqual(calls, [['kimi-cli', false]]);
  } finally {
    ctx.cleanup();
  }
});

test('automatic mode opens a circuit and falls back after an engine timeout', async () => {
  const ctx = testRouter();
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    const adapters = healthyAdapters();
    adapters['kimi-cli'] = async () => { throw engineError('KIMI_CLI_TIMEOUT', 'Kimi timeout', 504); };
    const result = await ctx.router.route([{ role: 'user', content: 'test' }], {}, adapters);
    assert.equal(result.engine, 'hermes');
    assert.equal(result.sessionEngine, 'hermes');
    assert.deepEqual(result.engineAttempts.map(item => item.engine), ['kimi-cli', 'hermes']);
    assert.equal(result.fallbackReason, 'KIMI_CLI_TIMEOUT');
    const state = ctx.router.getRuntimeState({ detailed: true });
    assert.equal(state.engines['kimi-cli'].status, 'unhealthy');
    assert.equal(state.engines['kimi-cli'].errorCode, 'KIMI_CLI_TIMEOUT');
  } finally {
    ctx.cleanup();
  }
});

test('fixed mode calls only the selected engine and returns its error', async () => {
  const ctx = testRouter({ mode: 'hermes' });
  try {
    const calls = [];
    await assert.rejects(() => ctx.router.route([], {}, {
      'kimi-cli': async () => { calls.push('kimi-cli'); return engineResult('kimi-cli'); },
      hermes: async () => { calls.push('hermes'); throw engineError('HERMES_FAILED', 'Hermes down'); },
      deepseek: async () => { calls.push('deepseek'); return engineResult('deepseek'); },
    }), /Hermes down/);
    assert.deepEqual(calls, ['hermes']);
  } finally {
    ctx.cleanup();
  }
});

test('automatic mode probes unknown engines in priority order until one works', async () => {
  const ctx = testRouter();
  try {
    const calls = [];
    const adapters = {
      'kimi-cli': async (_messages, options) => {
        calls.push(`kimi-cli:${options.probe ? 'probe' : 'task'}`);
        throw engineError('KIMI_CLI_NO_KEY', 'no key', 503);
      },
      hermes: async (_messages, options) => {
        calls.push(`hermes:${options.probe ? 'probe' : 'task'}`);
        return engineResult('hermes');
      },
      deepseek: async (_messages, options) => {
        calls.push(`deepseek:${options.probe ? 'probe' : 'task'}`);
        return engineResult('deepseek');
      },
    };
    const result = await ctx.router.route([{ role: 'user', content: 'test' }], {}, adapters);
    assert.equal(result.engine, 'hermes');
    assert.deepEqual(calls, ['kimi-cli:probe', 'hermes:probe', 'hermes:task']);
  } finally {
    ctx.cleanup();
  }
});

test('automatic mode never attempts more than two business engines', async () => {
  const ctx = testRouter();
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    const calls = [];
    const fail = engine => async () => { calls.push(engine); throw engineError(`${engine.toUpperCase()}_FAILED`); };
    await assert.rejects(() => ctx.router.route([], {}, {
      'kimi-cli': fail('kimi-cli'),
      hermes: fail('hermes'),
      deepseek: async () => { calls.push('deepseek'); return engineResult('deepseek'); },
    }), error => error.code === 'ASSISTANT_ENGINES_UNAVAILABLE');
    assert.deepEqual(calls, ['kimi-cli', 'hermes']);
  } finally {
    ctx.cleanup();
  }
});

test('router caps auto routing at the global 75-second budget and two attempts', async () => {
  const ctx = testRouter({ routerTimeoutMs: 90000, autoAttemptTimeoutMs: 90000, maxAttempts: 3 });
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    const timeouts = [];
    const fail = engine => async (_messages, options) => {
      timeouts.push([engine, options.timeoutMs]);
      throw engineError(`${engine.toUpperCase()}_FAILED`);
    };
    await assert.rejects(() => ctx.router.route([], {}, {
      'kimi-cli': fail('kimi-cli'),
      hermes: fail('hermes'),
      deepseek: fail('deepseek'),
    }), error => error.code === 'ASSISTANT_ENGINES_UNAVAILABLE');
    assert.deepEqual(timeouts.map(([engine]) => engine), ['kimi-cli', 'hermes']);
    assert.ok(timeouts.every(([, timeout]) => timeout <= 75000));
  } finally {
    ctx.cleanup();
  }
});

test('fixed mode caps a requested timeout at the global router budget', async () => {
  const ctx = testRouter({ mode: 'hermes', routerTimeoutMs: 90000 });
  try {
    const timeouts = [];
    const adapters = {
      'kimi-cli': async () => engineResult('kimi-cli'),
      hermes: async (_messages, options) => {
        timeouts.push(options.timeoutMs);
        return engineResult('hermes');
      },
      deepseek: async () => engineResult('deepseek'),
    };
    await ctx.router.route([], { timeoutMs: 90000 }, adapters);
    await ctx.router.route([], { timeoutMs: 12000 }, adapters);
    assert.deepEqual(timeouts, [75000, 12000]);
  } finally {
    ctx.cleanup();
  }
});

test('does not fail over when an adapter reports a non-engine application error', async () => {
  const ctx = testRouter();
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    let hermesCalls = 0;
    const applicationError = new Error('CRM scope rejected');
    applicationError.code = 'CRM_SCOPE_DENIED';
    applicationError.statusCode = 403;
    await assert.rejects(() => ctx.router.route([], {}, {
      'kimi-cli': async () => { throw applicationError; },
      hermes: async () => { hermesCalls += 1; return engineResult('hermes'); },
      deepseek: async () => engineResult('deepseek'),
    }), /CRM scope rejected/);
    assert.equal(hermesCalls, 0);
  } finally {
    ctx.cleanup();
  }
});

test('deduplicates concurrent health refreshes', async () => {
  const ctx = testRouter();
  try {
    let resolveProbe;
    let kimiCalls = 0;
    const blocked = new Promise(resolve => { resolveProbe = resolve; });
    const adapters = {
      'kimi-cli': async () => { kimiCalls += 1; await blocked; return engineResult('kimi-cli'); },
      hermes: async () => engineResult('hermes'),
      deepseek: async () => engineResult('deepseek'),
    };
    const first = ctx.router.refreshHealth(adapters, { force: true });
    const second = ctx.router.refreshHealth(adapters, { force: true });
    resolveProbe();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(kimiCalls, 1);
    assert.deepEqual(a.engines, b.engines);
  } finally {
    ctx.cleanup();
  }
});

test('drops a foreign native session when switching engines but keeps history', async () => {
  const ctx = testRouter();
  try {
    await ctx.router.refreshHealth(healthyAdapters(), { force: true });
    const seen = [];
    const result = await ctx.router.route([{ role: 'user', content: 'follow up' }], {
      sessionId: 'old_hermes_session',
      sessionEngine: 'hermes',
    }, {
      'kimi-cli': async (_messages, options) => {
        seen.push(options.sessionId);
        return engineResult('kimi-cli');
      },
      hermes: async (_messages, options) => {
        seen.push(options.sessionId);
        throw engineError('HERMES_TIMEOUT', 'timeout', 504);
      },
      deepseek: async (_messages, options) => {
        seen.push(options.sessionId);
        return engineResult('deepseek');
      },
    });
    assert.equal(result.engine, 'kimi-cli');
    assert.deepEqual(seen, ['old_hermes_session', '']);
  } finally {
    ctx.cleanup();
  }
});

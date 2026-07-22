const test = require('node:test');
const assert = require('node:assert/strict');

const { callAssistantModel } = require('../lib/assistant');

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

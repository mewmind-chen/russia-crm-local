const test = require('node:test');
const assert = require('node:assert/strict');
const { seededFixture } = require('./helpers/permission_fixture');
const { answerAssistantQuestion } = require('../lib/assistant');

function switchedEngineResult() {
  return {
    answer: '模型回答',
    engine: 'kimi-cli',
    sessionEngine: 'kimi-cli',
    sessionId: '',
    engineAttempts: [{ engine: 'kimi-cli', ok: true, durationMs: 1 }],
    usage: null,
    model: 'Kimi CLI · k3',
    guardrails: { readOnly: true },
  };
}

async function assertSessionRouting(payload) {
  const seen = [];
  const result = await answerAssistantQuestion(payload, null, {
    callAssistantModel: async (_messages, options) => {
      seen.push(options);
      return switchedEngineResult();
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sessionEngine, 'hermes');
  assert.equal(seen[0].sessionId, 'old_hermes_session');
  assert.equal(result.sessionEngine, 'kimi-cli');
  assert.equal(result.sessionId, '');
  assert.deepEqual(result.engineAttempts, [{ engine: 'kimi-cli', ok: true, durationMs: 1 }]);
}

test('generic assistant answers forward session engine and drop a switched native session', async () => {
  const fx = await seededFixture();
  const previousWebSearch = process.env.ASSISTANT_WEB_SEARCH;
  process.env.ASSISTANT_WEB_SEARCH = 'off';
  try {
    await assertSessionRouting({
      message: '请分析这条线索的开发优先级',
      sessionId: 'old_hermes_session',
      sessionEngine: 'hermes',
      context: { scope: 'view' },
    });
  } finally {
    if (previousWebSearch === undefined) delete process.env.ASSISTANT_WEB_SEARCH;
    else process.env.ASSISTANT_WEB_SEARCH = previousWebSearch;
    await fx.close();
  }
});

test('current-customer assistant answers forward session engine and drop a switched native session', async () => {
  const fx = await seededFixture();
  const previousWebSearch = process.env.ASSISTANT_WEB_SEARCH;
  process.env.ASSISTANT_WEB_SEARCH = 'off';
  try {
    await assertSessionRouting({
      message: '分析当前客户',
      sessionId: 'old_hermes_session',
      sessionEngine: 'hermes',
      context: { scope: 'customer', customerId: 'RU-9001' },
    });
  } finally {
    if (previousWebSearch === undefined) delete process.env.ASSISTANT_WEB_SEARCH;
    else process.env.ASSISTANT_WEB_SEARCH = previousWebSearch;
    await fx.close();
  }
});

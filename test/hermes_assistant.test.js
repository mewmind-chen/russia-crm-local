const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHermesArgs,
  buildHermesPrompt,
  parseHermesOutput,
  pickHermesSkills,
  validHermesSessionId,
} = require('../lib/hermes_assistant');
const { deterministicKind } = require('../lib/assistant');

test('Hermes assistant cannot call its own web tools and has a bounded turn count', () => {
  const prompt = buildHermesPrompt([{ role: 'user', content: '查当前客户报告' }], { scope: 'customer' });
  const args = buildHermesArgs(prompt, { scope: 'customer' });
  assert.equal(args[args.indexOf('--toolsets') + 1], 'todo');
  assert.equal(args[args.indexOf('--max-turns') + 1], '4');
  assert.ok(!args.includes('--yolo'));
  assert.ok(!args.includes('--skills'));
  assert.ok(args.includes('--pass-session-id'));
});

test('Hermes can be pinned to the Kimi K3 provider without exposing credentials', () => {
  const oldProvider = process.env.ASSISTANT_HERMES_PROVIDER;
  const oldModel = process.env.ASSISTANT_HERMES_MODEL;
  process.env.ASSISTANT_HERMES_PROVIDER = 'kimi-coding';
  process.env.ASSISTANT_HERMES_MODEL = 'k3';
  try {
    const args = buildHermesArgs('接入检查');
    assert.equal(args[args.indexOf('--provider') + 1], 'kimi-coding');
    assert.equal(args[args.indexOf('--model') + 1], 'k3');
    assert.ok(!args.some(arg => /^sk-kimi-/i.test(arg)));
  } finally {
    if (oldProvider === undefined) delete process.env.ASSISTANT_HERMES_PROVIDER;
    else process.env.ASSISTANT_HERMES_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.ASSISTANT_HERMES_MODEL;
    else process.env.ASSISTANT_HERMES_MODEL = oldModel;
  }
});

test('OpenCode Go credentials are injected through the subprocess environment, never CLI arguments', () => {
  const oldProvider = process.env.ASSISTANT_HERMES_PROVIDER;
  const oldModel = process.env.ASSISTANT_HERMES_MODEL;
  process.env.ASSISTANT_HERMES_PROVIDER = 'opencode-go';
  process.env.ASSISTANT_HERMES_MODEL = 'deepseek-v4-flash';
  try {
    const args = buildHermesArgs('接入检查');
    assert.equal(args[args.indexOf('--provider') + 1], 'opencode-go');
    assert.equal(args[args.indexOf('--model') + 1], 'deepseek-v4-flash');
    assert.ok(!args.some(arg => /api[_-]?key|opencode.*key/i.test(arg)));
  } finally {
    if (oldProvider === undefined) delete process.env.ASSISTANT_HERMES_PROVIDER;
    else process.env.ASSISTANT_HERMES_PROVIDER = oldProvider;
    if (oldModel === undefined) delete process.env.ASSISTANT_HERMES_MODEL;
    else process.env.ASSISTANT_HERMES_MODEL = oldModel;
  }
});

test('CRM Hermes profile is isolated from the user default profile', () => {
  const oldHome = process.env.ASSISTANT_HERMES_HOME;
  process.env.ASSISTANT_HERMES_HOME = '/tmp/hermes-crm-test';
  try {
    const { hermesConfig } = require('../lib/hermes_assistant');
    assert.equal(hermesConfig().home, '/tmp/hermes-crm-test');
  } finally {
    if (oldHome === undefined) delete process.env.ASSISTANT_HERMES_HOME;
    else process.env.ASSISTANT_HERMES_HOME = oldHome;
  }
});

test('Hermes prompt makes CRM evidence read-only and forbids side effects', () => {
  const prompt = buildHermesPrompt([{ role: 'user', content: '找采购联系人并写入 CRM' }], { scope: 'customer' });
  assert.match(prompt, /只读证据包/);
  assert.match(prompt, /禁止修改 CRM/);
  assert.match(prompt, /外网搜索和网页提取已由 CRM 服务端/);
  assert.match(prompt, /不得编造/);
});

test('Hermes cannot use web tools when the user forbids external research', () => {
  const prompt = buildHermesPrompt([{ role: 'user', content: '只看已有报告，不要外查' }], {
    scope: 'customer',
    externalAllowed: false,
  });
  const args = buildHermesArgs(prompt, { scope: 'customer', externalAllowed: false });
  assert.equal(args[args.indexOf('--toolsets') + 1], 'todo');
  assert.ok(!args.includes('--skills'));
  assert.match(prompt, /本次请求禁止外网检索/);
});

test('Hermes cannot preload research skills that may invoke their own tools', () => {
  assert.deepEqual(pickHermesSkills('当前客户 Recon 报告', { scope: 'customer' }), []);
  assert.deepEqual(pickHermesSkills('帮我找俄罗斯工业客户', { scope: 'all' }), []);
});

test('follow-up questions stay locked to the current customer scope', () => {
  assert.equal(
    deterministicKind('官网还有什么信息', { scope: 'customer', customerId: 'BR-1901' }),
    'current_customer',
  );
});

test('Hermes session ids are parsed and resumed without shell interpretation', () => {
  const sessionId = '20260719_164056_d42056';
  assert.equal(validHermesSessionId(sessionId), sessionId);
  assert.equal(validHermesSessionId('../../bad'), '');
  assert.deepEqual(
    parseHermesOutput(`session_id: ${sessionId}\n第二轮回答`, ''),
    { answer: '第二轮回答', sessionId },
  );
  assert.deepEqual(
    parseHermesOutput('第二轮回答', '', `session_id: ${sessionId}`),
    { answer: '第二轮回答', sessionId },
  );
  const args = buildHermesArgs('继续回答', { sessionId });
  assert.equal(args[args.indexOf('--resume') + 1], sessionId);
  assert.ok(!args.includes('--pass-session-id'));
});

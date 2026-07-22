const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKimiArgs,
  buildKimiPrompt,
  effectiveKimiTimeout,
  parseKimiOutput,
} = require('../lib/kimi_assistant');

test('Kimi CLI prompt keeps the CRM evidence boundary', () => {
  const prompt = buildKimiPrompt([{ role: 'user', content: '分析当前客户' }], { scope: 'customer' });
  assert.match(prompt, /受限 Kimi CLI 外贸研究助手/);
  assert.match(prompt, /只读证据包/);
  assert.match(prompt, /禁止修改 CRM/);
});

test('Kimi accepts a bounded per-request timeout without changing global config', () => {
  const configured = require('../lib/kimi_assistant').kimiConfig().timeoutMs;
  assert.equal(effectiveKimiTimeout({ timeoutMs: 12000 }), 12000);
  assert.equal(require('../lib/kimi_assistant').kimiConfig().timeoutMs, configured);
});

test('Kimi CLI uses print mode, isolated skills and a resumable session', () => {
  const sessionId = 'session_3653163d-8e1d-4d83-84e2-baca17d110d4';
  const args = buildKimiArgs('继续回答', { sessionId });
  assert.equal(args[args.indexOf('--session') + 1], sessionId);
  assert.ok(args.includes('-p'));
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--skills-dir'));
  assert.ok(!args.includes('--yolo'));
  assert.ok(!args.includes('--auto'));
});

test('Kimi CLI stream-json output returns answer and session id', () => {
  const stdout = [
    '{"role":"assistant","content":"第一段"}',
    '{"role":"assistant","content":"第二段"}',
    '{"role":"meta","type":"session.resume_hint","session_id":"session_3653163d-8e1d-4d83-84e2-baca17d110d4"}',
  ].join('\n');
  assert.deepEqual(parseKimiOutput(stdout), {
    answer: '第一段第二段',
    sessionId: 'session_3653163d-8e1d-4d83-84e2-baca17d110d4',
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { callQwen } = require('../lib/qwen_assistant');
const { onlineModelPolicy, stationModel } = require('../lib/ai_stations/model_policy');

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[String(name).toLowerCase()] || '' },
    text: async () => JSON.stringify(body),
  };
}

test('Qwen adapter sends configurable generation settings and returns provider metadata', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return response(200, {
      id: 'chat-1',
      request_id: 'req-body',
      model: 'qwen3.7-flash',
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    });
  };
  const result = await callQwen([{ role: 'user', content: 'test' }], {
    apiKey: 'test-secret',
    endpoint: 'https://example.test/chat',
    model: 'qwen3.7-flash',
    temperature: 0.1,
    topP: 0.7,
    maxTokens: 321,
  });
  assert.equal(captured.url, 'https://example.test/chat');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(captured.body, {
    model: 'qwen3.7-flash',
    messages: [{ role: 'user', content: 'test' }],
    temperature: 0.1,
    top_p: 0.7,
    max_tokens: 321,
  });
  assert.deepEqual(result, {
    answer: '{"ok":true}',
    model: 'qwen3.7-flash',
    requestId: 'req-body',
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    finishReason: 'stop',
  });
});

test('Qwen adapter classifies HTTP, timeout, cancellation, network and configuration failures', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const cases = [
    [401, 'QWEN_AUTH_ERROR'],
    [400, 'QWEN_REQUEST_ERROR'],
    [429, 'QWEN_RATE_LIMITED'],
    [503, 'QWEN_PROVIDER_ERROR'],
  ];
  for (const [status, code] of cases) {
    global.fetch = async () => response(status, { error: { message: 'provider rejected' } });
    await assert.rejects(() => callQwen([], { apiKey: 'key' }), error =>
      error.code === code && error.statusCode === status && !JSON.stringify(error).includes('key'));
  }
  global.fetch = async () => { throw new Error('socket detail'); };
  await assert.rejects(() => callQwen([], { apiKey: 'key' }), error =>
    error.code === 'QWEN_NETWORK_ERROR' && error.statusCode === 502);
  await assert.rejects(() => callQwen([], { apiKey: '' }), error =>
    error.code === 'QWEN_NOT_CONFIGURED' && error.statusCode === 503);

  const controller = new AbortController();
  controller.abort();
  global.fetch = async (_url, options) => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    assert.equal(options.signal.aborted, true);
    throw error;
  };
  await assert.rejects(() => callQwen([], { apiKey: 'key', signal: controller.signal }), error =>
    error.code === 'QWEN_CANCELLED' && error.statusCode === 499);
});

test('station model policy selects flash, plus and direct DeepSeek Pro fallback', () => {
  assert.equal(stationModel('customer_fit', {}, {}), 'qwen3.7-flash');
  assert.equal(stationModel('manager_anomaly', {}, {}), 'qwen3.7-flash');
  assert.equal(stationModel('sales_pack', {}, {}), 'qwen3.7-plus');
  assert.equal(stationModel('sales_coaching', {}, {}), 'qwen3.7-plus');
  assert.deepEqual(onlineModelPolicy('next_action', {}, {}), {
    qwen: 'qwen3.7-plus',
    deepseek: 'deepseek-v4-pro',
  });
  assert.equal(stationModel('customer_fit', {
    mapping: { customer_fit: 'qwen-custom' },
  }, {}), 'qwen-custom');
});

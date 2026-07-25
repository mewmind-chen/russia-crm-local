'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { presentAIResult } = require('../lib/ai_stations/presentation');

const componentUrl = pathToFileURL(path.join(
  __dirname, '..', 'sales-assets', 'components', 'ai-result.js',
)).href;
const aiControlUrl = pathToFileURL(path.join(
  __dirname, '..', 'sales-assets', 'modules', 'ai-control', 'index.js',
)).href;

function view(overrides = {}) {
  return presentAIResult({
    job: {
      station: 'next_action',
      trigger: { source: 'legacy_unknown' },
    },
    result: {
      generatedAt: '2026-07-26T10:00:00.000Z',
      value: {
        nextAction: '安排需求会议',
        nextActionAt: '2026-08-01',
        reason: '客户已回复',
        confidence: 0.88,
      },
    },
    evidence: [{
      id: 'EV-1',
      kind: 'crm',
      summary: '客户已回复邮件',
      sourceUrl: 'https://evidence.example/1',
    }],
    coverage: {
      state: 'partial',
      missingFields: ['采购时间'],
      metrics: [{ label: '历史成交率', numerator: 0, denominator: 0 }],
    },
    permissions: {
      use_ai_assistant: true,
      record_activity: true,
      view_contacts: true,
      view_recon: true,
    },
    ...overrides,
  });
}

test('AI result component renders the server layers in business order', async () => {
  const { renderAIResult } = await import(componentUrl);
  const html = renderAIResult(view(), { adopt() {} });
  const layers = ['what', 'trigger', 'facts', 'rules', 'inference', 'human-decision', 'system-action'];
  let previous = -1;
  for (const layer of layers) {
    const position = html.indexOf(`data-ai-layer="${layer}"`);
    assert.ok(position > previous, layer);
    previous = position;
  }
  assert.match(html, /AI 推断/);
  assert.match(html, /来源未记录/);
  assert.match(html, /数据覆盖/);
  assert.match(html, /AI 置信度/);
  assert.match(html, /暂无样本/);
  assert.match(html, /动作会发生|确认后会发生/);
});

test('renderer uses server action labels, state, and side effects without station logic', async () => {
  const { renderAIResult } = await import(componentUrl);
  const model = view({
    result: {
      stale: true,
      value: {
        nextAction: '安排需求会议',
        nextActionAt: '2026-08-01',
        reason: '客户已回复',
        confidence: 0.88,
      },
    },
  });
  const html = renderAIResult(model, { adopt() {}, regenerate() {} });
  assert.match(html, /结果已过期/);
  assert.match(html, /data-ai-result-action="adopt"[\s\S]*disabled/);
  assert.match(html, /重新生成/);
  assert.match(html, /生成建议本身不写入 CRM/);
  assert.doesNotMatch(html, /customer_fit|next_action|sales_pack/);
});

test('restricted evidence and operational internals never appear in UI output', async () => {
  const { renderAIResult } = await import(componentUrl);
  const model = presentAIResult({
    job: { station: 'sales_pack', trigger: { source: 'manual', actorId: 'U-1' } },
    result: {
      prompt: 'PROMPT SECRET',
      usage: { total_tokens: 500 },
      cost: 4.2,
      value: {
        summary: '开发资料',
        draft: { body: '你好' },
        confidence: 0.9,
      },
    },
    evidence: [{
      kind: 'contact',
      summary: 'secret@example.test',
      sourceUrl: 'https://secret.example',
    }],
    coverage: { state: 'partial' },
    permissions: { use_ai_assistant: true, view_contacts: false, view_recon: true },
  });
  const html = renderAIResult(model);
  assert.match(html, /部分依据因权限不可见/);
  assert.doesNotMatch(html, /secret@example|secret\.example|PROMPT SECRET|total_tokens|500|4\.2/);
  assert.match(html, /绝不自动发送消息/);
});

test('manager task detail shows the business result while technical trace stays admin-only', async () => {
  const module = await import(aiControlUrl);
  const presentation = view();
  const task = {
    taskId: 'AIJ-1',
    taskType: 'next_action',
    customerId: 'RU-1',
    state: 'needs_review',
    trigger: { source: 'business_event' },
    presentation,
    attempts: [{ attempt: 1, engine: 'secret-engine', status: 'failed', durationMs: 123 }],
    timeline: [{ kind: 'finished', state: 'needs_review', at: '2026-07-26' }],
    decisionTrace: {
      model: 'secret-model',
      promptVersion: 'secret-prompt',
      stationVersion: 'v1',
      ruleVersion: 'v1',
    },
    canReview: true,
  };
  const data = {
    state: 'ready',
    page: 1,
    pageSize: 20,
    total: 1,
    items: [],
    overview: null,
    filters: { state: '', type: '', customer: '', search: '' },
    governance: null,
    selectedTask: task,
    loading: false,
    error: '',
    notice: '',
  };
  const renderFor = role => {
    const mount = { innerHTML: '' };
    module.render({
      mount,
      data: { ...data, governance: role === 'admin' ? { metrics: [], strategies: [] } : null },
      access: {
        role,
        permissions: { review_ai_tasks: true, cancel_ai_tasks: true },
        impersonating: false,
      },
      lifecycle: { disposed: false, listen() {}, signal: new AbortController().signal },
    });
    return mount.innerHTML;
  };
  const manager = renderFor('manager');
  assert.match(manager, /来源事实[\s\S]*确定性规则[\s\S]*AI 推断[\s\S]*人工决定[\s\S]*系统动作/);
  assert.doesNotMatch(manager, /secret-engine|secret-model|secret-prompt|模型尝试|Prompt 版本/);
  const admin = renderFor('admin');
  assert.match(admin, /secret-engine|secret-model|secret-prompt|模型尝试|Prompt 版本/);
  module.dispose();
});

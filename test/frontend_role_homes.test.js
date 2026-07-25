'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function importHome(name) {
  return import(pathToFileURL(path.join(root, 'sales-assets/modules', name, 'index.js')).href);
}

test('all role homes implement the module lifecycle contract', async () => {
  for (const name of ['my-today', 'team-dashboard', 'team-tasks']) {
    const module = await importHome(name);
    assert.equal(module.id, name);
    for (const method of ['load', 'render', 'dispose']) assert.equal(typeof module[method], 'function');
  }
});

test('sales home separates adopted CRM actions from unreviewed suggestions', async () => {
  const home = await importHome('my-today');
  const data = home.selectMyTodayItems({
    user: { id: 'U-SALES' },
    accounts: [{
      id: 'CRM-1', company_name: '已确认客户', stage: 'qualified',
      next_action: '今天联系采购', next_action_at: '',
    }],
    notifications: [{
      id: 'N-1', user_id: 'U-SALES', status: 'unread',
      code: 'NEXT_ACTION_READY', title: '建议联系另一客户',
    }],
    alerts: [],
    intake: { items: [] },
  });
  assert.equal(data.formalTasks.length, 1);
  assert.equal(data.aiSuggestions.length, 1);
  assert.equal(data.formalTasks.some(item => item.id === 'N-1'), false);
  const output = home.render({ data });
  assert.match(output, /正式待办<\/span><strong>1/);
  assert.match(output, /尚未采纳的建议不计入正式待办/);
});

test('sales module does not expose management or operational administration surfaces', async () => {
  const home = await importHome('my-today');
  const source = fs.readFileSync(path.join(root, 'sales-assets/modules/my-today/index.js'), 'utf8');
  const output = home.render({ data: {} });
  for (const forbidden of ['团队洞察', 'AI 治理', '数据维护', 'AI 任务中心']) {
    assert.doesNotMatch(source, new RegExp(forbidden));
    assert.doesNotMatch(output, new RegExp(forbidden));
  }
});

test('manager dashboard avoids a false zero conversion when no RFQ sample exists', async () => {
  const dashboard = await importHome('team-dashboard');
  assert.equal(dashboard.buildDashboard({ summary: { rfqs: 0, orders: 0 } }).orderRate, '暂无样本');
  assert.equal(dashboard.buildDashboard({ summary: { rfqs: 4, orders: 1 } }).orderRate, '25%');
});

test('manager tasks put deterministic rules before isolated AI advice', async () => {
  const tasks = await importHome('team-tasks');
  const data = tasks.buildTeamTasks({
    alerts: [{ id: 'A-1', title: '报价超时', detail: '已超过24小时', action: '协调报价' }],
  }, [{
    id: 'AI-1',
    companyName: '客户甲',
    ai: { stale: false, result: { value: { explanation: '可能阻塞', interventionSuggestion: '先确认原因' } } },
  }]);
  assert.equal(data.formalTasks.length, 1);
  assert.equal(data.formalTasks.some(item => item.id === 'AI-1'), false);
  const output = tasks.render({ data });
  assert.ok(output.indexOf('规则异常 · 正式待办') < output.indexOf('AI 解释与介入建议'));
  assert.match(output, /未采纳前不计入正式待办/);
});

test('dispose aborts active requests and clears scheduled refresh', async () => {
  const home = await importHome('my-today');
  let aborted = false;
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = callback => {
    const timer = { callback, cleared: false, unref() {} };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { timer.cleared = true; };
  try {
    await home.load({
      lifecycle: {
        createAbortController() {
          return { signal: {}, abort() { aborted = true; } };
        },
      },
      services: {
        session: { bootstrap: async () => ({ user: {}, intake: { items: [] } }) },
      },
      pollIntervalMs: 100,
    });
    home.dispose();
    assert.equal(aborted, true);
    assert.equal(timers[0].cleared, true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

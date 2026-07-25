'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const moduleRoot = path.join(root, 'sales-assets', 'modules');

function importModule(name) {
  return import(pathToFileURL(path.join(moduleRoot, name, 'index.js')).href);
}

function source(name) {
  return fs.readFileSync(path.join(moduleRoot, name, 'index.js'), 'utf8');
}

function mount() {
  return {
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
  };
}

function lifecycle() {
  const controller = new AbortController();
  return {
    disposed: false,
    signal: controller.signal,
    createAbortController: () => new AbortController(),
    listen() {},
  };
}

function context(overrides = {}) {
  return {
    mount: mount(),
    lifecycle: lifecycle(),
    access: {
      role: 'manager',
      permissions: {
        view_team: true,
        view_insights: true,
        view_markets: true,
        view_pool: true,
        view_contacts: true,
        view_recon: true,
        use_ai_assistant: true,
      },
      featureFlags: { aiStations: true },
      impersonating: false,
    },
    services: {},
    ...overrides,
  };
}

test('management modules expose the common lifecycle contract and explicit failure states', async () => {
  for (const name of ['team-insights', 'intelligence', 'assistant', 'administration']) {
    const module = await importModule(name);
    assert.equal(module.id, name);
    assert.equal(typeof module.load, 'function');
    assert.equal(typeof module.render, 'function');
    assert.equal(typeof module.dispose, 'function');
    const text = source(name);
    for (const state of ['正在加载', '暂无', '失败', '403']) assert.match(text, new RegExp(state), `${name}:${state}`);
  }
  assert.match(source('intelligence'), /hasMore/);
  assert.match(source('intelligence'), /data-load-more/);
});

test('team insights uses scoped bootstrap data and renders deterministic metrics before AI coaching', async () => {
  const team = await importModule('team-insights');
  const calls = [];
  const ctx = context({
    services: {
      session: {
        bootstrap(sections) {
          calls.push(sections);
          return Promise.resolve({
            teamReport: [{
              user: { id: 'U-1', name: 'Sales One' },
              scores: { activation: 80 },
              rates: { activation: 50, reply: 20, rfq: 10, order: 5 },
              sampleSize: 12,
              sampleStatus: '有限样本',
              bestCountries: ['RU'],
              bestChannels: ['Email'],
              overall: 70,
            }],
            countryReport: [{ country: 'RU', accounts: 12 }],
          });
        },
      },
      ai: { salesCoaching: async () => ({ items: [] }) },
    },
  });
  const data = await team.load(ctx);
  data.selectedUserId = 'U-1';
  team.render({ ...ctx, data });

  assert.deepEqual(calls, [['core', 'team', 'intelligence']]);
  assert.match(ctx.mount.innerHTML, /当前管理范围/);
  assert.match(ctx.mount.innerHTML, /data-section="deterministic-metrics"/);
  assert.ok(ctx.mount.innerHTML.indexOf('data-section="deterministic-metrics"')
    < ctx.mount.innerHTML.indexOf('data-section="ai-coaching"'));
  assert.match(source('team-insights'), /样本不足（\$\{sampleSize\}\/10）/);
});

test('intelligence delegates row scope and pagination to the research service', async () => {
  const intelligence = await importModule('intelligence');
  const calls = [];
  const ctx = context({
    services: {
      intelligence: {
        async research(kind, query) {
          calls.push({ kind, query });
          return {
            rows: [{ customer_id: `ROW-${kind}`, company_name: kind }],
            page: query.page,
            total: 2,
            hasMore: true,
          };
        },
      },
    },
  });
  const data = await intelligence.load(ctx);
  intelligence.render({ ...ctx, data });

  assert.deepEqual(calls.map(call => call.kind).sort(), ['people', 'pool', 'recon']);
  assert.ok(calls.every(call => call.query.page === 1 && call.query.pageSize === 50));
  assert.match(ctx.mount.innerHTML, /已显示 1 \/ 2/);
  assert.match(ctx.mount.innerHTML, /继续加载/);
  assert.doesNotMatch(source('intelligence'), /view_all_customers|unscoped/);
});

test('assistant restores history and keeps the visible scope in every chat request', async () => {
  const assistant = await importModule('assistant');
  const ctx = context({
    services: {
      ai: {
        conversations: async () => ({
          conversations: [{
            id: 'ASSTC-1',
            title: '客户跟进',
            scope: { customerId: 'RU-1', companyName: 'Scoped Co' },
            messageCount: 2,
          }],
        }),
      },
    },
  });
  const data = await assistant.load(ctx);
  assistant.render({ ...ctx, data });

  assert.match(ctx.mount.innerHTML, /会话历史/);
  assert.match(ctx.mount.innerHTML, /Scoped Co/);
  assert.match(ctx.mount.innerHTML, /本次请求范围/);
  assert.match(source('assistant'), /conversationId: data\.selectedId/);
  assert.match(source('assistant'), /context: data\.scope/);
  assert.match(source('assistant'), /clientMessageId/);
});

test('administration is admin-only and retains users, permissions, identity, maintenance and reports', async () => {
  const administration = await importModule('administration');
  const manager = context({
    access: {
      role: 'manager',
      permissions: { view_users: true, manage_users: true },
      impersonating: false,
    },
  });
  const denied = await administration.load(manager);
  administration.render({ ...manager, data: denied });
  assert.match(manager.mount.innerHTML, /403/);
  assert.doesNotMatch(manager.mount.innerHTML, /data-admin-panel="users"/);

  const admin = context({
    access: {
      role: 'admin',
      permissions: {
        view_users: true,
        manage_users: true,
        manage_data_maintenance: true,
        export_data: true,
      },
      impersonating: false,
    },
    services: {
      session: {
        bootstrap: async () => ({
          users: [{ id: 'U-1', name: 'Admin', email: 'a@test', role: 'admin', active: true }],
          archivedUsers: [],
          permissionGroups: [],
          permissionDefinitions: {},
          auditLog: [],
          migrationReview: [],
          countryReport: [],
          cohortReport: [],
        }),
      },
      administration: {
        maintenanceRuns: async () => ({ runs: [] }),
        assistantRuntime: async () => ({}),
      },
      ai: { features: async () => ({ features: {} }) },
    },
  });
  const loaded = await administration.load(admin);
  administration.render({ ...admin, data: loaded });
  const text = source('administration');

  for (const key of ['users', 'permissions', 'identity', 'maintenance', 'reports', 'ai', 'audit']) {
    assert.match(text, new RegExp(`data-admin-panel="${key}"`), key);
  }
  for (const entry of [
    'createUser', 'replacePermissionOverrides', 'startImpersonation',
    'previewMaintenance', 'executeMaintenance', '/api/sales-crm/export',
  ]) assert.match(text, new RegExp(entry), entry);
  assert.match(text, /permissionGroupId/);
  assert.match(text, /\{ password, passwordConfirm \}/);
  assert.match(text, /updateAssistantRuntime/);
  assert.match(text, /recheckAssistantRuntime/);
  assert.match(text, /updateFeature/);
  assert.match(admin.mount.innerHTML, /系统管理/);
  assert.match(admin.mount.innerHTML, /管理员专用，不进入经理日常工作区/);
});

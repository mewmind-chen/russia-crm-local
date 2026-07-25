'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const servicesRoot = path.join(__dirname, '..', 'sales-assets', 'services');

function importService(name) {
  return import(pathToFileURL(path.join(servicesRoot, name)).href);
}

function recorder() {
  const calls = [];
  return {
    calls,
    api(url, options = {}) {
      calls.push({ url, options });
      return Promise.resolve({ ok: true });
    },
  };
}

function decodedBody(call) {
  return JSON.parse(call.options.body);
}

test('session service owns authentication, bootstrap, password, and impersonation requests', async () => {
  const { createSessionService } = await importService('session.js');
  const mock = recorder();
  const service = createSessionService(mock.api);

  await service.bootstrap(['core', 'today'], { timeoutMs: 15000 });
  await service.login({ email: 'sales@example.com', password: 'secret' });
  await service.changePassword({ currentPassword: 'old', newPassword: 'new' });
  await service.startImpersonation('U / 2');
  await service.stopImpersonation();
  await service.logout();

  assert.equal(mock.calls[0].url, '/api/sales-crm/bootstrap?sections=core%2Ctoday');
  assert.equal(mock.calls[0].options.timeoutMs, 15000);
  assert.equal(mock.calls[1].url, '/api/sales-auth/login');
  assert.equal(mock.calls[1].options.method, 'POST');
  assert.deepEqual(decodedBody(mock.calls[1]), { email: 'sales@example.com', password: 'secret' });
  assert.equal(mock.calls[2].url, '/api/sales-crm/password');
  assert.equal(mock.calls[3].url, '/api/sales-crm/impersonation/start');
  assert.deepEqual(decodedBody(mock.calls[3]), { targetUserId: 'U / 2' });
  assert.equal(mock.calls[4].url, '/api/sales-crm/impersonation/stop');
  assert.equal(mock.calls[5].url, '/api/sales-auth/logout');
});

test('customer service owns customer CRUD, recycle, bulk assignment, and export requests', async () => {
  const { createCustomerService } = await importService('customers.js');
  const mock = recorder();
  const service = createCustomerService(mock.api);

  await service.create({ companyName: 'Acme' });
  await service.getProfile('RU / 1');
  await service.update('CRM / 1', { priority: 'A' });
  await service.bulkAssign({ customerIds: ['CRM-1'], ownerId: 'U-1' });
  await service.listRecycleBin({ kind: 'sales_return', page: 2, search: 'A B' });
  await service.bulkReturn({ customerIds: ['CRM-1'], reason: 'rebalance' });
  await service.returnToPool('CRM-1', { reason: 'return' });
  await service.trash('CRM-2', { reason: 'duplicate' });
  await service.restore('CRM-3');
  await service.reassign('CRM-4', { ownerId: 'U-2', reason: 'territory' });

  assert.equal(mock.calls[0].url, '/api/sales-crm/accounts');
  assert.equal(mock.calls[0].options.method, 'POST');
  assert.equal(mock.calls[1].url, '/api/sales-crm/profile/RU%20%2F%201');
  assert.equal(mock.calls[2].url, '/api/sales-crm/accounts/CRM%20%2F%201');
  assert.equal(mock.calls[2].options.method, 'PATCH');
  assert.equal(mock.calls[3].url, '/api/sales-crm/accounts/bulk-assign');
  assert.equal(mock.calls[4].url, '/api/sales-crm/accounts/recycle-bin?kind=sales_return&page=2&search=A+B');
  assert.equal(mock.calls[5].url, '/api/sales-crm/accounts/bulk-return');
  assert.equal(mock.calls[6].url, '/api/sales-crm/accounts/CRM-1/return');
  assert.equal(mock.calls[7].url, '/api/sales-crm/accounts/CRM-2/trash');
  assert.equal(mock.calls[8].url, '/api/sales-crm/accounts/CRM-3/restore');
  assert.equal(mock.calls[9].url, '/api/sales-crm/accounts/CRM-4/reassign');
  assert.equal(service.exportUrl({ format: 'csv', search: 'A B' }), '/api/sales-crm/export?format=csv&search=A+B');
});

test('intake and activity services own lead, activity, RFQ, quote, order, and notification requests', async () => {
  const [{ createIntakeService }, { createActivityService }] = await Promise.all([
    importService('intake.js'),
    importService('activities.js'),
  ]);
  const mock = recorder();
  const intake = createIntakeService(mock.api);
  const activities = createActivityService(mock.api);

  await intake.list({ page: 3, status: 'assigned' }, { timeoutMs: 12000 });
  await intake.scan();
  await intake.act({ action: 'claim', itemId: 'I-1' });
  await intake.updateSettings({ enabled: true });
  await activities.create({ activityType: 'rfq' });
  await activities.createQuote({ amount: 100 });
  await activities.createOrder({ amount: 90 });
  await activities.createContact({ name: 'Buyer' });
  await activities.createEvaluation({ subjectType: 'company' });
  await activities.retryEvaluation('E / 1');
  await activities.markNotificationRead('N / 1');

  assert.equal(mock.calls[0].url, '/api/sales-crm/intake?page=3&status=assigned');
  assert.equal(mock.calls[0].options.timeoutMs, 12000);
  assert.equal(mock.calls[1].url, '/api/sales-crm/intake/scan');
  assert.equal(mock.calls[2].url, '/api/sales-crm/intake/action');
  assert.equal(mock.calls[3].url, '/api/sales-crm/intake/settings');
  assert.equal(mock.calls[3].options.method, 'PATCH');
  assert.equal(mock.calls[4].url, '/api/sales-crm/activities');
  assert.equal(mock.calls[5].url, '/api/sales-crm/quotes');
  assert.equal(mock.calls[6].url, '/api/sales-crm/orders');
  assert.equal(mock.calls[7].url, '/api/sales-crm/contacts');
  assert.equal(mock.calls[8].url, '/api/sales-crm/evaluations');
  assert.equal(mock.calls[9].url, '/api/sales-crm/evaluations/E%20%2F%201/retry');
  assert.equal(mock.calls[10].url, '/api/sales-crm/notifications/N%20%2F%201/read');
});

test('intelligence and AI services own research and AI workflow requests', async () => {
  const [{ createIntelligenceService }, { createAIService }] = await Promise.all([
    importService('intelligence.js'),
    importService('ai.js'),
  ]);
  const mock = recorder();
  const intelligence = createIntelligenceService(mock.api);
  const ai = createAIService(mock.api);

  await intelligence.research('people', { page: 2, search: 'Buyer A' });
  await ai.chat({ message: 'Summarize this account' });
  await ai.customerResults('RU-1');
  await ai.customerEnrichment('RU-1');
  await ai.runCustomerEnrichment('RU-1', { force: true });
  await ai.runCustomerFit('RU-1');
  await ai.runSalesPack('RU-1');
  await ai.listTasks({ state: 'queued', pageSize: 20 });
  await ai.getTask('JOB-1');
  await ai.retryJob('JOB-1');
  await ai.adoptNextAction('JOB-1', { idempotencyKey: 'once' });
  await ai.governance();
  await ai.strategyAction('STRAT-1', 'request-publish', {});
  await ai.managerAnomalies();
  await ai.runSalesCoaching('U-1', {});
  await ai.features();
  await ai.updateFeature('sales_pack', { enabled: true });

  assert.equal(mock.calls[0].url, '/api/sales-crm/research/people?page=2&search=Buyer+A');
  assert.equal(mock.calls[1].url, '/api/assistant/chat');
  assert.equal(mock.calls[2].url, '/api/sales-crm/ai/customers/RU-1/results');
  assert.equal(mock.calls[3].url, '/api/sales-crm/ai/customers/RU-1/enrichment');
  assert.equal(mock.calls[4].url, '/api/sales-crm/ai/customers/RU-1/enrichment/run');
  assert.equal(mock.calls[5].url, '/api/sales-crm/ai/customers/RU-1/stations/customer_fit/run');
  assert.equal(mock.calls[6].url, '/api/sales-crm/ai/customers/RU-1/stations/sales_pack/run');
  assert.equal(mock.calls[7].url, '/api/sales-crm/ai/tasks?state=queued&pageSize=20');
  assert.equal(mock.calls[8].url, '/api/sales-crm/ai/tasks/JOB-1');
  assert.equal(mock.calls[9].url, '/api/sales-crm/ai/jobs/JOB-1/retry');
  assert.equal(mock.calls[10].url, '/api/sales-crm/ai/jobs/JOB-1/next-action/adopt');
  assert.equal(mock.calls[11].url, '/api/sales-crm/ai/governance');
  assert.equal(mock.calls[12].url, '/api/sales-crm/ai/governance/strategies/STRAT-1/request-publish');
  assert.equal(mock.calls[13].url, '/api/sales-crm/ai/manager-anomalies');
  assert.equal(mock.calls[14].url, '/api/sales-crm/ai/sales-coaching/U-1/run');
  assert.equal(mock.calls[15].url, '/api/sales-crm/ai/features');
  assert.equal(mock.calls[16].options.method, 'PATCH');
});

test('administration service owns users, permissions, maintenance, and assistant runtime requests', async () => {
  const { createAdministrationService } = await importService('administration.js');
  const mock = recorder();
  const service = createAdministrationService(mock.api);

  await service.createUser({ email: 'new@example.com' });
  await service.updateUser('U / 1', { active: false });
  await service.archiveUser('U-1');
  await service.restoreUser('U-1');
  await service.deleteUser('U-1');
  await service.resetPassword('U-1', { password: 'NewPassword123!' });
  await service.createPermissionGroup({ name: 'Sales' });
  await service.updatePermissionGroup('G / 1', { name: 'Senior Sales' });
  await service.replacePermissionOverrides('U-1', { view_team: 'allow' });
  await service.resolveMigrationReview('R-1', { ownerId: 'U-1' });
  await service.maintenanceRuns({ limit: 20 });
  await service.previewMaintenance({ operation: 'cleanup' });
  await service.executeMaintenance({ token: 'preview-1' });
  await service.assistantRuntime();
  await service.updateAssistantRuntime({ mode: 'online' });
  await service.recheckAssistantRuntime();

  assert.equal(mock.calls[0].url, '/api/sales-crm/users');
  assert.equal(mock.calls[1].url, '/api/sales-crm/users/U%20%2F%201');
  assert.equal(mock.calls[1].options.method, 'PATCH');
  assert.equal(mock.calls[2].url, '/api/sales-crm/users/U-1/archive');
  assert.equal(mock.calls[3].url, '/api/sales-crm/users/U-1/restore');
  assert.equal(mock.calls[4].options.method, 'DELETE');
  assert.equal(mock.calls[5].url, '/api/sales-crm/users/U-1/password-reset');
  assert.equal(mock.calls[6].url, '/api/sales-crm/permission-groups');
  assert.equal(mock.calls[7].url, '/api/sales-crm/permission-groups/G%20%2F%201');
  assert.equal(mock.calls[8].options.method, 'PUT');
  assert.equal(mock.calls[9].url, '/api/sales-crm/migration-review/R-1');
  assert.equal(mock.calls[10].url, '/api/sales-crm/data-maintenance/runs?limit=20');
  assert.equal(mock.calls[11].url, '/api/sales-crm/data-maintenance/preview');
  assert.equal(mock.calls[12].url, '/api/sales-crm/data-maintenance/execute');
  assert.equal(mock.calls[13].url, '/api/assistant/runtime');
  assert.equal(mock.calls[14].options.method, 'PATCH');
  assert.equal(mock.calls[15].url, '/api/assistant/runtime/recheck');
});

test('legacy app delegates business HTTP calls to the service layer', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  for (const factory of [
    'createSessionService',
    'createCustomerService',
    'createIntakeService',
    'createActivityService',
    'createIntelligenceService',
    'createAIService',
    'createAdministrationService',
  ]) {
    assert.match(app, new RegExp(`import \\{ ${factory} \\} from './services/`));
    assert.match(app, new RegExp(`${factory}\\(api\\)`));
  }
  assert.doesNotMatch(app, /\bapi\(\s*['"`]\/api\//);
});

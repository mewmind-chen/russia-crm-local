'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

const TEAM_ROUTE = '/api/sales-crm/team-status';
const COLLABORATION_ROUTE = '/api/sales-crm/collaboration-support';

function collaborationBody(overrides = {}) {
  return {
    salesUserId: 'U-OTHER',
    customerId: 'RU-9003',
    problem: 'ROUTE_SECRET_PROBLEM：客户采购计划尚未确认',
    suggestion: 'ROUTE_SECRET_SUGGESTION：主管建议电话确认',
    outcome: '',
    nextStep: 'ROUTE_SECRET_NEXT_STEP：三天内完成确认',
    status: 'unresolved',
    idempotencyKey: 'issue174-route-event-1',
    ...overrides,
  };
}

function collaborationCounts(db) {
  return {
    events: db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count,
    audits: db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
      WHERE entity_type='collaboration_event'`).get().count,
  };
}

async function responseJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch (_error) { assert.fail(`expected JSON for ${response.status}: ${text}`); }
}

test('registerSalesCrm installs the additive team status schema and immutable event triggers', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  for (const table of ['crm_team_status_views', 'crm_collaboration_events']) {
    assert.ok(fx.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
    ).get(table), table);
  }
  const cursorColumns = fx.db.prepare('PRAGMA table_info(crm_team_status_views)').all();
  assert.deepEqual(
    cursorColumns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
      .map(column => column.name),
    ['user_id', 'view_key'],
  );
  for (const trigger of [
    'crm_collaboration_events_no_update',
    'crm_collaboration_events_no_delete',
  ]) {
    assert.ok(fx.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
    ).get(trigger), trigger);
  }
});

test('real team status routes enforce role permissions and expose authorized schemas', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const adminResponse = await fx.request(`${TEAM_ROUTE}?range=7d`, { cookie: fx.adminCookie });
  const adminBody = await responseJson(adminResponse);
  assert.equal(adminResponse.status, 200, adminBody.error);
  assert.equal(adminBody.ok, true);
  assert.equal(adminBody.range, '7d');
  assert.ok(adminBody.progress?.counts);
  assert.ok(Array.isArray(adminBody.capability));
  assert.ok(adminBody.collaboration?.rows);
  assert.match(adminResponse.headers.get('cache-control') || '', /no-store/i);

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const managerResponse = await fx.request(`${TEAM_ROUTE}?range=30d`, { cookie: managerCookie });
  assert.equal(managerResponse.status, 200, await managerResponse.text());

  const salesResponse = await fx.request(TEAM_ROUTE, { cookie: fx.otherCookie });
  assert.equal(salesResponse.status, 403);
  assert.match((await responseJson(salesResponse)).error, /权限/);

  const salesCollaboration = await fx.request(COLLABORATION_ROUTE, {
    cookie: fx.otherCookie,
  });
  const salesBody = await responseJson(salesCollaboration);
  assert.equal(salesCollaboration.status, 200, salesBody.error);
  assert.ok(salesBody.rows.every(row => row.salesUserId === 'U-OTHER'));
  assert.equal(JSON.stringify(salesBody).includes('RU-9002'), false);

  const schemaResponse = await fx.request(
    '/api/sales-crm/filter-schema/team_status_progress',
    { cookie: fx.adminCookie },
  );
  const schema = await responseJson(schemaResponse);
  assert.equal(schemaResponse.status, 200, schema.error);
  assert.equal(schema.schema.pageKey, 'team_status_progress');
  assert.ok(schema.schema.fields.some(field => field.key === 'progress_kind'));

  const stale = await fx.request(`${TEAM_ROUTE}?range=7d&permissionVersion=0`, {
    cookie: fx.adminCookie,
  });
  assert.equal(stale.status, 409);
  assert.equal((await responseJson(stale)).code, 'FILTER_VERSION_CONFLICT');
});

test('team and collaboration exports set exact JSON and CSV download headers', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const jsonResponse = await fx.request(
    `${TEAM_ROUTE}/export?section=progress&range=7d&format=json`,
    { cookie: fx.adminCookie },
  );
  assert.equal(jsonResponse.status, 200, await jsonResponse.clone().text());
  assert.match(jsonResponse.headers.get('content-type') || '', /^application\/json/i);
  assert.match(
    jsonResponse.headers.get('content-disposition') || '',
    /attachment;\s*filename="?crm-team-status-progress\.json"?/i,
  );
  const json = JSON.parse(await jsonResponse.text());
  assert.ok(Array.isArray(json));

  const csvResponse = await fx.request(
    `${COLLABORATION_ROUTE}/export?format=csv`,
    { cookie: fx.adminCookie },
  );
  assert.equal(csvResponse.status, 200, await csvResponse.clone().text());
  assert.match(csvResponse.headers.get('content-type') || '', /^text\/csv/i);
  assert.match(
    csvResponse.headers.get('content-disposition') || '',
    /attachment;\s*filename="?crm-team-status-collaboration\.csv"?/i,
  );
  assert.deepEqual(
    [...new Uint8Array(await csvResponse.arrayBuffer()).slice(0, 3)],
    [0xEF, 0xBB, 0xBF],
  );
});

test('since-last-view advances one server-owned cursor row without accepting client timestamps', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());

  const firstResponse = await fx.request(`${TEAM_ROUTE}/since-last-view`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {},
  });
  const first = await responseJson(firstResponse);
  assert.equal(firstResponse.status, 200, first.error);
  assert.ok(first.cursor.viewKey.startsWith('team-status:'));
  assert.equal(first.cursor.version, 1);
  assert.equal(first.fromExclusive < first.toInclusive, true);

  const secondResponse = await fx.request(`${TEAM_ROUTE}/since-last-view`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {},
  });
  const second = await responseJson(secondResponse);
  assert.equal(secondResponse.status, 200, second.error);
  assert.equal(second.cursor.viewKey, first.cursor.viewKey);
  assert.equal(second.cursor.version, first.cursor.version + 1);
  assert.equal(second.fromExclusive, first.toInclusive);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_team_status_views
    WHERE user_id='USR-ADMIN' AND view_key=?`).get(first.cursor.viewKey).count, 1);

  const forged = await fx.request(`${TEAM_ROUTE}/since-last-view`, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { fromExclusive: '2020-01-01 00:00:00' },
  });
  assert.equal(forged.status, 400);
  assert.equal((await responseJson(forged)).code, 'TEAM_STATUS_CURSOR_SERVER_MANAGED');
});

test('disabled collaboration gate returns 503 with zero event and audit side effects', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { teamStatusWritesEnabled: false } },
  });
  t.after(() => fx.close());
  const before = collaborationCounts(fx.db);

  const response = await fx.request(COLLABORATION_ROUTE, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: collaborationBody({ idempotencyKey: 'issue174-route-disabled' }),
  });
  const body = await responseJson(response);
  assert.equal(response.status, 503, body.error);
  assert.equal(body.code, 'TEAM_STATUS_WRITES_DISABLED');
  assert.deepEqual(collaborationCounts(fx.db), before);
});

test('enabled collaboration route audits the generated event id without storing raw note text', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { teamStatusWritesEnabled: true } },
  });
  t.after(() => fx.close());
  const beforeAuditId = fx.db.prepare('SELECT COUNT(*) count FROM crm_audit_log').get().count;

  const response = await fx.request(COLLABORATION_ROUTE, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: collaborationBody(),
  });
  const body = await responseJson(response);
  assert.equal(response.status, 201, body.error);
  assert.equal(body.ok, true);
  assert.match(body.event.eventId, /^COLL-/);
  assert.equal(body.event.deduplicated, false);

  const eventAudit = fx.db.prepare(`SELECT * FROM crm_audit_log
    WHERE entity_type='collaboration_event' AND entity_id=?
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(body.event.eventId);
  assert.ok(eventAudit, 'missing collaboration event audit');
  assert.equal(eventAudit.action, 'collaboration_recorded');
  assert.equal(eventAudit.user_id, 'USR-ADMIN');
  const newAudits = fx.db.prepare(`SELECT * FROM crm_audit_log
    ORDER BY created_at,id LIMIT -1 OFFSET ?`).all(beforeAuditId);
  const auditText = JSON.stringify(newAudits);
  assert.doesNotMatch(
    auditText,
    /ROUTE_SECRET_PROBLEM|ROUTE_SECRET_SUGGESTION|ROUTE_SECRET_NEXT_STEP/,
  );

  const replayResponse = await fx.request(COLLABORATION_ROUTE, {
    cookie: fx.adminCookie,
    method: 'POST',
    body: collaborationBody(),
  });
  const replay = await responseJson(replayResponse);
  assert.equal(replayResponse.status, 200, replay.error);
  assert.equal(replay.event.eventId, body.event.eventId);
  assert.equal(replay.event.deduplicated, true);
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_collaboration_events').get().count, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) count FROM crm_audit_log
    WHERE entity_type='collaboration_event' AND entity_id=?`).get(body.event.eventId).count, 1);
});

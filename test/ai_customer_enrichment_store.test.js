'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { AI_SCHEMA_VERSION, installAIStationSchema } = require('../lib/ai_stations/schema');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');

function fixture(options = {}) {
  const db = new Database(options.path || ':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS crm_accounts (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO customer_pool(customer_id,company_name) VALUES ('CUST-1','Fixture');
    INSERT OR IGNORE INTO crm_accounts(id,company_name) VALUES ('ACC-1','Fixture');
  `);
  installAIStationSchema(db);
  return db;
}

function input(overrides = {}) {
  return {
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    triggerSource: 'manual_create',
    triggeredBy: 'USR-1',
    inputFingerprint: 'a'.repeat(64),
    pipelineVersion: 'v1',
    ...overrides,
  };
}

test('schema v7 retains enrichment runtime and proposal tables idempotently', () => {
  const db = fixture();
  installAIStationSchema(db);
  assert.equal(AI_SCHEMA_VERSION, 7);
  assert.equal(db.prepare('SELECT MAX(version) version FROM crm_ai_schema_migrations').get().version, 7);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_ai_enrichment_%'").all()
    .map(row => row.name));
  assert.deepEqual(tables, new Set([
    'crm_ai_enrichment_evidence',
    'crm_ai_enrichment_runs',
    'crm_ai_enrichment_node_links',
    'crm_ai_enrichment_events',
  ]));
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM sqlite_master
    WHERE type='table' AND name='crm_ai_field_proposals'`).get().count, 1);
  const runColumns = new Set(db.prepare('PRAGMA table_info(crm_ai_enrichment_runs)').all()
    .map(row => row.name));
  for (const column of ['completeness', 'missing_items_json', 'tags_json']) {
    assert.equal(runColumns.has(column), true);
  }
  db.close();
});

test('same customer input and pipeline version reuses one durable trigger', () => {
  const db = fixture();
  let sequence = 0;
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${++sequence}`,
    now: () => new Date('2026-07-24T04:00:00.000Z'),
  });
  const first = store.createTrigger(input());
  const replay = store.createTrigger(input());
  assert.equal(replay.id, first.id);
  assert.equal(first.state, 'pending_dispatch');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_runs').get().count, 1);
  db.close();
});

test('competing dispatchers claim one trigger once and an expired lease recovers', () => {
  const db = fixture();
  let current = new Date('2026-07-24T04:00:00.000Z');
  const options = {
    idFactory: prefix => `${prefix}-1`,
    now: () => current,
    leaseMs: 1_000,
  };
  const first = createCustomerEnrichmentStore(db, options);
  const second = createCustomerEnrichmentStore(db, options);
  first.createTrigger(input());
  assert.equal(first.claimTrigger('dispatcher-a').dispatchOwner, 'dispatcher-a');
  assert.equal(second.claimTrigger('dispatcher-b'), null);
  current = new Date('2026-07-24T04:00:02.000Z');
  assert.equal(second.claimTrigger('dispatcher-b').dispatchOwner, 'dispatcher-b');
  db.close();
});

test('node links and completion events are idempotent and event leases recover', () => {
  const db = fixture();
  let sequence = 0;
  let current = new Date('2026-07-24T04:00:00.000Z');
  const store = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${++sequence}`,
    now: () => current,
    leaseMs: 1_000,
  });
  const run = store.createTrigger(input());
  const jobs = createAIJobStore(db, { idFactory: () => 'AIJ-1' });
  const job = jobs.enqueue({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'customer_fit',
    contextHash: 'b'.repeat(64),
  }, 'enrichment:test:job');
  const link = store.linkNode({
    runId: run.id,
    nodeKey: 'recon_collect',
    aiJobId: job.id,
    legacyTaskType: 'recon',
    legacyTaskId: 'RECON-1',
  });
  assert.equal(store.linkNode({
    runId: run.id,
    nodeKey: 'recon_collect',
    aiJobId: job.id,
    legacyTaskType: 'recon',
    legacyTaskId: 'RECON-1',
  }).id, link.id);

  const event = store.recordEvent({
    eventKey: 'recon:RECON-1:completed:v1',
    runId: run.id,
    nodeKey: 'recon_collect',
    legacyTaskType: 'recon',
    legacyTaskId: 'RECON-1',
    eventType: 'completed',
    payloadHash: 'c'.repeat(64),
  });
  assert.equal(store.recordEvent({
    eventKey: event.eventKey,
    runId: run.id,
    nodeKey: 'recon_collect',
    legacyTaskType: 'recon',
    legacyTaskId: 'RECON-1',
    eventType: 'completed',
    payloadHash: 'c'.repeat(64),
  }).id, event.id);
  assert.equal(store.claimEvent('consumer-a').leaseOwner, 'consumer-a');
  assert.equal(store.claimEvent('consumer-b'), null);
  current = new Date('2026-07-24T04:00:02.000Z');
  const recovered = store.claimEvent('consumer-b');
  assert.equal(recovered.leaseOwner, 'consumer-b');
  assert.equal(store.completeEvent(recovered.eventKey, 'consumer-b').state, 'consumed');
  db.close();
});

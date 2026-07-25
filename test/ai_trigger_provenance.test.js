'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { installAIStationSchema } = require('../lib/ai_stations/schema');

const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE customer_pool (customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    CREATE TABLE crm_accounts (id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '');
    INSERT INTO customer_pool(customer_id) VALUES ('CUST-1');
    INSERT INTO crm_accounts(id) VALUES ('ACC-1');
  `);
  return db;
}

function input(trigger) {
  return {
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    station: 'customer_fit',
    contextHash: HASH,
    createdBy: 'OWNER-1',
    trigger,
  };
}

test('legacy AI jobs migrate with an explicitly unknown trigger source', () => {
  const db = fixture();
  db.exec(`
    CREATE TABLE crm_ai_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE crm_ai_jobs (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, crm_account_id TEXT, station TEXT NOT NULL,
      state TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, context_hash TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}', attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3, priority INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT NOT NULL, lease_owner TEXT NOT NULL DEFAULT '',
      lease_expires_at TEXT NOT NULL DEFAULT '', error_summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO crm_ai_schema_migrations VALUES (16,'2026-07-25T00:00:00.000Z');
    INSERT INTO crm_ai_jobs (
      id,customer_id,station,state,idempotency_key,context_hash,next_run_at,created_by,created_at,updated_at
    ) VALUES (
      'AIJ-LEGACY','CUST-1','customer_fit','queued','legacy:key','${HASH}',
      '2026-07-25T00:00:00.000Z','OWNER-1','2026-07-25T00:00:00.000Z','2026-07-25T00:00:00.000Z'
    );
  `);

  installAIStationSchema(db);

  assert.deepEqual(createAIJobStore(db).getJob('AIJ-LEGACY').trigger, {
    source: 'legacy_unknown',
    eventType: '',
    eventId: '',
    actorId: '',
    workflowId: '',
    reason: '',
    triggeredAt: '',
  });
  db.close();
});

test('new AI jobs require authoritative trigger provenance and source-specific references', () => {
  const db = fixture();
  let sequence = 0;
  const jobs = createAIJobStore(db, {
    now: () => new Date('2026-07-25T08:30:00.000Z'),
    idFactory: () => `AIJ-${++sequence}`,
  });

  assert.throws(() => jobs.enqueue(input(undefined), 'trigger:missing'), /trigger is required/);
  assert.throws(
    () => jobs.enqueue(input({ source: 'legacy_unknown' }), 'trigger:legacy'),
    /invalid AI job trigger source/,
  );
  assert.throws(
    () => jobs.enqueue(input({ source: 'business_event' }), 'trigger:event-missing'),
    /business_event trigger requires eventType and eventId/,
  );
  assert.throws(
    () => jobs.enqueue(input({ source: 'workflow' }), 'trigger:workflow-missing'),
    /workflow trigger requires workflowId/,
  );

  const manual = jobs.enqueue(input({
    source: 'manual', actorId: 'ACTOR-1', reason: 'customer_fit_requested',
  }), 'trigger:manual');
  const businessEvent = jobs.enqueue(input({
    source: 'business_event', eventType: 'rfq_created', eventId: 'RFQ-1',
    actorId: 'ACTOR-2', reason: 'next_action_after_business_event',
  }), 'trigger:event');
  const workflow = jobs.enqueue(input({
    source: 'workflow', workflowId: 'AIW-1', actorId: 'ACTOR-3',
    reason: 'customer_enrichment_customer_fit',
  }), 'trigger:workflow');

  assert.deepEqual(manual.trigger, {
    source: 'manual',
    eventType: '',
    eventId: '',
    actorId: 'ACTOR-1',
    workflowId: '',
    reason: 'customer_fit_requested',
    triggeredAt: '2026-07-25T08:30:00.000Z',
  });
  assert.equal(manual.createdBy, 'OWNER-1');
  assert.notEqual(manual.trigger.actorId, manual.createdBy);
  assert.equal(businessEvent.eventType, 'rfq_created');
  assert.equal(businessEvent.eventId, 'RFQ-1');
  assert.equal(businessEvent.trigger.source, 'business_event');
  assert.equal(workflow.workflowId, 'AIW-1');
  assert.equal(workflow.trigger.workflowId, 'AIW-1');
  db.close();
});

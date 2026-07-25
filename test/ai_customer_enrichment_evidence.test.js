'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { AI_SCHEMA_VERSION, installAIStationSchema } = require('../lib/ai_stations/schema');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const {
  createEnrichmentEvidenceStore,
  canonicalEvidenceId,
} = require('../lib/ai_stations/enrichment/evidence');

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO customer_pool(customer_id,company_name) VALUES ('CUST-1','Evidence Fixture');
    INSERT INTO crm_accounts(id,company_name) VALUES ('ACC-1','Evidence Fixture');
  `);
  installAIStationSchema(db);
  const runs = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-1`,
    now: () => new Date('2026-07-24T09:00:00.000Z'),
  });
  const run = runs.createTrigger({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    triggerSource: 'manual_create',
    triggeredBy: 'U-1',
    inputFingerprint: 'a'.repeat(64),
    pipelineVersion: 'v1',
  });
  return { db, run };
}

function evidenceInput(run, overrides = {}) {
  return {
    customerId: 'CUST-1',
    runId: run.id,
    nodeKey: 'identity_verify',
    sourceUrl: 'HTTPS://Example.COM:443/about?utm_source=test#team',
    sourceType: 'official_website',
    collectedAt: '2026-07-24T08:59:00.000Z',
    summary: 'Example manufactures industrial controls.',
    content: '<html>Example manufactures industrial controls.</html>',
    confidence: 0.92,
    collector: 'identity-resolver',
    collectorVersion: 'v1',
    contactSensitive: false,
    ...overrides,
  };
}

test('current AI schema retains evidence and field provenance tables', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  assert.equal(AI_SCHEMA_VERSION, 11);
  const tables = new Set(fx.db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('crm_ai_enrichment_evidence','crm_ai_field_provenance')`).all()
    .map(row => row.name));
  assert.deepEqual(tables, new Set(['crm_ai_enrichment_evidence', 'crm_ai_field_provenance']));
});

test('evidence requires canonical URL, time, confidence, collector, and version', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  const store = createEnrichmentEvidenceStore(fx.db);
  assert.throws(() => store.recordEvidence(evidenceInput(fx.run, { sourceUrl: 'file:///tmp/a' })), /HTTP/);
  assert.throws(() => store.recordEvidence(evidenceInput(fx.run, { collectedAt: '' })), /collectedAt/);
  assert.throws(() => store.recordEvidence(evidenceInput(fx.run, { confidence: 1.1 })), /confidence/);
  assert.throws(() => store.recordEvidence(evidenceInput(fx.run, { collectorVersion: '' })), /collectorVersion/);
});

test('canonical evidence insertion is content-hashed and idempotent', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  const store = createEnrichmentEvidenceStore(fx.db, {
    now: () => new Date('2026-07-24T09:00:00.000Z'),
  });
  const input = evidenceInput(fx.run);
  const first = store.recordEvidence(input);
  const replay = store.recordEvidence(input);

  assert.equal(replay.id, first.id);
  assert.equal(first.id, canonicalEvidenceId({
    customerId: input.customerId,
    sourceUrl: 'https://example.com/about',
    contentHash: crypto.createHash('sha256').update(input.content).digest('hex'),
    collector: input.collector,
    collectorVersion: input.collectorVersion,
  }));
  assert.equal(first.sourceUrl, 'https://example.com/about');
  assert.equal(first.contentHash, crypto.createHash('sha256').update(input.content).digest('hex'));
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_evidence').get().count, 1);
});

test('contact-sensitive evidence is classified and its stored summary is redacted', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  const store = createEnrichmentEvidenceStore(fx.db);
  const saved = store.recordEvidence(evidenceInput(fx.run, {
    sourceType: 'public_contact_page',
    summary: 'Buyer Alex: alex@example.com, +7 999 123 45 67',
    content: 'contact page v1',
    contactSensitive: true,
  }));
  assert.equal(saved.contactSensitive, true);
  assert.doesNotMatch(saved.summary, /alex@example\.com|\+7 999/);
  assert.match(saved.summary, /\[redacted-email\]|\[redacted-phone\]/);
});

test('AI provisional fields require matching evidence while employee confirmation is explicit', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  const store = createEnrichmentEvidenceStore(fx.db);
  assert.throws(() => store.setFieldProvenance({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    targetType: 'crm_account',
    targetId: 'ACC-1',
    fieldName: 'country',
    value: 'Russia',
    sourceState: 'ai_provisional',
  }), /evidence/);

  const evidence = store.recordEvidence(evidenceInput(fx.run));
  const provisional = store.setFieldProvenance({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    targetType: 'crm_account',
    targetId: 'ACC-1',
    fieldName: 'country',
    value: 'Russia',
    sourceState: 'ai_provisional',
    evidenceId: evidence.id,
  });
  assert.equal(provisional.evidenceId, evidence.id);
  assert.equal(provisional.sourceState, 'ai_provisional');

  const confirmed = store.setFieldProvenance({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    targetType: 'crm_account',
    targetId: 'ACC-1',
    fieldName: 'company_name',
    value: 'Evidence Fixture',
    sourceState: 'employee_confirmed',
    confirmedBy: 'U-1',
  });
  assert.equal(confirmed.sourceState, 'employee_confirmed');
  assert.equal(confirmed.evidenceId, null);
});

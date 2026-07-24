'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ROLE_PERMISSIONS } = require('../lib/access_control');
const { createCustomerEnrichmentStore } = require('../lib/ai_stations/enrichment/store');
const {
  canonicalDomain,
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
  normalizeCompanyName,
} = require('../lib/ai_stations/enrichment/dedupe');
const { dispatchPendingEnrichment } = require('../lib/ai_stations/enrichment/workflow');
const { createEnrichmentExecutors } = require('../lib/ai_stations/enrichment/executors');
const {
  isPublicHttpUrl,
  resolveExplicitWebsiteIdentity,
} = require('../lib/ai_stations/enrichment/identity_resolver');
const { createEnrichmentEvidenceStore } = require('../lib/ai_stations/enrichment/evidence');
const { createAIStationWorker } = require('../lib/ai_stations/worker');

test('default runtime resolver accepts only the current employee-confirmed public website', t => {
  const fx = fixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customer_pool SET website='https://example.org/about'
    WHERE customer_id='CUST-1'`).run();
  fx.db.prepare(`UPDATE crm_accounts SET website='https://example.org/about'
    WHERE id='ACC-1'`).run();
  createEnrichmentEvidenceStore(fx.db).setFieldProvenance({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    targetType: 'crm_account',
    targetId: 'ACC-1',
    fieldName: 'website',
    value: 'https://example.org/about',
    sourceState: 'employee_confirmed',
    confirmedBy: 'U-ACTOR',
  });

  assert.equal(resolveExplicitWebsiteIdentity({ companyName: 'Name only' }), null);
  const resolved = resolveExplicitWebsiteIdentity({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    companyName: 'Website fixture',
    website: 'example.org/about?utm_source=smoke',
    country: 'DE',
  }, {
    db: fx.db,
    now: () => new Date('2026-07-24T06:30:00.000Z'),
  });
  assert.equal(resolved.officialWebsite, 'https://example.org/about');
  assert.equal(resolved.country, 'DE');
  assert.equal(resolved.confidence, 1);
  assert.equal(resolved.sources[0].collectedAt, '2026-07-24T06:30:00.000Z');
  assert.equal(resolved.sources[0].type, 'employee_confirmed_website');

  fx.db.prepare(`UPDATE crm_ai_field_provenance SET value_hash=?
    WHERE target_type='crm_account' AND target_id='ACC-1' AND field_name='website'`)
    .run('0'.repeat(64));
  assert.equal(resolveExplicitWebsiteIdentity({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    website: 'https://example.org/about',
  }, { db: fx.db }), null);
});

test('default runtime resolver rejects private, local, credentialed, and non-public URLs', () => {
  for (const website of [
    'http://127.0.0.1/admin',
    'http://10.1.2.3/',
    'http://[::1]/',
    'http://metadata.internal/',
    'http://user:secret@example.org/',
    'https://fixture.example/',
  ]) {
    assert.equal(isPublicHttpUrl(website), false, website);
  }
  assert.equal(isPublicHttpUrl('https://example.org/about'), true);
});

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-enrichment-identity-'));
  const dbPath = path.join(dir, 'crm.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
      active INTEGER NOT NULL, permission_group_id TEXT NOT NULL, permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role_key TEXT NOT NULL, permissions_json TEXT NOT NULL
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL, permission_key TEXT NOT NULL, effect TEXT NOT NULL,
      PRIMARY KEY (user_id, permission_key)
    );
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT, company_name TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
      owner_id TEXT, assignment_status TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(`INSERT INTO permission_groups(id,name,role_key,permissions_json)
    VALUES ('PGRP-MANAGER','Identity manager','manager',?)`).run(JSON.stringify({
    ...ROLE_PERMISSIONS.manager,
    view_all_customers: false,
    view_contacts: true,
    view_recon: true,
    run_recon: true,
    use_ai_assistant: true,
  }));
  db.prepare(`INSERT INTO sales_users
    (id,email,name,role,active,permission_group_id)
    VALUES ('U-ACTOR','actor@example.test','Actor','manager',1,'PGRP-MANAGER')`).run();
  db.prepare(`INSERT INTO customer_pool(customer_id,company_name,country,website)
    VALUES ('CUST-1','Acme Technology','','')`).run();
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,website,owner_id,assignment_status)
    VALUES ('ACC-1','CUST-1','Acme Technology','','','U-ACTOR','claimed')`).run();
  let sequence = 0;
  const runs = createCustomerEnrichmentStore(db, {
    idFactory: prefix => `${prefix}-${++sequence}`,
    now: () => new Date('2026-07-24T10:00:00.000Z'),
  });
  const run = runs.createTrigger({
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    triggerSource: 'manual_create',
    triggeredBy: 'U-ACTOR',
    inputFingerprint: 'c'.repeat(64),
    pipelineVersion: 'v1',
  });

  function openDb() {
    const connection = new Database(dbPath);
    connection.pragma('foreign_keys = ON');
    return connection;
  }

  function worker(identityResolver) {
    return createAIStationWorker({
      workerId: 'worker-identity',
      openDb,
      beforeClaim: ({ db: connection, workerId }) => dispatchPendingEnrichment(connection, undefined, {
        dispatcherId: `${workerId}:dispatcher`,
      }),
      executors: createEnrichmentExecutors(),
      executorOptions: { identityResolver },
    });
  }

  function close() {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { db, run, runs, worker, close };
}

test('domain and company normalization find exact URL/name duplicates', t => {
  const fx = fixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET website='https://www.example.com/about' WHERE customer_id='CUST-1'").run();

  assert.equal(canonicalDomain('HTTP://EXAMPLE.com:80/path?utm_source=x'), 'example.com');
  assert.equal(normalizeCompanyName('  ACME—Technology, LLC '), 'acme technology llc');
  assert.deepEqual(findExactDuplicate(fx.db, {
    companyName: 'Different',
    website: 'https://example.com/contact',
  }), {
    customerId: 'CUST-1',
    crmAccountId: 'ACC-1',
    companyName: 'Acme Technology',
    matchedBy: 'domain',
  });
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'ACME TECHNOLOGY',
    website: '',
  }).matchedBy, 'name');
});

test('fuzzy duplicate candidates are deterministic and never mutate or merge records', t => {
  const fx = fixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET website='https://acme-tech.example' WHERE customer_id='CUST-1'").run();
  const before = fx.db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get('CUST-1');

  const candidates = findFuzzyDuplicateCandidates(fx.db, {
    companyName: 'Acme Technologies',
    website: 'https://acmetech.example',
  });

  assert.equal(candidates[0].customerId, 'CUST-1');
  assert.ok(candidates[0].score >= 0.7);
  assert.deepEqual(fx.db.prepare('SELECT * FROM customer_pool WHERE customer_id=?').get('CUST-1'), before);
});

test('identity resolver persists evidence-backed provisional website and country', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  const worker = fx.worker(async () => ({
    legalName: 'Acme Technology LLC',
    officialWebsite: 'https://www.acme.example/?utm_source=resolver',
    country: 'Russia',
    confidence: 0.94,
    risk: { blocked: false, reasons: [] },
    sources: [{
      url: 'https://registry.example/acme',
      type: 'business_registry',
      collectedAt: '2026-07-24T09:59:00.000Z',
      summary: 'Registry entry for Acme Technology LLC in Russia.',
      content: 'registry-acme-v1',
      confidence: 0.96,
    }],
  }));

  assert.equal((await worker.runOnce()).job.station, 'intake_precheck');
  const outcome = await worker.runOnce();

  assert.equal(outcome.status, 'succeeded', outcome.error?.stack);
  assert.equal(outcome.job.station, 'identity_verify');
  assert.deepEqual(fx.db.prepare(`SELECT company_name,country,website FROM crm_accounts
    WHERE id='ACC-1'`).get(), {
    company_name: 'Acme Technology',
    country: 'Russia',
    website: 'https://www.acme.example/',
  });
  assert.equal(fx.db.prepare('SELECT COUNT(*) count FROM crm_ai_enrichment_evidence').get().count, 1);
  const provenance = fx.db.prepare(`SELECT field_name,source_state,evidence_id FROM crm_ai_field_provenance
    ORDER BY field_name`).all();
  assert.deepEqual(provenance.map(row => row.field_name), ['country', 'website']);
  assert.equal(provenance.every(row => row.source_state === 'ai_provisional' && row.evidence_id), true);
});

test('uncertain, risky, or evidence-free identity never writes canonical fields', async t => {
  const cases = [
    { result: { officialWebsite: 'https://maybe.example', confidence: 0.4, sources: [] }, reason: 'identity_uncertain' },
    {
      result: {
        country: 'Russia',
        confidence: 0.95,
        risk: { blocked: true, reasons: ['sanctions_match'] },
        sources: [{
          url: 'https://risk.example/acme', type: 'risk_registry',
          collectedAt: '2026-07-24T09:59:00.000Z', summary: 'Potential sanctions match',
          content: 'risk-v1', confidence: 0.9,
        }],
      },
      reason: 'risk_precheck_failed',
    },
    { result: { country: 'Russia', confidence: 0.95, sources: [] }, reason: 'identity_uncertain' },
  ];
  for (const item of cases) {
    const fx = fixture();
    t.after(() => fx.close());
    const worker = fx.worker(async () => item.result);
    await worker.runOnce();
    const outcome = await worker.runOnce();
    assert.equal(outcome.job.state, 'needs_review');
    assert.equal(fx.runs.getRun(fx.run.id).reasonCode, item.reason);
    assert.deepEqual(fx.db.prepare("SELECT country,website FROM crm_accounts WHERE id='ACC-1'").get(), {
      country: '',
      website: '',
    });
  }
});

test('identity node revalidates external-capability permissions after precheck', async t => {
  const fx = fixture();
  t.after(() => fx.close());
  let resolverCalls = 0;
  const worker = fx.worker(async () => {
    resolverCalls += 1;
    return {};
  });
  await worker.runOnce();
  fx.db.prepare(`INSERT INTO user_permission_overrides(user_id,permission_key,effect)
    VALUES ('U-ACTOR','view_contacts','deny')`).run();

  const outcome = await worker.runOnce();

  assert.equal(outcome.status, 'blocked');
  assert.equal(outcome.job.station, 'identity_verify');
  assert.match(outcome.job.blockedReason, /view_contacts/);
  assert.equal(resolverCalls, 0);
});

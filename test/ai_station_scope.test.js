'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { buildCustomerContext } = require('../lib/ai_stations/context');
const { createAIJobStore } = require('../lib/ai_stations/jobs');
const { createAIResultStore } = require('../lib/ai_stations/results');
const { executeCustomerFitJob } = require('../lib/ai_stations/executor');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY, company_name TEXT, industry TEXT, products TEXT, country TEXT,
      website TEXT, description TEXT, risk_status TEXT, contact_count TEXT, email TEXT, phone TEXT, notes TEXT,
      domain TEXT, russian_name TEXT, english_name TEXT, city TEXT, customer_type TEXT, rating TEXT,
      current_pool TEXT, inn TEXT, website_verification TEXT, first_found TEXT, last_found TEXT,
      search_count TEXT, verified TEXT
    );
    CREATE TABLE company_screening (
      customer_id TEXT PRIMARY KEY, business_summary TEXT, company_type TEXT,
      product_categories_json TEXT, likely_component_needs_json TEXT, match_score INTEGER, match_group TEXT,
      match_reasons_json TEXT, risk_level TEXT, risk_reasons_json TEXT, classification_confidence INTEGER,
      source_urls_json TEXT, screening_status TEXT, checked_at TEXT, next_review_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY, external_customer_id TEXT, company_name TEXT, country TEXT, city TEXT, website TEXT,
      industry TEXT, customer_type TEXT, source TEXT, product_focus TEXT, priority TEXT, potential_value REAL,
      stage TEXT, owner_id TEXT, assignment_status TEXT, last_activity_at TEXT, next_action TEXT, next_action_at TEXT,
      manager_required INTEGER, manager_status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE crm_activities (
      id TEXT PRIMARY KEY, customer_id TEXT, user_id TEXT, activity_type TEXT, channel TEXT, outcome TEXT,
      summary TEXT, next_action TEXT, next_action_at TEXT, stage_after TEXT, manager_required INTEGER,
      occurred_at TEXT, created_at TEXT
    );
    CREATE TABLE recon_results (
      job_id TEXT PRIMARY KEY, customer_id TEXT, company_name TEXT, website TEXT, industry TEXT, customer_type TEXT,
      city TEXT, phone TEXT, email TEXT, inn TEXT, rating TEXT, score TEXT, employees TEXT, description TEXT,
      current_pool TEXT, risk_status TEXT, website_verification TEXT, verified TEXT, contact_count TEXT,
      contact_name TEXT, contact_title TEXT, contact_classification TEXT, quality_status TEXT, missing_steps TEXT,
      step5_status TEXT, step5_plus_status TEXT, notes TEXT, sanction_status TEXT, priority TEXT, compliance_status TEXT,
      sanctioned TEXT, sanction_source TEXT, sanction_program TEXT, sanction_checked_at TEXT, evidence_url TEXT,
      opportunity_summary TEXT, opportunity_do TEXT, opportunity_need TEXT, opportunity_sell TEXT,
      opportunity_decision TEXT, contacts_summary TEXT, recommended_products TEXT, outreach_angle TEXT,
      next_action TEXT, evidence_count TEXT, report_path TEXT, artifacts_json TEXT, updated_at TEXT
    );
    CREATE TABLE recon_evidence (
      id INTEGER PRIMARY KEY, job_id TEXT, customer_id TEXT, field_name TEXT, value TEXT, source_url TEXT,
      source_title TEXT, checked_at TEXT, confidence TEXT, extractor TEXT
    );
    CREATE TABLE person_candidates (
      person_id TEXT PRIMARY KEY, customer_id TEXT, full_name TEXT, full_name_local TEXT, department TEXT, title TEXT,
      role_category TEXT, decision_role TEXT, employment_status TEXT, employment_confidence INTEGER,
      contact_level TEXT, sales_ready INTEGER, last_verified_at TEXT, updated_at TEXT
    );
    CREATE TABLE contact_methods (
      id INTEGER PRIMARY KEY, person_id TEXT, customer_id TEXT, method_type TEXT, value TEXT, status TEXT,
      verification_status TEXT, confidence INTEGER, source_url TEXT, last_verified_at TEXT, verified_at TEXT
    );
    CREATE TABLE person_evidence (
      id INTEGER PRIMARY KEY, evidence_id TEXT, person_id TEXT, customer_id TEXT, contact_recon_job_id TEXT,
      evidence_type TEXT, field_name TEXT, value TEXT, source_url TEXT, source_title TEXT, source_date TEXT,
      checked_at TEXT, confidence TEXT
    );
  `);
  db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,industry,products,country,website,description,risk_status,contact_count,email,phone,notes,
     current_pool,verified) VALUES ('CUST-1','Acme Components','electronics','MCU, sensors','RU','https://acme.test',
     'Industrial electronics manufacturer','clear','2','secret@acme.test','+7-secret','Buyer Anna +7-secret','A','yes')`).run();
  db.prepare(`INSERT INTO company_screening
    (customer_id,business_summary,company_type,product_categories_json,likely_component_needs_json,match_score,match_group,
     match_reasons_json,risk_level,risk_reasons_json,classification_confidence,source_urls_json,screening_status,checked_at,
     next_review_at,created_at,updated_at) VALUES ('CUST-1','Verified manufacturer','manufacturer','["MCU"]','["sensors"]',88,'A',
     '["PRODUCT_MATCH"]','low','[]',90,'["https://screening.test"]','classified','2026-07-23','', '2026-07-23','2026-07-23')`).run();
  db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,stage,owner_id,assignment_status,updated_at) VALUES ('ACC-1','CUST-1','Acme Components','qualified','U1','claimed','2026-07-23')`).run();
  db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,occurred_at,created_at) VALUES
    ('ACT-1','ACC-1','U1','meeting','email','interested','Discussed MCU demand','Send quote','2026-07-22','2026-07-22')`).run();
  db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,description,score,quality_status,risk_status,contact_name,contact_title,opportunity_summary,updated_at)
    VALUES ('JOB-1','CUST-1','Acme Components','Recon manufacturer profile','91','verified','clear','Anna Buyer','Procurement','High fit for MCU','2026-07-23')`).run();
  db.prepare(`INSERT INTO recon_evidence
    (id,job_id,customer_id,field_name,value,source_url,source_title,checked_at,confidence) VALUES
    (1,'JOB-1','CUST-1','industry','Industrial electronics','https://recon.test','Registry','2026-07-23','high')`).run();
  db.prepare(`INSERT INTO person_candidates
    (person_id,customer_id,full_name,title,decision_role,employment_status,employment_confidence,contact_level,sales_ready,updated_at)
    VALUES ('PERSON-1','CUST-1','Anna Buyer','Procurement','decision_maker','verified_current',90,'L3',1,'2026-07-23')`).run();
  db.prepare(`INSERT INTO contact_methods
    (id,person_id,customer_id,method_type,value,status,verification_status,confidence,source_url,last_verified_at)
    VALUES (1,'PERSON-1','CUST-1','email','anna@acme.test','verified','verified',90,'https://contact.test','2026-07-23')`).run();
  db.prepare(`INSERT INTO person_evidence
    (id,evidence_id,person_id,customer_id,contact_recon_job_id,evidence_type,field_name,value,source_url,source_title,checked_at,confidence)
    VALUES (1,'PEV-1','PERSON-1','CUST-1','JOB-C','employment','title','Procurement lead','https://contact.test','Company page','2026-07-23','high')`).run();
  return db;
}

function access(overrides = {}) {
  return {
    permissions: { view_customers: true, view_contacts: true, view_recon: true, ...overrides },
    externalCustomerIds: new Set(['CUST-1']),
    accountIds: new Set(['ACC-1']),
  };
}

test('customer context is scoped, evidence-backed, and hashed deterministically', () => {
  const db = fixture();
  const first = buildCustomerContext(db, access(), 'CUST-1');
  const second = buildCustomerContext(db, access(), 'CUST-1');
  assert.equal(first.context.crmAccountId, 'ACC-1');
  assert.equal(first.context.companyScreening.matchScore, 88);
  assert.equal(first.context.latestRecon.contactName, 'Anna Buyer');
  assert.equal(first.context.people[0].methods[0].value, 'anna@acme.test');
  assert.equal(first.context.activities[0].id, 'ACT-1');
  assert.ok(first.evidenceIds.length >= 8);
  assert.deepEqual(first.evidenceIds, second.evidenceIds);
  assert.equal(first.contextHash, second.contextHash);
  assert.ok(first.evidence.every(item => first.evidenceIds.includes(item.id)));
  db.close();
});

test('context omits contact and recon data when permissions do not allow it', () => {
  const db = fixture();
  const result = buildCustomerContext(db, access({ view_contacts: false, view_recon: true }), 'CUST-1');
  assert.deepEqual(result.context.people, []);
  assert.equal(result.context.activities.length, 1);
  assert.equal('email' in result.context.customerPool, false);
  assert.equal('notes' in result.context.customerPool, false);
  assert.equal(result.context.customerPool.description, '');
  assert.equal(result.context.companyScreening.businessSummary, '');
  assert.equal(result.context.latestRecon.description, '');
  assert.equal('contactName' in result.context.latestRecon, false);
  assert.equal('summary' in result.context.activities[0], false);
  assert.equal(result.evidence.some(item => item.value.includes('anna@acme.test')), false);
  assert.equal(result.evidence.some(item => item.sourceTable === 'recon_evidence'), false);
  db.close();
});

test('context rejects an out-of-scope customer before building AI input', () => {
  const db = fixture();
  assert.throws(() => buildCustomerContext(db, access(), 'CUST-OTHER'), error => error.statusCode === 403);
  db.close();
});

test('context rejects an account outside the hydrated account scope', () => {
  const db = fixture();
  const scoped = access();
  scoped.accountIds = new Set();
  assert.throws(() => buildCustomerContext(db, scoped, 'CUST-1'), error => error.statusCode === 403);
  db.close();
});

test('context falls back to an authorized CRM account when the customer pool is empty', () => {
  const db = fixture();
  db.prepare('DELETE FROM customer_pool').run();
  const result = buildCustomerContext(db, access(), 'CUST-1');
  assert.equal(result.context.customerPool.companyName, 'Acme Components');
  assert.equal(result.context.customerPool.currentPool, 'crm');
  assert.equal(result.context.crmAccountId, 'ACC-1');
  db.close();
});

test('customer_fit execution uses the existing router contract and persists the validated result', async () => {
  const db = fixture();
  const accessContext = access();
  const actor = { id: 'U1', role: 'manager' };
  const context = buildCustomerContext(db, accessContext, 'CUST-1');
  const jobs = createAIJobStore(db, { idFactory: () => 'AIJ-EXEC' });
  const results = createAIResultStore(db, { idFactory: prefix => `${prefix}-EXEC` });
  const job = jobs.enqueue({
    customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit', contextHash: context.contextHash,
    payload: { contextVersion: 'crm-v1' },
  }, 'fit:CUST-1:v1');
  const claimed = jobs.claimNext('worker-exec');
  assert.equal(claimed.id, job.id);
  const calls = [];
  const output = {
    version: 'v1', confidence: 0.88, evidenceIds: context.evidenceIds.slice(0, 2),
    reasonCodes: ['PRODUCT_MATCH'], fitScore: 86, grade: 'A', reviewRequired: false,
  };
  const router = {
    route: async (messages, options, adapters) => {
      calls.push({ messages, options, adapterNames: Object.keys(adapters) });
      return { answer: JSON.stringify(output), engine: 'hermes', model: 'test-model', usage: { input: 10, output: 5 } };
    },
  };
  const execution = await executeCustomerFitJob({
    db, jobs, results, jobId: job.id, workerId: 'worker-exec', accessContext, actor,
    router,
    adapters: { 'kimi-cli': async () => ({}), hermes: async () => ({}), deepseek: async () => ({}) },
  });
  assert.equal(execution.result.value.fitScore, 86);
  assert.equal(execution.modelRun.status, 'succeeded');
  assert.equal(jobs.getJob(job.id).state, 'succeeded');
  assert.equal(calls[0].options.externalAllowed, false);
  assert.equal(calls[0].options.scope, 'ai_station:customer_fit');
  assert.deepEqual(calls[0].adapterNames, ['kimi-cli', 'hermes', 'deepseek']);
  assert.equal(calls[0].messages[0].role, 'system');
  assert.match(calls[0].messages[1].content, /trustedCrmContext/);
  db.close();
});

test('customer_fit execution rejects invented evidence and leaves a retryable job', async () => {
  const db = fixture();
  const accessContext = access();
  const context = buildCustomerContext(db, accessContext, 'CUST-1');
  const jobs = createAIJobStore(db, { idFactory: () => 'AIJ-INVALID', retryBaseMs: 1 });
  const results = createAIResultStore(db, { idFactory: prefix => `${prefix}-INVALID` });
  const job = jobs.enqueue({ customerId: 'CUST-1', crmAccountId: 'ACC-1', station: 'customer_fit', contextHash: context.contextHash }, 'fit:CUST-1:invalid');
  jobs.claimNext('worker-invalid');
  await assert.rejects(() => executeCustomerFitJob({
    db, jobs, results, jobId: job.id, workerId: 'worker-invalid', accessContext, actor: { id: 'U1', role: 'manager' },
    modelCall: async () => ({
      answer: JSON.stringify({ version: 'v1', confidence: 0.4, evidenceIds: ['EV-INVENTED'], reasonCodes: ['OTHER'], fitScore: 20, grade: 'D', reviewRequired: true }),
      engine: 'deepseek', model: 'test-model',
    }),
  }), error => error.code === 'AI_STATION_INVALID_OUTPUT');
  assert.equal(jobs.getJob(job.id).state, 'retry_wait');
  assert.equal(db.prepare('SELECT status FROM crm_ai_model_runs WHERE job_id=?').get(job.id).status, 'invalid_output');
  db.close();
});

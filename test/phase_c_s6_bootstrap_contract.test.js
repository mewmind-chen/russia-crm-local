'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const {
  redactContactFields,
  contactSafeCustomerRecord,
  contactSafePoolRecord,
  contactSafeReconRecord,
} = require('../lib/access_control');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const dbSource = read('lib/db.js');
const accessSource = read('lib/access_control.js');
const serverSource = read('server.js');
const designSource = read('docs/governance/PHASE_C_AGGREGATE_WHITELIST_DESIGN.md');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

const initialData = functionSlice(dbSource, 'getInitialData', 'profileEvaluationTags');

test('S6/P2 getInitialData keeps the bootstrap assembly and every source gate explicit', () => {
  for (const pattern of [
    /const permissions = accessContext\?\.permissions \|\| \{\};/,
    /SELECT \* FROM customers WHERE \$\{scopeSql\}/,
    /\$\{CUSTOMER_POOL_PROFILE_SELECT\} WHERE p\.\$\{scopeSql\}/,
    /const visibleCustomers = permissions\.view_contacts\s*\?/,
    /customerPool = customerPool\.map\(contactSafePoolRecord\)/,
    /SELECT \* FROM recon_jobs WHERE \$\{scopeSql\}/,
    /reconResults = reconResults\.map\(contactSafeReconRecord\)/,
    /const contactReconJobs = permissions\.view_contacts\s*\?/,
    /const people = permissions\.view_contacts\s*\?/,
    /const contactQualityStats = permissions\.view_contacts\s*\?/,
    /const prospect = permissions\.use_prospect_agent\s*\?/,
    /const stats = getStats\(visibleCustomers, customerPool, reconJobs\)/,
    /templates,/, /reconJobs, reconResults, tags,/, /prospectTasks: prospect\.tasks,/,
    /prospectCandidates: prospect\.candidates,/, /prospectSources: prospect\.sources,/,
    /return permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\);/,
  ]) assert.match(initialData, pattern, `getInitialData missing ${pattern}`);

  assert.match(serverSource, /app\.get\('\/api\/initial', \(req, res\) =>/);
  assert.match(accessSource, /'GET \/initial': \{ permissions: \['view_development'\] \}/);
  assert.doesNotMatch(accessSource, /contactSafeBootstrapPayload/);
});

test('S6/P2 customer and pool leaf projections are blacklist-equivalent, while raw recon drift stays an explicit blocker', () => {
  const customer = {
    rowNumber: 1, followId: 'FOLLOW-S6', customerId: 'RU-S6', companyName: 'S6 Fixture',
    website: 'https://s6.example', customerType: '制造商', industry: '电子', rating: 'A',
    email: 'hidden@example.test', phone: '+7-hidden', contact: 'Hidden Buyer', products: 'hidden products',
    reason: 'hidden reason', owner: 'Wu', assignedDate: '2026-09-02', status: '已分配待联系',
    firstContactDate: '', lastFollowDate: '', channel: 'email', feedback: 'hidden feedback',
    nextAction: 'hidden action', nextFollowDate: '2026-09-03', invalidReason: 'hidden invalid', notes: 'hidden notes',
    statusGroup: '待联系', nextFollowDateKey: '2026-09-03', isDueToday: false, isOverdue: false,
    isRisk: false, riskReasons: [], tags: [{ id: 1, name: '重点客户', category: '客户类型', color: '#000', isPreset: true }],
  };
  const pool = {
    customerId: 'RU-S6', domain: 's6.example', companyName: 'S6 Fixture', nickname: 'S6',
    russianName: '', englishName: '', country: '俄罗斯', city: '莫斯科', website: 'https://s6.example',
    industry: '电子', customerType: '制造商', establishedYear: 1998, description: 'hidden description',
    products: 'hidden products', rating: 'A', currentPool: 'crm', phone: '+7-hidden', email: 'hidden@example.test',
    inn: '123', riskStatus: '', sanctionStatus: '未知', websiteVerification: 'verified', contactCount: '1',
    deepReport: 'hidden report', sourceFile: 'hidden source', firstFound: '2026-01-01', lastFound: '2026-09-02',
    searchCount: '2', verified: 'yes', bestContactLevel: 'L1', bestPersonId: 'P-S6', salesReadyContactCount: 1,
    contactReconStatus: 'done', contactLastCheckedAt: '2026-09-02', contactNextAction: 'hidden next', notes: 'hidden notes',
    createdAt: '2026-01-01', updatedAt: '2026-09-02', isRisk: false, riskReasons: [],
  };
  assert.deepEqual(contactSafeCustomerRecord(customer), redactContactFields(customer));
  assert.deepEqual(contactSafePoolRecord(pool), redactContactFields(pool));
  assert.equal(contactSafePoolRecord(pool).establishedYear, 1998);
  assert.deepEqual(redactContactFields(contactSafeCustomerRecord(customer)), contactSafeCustomerRecord(customer));
  assert.deepEqual(redactContactFields(contactSafePoolRecord(pool)), contactSafePoolRecord(pool));

  // getInitialData passes raw recon_results rows to the specialized projection.
  // The projection is intentionally stricter than the generic blacklist for
  // dynamic/credential-like columns; this non-equivalence keeps the composite
  // bootstrap migration closed until a dedicated recon shape is designed.
  const rawRecon = {
    job_id: 'JOB-S6', customer_id: 'RU-S6', company_name: 'S6 Fixture', website: 'https://s6.example',
    industry: '电子', customer_type: '制造商', city: '莫斯科', phone: '+7-hidden', email: 'hidden@example.test',
    inn: '123', rating: 'A', score: '90', employees: '10', description: 'hidden description', current_pool: 'crm',
    risk_status: '', website_verification: 'verified', verified: 'yes', contact_count: '1', contact_name: 'Hidden Buyer',
    contact_title: 'Buyer', contact_classification: 'hidden classification', quality_status: 'ok', missing_steps: 'email',
    step5_status: 'done', step5_plus_status: 'done', notes: 'hidden notes', sanction_status: 'CLEAR', priority: 'A',
    compliance_status: 'clear', sanctioned: 'false', sanction_source: '', sanction_program: '', sanction_checked_at: '',
    evidence_url: 'https://s6.example/evidence', opportunity_summary: 'hidden opportunity', opportunity_do: 'hidden do',
    opportunity_need: 'hidden need', opportunity_sell: 'hidden sell', opportunity_decision: 'hidden decision',
    contacts_summary: 'hidden contacts', recommended_products: 'hidden products', outreach_angle: 'hidden angle',
    next_action: 'hidden action', evidence_count: '0', report_path: '', artifacts_json: '{"email":"hidden@example.test"}',
    updated_at: '2026-09-02',
  };
  const black = redactContactFields(rawRecon);
  const white = contactSafeReconRecord(rawRecon);
  assert.notDeepEqual(white, black, 'raw recon drift must remain visible as a migration blocker');
  for (const key of ['contact_classification', 'missing_steps', 'evidence_url', 'artifacts_json']) {
    assert.ok(Object.hasOwn(black, key), `blacklist currently keeps ${key}`);
    assert.ok(!Object.hasOwn(white, key), `specialized recon projection drops ${key}`);
  }
  assert.deepEqual(redactContactFields(white), white);
});

test('S6/P2 contact-restricted manager keeps business bootstrap data but gates contact-heavy sources', async t => {
  const fx = await seededFixture({ permissions: { use_prospect_agent: true } });
  t.after(() => fx.close());
  const now = '2026-09-02 09:00:00';
  fx.db.prepare(`UPDATE customer_pool
    SET established_year=1998,email='pool-s6@secret.test',phone='+7-pool-s6',notes='pool buyer',deep_report='pool report',source_file='pool source'
    WHERE customer_id='RU-9001'`).run();
  fx.db.prepare(`UPDATE recon_results
    SET contact_name='Recon Buyer',contact_classification='buyer',missing_steps='email',evidence_url='https://s6.example/evidence',
        artifacts_json='{"email":"recon-s6@secret.test"}',updated_at=? WHERE job_id='JOB-OTHER'`).run(now);
  fx.db.prepare(`INSERT INTO prospect_tasks
    (task_id,created_by,query,market,industry_focus,product_focus,status,candidate_count,promoted_count,recon_count,error,created_at,updated_at)
    VALUES ('TASK-S6','U-WU','query-s6@secret.test','俄罗斯','industry-s6@secret.test','product-s6@secret.test','done',1,0,0,'error-s6@secret.test',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,company_name,description,products,need_signal,sell_signal,contact_signal,decision,source_summary,score,status,created_at,updated_at)
    VALUES ('CAND-S6','TASK-S6','S6 Prospect','description-s6@secret.test','products-s6@secret.test','need-s6@secret.test','sell-s6@secret.test',
      'contact-s6@secret.test','decision-s6@secret.test','summary-s6@secret.test',80,'candidate',?,?)`).run(now, now);
  fx.db.prepare(`INSERT INTO prospect_sources
    (candidate_id,task_id,source_type,title,url,snippet,confidence,fetched_at)
    VALUES ('CAND-S6','TASK-S6','web_search','title-s6@secret.test','https://s6.example/contact','snippet-s6@secret.test','medium',?)`).run(now);

  const response = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.customers.some(row => row.customerId === 'RU-9001'));
  assert.ok(body.customerPool.some(row => row.customerId === 'RU-9001'));
  assert.equal(body.customerPool.find(row => row.customerId === 'RU-9001').establishedYear, 1998);
  for (const key of ['email', 'phone', 'contact', 'products', 'reason', 'feedback', 'nextAction', 'notes']) {
    assert.ok(!Object.hasOwn(body.customers.find(row => row.customerId === 'RU-9001'), key), `customer:${key}`);
  }
  for (const key of ['email', 'phone', 'contactCount', 'bestPersonId', 'deepReport', 'sourceFile', 'contactNextAction', 'notes']) {
    assert.ok(!Object.hasOwn(body.customerPool.find(row => row.customerId === 'RU-9001'), key), `pool:${key}`);
  }
  const recon = body.reconResults.find(row => row.job_id === 'JOB-OTHER');
  assert.ok(recon, 'recon row remains visible under view_recon');
  for (const key of ['email', 'phone', 'contact_name', 'contact_classification', 'missing_steps', 'evidence_url', 'artifacts_json']) {
    assert.ok(!Object.hasOwn(recon, key), `recon:${key}`);
  }
  assert.deepEqual(body.contactReconJobs, []);
  assert.deepEqual(body.people, []);
  assert.deepEqual(body.contactQualityStats, {});
  const prospect = body.prospectCandidates.find(row => row.candidateId === 'CAND-S6');
  assert.ok(prospect, 'prospect candidate stays structurally visible for its permission');
  for (const key of ['description', 'products', 'needSignal', 'sellSignal', 'contactSignal', 'decision', 'sourceSummary']) {
    assert.ok(!Object.hasOwn(prospect, key), `prospect:${key}`);
  }
  assert.ok(body.prospectTasks.some(row => row.taskId === 'TASK-S6'));
  assert.ok(!JSON.stringify(body).includes('@secret.test'));
});

test('S6/P2 sales, manager and admin role shapes preserve scope and contact gates', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE customers SET email='sales-s6@secret.test',phone='+7-sales-s6',contact='Sales Buyer' WHERE follow_id='FOLLOW-OTHER'`).run();

  const sales = await (await fx.request('/api/initial', { cookie: fx.otherCookie })).json();
  assert.deepEqual(sales.customers.map(row => row.customerId), ['RU-9003']);
  assert.equal(sales.customers[0].email, 'sales-s6@secret.test');
  assert.equal(sales.customers[0].contact, 'Sales Buyer');

  const managerCookie = await fx.login('manager@example.com', 'Password123!');
  const manager = await (await fx.request('/api/initial', { cookie: managerCookie })).json();
  assert.ok(manager.customers.some(row => row.customerId === 'RU-9001'));
  assert.equal(manager.people.length > 0, true);
  assert.equal(manager.contactReconJobs.length > 0, true);
  assert.equal(manager.contactQualityStats.totalPeople, manager.people.length);
  assert.equal(manager.customers.find(row => row.customerId === 'RU-9001').email, 'person@secret.test');

  const admin = await (await fx.request('/api/initial', { cookie: fx.adminCookie })).json();
  assert.ok(admin.customers.some(row => row.customerId === 'RU-9001'));
  assert.equal(admin.customers.find(row => row.customerId === 'RU-9001').email, 'person@secret.test');
  assert.equal(admin.people.length > 0, true);
  assert.equal(admin.contactQualityStats.totalPeople, admin.people.length);
});

test('S6/P2 keeps the bootstrap composite on recursive redaction until all leaf proofs exist', () => {
  assert.match(designSource, /2026-09-02 S6\/P2|S6\/P2/);
  assert.match(designSource, /S6[\s\S]*contactSafeBootstrapPayload/);
  assert.match(designSource, /masterProfile[\s\S]*people[\s\S]*recon/);
  assert.match(designSource, /复合迁移|复合白名单/);
  assert.match(initialData, /return permissions\.view_contacts \? payload : redactContactDynamicFields\(payload\);/);
  assert.doesNotMatch(accessSource, /function contactSafeBootstrapPayload\(/);
});

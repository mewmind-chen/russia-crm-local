'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const dbSource = read('lib/db.js');
const accessSource = read('lib/access_control.js');

function functionSlice(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing ${nextFunctionName}`);
  return source.slice(start, end);
}

test('raw recon/people/prospect/templates shapes have explicit contracts or a source gate', () => {
  const prospectState = functionSlice(dbSource, 'listProspectState', 'getContactQualityStats');
  const initialData = functionSlice(dbSource, 'getInitialData', 'profileEvaluationTags');

  // SELECT * remains a storage/query convenience only. Every non-AI legacy
  // shape either maps to an explicit builder or is gated at the source by the
  // permission that authorizes the whole contact payload.
  for (const builder of ['buildProspectTask', 'buildProspectCandidate', 'buildProspectSource', 'buildTemplate']) {
    assert.match(dbSource, new RegExp(`function ${builder}\\(row = \\{\\}\\) \\{[\\s\\S]*?return \\{`));
  }
  for (const pattern of [
    /\.map\(buildProspectTask\)/,
    /\.map\(buildProspectCandidate\)/,
    /\.map\(buildProspectSource\)/,
  ]) assert.match(prospectState, pattern);
  assert.match(initialData, /SELECT \* FROM templates ORDER BY id[^\n]*\.all\(\)\.map\(buildTemplate\)/);

  assert.match(initialData, /const contactReconJobs = permissions\.view_contacts\s*\?/);
  assert.match(initialData, /const people = permissions\.view_contacts\s*\?/);
  assert.match(initialData, /const prospect = permissions\.use_prospect_agent\s*\?/);
  assert.match(initialData, /reconResults = reconResults\.map\(contactSafeReconRecord\)/);
  assert.match(accessSource, /'GET \/customers\/:customerId\/people': \{ permissions: \['view_contacts'\] \}/);
  assert.match(accessSource, /'GET \/contact-recon\/state': \{ permissions: \['view_contacts'\] \}/);
});

test('unknown columns are dropped from legacy template/prospect builders and restricted recon rows', async t => {
  const fx = await adminFixture({
    permissions: { use_prospect_agent: true },
  });
  t.after(() => fx.close());

  fx.db.exec(`
    ALTER TABLE templates ADD COLUMN future_contact_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE prospect_tasks ADD COLUMN future_contact_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE prospect_candidates ADD COLUMN future_contact_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE prospect_sources ADD COLUMN future_contact_json TEXT NOT NULL DEFAULT '';
    ALTER TABLE recon_results ADD COLUMN future_contact_json TEXT NOT NULL DEFAULT '';
  `);
  const hiddenJson = JSON.stringify({ email: 'raw-shape@example.test', nested: { phoneNumber: '+7-raw-shape' } });
  fx.db.prepare(`INSERT INTO templates
    (scenario,description,english,russian,customer_type,product,future_contact_json)
    VALUES (?,?,?,?,?,?,?)`).run(
    'raw-shape-template', 'description', 'Hello', 'Привет', '制造商', 'IC', hiddenJson,
  );
  fx.db.prepare(`INSERT INTO prospect_tasks
    (task_id,created_by,query,market,status,future_contact_json,created_at,updated_at)
    VALUES ('TASK-RAW-SHAPE','U-WU','raw-shape','俄罗斯','done',?,?,?)`)
    .run(hiddenJson, '2026-09-03 12:00:00', '2026-09-03 12:00:00');
  fx.db.prepare(`INSERT INTO prospect_candidates
    (candidate_id,task_id,company_name,description,score,status,future_contact_json,created_at,updated_at)
    VALUES ('CAND-RAW-SHAPE','TASK-RAW-SHAPE','Raw Shape Co','safe description',80,'candidate',?,?,?)`)
    .run(hiddenJson, '2026-09-03 12:00:00', '2026-09-03 12:00:00');
  fx.db.prepare(`INSERT INTO prospect_sources
    (candidate_id,task_id,source_type,title,url,snippet,confidence,future_contact_json,fetched_at)
    VALUES ('CAND-RAW-SHAPE','TASK-RAW-SHAPE','web_search','Raw Shape','https://raw-shape.example',
      'safe snippet','medium',?,?)`).run(hiddenJson, '2026-09-03 12:00:00');
  fx.db.prepare(`UPDATE recon_results SET future_contact_json=? WHERE job_id='JOB-OTHER'`).run(hiddenJson);

  const restrictedResponse = await fx.request('/api/initial', { cookie: fx.cookie });
  assert.equal(restrictedResponse.status, 200);
  const restricted = await restrictedResponse.json();
  const template = restricted.templates.find(row => row.scenario === 'raw-shape-template');
  assert.ok(template);
  assert.equal(template.future_contact_json, undefined);
  assert.equal(template.customerType, '制造商');
  const candidate = restricted.prospectCandidates.find(row => row.candidateId === 'CAND-RAW-SHAPE');
  assert.ok(candidate);
  assert.equal(candidate.future_contact_json, undefined);
  assert.equal(candidate.description, undefined, 'contact-restricted prospect free text stays hidden');
  const source = restricted.prospectSources.find(row => row.candidateId === 'CAND-RAW-SHAPE');
  assert.ok(source);
  assert.equal(source.future_contact_json, undefined);
  const recon = restricted.reconResults.find(row => row.job_id === 'JOB-OTHER');
  assert.ok(recon);
  assert.equal(recon.future_contact_json, undefined);

  const adminResponse = await fx.request('/api/initial', { cookie: fx.adminCookie });
  assert.equal(adminResponse.status, 200);
  const admin = await adminResponse.json();
  assert.equal(admin.templates.find(row => row.scenario === 'raw-shape-template').future_contact_json, undefined);
  assert.equal(admin.prospectCandidates.some(row => row.future_contact_json !== undefined), false);
  assert.equal(admin.prospectSources.some(row => row.future_contact_json !== undefined), false);
  assert.equal(admin.reconResults.find(row => row.job_id === 'JOB-OTHER').future_contact_json, hiddenJson,
    'authorized recon keeps existing raw compatibility while unknown contact fields stay behind the view_contacts boundary');
});

test('people and contact-recon state remain permission-gated instead of projecting a partial contact shape', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const deniedPeople = await fx.request('/api/customers/RU-9001/people', { cookie: fx.cookie });
  assert.equal(deniedPeople.status, 403);
  const deniedReconState = await fx.request('/api/contact-recon/state', { cookie: fx.cookie });
  assert.equal(deniedReconState.status, 403);
  const allowedPeople = await fx.request('/api/customers/RU-9001/people', { cookie: fx.adminCookie });
  assert.equal(allowedPeople.status, 200);
  const allowedReconState = await fx.request('/api/contact-recon/state', { cookie: fx.adminCookie });
  assert.equal(allowedReconState.status, 200);
});

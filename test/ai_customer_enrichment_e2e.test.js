'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnrichmentFixture } = require('./helpers/enrichment_fixture');

function assertCompleted(snapshot) {
  assert.ok(snapshot.profile.company_name);
  assert.equal(snapshot.profile.industry, '电力电子');
  assert.match(snapshot.profile.products, /MCU/);
  assert.match(snapshot.profile.description, /Industrial electronics/);
  assert.equal(snapshot.people.length, 1);
  assert.equal(snapshot.people[0].contact_level, 'L3');
  assert.equal(snapshot.fit.value.fitScore, 88);
  assert.equal(snapshot.fit.value.grade, 'A');
  assert.equal(snapshot.fit.engine, 'fixture-engine');
  assert.ok(snapshot.fit.cost > 0);
  assert.equal(snapshot.run.state, 'needs_review');
  assert.equal(snapshot.run.routeState, 'needs_review');
  assert.equal(snapshot.run.completeness, 100);
  assert.deepEqual(snapshot.run.missingItems, []);
  assert.ok(snapshot.run.tags.includes('电力电子'));
  assert.ok(snapshot.evidence.length >= 4);
  assert.ok(snapshot.proposals.length >= 5);
  assert.ok(snapshot.tasks.some(task => task.station === 'customer_fit' && task.state === 'succeeded'));
  assert.ok(snapshot.tasks.some(task => task.station === 'enrichment_finalize' && task.state === 'needs_review'));
  assert.ok(snapshot.taskCenter.some(task => task.taskType === 'customer_fit'));
  assert.ok(snapshot.taskCenter.some(task => task.taskType === 'enrichment_finalize'));
  assert.deepEqual(new Set(snapshot.legacyTasks.map(task => task.type)), new Set(['recon', 'contact_recon']));
  assert.ok(snapshot.usage.some(item => item.station === 'recon_dispatch'));
  assert.ok(snapshot.usage.some(item => item.station === 'contact_dispatch'));
  assert.ok(snapshot.usage.some(item => item.station === 'customer_fit' && item.costMicros > 0));
  assert.equal(snapshot.ownerAfter, snapshot.ownerBefore);
}

test('company-name-only customer completes the structural enrichment workflow', async t => {
  const fixture = await createEnrichmentFixture();
  t.after(() => fixture.close());
  const snapshot = await fixture.startScenario({ companyName: 'Name Only Components' });
  assertCompleted(snapshot);
  assert.equal(snapshot.profile.company_name, 'Name Only Components');
  assert.match(snapshot.profile.website, /^https:\/\//);
});

test('website-only customer completes the structural enrichment workflow', async t => {
  const fixture = await createEnrichmentFixture();
  t.after(() => fixture.close());
  const snapshot = await fixture.startScenario({ website: 'https://website-only.example' });
  assertCompleted(snapshot);
  assert.equal(snapshot.profile.website, 'https://website-only.example/');
  assert.ok(snapshot.profile.company_name);
});

test('incomplete existing customer completes enrichment without changing owner', async t => {
  const fixture = await createEnrichmentFixture();
  t.after(() => fixture.close());
  fixture.fx.db.prepare(`UPDATE customer_pool SET website='',country='',industry='',
    customer_type='',products='',description='',best_contact_level='L0'
    WHERE customer_id='RU-9002'`).run();
  fixture.fx.db.prepare(`UPDATE crm_accounts SET website='',country='',industry='',
    customer_type='',product_focus='' WHERE id='CRM-OWN'`).run();
  const snapshot = await fixture.startScenario({ existingCustomerId: 'RU-9002' });
  assertCompleted(snapshot);
  assert.equal(snapshot.ownerBefore, 'U-MGR');
  assert.equal(snapshot.ownerAfter, 'U-MGR');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const {
  ensureCustomerPoolLifecycle,
} = require('../lib/db');
const fixtures = require('./helpers/permission_fixture');

test('customer import scripts persist local wall-clock lifecycle timestamps', () => {
  for (const relativePath of [
    '../scripts/import-bot3-crm-pipeline.js',
    '../scripts/migrate.js',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    assert.match(source, /function localDateTimeText\(d = new Date\(\)\)/);
    assert.match(source, /d\.getFullYear\(\)/);
    assert.match(source, /d\.getHours\(\)/);
    assert.match(source, /const importedAt = localDateTimeText\(\)/);
    assert.doesNotMatch(source, /const importedAt = .*toISOString/);
  }
});

test('customer_pool lifecycle migration upgrades legacy schema conservatively and idempotently', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('recursive_triggers = ON');
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      first_found TEXT NOT NULL DEFAULT '',
      last_found TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO customer_pool
      (customer_id,company_name,first_found,last_found,notes)
    VALUES
      ('RU-9011','Legacy customer','2020-01-01','2025-12-31','legacy note');
  `);

  ensureCustomerPoolLifecycle(db);
  ensureCustomerPoolLifecycle(db);

  assert.deepEqual(
    db.prepare('PRAGMA table_info(customer_pool)').all()
      .filter(column => ['created_at', 'updated_at'].includes(column.name))
      .map(column => column.name),
    ['created_at', 'updated_at'],
  );
  assert.deepEqual(
    db.prepare(`SELECT company_name companyName,first_found firstFound,last_found lastFound,
        notes,created_at createdAt,updated_at updatedAt
      FROM customer_pool WHERE customer_id='RU-9011'`).get(),
    {
      companyName: 'Legacy customer',
      firstFound: '2020-01-01',
      lastFound: '2025-12-31',
      notes: 'legacy note',
      createdAt: '',
      updatedAt: '',
    },
  );
  assert.equal(db.prepare('SELECT COUNT(*) count FROM customer_pool').get().count, 1);
  assert.deepEqual(
    db.prepare(`SELECT name FROM sqlite_master
      WHERE type='trigger' AND name LIKE 'customer_pool_lifecycle_%' ORDER BY name`).all(),
    [
      { name: 'customer_pool_lifecycle_insert' },
      { name: 'customer_pool_lifecycle_update' },
    ],
  );

  db.prepare(`INSERT INTO customer_pool(customer_id,company_name)
    VALUES ('RU-9012','New customer')`).run();
  const inserted = db.prepare(`SELECT created_at createdAt,updated_at updatedAt
    FROM customer_pool WHERE customer_id='RU-9012'`).get();
  assert.match(inserted.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(inserted.updatedAt, inserted.createdAt);

  db.prepare(`UPDATE customer_pool SET updated_at='2000-01-01 00:00:00'
    WHERE customer_id='RU-9012'`).run();
  db.prepare(`UPDATE customer_pool SET company_name='Updated customer'
    WHERE customer_id='RU-9012'`).run();
  const updated = db.prepare(`SELECT created_at createdAt,updated_at updatedAt
    FROM customer_pool WHERE customer_id='RU-9012'`).get();
  assert.equal(updated.createdAt, inserted.createdAt);
  assert.notEqual(updated.updatedAt, '2000-01-01 00:00:00');
});

test('profile API exposes lifecycle fields and only normalized sanction states', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());

  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('JOB-HIT','RU-9001','Wu Fixture','done',?,?)`)
    .run('2026-07-22 08:00:00', '2026-07-22 08:00:00');
  fx.db.prepare(`INSERT INTO recon_results
    (job_id,customer_id,company_name,sanction_status,compliance_status,sanctioned,
     sanction_source,sanction_checked_at,evidence_url,updated_at)
    VALUES ('JOB-HIT','RU-9001','Wu Fixture','HIT','sanctioned','true',
      'official-list','2026-07-22 08:00:00','https://evidence.test/hit','2026-07-22 08:00:00')`).run();
  fx.db.prepare(`INSERT INTO sanction_checks
    (job_id,customer_id,provider,result,review_status,matches_json,checked_at,created_at)
    VALUES ('JOB-HIT','RU-9001','official-list','confirmed_match','confirmed','[]',
      '2026-07-22 08:00:00','2026-07-22 08:00:00')`).run();

  fx.db.prepare(`UPDATE recon_results SET sanction_status='CLEAR',compliance_status='clear',
    sanctioned='false',sanction_checked_at='2026-07-22 08:00:00',
    updated_at='2026-07-22 08:00:00' WHERE job_id='JOB-OWN'`).run();
  fx.db.prepare(`UPDATE recon_jobs SET updated_at='2026-07-22 08:00:00'
    WHERE job_id='JOB-OWN'`).run();

  fx.db.prepare(`INSERT INTO recon_jobs
    (job_id,customer_id,company_name,status,requested_at,updated_at)
    VALUES ('JOB-FAIL','RU-9003','Other Fixture','failed',?,?)`)
    .run('2026-07-23 08:00:00', '2026-07-23 08:00:00');

  const expected = new Map([
    ['RU-9001', '受制裁'],
    ['RU-9002', '未制裁'],
    ['RU-9003', '未知'],
  ]);
  for (const [customerId, sanctionStatus] of expected) {
    const response = await fx.request(`/api/sales-crm/profile/${customerId}`, {
      cookie: fx.cookie,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const profile = body.customerPool[0];
    assert.equal(profile.sanctionStatus, sanctionStatus);
    assert.match(profile.createdAt, /^\d{4}-\d{2}-\d{2} /);
    assert.match(profile.updatedAt, /^\d{4}-\d{2}-\d{2} /);
    assert.ok(['受制裁', '未制裁', '未知'].includes(profile.sanctionStatus));
  }

  fx.db.prepare(`UPDATE sanction_checks SET checked_at='' WHERE job_id='JOB-HIT'`).run();
  let response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie });
  let body = await response.json();
  assert.equal(body.customerPool[0].sanctionStatus, '未知');

  fx.db.prepare(`DELETE FROM sanction_checks WHERE job_id='JOB-HIT'`).run();
  fx.db.prepare(`UPDATE recon_results SET sanction_source='',evidence_url=''
    WHERE job_id='JOB-HIT'`).run();
  response = await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie });
  body = await response.json();
  assert.equal(body.customerPool[0].sanctionStatus, '未知');

  fx.db.prepare(`UPDATE recon_results SET sanction_checked_at='' WHERE job_id='JOB-OWN'`).run();
  response = await fx.request('/api/sales-crm/profile/RU-9002', { cookie: fx.cookie });
  body = await response.json();
  assert.equal(body.customerPool[0].sanctionStatus, '未知');
});

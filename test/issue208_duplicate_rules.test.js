'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  DUPLICATE_RULE_VERSION,
  canonicalDomain,
  findExactDuplicate,
  findFuzzyDuplicateCandidates,
} = require('../lib/ai_stations/enrichment/dedupe');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE customer_pool (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT '',
      russian_name TEXT NOT NULL DEFAULT '',
      english_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE crm_accounts (
      id TEXT PRIMARY KEY,
      external_customer_id TEXT NOT NULL,
      company_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '',
      lifecycle_status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  const insertPool = db.prepare(`INSERT INTO customer_pool
    (customer_id,company_name,russian_name,english_name,nickname,country,city,website,industry,customer_type)
    VALUES (@customerId,@companyName,'',@englishName,@nickname,@country,@city,@website,@industry,@customerType)`);
  const insertAccount = db.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,nickname,country,city,website,industry,customer_type)
    VALUES (@accountId,@customerId,@companyName,@nickname,@country,@city,@website,@industry,@customerType)`);
  function add(row) {
    const value = {
      accountId: `CRM-${row.customerId}`,
      englishName: '', nickname: '', country: '', city: '', website: '', industry: '', customerType: '',
      ...row,
    };
    insertPool.run(value);
    insertAccount.run(value);
  }
  return { db, add };
}

test('registrable domains and normalized names are deterministic exact evidence', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  fx.add({
    customerId: 'BR-DBTEC', companyName: 'DBTEC Ltd.', website: 'https://www.dbtec.com.br/about',
  });
  fx.add({
    customerId: 'US-GITHUB', companyName: 'Hosted Tenant One', website: 'https://foo.github.io',
  });

  assert.equal(DUPLICATE_RULE_VERSION, 'duplicate-v2');
  assert.equal(canonicalDomain('https://shop.dbtec.com.br/contact'), 'dbtec.com.br');
  assert.equal(canonicalDomain('https://foo.github.io/path'), 'foo.github.io');
  assert.equal(canonicalDomain('https://bar.blogspot.com'), 'bar.blogspot.com');
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'Different hosted company', website: 'https://bar.github.io/path',
  }), null);
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'Different label', website: 'https://www.foo.github.io/path',
  }).customerId, 'US-GITHUB');
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'Different company', website: 'https://shop.dbtec.com.br/contact',
  }).matchedBy, 'domain');
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'DBTEC LIMITED', website: 'https://different.example',
  }).matchedBy, 'name');
  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'Different company', website: 'https://dbtec.com',
  }), null);
});

test('Brazil public suffix and short-name domain similarity never create DBTEC reviews', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  fx.add({
    customerId: 'BR-DBTEC', companyName: 'DBTEC', country: 'Brazil', city: 'Sao Paulo',
    website: 'https://dbtec.com.br/', industry: 'Industrial electronics', customerType: 'Manufacturer',
  });

  const falsePositives = [
    ['WTECK', 'https://wteck.com.br'],
    ['Jawa-tec', 'https://jawa-tec.com.br'],
    ['Kalatec', 'https://kalatec.com.br'],
    ['Pyrotec', 'https://pyrotec.com.br'],
    ['Unitek', 'https://unitek.com.br'],
    ['Vaportec', 'https://vaportec.com.br'],
    ['ECNC', 'https://ecnc.com.br'],
  ];
  for (const [companyName, website] of falsePositives) {
    const candidates = findFuzzyDuplicateCandidates(fx.db, {
      companyName, website, country: 'Brazil', industry: 'Industrial electronics',
    });
    assert.deepEqual(candidates, [], `${companyName} must not point to DBTEC`);
  }
});

test('fuzzy names require reliable supporting identity evidence', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  fx.add({
    customerId: 'DE-ACME', companyName: 'Acme Industrial Technology', nickname: 'Acme Tech',
    country: 'Germany', city: 'Dresden', website: 'https://acme-industrial.de',
    industry: 'Precision motion control', customerType: 'Manufacturer',
  });

  const countrySupported = findFuzzyDuplicateCandidates(fx.db, {
    companyName: 'Acme Industrial Technologies', country: '德国',
  });
  assert.equal(countrySupported.length, 1);
  assert.ok(countrySupported[0].reliableEvidence.some(item => item.kind === 'country'));
  assert.deepEqual(findFuzzyDuplicateCandidates(fx.db, {
    companyName: 'Acme Industrial Technologies', country: 'France', industry: 'General electronics',
  }), []);

  const candidates = findFuzzyDuplicateCandidates(fx.db, {
    companyName: 'Acme Industrial Technologies', country: 'Germany', city: 'Dresden',
    industry: 'Precision motion control', website: 'https://acme-industrials.de',
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].customerId, 'DE-ACME');
  assert.equal(candidates[0].matchedBy, 'fuzzy_name');
  assert.ok(candidates[0].reliableEvidence.some(item => item.kind === 'city'));
  assert.ok(candidates[0].reliableEvidence.some(item => item.kind === 'industry'));
  assert.ok(candidates[0].referenceSignals.some(item => item.kind === 'domain_similarity'));
});

test('active CRM identity fields take precedence over stale pool fields', t => {
  const fx = fixture();
  t.after(() => fx.db.close());
  fx.add({
    customerId: 'DE-LIVE', companyName: 'Legacy Pool Name', website: 'https://stale.example',
    country: 'Germany', city: 'Berlin', industry: 'General electronics', customerType: 'Distributor',
  });
  fx.db.prepare(`UPDATE crm_accounts SET company_name='Live Account GmbH',website='https://live.example',
    city='Dresden',industry='Precision motion control',customer_type='Manufacturer'
    WHERE external_customer_id='DE-LIVE'`).run();

  assert.equal(findExactDuplicate(fx.db, {
    companyName: 'Different label', website: 'https://www.live.example/contact',
  }).customerId, 'DE-LIVE');
});

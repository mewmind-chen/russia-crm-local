const test = require('node:test');
const assert = require('node:assert/strict');
const { looksLikePersonName, ratePerson, validateContactRecon } = require('../lib/contact_quality');

test('role text is not accepted as a person name', () => {
  assert.equal(looksLikePersonName('总经理'), false);
  assert.equal(looksLikePersonName('总经理 — Иванов Иван'), false);
  assert.equal(looksLikePersonName('Иванов Иван Иванович'), true);
});

test('generic company mailbox cannot exceed L1', () => {
  const person = ratePerson({
    person_id: 'P1', full_name: 'Иванов Иван Иванович', role_category: 'procurement', decision_role: 'decision_maker',
    employment: { status: 'verified_current', confidence: 90 },
    methods: [{ type: 'email', value: 'sales@example.ru', discovery_type: 'company_generic', verification_status: 'verified', is_direct: false, source_url: 'https://example.ru' }],
  }, [{ person_id: 'P1', source_url: 'https://example.ru/team', supports_current_employment: true, supports_decision_role: true }]);
  assert.equal(person.contact_level, 'L1');
  assert.equal(person.sales_ready, false);
});

test('inferred personal email is L2 and requires review', () => {
  const person = ratePerson({
    person_id: 'P2', full_name: 'Петров Петр Петрович', role_category: 'supply_chain', decision_role: 'decision_maker',
    employment: { status: 'verified_current', confidence: 85 },
    methods: [{ type: 'email', value: 'p.petrov@example.ru', discovery_type: 'pattern_inferred', verification_status: 'likely_valid', is_direct: true, is_inferred: true, source_url: '' }],
  }, [{ person_id: 'P2', source_url: 'https://example.ru/news', supports_current_employment: true, supports_decision_role: true }]);
  assert.equal(person.contact_level, 'L2');
  assert.equal(person.manual_review_required, true);
  assert.equal(person.sales_ready, false);
});

test('verified direct contact with employment and role evidence is L3', () => {
  const person = ratePerson({
    person_id: 'P3', full_name: 'Сидоров Сергей Сергеевич', role_category: 'procurement', decision_role: 'decision_maker',
    employment: { status: 'verified_current', confidence: 95 },
    methods: [{ type: 'email', value: 's.sidorov@example.ru', discovery_type: 'document_extracted', verification_status: 'verified', is_direct: true, source_url: 'https://example.ru/tender.pdf' }],
  }, [
    { person_id: 'P3', source_url: 'https://example.ru/tender.pdf', supports_current_employment: true, supports_decision_role: true },
  ]);
  assert.equal(person.contact_level, 'L3');
  assert.equal(person.sales_ready, true);
  assert.equal(person.procurement_relevance, 'P3');
});

test('verified commercial contact remains an entry person, not sales-ready procurement', () => {
  const person = ratePerson({
    person_id: 'P4', full_name: 'Морозова Екатерина Николаевна', role_category: 'commercial', decision_role: 'influencer',
    employment: { status: 'verified_current', confidence: 95 },
    methods: [{ type: 'email', value: 'morozova@example.ru', discovery_type: 'public_direct', verification_status: 'verified', is_direct: true, source_url: 'https://example.ru/contacts' }],
  }, [{ person_id: 'P4', source_url: 'https://example.ru/contacts', supports_current_employment: true, supports_decision_role: true }]);
  assert.equal(person.contact_level, 'L3');
  assert.equal(person.procurement_relevance, 'P1');
  assert.equal(person.sales_ready, false);
  assert.equal(person.delivery_status, 'verified_entry_only');
});

test('contact contract catches identity and evidence problems', () => {
  const errors = validateContactRecon({ schema_version: 'contact-recon-v1', job_id: 'x', customer_id: 'y', people: [], evidence: [] }, { jobId: 'z', customerId: 'y' });
  assert.ok(errors.some(item => item.includes('job_id')));
});

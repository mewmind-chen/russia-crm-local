const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateReconV3, evidenceMetrics } = require('../lib/recon_contract');

test('example V3 contract is accepted', () => {
  const value = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'examples', 'recon-result-clear.json')));
  assert.deepEqual(validateReconV3(value, { jobId: value.job_id, customerId: value.customer_id }), []);
});

test('identity mismatches are rejected', () => {
  const value = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'examples', 'recon-result-clear.json')));
  const errors = validateReconV3(value, { jobId: 'OTHER', customerId: 'RU-9999' });
  assert.ok(errors.some(item => item.includes('job_id')));
  assert.ok(errors.some(item => item.includes('customer_id')));
});

test('evidence metrics distinguish selected and unique sources', () => {
  assert.deepEqual(evidenceMetrics([
    { field_name: 'a', source_url: 'https://a.example', selected_for_report: true },
    { field_name: 'b', source_url: 'https://a.example', selected_for_report: false },
    { field_name: 'c', source_url: '', selected_for_report: true },
  ]), { total: 3, selected: 2, uniqueSources: 1 });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeCountryPrefix } = require('../lib/customer_ids');

test('country names resolve to ISO alpha-2 customer prefixes', () => {
  assert.equal(normalizeCountryPrefix('Kazakhstan'), 'KZ');
  assert.equal(normalizeCountryPrefix('英国'), 'GB');
  assert.equal(normalizeCountryPrefix('Казахстан'), 'KZ');
  assert.equal(normalizeCountryPrefix('United States of America'), 'US');
  assert.equal(normalizeCountryPrefix('DE'), 'DE');
});

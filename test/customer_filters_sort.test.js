'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCustomerQuery } = require('../lib/customer_filters');

test('customer query accepts legal JSON sort and includes id tie breaker', () => {
  const result = buildCustomerQuery({
    sort: JSON.stringify([
      { field: 'company', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
    ]),
  }, { now: new Date('2026-09-01T00:00:00Z') });

  assert.match(result.orderBy, /COLLATE NOCASE ASC/);
  assert.match(result.orderBy, /a\.priority DESC/);
  assert.match(result.orderBy, /a\.id ASC$/);
});

test('customer query rejects unknown JSON sort fields with authorization error', () => {
  assert.throws(() => buildCustomerQuery({
    sort: JSON.stringify([{ field: 'secret', direction: 'asc' }]),
  }), error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, 'SORT_NOT_AUTHORIZED');
    return true;
  });
});

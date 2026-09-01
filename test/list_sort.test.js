'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { orderByForSort, parseSortDescriptors } = require('../lib/list_sort');

const ALLOWED = {
  company: 'company_name',
  priority: 'priority',
};

test('sort parser accepts legal multi-level JSON and preserves order', () => {
  const value = JSON.stringify([
    { field: 'company', direction: 'asc' },
    { field: 'priority', direction: 'desc' },
  ]);
  assert.deepEqual(parseSortDescriptors(value, ALLOWED).map(({ field, direction }) => ({ field, direction })), [
    { field: 'company', direction: 'asc' },
    { field: 'priority', direction: 'desc' },
  ]);
  assert.equal(orderByForSort(value, ALLOWED, { tieBreaker: 'id ASC' }).orderBy,
    'company_name ASC,priority DESC,id ASC');
});

test('sort parser rejects unknown fields and invalid directions fail closed', () => {
  for (const value of [
    JSON.stringify([{ field: 'secret', direction: 'asc' }]),
    JSON.stringify([{ field: 'company', direction: 'sideways' }]),
  ]) {
    assert.throws(() => parseSortDescriptors(value, ALLOWED), error => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'SORT_NOT_AUTHORIZED');
      return true;
    });
  }
});

test('orderByForSort appends a stable tie breaker', () => {
  const result = orderByForSort('[{"field":"company","direction":"asc"}]', ALLOWED, {
    tieBreaker: 'id ASC',
  });
  assert.equal(result.orderBy, 'company_name ASC,id ASC');
});

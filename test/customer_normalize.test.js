'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCountry,
  normalizeEstablishedYear,
  normalizeAccountNickname,
  normalizeCustomerStarReason,
} = require('../lib/domains/customer/normalize');
const { validateRecycleReason } = require('../lib/domains/customer/recycle');

test('normalizeCountry maps aliases and preserves unknown values', () => {
  assert.equal(normalizeCountry('ru'), '俄罗斯');
  assert.equal(normalizeCountry('RUSSIA'), '俄罗斯');
  assert.equal(normalizeCountry(' br '), '巴西');
  assert.equal(normalizeCountry('us'), '美国');
  assert.equal(normalizeCountry('kz'), '哈萨克斯坦');
  assert.equal(normalizeCountry('德国'), '德国');
  assert.equal(normalizeCountry('未知国家'), '未知国家');
  assert.equal(normalizeCountry(''), '');
});

test('normalizeEstablishedYear accepts four-digit years within range', () => {
  assert.equal(normalizeEstablishedYear(''), null);
  assert.equal(normalizeEstablishedYear('  '), null);
  assert.equal(normalizeEstablishedYear('2020'), 2020);
  assert.equal(normalizeEstablishedYear('1000'), 1000);
});

test('normalizeEstablishedYear rejects invalid years with the injected error', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeEstablishedYear('999', { badRequest }), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /成立年份/);
    return true;
  });
  assert.throws(() => normalizeEstablishedYear('20201', { badRequest }), /成立年份/);
  assert.throws(() => normalizeEstablishedYear('2025', {
    badRequest, now: new Date('2024-06-01T00:00:00Z'),
  }), /成立年份/);
});

test('normalizeAccountNickname trims and enforces the 40-character limit', () => {
  assert.equal(normalizeAccountNickname(''), '');
  assert.equal(normalizeAccountNickname(null), '');
  assert.equal(normalizeAccountNickname('  昵称  '), '昵称');
  assert.equal(normalizeAccountNickname('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'), '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十');
});

test('normalizeAccountNickname rejects blank, control, and oversized values', () => {
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeAccountNickname('   ', { badRequest }), error => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /不能只包含空白/);
    return true;
  });
  assert.throws(() => normalizeAccountNickname('a\u0000b', { badRequest }), /控制字符/);
  assert.throws(() => normalizeAccountNickname('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一', { badRequest }), /最多40/);
});

test('normalizeCustomerStarReason collapses whitespace and enforces limits', () => {
  assert.equal(normalizeCustomerStarReason(''), '');
  assert.equal(normalizeCustomerStarReason('  重点  客户  '), '重点 客户');
  const badRequest = message => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  };
  assert.throws(() => normalizeCustomerStarReason('a\u0000b', { badRequest }), /控制字符/);
  assert.throws(() => normalizeCustomerStarReason('a'.repeat(101), { badRequest }), /最多100/);
});

test('validateRecycleReason accepts 2-500 characters and rejects out-of-range values', () => {
  const httpError = (statusCode, message, code) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  };
  assert.equal(validateRecycleReason(' 退回 '), '退回');
  assert.equal(validateRecycleReason('x'.repeat(500)), 'x'.repeat(500));
  assert.throws(() => validateRecycleReason('x', { httpError }), error => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'INVALID_RECYCLE_REASON');
    assert.match(error.message, /2至500/);
    return true;
  });
  assert.throws(() => validateRecycleReason('x'.repeat(501), { httpError }), /2至500/);
});

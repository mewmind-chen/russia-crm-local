'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdentityMiddleware } = require('../lib/domains/identity/middleware');

function responseMock() {
  const response = { statusCode: 200, body: null };
  response.status = code => {
    response.statusCode = code;
    return response;
  };
  response.json = body => {
    response.body = body;
    return response;
  };
  return response;
}

function requestMock() {
  return { headers: {} };
}

test('identity middleware returns the sales auth contract for missing sessions', () => {
  const middleware = createIdentityMiddleware({
    openDb: () => { throw new Error('must not open db'); },
    getSession: () => null,
    buildAccessContext: () => {},
  });
  const response = responseMock();
  let nextCalled = false;
  middleware.requireSalesUser(requestMock(), response, () => { nextCalled = true; });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { ok: false, error: '请先登录', code: 'AUTH_REQUIRED' });
  assert.equal(nextCalled, false);
});

test('identity middleware preserves unified auth and ended impersonation contracts', () => {
  const middleware = createIdentityMiddleware({
    openDb: () => { throw new Error('must not open db'); },
    getSession: () => null,
    buildAccessContext: () => {},
  });
  const response = responseMock();
  middleware.requireUnifiedUser(requestMock(), response, () => {});
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { ok: false, error: '请先登录' });

  const ended = createIdentityMiddleware({
    openDb: () => { throw new Error('must not open db'); },
    getSession: () => ({ ended: true }),
    buildAccessContext: () => {},
  });
  const endedResponse = responseMock();
  ended.requireSalesUser(requestMock(), endedResponse, () => {});
  assert.equal(endedResponse.statusCode, 409);
  assert.deepEqual(endedResponse.body, {
    ok: false,
    error: '身份检查已结束，请刷新页面',
    code: 'IMPERSONATION_ENDED',
  });
});

test('identity middleware populates request identity and closes its database handle', () => {
  let closed = false;
  let contextArgs;
  const realUser = { id: 'U-REAL', role: 'admin' };
  const effectiveUser = { id: 'U-TARGET', role: 'sales' };
  const middleware = createIdentityMiddleware({
    openDb: () => ({ close: () => { closed = true; } }),
    getSession: () => ({
      realUser,
      effectiveUser,
      impersonation: { contextId: 'IMP-1' },
      tokenHash: 'hash-1',
      ended: false,
    }),
    buildAccessContext: (...args) => { contextArgs = args; return { accountIds: new Set() }; },
  });
  const request = requestMock();
  let nextCalled = false;
  middleware.requireSalesUser(request, responseMock(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(request.realUser, realUser);
  assert.equal(request.salesUser, effectiveUser);
  assert.deepEqual(request.impersonation, { contextId: 'IMP-1' });
  assert.equal(request.sessionTokenHash, 'hash-1');
  assert.deepEqual(contextArgs[1], effectiveUser);
  assert.equal(closed, true);
});

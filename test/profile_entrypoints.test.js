const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {
  registerProfileAssets,
  registerDevelopmentWorkbench,
} = require('../lib/profile_entrypoints');

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return server;
}

function urlFor(server, route) {
  return `http://127.0.0.1:${server.address().port}${route}`;
}

test('profile assets remain authenticated, typed JavaScript, and root-isolated', async t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-profile-assets-'));
  fs.writeFileSync(path.join(rootDir, 'profile-contacts.js'), 'contacts fixture');
  fs.writeFileSync(path.join(rootDir, 'profile-insights.js'), 'insights fixture');
  let authCalls = 0;
  const requireUnifiedUser = (_req, _res, next) => {
    authCalls += 1;
    next();
  };
  const server = await listen(registerProfileAssets(express(), { rootDir, requireUnifiedUser }));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  const contacts = await fetch(urlFor(server, '/profile-contacts.js'));
  const insights = await fetch(urlFor(server, '/profile-insights.js'));
  assert.equal(contacts.status, 200);
  assert.equal(insights.status, 200);
  assert.match(contacts.headers.get('content-type') || '', /javascript/);
  assert.match(insights.headers.get('content-type') || '', /javascript/);
  assert.equal(await contacts.text(), 'contacts fixture');
  assert.equal(await insights.text(), 'insights fixture');
  assert.equal(authCalls, 2);
});

test('development workbench preserves profile/intake permission routing and frame policy', async t => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-development-workbench-'));
  fs.writeFileSync(path.join(rootDir, 'Index.html'), 'workbench fixture');
  const requireUnifiedUser = (req, _res, next) => {
    req.salesUser = { permissions: req.headers['x-permissions']?.split(',').filter(Boolean) || [] };
    next();
  };
  const hasPermission = (user, permission) => user?.permissions?.includes(permission);
  const server = await listen(registerDevelopmentWorkbench(express(), {
    rootDir,
    requireUnifiedUser,
    hasPermission,
  }));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  const request = (route, permissions = '') => fetch(urlFor(server, route), {
    headers: { 'x-permissions': permissions },
  });

  const regular = await request('/development-workbench', 'view_development');
  assert.equal(regular.status, 200);
  assert.equal(await regular.text(), 'workbench fixture');
  assert.equal(regular.headers.get('x-frame-options'), 'SAMEORIGIN');

  const customer = await request('/development-workbench?profile=1&customer=RU-9001', 'view_customers');
  assert.equal(customer.status, 200);
  assert.equal(customer.headers.get('x-frame-options'), 'SAMEORIGIN');

  const intake = await request('/development-workbench?profile=1&intake=INTAKE-1', 'view_intake');
  assert.equal(intake.status, 200);
  assert.equal(intake.headers.get('x-frame-options'), 'SAMEORIGIN');

  const denied = await request('/development-workbench?profile=1&customer=RU-9001');
  assert.equal(denied.status, 403);
  assert.equal(await denied.text(), '当前账号没有客户资料权限');
  const intakeDenied = await request('/development-workbench?profile=1&intake=INTAKE-1');
  assert.equal(intakeDenied.status, 403);
  assert.equal(await intakeDenied.text(), '当前账号没有线索主档权限');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('server module exports factories without listening during import', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-server-factory-'));
  const tempDb = path.join(tempDir, 'crm.db');
  const originalListen = express.application.listen;
  const previousDbPath = process.env.CRM_DB_PATH;
  let eagerListen = false;

  process.env.CRM_DB_PATH = tempDb;
  express.application.listen = function interceptedListen() {
    eagerListen = true;
    return { close() {} };
  };

  try {
    delete require.cache[require.resolve('../server')];
    const { createApp, startServer } = require('../server');
    assert.equal(eagerListen, false);
    assert.equal(typeof createApp, 'function');
    assert.equal(typeof startServer, 'function');
    assert.equal(typeof createApp().listen, 'function');
  } finally {
    express.application.listen = originalListen;
    delete require.cache[require.resolve('../server')];
    if (previousDbPath === undefined) delete process.env.CRM_DB_PATH;
    else process.env.CRM_DB_PATH = previousDbPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('permission fixture starts an isolated temporary server', async () => {
  let createPermissionFixture;
  try {
    ({ createPermissionFixture } = require('./helpers/permission_fixture'));
  } catch (_error) {}
  assert.equal(typeof createPermissionFixture, 'function');
  const fixture = await createPermissionFixture();
  try {
    assert.match(fixture.dbPath, /crm-permissions-/);
    assert.match(fixture.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await fixture.close();
  }
});

test('legacy HTML entrypoints stay opt-in while the unified root remains canonical', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-legacy-entrypoints-'));
  const tempDb = path.join(tempDir, 'crm.db');
  const keys = ['CRM_DB_PATH', 'NODE_ENV', 'CRM_ENABLE_LEGACY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const { createApp } = require('../server');
  let server;
  const request = route => fetch(`http://127.0.0.1:${server.address().port}${route}`);

  try {
    Object.assign(process.env, {
      CRM_DB_PATH: tempDb,
      NODE_ENV: 'test',
      CRM_ENABLE_LEGACY: 'false',
    });
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/legacy')).status, 404);
    assert.equal((await request('/tradelead-v2.html')).status, 404);
    await new Promise(resolve => server.close(resolve));

    process.env.CRM_ENABLE_LEGACY = 'true';
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    assert.equal((await request('/')).status, 200);
    assert.equal((await request('/legacy')).status, 200);
    assert.equal((await request('/tradelead-v2.html')).status, 200);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('application startup rejects a development database inside production', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-server-path-guard-'));
  const productionRoot = path.join(tempDir, 'tradepulse-production');
  const developmentRoot = path.join(tempDir, 'development-runtime');
  fs.mkdirSync(path.join(productionRoot, 'shared', 'data'), { recursive: true });
  fs.mkdirSync(developmentRoot, { recursive: true });
  const keys = ['NODE_ENV', 'CRM_PRODUCTION_ROOT', 'CRM_RUNTIME_ROOT', 'CRM_DB_PATH'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: 'development',
    CRM_PRODUCTION_ROOT: productionRoot,
    CRM_RUNTIME_ROOT: developmentRoot,
    CRM_DB_PATH: path.join(productionRoot, 'shared', 'data', 'crm.db'),
  });

  try {
    const { createApp } = require('../server');
    assert.throws(() => createApp(), /development runtime cannot use the production root/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

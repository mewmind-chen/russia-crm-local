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

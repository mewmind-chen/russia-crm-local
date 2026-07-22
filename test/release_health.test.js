const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function withHealthFixture({ createDb = true, releaseSha = 'a'.repeat(40) }, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-health-'));
  const dbPath = path.join(dir, 'crm.db');
  const shaPath = path.join(dir, '.release-sha');
  if (createDb) new Database(dbPath).close();
  if (releaseSha !== null) fs.writeFileSync(shaPath, `${releaseSha}\n`);
  const previousDb = process.env.CRM_DB_PATH;
  const previousSha = process.env.CRM_RELEASE_SHA_FILE;
  process.env.CRM_DB_PATH = dbPath;
  process.env.CRM_RELEASE_SHA_FILE = shaPath;
  delete require.cache[require.resolve('../server')];
  const server = require('../server').createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  if (!createDb) fs.rmSync(dbPath, { force: true });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete require.cache[require.resolve('../server')];
    if (previousDb === undefined) delete process.env.CRM_DB_PATH;
    else process.env.CRM_DB_PATH = previousDb;
    if (previousSha === undefined) delete process.env.CRM_RELEASE_SHA_FILE;
    else process.env.CRM_RELEASE_SHA_FILE = previousSha;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('health endpoint returns the exact release SHA after a read-only database query', async () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  await withHealthFixture({ releaseSha: sha }, async baseUrl => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, database: 'ok', releaseSha: sha });
  });
});

test('health endpoint returns 503 without leaking paths when the database is unavailable', async () => {
  await withHealthFixture({ createDb: false }, async baseUrl => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(body, { ok: false, database: 'unavailable', releaseSha: 'a'.repeat(40) });
    assert.doesNotMatch(JSON.stringify(body), /crm-health-|ENOENT|SQLite/i);
  });
});

test('health endpoint returns 503 when release metadata is absent or invalid', async () => {
  await withHealthFixture({ releaseSha: null }, async baseUrl => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, database: 'ok', releaseSha: 'unknown' });
  });
});

test('database health closes an opened handle when its probe query fails', () => {
  const healthModulePath = require.resolve('../lib/release_health');
  const databaseModulePath = require.resolve('better-sqlite3');
  const cachedHealthModule = require.cache[healthModulePath];
  const originalDatabase = require.cache[databaseModulePath].exports;
  let closed = false;

  class FailingDatabase {
    prepare() {
      return { get: () => { throw new Error('probe failed'); } };
    }

    close() {
      closed = true;
    }
  }

  delete require.cache[healthModulePath];
  require.cache[databaseModulePath].exports = FailingDatabase;
  try {
    const { readDatabaseStatus } = require('../lib/release_health');
    assert.equal(readDatabaseStatus('/tmp/crm-health-failing-probe.db'), 'unavailable');
    assert.equal(closed, true);
  } finally {
    delete require.cache[healthModulePath];
    require.cache[databaseModulePath].exports = originalDatabase;
    if (cachedHealthModule) require.cache[healthModulePath] = cachedHealthModule;
  }
});

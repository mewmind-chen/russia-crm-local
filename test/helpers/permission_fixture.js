const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

async function createPermissionFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-permissions-'));
  const dbPath = path.join(dir, 'crm.db');
  if (process.env.CRM_FIXTURE_BASE_DB) {
    fs.copyFileSync(path.resolve(process.env.CRM_FIXTURE_BASE_DB), dbPath);
  }
  const previousDbPath = process.env.CRM_DB_PATH;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.CRM_DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';

  const { installSalesCrm } = require('../../lib/sales_crm');
  const { ensureTables } = require('../../lib/db');
  const { createApp } = require('../../server');
  installSalesCrm();
  ensureTables();

  const db = new Database(dbPath);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    dir,
    dbPath,
    db,
    baseUrl,
    async login(email, password) {
      const response = await fetch(`${baseUrl}/api/sales-auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return String(response.headers.get('set-cookie') || '').split(';')[0];
    },
    request(route, { cookie = '', method = 'GET', body } = {}) {
      return fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    async close() {
      db.close();
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
      if (previousDbPath === undefined) delete process.env.CRM_DB_PATH;
      else process.env.CRM_DB_PATH = previousDbPath;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    },
  };
}

module.exports = { createPermissionFixture };

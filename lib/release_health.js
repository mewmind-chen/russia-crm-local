const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { canonicalPath, databasePath } = require('./runtime_paths');

function healthPaths() {
  return {
    dbPath: databasePath(),
    releaseShaFile: path.resolve(process.env.CRM_RELEASE_SHA_FILE || path.join(__dirname, '..', '.release-sha')),
  };
}

function readReleaseSha(file) {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

function readDatabaseStatus(dbPath) {
  let db;
  let status = 'unavailable';
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.prepare('SELECT 1 AS ok').get();
    status = 'ok';
  } catch (_error) {
    status = 'unavailable';
  } finally {
    try {
      if (db) db.close();
    } catch (_error) {
      status = 'unavailable';
    }
  }
  return status;
}

function databaseIdentity(dbPath) {
  return crypto.createHash('sha256').update(canonicalPath(dbPath)).digest('hex');
}

function registerReleaseHealth(app, options = {}) {
  app.get('/healthz', (_req, res) => {
    const defaults = healthPaths();
    const dbPath = options.dbPath || defaults.dbPath;
    const releaseSha = readReleaseSha(options.releaseShaFile || defaults.releaseShaFile);
    const database = readDatabaseStatus(dbPath);
    const ok = releaseSha !== 'unknown' && database === 'ok';
    const environment = String(options.environment || process.env.NODE_ENV || 'development')
      .trim().toLowerCase();
    res.status(ok ? 200 : 503).json({
      ok,
      database,
      releaseSha,
      ...(environment === 'development'
        ? { developmentDatabaseIdentity: databaseIdentity(dbPath) } : {}),
    });
  });
}

module.exports = {
  databaseIdentity,
  healthPaths,
  readReleaseSha,
  readDatabaseStatus,
  registerReleaseHealth,
};

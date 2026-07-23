const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveRuntimePaths } = require('../lib/runtime_paths');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-runtime-paths-'));
  const productionRoot = path.join(root, 'tradepulse-production');
  const sharedRoot = path.join(productionRoot, 'shared');
  const runtimeRoot = path.join(root, 'development-runtime');
  fs.mkdirSync(path.join(sharedRoot, 'data'), { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  return { root, productionRoot, sharedRoot, runtimeRoot };
}

function productionEnv(fx, overrides = {}) {
  return {
    NODE_ENV: 'production',
    CRM_PRODUCTION_ROOT: fx.productionRoot,
    CRM_RUNTIME_ROOT: path.join(fx.productionRoot, 'releases', 'release-a'),
    CRM_DB_PATH: path.join(fx.sharedRoot, 'data', 'crm.db'),
    RECON_OUTPUT_DIR: path.join(fx.sharedRoot, 'recon-runs'),
    CONTACT_RECON_OUTPUT_DIR: path.join(fx.sharedRoot, 'contact-recon-runs'),
    CONTACT_RECON_REPORT_DIR: path.join(fx.sharedRoot, 'contact-recon-reports'),
    CRM_REPORTS_DIR: path.join(fx.sharedRoot, 'reports'),
    CRM_BACKUP_DIR: path.join(fx.sharedRoot, 'backups', 'data-maintenance'),
    CRM_LOGS_DIR: path.join(fx.sharedRoot, 'logs'),
    CRM_OUTPUT_DIR: path.join(fx.sharedRoot, 'output'),
    CRM_TMP_DIR: path.join(fx.sharedRoot, 'tmp'),
    ...overrides,
  };
}

test('test runtime accepts fully isolated injected paths', () => {
  const fx = fixture();
  try {
    const paths = resolveRuntimePaths({
      NODE_ENV: 'test',
      CRM_PRODUCTION_ROOT: fx.productionRoot,
      CRM_RUNTIME_ROOT: fx.runtimeRoot,
      CRM_DB_PATH: path.join(fx.runtimeRoot, 'data', 'crm.db'),
    });
    assert.equal(paths.environment, 'test');
    const runtimeReal = fs.realpathSync.native(fx.runtimeRoot);
    assert.equal(paths.runtimeRoot, runtimeReal);
    assert.equal(paths.databasePath, path.join(runtimeReal, 'data', 'crm.db'));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('development rejects a database path inside production', () => {
  const fx = fixture();
  try {
    assert.throws(() => resolveRuntimePaths({
      NODE_ENV: 'development',
      CRM_PRODUCTION_ROOT: fx.productionRoot,
      CRM_RUNTIME_ROOT: fx.runtimeRoot,
      CRM_DB_PATH: path.join(fx.sharedRoot, 'data', 'crm.db'),
    }), /development runtime cannot use the production root/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('development cannot bypass production protection through a symlink', () => {
  const fx = fixture();
  try {
    const alias = path.join(fx.root, 'production-alias');
    fs.symlinkSync(fx.productionRoot, alias);
    assert.throws(() => resolveRuntimePaths({
      NODE_ENV: 'development',
      CRM_PRODUCTION_ROOT: fx.productionRoot,
      CRM_RUNTIME_ROOT: fx.runtimeRoot,
      CRM_DB_PATH: path.join(alias, 'shared', 'data', 'crm.db'),
    }), /development runtime cannot use the production root/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('production accepts shared paths inside the production root', () => {
  const fx = fixture();
  try {
    const paths = resolveRuntimePaths(productionEnv(fx));
    assert.equal(paths.environment, 'production');
    assert.equal(
      paths.databasePath,
      path.join(fs.realpathSync.native(path.join(fx.sharedRoot, 'data')), 'crm.db'),
    );
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('production rejects a database outside shared data', () => {
  const fx = fixture();
  try {
    assert.throws(() => resolveRuntimePaths(productionEnv(fx, {
      CRM_DB_PATH: path.join(fx.root, 'outside', 'crm.db'),
    })), /Production database must be inside shared\/data/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('production resolves symlinks before validating the database boundary', () => {
  const fx = fixture();
  try {
    const outside = path.join(fx.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(fx.sharedRoot, 'data', 'escape'));
    assert.throws(() => resolveRuntimePaths(productionEnv(fx, {
      CRM_DB_PATH: path.join(fx.sharedRoot, 'data', 'escape', 'crm.db'),
    })), /Production database must be inside shared\/data/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

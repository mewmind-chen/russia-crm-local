'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'phase-e-browser-preview.js');
const source = fs.readFileSync(SCRIPT, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const harness = require(SCRIPT);

function runScript(args = [], extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.PHASE_E_BROWSER_PREVIEW;
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

test('Phase E preview is an explicit opt-in npm entrypoint', () => {
  assert.match(
    String(packageJson.scripts?.['phase:e:browser-preview'] || ''),
    /scripts\/phase-e-browser-preview\.js\s+--run/,
  );
  const result = runScript();
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /opt-in|PHASE_E_BROWSER_PREVIEW/i);
});

test('preview harness is loopback-only, random-port-only, and avoids the production entrypoint', () => {
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /RANDOM_PORT\s*=\s*0/);
  assert.match(source, /mkdtempSync/);
  assert.match(source, /CRM_DB_PATH/);
  assert.match(source, /CRM_RUNTIME_ROOT/);
  assert.match(source, /CRM_PRODUCTION_ROOT/);
  assert.doesNotMatch(source, /startServer|npm\s+start/);
  assert.doesNotMatch(source, /require\([^)]*lib[\\/]ai_stations/);

  const host = runScript(['--run', '--host=0.0.0.0']);
  assert.notEqual(host.status, 0);
  assert.match(`${host.stdout}\n${host.stderr}`, /non-loopback|127\.0\.0\.1/i);

  const port = runScript(['--run', '--port=3000']);
  assert.notEqual(port.status, 0);
  assert.match(`${port.stdout}\n${port.stderr}`, /random port|port 0/i);
});

test('isolated environment replaces inherited DB and production paths with temporary paths', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-e-contract-runtime-'));
  const productionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-e-contract-production-'));
  const keys = [
    'NODE_ENV', 'CRM_PRODUCTION_ROOT', 'CRM_RUNTIME_ROOT', 'CRM_DB_PATH',
    'RECON_OUTPUT_DIR', 'CONTACT_RECON_OUTPUT_DIR', 'CONTACT_RECON_REPORT_DIR',
    'CRM_REPORTS_DIR', 'CRM_BACKUP_DIR', 'CRM_LOGS_DIR', 'CRM_OUTPUT_DIR', 'CRM_TMP_DIR',
    'CRM_FIXTURE_BASE_DB', 'CRM_AI_STATIONS_ENABLED', 'CRM_AI_CUSTOMER_ENRICHMENT_ENABLED',
    'CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED', 'CRM_AI_SALES_PACK_ENABLED',
    'CRM_AI_QWEN_ONLINE_ENABLED', 'CRM_AI_QWEN_BATCH_ENABLED',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      CRM_PRODUCTION_ROOT: path.join(ROOT, 'data'),
      CRM_RUNTIME_ROOT: path.join(ROOT, 'runtime'),
      CRM_DB_PATH: path.join(ROOT, 'data', 'crm.db'),
      CRM_FIXTURE_BASE_DB: path.join(ROOT, 'data', 'production.db'),
    });
    harness.applyIsolatedEnvironment(runtimeRoot, productionRoot);
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.CRM_RUNTIME_ROOT, runtimeRoot);
    assert.equal(process.env.CRM_PRODUCTION_ROOT, productionRoot);
    assert.equal(process.env.CRM_DB_PATH, path.join(runtimeRoot, 'crm.db'));
    assert.equal(process.env.CRM_FIXTURE_BASE_DB, undefined);
    for (const key of [
      'CRM_AI_STATIONS_ENABLED',
      'CRM_AI_CUSTOMER_ENRICHMENT_ENABLED',
      'CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED',
      'CRM_AI_SALES_PACK_ENABLED',
      'CRM_AI_QWEN_ONLINE_ENABLED',
      'CRM_AI_QWEN_BATCH_ENABLED',
    ]) assert.equal(process.env[key], 'false', `${key} must be disabled for preview`);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(productionRoot, { recursive: true, force: true });
  }
});

test('missing browser dependency fails closed with an actionable message', () => {
  const result = runScript(['--run', '--browser=playwright']);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /fail-closed|Playwright|playwright|locked/i);
  assert.match(`${result.stdout}\n${result.stderr}`, /no fake-browser fallback|not declared|not locked/i);
});


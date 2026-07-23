const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'deploy-state.js');

test('deployment state records success and clears an older failure atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-deploy-state-'));
  const file = path.join(dir, 'state.json');
  const env = { ...process.env, DEPLOY_STATE_FILE: file };
  try {
    assert.equal(spawnSync(process.execPath, [script, 'failure', 'a'.repeat(40), 'validate'], { env }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, 'success', 'b'.repeat(40), '/releases/b', '/releases/a'], { env }).status, 0);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(state.lastSuccessfulSha, 'b'.repeat(40));
    assert.equal(state.lastFailedSha, '');
    assert.equal(state.lastFailedStage, '');
    assert.equal(state.currentRelease, '/releases/b');
    assert.equal(state.previousRelease, '/releases/a');
    assert.match(state.lastSuccessfulAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deployment state get returns an empty string for missing files and keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-deploy-state-'));
  const file = path.join(dir, 'state.json');
  try {
    const result = spawnSync(process.execPath, [script, 'get', 'lastSuccessfulSha'], {
      encoding: 'utf8', env: { ...process.env, DEPLOY_STATE_FILE: file },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deployment state defaults beneath DEPLOY_ROOT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-deploy-root-state-'));
  const productionRoot = path.join(dir, 'tradepulse-production');
  const file = path.join(productionRoot, 'state', 'state.json');
  try {
    const result = spawnSync(process.execPath, [script, 'failure', 'a'.repeat(40), 'validate'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: path.join(dir, 'home'), DEPLOY_ROOT: productionRoot },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).lastFailedStage, 'validate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

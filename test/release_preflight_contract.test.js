const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release-preflight.sh');

test('release preflight is a read-only, repeatable release-candidate contract', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env bash/);
  assert.match(source, /Read-only release-candidate preflight/);
  assert.match(source, /origin\/main/);
  assert.match(source, /\.release-sha/);
  assert.match(source, /lastSuccessfulSha/);
  assert.match(source, /--audit-report/);
  assert.match(source, /must not target the production root/);
  assert.match(source, /check:governance-authority/);
  assert.match(source, /check:ai-boundary/);
  assert.match(source, /npm --prefix \"\$ROOT\" test/);
  assert.match(source, /node --test/);
  assert.match(source, /npm --prefix \"\$ROOT\" audit --omit=dev --json/);
  assert.match(source, /lib\/ai_stations/);
  assert.match(source, /crm_ai_/);
  assert.match(source, /production-data/);
  assert.match(source, /RESULT: NO-GO/);
  assert.doesNotMatch(source, /deploy-from-github\.sh/);
  assert.doesNotMatch(source, /launchctl|systemctl/);
});

test('release preflight exposes help and passes shell syntax validation', () => {
  const syntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);

  const help = spawnSync('bash', [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--candidate-sha/);
  assert.match(help.stdout, /--report/);
  assert.match(help.stdout, /--audit-report/);
  assert.match(help.stdout, /--skip-tests/);
});

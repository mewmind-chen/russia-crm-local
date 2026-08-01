const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-release-gate.sh');
const SHA = '0123456789abcdef0123456789abcdef01234567';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-release-gate-'));
  const bin = path.join(root, 'bin');
  const database = path.join(root, 'crm.db');
  fs.mkdirSync(bin);
  fs.writeFileSync(database, 'fixture');
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' "\${MOCK_HEALTH_JSON}"
`);
  fs.writeFileSync(path.join(bin, 'sqlite3'), `#!/bin/sh
if [ "$1" != "-readonly" ] || [ "$2" != "\${EXPECTED_DATABASE}" ]; then
  echo "sqlite3 was not called in read-only mode with the explicit database" >&2
  exit 90
fi
case "$3" in
  *integrity_check*) printf '%s\\n' "\${MOCK_INTEGRITY_OUTPUT:-ok}" ;;
  *foreign_key_check*) printf '%s' "\${MOCK_FOREIGN_KEY_OUTPUT:-}" ;;
  *) echo "unexpected SQLite check: $3" >&2; exit 91 ;;
esac
`);
  fs.chmodSync(path.join(bin, 'curl'), 0o755);
  fs.chmodSync(path.join(bin, 'sqlite3'), 0o755);
  return { root, bin, database };
}

function runGate(fx, overrides = {}, args = [
  '--health-url', 'http://127.0.0.1:3000/healthz',
  '--expected-sha', SHA,
  '--database', fx.database,
]) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.bin}:${process.env.PATH}`,
      EXPECTED_DATABASE: fx.database,
      MOCK_HEALTH_JSON: JSON.stringify({ ok: true, database: 'ok', releaseSha: SHA }),
      ...overrides,
    },
  });
}

test('release gate requires explicit health URL, expected SHA and absolute database path', () => {
  const fx = fixture();
  try {
    const missingDatabase = runGate(fx, {}, [
      '--health-url', 'http://127.0.0.1:3000/healthz', '--expected-sha', SHA,
    ]);
    assert.notEqual(missingDatabase.status, 0);
    assert.match(missingDatabase.stderr, /--database/);

    const relativeDatabase = runGate(fx, {}, [
      '--health-url', 'http://127.0.0.1:3000/healthz',
      '--expected-sha', SHA,
      '--database', 'data/crm.db',
    ]);
    assert.notEqual(relativeDatabase.status, 0);
    assert.match(relativeDatabase.stderr, /absolute/i);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('release gate accepts matching health metadata and a clean database', () => {
  const fx = fixture();
  try {
    const result = runGate(fx);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`release gate passed.*${SHA}`));
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('release gate rejects unhealthy JSON and a release SHA mismatch', () => {
  const fx = fixture();
  try {
    const unhealthy = runGate(fx, {
      MOCK_HEALTH_JSON: JSON.stringify({ ok: false, database: 'unavailable', releaseSha: SHA }),
    });
    assert.notEqual(unhealthy.status, 0);
    assert.match(unhealthy.stderr, /health/i);

    const mismatch = runGate(fx, {
      MOCK_HEALTH_JSON: JSON.stringify({ ok: true, database: 'ok', releaseSha: 'a'.repeat(40) }),
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /SHA mismatch/i);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('release gate rejects failed SQLite integrity and foreign-key checks', () => {
  const fx = fixture();
  try {
    const corrupt = runGate(fx, { MOCK_INTEGRITY_OUTPUT: 'database disk image is malformed' });
    assert.notEqual(corrupt.status, 0);
    assert.match(corrupt.stderr, /integrity_check/);

    const foreignKeys = runGate(fx, { MOCK_FOREIGN_KEY_OUTPUT: 'crm_activities|1|crm_accounts|0' });
    assert.notEqual(foreignKeys.status, 0);
    assert.match(foreignKeys.stderr, /foreign_key_check/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

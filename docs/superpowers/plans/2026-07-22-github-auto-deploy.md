# GitHub Main Auto Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically deploy the newest validated GitHub `main` commit to the production Mac as an immutable release, with unified service versions and automatic code rollback.

**Architecture:** A macOS LaunchAgent invokes one idempotent shell deployment state machine every 60 seconds. The state machine fetches `origin/main` into a deployment-only bare repository, validates an isolated candidate, backs up SQLite, atomically moves a stable `current` symlink, restarts every code service, and rolls the symlink back if SHA-aware health checks fail. Node modules provide the health endpoint, atomic state-file handling, and testable LaunchAgent rendering.

**Tech Stack:** Node.js 22 CommonJS, Node test runner, Express, better-sqlite3, zsh, Git, macOS launchd, GitHub Actions.

## Global Constraints

- GitHub `origin/main` latest SHA is the only production code source.
- Local branches, dirty development files, and uncommitted changes must never enter a release.
- Production Node major version is exactly 22.
- Candidate tests must not open or mutate the production SQLite database.
- CRM, Recon Worker, both Contact Workers, and scheduled code jobs must resolve through the same `russia-crm-current` symlink.
- Deployment failure before switching leaves production untouched; failure after switching restores the previous code release.
- SQLite is backed up with the online backup command before every switch and is never automatically restored.
- Schema changes must remain backward compatible with the previous release.
- The first version writes only local logs and state; it sends no WeCom, Feishu, or email notifications.
- Cloudflare Tunnel configuration and credentials remain unchanged.

---

### Task 1: SHA-aware health endpoint

**Files:**
- Create: `lib/release_health.js`
- Create: `test/release_health.test.js`
- Modify: `server.js:1-60`

**Interfaces:**
- Consumes: `CRM_DB_PATH` and `CRM_RELEASE_SHA_FILE` environment variables, with defaults `<repo>/data/crm.db` and `<repo>/.release-sha`.
- Produces: `registerReleaseHealth(app, options?)` and unauthenticated `GET /healthz` returning `{ ok, database, releaseSha }`.

- [ ] **Step 1: Write failing endpoint tests**

Create `test/release_health.test.js` with real temporary SQLite and HTTP servers:

```js
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
```

- [ ] **Step 2: Verify the tests fail for the missing route**

Run: `node --test test/release_health.test.js`

Expected: FAIL because `/healthz` returns 404 HTML instead of the expected JSON.

- [ ] **Step 3: Implement the health module and register it before authenticated routes**

Create `lib/release_health.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function healthPaths() {
  return {
    dbPath: path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db')),
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
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.prepare('SELECT 1 AS ok').get();
    db.close();
    return 'ok';
  } catch (_error) {
    return 'unavailable';
  }
}

function registerReleaseHealth(app, options = {}) {
  app.get('/healthz', (_req, res) => {
    const defaults = healthPaths();
    const releaseSha = readReleaseSha(options.releaseShaFile || defaults.releaseShaFile);
    const database = readDatabaseStatus(options.dbPath || defaults.dbPath);
    const ok = releaseSha !== 'unknown' && database === 'ok';
    res.status(ok ? 200 : 503).json({ ok, database, releaseSha });
  });
}

module.exports = { healthPaths, readReleaseSha, readDatabaseStatus, registerReleaseHealth };
```

Import `registerReleaseHealth` in `server.js` and call it immediately after security headers, before `registerSalesCrm(app)`:

```js
const { registerReleaseHealth } = require('./lib/release_health');

// Inside createApp(), after middleware and before authenticated routes:
registerReleaseHealth(app);
```

- [ ] **Step 4: Verify endpoint and full suite**

Run: `node --test test/release_health.test.js && npm test`

Expected: 3 health tests pass; full suite reports 155 tests, 0 failures.

- [ ] **Step 5: Commit the health endpoint**

```bash
git add lib/release_health.js server.js test/release_health.test.js
git commit -m "feat: expose release-aware health check"
```

---

### Task 2: Atomic deployment state helper

**Files:**
- Create: `scripts/deploy-state.js`
- Create: `test/deploy_state.test.js`

**Interfaces:**
- Consumes: `DEPLOY_STATE_FILE` plus CLI commands `get <key>`, `success <sha> <current> <previous>`, `failure <sha> <stage>`, and `status`.
- Produces: atomic JSON state with `lastSuccessfulSha`, `lastSuccessfulAt`, `lastFailedSha`, `lastFailedAt`, `lastFailedStage`, `currentRelease`, and `previousRelease`.

- [ ] **Step 1: Write failing state tests**

Create `test/deploy_state.test.js`:

```js
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
```

- [ ] **Step 2: Verify the tests fail because the helper does not exist**

Run: `node --test test/deploy_state.test.js`

Expected: FAIL because `scripts/deploy-state.js` cannot be loaded.

- [ ] **Step 3: Implement the state helper**

Create `scripts/deploy-state.js` with `readState(file)`, `writeState(file, state)`, and CLI dispatch. Resolve the file from `DEPLOY_STATE_FILE`, defaulting to `~/Desktop/projects/russia-crm-deploy/state/state.json`. Validate SHA arguments with `/^[0-9a-f]{40}$/`, create the parent directory, write `${file}.tmp` with mode `0600`, then `renameSync` it over the target. `failure` preserves the last success fields; `success` clears failure fields. `status` prints the complete state as formatted JSON. Unknown commands exit 2 without changing the file.

The exported interface must be:

```js
module.exports = { readState, writeState };
```

The CLI output for `get` must be exactly `String(state[key] || '') + '\n'` so the shell can consume it without `jq`.

- [ ] **Step 4: Verify state tests and syntax**

Run: `node --check scripts/deploy-state.js && node --test test/deploy_state.test.js`

Expected: 2 tests pass, 0 failures.

- [ ] **Step 5: Commit the state helper**

```bash
git add scripts/deploy-state.js test/deploy_state.test.js
git commit -m "feat: persist deployment state atomically"
```

---

### Task 3: GitHub-main release state machine

**Files:**
- Create: `scripts/deploy-from-github.sh`
- Create: `test/deploy_from_github.test.js`

**Interfaces:**
- Consumes: `DEPLOY_REMOTE_URL`, `DEPLOY_BRANCH`, `DEPLOY_GIT_DIR`, `DEPLOY_RELEASES_DIR`, `DEPLOY_CURRENT_LINK`, `DEPLOY_SHARED_ROOT`, `DEPLOY_STATE_DIR`, `DEPLOY_NODE_BIN`, `DEPLOY_VALIDATION_BIN`, `DEPLOY_BACKUP_BIN`, `DEPLOY_RESTART_BIN`, `DEPLOY_HEALTHCHECK_BIN`, and optional `--force`.
- Produces: immutable `<shortSha>` release, atomically updated `current` symlink, `state.json`, backup, restart calls, and exit status 0 only for success or a true no-op.

- [ ] **Step 1: Write a local-Git integration fixture and failing happy-path test**

Create `test/deploy_from_github.test.js`. The fixture must:

1. Create a temporary source repository and bare remote.
2. Commit minimal `package.json`, `server.js`, worker scripts, and persistent-directory placeholders.
3. Create executable validation, backup, restart, and health-check helpers under the fixture directory.
4. Set every `DEPLOY_*` path to the fixture; never access launchd, GitHub, or the production DB.

The first test must run `zsh scripts/deploy-from-github.sh`, then assert:

```js
assert.equal(result.status, 0, result.stderr);
assert.equal(fs.readlinkSync(fixture.currentLink), path.join(fixture.releasesDir, fixture.sha.slice(0, 12)));
assert.equal(fs.readFileSync(path.join(fixture.currentLink, '.release-sha'), 'utf8').trim(), fixture.sha);
assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).lastSuccessfulSha, fixture.sha);
assert.deepEqual(fs.readFileSync(fixture.restartLog, 'utf8').trim().split('\n'), [
  'com.russia-crm.server',
  'com.russia-crm.recon-worker',
  'com.russia-crm.contact-worker-1',
  'com.russia-crm.contact-worker-2',
]);
```

The fake validation helper must assert that `data`, `.env`, and production report links are absent while validation runs. The deployed release must link `.env`, `data`, `logs`, `reports`, `recon-runs`, and `contact-recon-reports` to `DEPLOY_SHARED_ROOT` only after validation.

- [ ] **Step 2: Verify the happy-path test fails because the deployer is missing**

Run: `node --test --test-name-pattern="deploys newest" test/deploy_from_github.test.js`

Expected: FAIL because `scripts/deploy-from-github.sh` does not exist.

- [ ] **Step 3: Implement the minimal successful deployment path**

Create a zsh script with `set -euo pipefail` and these exact stages:

```text
preflight -> lock -> fetch -> resolve -> export -> validate -> backup -> link -> promote
-> switch -> restart -> health -> record-success
```

Required production defaults:

```zsh
REMOTE_URL="${DEPLOY_REMOTE_URL:-https://github.com/mewmind-chen/russia-crm-local.git}"
BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_BASE="${DEPLOY_BASE:-$HOME/Desktop/projects/russia-crm-deploy}"
GIT_DIR="${DEPLOY_GIT_DIR:-$DEPLOY_BASE/repo.git}"
STATE_DIR="${DEPLOY_STATE_DIR:-$DEPLOY_BASE/state}"
RELEASES_DIR="${DEPLOY_RELEASES_DIR:-$HOME/Desktop/projects/russia-crm-releases}"
CURRENT_LINK="${DEPLOY_CURRENT_LINK:-$HOME/Desktop/projects/russia-crm-current}"
SHARED_ROOT="${DEPLOY_SHARED_ROOT:-$HOME/Desktop/projects/russia-crm-local}"
LOCAL_HEALTH_URL="${DEPLOY_LOCAL_HEALTH_URL:-http://127.0.0.1:3000/healthz}"
PUBLIC_HEALTH_URL="${DEPLOY_PUBLIC_HEALTH_URL:-https://crm.newmindchen.com/healthz}"
```

Initialize `GIT_DIR` with `git init --bare`, configure `origin`, and fetch only
`+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH`. Export with
`git --git-dir="$GIT_DIR" archive "$target_sha" | tar -x -C "$candidate"`.
Reject Node majors other than 22. When no validation hook is supplied, run the complete validation sequence from the design. When no backup hook is supplied, run `sqlite3 "$SHARED_ROOT/data/crm.db" ".backup '$backup'"`.

Create each persistent symlink only after deleting the candidate-local path and confirming the candidate path begins with the exact `RELEASES_DIR` prefix. Promote with `mv "$candidate" "$release"`. Switch with a temporary symlink in the same parent directory followed by `mv -h`.

- [ ] **Step 4: Verify the happy-path test passes**

Run: `node --test --test-name-pattern="deploys newest" test/deploy_from_github.test.js`

Expected: 1 test passes and the fixture confirms the remote SHA, delayed persistent links, backup, restart order, health check, and state file.

- [ ] **Step 5: Add failing no-op, failed-candidate, and forced-retry tests**

Add tests that assert:

```js
assert.equal(secondRun.status, 0);
assert.match(secondRun.stdout, /already deployed/);
assert.equal(fs.readFileSync(restartLog, 'utf8'), firstRestartLog);

assert.notEqual(failedValidation.status, 0);
assert.equal(fs.realpathSync(currentLink), oldRelease);
assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastFailedStage, 'validate');

assert.match(skippedFailedSha.stdout, /previously failed/);
assert.equal(forceRetry.status, 0);
```

- [ ] **Step 6: Verify the new tests fail for missing guards**

Run: `node --test test/deploy_from_github.test.js`

Expected: FAIL on repeated restart, missing failed-SHA suppression, and missing `--force` behavior.

- [ ] **Step 7: Implement state guards and candidate cleanup**

Export `DEPLOY_STATE_FILE="$STATE_DIR/state.json"` and use `scripts/deploy-state.js get` before creating a candidate. A matching success SHA is a no-op. A matching failed SHA is a no-op only for automatic runs; parse exactly one optional flag, `--force`, to bypass it. Track `stage` before each operation and call `deploy-state.js failure "$target_sha" "$stage"` from the error trap. The trap may remove only a non-empty candidate path whose real parent is exactly `RELEASES_DIR`.

- [ ] **Step 8: Add failing post-switch rollback test**

Make the health helper fail for the new SHA and succeed for the old release. Assert:

```js
assert.notEqual(result.status, 0);
assert.equal(fs.realpathSync(currentLink), oldRelease);
assert.equal(fs.readFileSync(restartLog, 'utf8').trim().split('\n').length, 8);
assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastFailedStage, 'health');
assert.equal(fs.existsSync(path.join(releasesDir, sha.slice(0, 12))), true);
```

- [ ] **Step 9: Verify rollback test fails, then implement rollback trap**

Run the rollback test before implementation and confirm the symlink remains on the bad release. Then store the previous real target before switching. If restart or health fails after `switched=1`, atomically restore the previous target, restart the same four labels, and invoke the health hook in rollback mode. Preserve the failed release and backup.

- [ ] **Step 10: Run deployment tests and shell syntax checks**

Run:

```bash
zsh -n scripts/deploy-from-github.sh
node --test test/deploy_state.test.js test/deploy_from_github.test.js
```

Expected: all deployment tests pass, no production paths are touched, and zsh syntax exits 0.

- [ ] **Step 11: Commit the deployment state machine**

```bash
git add scripts/deploy-from-github.sh test/deploy_from_github.test.js
git commit -m "feat: deploy immutable releases from GitHub main"
```

---

### Task 4: Stable LaunchAgent rendering and installer

**Files:**
- Create: `lib/macos_launch_agents.js`
- Create: `scripts/install-auto-deploy.js`
- Create: `test/macos_launch_agents.test.js`
- Modify: `scripts/install-daily-services.js:1-27`
- Modify: `package.json:2-60`

**Interfaces:**
- Consumes: `{ runtimeRoot, sourceRoot, logsDir, homeDir, nodeBin, pythonBin, cloudflaredBin, includeAutoDeploy }`.
- Produces: `buildServiceDefinitions(options)` and `renderPlist(definition)`, plus npm commands `deploy:mac:once`, `deploy:mac:retry`, `deploy:mac:install`, and `deploy:mac:status`.

- [ ] **Step 1: Write failing plist tests**

Create `test/macos_launch_agents.test.js` that calls `buildServiceDefinitions` with fixture paths and asserts:

```js
const labels = definitions.map(item => item.label);
assert.deepEqual(labels.filter(label => label.includes('server') || label.includes('worker')), [
  'com.russia-crm.server',
  'com.russia-crm.recon-worker',
  'com.russia-crm.contact-worker-1',
  'com.russia-crm.contact-worker-2',
]);
for (const definition of definitions.filter(item => item.kind === 'code')) {
  assert.match(renderPlist(definition), /\/fixture\/russia-crm-current/);
  assert.doesNotMatch(renderPlist(definition), /russia-crm-local\/scripts/);
}
const deploy = definitions.find(item => item.label === 'com.russia-crm.auto-deploy');
assert.match(renderPlist(deploy), /<key>StartInterval<\/key><integer>60<\/integer>/);
assert.match(renderPlist(deploy), /deploy-from-github\.sh/);
```

Add a separate assertion that the Cloudflare definition is absent from the auto-deploy installer output, proving it will not overwrite the existing tunnel plist.

- [ ] **Step 2: Verify tests fail because the renderer is missing**

Run: `node --test test/macos_launch_agents.test.js`

Expected: FAIL because `lib/macos_launch_agents.js` cannot be required.

- [ ] **Step 3: Implement focused plist rendering**

Create `lib/macos_launch_agents.js` with XML escaping, `renderPlist`, and declarative definitions for the server, three workers, daily enqueue, daily report, completion notifier, and optional auto deploy. Every code path and working directory must use `runtimeRoot`; logs use `logsDir`; environment values include only HOME, PATH, NODE_ENV where required, and localhost NO_PROXY for workers.

Export exactly:

```js
module.exports = { buildServiceDefinitions, renderPlist };
```

- [ ] **Step 4: Verify rendering tests pass**

Run: `node --check lib/macos_launch_agents.js && node --test test/macos_launch_agents.test.js`

Expected: plist tests pass and all code services reference the stable current symlink.

- [ ] **Step 5: Refactor the existing daily installer to use the renderer**

Replace inline plist generation in `scripts/install-daily-services.js`. Choose runtime root in this order:

```js
const defaultCurrent = path.join(os.homedir(), 'Desktop', 'projects', 'russia-crm-current');
const runtimeRoot = path.resolve(process.env.CRM_RUNTIME_ROOT
  || (fs.existsSync(defaultCurrent) ? defaultCurrent : sourceRoot));
```

Keep installing the existing Cloudflare service only in this legacy all-services command. Existing obsolete service cleanup remains. Run its rendering under a temporary HOME in a test-only `CRM_INSTALL_DRY_RUN=1` mode that writes plists but skips launchctl, and assert it no longer points code services back to the development checkout once `current` exists.

- [ ] **Step 6: Write failing installer bootstrap tests**

Test `scripts/install-auto-deploy.js` with a temporary HOME, fixture LaunchAgents directory, `CRM_INSTALL_DRY_RUN=1`, and `DEPLOY_BOOTSTRAP_RELEASE`. Assert it:

- creates `russia-crm-current` pointing at the bootstrap release;
- renders only code-service plists first;
- invokes a fixture deploy command once;
- renders the auto-deploy plist only after the fixture deployment exits 0;
- leaves a pre-existing Cloudflare plist byte-for-byte unchanged;
- does not render auto deploy when the first deployment fails.

- [ ] **Step 7: Verify bootstrap tests fail, then implement the installer**

The installer must validate the bootstrap release is an absolute existing directory, create the initial symlink atomically, write code-service plists, optionally bootstrap them with launchctl, invoke `scripts/deploy-from-github.sh --force`, and only then install `com.russia-crm.auto-deploy`. Use `spawnSync` with argument arrays and `shell: false`.

- [ ] **Step 8: Add npm operator commands**

Modify `package.json` with exact scripts:

```json
"deploy:mac:once": "zsh scripts/deploy-from-github.sh",
"deploy:mac:retry": "zsh scripts/deploy-from-github.sh --force",
"deploy:mac:install": "node scripts/install-auto-deploy.js",
"deploy:mac:status": "node scripts/deploy-state.js status"
```

The `status` command reads the state file from `DEPLOY_STATE_FILE` or the production default and prints formatted JSON without modifying it.

- [ ] **Step 9: Run installer tests and the full suite**

Run:

```bash
node --check scripts/install-auto-deploy.js
node --check scripts/install-daily-services.js
node --test test/macos_launch_agents.test.js
npm test
```

Expected: all tests pass; dry-run fixtures contain no production path and no real LaunchAgent is changed.

- [ ] **Step 10: Commit LaunchAgent and operator commands**

```bash
git add lib/macos_launch_agents.js scripts/install-auto-deploy.js scripts/install-daily-services.js \
  scripts/deploy-state.js test/macos_launch_agents.test.js package.json
git commit -m "feat: install stable macOS deployment services"
```

---

### Task 5: GitHub CI and operations documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md:180-250`
- Modify: `deploy/cloudflare-tunnel.md:9-30`

**Interfaces:**
- Consumes: pull requests and pushes to `main`.
- Produces: Node 22 CI result and exact install, status, retry, log, health, and rollback procedures.

- [ ] **Step 1: Add a failing repository-contract test**

Create `test/deploy_contract.test.js` that reads workflow, package scripts, README, and deployment files. Assert CI triggers both `pull_request` and `push` on `main`, uses `actions/setup-node` with `node-version: 22`, and runs the same syntax/test commands as the local validator. Assert README states that `origin/main` is the only source, no notification is configured, and automatic database restore is forbidden.

- [ ] **Step 2: Verify the contract test fails because CI and docs are absent**

Run: `node --test test/deploy_contract.test.js`

Expected: FAIL because `.github/workflows/ci.yml` does not exist.

- [ ] **Step 3: Add the exact CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: sudo apt-get update && sudo apt-get install -y zsh
      - run: npm ci
      - run: npm test
      - run: node --check server.js
      - run: node --check scripts/deploy-state.js
      - run: node --check scripts/install-auto-deploy.js
      - run: zsh -n scripts/deploy-from-github.sh
      - run: bash -n deploy/backup.sh
      - run: python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
```

Install zsh explicitly on the hosted runner so the workflow checks the production shell syntax. The Mac candidate validator still repeats this check against the exact deployment SHA.

- [ ] **Step 4: Document normal and failure operations**

Update README with:

```text
Normal: merge PR -> Mac validates latest origin/main -> backup -> switch -> health check.
Install: npm run deploy:mac:install
Status: npm run deploy:mac:status
Retry failed SHA: npm run deploy:mac:retry
Logs: tail -f logs/com.russia-crm.auto-deploy.{out,err}.log
Health: curl -fsS http://127.0.0.1:3000/healthz and public /healthz
Rollback boundary: code symlink is automatic; SQLite restore is manual and requires stopped services.
Notifications: none in the first version.
```

Update the Cloudflare document to use `/healthz` and state that deployment never rewrites the tunnel plist or credentials.

- [ ] **Step 5: Verify contract, syntax, and full suite**

Run:

```bash
node --test test/deploy_contract.test.js
node --check server.js
node --check scripts/deploy-state.js
node --check scripts/install-auto-deploy.js
zsh -n scripts/deploy-from-github.sh
python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
npm test
```

Expected: repository contract passes and the full suite has 0 failures.

- [ ] **Step 6: Commit CI and documentation**

```bash
git add .github/workflows/ci.yml README.md deploy/cloudflare-tunnel.md test/deploy_contract.test.js
git commit -m "ci: validate automatic deployment releases"
```

---

### Task 6: Pre-merge review and production rollout

**Files:**
- Verify only; no source edit is expected unless review finds a defect.

**Interfaces:**
- Consumes: completed feature branch, GitHub PR merge, and existing production release path.
- Produces: active auto-deploy LaunchAgent and production SHA equal to GitHub `main`.

- [ ] **Step 1: Run final local verification from the isolated worktree**

Run all commands from Task 5 Step 5 plus `git diff --check` and `git status --short`. Expected: all commands exit 0 and only intended commits differ from `origin/main`.

- [ ] **Step 2: Review security-sensitive shell operations**

Inspect every `rm`, `mv`, `ln`, `git`, `sqlite3`, `launchctl`, and hook invocation. Confirm destructive paths are non-empty, absolute, inside the configured candidate/state roots, and quoted. Confirm no environment value is evaluated as shell source.

- [ ] **Step 3: Push the feature branch and create a pull request only after user authorization**

Suggested title: `Automate production deployment from GitHub main`

The PR description must report the immutable-release flow, rollback boundary, 0-notification decision, exact verification commands, and one-time LaunchAgent rollout.

- [ ] **Step 4: After the PR is merged, fetch and identify the exact GitHub main SHA**

Run:

```bash
git fetch origin main
git rev-parse origin/main
```

Do not install from the feature branch. Expected: the merged SHA contains `.github/workflows/ci.yml`, `scripts/deploy-from-github.sh`, and `scripts/install-auto-deploy.js`.

- [ ] **Step 5: Perform the one-time installation with the current release as rollback baseline**

Read the existing CRM LaunchAgent `WorkingDirectory`, verify it is the active `5fa32d3-customer-flow...` release or its current successor, then run the installer from an exact archive/worktree of merged `origin/main` with:

```bash
DEPLOY_BOOTSTRAP_RELEASE="<verified-active-release-absolute-path>" npm run deploy:mac:install
```

The exact path must be resolved with `lsof` and `launchctl`, not copied from this plan.

- [ ] **Step 6: Verify production and no-op behavior**

Run:

```bash
remote_sha=$(git rev-parse origin/main)
test "$(cat "$HOME/Desktop/projects/russia-crm-current/.release-sha")" = "$remote_sha"
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://crm.newmindchen.com/healthz
launchctl print "gui/$(id -u)/com.russia-crm.auto-deploy"
npm run deploy:mac:once
```

Expected: both health responses contain `remote_sha`, all four code-service working directories resolve through `russia-crm-current`, auto deploy is loaded with a 60-second interval, and the manual second run reports `already deployed` without restarting services.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const deployScript = path.join(__dirname, '..', 'scripts', 'deploy-from-github.sh');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-github-deploy-'));
  const homeDir = path.join(root, 'home');
  const productionRoot = path.join(root, 'tradepulse-production');
  const source = path.join(root, 'source');
  const remote = path.join(root, 'remote.git');
  const gitDir = path.join(productionRoot, 'state', 'repo.git');
  const stateDir = path.join(productionRoot, 'state');
  const releasesDir = path.join(productionRoot, 'releases');
  const currentLink = path.join(productionRoot, 'current');
  const sharedRoot = path.join(productionRoot, 'shared');
  const helpersDir = path.join(root, 'helpers');
  const validationLog = path.join(root, 'validation.log');
  const validationFailFile = path.join(root, 'validation.fail');
  const backupLog = path.join(root, 'backup.log');
  const restartLog = path.join(root, 'restart.log');
  const healthLog = path.join(root, 'health.log');
  const healthFailShaFile = path.join(root, 'health-fail-sha');

  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(helpersDir, { recursive: true });
  for (const name of [
    'backups',
    'contact-recon-reports',
    'contact-recon-runs',
    'data',
    'logs',
    'memory',
    'output',
    'recon-runs',
    'reports',
    'tmp',
  ]) {
    fs.mkdirSync(path.join(source, name), { recursive: true });
    fs.writeFileSync(path.join(source, name, '.gitkeep'), '');
    fs.mkdirSync(path.join(sharedRoot, name), { recursive: true });
  }
  fs.writeFileSync(path.join(sharedRoot, '.env'), 'CRM_TEST=1\n');
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"deploy-fixture","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(source, 'server.js'), 'console.log("fixture");\n');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'scripts', 'recon_agent_worker.py'), 'print("fixture")\n');
  fs.writeFileSync(path.join(source, 'scripts', 'contact_recon_worker.py'), 'print("fixture")\n');

  run('git', ['init', '-b', 'main'], { cwd: source });
  run('git', ['config', 'user.email', 'deploy-test@example.com'], { cwd: source });
  run('git', ['config', 'user.name', 'Deploy Test'], { cwd: source });
  run('git', ['add', '.'], { cwd: source });
  run('git', ['commit', '-m', 'fixture'], { cwd: source });
  run('git', ['init', '--bare', remote]);
  run('git', ['remote', 'add', 'origin', remote], { cwd: source });
  run('git', ['push', 'origin', 'main'], { cwd: source });
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: source }).stdout.trim();

  const validationBin = path.join(helpersDir, 'validate.sh');
  const backupBin = path.join(helpersDir, 'backup.sh');
  const restartBin = path.join(helpersDir, 'restart.sh');
  const healthcheckBin = path.join(helpersDir, 'healthcheck.sh');
  writeExecutable(validationBin, `#!/bin/sh
set -eu
candidate="$1"
test ! -L "$candidate/data"
test ! -e "$candidate/.env"
test ! -L "$candidate/reports"
test ! -L "$candidate/contact-recon-reports"
test ! -L "$candidate/contact-recon-runs"
test ! -L "$candidate/backups"
test ! -L "$candidate/memory"
test ! -L "$candidate/output"
test ! -L "$candidate/tmp"
printf '%s\\n' "$candidate" >> "$DEPLOY_TEST_VALIDATION_LOG"
test ! -e "$DEPLOY_TEST_VALIDATION_FAIL_FILE"
`);
  writeExecutable(backupBin, `#!/bin/sh
set -eu
printf '%s\\n' "$1" >> "$DEPLOY_TEST_BACKUP_LOG"
mkdir -p "$(dirname "$1")"
: > "$1"
`);
  writeExecutable(restartBin, `#!/bin/sh
set -eu
printf '%s\\n' "$1" >> "$DEPLOY_TEST_RESTART_LOG"
`);
  writeExecutable(healthcheckBin, `#!/bin/sh
set -eu
printf '%s %s\\n' "$1" "$2" >> "$DEPLOY_TEST_HEALTH_LOG"
current_link="${'$'}{DEPLOY_CURRENT_LINK:-${'$'}DEPLOY_ROOT/current}"
test "$(cat "$current_link/.release-sha")" = "$1"
if test "$2" = deploy && test -e "$DEPLOY_TEST_HEALTH_FAIL_SHA_FILE"; then
  test "$(cat "$DEPLOY_TEST_HEALTH_FAIL_SHA_FILE")" != "$1"
fi
`);

  return {
    root,
    homeDir,
    productionRoot,
    sha,
    releasesDir,
    currentLink,
    sharedRoot,
    stateFile: path.join(stateDir, 'state.json'),
    validationLog,
    validationFailFile,
    backupLog,
    restartLog,
    healthLog,
    healthFailShaFile,
    env: {
      ...process.env,
      HOME: homeDir,
      DEPLOY_REMOTE_URL: remote,
      DEPLOY_BRANCH: 'main',
      DEPLOY_GIT_DIR: gitDir,
      DEPLOY_RELEASES_DIR: releasesDir,
      DEPLOY_CURRENT_LINK: currentLink,
      DEPLOY_SHARED_ROOT: sharedRoot,
      DEPLOY_STATE_DIR: stateDir,
      DEPLOY_NODE_BIN: process.execPath,
      DEPLOY_VALIDATION_BIN: validationBin,
      DEPLOY_BACKUP_BIN: backupBin,
      DEPLOY_RESTART_BIN: restartBin,
      DEPLOY_HEALTHCHECK_BIN: healthcheckBin,
      DEPLOY_TEST_VALIDATION_LOG: validationLog,
      DEPLOY_TEST_VALIDATION_FAIL_FILE: validationFailFile,
      DEPLOY_TEST_BACKUP_LOG: backupLog,
      DEPLOY_TEST_RESTART_LOG: restartLog,
      DEPLOY_TEST_HEALTH_LOG: healthLog,
      DEPLOY_TEST_HEALTH_FAIL_SHA_FILE: healthFailShaFile,
    },
  };
}

test('derives every managed deployment path from DEPLOY_ROOT', () => {
  const fixture = createFixture();
  const env = { ...fixture.env, DEPLOY_ROOT: fixture.productionRoot };
  for (const name of [
    'DEPLOY_GIT_DIR',
    'DEPLOY_RELEASES_DIR',
    'DEPLOY_CURRENT_LINK',
    'DEPLOY_SHARED_ROOT',
    'DEPLOY_STATE_DIR',
  ]) {
    delete env[name];
  }

  try {
    const result = spawnSync('zsh', [deployScript], { encoding: 'utf8', env });

    assert.equal(result.status, 0, result.stderr);
    const productionReal = fs.realpathSync(fixture.productionRoot);
    const currentRelative = path.relative(productionReal, fs.realpathSync(fixture.currentLink));
    assert.equal(currentRelative.startsWith(`..${path.sep}`), false);
    assert.equal(fs.existsSync(path.join(fixture.productionRoot, 'state', 'repo.git')), true);
    assert.equal(fs.existsSync(fixture.stateFile), true);
    assert.equal(
      fs.readlinkSync(path.join(fixture.currentLink, 'data')),
      path.join(fixture.productionRoot, 'shared', 'data'),
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function installOldRelease(fixture) {
  const oldRelease = path.join(fixture.root, 'old-release');
  fs.mkdirSync(oldRelease);
  fs.writeFileSync(path.join(oldRelease, '.release-sha'), `${'c'.repeat(40)}\n`);
  fs.symlinkSync(oldRelease, fixture.currentLink);
  return oldRelease;
}

function deploy(fixture, args = []) {
  return spawnSync('zsh', [deployScript, ...args], { encoding: 'utf8', env: fixture.env });
}

test('deploys newest remote main as an immutable release', () => {
  const fixture = createFixture();
  try {
    const result = deploy(fixture);

    assert.equal(result.status, 0, result.stderr);
    const release = path.join(fixture.releasesDir, fixture.sha.slice(0, 12));
    assert.equal(fs.readlinkSync(fixture.currentLink), release);
    assert.equal(fs.readFileSync(path.join(fixture.currentLink, '.release-sha'), 'utf8').trim(), fixture.sha);
    assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).lastSuccessfulSha, fixture.sha);
    assert.deepEqual(fs.readFileSync(fixture.restartLog, 'utf8').trim().split('\n'), [
      'com.russia-crm.server',
      'com.russia-crm.recon-worker',
      'com.russia-crm.contact-worker-1',
      'com.russia-crm.contact-worker-2',
    ]);
    assert.equal(fs.readFileSync(fixture.validationLog, 'utf8').trim().startsWith(fixture.releasesDir), true);
    const backup = fs.readFileSync(fixture.backupLog, 'utf8').trim();
    assert.equal(backup.startsWith(path.dirname(fixture.stateFile)), true);
    assert.equal(fs.existsSync(backup), true);
    assert.equal(fs.readFileSync(fixture.healthLog, 'utf8').trim(), `${fixture.sha} deploy`);
    for (const name of [
      '.env',
      'backups',
      'contact-recon-reports',
      'contact-recon-runs',
      'data',
      'logs',
      'memory',
      'output',
      'recon-runs',
      'reports',
      'tmp',
    ]) {
      assert.equal(fs.readlinkSync(path.join(release, name)), path.join(fixture.sharedRoot, name));
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('does not restart services when the remote SHA is already deployed', () => {
  const fixture = createFixture();
  try {
    const firstRun = deploy(fixture);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const firstRestartLog = fs.readFileSync(fixture.restartLog, 'utf8');

    const secondRun = deploy(fixture);

    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.match(secondRun.stdout, /already deployed/);
    assert.equal(fs.readFileSync(fixture.restartLog, 'utf8'), firstRestartLog);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('records validation failure without changing the current release', () => {
  const fixture = createFixture();
  try {
    const oldRelease = installOldRelease(fixture);
    fs.writeFileSync(fixture.validationFailFile, 'fail\n');

    const failedValidation = deploy(fixture);

    assert.notEqual(failedValidation.status, 0);
    assert.equal(fs.realpathSync(fixture.currentLink), fs.realpathSync(oldRelease));
    assert.equal(fs.existsSync(fixture.stateFile), true, failedValidation.stderr);
    assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).lastFailedStage, 'validate');
    assert.deepEqual(
      fs.readdirSync(fixture.releasesDir).filter(name => name.startsWith('.candidate-')),
      [],
    );
    assert.equal(fs.existsSync(fixture.restartLog), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('skips a previously failed SHA unless force retries it', () => {
  const fixture = createFixture();
  try {
    installOldRelease(fixture);
    fs.writeFileSync(fixture.validationFailFile, 'fail\n');
    const failedValidation = deploy(fixture);
    assert.notEqual(failedValidation.status, 0);
    fs.rmSync(fixture.validationFailFile);

    const skippedFailedSha = deploy(fixture);

    assert.equal(skippedFailedSha.status, 0, skippedFailedSha.stderr);
    assert.match(skippedFailedSha.stdout, /previously failed/);
    assert.equal(fs.existsSync(fixture.restartLog), false);

    const forceRetry = deploy(fixture, ['--force']);

    assert.equal(forceRetry.status, 0, forceRetry.stderr);
    assert.equal(
      fs.realpathSync(fixture.currentLink),
      fs.realpathSync(path.join(fixture.releasesDir, fixture.sha.slice(0, 12))),
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rolls back the current release when post-switch health fails', () => {
  const fixture = createFixture();
  try {
    const oldRelease = installOldRelease(fixture);
    fs.writeFileSync(fixture.healthFailShaFile, `${fixture.sha}\n`);

    const result = deploy(fixture);

    assert.notEqual(result.status, 0);
    assert.equal(fs.realpathSync(fixture.currentLink), fs.realpathSync(oldRelease));
    assert.equal(fs.readFileSync(fixture.restartLog, 'utf8').trim().split('\n').length, 8);
    assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).lastFailedStage, 'health');
    assert.equal(fs.existsSync(path.join(fixture.releasesDir, fixture.sha.slice(0, 12))), true);
    assert.deepEqual(fs.readFileSync(fixture.healthLog, 'utf8').trim().split('\n'), [
      `${fixture.sha} deploy`,
      `${'c'.repeat(40)} rollback`,
    ]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('refuses to switch when current is not a symlink', () => {
  const fixture = createFixture();
  try {
    fs.mkdirSync(fixture.currentLink);
    const marker = path.join(fixture.currentLink, 'do-not-touch');
    fs.writeFileSync(marker, 'preserve\n');

    const result = deploy(fixture);

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve\n');
    assert.equal(fs.lstatSync(fixture.currentLink).isSymbolicLink(), false);
    assert.equal(fs.existsSync(fixture.restartLog), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('force reuses a preserved release after post-switch health failure', () => {
  const fixture = createFixture();
  try {
    installOldRelease(fixture);
    fs.writeFileSync(fixture.healthFailShaFile, `${fixture.sha}\n`);
    const failedDeploy = deploy(fixture);
    assert.notEqual(failedDeploy.status, 0);
    const release = path.join(fixture.releasesDir, fixture.sha.slice(0, 12));
    const evidence = path.join(release, 'failed-release-evidence');
    fs.writeFileSync(evidence, 'preserved\n');
    fs.rmSync(fixture.healthFailShaFile);

    const forceRetry = deploy(fixture, ['--force']);

    assert.equal(forceRetry.status, 0, forceRetry.stderr);
    assert.equal(fs.readFileSync(evidence, 'utf8'), 'preserved\n');
    assert.equal(fs.realpathSync(fixture.currentLink), fs.realpathSync(release));
    assert.equal(fs.readFileSync(fixture.restartLog, 'utf8').trim().split('\n').length, 12);
    const backups = fs.readFileSync(fixture.backupLog, 'utf8').trim().split('\n');
    assert.equal(backups.length, 2);
    assert.equal(new Set(backups).size, 2);
    assert.equal(JSON.parse(fs.readFileSync(fixture.stateFile, 'utf8')).lastSuccessfulSha, fixture.sha);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('force rejects a preserved release whose metadata does not match', () => {
  const fixture = createFixture();
  try {
    const oldRelease = installOldRelease(fixture);
    fs.writeFileSync(fixture.healthFailShaFile, `${fixture.sha}\n`);
    const failedDeploy = deploy(fixture);
    assert.notEqual(failedDeploy.status, 0);
    const release = path.join(fixture.releasesDir, fixture.sha.slice(0, 12));
    fs.writeFileSync(path.join(release, '.release-sha'), `${'d'.repeat(40)}\n`);
    fs.rmSync(fixture.healthFailShaFile);
    const restartLogBefore = fs.readFileSync(fixture.restartLog, 'utf8');

    const forceRetry = deploy(fixture, ['--force']);

    assert.notEqual(forceRetry.status, 0);
    assert.match(forceRetry.stderr, /release metadata does not match/);
    assert.equal(fs.realpathSync(fixture.currentLink), fs.realpathSync(oldRelease));
    assert.equal(fs.readFileSync(fixture.restartLog, 'utf8'), restartLogBefore);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('repairs current-link drift instead of falsely treating success state as a no-op', () => {
  const fixture = createFixture();
  try {
    const firstDeploy = deploy(fixture);
    assert.equal(firstDeploy.status, 0, firstDeploy.stderr);
    const release = path.join(fixture.releasesDir, fixture.sha.slice(0, 12));
    fs.unlinkSync(fixture.currentLink);
    installOldRelease(fixture);

    const repair = deploy(fixture);

    assert.equal(repair.status, 0, repair.stderr);
    assert.equal(fs.realpathSync(fixture.currentLink), fs.realpathSync(release));
    assert.equal(fs.readFileSync(fixture.restartLog, 'utf8').trim().split('\n').length, 8);
    assert.equal(fs.readFileSync(fixture.backupLog, 'utf8').trim().split('\n').length, 2);
    assert.equal(fs.readFileSync(fixture.healthLog, 'utf8').trim().split('\n').length, 2);
    assert.equal(fs.readFileSync(fixture.validationLog, 'utf8').trim().split('\n').length, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

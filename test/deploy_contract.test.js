const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function activeLines(workflow) {
  return workflow.split(/\r?\n/).filter(line => line.trim() && !/^\s*#/.test(line));
}

function indentation(line) {
  return line.match(/^ */)[0].length;
}

function childBlock(lines, parent, parentIndent) {
  const children = [];
  for (const line of lines.slice(parent + 1)) {
    if (indentation(line) <= parentIndent) break;
    children.push(line);
  }
  return children;
}

function activeOnBlock(workflow) {
  const lines = activeLines(workflow);
  const on = lines.findIndex(line => /^on:\s*(?:#.*)?$/.test(line));
  assert.notEqual(on, -1, 'workflow must define active top-level on');
  return childBlock(lines, on, 0);
}

function activeTestJobLines(workflow) {
  const lines = activeLines(workflow);
  const jobs = lines.findIndex(line => /^jobs:\s*(?:#.*)?$/.test(line));
  assert.notEqual(jobs, -1, 'workflow must define jobs');
  const jobLines = childBlock(lines, jobs, 0);
  const testJob = jobLines.findIndex(line => /^  test:\s*(?:#.*)?$/.test(line));
  assert.notEqual(testJob, -1, 'workflow must define jobs.test');
  const testLines = childBlock(jobLines, testJob, 2);
  const steps = testLines.findIndex(line => /^    steps:\s*(?:#.*)?$/.test(line));
  assert.notEqual(steps, -1, 'workflow must define jobs.test.steps');

  return testLines;
}

function activeTestJobSteps(workflow) {
  const testLines = activeTestJobLines(workflow);
  const steps = testLines.findIndex(line => /^    steps:\s*(?:#.*)?$/.test(line));

  const stepLines = childBlock(testLines, steps, 4);
  const entries = [];
  let entry = null;
  for (const line of stepLines) {
    if (/^      - /.test(line)) {
      if (entry) entries.push(entry.join('\n'));
      entry = [line];
    } else if (entry) {
      entry.push(line);
    }
  }
  if (entry) entries.push(entry.join('\n'));
  return entries;
}

function assertRequiredStep(step, description) {
  assert.doesNotMatch(step, /^\s*if:\s*/m, `${description} must not be conditional`);
  assert.doesNotMatch(step, /^\s*continue-on-error:\s*/m,
    `${description} must not set continue-on-error`);
}

function assertActiveWorkflowTriggers(workflow) {
  const on = activeOnBlock(workflow);
  assert.ok(on.some(line => /^  pull_request:\s*(?:#.*)?$/.test(line)),
    'workflow requires active pull_request trigger');
  const push = on.findIndex(line => /^  push:\s*(?:#.*)?$/.test(line));
  assert.notEqual(push, -1, 'workflow requires active push trigger');
  const pushLines = childBlock(on, push, 2);
  assert.ok(pushLines.some(line => /^    branches:\s*\[main\]\s*(?:#.*)?$/.test(line)),
    'workflow requires active push branch main');
}

function assertActiveTestJobSteps(workflow) {
  const testJob = activeTestJobLines(workflow);
  assert.doesNotMatch(testJob.join('\n'), /^    if:\s*/m,
    'jobs.test must not be conditional');
  assert.doesNotMatch(testJob.join('\n'), /^    continue-on-error:\s*/m,
    'jobs.test must not set continue-on-error');
  const steps = activeTestJobSteps(workflow);
  const setupNode = steps.find(step => /^      - uses: actions\/setup-node@v4\s*(?:#.*)?$/m.test(step));
  assert.ok(setupNode, 'test job requires active actions/setup-node@v4');
  assertRequiredStep(setupNode, 'actions/setup-node@v4');
  const setupLines = setupNode.split('\n');
  const withIndex = setupLines.findIndex(line => /^        with:\s*(?:#.*)?$/.test(line));
  assert.notEqual(withIndex, -1, 'actions/setup-node@v4 requires a with child containing node-version: 22');
  const withLines = childBlock(setupLines, withIndex, 8);
  assert.ok(withLines.some(line => /^          node-version:\s*22\s*(?:#.*)?$/.test(line)),
    'actions/setup-node@v4 requires node-version: 22 inside with');
  const zshInstall = steps.find(step => /^      - run: sudo apt-get update && sudo apt-get install -y zsh\s*(?:#.*)?$/m.test(step));
  assert.ok(zshInstall, 'test job requires active zsh installation');
  assertRequiredStep(zshInstall, 'zsh installation');
  for (const command of [
    'npm ci',
    'npm test',
    'node --check server.js',
    'node --check scripts/deploy-state.js',
    'node --check scripts/install-auto-deploy.js',
    'zsh -n scripts/deploy-from-github.sh',
    'bash -n deploy/backup.sh',
    'python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts',
  ]) {
    const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const runStep = steps.find(step => new RegExp(`^      - run: ${escapedCommand}\\s*(?:#.*)?$`, 'm').test(step));
    assert.ok(runStep, `test job requires active ${command}`);
    assertRequiredStep(runStep, command);
  }
}

test('CI contract ignores commented requirements outside active test steps', () => {
  const workflow = readProjectFile('.github', 'workflows', 'ci.yml');
  const commentedNodeVersion = workflow.replace(
    /^          node-version: 22$/m,
    '          # node-version: 22',
  );
  const commentedTestCommand = workflow.replace(
    /^      - run: npm test$/m,
    '      # - run: npm test',
  );
  const conditionalTestCommand = workflow.replace(
    /^      - run: npm test$/m,
    '      - run: npm test\n        if: ${{ false }}',
  );
  const nodeVersionUnderEnv = workflow.replace(
    '        with:\n          node-version: 22',
    '        env:\n          node-version: 22',
  );
  const toleratedTestFailure = workflow.replace(
    /^      - run: npm test$/m,
    '      - run: npm test\n        continue-on-error: true',
  );
  const toleratedJobFailure = workflow.replace(
    '    runs-on: ubuntu-latest',
    '    continue-on-error: true\n    runs-on: ubuntu-latest',
  );
  const conditionalJob = workflow.replace(
    '    runs-on: ubuntu-latest',
    '    if: ${{ false }}\n    runs-on: ubuntu-latest',
  );

  assert.throws(
    () => assertActiveTestJobSteps(commentedNodeVersion),
    /node-version: 22/,
  );
  assert.throws(
    () => assertActiveTestJobSteps(commentedTestCommand), /npm test/);
  assert.throws(
    () => assertActiveTestJobSteps(conditionalTestCommand), /must not be conditional/);
  assert.throws(
    () => assertActiveTestJobSteps(nodeVersionUnderEnv), /with.*node-version/i);
  assert.throws(
    () => assertActiveTestJobSteps(toleratedTestFailure), /continue-on-error/);
  assert.throws(
    () => assertActiveTestJobSteps(toleratedJobFailure), /continue-on-error/);
  assert.throws(
    () => assertActiveTestJobSteps(conditionalJob), /jobs\.test.*conditional/);
});

test('CI contract ignores commented or altered triggers', () => {
  const workflow = readProjectFile('.github', 'workflows', 'ci.yml');
  const commentedPullRequest = workflow.replace(/^  pull_request:$/m, '  # pull_request:');
  const changedMainBranch = workflow.replace('branches: [main]', 'branches: [release]');
  const commentedMainBranch = workflow.replace('branches: [main]', '# branches: [main]');

  assert.throws(() => assertActiveWorkflowTriggers(commentedPullRequest), /pull_request/);
  assert.throws(() => assertActiveWorkflowTriggers(changedMainBranch), /main/);
  assert.throws(() => assertActiveWorkflowTriggers(commentedMainBranch), /main/);
});

test('CI and operator documentation preserve the automatic deployment contract', () => {
  const workflow = readProjectFile('.github', 'workflows', 'ci.yml');
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const readme = readProjectFile('README.md');
  const tunnelDoc = readProjectFile('deploy', 'cloudflare-tunnel.md');

  assertActiveWorkflowTriggers(workflow);
  assertActiveTestJobSteps(workflow);

  assert.equal(packageJson.scripts['deploy:mac:install'], 'node scripts/install-auto-deploy.js');
  assert.equal(packageJson.scripts['deploy:mac:status'], 'node scripts/deploy-state.js status');
  assert.equal(packageJson.scripts['deploy:mac:retry'], 'zsh scripts/deploy-from-github.sh --force');

  assert.match(readme, /origin\/main.*only source/i);
  assert.match(readme, /Notifications:\s*none in the first version\./);
  assert.match(readme, /automatic database restore is forbidden/i);
  assert.match(readme, /npm run deploy:mac:install/);
  assert.match(readme, /npm run deploy:mac:status/);
  assert.match(readme, /npm run deploy:mac:retry/);
  assert.match(readme, /tradepulse-production/);
  assert.match(readme, /DEPLOY_ROOT/);
  assert.match(readme, /shared\/logs\/com\.russia-crm\.auto-deploy/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:3000\/healthz/);
  assert.match(readme, /public.*\/healthz/i);
  assert.match(readme, /code symlink is automatic/i);
  assert.match(readme, /SQLite restore is manual/i);
  assert.match(readme, /stopped services/i);

  assert.match(tunnelDoc, /\/healthz/);
  assert.match(tunnelDoc, /deployment never rewrites the tunnel plist or credentials/i);
});

test('deployment validation uses an isolated test runtime', () => {
  const deployScript = readProjectFile('scripts', 'deploy-from-github.sh');

  assert.match(deployScript, /mktemp -d .*tradepulse-validation/);
  assert.match(deployScript, /export NODE_ENV=test/);
  assert.match(deployScript, /export CRM_PRODUCTION_ROOT="\$DEPLOY_ROOT"/);
  assert.match(deployScript, /export CRM_RUNTIME_ROOT="\$validation_runtime"/);
  assert.match(deployScript, /export CRM_DB_PATH="\$validation_runtime\/data\/crm\.db"/);
  assert.match(deployScript, /export RECON_OUTPUT_DIR="\$validation_runtime\/recon-runs"/);
  assert.match(deployScript, /unset DEPLOY_STATE_FILE/);
  assert.doesNotMatch(deployScript, /source .*shared\/\.env/);
});

test('atomic current switching is portable across macOS and Linux', () => {
  const deployScript = readProjectFile('scripts', 'deploy-from-github.sh');

  assert.match(deployScript, /fs\.renameSync\(process\.argv\[1\], process\.argv\[2\]\)/);
  assert.doesNotMatch(deployScript, /\bmv -h\b/);
});

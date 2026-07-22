const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function activeTestJobSteps(workflow) {
  const lines = workflow.split(/\r?\n/);
  const testJob = lines.findIndex(line => /^  test:\s*(?:#.*)?$/.test(line));
  assert.notEqual(testJob, -1, 'workflow must define jobs.test');

  const jobLines = [];
  for (const line of lines.slice(testJob + 1)) {
    if (/^  \S/.test(line)) break;
    jobLines.push(line);
  }
  const steps = jobLines.findIndex(line => /^    steps:\s*(?:#.*)?$/.test(line));
  assert.notEqual(steps, -1, 'workflow must define jobs.test.steps');

  const activeLines = [];
  for (const line of jobLines.slice(steps + 1)) {
    if (/^    \S/.test(line)) break;
    if (!/^\s*#/.test(line)) activeLines.push(line);
  }
  return activeLines.join('\n');
}

function assertActiveTestJobSteps(workflow) {
  const steps = activeTestJobSteps(workflow);
  assert.match(steps, /^\s*- uses: actions\/setup-node@v4\s*(?:#.*)?$/m,
    'test job requires active actions/setup-node@v4');
  assert.match(steps, /^\s+node-version:\s*22\s*(?:#.*)?$/m,
    'test job requires active node-version: 22');
  assert.match(steps, /^\s*- run: sudo apt-get update && sudo apt-get install -y zsh\s*(?:#.*)?$/m,
    'test job requires active zsh installation');
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
    assert.match(steps, new RegExp(`^\\s*- run: ${escapedCommand}\\s*(?:#.*)?$`, 'm'),
      `test job requires active ${command}`);
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

  assert.throws(
    () => assertActiveTestJobSteps(commentedNodeVersion),
    /node-version: 22/,
  );
  assert.throws(
    () => assertActiveTestJobSteps(commentedTestCommand), /npm test/);
});

test('CI and operator documentation preserve the automatic deployment contract', () => {
  const workflow = readProjectFile('.github', 'workflows', 'ci.yml');
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const readme = readProjectFile('README.md');
  const tunnelDoc = readProjectFile('deploy', 'cloudflare-tunnel.md');

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
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
  assert.match(readme, /logs\/com\.russia-crm\.auto-deploy\.\{out,err\}\.log/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:3000\/healthz/);
  assert.match(readme, /public.*\/healthz/i);
  assert.match(readme, /code symlink is automatic/i);
  assert.match(readme, /SQLite restore is manual/i);
  assert.match(readme, /stopped services/i);

  assert.match(tunnelDoc, /\/healthz/);
  assert.match(tunnelDoc, /deployment never rewrites the tunnel plist or credentials/i);
});

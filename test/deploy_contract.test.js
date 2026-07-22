const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

test('CI and operator documentation preserve the automatic deployment contract', () => {
  const workflow = readProjectFile('.github', 'workflows', 'ci.yml');
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const readme = readProjectFile('README.md');
  const tunnelDoc = readProjectFile('deploy', 'cloudflare-tunnel.md');

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /sudo apt-get update && sudo apt-get install -y zsh/);
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
    assert.match(workflow, new RegExp(`- run: ${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }

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

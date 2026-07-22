const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildServiceDefinitions, renderPlist } = require('../lib/macos_launch_agents');

const projectRoot = path.join(__dirname, '..');
const legacyInstaller = path.join(projectRoot, 'scripts', 'install-daily-services.js');
const autoDeployInstaller = path.join(projectRoot, 'scripts', 'install-auto-deploy.js');
const codeLabels = [
  'com.russia-crm.server',
  'com.russia-crm.recon-worker',
  'com.russia-crm.contact-worker-1',
  'com.russia-crm.contact-worker-2',
  'com.russia-crm.daily-enqueue',
  'com.russia-crm.daily-report',
  'com.russia-crm.completion-notifier',
];

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function createInstallerFixture() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-launch-agent-home-'));
  const helpersDir = path.join(homeDir, 'fake-bin');
  const launchctlLog = path.join(homeDir, 'launchctl.log');
  fs.mkdirSync(helpersDir, { recursive: true });
  writeExecutable(path.join(helpersDir, 'launchctl'), `#!/bin/sh
printf 'unexpected launchctl invocation\\n' >> "$CRM_TEST_LAUNCHCTL_LOG"
exit 97
`);
  return {
    homeDir,
    helpersDir,
    launchctlLog,
    env: {
      ...process.env,
      HOME: homeDir,
      PATH: `${helpersDir}:${process.env.PATH}`,
      CRM_INSTALL_DRY_RUN: '1',
      CRM_LAUNCHCTL_BIN: path.join(helpersDir, 'launchctl'),
      CRM_TEST_LAUNCHCTL_LOG: launchctlLog,
    },
  };
}

function configureBootstrapFixture() {
  const fixture = createInstallerFixture();
  const bootstrapRelease = path.join(fixture.homeDir, 'bootstrap release');
  const currentLink = path.join(
    fixture.homeDir,
    'Desktop',
    'projects',
    'russia-crm-current',
  );
  const launchAgentsDir = path.join(fixture.homeDir, 'Library', 'LaunchAgents');
  const deployDir = path.join(fixture.homeDir, 'helpers with spaces');
  const deployScript = path.join(deployDir, 'deploy fixture.sh');
  const deployLog = path.join(fixture.homeDir, 'deploy.log');
  const deployFailFile = path.join(fixture.homeDir, 'deploy.fail');
  fs.mkdirSync(bootstrapRelease, { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.mkdirSync(deployDir, { recursive: true });
  writeExecutable(deployScript, `#!/bin/zsh
set -eu
for label in ${codeLabels.join(' ')}; do
  test -f "$CRM_TEST_LAUNCH_AGENTS_DIR/$label.plist"
done
test ! -e "$CRM_TEST_LAUNCH_AGENTS_DIR/com.russia-crm.auto-deploy.plist"
printf '%s\\n' "$@" >> "$CRM_TEST_DEPLOY_LOG"
test ! -e "$CRM_TEST_DEPLOY_FAIL_FILE"
`);
  return {
    ...fixture,
    bootstrapRelease,
    currentLink,
    launchAgentsDir,
    deployScript,
    deployLog,
    deployFailFile,
    env: {
      ...fixture.env,
      DEPLOY_BOOTSTRAP_RELEASE: bootstrapRelease,
      DEPLOY_SCRIPT: deployScript,
      CRM_TEST_LAUNCH_AGENTS_DIR: launchAgentsDir,
      CRM_TEST_DEPLOY_LOG: deployLog,
      CRM_TEST_DEPLOY_FAIL_FILE: deployFailFile,
    },
  };
}

function fixtureOptions(overrides = {}) {
  return {
    runtimeRoot: '/fixture/russia-crm-current',
    sourceRoot: '/fixture/russia-crm-local',
    logsDir: '/fixture/logs',
    homeDir: '/fixture/home',
    nodeBin: '/fixture/bin/node',
    pythonBin: '/fixture/bin/python3',
    cloudflaredBin: '/fixture/bin/cloudflared',
    includeAutoDeploy: true,
    ...overrides,
  };
}

test('renders code services through the stable current symlink', () => {
  const definitions = buildServiceDefinitions(fixtureOptions());
  const labels = definitions.map(item => item.label);

  assert.deepEqual(labels.filter(label => label.includes('server') || label.includes('worker')), [
    'com.russia-crm.server',
    'com.russia-crm.recon-worker',
    'com.russia-crm.contact-worker-1',
    'com.russia-crm.contact-worker-2',
  ]);
  for (const definition of definitions.filter(item => item.kind === 'code')) {
    const plist = renderPlist(definition);
    assert.match(plist, /\/fixture\/russia-crm-current/);
    assert.doesNotMatch(plist, /russia-crm-local\/scripts/);
  }
});

test('renders the optional auto deploy service every 60 seconds', () => {
  const definitions = buildServiceDefinitions(fixtureOptions());
  const deploy = definitions.find(item => item.label === 'com.russia-crm.auto-deploy');

  assert.ok(deploy);
  assert.match(renderPlist(deploy), /<key>StartInterval<\/key><integer>60<\/integer>/);
  assert.match(renderPlist(deploy), /deploy-from-github\.sh/);
});

test('auto deploy installation definitions exclude the Cloudflare tunnel', () => {
  const definitions = buildServiceDefinitions(fixtureOptions());
  const installerDefinitions = definitions.filter(item => item.kind === 'code' || item.kind === 'deploy');

  assert.equal(
    installerDefinitions.some(item => item.label === 'com.russia-crm.cloudflare-tunnel'),
    false,
  );
});

test('escapes XML-sensitive service values', () => {
  const [server] = buildServiceDefinitions(fixtureOptions({
    runtimeRoot: '/fixture/current&active',
    logsDir: '/fixture/logs<daily>',
  }));
  const plist = renderPlist(server);

  assert.match(plist, /current&amp;active/);
  assert.match(plist, /logs&lt;daily&gt;/);
});

test('dry-run legacy installation never spawns launchctl', () => {
  const fixture = createInstallerFixture();
  try {
    const result = spawnSync(process.execPath, [legacyInstaller], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('legacy installer renders code services against an existing current symlink in dry-run mode', () => {
  const fixture = createInstallerFixture();
  const { homeDir } = fixture;
  const release = path.join(homeDir, 'bootstrap-release');
  const current = path.join(homeDir, 'Desktop', 'projects', 'russia-crm-current');
  const launchAgents = path.join(homeDir, 'Library', 'LaunchAgents');
  fs.mkdirSync(release, { recursive: true });
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.symlinkSync(release, current);

  try {
    const result = spawnSync(process.execPath, [legacyInstaller], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
    const codeDefinitions = buildServiceDefinitions(fixtureOptions({
      runtimeRoot: current,
      homeDir,
      includeAutoDeploy: false,
    })).filter(item => item.kind === 'code');
    for (const { label } of codeDefinitions) {
      const plist = fs.readFileSync(path.join(launchAgents, `${label}.plist`), 'utf8');
      assert.match(plist, new RegExp(current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(plist, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal(fs.existsSync(path.join(launchAgents, 'com.russia-crm.cloudflare-tunnel.plist')), true);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('auto deploy installer bootstraps code services before enabling deployment polling', () => {
  const fixture = configureBootstrapFixture();
  const cloudflareFile = path.join(
    fixture.launchAgentsDir,
    'com.russia-crm.cloudflare-tunnel.plist',
  );
  const cloudflareContents = 'preserve-cloudflare-bytes\n<key>token&value</key>\n';
  fs.writeFileSync(cloudflareFile, cloudflareContents);

  try {
    const result = spawnSync(process.execPath, [autoDeployInstaller], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readlinkSync(fixture.currentLink), fixture.bootstrapRelease);
    assert.equal(fs.readFileSync(fixture.deployLog, 'utf8'), '--force\n');
    assert.equal(
      fs.existsSync(path.join(fixture.launchAgentsDir, 'com.russia-crm.auto-deploy.plist')),
      true,
    );
    assert.equal(fs.readFileSync(cloudflareFile, 'utf8'), cloudflareContents);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
    for (const label of codeLabels) {
      const plist = fs.readFileSync(path.join(fixture.launchAgentsDir, `${label}.plist`), 'utf8');
      assert.match(plist, new RegExp(fixture.currentLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(plist, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('auto deploy installer leaves polling disabled when forced deployment fails', () => {
  const fixture = configureBootstrapFixture();
  const cloudflareFile = path.join(
    fixture.launchAgentsDir,
    'com.russia-crm.cloudflare-tunnel.plist',
  );
  const cloudflareContents = Buffer.from([0, 1, 2, 38, 60, 62, 255]);
  fs.writeFileSync(cloudflareFile, cloudflareContents);
  fs.writeFileSync(fixture.deployFailFile, 'fail\n');

  try {
    const result = spawnSync(process.execPath, [autoDeployInstaller], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(fixture.deployLog, 'utf8'), '--force\n');
    assert.equal(
      fs.existsSync(path.join(fixture.launchAgentsDir, 'com.russia-crm.auto-deploy.plist')),
      false,
    );
    assert.deepEqual(fs.readFileSync(cloudflareFile), cloudflareContents);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('auto deploy installer rejects a relative bootstrap release before writing services', () => {
  const fixture = configureBootstrapFixture();
  const relativeRelease = 'relative-bootstrap';
  fs.mkdirSync(path.join(fixture.homeDir, relativeRelease));

  try {
    const result = spawnSync(process.execPath, [autoDeployInstaller], {
      cwd: fixture.homeDir,
      encoding: 'utf8',
      env: { ...fixture.env, DEPLOY_BOOTSTRAP_RELEASE: relativeRelease },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /absolute existing directory/);
    assert.equal(fs.existsSync(fixture.deployLog), false);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
    assert.deepEqual(fs.readdirSync(fixture.launchAgentsDir), []);
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('auto deploy installer requires an explicit bootstrap release before writing services', () => {
  const fixture = configureBootstrapFixture();
  const env = { ...fixture.env };
  delete env.DEPLOY_BOOTSTRAP_RELEASE;

  try {
    const result = spawnSync(process.execPath, [autoDeployInstaller], {
      encoding: 'utf8',
      env,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEPLOY_BOOTSTRAP_RELEASE must be an absolute existing directory/);
    assert.equal(fs.existsSync(fixture.currentLink), false);
    assert.equal(fs.existsSync(fixture.deployLog), false);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
    assert.deepEqual(fs.readdirSync(fixture.launchAgentsDir), []);
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('auto deploy installer rejects an existing poller before changing current or services', () => {
  const fixture = configureBootstrapFixture();
  const autoDeployFile = path.join(
    fixture.launchAgentsDir,
    'com.russia-crm.auto-deploy.plist',
  );
  const existingContents = 'existing-auto-deploy\n';
  fs.writeFileSync(autoDeployFile, existingContents);

  try {
    const result = spawnSync(process.execPath, [autoDeployInstaller], {
      encoding: 'utf8',
      env: fixture.env,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /auto deploy service already exists/);
    assert.equal(fs.existsSync(fixture.currentLink), false);
    assert.equal(fs.existsSync(fixture.deployLog), false);
    assert.equal(fs.existsSync(fixture.launchctlLog), false);
    assert.equal(fs.readFileSync(autoDeployFile, 'utf8'), existingContents);
    assert.deepEqual(fs.readdirSync(fixture.launchAgentsDir), ['com.russia-crm.auto-deploy.plist']);
  } finally {
    fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  }
});

test('package exposes exact macOS deployment operator commands', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts;

  assert.equal(scripts['deploy:mac:once'], 'zsh scripts/deploy-from-github.sh');
  assert.equal(scripts['deploy:mac:retry'], 'zsh scripts/deploy-from-github.sh --force');
  assert.equal(scripts['deploy:mac:install'], 'node scripts/install-auto-deploy.js');
  assert.equal(scripts['deploy:mac:status'], 'node scripts/deploy-state.js status');
});

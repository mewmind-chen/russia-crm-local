#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildServiceDefinitions, renderPlist } = require('../lib/macos_launch_agents');

const sourceRoot = path.resolve(__dirname, '..');
const homeDir = os.homedir();
const currentLink = path.resolve(process.env.DEPLOY_CURRENT_LINK
  || path.join(homeDir, 'Desktop', 'projects', 'russia-crm-current'));
const bootstrapRelease = process.env.DEPLOY_BOOTSTRAP_RELEASE;
const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
const autoDeployFile = path.join(launchAgentsDir, 'com.russia-crm.auto-deploy.plist');
const logsDir = path.join(currentLink, 'logs');
const deployScript = process.env.DEPLOY_SCRIPT
  || path.join(sourceRoot, 'scripts', 'deploy-from-github.sh');
const launchctlBin = process.env.CRM_LAUNCHCTL_BIN || 'launchctl';
const dryRun = process.env.CRM_INSTALL_DRY_RUN === '1';
const uid = process.getuid();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isExistingDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

if (!bootstrapRelease
  || !path.isAbsolute(bootstrapRelease)
  || !isExistingDirectory(bootstrapRelease)
  || path.resolve(bootstrapRelease) === currentLink) {
  fail('DEPLOY_BOOTSTRAP_RELEASE must be an absolute existing directory');
}
if (fs.existsSync(autoDeployFile)) {
  fail(`auto deploy service already exists: ${autoDeployFile}`);
}

fs.mkdirSync(path.dirname(currentLink), { recursive: true });
try {
  const existing = fs.lstatSync(currentLink);
  if (!existing.isSymbolicLink()) {
    fail(`current path exists and is not a symlink: ${currentLink}`);
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const temporaryLink = path.join(
  path.dirname(currentLink),
  `.${path.basename(currentLink)}.bootstrap.${process.pid}`,
);
try {
  fs.symlinkSync(bootstrapRelease, temporaryLink, 'dir');
  fs.renameSync(temporaryLink, currentLink);
} finally {
  try {
    fs.unlinkSync(temporaryLink);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const definitions = buildServiceDefinitions({
  runtimeRoot: currentLink,
  sourceRoot,
  logsDir,
  homeDir,
  nodeBin: process.execPath,
  pythonBin: process.env.PYTHON_BIN
    || path.join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'),
  cloudflaredBin: process.env.CLOUDFLARED_BIN || '/opt/homebrew/bin/cloudflared',
  includeAutoDeploy: true,
});

function installDefinition(definition) {
  const file = path.join(launchAgentsDir, `${definition.label}.plist`);
  fs.writeFileSync(file, renderPlist(definition));
  if (dryRun) {
    console.log(`rendered ${definition.label}`);
    return;
  }

  spawnSync(launchctlBin, ['bootout', `gui/${uid}`, file], {
    stdio: 'ignore',
    shell: false,
  });
  const result = spawnSync(launchctlBin, ['bootstrap', `gui/${uid}`, file], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${definition.label}: ${result.stderr || 'bootstrap failed'}`);
  }
  console.log(`installed ${definition.label}`);
}

for (const definition of definitions.filter(item => item.kind === 'code')) {
  installDefinition(definition);
}

const deployment = spawnSync('/bin/zsh', [deployScript, '--force'], {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) {
  fail(`initial forced deployment failed with status ${deployment.status}`);
}

const autoDeploy = definitions.find(item => item.kind === 'deploy');
installDefinition(autoDeploy);

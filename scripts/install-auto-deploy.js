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
const configuredReleasesDir = process.env.DEPLOY_RELEASES_DIR
  || path.join(homeDir, 'Desktop', 'projects', 'russia-crm-releases');
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

function canonicalDirectory(target, message) {
  if (!target || !path.isAbsolute(target)) fail(message);
  try {
    const resolved = fs.realpathSync(target);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('not a directory');
    return resolved;
  } catch {
    fail(message);
  }
}

function resolveNodeBinary() {
  const absolute = path.resolve(process.env.DEPLOY_NODE_BIN || process.execPath);
  try {
    fs.accessSync(absolute, fs.constants.X_OK);
    if (!fs.statSync(absolute).isFile()) throw new Error('not a file');
  } catch {
    fail(`Node executable is unavailable: ${absolute}`);
  }

  const result = spawnSync(absolute, ['-p', 'process.versions.node.split(".")[0]'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== '22') {
    fail('deployment requires Node 22');
  }
  return absolute;
}

function assertInsideManagedReleases(release, releasesDir) {
  const relative = path.relative(releasesDir, release);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('bootstrap release must be inside the managed releases directory');
  }
}

function activeServerWorkingDirectory() {
  if (dryRun) {
    return canonicalDirectory(
      process.env.CRM_ACTIVE_SERVER_WORKING_DIRECTORY,
      'CRM_ACTIVE_SERVER_WORKING_DIRECTORY is required for dry-run',
    );
  }
  const result = spawnSync(launchctlBin, ['print', `gui/${uid}/com.russia-crm.server`], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    fail('unable to inspect the active CRM server LaunchAgent');
  }
  const match = result.stdout.match(/^\s*working directory\s*=\s*(.+?)\s*$/mi);
  if (!match) fail('active CRM server LaunchAgent has no WorkingDirectory');
  return canonicalDirectory(match[1], 'active CRM server WorkingDirectory is invalid');
}

const nodeBin = resolveNodeBinary();
if (!bootstrapRelease || path.resolve(bootstrapRelease) === currentLink) {
  fail('DEPLOY_BOOTSTRAP_RELEASE must be an absolute existing directory');
}
const releasesDir = canonicalDirectory(
  configuredReleasesDir,
  'DEPLOY_RELEASES_DIR must be an absolute existing directory',
);
const bootstrapTarget = canonicalDirectory(
  bootstrapRelease,
  'DEPLOY_BOOTSTRAP_RELEASE must be an absolute existing directory',
);
assertInsideManagedReleases(bootstrapTarget, releasesDir);
if (fs.existsSync(autoDeployFile)) {
  fail(`auto deploy service already exists: ${autoDeployFile}`);
}
if (activeServerWorkingDirectory() !== bootstrapTarget) {
  fail('active CRM server WorkingDirectory does not match bootstrap release');
}

let currentExists = false;
try {
  const existing = fs.lstatSync(currentLink);
  if (!existing.isSymbolicLink()) {
    fail(`current path exists and is not a symlink: ${currentLink}`);
  }
  if (canonicalDirectory(currentLink, 'current target is invalid') !== bootstrapTarget) {
    fail('current target does not match bootstrap release');
  }
  currentExists = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (!currentExists) {
  fs.mkdirSync(path.dirname(currentLink), { recursive: true });
  const temporaryLink = path.join(
    path.dirname(currentLink),
    `.${path.basename(currentLink)}.bootstrap.${process.pid}`,
  );
  try {
    fs.symlinkSync(bootstrapTarget, temporaryLink, 'dir');
    fs.renameSync(temporaryLink, currentLink);
  } finally {
    try {
      fs.unlinkSync(temporaryLink);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const definitions = buildServiceDefinitions({
  runtimeRoot: currentLink,
  sourceRoot,
  logsDir,
  homeDir,
  nodeBin,
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
  env: { ...process.env, DEPLOY_NODE_BIN: nodeBin },
});
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) {
  fail(`initial forced deployment failed with status ${deployment.status}`);
}

const autoDeploy = definitions.find(item => item.kind === 'deploy');
installDefinition(autoDeploy);

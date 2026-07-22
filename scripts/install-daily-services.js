#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildServiceDefinitions, renderPlist } = require('../lib/macos_launch_agents');

const sourceRoot = path.resolve(__dirname, '..');
const homeDir = os.homedir();
const defaultCurrent = path.join(homeDir, 'Desktop', 'projects', 'russia-crm-current');
const runtimeRoot = path.resolve(process.env.CRM_RUNTIME_ROOT
  || (fs.existsSync(defaultCurrent) ? defaultCurrent : sourceRoot));
const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
const logsDir = path.join(runtimeRoot, 'logs');
const dryRun = process.env.CRM_INSTALL_DRY_RUN === '1';
const uid = process.getuid();

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const definitions = buildServiceDefinitions({
  runtimeRoot,
  sourceRoot,
  logsDir,
  homeDir,
  nodeBin: process.execPath,
  pythonBin: process.env.PYTHON_BIN
    || path.join(homeDir, '.hermes', 'hermes-agent', 'venv', 'bin', 'python3'),
  cloudflaredBin: process.env.CLOUDFLARED_BIN || '/opt/homebrew/bin/cloudflared',
  includeAutoDeploy: false,
});

for (const label of [
  'com.russia-crm.contact-worker-3',
  'com.russia-crm.report-tunnel',
  'com.russia-crm.report-url-watcher',
]) {
  const obsolete = path.join(launchAgentsDir, `${label}.plist`);
  if (!dryRun) {
    spawnSync('launchctl', ['bootout', `gui/${uid}`, obsolete], {
      stdio: 'ignore',
      shell: false,
    });
  }
  try {
    fs.unlinkSync(obsolete);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

for (const definition of definitions) {
  const file = path.join(launchAgentsDir, `${definition.label}.plist`);
  fs.writeFileSync(file, renderPlist(definition));
  if (dryRun) {
    console.log(`rendered ${definition.label}`);
    continue;
  }

  spawnSync('launchctl', ['bootout', `gui/${uid}`, file], {
    stdio: 'ignore',
    shell: false,
  });
  const result = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, file], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`${definition.label}: ${result.stderr || 'bootstrap failed'}`);
    process.exitCode = 1;
  } else {
    console.log(`installed ${definition.label}`);
  }
}

console.log(`daily reports: ${path.join(runtimeRoot, 'reports', 'daily', 'YYYY-MM-DD')}`);

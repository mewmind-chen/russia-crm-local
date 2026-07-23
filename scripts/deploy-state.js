const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DEPLOY_ROOT = process.env.DEPLOY_ROOT
  || path.join(os.homedir(), 'Desktop', 'projects', 'tradepulse-production');
const DEFAULT_STATE_FILE = path.join(DEFAULT_DEPLOY_ROOT, 'state', 'state.json');

const EMPTY_STATE = {
  lastSuccessfulSha: '',
  lastSuccessfulAt: '',
  lastFailedSha: '',
  lastFailedAt: '',
  lastFailedStage: '',
  currentRelease: '',
  previousRelease: '',
};

function readState(file) {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...EMPTY_STATE };
    throw error;
  }
}

function writeState(file, state) {
  const target = path.resolve(file);
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify({ ...EMPTY_STATE, ...state }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function invalidCommand() {
  process.exitCode = 2;
}

function isSha(value) {
  return /^[0-9a-f]{40}$/.test(value || '');
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const file = process.env.DEPLOY_STATE_FILE || DEFAULT_STATE_FILE;

  if (command === 'get' && args.length === 1) {
    const state = readState(file);
    process.stdout.write(`${String(state[args[0]] || '')}\n`);
    return;
  }

  if (command === 'status' && args.length === 0) {
    process.stdout.write(`${JSON.stringify(readState(file), null, 2)}\n`);
    return;
  }

  if (command === 'success' && args.length === 3 && isSha(args[0])) {
    const state = readState(file);
    writeState(file, {
      ...state,
      lastSuccessfulSha: args[0],
      lastSuccessfulAt: new Date().toISOString(),
      lastFailedSha: '',
      lastFailedAt: '',
      lastFailedStage: '',
      currentRelease: args[1],
      previousRelease: args[2],
    });
    return;
  }

  if (command === 'failure' && args.length === 2 && isSha(args[0])) {
    const state = readState(file);
    writeState(file, {
      ...state,
      lastFailedSha: args[0],
      lastFailedAt: new Date().toISOString(),
      lastFailedStage: args[1],
    });
    return;
  }

  invalidCommand();
}

if (require.main === module) runCli();

module.exports = { readState, writeState };

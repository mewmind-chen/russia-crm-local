const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ALLOWED_ENVIRONMENTS = new Set(['development', 'test', 'production']);
const PATH_ENV_KEYS = [
  'HOME',
  'NODE_ENV',
  'CRM_PRODUCTION_ROOT',
  'CRM_RUNTIME_ROOT',
  'CRM_DB_PATH',
  'RECON_OUTPUT_DIR',
  'CONTACT_RECON_OUTPUT_DIR',
  'CONTACT_RECON_REPORT_DIR',
  'CRM_REPORTS_DIR',
  'CRM_BACKUP_DIR',
  'CRM_LOGS_DIR',
  'CRM_OUTPUT_DIR',
  'CRM_TMP_DIR',
];

let cachedKey = '';
let cachedPaths;

class RuntimePathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimePathError';
    this.code = 'CRM_RUNTIME_PATH_INVALID';
  }
}

function nodeEnvironment(env = process.env) {
  const value = String(env.NODE_ENV || 'development').trim().toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(value)) {
    throw new RuntimePathError(`Unsupported NODE_ENV: ${value || '(empty)'}`);
  }
  return value;
}

// Resolve existing symlinks while still supporting paths whose final entries do not exist yet.
function canonicalPath(input) {
  let cursor = path.resolve(String(input || ''));
  const missing = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  let resolved;
  try {
    resolved = fs.realpathSync.native(cursor);
  } catch (_error) {
    throw new RuntimePathError('Unable to resolve a configured runtime path');
  }
  return path.resolve(resolved, ...missing);
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function configuredPath(value, fallback) {
  const selected = String(value || '').trim();
  return canonicalPath(selected || fallback);
}

function resolveRuntimePaths(env = process.env) {
  const environment = nodeEnvironment(env);
  const homeDir = path.resolve(String(env.HOME || os.homedir()));
  const productionRoot = configuredPath(
    env.CRM_PRODUCTION_ROOT,
    path.join(homeDir, 'Desktop', 'projects', 'tradepulse-production'),
  );
  const runtimeRoot = configuredPath(env.CRM_RUNTIME_ROOT, PROJECT_ROOT);
  const paths = {
    environment,
    productionRoot,
    runtimeRoot,
    databasePath: configuredPath(env.CRM_DB_PATH, path.join(runtimeRoot, 'data', 'crm.db')),
    reconOutputDir: configuredPath(env.RECON_OUTPUT_DIR, path.join(runtimeRoot, 'recon-runs')),
    contactReconOutputDir: configuredPath(
      env.CONTACT_RECON_OUTPUT_DIR,
      path.join(runtimeRoot, 'contact-recon-runs'),
    ),
    contactReconReportDir: configuredPath(
      env.CONTACT_RECON_REPORT_DIR,
      path.join(runtimeRoot, 'contact-recon-reports'),
    ),
    reportsDir: configuredPath(env.CRM_REPORTS_DIR, path.join(runtimeRoot, 'reports')),
    backupDir: configuredPath(
      env.CRM_BACKUP_DIR,
      path.join(runtimeRoot, 'backups', 'data-maintenance'),
    ),
    logsDir: configuredPath(env.CRM_LOGS_DIR, path.join(runtimeRoot, 'logs')),
    outputDir: configuredPath(env.CRM_OUTPUT_DIR, path.join(runtimeRoot, 'output')),
    tmpDir: configuredPath(env.CRM_TMP_DIR, path.join(runtimeRoot, 'tmp')),
  };

  const managedPaths = [
    paths.runtimeRoot,
    paths.databasePath,
    paths.reconOutputDir,
    paths.contactReconOutputDir,
    paths.contactReconReportDir,
    paths.reportsDir,
    paths.backupDir,
    paths.logsDir,
    paths.outputDir,
    paths.tmpDir,
  ];
  if (environment !== 'production') {
    if (managedPaths.some(entry => isWithin(entry, productionRoot))) {
      throw new RuntimePathError(`${environment} runtime cannot use the production root`);
    }
    return Object.freeze(paths);
  }

  const sharedRoot = canonicalPath(path.join(productionRoot, 'shared'));
  const sharedDataRoot = canonicalPath(path.join(sharedRoot, 'data'));
  if (!isWithin(paths.runtimeRoot, productionRoot)) {
    throw new RuntimePathError('Production runtime must be inside the production root');
  }
  if (!isWithin(paths.databasePath, sharedDataRoot)) {
    throw new RuntimePathError('Production database must be inside shared/data');
  }
  for (const outputPath of managedPaths.slice(2)) {
    if (!isWithin(outputPath, sharedRoot)) {
      throw new RuntimePathError('Production output paths must be inside shared');
    }
  }
  return Object.freeze(paths);
}

function runtimePaths(env = process.env) {
  if (env !== process.env) return resolveRuntimePaths(env);
  const key = PATH_ENV_KEYS.map(name => `${name}=${env[name] || ''}`).join('\n');
  if (!cachedPaths || cachedKey !== key) {
    cachedPaths = resolveRuntimePaths(env);
    cachedKey = key;
  }
  return cachedPaths;
}

function databasePath(env = process.env) {
  return runtimePaths(env).databasePath;
}

module.exports = {
  RuntimePathError,
  canonicalPath,
  databasePath,
  isWithin,
  nodeEnvironment,
  resolveRuntimePaths,
  runtimePaths,
};

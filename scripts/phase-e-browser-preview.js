'use strict';

/**
 * Phase E browser-preview harness.
 *
 * This is deliberately an opt-in smoke harness. It owns an isolated test
 * runtime and never calls the production server entrypoint (which also starts
 * the assistant runtime monitor). Full browser acceptance remains separate.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW_HOST = '127.0.0.1';
const RANDOM_PORT = 0;
const OPT_IN_ENV = 'PHASE_E_BROWSER_PREVIEW';
const LOCKED_BROWSER_PACKAGES = ['playwright', 'puppeteer'];
const TEMP_PATH_ENV_KEYS = [
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
  'CRM_FIXTURE_BASE_DB',
  'CRM_AI_STATIONS_ENABLED',
  'CRM_AI_CUSTOMER_ENRICHMENT_ENABLED',
  'CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED',
  'CRM_AI_SALES_PACK_ENABLED',
  'CRM_AI_QWEN_ONLINE_ENABLED',
  'CRM_AI_QWEN_BATCH_ENABLED',
];

const ROLE_CREDENTIALS = Object.freeze([
  Object.freeze({ role: 'manager', email: 'manager@example.com', password: 'Password123!' }),
  Object.freeze({ role: 'sales', email: 'other@example.com', password: 'Password123!' }),
]);

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function usage() {
  return [
    'Usage: PHASE_E_BROWSER_PREVIEW=1 node scripts/phase-e-browser-preview.js --run',
    '       npm run phase:e:browser-preview',
    '',
    'The harness only accepts --host=127.0.0.1 and --port=0 (the defaults).',
    'A locked, installed playwright or puppeteer package is required.',
  ].join('\n');
}

function parseValueArgument(argv, index, name) {
  const argument = argv[index];
  const prefix = `${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), nextIndex: index };
  if (argument === name) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    return { value, nextIndex: index + 1 };
  }
  return null;
}

function parseArguments(argv = process.argv.slice(2), env = process.env) {
  const result = {
    help: false,
    run: isTruthy(env[OPT_IN_ENV]),
    host: PREVIEW_HOST,
    port: RANDOM_PORT,
    browser: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }
    if (argument === '--run' || argument === '--opt-in') {
      result.run = true;
      continue;
    }
    const host = parseValueArgument(argv, index, '--host');
    if (host) {
      result.host = host.value;
      index = host.nextIndex;
      continue;
    }
    const port = parseValueArgument(argv, index, '--port');
    if (port) {
      result.port = port.value;
      index = port.nextIndex;
      continue;
    }
    const browser = parseValueArgument(argv, index, '--browser');
    if (browser) {
      result.browser = browser.value;
      index = browser.nextIndex;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (result.help) return result;
  if (!result.run) {
    const error = new Error(
      `Phase E browser preview is opt-in only; pass --run or set ${OPT_IN_ENV}=1.`,
    );
    error.exitCode = 64;
    throw error;
  }
  if (result.host !== PREVIEW_HOST) {
    const error = new Error(`Phase E browser preview refuses non-loopback host: ${result.host}`);
    error.exitCode = 64;
    throw error;
  }
  if (String(result.port) !== String(RANDOM_PORT)) {
    const error = new Error('Phase E browser preview requires port 0 so the OS chooses a random port.');
    error.exitCode = 64;
    throw error;
  }
  if (result.browser && !LOCKED_BROWSER_PACKAGES.includes(result.browser)) {
    const error = new Error(
      `Unsupported browser driver ${result.browser}; choose playwright or puppeteer.`,
    );
    error.exitCode = 64;
    throw error;
  }
  return result;
}

function packageManifest(packageRoot = ROOT) {
  const filename = path.join(packageRoot, 'package.json');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function packageLock(packageRoot = ROOT) {
  const filename = path.join(packageRoot, 'package-lock.json');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function dependencySpec(manifest, packageName) {
  return manifest.dependencies?.[packageName]
    ?? manifest.devDependencies?.[packageName]
    ?? manifest.optionalDependencies?.[packageName]
    ?? '';
}

function isPinnedVersion(spec) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(spec || '').trim());
}

function lockEntry(lock, packageName) {
  const packagePath = `node_modules/${packageName}`;
  if (lock.packages?.[packagePath]) return lock.packages[packagePath];
  return lock.dependencies?.[packageName] || null;
}

function checkLockedBrowser(packageName, packageRoot = ROOT) {
  const manifest = packageManifest(packageRoot);
  const lock = packageLock(packageRoot);
  const spec = dependencySpec(manifest, packageName);
  if (!spec) {
    return { ok: false, reason: `${packageName} is not declared in package.json` };
  }
  if (!isPinnedVersion(spec)) {
    return { ok: false, reason: `${packageName} must use an exact version, found ${spec}` };
  }
  const entry = lockEntry(lock, packageName);
  if (!entry || !isPinnedVersion(entry.version)) {
    return { ok: false, reason: `${packageName} is not locked in package-lock.json` };
  }
  if (entry.version !== spec) {
    return {
      ok: false,
      reason: `${packageName} package-lock version ${entry.version} does not match package.json ${spec}`,
    };
  }
  try {
    require.resolve(packageName, { paths: [packageRoot] });
  } catch (_error) {
    return { ok: false, reason: `${packageName} is locked but not installed in node_modules` };
  }
  return { ok: true, version: entry.version };
}

function loadBrowserAdapter(preferred = '', packageRoot = ROOT) {
  const candidates = preferred ? [preferred] : LOCKED_BROWSER_PACKAGES;
  const failures = [];
  for (const packageName of candidates) {
    const status = checkLockedBrowser(packageName, packageRoot);
    if (!status.ok) {
      failures.push(status.reason);
      continue;
    }
    try {
      const module = require(packageName);
      if (packageName === 'playwright' && typeof module.chromium?.launch !== 'function') {
        failures.push('playwright is installed but its chromium launcher is unavailable');
        continue;
      }
      if (packageName === 'puppeteer' && typeof module.launch !== 'function') {
        failures.push('puppeteer is installed but its launch function is unavailable');
        continue;
      }
      return { name: packageName, module, version: status.version };
    } catch (error) {
      failures.push(`${packageName} could not be loaded: ${error.message}`);
    }
  }

  const error = new Error([
    'Phase E browser preview is fail-closed: no locked and usable Playwright/Puppeteer driver is available.',
    ...failures.map(reason => `- ${reason}`),
    'Install and lock one browser driver, then install its browser binary; no fake-browser fallback is allowed.',
  ].join('\n'));
  error.exitCode = 78;
  throw error;
}

function isWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function assertTemporaryPath(candidate, label) {
  if (!isWithin(candidate, os.tmpdir())) {
    throw new Error(`Phase E ${label} must be inside the OS temporary directory`);
  }
}

function snapshotEnvironment() {
  return Object.fromEntries(TEMP_PATH_ENV_KEYS.map(key => [key, process.env[key]]));
}

function restoreEnvironment(snapshot) {
  for (const key of TEMP_PATH_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

function applyIsolatedEnvironment(runtimeRoot, productionRoot) {
  const paths = {
    NODE_ENV: 'test',
    CRM_PRODUCTION_ROOT: productionRoot,
    CRM_RUNTIME_ROOT: runtimeRoot,
    CRM_DB_PATH: path.join(runtimeRoot, 'crm.db'),
    RECON_OUTPUT_DIR: path.join(runtimeRoot, 'recon-runs'),
    CONTACT_RECON_OUTPUT_DIR: path.join(runtimeRoot, 'contact-recon-runs'),
    CONTACT_RECON_REPORT_DIR: path.join(runtimeRoot, 'contact-recon-reports'),
    CRM_REPORTS_DIR: path.join(runtimeRoot, 'reports'),
    CRM_BACKUP_DIR: path.join(runtimeRoot, 'backups'),
    CRM_LOGS_DIR: path.join(runtimeRoot, 'logs'),
    CRM_OUTPUT_DIR: path.join(runtimeRoot, 'output'),
    CRM_TMP_DIR: path.join(runtimeRoot, 'tmp'),
    CRM_AI_STATIONS_ENABLED: 'false',
    CRM_AI_CUSTOMER_ENRICHMENT_ENABLED: 'false',
    CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED: 'false',
    CRM_AI_SALES_PACK_ENABLED: 'false',
    CRM_AI_QWEN_ONLINE_ENABLED: 'false',
    CRM_AI_QWEN_BATCH_ENABLED: 'false',
  };
  Object.assign(process.env, paths);
  // A caller-provided base DB could read outside the isolated runtime.
  delete process.env.CRM_FIXTURE_BASE_DB;
}

async function createIsolatedFixture() {
  const environment = snapshotEnvironment();
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tradepulse-phase-e-runtime-'));
  const productionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tradepulse-phase-e-production-sentinel-'));
  let fixture = null;
  let closed = false;

  try {
    assertTemporaryPath(runtimeRoot, 'runtime root');
    if (isWithin(runtimeRoot, productionRoot) || isWithin(productionRoot, runtimeRoot)) {
      throw new Error('Phase E runtime and production sentinel paths must be distinct');
    }
    applyIsolatedEnvironment(runtimeRoot, productionRoot);

    // This helper owns the createApp() call and binds 127.0.0.1 on port 0.
    const { seededFixture } = require(path.join(ROOT, 'test', 'helpers', 'permission_fixture'));
    fixture = await seededFixture({
      appOptions: {
        salesCrm: {
          aiStationsEnabled: false,
          customerEnrichmentEnabled: false,
          customerEnrichmentAutoTriggerEnabled: false,
          salesPackEnabled: false,
          qwenOnlineEnabled: false,
          qwenBatchEnabled: false,
        },
      },
    });
    assertTemporaryPath(fixture.dir, 'fixture directory');
    assertTemporaryPath(fixture.dbPath, 'SQLite database');
    const address = new URL(fixture.baseUrl);
    if (address.hostname !== PREVIEW_HOST || !Number(address.port)) {
      throw new Error(`Phase E fixture must expose ${PREVIEW_HOST} on a random port`);
    }
    return {
      fixture,
      runtimeRoot,
      productionRoot,
      async close() {
        if (closed) return;
        closed = true;
        try {
          if (fixture) await fixture.close();
        } finally {
          fs.rmSync(runtimeRoot, { recursive: true, force: true });
          fs.rmSync(productionRoot, { recursive: true, force: true });
          restoreEnvironment(environment);
        }
      },
    };
  } catch (error) {
    if (fixture) {
      try { await fixture.close(); } catch (_closeError) {}
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(productionRoot, { recursive: true, force: true });
    restoreEnvironment(environment);
    throw error;
  }
}

async function browserRoleSmoke(page, baseUrl, credentials) {
  const rootResponse = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const rootStatus = rootResponse?.status?.() ?? 0;
  if (rootStatus !== 200) throw new Error(`${credentials.role} root page returned HTTP ${rootStatus}`);

  const login = await page.evaluate(async input => {
    const response = await fetch('/api/sales-auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { email: credentials.email, password: credentials.password });
  if (login.status !== 200 || login.body?.ok !== true) {
    throw new Error(`${credentials.role} fixture login failed with HTTP ${login.status}`);
  }

  const capabilities = await page.evaluate(async () => {
    const response = await fetch('/api/session/capabilities');
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  if (capabilities.status !== 200 || capabilities.body?.ok !== true) {
    throw new Error(`${credentials.role} capability bootstrap failed with HTTP ${capabilities.status}`);
  }

  const customerId = credentials.role === 'sales' ? 'RU-9003' : 'RU-9001';
  const profileResponse = await page.goto(
    `${baseUrl}/?customer=${encodeURIComponent(customerId)}#customerProfile`,
    { waitUntil: 'domcontentloaded', timeout: 15000 },
  );
  const profileDeadline = Date.now() + 15000;
  let profile = null;
  while (Date.now() < profileDeadline) {
    profile = await page.evaluate(() => {
      const view = document.querySelector('#customerProfileView');
      const frame = document.querySelector('#customerProfileFrame');
      const root = document.querySelector('#profileWidgetRoot');
      const widgetIds = [...(root?.querySelectorAll(':scope > [data-widget-id]') || [])]
        .map(node => node.getAttribute('data-widget-id') || '')
        .filter(Boolean);
      const aiBusinessVisible = [...document.querySelectorAll('[data-ai-business]')].some(element => {
        const style = getComputedStyle(element);
        return !element.classList.contains('hidden')
          && style.display !== 'none'
          && style.visibility !== 'hidden';
      });
      return {
        active: Boolean(view?.classList.contains('active')),
        widgetHosts: widgetIds.length,
        widgetIds,
        frameSrc: frame?.getAttribute('src') || '',
        frameHidden: frame?.classList.contains('hidden') || false,
        title: document.querySelector('#customerProfileTitle')?.textContent || '',
        sourceTagContainer: Boolean(document.querySelector('#customerProfileTags')),
        sourceTagCount: document.querySelectorAll('#customerProfileTags .source-tag').length,
        aiWidgetMounted: widgetIds.includes('customer-ai-station'),
        aiBusinessVisible,
      };
    });
    if (profile.active && profile.widgetHosts > 0 && profile.title.trim()) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!profile?.active || profile.widgetHosts === 0 || !profile.title.trim()) {
    throw new Error(`${credentials.role} default customerProfile did not mount its widget collection`);
  }
  if (profile.frameSrc || !profile.frameHidden) {
    throw new Error(`${credentials.role} default customerProfile unexpectedly loaded the legacy iframe`);
  }
  if (!profile.sourceTagContainer) {
    throw new Error(`${credentials.role} customerProfile is missing the source-tag host`);
  }
  if (profile.aiWidgetMounted || profile.aiBusinessVisible) {
    throw new Error(`${credentials.role} customerProfile exposed an AI widget while AI is disabled`);
  }

  const profileOnlyResponse = await page.goto(
    `${baseUrl}/development-workbench?embedded=1&profile=1&assistant=0&prospect=0&theme=studio&customer=${encodeURIComponent(customerId)}`,
    { waitUntil: 'domcontentloaded', timeout: 15000 },
  );
  const profileOnlyDeadline = Date.now() + 15000;
  let profileOnly = null;
  while (Date.now() < profileOnlyDeadline) {
    profileOnly = await page.evaluate(() => {
      const actions = document.querySelector('.modal-actions');
      const save = document.querySelector('#saveBtn');
      return {
        profileMode: document.body.classList.contains('profile-mode'),
        modalOpen: document.querySelector('#modalBackdrop')?.classList.contains('show') || false,
        actionsDisplay: actions ? getComputedStyle(actions).display : '',
        saveVisible: Boolean(save && getComputedStyle(save).display !== 'none' && save.offsetParent !== null),
      };
    });
    if (profileOnly.profileMode && profileOnly.modalOpen) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!profileOnly?.profileMode || !profileOnly.modalOpen) {
    throw new Error(`${credentials.role} profile-only compatibility entry did not open its read-only detail`);
  }
  if (profileOnly.actionsDisplay !== 'none' || profileOnly.saveVisible) {
    throw new Error(`${credentials.role} profile-only compatibility entry exposed a write action`);
  }
  return {
    role: credentials.role,
    rootStatus,
    capabilityStatus: capabilities.status,
    modules: capabilities.body.modules || [],
    aiStations: Boolean(capabilities.body.features?.aiStations),
    profile,
    profileOnly: {
      ...profileOnly,
      httpStatus: profileOnlyResponse?.status?.() ?? 0,
    },
  };
}

async function runPlaywright(adapter, fixture) {
  const browser = await adapter.module.chromium.launch({ headless: true });
  try {
    const checks = [];
    for (const credentials of ROLE_CREDENTIALS) {
      const context = await browser.newContext();
      try {
        checks.push(await browserRoleSmoke(await context.newPage(), fixture.fixture.baseUrl, credentials));
      } finally {
        await context.close();
      }
    }
    return checks;
  } finally {
    await browser.close();
  }
}

async function runPuppeteer(adapter, fixture) {
  const browser = await adapter.module.launch({ headless: true });
  try {
    const checks = [];
    for (const credentials of ROLE_CREDENTIALS) {
      const page = await browser.newPage();
      try {
        checks.push(await browserRoleSmoke(page, fixture.fixture.baseUrl, credentials));
      } finally {
        await page.close();
      }
    }
    return checks;
  } finally {
    await browser.close();
  }
}

async function runPreview(options) {
  const adapter = loadBrowserAdapter(options.browser);
  let isolated = null;
  try {
    isolated = await createIsolatedFixture();
    let roles;
    try {
      roles = adapter.name === 'playwright'
        ? await runPlaywright(adapter, isolated)
        : await runPuppeteer(adapter, isolated);
    } catch (error) {
      const wrapped = new Error([
        `Phase E ${adapter.name} browser launch/navigation failed; refusing to fake a browser result.`,
        error.message,
        'Check that the locked browser package and its Chromium binary are installed.',
      ].join('\n'));
      wrapped.exitCode = 78;
      throw wrapped;
    }
    return {
      ok: true,
      driver: adapter.name,
      driverVersion: adapter.version,
      host: PREVIEW_HOST,
      port: new URL(isolated.fixture.baseUrl).port,
      roles,
      note: 'Preview smoke only; full browser acceptance has not been run.',
    };
  } finally {
    if (isolated) await isolated.close();
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArguments(argv, env);
  } catch (error) {
    console.error(`[phase-e-browser-preview] ${error.message}`);
    console.error(usage());
    return error.exitCode || 64;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  try {
    const result = await runPreview(options);
    console.log(JSON.stringify(result, null, 2));
    console.log('[phase-e-browser-preview] Preview smoke finished; this is not full browser acceptance.');
    return 0;
  } catch (error) {
    console.error(`[phase-e-browser-preview] ${error.message}`);
    return error.exitCode || 1;
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; });
}

module.exports = {
  LOCKED_BROWSER_PACKAGES,
  PREVIEW_HOST,
  RANDOM_PORT,
  OPT_IN_ENV,
  ROLE_CREDENTIALS,
  applyIsolatedEnvironment,
  checkLockedBrowser,
  createIsolatedFixture,
  isPinnedVersion,
  loadBrowserAdapter,
  main,
  parseArguments,
  runPreview,
};

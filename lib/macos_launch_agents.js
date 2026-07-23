const path = require('node:path');

const SYSTEM_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
const LOCALHOST_NO_PROXY = '127.0.0.1,localhost,::1';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderStrings(values) {
  return values.map(value => `<string>${escapeXml(value)}</string>`).join('');
}

function renderEnvironment(environment) {
  if (!environment) return '';
  const entries = Object.entries(environment)
    .map(([key, value]) => `<key>${escapeXml(key)}</key><string>${escapeXml(value)}</string>`)
    .join('');
  return `<key>EnvironmentVariables</key><dict>${entries}</dict>`;
}

function renderCalendarIntervals(intervals) {
  if (!intervals) return '';
  const entries = intervals.map(({ hour, minute }) => (
    `<dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>`
  )).join('');
  return `<key>StartCalendarInterval</key><array>${entries}</array>`;
}

function renderPlist(definition) {
  const flags = [
    definition.runAtLoad ? '<key>RunAtLoad</key><true/>' : '',
    definition.keepAlive ? '<key>KeepAlive</key><true/>' : '',
    definition.throttleInterval === undefined
      ? ''
      : `<key>ThrottleInterval</key><integer>${definition.throttleInterval}</integer>`,
    definition.startInterval === undefined
      ? ''
      : `<key>StartInterval</key><integer>${definition.startInterval}</integer>`,
    renderCalendarIntervals(definition.startCalendarIntervals),
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${escapeXml(definition.label)}</string>
<key>ProgramArguments</key><array>${renderStrings(definition.programArguments)}</array>
<key>WorkingDirectory</key><string>${escapeXml(definition.workingDirectory)}</string>
<key>StandardOutPath</key><string>${escapeXml(definition.standardOutPath)}</string>
<key>StandardErrorPath</key><string>${escapeXml(definition.standardErrorPath)}</string>
${renderEnvironment(definition.environment)}${flags}</dict></plist>
`;
}

function buildServiceDefinitions(options) {
  const {
    runtimeRoot,
    deployRoot,
    logsDir,
    homeDir,
    nodeBin,
    pythonBin,
    cloudflaredBin,
    includeAutoDeploy = false,
  } = options;
  const workerEnvironment = {
    HOME: homeDir,
    PATH: SYSTEM_PATH,
    NO_PROXY: LOCALHOST_NO_PROXY,
    no_proxy: LOCALHOST_NO_PROXY,
  };
  const base = (label, kind, programArguments, settings = {}) => ({
    label,
    kind,
    programArguments,
    workingDirectory: runtimeRoot,
    standardOutPath: path.join(logsDir, `${label}.out.log`),
    standardErrorPath: path.join(logsDir, `${label}.err.log`),
    ...settings,
  });
  const services = [
    base('com.russia-crm.server', 'code', [nodeBin, path.join(runtimeRoot, 'server.js')], {
      environment: { HOME: homeDir, PATH: SYSTEM_PATH, NODE_ENV: 'production' },
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
    }),
    base('com.russia-crm.recon-worker', 'code', [
      pythonBin,
      path.join(runtimeRoot, 'scripts', 'recon_agent_worker.py'),
      '--poll',
      '10',
      '--webapp-url',
      'http://127.0.0.1:3000/api/recon',
    ], {
      environment: workerEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 15,
    }),
    ...[1, 2].map(number => base(`com.russia-crm.contact-worker-${number}`, 'code', [
      pythonBin,
      path.join(runtimeRoot, 'scripts', 'contact_recon_worker.py'),
      '--url',
      'http://127.0.0.1:3000/api/contact-recon',
      '--poll',
      '15',
    ], {
      environment: workerEnvironment,
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 15,
    })),
    base('com.russia-crm.daily-enqueue', 'code', [
      nodeBin,
      path.join(runtimeRoot, 'scripts', 'daily-customer-delivery.js'),
      '--enqueue',
      '--group',
      'A',
      '--country',
      'RU',
      '--contact-limit',
      '30',
    ], {
      startCalendarIntervals: [
        { hour: 0, minute: 30 },
        { hour: 6, minute: 30 },
        { hour: 12, minute: 30 },
        { hour: 18, minute: 30 },
      ],
    }),
    base('com.russia-crm.daily-report', 'code', [
      nodeBin,
      path.join(runtimeRoot, 'scripts', 'generate-daily-delivery.js'),
    ], {
      startCalendarIntervals: [
        { hour: 8, minute: 0 },
        { hour: 20, minute: 0 },
      ],
    }),
    base('com.russia-crm.completion-notifier', 'code', [
      nodeBin,
      path.join(runtimeRoot, 'scripts', 'notify-contact-recon-complete.js'),
    ], {
      runAtLoad: true,
      startInterval: 300,
    }),
    base('com.russia-crm.cloudflare-tunnel', 'tunnel', [
      cloudflaredBin,
      'tunnel',
      '--config',
      path.join(homeDir, '.cloudflared', 'config.yml'),
      'run',
      'tradepulse-crm',
    ], {
      environment: { HOME: homeDir, PATH: SYSTEM_PATH },
      runAtLoad: true,
      keepAlive: true,
      throttleInterval: 10,
    }),
  ];

  if (includeAutoDeploy) {
    services.push(base('com.russia-crm.auto-deploy', 'deploy', [
      '/bin/zsh',
      path.join(runtimeRoot, 'scripts', 'deploy-from-github.sh'),
    ], {
      environment: {
        HOME: homeDir,
        PATH: SYSTEM_PATH,
        DEPLOY_NODE_BIN: nodeBin,
        DEPLOY_ROOT: deployRoot,
      },
      runAtLoad: true,
      startInterval: 60,
    }));
  }

  return services;
}

module.exports = { buildServiceDefinitions, renderPlist };

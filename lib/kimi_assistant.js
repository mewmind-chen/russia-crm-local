const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { validHermesSessionId } = require('./hermes_assistant');

const DEFAULT_KIMI_BIN = path.join(os.homedir(), '.kimi-code', 'bin', 'kimi');
const DEFAULT_KIMI_HOME = path.join(os.homedir(), '.kimi-code-crm');
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_MAX_OUTPUT = 18000;

let activeKimiCalls = 0;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function kimiConfig() {
  const home = String(process.env.ASSISTANT_KIMI_HOME || DEFAULT_KIMI_HOME).trim();
  return {
    bin: String(process.env.ASSISTANT_KIMI_BIN || DEFAULT_KIMI_BIN).trim(),
    home,
    model: String(process.env.ASSISTANT_KIMI_MODEL || 'k3').trim(),
    effort: String(process.env.ASSISTANT_KIMI_EFFORT || 'low').trim(),
    timeoutMs: boundedInteger(process.env.ASSISTANT_KIMI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 15000, 120000),
    maxConcurrent: boundedInteger(process.env.ASSISTANT_KIMI_MAX_CONCURRENT, 1, 1, 2),
    maxOutput: boundedInteger(process.env.ASSISTANT_KIMI_MAX_OUTPUT, DEFAULT_MAX_OUTPUT, 2000, 30000),
    maxCompletionTokens: boundedInteger(process.env.ASSISTANT_KIMI_MAX_COMPLETION_TOKENS, 2500, 256, 12000),
    maxContext: boundedInteger(process.env.ASSISTANT_KIMI_MAX_CONTEXT, 1048576, 32768, 1048576),
    skillsDir: String(process.env.ASSISTANT_KIMI_SKILLS_DIR || path.join(home, 'empty-skills')).trim(),
    credentialsFile: String(
      process.env.ASSISTANT_KIMI_CREDENTIALS_FILE || path.join(os.homedir(), '.hermes', '.env'),
    ).trim(),
  };
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

function kimiApiKey(config = kimiConfig()) {
  const direct = String(process.env.KIMI_MODEL_API_KEY || process.env.KIMI_API_KEY || '').trim();
  if (direct) return direct;
  const values = parseEnvFile(config.credentialsFile);
  return String(values.KIMI_API_KEY || values.KIMI_CODING_API_KEY || '').trim();
}

function buildKimiPrompt(messages, options = {}) {
  const sessionId = validHermesSessionId(options.sessionId);
  let selected = Array.isArray(messages) ? messages : [];
  if (sessionId && selected.length > 2) {
    const system = selected.find(item => item?.role === 'system');
    const latestUser = [...selected].reverse().find(item => item?.role === 'user');
    selected = [system, latestUser].filter(Boolean);
  }
  const evidence = selected
    .filter(item => item && item.content)
    .map(item => `[${String(item.role || 'user').toUpperCase()}]\n${String(item.content).slice(0, 32000)}`)
    .join('\n\n')
    .slice(0, 42000);
  return [
    '你是 Russia CRM 中的受限 Kimi CLI 外贸研究助手。',
    'CRM SQLite、Recon 报告和网页证据已由服务端整理为只读证据包；必须优先依据证据回答。',
    options.externalAllowed === false
      ? '本次禁止外网补查，只能使用证据包；缺失信息标为待核验。'
      : '外网补查由 CRM 服务端限额完成；不得自行调用搜索、网页或其他工具。',
    '禁止终端、文件、代码、浏览器、MCP、消息、定时任务和任何写入；禁止修改 CRM、发邮件或联系客户。',
    '不得编造公司、联系人、联系方式、采购意向、制裁结论、报告内容或来源。',
    '结论先行，区分已验证事实、公开线索、业务推断和信息缺口；回答紧凑，不展示内部推理。',
    `当前范围：${String(options.scope || 'view')}。`,
    '',
    '<CRM_EVIDENCE_BUNDLE>',
    evidence,
    '</CRM_EVIDENCE_BUNDLE>',
  ].join('\n');
}

function buildKimiArgs(prompt, options = {}) {
  const config = kimiConfig();
  const sessionId = validHermesSessionId(options.sessionId);
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--skills-dir', config.skillsDir,
  ];
  if (sessionId) args.unshift('--session', sessionId);
  return args;
}

function parseKimiOutput(stdout, fallbackSessionId = '') {
  let answer = '';
  let sessionId = validHermesSessionId(fallbackSessionId);
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (event.role === 'assistant' && typeof event.content === 'string') answer += event.content;
    if (event.role === 'meta' && event.type === 'session.resume_hint') {
      sessionId = validHermesSessionId(event.session_id) || sessionId;
    }
  }
  return { answer: answer.trim(), sessionId };
}

async function callKimi(messages, options = {}) {
  const config = kimiConfig();
  if (!fs.existsSync(config.bin)) {
    const error = new Error(`Kimi CLI 未安装或路径不可用：${config.bin}`);
    error.code = 'KIMI_CLI_NOT_FOUND';
    error.statusCode = 503;
    throw error;
  }
  const apiKey = kimiApiKey(config);
  if (!apiKey) {
    const error = new Error('Kimi CLI 凭据未配置。');
    error.code = 'KIMI_CLI_NO_KEY';
    error.statusCode = 503;
    throw error;
  }
  if (activeKimiCalls >= config.maxConcurrent) {
    const error = new Error('Kimi 正在处理上一条消息，请稍后再试。');
    error.code = 'KIMI_CLI_BUSY';
    error.statusCode = 429;
    throw error;
  }

  const prompt = buildKimiPrompt(messages, options);
  const args = buildKimiArgs(prompt, options);
  fs.mkdirSync(config.skillsDir, { recursive: true });
  activeKimiCalls += 1;
  try {
    const parsed = await new Promise((resolve, reject) => {
      execFile(config.bin, args, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: config.timeoutMs,
        maxBuffer: Math.max(config.maxOutput * 4, 1024 * 1024),
        env: {
          ...process.env,
          KIMI_CODE_HOME: config.home,
          KIMI_DISABLE_TELEMETRY: '1',
          KIMI_CODE_NO_AUTO_UPDATE: '1',
          KIMI_MODEL_NAME: config.model,
          KIMI_MODEL_API_KEY: apiKey,
          KIMI_MODEL_BASE_URL: 'https://api.kimi.com/coding/v1',
          KIMI_MODEL_PROVIDER_TYPE: 'kimi',
          KIMI_MODEL_MAX_CONTEXT_SIZE: String(config.maxContext),
          KIMI_MODEL_CAPABILITIES: 'thinking',
          KIMI_MODEL_THINKING_EFFORT: config.effort,
          KIMI_MODEL_MAX_COMPLETION_TOKENS: String(config.maxCompletionTokens),
        },
      }, (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().slice(0, 500);
          const wrapped = new Error(
            error.killed
              ? `Kimi 请求超过 ${Math.round(config.timeoutMs / 1000)} 秒，已停止。`
              : `Kimi CLI 调用失败：${detail}`,
          );
          wrapped.code = error.killed ? 'KIMI_CLI_TIMEOUT' : 'KIMI_CLI_FAILED';
          wrapped.statusCode = error.killed ? 504 : 502;
          reject(wrapped);
          return;
        }
        resolve(parseKimiOutput(stdout, options.sessionId));
      });
    });
    if (!parsed.answer) {
      const error = new Error('Kimi CLI 没有返回有效内容。');
      error.code = 'KIMI_CLI_EMPTY';
      error.statusCode = 502;
      throw error;
    }
    return {
      answer: parsed.answer.slice(0, config.maxOutput),
      sessionId: parsed.sessionId,
      usage: null,
      model: `Kimi CLI · ${config.model}`,
      engine: 'kimi-cli',
      guardrails: {
        profile: 'crm',
        permissionMode: 'manual',
        tools: 'denied',
        timeoutMs: config.timeoutMs,
        maxConcurrent: config.maxConcurrent,
        readOnly: true,
      },
    };
  } finally {
    activeKimiCalls = Math.max(0, activeKimiCalls - 1);
  }
}

module.exports = {
  buildKimiArgs,
  buildKimiPrompt,
  callKimi,
  kimiApiKey,
  kimiConfig,
  parseKimiOutput,
};

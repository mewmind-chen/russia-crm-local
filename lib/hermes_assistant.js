const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_HERMES_BIN = path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes');
const DEFAULT_TIMEOUT_MS = 90000;
const DEFAULT_MAX_TURNS = 4;
const DEFAULT_MAX_OUTPUT = 18000;
const DEFAULT_MAX_PROMPT = 60000;

let activeHermesCalls = 0;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function hermesConfig() {
  return {
    bin: String(process.env.ASSISTANT_HERMES_BIN || process.env.HERMES_BIN || DEFAULT_HERMES_BIN),
    home: String(process.env.ASSISTANT_HERMES_HOME || '').trim(),
    timeoutMs: boundedInteger(process.env.ASSISTANT_HERMES_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 15000, 180000),
    maxTurns: boundedInteger(process.env.ASSISTANT_HERMES_MAX_TURNS, DEFAULT_MAX_TURNS, 1, 6),
    maxConcurrent: boundedInteger(process.env.ASSISTANT_HERMES_MAX_CONCURRENT, 1, 1, 2),
    maxOutput: boundedInteger(process.env.ASSISTANT_HERMES_MAX_OUTPUT, DEFAULT_MAX_OUTPUT, 2000, 30000),
    maxPrompt: boundedInteger(process.env.ASSISTANT_HERMES_MAX_PROMPT, DEFAULT_MAX_PROMPT, 12000, 80000),
    provider: String(process.env.ASSISTANT_HERMES_PROVIDER || '').trim(),
    model: String(process.env.ASSISTANT_HERMES_MODEL || '').trim(),
  };
}

function providerCredentialEnv(config = hermesConfig()) {
  if (config.provider !== 'opencode-go' || process.env.OPENCODE_GO_API_KEY) return {};
  const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const key = String(auth?.['opencode-go']?.key || '').trim();
    return key ? { OPENCODE_GO_API_KEY: key } : {};
  } catch (_error) {
    return {};
  }
}

function validHermesSessionId(value) {
  const sessionId = String(value || '').trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(sessionId) ? sessionId : '';
}

function compactMessages(messages, maxPrompt, resuming = false) {
  let selected = Array.isArray(messages) ? messages : [];
  if (resuming && selected.length > 2) {
    const system = selected.find(item => item?.role === 'system');
    const latestUser = [...selected].reverse().find(item => item?.role === 'user');
    selected = [system, latestUser].filter(Boolean);
  }
  const items = selected
    .filter(item => item && item.content)
    .map(item => {
      const role = String(item.role || 'user').toUpperCase();
      const limit = role === 'SYSTEM' ? 14000 : 36000;
      const content = String(item.content || '').slice(0, limit);
      return `[${role}]\n${content}`;
    });
  const joined = items.join('\n\n');
  return joined.length <= maxPrompt ? joined : joined.slice(0, maxPrompt);
}

function buildHermesPrompt(messages, options = {}) {
  const config = hermesConfig();
  const sessionId = validHermesSessionId(options.sessionId);
  const evidenceBundle = compactMessages(messages, config.maxPrompt, Boolean(sessionId));
  const scope = String(options.scope || 'view');
  return [
    '你是 Russia CRM 中的受限 Hermes 外贸研究助手。',
    '',
    '强制边界：',
    '1. CRM SQLite、Recon 报告和证据已经由服务端以只读证据包提供。必须先使用这些内容，不得声称自己直接读取了本机数据库或文件。',
    options.externalAllowed === false
      ? '2. 本次请求禁止外网检索；只能使用证据包回答，缺失信息必须明确标为待核验。'
      : '2. 外网搜索和网页提取已由 CRM 服务端按限额完成并放入证据包。你不得再次调用自己的 web_search/web_extract；证据不足时说明缺口。',
    '3. 禁止调用终端、文件、代码执行、浏览器自动化、MCP、消息发送、定时任务或任何写入工具。',
    '4. 禁止修改 CRM、自动入库、创建 Recon、发送邮件、联系客户或代表用户执行外部操作。',
    '5. 不得编造公司、联系人、邮箱、电话、采购意向、制裁结论、报告内容或来源 URL。',
    '6. 必须区分：CRM/报告已验证事实、公开网页待核验线索、业务推断、信息缺口。',
    '7. 外网结果必须给可打开的来源 URL 和可信度；第三方目录不能冒充官网。',
    '8. 找客户时采用 Hermes 1-5 分制；低于 3 分不推荐进入客户池，但不得自行写库。',
    '9. 回答结论先行，说明证据，再给下一步最小动作；不要展示内部推理过程。',
    `10. 当前分析范围：${scope}。不得越过该范围分析其他客户，除非用户明确要求全库比较。`,
    '',
    '以下是服务端生成的只读证据包和用户问题：',
    '<CRM_EVIDENCE_BUNDLE>',
    evidenceBundle,
    '</CRM_EVIDENCE_BUNDLE>',
  ].join('\n');
}

function pickHermesSkills(prompt, options = {}) {
  return [];
}

function buildHermesArgs(prompt, options = {}) {
  const config = hermesConfig();
  const sessionId = validHermesSessionId(options.sessionId);
  const args = [
    'chat',
    '--query', prompt,
    '--quiet',
    '--max-turns', String(config.maxTurns),
    '--toolsets', 'todo',
    '--source', 'tool',
  ];
  if (sessionId) args.push('--resume', sessionId);
  else args.push('--pass-session-id');
  const skills = pickHermesSkills(prompt, options);
  if (skills.length) args.push('--skills', skills.join(','));
  if (config.provider) args.push('--provider', config.provider);
  if (config.model) args.push('--model', config.model);
  return args;
}

function parseHermesOutput(stdout, fallbackSessionId = '', stderr = '') {
  const raw = String(stdout || '');
  const sessionOutput = `${raw}\n${String(stderr || '')}`;
  const sessionId = validHermesSessionId(
    sessionOutput.match(/^\s*session[_ -]?id\s*[:=]\s*([A-Za-z0-9_-]{8,80})\s*$/im)?.[1]
      || fallbackSessionId,
  );
  const answer = raw
    .replace(/^\s*session[_ -]?id\s*[:=]\s*[A-Za-z0-9_-]{8,80}\s*$/gim, '')
    .trim();
  return { answer, sessionId };
}

async function callHermes(messages, options = {}) {
  const config = hermesConfig();
  if (!fs.existsSync(config.bin)) {
    const error = new Error(`Hermes 未安装或路径不可用：${config.bin}`);
    error.code = 'HERMES_NOT_FOUND';
    error.statusCode = 503;
    throw error;
  }
  if (activeHermesCalls >= config.maxConcurrent) {
    const error = new Error('Hermes 正在处理另一个请求，请稍后再试。');
    error.code = 'HERMES_BUSY';
    error.statusCode = 429;
    throw error;
  }

  const prompt = buildHermesPrompt(messages, options);
  const args = buildHermesArgs(prompt, options);
  activeHermesCalls += 1;
  try {
    const result = await new Promise((resolve, reject) => {
      execFile(config.bin, args, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: config.timeoutMs,
        maxBuffer: Math.max(config.maxOutput * 4, 1024 * 1024),
        env: {
          ...process.env,
          ...providerCredentialEnv(config),
          ...(config.home ? { HERMES_HOME: config.home } : {}),
          HERMES_SOURCE: 'tool',
        },
      }, (error, stdout, stderr) => {
        if (error) {
          const wrapped = new Error(
            error.killed
              ? `Hermes 请求超过 ${Math.round(config.timeoutMs / 1000)} 秒，已停止。`
              : `Hermes 调用失败：${String(stderr || error.message).trim().slice(0, 500)}`,
          );
          wrapped.code = error.killed ? 'HERMES_TIMEOUT' : 'HERMES_FAILED';
          wrapped.statusCode = error.killed ? 504 : 502;
          reject(wrapped);
          return;
        }
        const parsed = parseHermesOutput(stdout, options.sessionId, stderr);
        resolve({
          answer: parsed.answer.slice(0, config.maxOutput),
          sessionId: parsed.sessionId,
        });
      });
    });
    if (!result.answer) {
      const error = new Error('Hermes 没有返回有效内容。');
      error.code = 'HERMES_EMPTY';
      error.statusCode = 502;
      throw error;
    }
    return {
      answer: result.answer,
      sessionId: result.sessionId,
      usage: null,
      model: config.model ? `Hermes · ${config.model}` : 'Hermes',
      engine: 'hermes',
      guardrails: {
        provider: config.provider || 'auto',
        profile: config.home ? 'crm' : 'default',
        toolsets: ['todo'],
        maxTurns: config.maxTurns,
        maxConcurrent: config.maxConcurrent,
        timeoutMs: config.timeoutMs,
        readOnly: true,
      },
    };
  } finally {
    activeHermesCalls = Math.max(0, activeHermesCalls - 1);
  }
}

module.exports = {
  buildHermesArgs,
  buildHermesPrompt,
  callHermes,
  hermesConfig,
  parseHermesOutput,
  pickHermesSkills,
  providerCredentialEnv,
  validHermesSessionId,
};

'use strict';

const DEFAULT_QWEN_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEFAULT_QWEN_MODEL = 'qwen3.7-plus';
const DEFAULT_QWEN_TIMEOUT_MS = 30_000;
const DEFAULT_QWEN_MAX_TOKENS = 3_000;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function requestIdFrom(response, data) {
  return String(
    data?.request_id
      || data?.requestId
      || response?.headers?.get?.('x-request-id')
      || response?.headers?.get?.('request-id')
      || '',
  ).trim();
}

function qwenError(message, code, statusCode, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, metadata);
  return error;
}

function classifyHttpError(status, message, metadata) {
  if ([401, 403].includes(status)) return qwenError(message, 'QWEN_AUTH_ERROR', status, metadata);
  if (status === 429) return qwenError(message, 'QWEN_RATE_LIMITED', status, metadata);
  if (status >= 500) return qwenError(message, 'QWEN_PROVIDER_ERROR', status, metadata);
  return qwenError(message, 'QWEN_REQUEST_ERROR', status, metadata);
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? input + output);
  return {
    prompt_tokens: Number.isFinite(input) && input >= 0 ? Math.floor(input) : 0,
    completion_tokens: Number.isFinite(output) && output >= 0 ? Math.floor(output) : 0,
    total_tokens: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0,
  };
}

async function callQwen(messages, options = {}) {
  const apiKey = String(options.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '').trim();
  const model = String(options.model || process.env.QWEN_MODEL || DEFAULT_QWEN_MODEL).trim();
  if (!apiKey) {
    throw qwenError('未配置 DASHSCOPE_API_KEY，无法使用通义千问。', 'QWEN_NOT_CONFIGURED', 503, { model });
  }
  const endpoint = String(options.endpoint || process.env.QWEN_ENDPOINT || DEFAULT_QWEN_ENDPOINT).trim();
  const timeoutMs = boundedInteger(
    options.timeoutMs ?? process.env.QWEN_TIMEOUT_MS,
    DEFAULT_QWEN_TIMEOUT_MS,
    1,
    120_000,
  );
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number(options.temperature ?? process.env.QWEN_TEMPERATURE ?? 0.2),
        top_p: Number(options.topP ?? process.env.QWEN_TOP_P ?? 0.8),
        max_tokens: boundedInteger(
          options.maxTokens ?? process.env.QWEN_MAX_TOKENS,
          DEFAULT_QWEN_MAX_TOKENS,
          1,
          32_768,
        ),
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_error) {
      throw qwenError('通义千问返回了无法解析的响应。', 'QWEN_INVALID_RESPONSE', 502, {
        model,
        requestId: requestIdFrom(response),
      });
    }
    const requestId = requestIdFrom(response, data);
    if (!response.ok) {
      const message = String(data?.error?.message || data?.message || `通义千问请求失败：${response.status}`)
        .replace(/\s+/g, ' ').trim().slice(0, 300);
      throw classifyHttpError(response.status, message, { model, requestId });
    }
    const choice = data?.choices?.[0];
    const answer = choice?.message?.content;
    if (typeof answer !== 'string') {
      throw qwenError('通义千问响应缺少文本结果。', 'QWEN_INVALID_RESPONSE', 502, {
        model: data?.model || model,
        requestId,
        usage: normalizeUsage(data?.usage),
      });
    }
    return Object.freeze({
      answer,
      model: String(data?.model || model),
      requestId,
      usage: normalizeUsage(data?.usage),
      finishReason: String(choice?.finish_reason || ''),
    });
  } catch (caught) {
    if (caught?.code && String(caught.code).startsWith('QWEN_')) throw caught;
    if (caught?.name === 'AbortError' || controller.signal.aborted) {
      if (!timedOut && externalSignal?.aborted) {
        throw qwenError('通义千问请求已取消。', 'QWEN_CANCELLED', 499, { model });
      }
      throw qwenError(`通义千问请求超过 ${Math.round(timeoutMs / 1000)} 秒，已停止。`, 'QWEN_TIMEOUT', 504, { model });
    }
    throw qwenError('通义千问网络请求失败。', 'QWEN_NETWORK_ERROR', 502, { model });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', abortFromCaller);
  }
}

module.exports = {
  DEFAULT_QWEN_ENDPOINT,
  DEFAULT_QWEN_MODEL,
  callQwen,
  normalizeUsage,
};

export class HttpError extends Error {
  constructor(message, {
    status = 0,
    code = '',
    details = null,
    url = '',
    method = 'GET',
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.url = url;
    this.method = method;
  }
}

function positiveTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 0;
}

export function createApiClient({
  fetchImpl = globalThis.fetch,
  defaultTimeoutMs = 0,
  onUnauthorized = () => {},
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createApiClient requires a fetch implementation');
  }
  if (typeof onUnauthorized !== 'function') {
    throw new TypeError('onUnauthorized must be a function');
  }

  async function request(url, options = {}) {
    const {
      timeoutMs = defaultTimeoutMs,
      signal: externalSignal,
      headers = {},
      ...fetchOptions
    } = options;
    const timeout = positiveTimeout(timeoutMs);
    const controller = timeout ? new AbortController() : null;
    let timedOut = false;
    let timeoutId = null;
    let removeExternalAbort = null;

    if (controller && externalSignal) {
      const abortFromExternal = () => controller.abort(externalSignal.reason);
      if (externalSignal.aborted) abortFromExternal();
      else {
        externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        removeExternalAbort = () => externalSignal.removeEventListener('abort', abortFromExternal);
      }
    }
    if (controller) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, timeout);
    }

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    try {
      const response = await fetchImpl(url, {
        credentials: 'same-origin',
        ...fetchOptions,
        signal: controller?.signal || externalSignal,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const error = new HttpError(result.error || '请求失败', {
          status: response.status,
          code: result.code || '',
          details: result,
          url: String(url),
          method,
        });
        if (response.status === 401) await onUnauthorized(error);
        throw error;
      }
      return result;
    } catch (error) {
      if (timedOut) {
        throw new HttpError('请求超时，请检查网络后重试', {
          status: 0,
          code: 'REQUEST_TIMEOUT',
          details: { timeoutMs: timeout },
          url: String(url),
          method,
          cause: error,
        });
      }
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      removeExternalAbort?.();
    }
  }

  request.request = request;
  return request;
}

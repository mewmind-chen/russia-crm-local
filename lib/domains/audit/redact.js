'use strict';

// Audit payload redaction. Sensitive keys (passwords, tokens, credentials,
// cookies, preview/confirmation fields) are replaced before payloads are
// persisted or emitted.

function redactAuditPayload(value) {
  if (Array.isArray(value)) return value.map(redactAuditPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /password|token|secret|credential|authorization|cookie|previewId|confirmationText/i.test(key) ? '[REDACTED]' : redactAuditPayload(item),
  ]));
}

module.exports = Object.freeze({
  redactAuditPayload,
});

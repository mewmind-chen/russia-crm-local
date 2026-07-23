'use strict';

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value.trim();
}

function asIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('clock returned an invalid date');
  return date.toISOString();
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value);
}

function summarizeError(error) {
  return String(error?.message || error || 'AI job failed')
    .replace(/\b(authorization|api[-_]?key|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function safeCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

module.exports = { asIso, nonempty, parseJson, safeCost, summarizeError };

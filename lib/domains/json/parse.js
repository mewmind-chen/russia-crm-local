'use strict';

// Resilient JSON parsing. json() tolerates null/invalid input and returns a
// fallback; parseJsonObject() narrows the result to a plain object.

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function parseJsonObject(value) {
  const parsed = json(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

module.exports = Object.freeze({
  json,
  parseJsonObject,
});
'use strict';

const crypto = require('node:crypto');

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function contextHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function createEvidenceCollector(options = {}) {
  const maxEvidence = Number.isInteger(options.maxEvidence) && options.maxEvidence > 0
    ? options.maxEvidence
    : 200;
  const idPrefix = clean(options.idPrefix, 32) || 'EV';
  const evidence = [];

  function add(input) {
    if (!input || evidence.length >= maxEvidence) return '';
    const value = clean(input.value);
    if (!value) return '';
    const id = `${idPrefix}-${String(evidence.length + 1).padStart(4, '0')}`;
    evidence.push(Object.freeze({
      id,
      sourceTable: clean(input.sourceTable, 80),
      sourceId: clean(input.sourceId, 160),
      field: clean(input.field, 100),
      value,
      sourceUrl: clean(input.sourceUrl, 1000),
      sourceTitle: clean(input.sourceTitle, 300),
      checkedAt: clean(input.checkedAt, 80),
      confidence: clean(input.confidence, 40) || 'unknown',
    }));
    return id;
  }

  return Object.freeze({
    add,
    all: () => Object.freeze(evidence.slice()),
    ids: () => Object.freeze(evidence.map(item => item.id)),
  });
}

module.exports = { canonicalize, contextHash, createEvidenceCollector };

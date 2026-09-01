'use strict';

// Shared, fail-closed parser for user-configured list ordering. Callers own the
// page-specific allowlist and SQL expressions; this module never trusts a field
// name from the request.
function sortNotAuthorized() {
  const error = new Error('排序条件未获授权');
  error.statusCode = 403;
  error.code = 'SORT_NOT_AUTHORIZED';
  return error;
}

function parseSortDescriptors(value, allowed, { max = 16, onError = sortNotAuthorized } = {}) {
  if (!value) return [];
  let source = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (!text.startsWith('[')) return [];
    try { source = JSON.parse(text); } catch (_error) { throw onError(); }
  }
  if (!Array.isArray(source) || source.length > max) throw onError();
  const allow = allowed instanceof Map ? allowed : new Map(Object.entries(allowed || {}));
  const seen = new Set();
  return source.map(item => {
    const descriptor = item && typeof item === 'object' ? item : { field: item };
    const field = String(descriptor.field || descriptor.sortKey || descriptor.key || '').trim();
    const expression = allow.get(field);
    if (!expression || seen.has(field)) throw onError();
    const direction = String(descriptor.direction || descriptor.order || 'asc').toLowerCase();
    if (!['asc', 'desc'].includes(direction)) throw onError();
    seen.add(field);
    return Object.freeze({ field, direction, expression });
  });
}

function orderByForSort(value, allowed, { fallback = '', tieBreaker = '' } = {}) {
  const descriptors = parseSortDescriptors(value, allowed);
  if (!descriptors.length) return { descriptors, orderBy: fallback };
  const clauses = descriptors.map(item => `${item.expression} ${item.direction.toUpperCase()}`);
  if (tieBreaker) clauses.push(tieBreaker);
  return { descriptors, orderBy: clauses.join(',') };
}

function compareSortValues(left, right) {
  const leftEmpty = left == null || String(left).trim() === '';
  const rightEmpty = right == null || String(right).trim() === '';
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    return leftEmpty ? 1 : -1;
  }
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = typeof right === 'number' ? right : Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(left).trim())
    && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(right).trim());
  if (numeric) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true, sensitivity: 'base' });
}

module.exports = {
  parseSortDescriptors,
  orderByForSort,
  compareSortValues,
  sortNotAuthorized,
};

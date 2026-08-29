'use strict';

// Shared list pagination helpers. Both consumers normalize page/pageSize into
// an offset while clamping pageSize to the allowed range.

function normalizeListQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Number.parseInt(query.pageSize || query.page_size, 10) === 100 ? 100 : 50;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search: String(query.search || '').trim().slice(0, 120),
  };
}

function listPage(input = {}, fallback = 50) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(
    input.pageSize || input.page_size, 10,
  ) || fallback));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = Object.freeze({
  normalizeListQuery,
  listPage,
});
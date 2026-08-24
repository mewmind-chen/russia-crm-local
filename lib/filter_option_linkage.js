'use strict';

function astWithoutField(ast = { filters: [] }, fieldKey) {
  const filters = Array.isArray(ast?.filters) ? ast.filters : [];
  return {
    ...ast,
    filters: filters.filter(item => String(item?.key || '') !== String(fieldKey || '')),
  };
}

function overlayOptionCounts(catalog, counted) {
  const counts = new Map((counted || []).map(option => [
    String(option.value),
    Number(option.count || 0),
  ]));
  return (catalog || []).map(option => ({
    ...option,
    count: counts.has(String(option.value)) ? counts.get(String(option.value)) : 0,
  }));
}

module.exports = {
  astWithoutField,
  overlayOptionCounts,
};

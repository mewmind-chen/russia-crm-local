function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function createIntelligenceService(api) {
  return {
    research(kind, query, options = {}) {
      const safeKind = encodeURIComponent(String(kind));
      return api(`/api/sales-crm/research/${safeKind}${queryString(query)}`, options);
    },
    customerDetail(customerId, options = {}) {
      return api(`/api/sales-crm/profile/${encodeURIComponent(String(customerId))}`, options);
    },
  };
}

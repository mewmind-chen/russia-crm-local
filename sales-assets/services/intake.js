function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload ?? {}) };
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function createIntakeService(api) {
  return {
    list(query, options = {}) {
      return api(`/api/sales-crm/intake${queryString(query)}`, options);
    },
    scan(options = {}) {
      return api('/api/sales-crm/intake/scan', { ...jsonOptions('POST'), ...options });
    },
    act(payload, options = {}) {
      return api('/api/sales-crm/intake/action', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    updateSettings(payload, options = {}) {
      return api('/api/sales-crm/intake/settings', {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
  };
}

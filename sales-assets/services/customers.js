function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload ?? {}) };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function createCustomerService(api) {
  return {
    getProfile(customerId, options = {}) {
      return api(`/api/sales-crm/profile/${encode(customerId)}`, options);
    },
    create(payload, options = {}) {
      return api('/api/sales-crm/accounts', { ...jsonOptions('POST', payload), ...options });
    },
    update(customerId, payload, options = {}) {
      return api(`/api/sales-crm/accounts/${encode(customerId)}`, {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
    bulkAssign(payload, options = {}) {
      return api('/api/sales-crm/accounts/bulk-assign', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    listRecycleBin(query, options = {}) {
      return api(`/api/sales-crm/accounts/recycle-bin${queryString(query)}`, options);
    },
    bulkReturn(payload, options = {}) {
      return api('/api/sales-crm/accounts/bulk-return', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    returnToPool(customerId, payload, options = {}) {
      return api(`/api/sales-crm/accounts/${encode(customerId)}/return`, {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    trash(customerId, payload, options = {}) {
      return api(`/api/sales-crm/accounts/${encode(customerId)}/trash`, {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    restore(customerId, options = {}) {
      return api(`/api/sales-crm/accounts/${encode(customerId)}/restore`, {
        ...jsonOptions('POST'),
        ...options,
      });
    },
    reassign(customerId, payload, options = {}) {
      return api(`/api/sales-crm/accounts/${encode(customerId)}/reassign`, {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    exportUrl(query = {}) {
      return `/api/sales-crm/export${queryString(query)}`;
    },
  };
}

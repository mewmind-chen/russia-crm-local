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

function customerAccount(payload, customerId) {
  const selected = String(customerId || '');
  return (payload.accounts || []).find(item =>
    String(item.external_customer_id || '') === selected || String(item.id || '') === selected);
}

function scopedRows(rows, account, customerId) {
  if (!account) return [];
  const ids = new Set([String(account.id || ''), String(account.external_customer_id || ''), String(customerId || '')]);
  return (rows || []).filter(item =>
    ids.has(String(item.customer_id || item.customerId || item.external_customer_id || '')));
}

export function createCustomerService(api) {
  const bootstrap = (sections, options = {}) =>
    api(`/api/sales-crm/bootstrap${queryString({ sections: sections.join(',') })}`, options);

  return {
    getProfile(customerId, options = {}) {
      return api(`/api/sales-crm/profile/${encode(customerId)}`, options);
    },
    async getTimeline(customerId, options = {}) {
      const payload = await bootstrap(['customers', 'today'], options);
      const account = customerAccount(payload, customerId);
      return {
        account,
        activities: scopedRows(payload.activities, account, customerId),
        timeline: scopedRows(payload.timeline, account, customerId),
        alerts: scopedRows(payload.alerts, account, customerId),
        notifications: scopedRows(payload.notifications, account, customerId),
      };
    },
    async getCommerce(customerId, options = {}) {
      const payload = await bootstrap(['customers'], options);
      const account = customerAccount(payload, customerId);
      return {
        account,
        rfqs: scopedRows(payload.rfqs, account, customerId),
        quotes: scopedRows(payload.quotes, account, customerId),
        orders: scopedRows(payload.orders, account, customerId),
      };
    },
    async getEvaluations(customerId, options = {}) {
      const payload = await bootstrap(['customers', 'intelligence'], options);
      const account = customerAccount(payload, customerId);
      return {
        account,
        evaluations: scopedRows(payload.insights?.evaluations, account, customerId),
      };
    },
    async getTags(customerId, options = {}) {
      const payload = await api(`/api/sales-crm/profile/${encode(customerId)}`, options);
      const pool = payload.customerPool?.[0] || {};
      return {
        tags: pool.tags || payload.customers?.[0]?.tags || [],
        availableTags: payload.tags || [],
        tagCategories: payload.tagCategories || [],
      };
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

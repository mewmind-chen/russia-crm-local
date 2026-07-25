function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload ?? {}) };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

export function createActivityService(api) {
  return {
    create(payload, options = {}) {
      return api('/api/sales-crm/activities', { ...jsonOptions('POST', payload), ...options });
    },
    createQuote(payload, options = {}) {
      return api('/api/sales-crm/quotes', { ...jsonOptions('POST', payload), ...options });
    },
    createOrder(payload, options = {}) {
      return api('/api/sales-crm/orders', { ...jsonOptions('POST', payload), ...options });
    },
    createContact(payload, options = {}) {
      return api('/api/sales-crm/contacts', { ...jsonOptions('POST', payload), ...options });
    },
    createEvaluation(payload, options = {}) {
      return api('/api/sales-crm/evaluations', { ...jsonOptions('POST', payload), ...options });
    },
    retryEvaluation(evaluationId, options = {}) {
      return api(`/api/sales-crm/evaluations/${encode(evaluationId)}/retry`, {
        ...jsonOptions('POST'),
        ...options,
      });
    },
    markNotificationRead(notificationId, options = {}) {
      return api(`/api/sales-crm/notifications/${encode(notificationId)}/read`, {
        ...jsonOptions('POST'),
        ...options,
      });
    },
  };
}

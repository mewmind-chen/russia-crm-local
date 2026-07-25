function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload ?? {}) };
}

export function createSessionService(api) {
  return {
    bootstrap(sections, options = {}) {
      const selected = Array.isArray(sections) ? sections.filter(Boolean) : [];
      const query = selected.length
        ? `?sections=${encodeURIComponent(selected.join(','))}`
        : '';
      return api(`/api/sales-crm/bootstrap${query}`, options);
    },
    login(credentials, options = {}) {
      return api('/api/sales-auth/login', { ...jsonOptions('POST', credentials), ...options });
    },
    logout(options = {}) {
      return api('/api/sales-auth/logout', { ...jsonOptions('POST'), ...options });
    },
    changePassword(payload, options = {}) {
      return api('/api/sales-crm/password', { ...jsonOptions('POST', payload), ...options });
    },
    startImpersonation(targetUserId, options = {}) {
      return api('/api/sales-crm/impersonation/start', {
        ...jsonOptions('POST', { targetUserId }),
        ...options,
      });
    },
    stopImpersonation(options = {}) {
      return api('/api/sales-crm/impersonation/stop', { ...jsonOptions('POST'), ...options });
    },
  };
}

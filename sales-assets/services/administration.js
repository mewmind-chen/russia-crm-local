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

export function createAdministrationService(api) {
  return {
    createUser(payload, options = {}) {
      return api('/api/sales-crm/users', { ...jsonOptions('POST', payload), ...options });
    },
    updateUser(userId, payload, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}`, {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
    archiveUser(userId, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}/archive`, {
        ...jsonOptions('POST'),
        ...options,
      });
    },
    restoreUser(userId, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}/restore`, {
        ...jsonOptions('POST'),
        ...options,
      });
    },
    deleteUser(userId, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}`, { method: 'DELETE', ...options });
    },
    resetPassword(userId, payload, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}/password-reset`, {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    createPermissionGroup(payload, options = {}) {
      return api('/api/sales-crm/permission-groups', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    updatePermissionGroup(groupId, payload, options = {}) {
      return api(`/api/sales-crm/permission-groups/${encode(groupId)}`, {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
    replacePermissionOverrides(userId, payload, options = {}) {
      return api(`/api/sales-crm/users/${encode(userId)}/permission-overrides`, {
        ...jsonOptions('PUT', payload),
        ...options,
      });
    },
    resolveMigrationReview(reviewId, payload, options = {}) {
      return api(`/api/sales-crm/migration-review/${encode(reviewId)}`, {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    maintenanceRuns(query = {}, options = {}) {
      return api(`/api/sales-crm/data-maintenance/runs${queryString(query)}`, options);
    },
    previewMaintenance(payload, options = {}) {
      return api('/api/sales-crm/data-maintenance/preview', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    executeMaintenance(payload, options = {}) {
      return api('/api/sales-crm/data-maintenance/execute', {
        ...jsonOptions('POST', payload),
        ...options,
      });
    },
    assistantRuntime(options = {}) {
      return api('/api/assistant/runtime', options);
    },
    updateAssistantRuntime(payload, options = {}) {
      return api('/api/assistant/runtime', {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
    recheckAssistantRuntime(options = {}) {
      return api('/api/assistant/runtime/recheck', {
        ...jsonOptions('POST'),
        ...options,
      });
    },
  };
}

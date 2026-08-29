'use strict';

// Safe user projection for API responses. Sensitive fields are dropped and
// hydrated permission state is attached so call sites never leak password
// or session details.

const { permissionsFor } = require('../identity');

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at || '',
    mustChangePassword: Boolean(row.must_change_password),
    languages: json(row.languages_json),
    countries: json(row.countries_json),
    channels: json(row.channels_json),
    permissions: permissionsFor(row),
    permissionGroupId: row.permission_group_id || '',
    permissionGroupName: row.permission_group_name || '',
    permissionOverrides: row.permissionOverrides || {},
    permissionOverrideCount: Object.keys(row.permissionOverrides || {}).length,
    createdAt: row.created_at,
  };
}

module.exports = Object.freeze({
  safeUser,
});
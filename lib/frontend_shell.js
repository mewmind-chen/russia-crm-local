'use strict';

const LEGACY_FRONTEND_SHELL = 'sales-crm.html';
const MODULAR_FRONTEND_SHELL = 'sales-crm-next.html';

function resolveFrontendShell(env = {}) {
  const value = String((env || {}).CRM_UX_REDESIGN_ENABLED ?? '').trim().toLowerCase();
  return value === '1' || value === 'true'
    ? MODULAR_FRONTEND_SHELL
    : LEGACY_FRONTEND_SHELL;
}

module.exports = {
  LEGACY_FRONTEND_SHELL,
  MODULAR_FRONTEND_SHELL,
  resolveFrontendShell,
};

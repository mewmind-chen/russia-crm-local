'use strict';

const path = require('node:path');

const LEGACY_ENTRYPOINTS = Object.freeze([
  Object.freeze({ route: '/legacy', file: 'Index.html' }),
  Object.freeze({ route: '/tradelead-v2.html', file: 'tradelead-v2.html' }),
]);

function legacyEntrypointsEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

/**
 * Register the opt-in legacy HTML aliases without coupling the server factory
 * to the legacy file layout. The canonical `/` route remains owned by
 * server.js; this module only preserves the two explicit compatibility paths.
 */
function registerLegacyEntrypoints(app, { enabled = process.env.CRM_ENABLE_LEGACY, rootDir } = {}) {
  if (!app || !legacyEntrypointsEnabled(enabled)) return app;
  const resolvedRoot = path.resolve(rootDir || path.join(__dirname, '..'));
  LEGACY_ENTRYPOINTS.forEach(({ route, file }) => {
    app.get(route, (_req, res) => res.sendFile(path.join(resolvedRoot, file)));
  });
  return app;
}

module.exports = {
  LEGACY_ENTRYPOINTS,
  legacyEntrypointsEnabled,
  registerLegacyEntrypoints,
};

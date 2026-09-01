'use strict';

const path = require('node:path');

function resolvedRoot(rootDir) {
  return path.resolve(rootDir || path.join(__dirname, '..'));
}

/**
 * Register the authenticated profile-only browser assets. The asset handlers
 * stay separate from the workbench handler so server registration order and
 * the legacy compatibility boundary remain explicit.
 */
function registerProfileAssets(app, { rootDir, requireUnifiedUser } = {}) {
  if (!app || typeof requireUnifiedUser !== 'function') return app;
  const root = resolvedRoot(rootDir);
  app.get('/profile-contacts.js', requireUnifiedUser, (_req, res) => {
    res.type('application/javascript').sendFile(path.join(root, 'profile-contacts.js'));
  });
  app.get('/profile-insights.js', requireUnifiedUser, (_req, res) => {
    res.type('application/javascript').sendFile(path.join(root, 'profile-insights.js'));
  });
  return app;
}

/**
 * Register the read-only/legacy workbench entry point. Permission selection,
 * error text, frame policy and file mapping intentionally match server.js.
 */
function registerDevelopmentWorkbench(app, {
  rootDir,
  requireUnifiedUser,
  hasPermission,
} = {}) {
  if (!app || typeof requireUnifiedUser !== 'function' || typeof hasPermission !== 'function') return app;
  const root = resolvedRoot(rootDir);
  app.get('/development-workbench', requireUnifiedUser, (req, res) => {
    const profileMode = String(req.query.profile || '') === '1';
    const intakeProfileMode = profileMode && Boolean(String(req.query.intake || '').trim());
    const permission = profileMode ? (intakeProfileMode ? 'view_intake' : 'view_customers') : 'view_development';
    if (!hasPermission(req.salesUser, permission)) {
      const message = intakeProfileMode
        ? '当前账号没有线索主档权限'
        : profileMode ? '当前账号没有客户资料权限' : '当前账号没有客户开发工作台权限';
      return res.status(403).send(message);
    }
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    return res.sendFile(path.join(root, 'Index.html'));
  });
  return app;
}

module.exports = {
  registerProfileAssets,
  registerDevelopmentWorkbench,
};

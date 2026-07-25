function enabled(collection, key) {
  if (!key) return true;
  if (collection instanceof Set) return collection.has(key);
  if (Array.isArray(collection)) return collection.includes(key);
  return Boolean(collection?.[key]);
}

export function hasAllPermissions(required = [], permissions = {}) {
  return required.every(permission => enabled(permissions, permission));
}

export function hasAllFeatureFlags(required = [], featureFlags = {}) {
  return required.every(flag => enabled(featureFlags, flag));
}

export function canAccessPage(page, {
  role = '',
  permissions = {},
  featureFlags = {},
  impersonating = false,
} = {}) {
  if (!page) return false;
  if (page.roles?.length && !page.roles.includes(role)) return false;
  if (!hasAllPermissions(page.permissions, permissions)) return false;
  if (!hasAllFeatureFlags(page.featureFlags, featureFlags)) return false;
  if (impersonating && page.blockedWhileImpersonating) return false;
  return true;
}

export function visiblePages(context = {}, registry = []) {
  return registry.filter(page => {
    if (!page.nav || page.nav.hidden) return false;
    if (page.nav.roles?.length && !page.nav.roles.includes(context.role)) return false;
    return canAccessPage(page, context);
  });
}

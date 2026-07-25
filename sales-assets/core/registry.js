import { canAccessPage, visiblePages as filterVisiblePages } from './access.js';

const ALL_ROLES = Object.freeze(['admin', 'manager', 'sales']);
const LEADERS = Object.freeze(['admin', 'manager']);

function page(id, {
  routes = [id],
  roles = ALL_ROLES,
  permissions = [],
  featureFlags = [],
  nav = false,
  module = `../modules/${id}/index.js`,
  shellView = id,
  blockedWhileImpersonating = false,
} = {}) {
  return Object.freeze({
    id,
    routes: Object.freeze([...routes]),
    roles: Object.freeze([...roles]),
    permissions: Object.freeze([...permissions]),
    featureFlags: Object.freeze([...featureFlags]),
    nav: nav && Object.freeze({ ...nav, roles: Object.freeze([...(nav.roles || roles)]) }),
    module,
    shellView,
    blockedWhileImpersonating,
  });
}

export const PAGE_REGISTRY = Object.freeze([
  page('my-today', {
    permissions: ['view_dashboard'],
    nav: { label: '我的今日', group: 'sales', roles: ['sales'], order: 10 },
    shellView: 'dashboard',
  }),
  page('customers', {
    permissions: ['view_customers'],
    nav: { label: '我的客户', group: 'customers', roles: ALL_ROLES, order: 20 },
    shellView: 'customers',
  }),
  page('intake', {
    permissions: ['view_intake'],
    nav: { label: '我的线索', group: 'intake', roles: ALL_ROLES, order: 30 },
    shellView: 'intake',
  }),
  page('assistant', {
    permissions: ['use_ai_assistant'],
    nav: { label: 'AI 助手', group: 'assistant', roles: ['sales'], order: 40 },
    shellView: 'dashboard',
  }),
  page('team-dashboard', {
    roles: LEADERS,
    permissions: ['view_dashboard'],
    nav: { label: '经营驾驶舱', group: 'management', roles: LEADERS, order: 10 },
    shellView: 'dashboard',
  }),
  page('team-tasks', {
    roles: LEADERS,
    permissions: ['view_alerts'],
    nav: { label: '今日待办', group: 'management', roles: LEADERS, order: 20 },
    shellView: 'alerts',
  }),
  page('team-insights', {
    roles: LEADERS,
    permissions: ['view_team', 'view_insights', 'view_markets'],
    nav: { label: '团队洞察', group: 'management', roles: LEADERS, order: 50 },
    shellView: 'team',
  }),
  page('intelligence', {
    roles: LEADERS,
    permissions: ['view_pool', 'view_contacts', 'view_recon'],
    nav: { label: '情报中心', group: 'management', roles: LEADERS, order: 60 },
    shellView: 'pool',
  }),
  page('customer-detail', {
    permissions: ['view_customers'],
    shellView: 'customerProfile',
  }),
  page('ai-control', {
    roles: LEADERS,
    permissions: ['view_customers'],
    featureFlags: ['aiStations'],
    shellView: 'aiTasks',
  }),
  page('administration', {
    roles: ['admin'],
    permissions: ['view_users', 'manage_users'],
    nav: { label: '系统管理', group: 'administration', roles: ['admin'], order: 70 },
    shellView: 'users',
    blockedWhileImpersonating: true,
  }),
]);

export const LEGACY_ROUTE_ALIASES = Object.freeze({
  dashboard: 'team-dashboard',
  alerts: 'team-tasks',
  notifications: 'my-today',
  pending: 'intake',
  claimed: 'intake',
  pipeline: 'customers',
  team: 'team-insights',
  insights: 'team-insights',
  markets: 'team-insights',
  pool: 'intelligence',
  contacts: 'intelligence',
  recon: 'intelligence',
  customerProfile: 'customer-detail',
  aiTasks: 'ai-control',
  users: 'administration',
  recycleBin: 'administration',
  maintenance: 'administration',
});

export const LEGACY_ROUTE_PERMISSIONS = Object.freeze({
  dashboard: ['view_dashboard'],
  alerts: ['view_alerts'],
  notifications: ['view_customers'],
  pending: ['view_intake'],
  claimed: ['view_intake'],
  pipeline: ['view_pipeline'],
  team: ['view_team'],
  insights: ['view_insights'],
  markets: ['view_markets'],
  pool: ['view_pool'],
  contacts: ['view_contacts'],
  recon: ['view_recon'],
  customerProfile: ['view_customers'],
  aiTasks: ['view_customers'],
  users: ['view_users'],
  recycleBin: ['manage_customer_recycle'],
  maintenance: ['manage_data_maintenance'],
});

const registryById = new Map(PAGE_REGISTRY.map(item => [item.id, item]));
const registryByRoute = new Map(
  PAGE_REGISTRY.flatMap(item => item.routes.map(route => [route, item])),
);

export function pageById(id) {
  return registryById.get(id) || null;
}

export function pageByRoute(route) {
  const canonicalId = LEGACY_ROUTE_ALIASES[route] || route;
  return registryByRoute.get(canonicalId) || registryById.get(canonicalId) || null;
}

export function routePermissions(route, page = pageByRoute(route)) {
  return LEGACY_ROUTE_PERMISSIONS[route] || page?.permissions || [];
}

export function canAccessRoute(route, context = {}) {
  const target = pageByRoute(route);
  if (!target) return false;
  const isLegacyRoute = Object.hasOwn(LEGACY_ROUTE_ALIASES, route);
  return canAccessPage({
    ...target,
    roles: isLegacyRoute ? [] : target.roles,
    permissions: routePermissions(route, target),
  }, context);
}

export function visiblePages(context = {}) {
  return filterVisiblePages(context, PAGE_REGISTRY)
    .sort((left, right) => (left.nav.order || 0) - (right.nav.order || 0));
}

export function defaultPageId(role) {
  return role === 'sales' ? 'my-today' : 'team-dashboard';
}

export function accessibleDefaultPage(context = {}) {
  const preferred = pageById(defaultPageId(context.role));
  if (canAccessPage(preferred, context)) return preferred;
  return visiblePages(context)[0] || PAGE_REGISTRY.find(item => canAccessPage(item, context)) || null;
}

import { canAccessRoute, accessibleDefaultPage, pageByRoute } from './registry.js';

function asUrl(value, base = 'http://localhost/') {
  if (value instanceof URL) return new URL(value.href);
  if (typeof value === 'string') return new URL(value, base);
  if (value?.href) return new URL(value.href, base);
  const pathname = value?.pathname || '/';
  const search = value?.search || '';
  const hash = value?.hash || '';
  return new URL(`${pathname}${search}${hash}`, base);
}

function normalizedHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch (_error) {
    return '';
  }
  return value.split(/[?&]/, 1)[0].replace(/^\/+|\/+$/g, '');
}

export function resolveRoute(value, { base } = {}) {
  const url = asUrl(value, base);
  const requestedRoute = normalizedHash(url.hash);
  const page = pageByRoute(requestedRoute);
  const customerId = url.searchParams.get('customer') || '';
  const from = url.searchParams.get('from') || '';
  const tab = url.searchParams.get('tab') || '';
  return {
    url,
    requestedRoute,
    route: page?.id || '',
    pageId: page?.id || '',
    page,
    viewId: requestedRoute || page?.shellView || '',
    shellView: requestedRoute && requestedRoute !== page?.id
      ? requestedRoute
      : page?.shellView || '',
    customerId,
    from,
    tab,
    isLegacy: Boolean(page && requestedRoute !== page.id),
    found: Boolean(page),
  };
}

function routeHref(location) {
  return `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
}

export function createRouter({
  window: browserWindow = globalThis.window,
  getAccessContext = () => ({}),
  onRoute = () => {},
  onForbidden = () => {},
  onUnknown = () => {},
} = {}) {
  if (!browserWindow?.location || !browserWindow?.history) {
    throw new TypeError('createRouter requires a window-like object');
  }

  let started = false;
  let lastHref = '';

  function context() {
    return getAccessContext() || {};
  }

  function write(pageId, {
    replace = true,
    customerId = '',
    requestedRoute = pageId,
    from = '',
    tab = '',
  } = {}) {
    const url = asUrl(browserWindow.location);
    if (pageId === 'customer-detail') {
      if (customerId) url.searchParams.set('customer', customerId);
      if (from) url.searchParams.set('from', from);
      if (tab) url.searchParams.set('tab', tab);
    } else {
      url.searchParams.delete('customer');
      url.searchParams.delete('from');
      url.searchParams.delete('tab');
    }
    url.hash = requestedRoute;
    const nextHref = `${url.pathname}${url.search}${url.hash}`;
    browserWindow.history[replace ? 'replaceState' : 'pushState'](null, '', nextHref);
    lastHref = '';
    return nextHref;
  }

  function fallback(reason, rejected) {
    const target = accessibleDefaultPage(context());
    if (!target) return null;
    write(target.id, { replace: true });
    const resolved = resolveRoute(browserWindow.location);
    lastHref = routeHref(browserWindow.location);
    onRoute({ ...resolved, reason, redirectedFrom: rejected.requestedRoute });
    return resolved;
  }

  function refresh({ force = false, source = 'refresh' } = {}) {
    const href = routeHref(browserWindow.location);
    if (!force && href === lastHref) return null;
    const resolved = resolveRoute(browserWindow.location);
    lastHref = href;

    if (!resolved.found) {
      onUnknown(resolved);
      return fallback('unknown', resolved);
    }
    if (!canAccessRoute(resolved.requestedRoute, context())) {
      onForbidden(resolved);
      return fallback('forbidden', resolved);
    }
    if (resolved.requestedRoute === 'customerProfile') {
      write(resolved.pageId, {
        replace: true,
        customerId: resolved.customerId,
        from: resolved.from,
        tab: resolved.tab,
        requestedRoute: resolved.pageId,
      });
      const canonical = resolveRoute(browserWindow.location);
      lastHref = routeHref(browserWindow.location);
      onRoute({
        ...canonical,
        isLegacy: true,
        legacyRoute: resolved.requestedRoute,
        source,
      });
      return canonical;
    }
    onRoute({ ...resolved, source });
    return resolved;
  }

  function navigate(route, {
    replace = false,
    customerId = '',
    from = '',
    tab = '',
  } = {}) {
    const requested = String(route || '').replace(/^#\/?/, '');
    const resolved = resolveRoute(`#${requested}`, { base: browserWindow.location.href });
    if (!resolved.found) {
      onUnknown(resolved);
      return fallback('unknown', resolved);
    }
    if (!canAccessRoute(requested, context())) {
      onForbidden(resolved);
      return fallback('forbidden', resolved);
    }
    write(resolved.pageId, {
      replace,
      customerId,
      from,
      tab,
      requestedRoute: requested,
    });
    return refresh({ force: true, source: 'navigate' });
  }

  const historyHandler = event => refresh({ source: event.type });

  function start({ refresh: shouldRefresh = true } = {}) {
    if (!started) {
      browserWindow.addEventListener('hashchange', historyHandler);
      browserWindow.addEventListener('popstate', historyHandler);
      started = true;
    }
    return shouldRefresh ? refresh({ force: true, source: 'start' }) : null;
  }

  function dispose() {
    if (!started) return;
    browserWindow.removeEventListener('hashchange', historyHandler);
    browserWindow.removeEventListener('popstate', historyHandler);
    started = false;
    lastHref = '';
  }

  return {
    start,
    dispose,
    refresh,
    navigate,
    resolve: value => resolveRoute(value, { base: browserWindow.location.href }),
    get started() {
      return started;
    },
  };
}

import { createApiClient } from './core/api.js';
import { createLifecycleScope } from './core/lifecycle.js';
import { loadLayoutPreference, saveLayoutPreference } from './core/preferences.js';
import { createRouter } from './core/router.js';
import { accessibleDefaultPage } from './core/registry.js';
import { createStore } from './core/state.js';
import { mountShell } from './components/shell.js';
import { renderEmptyState } from './components/empty-state.js';
import { createActivityService } from './services/activities.js';
import { createAdministrationService } from './services/administration.js';
import { createAIService } from './services/ai.js';
import { createCustomerService } from './services/customers.js';
import { createIntakeService } from './services/intake.js';
import { createIntelligenceService } from './services/intelligence.js';
import { createSessionService } from './services/session.js';

const lifecycle = createLifecycleScope();
const store = createStore({ session: null, route: null, module: null });
const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const loginStatus = document.getElementById('loginStatus');
const loginError = document.getElementById('loginError');
const appMount = document.getElementById('appMount');

function showLogin() {
  store.setSection('session', null);
  activeModule?.dispose?.();
  activeModule = null;
  workspaceScope?.dispose();
  workspaceScope = null;
  router.dispose();
  shell?.dispose();
  shell = null;
  loginScreen.hidden = false;
  appMount.hidden = true;
}

const api = createApiClient({ onUnauthorized: showLogin });
const services = Object.freeze({
  session: createSessionService(api),
  customers: createCustomerService(api),
  intake: createIntakeService(api),
  activities: createActivityService(api),
  intelligence: createIntelligenceService(api),
  ai: createAIService(api),
  administration: createAdministrationService(api),
});

function accessContext() {
  const session = store.state.session || {};
  const user = session.user || {};
  return {
    role: user.role || '',
    permissions: user.permissions || {},
    featureFlags: {
      aiStations: Boolean(session.features?.aiStations),
    },
    impersonating: Boolean(session.impersonation),
  };
}

let shell = null;
let activeModule = null;
let workspaceScope = null;
let routeVersion = 0;
let layoutPreference = null;

async function renderRoute(route) {
  const version = ++routeVersion;
  activeModule?.dispose?.();
  activeModule = null;
  store.setSection('route', route);
  const mount = shell?.pageMount;
  if (!mount || !route.page) return;
  mount.setAttribute('aria-busy', 'true');
  try {
    const moduleUrl = new URL(route.page.module, new URL('./core/', import.meta.url));
    const module = await import(moduleUrl);
    if (version !== routeVersion) return;
    const moduleScope = createLifecycleScope();
    const context = {
      route,
      store,
      services,
      lifecycle: moduleScope,
      access: accessContext(),
      mount,
    };
    context.onRefresh = data => {
      if (version !== routeVersion || moduleScope.disposed || typeof module.render !== 'function') return;
      void module.render({ ...context, data });
    };
    context.onRefreshError = error => {
      if (version !== routeVersion || moduleScope.disposed) return;
      mount.innerHTML = renderEmptyState({
        title: route.page.nav?.label || '页面刷新失败',
        description: error?.message || '无法读取最新数据，请稍后重试。',
      });
    };
    activeModule = {
      dispose() {
        module.dispose?.(context);
        moduleScope.dispose();
      },
    };
    const loaded = typeof module.load === 'function' ? await module.load(context) : null;
    if (version !== routeVersion || moduleScope.disposed) return;
    if (typeof module.render === 'function') await module.render({ ...context, data: loaded });
    else mount.innerHTML = renderEmptyState({
      title: route.page.nav?.label || '页面准备中',
      description: '该业务模块将在后续迁移任务中接入。',
    });
  } catch (error) {
    if (version !== routeVersion) return;
    mount.innerHTML = renderEmptyState({
      title: route.page.nav?.label || '页面准备中',
      description: error?.code === 'ERR_MODULE_NOT_FOUND'
        ? '该业务模块将在后续迁移任务中接入。'
        : '页面加载失败，请刷新后重试。',
    });
  } finally {
    if (version !== routeVersion || !shell) return;
    shell.root.querySelectorAll('[data-page-id]').forEach(link => {
      if (link.dataset.pageId === route.pageId) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const title = shell.root.querySelector('[data-page-title]');
    if (title) title.textContent = route.page.nav?.label || '工作台';
    mount.removeAttribute('aria-busy');
    mount.focus();
  }
}

const router = createRouter({
  getAccessContext: accessContext,
  onRoute: route => void renderRoute(route),
});

function mountWorkspace(session) {
  store.setSection('session', session);
  layoutPreference = loadLayoutPreference(session.user?.id, accessContext());
  loginScreen.hidden = true;
  appMount.hidden = false;
  workspaceScope?.dispose();
  workspaceScope = createLifecycleScope();
  shell?.dispose();
  shell = mountShell(appMount, {
    context: accessContext(),
    activePageId: location.hash.replace(/^#/, ''),
    user: session.user,
    preference: layoutPreference,
  });
  workspaceScope.listen(shell.root, 'click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') {
      void services.session.logout().finally(showLogin);
    } else if (action === 'menu') {
      shell.root.classList.toggle('navigation-open');
    } else if (action === 'toggle-nav-group') {
      const button = event.target.closest('[data-nav-group-id]');
      const group = button?.dataset.navGroupId;
      if (!group) return;
      const collapsed = new Set(layoutPreference?.collapsedGroups || []);
      if (collapsed.has(group)) collapsed.delete(group);
      else collapsed.add(group);
      layoutPreference = saveLayoutPreference(session.user?.id, {
        ...layoutPreference,
        collapsedGroups: [...collapsed],
      }, accessContext());
      const section = shell.root.querySelector(`[data-nav-group="${CSS.escape(group)}"]`);
      const links = section?.querySelector('.modular-nav-links');
      const expanded = !collapsed.has(group);
      if (links) links.hidden = !expanded;
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}${section?.querySelector('h2')?.textContent || '导航分组'}`);
      button.innerHTML = expanded ? '&#8722;' : '+';
    }
    if (event.target.closest('[data-page-id]')) shell.root.classList.remove('navigation-open');
  });
  if (!location.hash) {
    const target = layoutPreference?.defaultPageId || accessibleDefaultPage(accessContext())?.id;
    if (target) location.hash = target;
  }
  router.start();
}

async function bootstrap() {
  try {
    const session = await services.session.bootstrap(['core'], { timeoutMs: 15000 });
    mountWorkspace(session);
  } catch (error) {
    if (error.status !== 401) loginError.textContent = error.message || '工作台加载失败';
    showLogin();
  }
}

lifecycle.listen(loginForm, 'submit', async event => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  loginStatus.textContent = '正在验证账号…';
  loginError.textContent = '';
  try {
    await services.session.login(Object.fromEntries(new FormData(loginForm)), { timeoutMs: 10000 });
    const session = await services.session.bootstrap(['core'], { timeoutMs: 15000 });
    mountWorkspace(session);
  } catch (error) {
    loginError.textContent = error.message || '登录失败';
  } finally {
    button.disabled = false;
    loginStatus.textContent = '';
  }
});

lifecycle.addCleanup(() => {
  activeModule?.dispose?.();
  workspaceScope?.dispose();
  router.dispose();
  shell?.dispose();
});

void bootstrap();

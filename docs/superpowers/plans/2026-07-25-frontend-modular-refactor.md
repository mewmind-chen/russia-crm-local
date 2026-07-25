# TradePulse Frontend Modular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before every commit, PR, and completion claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic CRM frontend with a role-based modular frontend that preserves every published capability and presents AI as an evidence-backed, human-confirmed business decision flow.

**Architecture:** Keep Node.js, Express, SQLite, existing APIs, workers, permissions, audit, idempotency, AI Router, and business rules. Add browser-native ES modules under `sales-assets/`, retain the old shell behind `CRM_UX_REDESIGN_ENABLED` during migration, and move one business workflow at a time into registered modules that share core, service, and component contracts.

**Tech Stack:** Node.js 18+, CommonJS server, Express 4, better-sqlite3/WAL, browser-native ES modules, HTML/CSS, Node test runner, Playwright browser tests.

**Approved design:** `docs/superpowers/specs/2026-07-25-frontend-modular-refactor-design.md`

**Implementation baseline:** `origin/main @ 79800f529d1d98e8a936959d88cbbbebce6f559f`

## Global Constraints

- Preserve the union of all non-retired `origin/main` capabilities, production-enabled capabilities, supported deep links, APIs, permissions, feature flags, workers, reports, and maintenance entry points.
- Do not introduce React, Vue, a frontend bundler, or a second business data model.
- Do not replace existing server authorization, row scope, idempotency, audit, AI Router, Worker, budget, or fallback behavior.
- New critical writes remain pessimistic: update UI only after the authoritative server response.
- Every module implements `load(context)`, `render(context)`, and `dispose(context)`.
- Every timer, request, subscription, and temporary listener is owned by a lifecycle scope and released on route change.
- No AI generation action may silently mutate customer state, assignment, stage, activity, or outbound communication.
- AI governance is administrator-only; managers retain only permission-scoped result review and fault inspection.
- Historical AI tasks with no authoritative trigger are labeled `legacy_unknown`; the UI must not infer provenance.
- Sales coaching uses the existing thresholds: `<10` observed customers is insufficient, `10-29` is limited, and `>=30` is sufficient.
- Desktop widths `1440` and `1280`, plus mobile width `390`, are release-gate viewports.
- `CRM_UX_REDESIGN_ENABLED` controls only the shell. It must not enable, disable, or alter a business capability.
- Each task is one reviewable commit. Do not start the next task until focused tests and the task's regression set pass.
- Start execution in an isolated worktree created with `superpowers:using-git-worktrees`; preserve unrelated user changes if any are encountered.
- Do not deploy production before Task 14.

## Target File Map

```text
sales-assets/
├── package.json                  # ES-module boundary for browser code
├── app.js                        # final bootstrap only
├── modular-app.js                # temporary new bootstrap during rollout
├── app.css
├── core/
│   ├── api.js                    # fetch, timeout, typed HTTP errors
│   ├── state.js                  # partitioned observable state
│   ├── router.js                 # hash/deep-link resolution
│   ├── access.js                 # client visibility from server capabilities
│   ├── registry.js               # pages, roles, permissions, aliases
│   ├── preferences.js            # per-user layout preference validation
│   └── lifecycle.js              # timers, aborts, listeners, disposal
├── components/
│   ├── html.js                   # escaping and safe display helpers
│   ├── modal.js
│   ├── drawer.js
│   ├── table.js
│   ├── empty-state.js
│   ├── status.js
│   ├── shell.js
│   └── ai-result.js
├── services/
│   ├── session.js
│   ├── customers.js
│   ├── intake.js
│   ├── activities.js
│   ├── intelligence.js
│   ├── ai.js
│   └── administration.js
└── modules/
    ├── my-today/
    ├── customers/
    ├── intake/
    ├── customer-detail/
    ├── team-dashboard/
    ├── team-tasks/
    ├── team-insights/
    ├── intelligence/
    ├── assistant/
    ├── ai-control/
    └── administration/
```

Server additions stay focused:

```text
lib/frontend_shell.js             # temporary old/new shell resolver
lib/ai_stations/presentation.js   # business-facing AI result contract
lib/ai_stations/schema.js         # trigger provenance columns
lib/ai_stations/jobs.js           # mandatory trigger contract
lib/access_control.js             # governance/task-center role boundary
server.js                         # selected shell only
```

---

## Task 1: Freeze the Feature-Parity Baseline

**Files:**

- Create: `docs/refactor/frontend-capability-manifest.json`
- Create: `scripts/audit-frontend-parity.js`
- Create: `test/frontend_parity_manifest.test.js`
- Modify: `package.json`

**Interfaces:**

- `loadManifest(path): FrontendCapabilityManifest`
- `auditManifest({ manifest, html, appSource, routePolicies }): AuditResult`
- CLI: `node scripts/audit-frontend-parity.js [--json]`

- [ ] **Step 1: Write the failing manifest contract test**

Require these fields for every capability:

```js
{
  id: 'customer.next_action',
  category: 'ai',
  legacyRoutes: ['customerProfile'],
  targetModule: 'customer-detail',
  roles: ['admin', 'manager', 'sales'],
  permissions: ['view_customers'],
  featureFlags: ['ai_stations'],
  apiPolicies: [
    'GET /ai/customers/:customerId/results',
    'POST /ai/jobs/:jobId/next-action/adopt'
  ],
  tests: ['test/ai_next_action.test.js'],
  rollout: 'mapped'
}
```

The test must assert:

- Every visible legacy `data-view` has a manifest owner.
- Every key in `SALES_ROUTE_POLICIES` is covered exactly once or explicitly marked `non_frontend`.
- The manifest contains all categories listed in design section 3.
- No item has an empty target module, permission decision, test decision, or rollout state.
- No item uses `deleted`, `later`, or `unknown` as a rollout value.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_parity_manifest.test.js
```

Expected: FAIL because the manifest and audit script do not exist.

- [ ] **Step 3: Implement the manifest and audit CLI**

Use JSON as the source of truth and populate it with the full current capability union:

- identity/session;
- role and permission administration;
- dashboard, alerts, notifications;
- intake statuses and assignment operations;
- customers, pipeline, recycling, timeline, tags, evaluations;
- RFQ, BOM, quote, order;
- pool, people, Recon, reports;
- assistant conversations and engine state;
- all eight AI stations, action proposal, enrichment;
- task center, budget, feedback, governance, feature flags;
- data maintenance, health, deployment, backup, Workers.

The CLI exits `1` and prints capability IDs when coverage is missing. Add:

```json
{
  "scripts": {
    "frontend:parity": "node scripts/audit-frontend-parity.js"
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm run frontend:parity
node --test test/frontend_parity_manifest.test.js test/access_control.test.js test/sales_menu.test.js
```

Expected: audit reports zero unmapped views, policies, or capability records; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/refactor/frontend-capability-manifest.json scripts/audit-frontend-parity.js test/frontend_parity_manifest.test.js package.json
git commit -m "test(frontend): freeze capability parity baseline"
```

## Task 2: Add the Browser Core Runtime

**Files:**

- Create: `sales-assets/package.json`
- Create: `sales-assets/core/api.js`
- Create: `sales-assets/core/state.js`
- Create: `sales-assets/core/lifecycle.js`
- Modify: `sales-assets/app.js`
- Modify: `sales-crm.html`
- Create: `test/frontend_core_modules.test.js`

**Interfaces:**

- `createApiClient({ fetchImpl, defaultTimeoutMs, onUnauthorized })`
- `createStore(initialState)`
- `createLifecycleScope()`

- [ ] **Step 1: Write failing unit tests**

Test the exact contracts:

```js
const api = createApiClient({ fetchImpl, defaultTimeoutMs: 50, onUnauthorized });
await api.request('/api/example', { method: 'POST', body: { value: 1 } });

const store = createStore({ session: null, route: null, domains: {} });
const unsubscribe = store.subscribe('route', value => observed.push(value));
store.update('route', () => ({ id: 'customers' }));

const scope = createLifecycleScope();
scope.listen(target, 'change', listener);
scope.setTimeout(callback, 100);
scope.dispose();
```

Assert JSON serialization, 401 callback, timeout abort, structured `HttpError`, partition-only notifications, unsubscribe, timer cancellation, abort cancellation, and idempotent disposal.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_core_modules.test.js
```

Expected: FAIL because `sales-assets/core/*` and the ES-module boundary do not exist.

- [ ] **Step 3: Implement core modules and consume them from the existing app**

Create `sales-assets/package.json`:

```json
{ "type": "module" }
```

Convert the existing script tag to `type="module"`. Import the new API client and lifecycle helper at the top of `app.js`; keep all current rendering and routes unchanged. Replace only the existing fetch/timeout implementation and top-level long-lived timer cleanup in this task.

`HttpError` must expose:

```js
{ name: 'HttpError', status, code, details, message }
```

Do not move business renderers yet.

- [ ] **Step 4: Verify GREEN and unchanged UI contract**

Run:

```bash
node --test test/frontend_core_modules.test.js test/sales_menu.test.js test/ai_station_ui.test.js test/sales_access_ui.test.js
node --check sales-assets/app.js
```

Expected: all tests pass and the current HTML still points to one functional module entry.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/package.json sales-assets/core/api.js sales-assets/core/state.js sales-assets/core/lifecycle.js sales-assets/app.js sales-crm.html test/frontend_core_modules.test.js
git commit -m "refactor(frontend): add shared browser runtime"
```

## Task 3: Register Routes, Roles, Permissions, and Legacy Aliases

**Files:**

- Create: `sales-assets/core/access.js`
- Create: `sales-assets/core/registry.js`
- Create: `sales-assets/core/router.js`
- Modify: `sales-assets/app.js`
- Create: `test/frontend_router_registry.test.js`

**Interfaces:**

- `PAGE_REGISTRY: readonly PageDefinition[]`
- `LEGACY_ROUTE_ALIASES: Readonly<Record<string, RouteTarget>>`
- `visiblePages({ role, permissions, featureFlags, impersonating })`
- `createRouter({ registry, aliases, location, history, onRoute })`
- `resolveRoute(url): { pageId, params, canonicalHash }`

- [ ] **Step 1: Write failing registry and router tests**

Define role defaults:

```js
{ admin: 'team-dashboard', manager: 'team-dashboard', sales: 'my-today' }
```

Assert:

- Sales primary pages are `my-today`, `customers`, `intake`, `assistant`.
- Manager primary pages are `team-dashboard`, `team-tasks`, `intake`, `team-customers`, `team-insights`, `intelligence`.
- Administrator adds `administration` and `ai-control`.
- `pending`, `claimed`, `pipeline`, `team`, `insights`, `markets`, `pool`, `contacts`, `recon`, and `customerProfile` resolve to canonical targets.
- `?customer=RU-9001#customerProfile` resolves to `customer-detail` with the customer ID intact.
- Unknown and forbidden routes fail closed to the role default.
- Back, forward, refresh, and direct hash input emit one canonical route without duplicate callbacks.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_router_registry.test.js
```

Expected: FAIL because the registry, access helper, and router do not exist.

- [ ] **Step 3: Implement registry and router**

Each page definition uses:

```js
{
  id: 'my-today',
  routes: ['my-today'],
  roles: ['sales'],
  permissions: ['view_customers', 'view_intake'],
  featureFlags: [],
  nav: { group: 'work', label: '我的今日', order: 10 },
  module: () => import('../modules/my-today/index.js')
}
```

Permission arrays are all-of requirements unless a page explicitly declares `permissionMode: 'any'`. The router owns `hashchange` and `popstate`; remove duplicate route listeners from `app.js`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_router_registry.test.js test/sales_menu.test.js test/sales_access_ui.test.js
```

Expected: all route, role, permission, and legacy deep-link tests pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/core/access.js sales-assets/core/registry.js sales-assets/core/router.js sales-assets/app.js test/frontend_router_registry.test.js
git commit -m "refactor(frontend): centralize routes and access"
```

## Task 4: Extract the API Service Layer

**Files:**

- Create: `sales-assets/services/session.js`
- Create: `sales-assets/services/customers.js`
- Create: `sales-assets/services/intake.js`
- Create: `sales-assets/services/activities.js`
- Create: `sales-assets/services/intelligence.js`
- Create: `sales-assets/services/ai.js`
- Create: `sales-assets/services/administration.js`
- Modify: `lib/sales_crm.js`
- Modify: `sales-assets/app.js`
- Create: `test/frontend_services.test.js`
- Create: `test/frontend_scoped_bootstrap.test.js`

**Interfaces:**

- `createSessionService(api)`
- `createCustomerService(api)`
- `createIntakeService(api)`
- `createActivityService(api)`
- `createIntelligenceService(api)`
- `createAIService(api)`
- `createAdministrationService(api)`
- `GET /api/sales-crm/bootstrap?sections=<comma-separated allowlist>`

- [ ] **Step 1: Write failing request-contract tests**

Use a recording API fake and assert exact method, path, and body for:

- bootstrap, login, logout, password change;
- customer create/edit/export/recycle/restore/reassign;
- intake list/scan/action/settings;
- activity, RFQ, quote, order, notification read;
- pool, people, Recon, report;
- customer AI results, enrichment, run, retry, cancel, review, adoption;
- task center, budgets, governance, runtime, flags;
- users, permission groups, impersonation, maintenance.

Also assert scoped bootstrap behavior:

- No `sections` query preserves the complete legacy payload.
- `sections=core` returns only session user, permissions, feature flags, shared dictionaries, counts, and generated time.
- Allowed domain sections are `today`, `customers`, `intake`, `team`, `intelligence`, and `administration`.
- Each domain section applies the same server authorization and row scope as the legacy full payload.
- Unknown sections return 400.
- The new shell never requests the unscoped legacy payload.

Example:

```js
await customers.update('CRM-1', { stage: 'qualified' });
assert.deepEqual(calls[0], {
  path: '/api/sales-crm/accounts/CRM-1',
  options: { method: 'PATCH', body: { stage: 'qualified' } }
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_services.test.js
```

Expected: FAIL because service factories and scoped bootstrap projections do not exist.

- [ ] **Step 3: Implement services and replace direct API calls**

Services return server payloads without duplicating business rules. They may normalize URL parameters and request bodies, but must not:

- infer permissions;
- mutate shared state;
- reinterpret a server validation failure;
- manufacture AI provenance or confidence;
- perform optimistic critical writes.

Migrate direct `api(...)` calls from `app.js` to the correct service while preserving current behavior.

Split the existing bootstrap builder into section loaders without changing its default response:

```js
getBootstrap(db, actor, { sections: ['core', 'customers'] })
```

The legacy shell calls the route without `sections`. The modular bootstrap loads only `core`; each page
service requests its domain section on first entry. Section loaders must query only the data needed by that
section rather than building the full payload and deleting keys afterward.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_services.test.js test/frontend_scoped_bootstrap.test.js test/permission_integration.test.js test/ai_station_api.test.js test/ai_customer_enrichment_api.test.js
node --check sales-assets/app.js
```

Expected: all request contracts and affected API tests pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/services lib/sales_crm.js sales-assets/app.js test/frontend_services.test.js test/frontend_scoped_bootstrap.test.js
git commit -m "refactor(frontend): extract API services"
```

## Task 5: Add Shared Components and the Reversible New Shell

**Files:**

- Create: `lib/frontend_shell.js`
- Modify: `server.js`
- Create: `sales-crm-next.html`
- Create: `sales-assets/modular-app.js`
- Create: `sales-assets/components/html.js`
- Create: `sales-assets/components/modal.js`
- Create: `sales-assets/components/drawer.js`
- Create: `sales-assets/components/table.js`
- Create: `sales-assets/components/empty-state.js`
- Create: `sales-assets/components/status.js`
- Create: `sales-assets/components/shell.js`
- Modify: `sales-assets/app.css`
- Create: `test/frontend_shell.test.js`
- Create: `test/frontend_components.test.js`

**Interfaces:**

- `resolveFrontendShell(env): 'sales-crm.html' | 'sales-crm-next.html'`
- `createModal(root)`, `createDrawer(root)`
- `renderTable(definition)`, `renderEmptyState(definition)`, `renderStatus(definition)`
- `renderShell({ user, pages, activePage })`

- [ ] **Step 1: Write failing shell and component tests**

Assert:

- Missing, false, or malformed `CRM_UX_REDESIGN_ENABLED` selects the legacy shell.
- Exact values `1` and `true` select the new shell.
- Both shells call the same API routes and load the same shared services.
- Modal/drawer apply dialog semantics, focus entry, Escape close, focus restoration, and idempotent destroy.
- Table output has a stable scroll container and header associations.
- All dynamic text is escaped.
- Shell navigation is generated only from `visiblePages()`.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test test/frontend_shell.test.js test/frontend_components.test.js
```

Expected: FAIL because the shell resolver and components do not exist.

- [ ] **Step 3: Implement the dual-shell boundary**

Change only the root handler:

```js
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, resolveFrontendShell(process.env)));
});
```

`sales-crm-next.html` contains login, one application mount, one modal portal, one drawer portal, one toast region, and the module script `/sales-assets/modular-app.js`. `modular-app.js` composes core, services, registry, router, lifecycle, and shell; it does not contain business renderers.

Keep `CRM_UX_REDESIGN_ENABLED` off by default.

- [ ] **Step 4: Verify GREEN and both shell modes**

Run:

```bash
node --test test/frontend_shell.test.js test/frontend_components.test.js test/sales_menu.test.js
CRM_UX_REDESIGN_ENABLED=false node --test test/frontend_shell.test.js
CRM_UX_REDESIGN_ENABLED=true node --test test/frontend_shell.test.js
```

Expected: both roots return 200, legacy remains default, and shared component tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/frontend_shell.js server.js sales-crm-next.html sales-assets/modular-app.js sales-assets/components sales-assets/app.css test/frontend_shell.test.js test/frontend_components.test.js
git commit -m "feat(frontend): add reversible modular shell"
```

## Task 6: Implement Role Home Pages and Navigation

**Files:**

- Create: `sales-assets/modules/my-today/index.js`
- Create: `sales-assets/modules/team-dashboard/index.js`
- Create: `sales-assets/modules/team-tasks/index.js`
- Create: `sales-assets/core/preferences.js`
- Modify: `sales-assets/core/registry.js`
- Modify: `sales-assets/components/shell.js`
- Modify: `sales-assets/app.css`
- Create: `test/frontend_role_homes.test.js`
- Create: `test/frontend_layout_preferences.test.js`

**Interfaces:**

Every module exports:

```js
export default {
  id,
  async load(context) {},
  render(context) {},
  dispose(context) {}
};
```

Layout preference interfaces:

- `loadLayoutPreference(userId, storage)`
- `saveLayoutPreference(userId, preference, storage)`
- `sanitizeLayoutPreference(preference, visiblePages)`

- [ ] **Step 1: Write failing role-home tests**

Assert:

- Sales lands on “我的今日” with pending claims, personal alerts, due follow-ups, and AI items awaiting that user's review.
- Manager/admin lands on “经营驾驶舱” with authorized metrics, cumulative funnel, rule alerts, and activity feed.
- Manager “今日待办” renders deterministic anomaly first and AI explanation second.
- Notification count and navigation counters use scoped bootstrap data.
- No sales DOM contains team, governance, maintenance, or task-center navigation.
- Route disposal cancels outstanding requests and polling.
- Preferences may set `defaultPageId`, `navOrder`, and `collapsedGroups`, but cannot restore a page removed by role, permission, feature flag, or impersonation.
- Missing or corrupt preferences fall back to the role default and all authorized capabilities remain reachable.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_role_homes.test.js
```

Expected: FAIL because role modules do not exist.

- [ ] **Step 3: Implement role modules**

Use existing bootstrap fields and existing deterministic metric calculations. Do not create new dashboard definitions in the browser. “我的今日” distinguishes:

- formal CRM next actions;
- unadopted AI suggestions awaiting review;
- deterministic overdue alerts;
- notifications.

An unadopted suggestion must not be counted as a formal task.

Store preferences under `tradepulse:layout:<userId>` and sanitize them against `visiblePages()` before
use. Preferences may reorder navigation and collapse groups; they cannot hide a capability completely.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_role_homes.test.js test/frontend_layout_preferences.test.js test/a4_04_stage_gate.test.js test/ai_manager_anomaly.test.js test/a3_04_notifications_claims.test.js
```

Expected: all role, scope, alert, and notification tests pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/modules/my-today sales-assets/modules/team-dashboard sales-assets/modules/team-tasks sales-assets/core/preferences.js sales-assets/core/registry.js sales-assets/components/shell.js sales-assets/app.css test/frontend_role_homes.test.js test/frontend_layout_preferences.test.js
git commit -m "feat(frontend): add role-based workspaces"
```

## Task 7: Migrate Intake, Customers, Pipeline, and Sales Writes

**Files:**

- Create: `sales-assets/modules/intake/index.js`
- Create: `sales-assets/modules/customers/index.js`
- Modify: `sales-assets/services/intake.js`
- Modify: `sales-assets/services/customers.js`
- Modify: `sales-assets/services/activities.js`
- Modify: `sales-assets/app.css`
- Create: `test/frontend_customer_workflows.test.js`

**Interfaces:**

- `intake` owns all, pending, assigned, claimed, returned, scan, review, assign, bulk assign, claim, return, and mismatch states.
- `customers` owns list, filters, CSV export, current-stage pipeline, bulk recycle, restore, and reassign entry points.

- [ ] **Step 1: Write failing workflow tests**

Cover:

- Legacy hashes map to the correct intake status without changing the server query.
- Search debounce, page reset, pagination, and idempotency keys are stable.
- A claim is rendered only after server success; a 409 refreshes authoritative data.
- Customer filters, evaluation tags, overdue-only, stage view, export, recycle, restore, and reassign remain reachable.
- RFQ, quote, and order forms keep current currency, margin, quote-binding, and idempotency validation.
- Permission-hidden actions are absent from DOM and forbidden APIs still return 403.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_customer_workflows.test.js
```

Expected: FAIL because intake and customer modules do not exist.

- [ ] **Step 3: Implement the modules**

Use shared table, status, modal, services, and lifecycle APIs. Keep:

```text
server success -> domain store update -> counter invalidation -> local rerender
```

Do not reimplement stage transitions, assignment eligibility, quote/order validation, or recycle rules in the browser.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_customer_workflows.test.js test/sales_crm.test.js test/a3_04_notifications_claims.test.js test/a3_05_rfq_order_boundary.test.js test/ai_assignment_arbitration.test.js test/customer_recycle_bin.test.js
```

Expected: all customer-flow, commerce, assignment, and recycle tests pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/modules/intake sales-assets/modules/customers sales-assets/services/intake.js sales-assets/services/customers.js sales-assets/services/activities.js sales-assets/app.css test/frontend_customer_workflows.test.js
git commit -m "feat(frontend): migrate customer flow modules"
```

## Task 8: Replace the Profile iframe with One Customer Detail Module

**Files:**

- Create: `sales-assets/modules/customer-detail/index.js`
- Create: `sales-assets/modules/customer-detail/tabs.js`
- Modify: `sales-assets/core/registry.js`
- Modify: `sales-assets/services/customers.js`
- Modify: `sales-assets/services/intelligence.js`
- Modify: `sales-assets/services/ai.js`
- Modify: `sales-assets/app.css`
- Create: `test/frontend_customer_detail.test.js`
- Modify: `test/sales_menu.test.js`

**Interfaces:**

- `openCustomerDetail({ customerId, presentation: 'page' | 'drawer', returnRoute })`
- Tabs: `overview`, `timeline`, `commerce`, `intelligence`, `evaluation`, `tags`, `ai`

- [ ] **Step 1: Write failing parity and deep-link tests**

Assert:

- `?customer=<id>#customerProfile` opens the canonical detail route.
- Page and drawer use the same module and data loader.
- All existing profile fields and actions are present across the seven tabs.
- Contact and Recon fields remain permission-redacted.
- Timeline includes human activities, proposals, next actions, notifications, RFQ, quotes, and orders.
- Close/back returns to the exact source route.
- No new shell markup contains `customerProfileFrame`.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test test/frontend_customer_detail.test.js test/sales_menu.test.js
```

Expected: FAIL because the new detail module is absent and the next shell still lacks complete profile parity.

- [ ] **Step 3: Implement detail tabs and retire iframe only in the new shell**

Preserve the iframe in the legacy shell. In the new shell:

- load only the active tab's optional data;
- retain already loaded tab state;
- abort tab requests when customer changes;
- use one action dispatcher for page and drawer;
- show explicit 403, 404, stale, and retry states.

Update the capability manifest entry for every profile field/action to `migrated`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_customer_detail.test.js test/sales_menu.test.js test/permission_integration.test.js test/ai_customer_enrichment_ui.test.js test/a3_06_sales_execution_gate.test.js
npm run frontend:parity
```

Expected: all detail, permission, enrichment, timeline, and parity checks pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/modules/customer-detail sales-assets/core/registry.js sales-assets/services/customers.js sales-assets/services/intelligence.js sales-assets/services/ai.js sales-assets/app.css test/frontend_customer_detail.test.js test/sales_menu.test.js docs/refactor/frontend-capability-manifest.json
git commit -m "feat(frontend): unify customer detail"
```

## Task 9: Migrate Team, Intelligence, Assistant, and Administration

**Files:**

- Create: `sales-assets/modules/team-insights/index.js`
- Create: `sales-assets/modules/intelligence/index.js`
- Create: `sales-assets/modules/assistant/index.js`
- Create: `sales-assets/modules/administration/index.js`
- Modify: `sales-assets/services/intelligence.js`
- Modify: `sales-assets/services/administration.js`
- Modify: `sales-assets/core/registry.js`
- Modify: `sales-assets/app.css`
- Create: `test/frontend_management_modules.test.js`

**Interfaces:**

- Team insights: deterministic capability metrics, manager evaluations, market strategy, coaching slot.
- Intelligence: pool, people, Recon, evidence, reports.
- Assistant: conversation history and explicit customer/team scope.
- Administration: users, permissions, impersonation, recycle bin, maintenance, runtime/flag slots.

- [ ] **Step 1: Write failing module tests**

Assert:

- Manager scope applies to every team metric, person, Recon result, and report.
- Sales never receives team or administration DOM.
- Assistant history restores server conversations and displays the active scope.
- User archive/restore/delete, password reset, permission groups, overrides, and impersonation remain reachable.
- Maintenance always requires preview before execution and remains real-admin-only.
- Empty, loading, error, forbidden, and paginated states are explicit.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/frontend_management_modules.test.js
```

Expected: FAIL because the management modules do not exist.

- [ ] **Step 3: Implement modules using existing APIs**

Keep deterministic team metrics visually ahead of AI coaching. Keep assistant scope in the request and visible header. Do not merge system administration into ordinary manager navigation.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_management_modules.test.js test/assistant_conversations.test.js test/assistant_session_routing.test.js test/permission_group_api.test.js test/impersonation_authorization.test.js test/data_maintenance.test.js test/report_files.test.js
```

Expected: all management, assistant, permission, and maintenance tests pass.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/modules/team-insights sales-assets/modules/intelligence sales-assets/modules/assistant sales-assets/modules/administration sales-assets/services/intelligence.js sales-assets/services/administration.js sales-assets/core/registry.js sales-assets/app.css test/frontend_management_modules.test.js
git commit -m "feat(frontend): migrate management workspaces"
```

## Task 10: Make AI Trigger Provenance Mandatory

**Files:**

- Modify: `lib/ai_stations/schema.js`
- Modify: `lib/ai_stations/jobs.js`
- Modify: `lib/ai_stations/task_center.js`
- Modify: `lib/ai_stations/routes.js`
- Modify: `lib/ai_stations/sales_pack.js`
- Modify: `lib/ai_stations/action_proposal.js`
- Modify: `lib/ai_stations/next_action.js`
- Modify: `lib/ai_stations/contact_readiness.js`
- Modify: `lib/ai_stations/manager_anomaly.js`
- Modify: `lib/ai_stations/sales_coaching.js`
- Modify: `lib/ai_stations/enrichment/workflow.js`
- Modify: `lib/ai_stations/enrichment/events.js`
- Create: `test/ai_trigger_provenance.test.js`
- Modify: `test/ai_station_jobs.test.js`

**Interfaces:**

```js
trigger: {
  source: 'manual' | 'business_event' | 'workflow' | 'schedule' | 'api'
    | 'migration' | 'release_validation' | 'legacy_unknown',
  eventType: '',
  eventId: '',
  actorId: '',
  workflowId: '',
  reason: '',
  triggeredAt: 'ISO-8601'
}
```

- [ ] **Step 1: Write failing migration and enqueue tests**

Assert:

- Legacy rows migrate with `trigger_source='legacy_unknown'` and unchanged original fields.
- New enqueue without `trigger` fails before insert.
- `business_event` requires event type and ID.
- `workflow` requires workflow ID and keeps the original actor/source chain.
- Manual customer fit, sales pack, anomaly explanation, and coaching identify the requesting actor.
- Next action identifies the originating activity/RFQ/quote event.
- Enrichment child jobs identify the workflow and its original trigger.
- Public job/task-center payloads expose one normalized trigger object.
- `created_by` alone never renders as a trigger explanation.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js
```

Expected: FAIL because the general job schema has no mandatory trigger source.

- [ ] **Step 3: Implement schema, validation, mappings, and all call-site updates**

Add:

```text
trigger_source TEXT NOT NULL DEFAULT 'legacy_unknown'
trigger_actor_id TEXT NOT NULL DEFAULT ''
trigger_reason TEXT NOT NULL DEFAULT ''
triggered_at TEXT NOT NULL DEFAULT ''
```

Reuse authoritative `event_type`, `event_id`, `workflow_id`, and `created_by`; do not duplicate or rewrite them. Map all current enqueue call sites in the same commit so no new production task can become `legacy_unknown`.

- [ ] **Step 4: Verify GREEN and AI regression**

Run:

```bash
node --test test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js test/ai_sales_pack.test.js test/ai_action_proposal.test.js test/ai_next_action.test.js test/ai_manager_anomaly.test.js test/ai_sales_coaching.test.js test/ai_customer_enrichment_workflow.test.js
```

Expected: all trigger, migration, station, and workflow tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai_stations/schema.js lib/ai_stations/jobs.js lib/ai_stations/task_center.js lib/ai_stations/routes.js lib/ai_stations/sales_pack.js lib/ai_stations/action_proposal.js lib/ai_stations/next_action.js lib/ai_stations/contact_readiness.js lib/ai_stations/manager_anomaly.js lib/ai_stations/sales_coaching.js lib/ai_stations/enrichment/workflow.js lib/ai_stations/enrichment/events.js test/ai_trigger_provenance.test.js test/ai_station_jobs.test.js
git commit -m "feat(ai): record authoritative trigger provenance"
```

## Task 11: Present AI as Fact, Inference, Decision, and Action

**Files:**

- Create: `lib/ai_stations/presentation.js`
- Modify: `lib/ai_stations/routes.js`
- Modify: `lib/ai_stations/task_center.js`
- Create: `sales-assets/components/ai-result.js`
- Modify: `sales-assets/services/ai.js`
- Modify: `sales-assets/modules/customer-detail/index.js`
- Modify: `sales-assets/modules/my-today/index.js`
- Modify: `sales-assets/modules/intake/index.js`
- Modify: `sales-assets/modules/team-tasks/index.js`
- Modify: `sales-assets/modules/team-insights/index.js`
- Create: `test/ai_business_presentation.test.js`
- Create: `test/ai_business_experience_ui.test.js`

**Interfaces:**

- `presentAIResult({ job, result, evidence, coverage, permissions })`
- `renderAIResult(viewModel, actions)`

Business payload:

```js
{
  kind: 'ai_inference',
  businessName: '是否值得优先开发',
  generatedAt: '2026-07-25T00:00:00.000Z',
  stale: false,
  trigger: { source, label, eventType, eventId, actorName, reason },
  evidence: { visibleCount, totalCount, items, restricted },
  inference: { summary, reasons, confidence },
  coverage: { state, label, numerator, denominator, missingItems },
  allowedActions: ['view_evidence', 'adopt', 'edit_and_adopt', 'reject'],
  sideEffects: {
    onGenerate: [],
    onAdopt: ['crm_accounts.next_action', 'crm_accounts.next_action_at'],
    never: ['send_message', 'change_owner', 'change_stage']
  }
}
```

- [ ] **Step 1: Write failing presentation and no-side-effect tests**

Cover all eight stations, action proposal, and enrichment. Assert:

- Source fact, deterministic rule, AI inference, human decision, and system action labels are distinct.
- Confidence and coverage are separate.
- Zero denominators render “暂无样本”, never `0%`.
- Insufficient coaching does not call the model.
- Global coverage shows analyzed/eligible totals.
- Restricted evidence exposes only counts and a restriction notice.
- Customer fit generation cannot change state/owner/stage.
- Sales pack cannot invoke sending or outbound notification.
- Manager anomaly must reference an existing deterministic rule.
- Stale results cannot expose adoption.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js
```

Expected: FAIL because no shared business presentation contract or component exists.

- [ ] **Step 3: Implement server presentation and shared UI**

Station meanings and side effects are server-owned constants. The client renders them and dispatches allowed actions; it must not infer side effects from station names.

Place results only in business context:

- fit, readiness, pack, enrichment in customer detail;
- priority and match in intake;
- next action in customer detail and “我的今日” review;
- anomaly in manager tasks;
- coaching after deterministic team metrics.

Do not add a general “AI workstations” page.

- [ ] **Step 4: Verify GREEN and safety gate**

Run:

```bash
node --test test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js test/ai_sales_pack.test.js test/ai_next_action.test.js test/ai_manager_anomaly.test.js test/ai_sales_coaching.test.js test/ai_customer_enrichment_e2e.test.js
```

Expected: all business presentation and no-implicit-side-effect tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai_stations/presentation.js lib/ai_stations/routes.js lib/ai_stations/task_center.js sales-assets/components/ai-result.js sales-assets/services/ai.js sales-assets/modules/customer-detail/index.js sales-assets/modules/my-today/index.js sales-assets/modules/intake/index.js sales-assets/modules/team-tasks/index.js sales-assets/modules/team-insights/index.js test/ai_business_presentation.test.js test/ai_business_experience_ui.test.js
git commit -m "feat(ai): clarify evidence and human decisions"
```

## Task 12: Restrict AI Operations by Role

**Files:**

- Modify: `lib/access_control.js`
- Modify: `lib/ai_stations/routes.js`
- Create: `sales-assets/modules/ai-control/index.js`
- Modify: `sales-assets/modules/administration/index.js`
- Modify: `sales-assets/core/registry.js`
- Modify: `sales-assets/services/ai.js`
- Modify: `test/access_control.test.js`
- Modify: `test/ai_governance.test.js`
- Modify: `test/ai_task_center.test.js`
- Create: `test/frontend_ai_roles.test.js`

**Interfaces:**

- Business results remain available through scoped customer/team endpoints.
- Task list/detail requires `review_ai_tasks`.
- Governance read/write requires `realAdminOnly`.
- Budgets, runtime policy, model/prompt versions, rollback, and AI feature flags are administrator system tools.

- [ ] **Step 1: Write failing authorization tests**

Assert:

- Sales gets 403 for task list/detail and has no task-center navigation.
- Manager with `review_ai_tasks` can inspect only scoped review/failure tasks reached from a business result.
- Manager gets 403 for governance read, strategy create/evaluate/publish/approve/rollback, runtime policy, and feature flags.
- Administrator can use global task audit, budgets, governance, runtime, and flags.
- Impersonation keeps all sensitive mutations blocked.
- Removing client DOM does not substitute for server checks.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
node --test test/frontend_ai_roles.test.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js
```

Expected: FAIL because governance currently permits manager-level permission combinations and task reads require only `view_customers`.

- [ ] **Step 3: Implement the role boundary**

Use `realAdminOnly: true` on every governance/model/version mutation and read. Require `review_ai_tasks` for task list/detail. Preserve row-scoped filtering for manager task inspection. Render:

```text
System Management
  AI Run Audit
  AI Governance
  AI Budgets
  AI Runtime and Feature Flags
```

Only administrators see this group.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/frontend_ai_roles.test.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js test/impersonation_authorization.test.js test/a4_04_stage_gate.test.js
```

Expected: all server and frontend role boundaries pass.

- [ ] **Step 5: Commit**

```bash
git add lib/access_control.js lib/ai_stations/routes.js sales-assets/modules/ai-control sales-assets/modules/administration sales-assets/core/registry.js sales-assets/services/ai.js test/access_control.test.js test/ai_governance.test.js test/ai_task_center.test.js test/frontend_ai_roles.test.js
git commit -m "fix(ai): restrict governance to administrators"
```

## Task 13: Add Responsive, Accessibility, and Browser Gates

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.js`
- Create: `test/e2e/server.js`
- Create: `test/e2e/frontend.spec.js`
- Create: `test/e2e/visual.spec.js`
- Modify: `sales-assets/app.css`
- Modify: `sales-assets/components/modal.js`
- Modify: `sales-assets/components/drawer.js`
- Modify: `sales-assets/components/shell.js`
- Create: `test/frontend_accessibility.test.js`

**Interfaces:**

- `npm run test:browser`
- Browser fixtures: admin, manager, sales.
- Viewports: `1440x900`, `1280x800`, `390x844`.

- [ ] **Step 1: Add Playwright and write failing browser tests**

Install the test dependency and record it in the lockfile:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Add `test:browser` to `package.json`. The E2E server must use a temporary test database, seed fixed admin/manager/sales users, enable the new shell, listen on an unused local port, and delete its temporary runtime on termination.

Test:

- login and role default route;
- every visible navigation item;
- old/new deep links, back, forward, refresh;
- filters, pagination, customer detail tabs;
- one authorized write and one forbidden write per role;
- AI disabled, failed, stale, insufficient-sample, review, and adoption states;
- modal/drawer focus entry, Escape, and focus restoration;
- keyboard-only route/tab/menu operation;
- no console/page errors.

- [ ] **Step 2: Run browser tests to verify RED**

Run:

```bash
npm run test:browser
```

Expected: FAIL on unresolved responsive/accessibility conditions before the CSS and component fixes.

- [ ] **Step 3: Implement responsive and accessibility fixes**

Requirements:

- At `390px`, `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- Only explicit table scrollers may overflow horizontally.
- Mobile customer detail is full-page; tabs scroll horizontally.
- Modal/drawer actions remain visible and content scrolls.
- No cards inside cards.
- Icon buttons have accessible names and tooltips.
- Dialog, tab, menu, segmented control, checkbox, and status semantics are correct.
- Focus is never left in hidden content.
- Fixed controls use stable dimensions; dynamic labels cannot resize the layout.

- [ ] **Step 4: Verify GREEN with screenshots**

Run:

```bash
node --test test/frontend_accessibility.test.js
npm run test:browser
```

Expected: all tests pass. Save desktop and mobile screenshots under `test-results/` as CI artifacts; no screenshot may show overlap, clipped controls, blank content, or page-level overflow.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.js test/e2e test/frontend_accessibility.test.js sales-assets/app.css sales-assets/components/modal.js sales-assets/components/drawer.js sales-assets/components/shell.js
git commit -m "test(frontend): add responsive browser gates"
```

## Task 14: Prove Full Parity, Cut Over, and Retire the Legacy Shell

**Files:**

- Modify: `docs/refactor/frontend-capability-manifest.json`
- Create: `docs/evidence/frontend-modular-refactor-stage-gate.md`
- Modify: `server.js`
- Modify: `lib/frontend_shell.js`
- Modify: `sales-crm.html`
- Delete: `sales-crm-next.html`
- Replace: `sales-assets/app.js` with the modular bootstrap
- Delete: `sales-assets/modular-app.js` after it becomes the canonical bootstrap
- Delete: temporary legacy renderer after the observation gate
- Modify: `test/frontend_parity_manifest.test.js`
- Modify: `test/frontend_shell.test.js`
- Modify: `test/deploy_contract.test.js`

**Interfaces:**

- `npm run frontend:parity` must report zero missing or non-final entries.
- Temporary shell resolver is removed only after the production observation gate.

- [ ] **Step 1: Write the failing completion-gate tests**

Require:

- Every manifest entry is `verified`.
- Every old route has a canonical alias or explicit approved retirement.
- Every enabled capability is reachable for at least one authorized role.
- Every registered page dynamically imports a module with `id`, `load`, `render`, and `dispose`.
- No new shell source imports or references the legacy renderer or iframe.
- Production deploy validation runs Node tests, browser smoke, health, backup, and rollback checks.
- The final root serves only the modular shell and ignores the removed temporary flag.

- [ ] **Step 2: Run the completion gate to verify RED**

Run:

```bash
npm run frontend:parity
node --test test/frontend_parity_manifest.test.js test/frontend_shell.test.js test/deploy_contract.test.js
```

Expected: FAIL while any capability is not verified or the temporary shell remains.

- [ ] **Step 3: Run the pre-cutover verification matrix**

Run:

```bash
node --check server.js
find sales-assets -name '*.js' -print0 | xargs -0 -n1 node --check
npm run frontend:parity
npm test
npm run test:browser
git diff --check
```

Expected: every command exits `0`. Record exact test counts, browser projects, screenshots, manifest result, commit SHA, and rollback release in the evidence document.

- [ ] **Step 4: Deploy with the old shell available**

Deploy one immutable release with `CRM_UX_REDESIGN_ENABLED=false`. Before switching:

```bash
sqlite3 -readonly /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db "PRAGMA quick_check;"
curl -fsS http://127.0.0.1:7100/health
```

Expected: `quick_check` returns `ok`; health returns the deployed release SHA. Smoke the legacy shell for admin, manager, sales, deep links, customer detail, one read-only AI result, and Worker health.

Then enable `CRM_UX_REDESIGN_ENABLED=true`, restart the service through the existing deployment mechanism, and repeat:

- local and public health;
- admin, manager, sales login/default route;
- all visible navigation;
- `390px` mobile smoke;
- critical write confirmation;
- AI provenance/coverage labels;
- no console errors.

Any failure returns the flag to false; database restore is not automatic.

- [ ] **Step 5: Retire the legacy shell after the observation gate**

After the agreed stable observation period:

- make the modular HTML the canonical `sales-crm.html`;
- make the modular bootstrap the canonical `sales-assets/app.js`;
- remove the old renderer and temporary HTML;
- remove `CRM_UX_REDESIGN_ENABLED` and `lib/frontend_shell.js`;
- update static asset versions;
- rerun the full verification matrix;
- mark `ux-preview` read-only historical reference.

- [ ] **Step 6: Verify final GREEN**

Run:

```bash
npm run frontend:parity
npm test
npm run test:browser
git diff --check
```

Expected: all commands exit `0`, the manifest has zero non-verified entries, and no legacy shell/flag/iframe reference remains.

- [ ] **Step 7: Commit**

```bash
git add -A docs/refactor/frontend-capability-manifest.json docs/evidence/frontend-modular-refactor-stage-gate.md server.js lib/frontend_shell.js sales-crm.html sales-crm-next.html sales-assets/app.js sales-assets/modular-app.js test/frontend_parity_manifest.test.js test/frontend_shell.test.js test/deploy_contract.test.js
git commit -m "feat(frontend): complete modular shell cutover"
```

## Requirement Coverage

| Approved design requirement | Implemented and verified by |
|---|---|
| Zero feature omissions and current-production union | Tasks 1 and 14 |
| Native JavaScript modularization without framework/build rewrite | Tasks 2-5 |
| Registry-driven roles, permissions, flags, aliases, and defaults | Tasks 3 and 6 |
| Global-only bootstrap and page-scoped loading | Task 4 |
| Shared state, services, lifecycle, and pessimistic writes | Tasks 2, 4, and 7 |
| Sales/manager/admin information architecture | Tasks 3, 6, 9, and 12 |
| Unified page/drawer customer detail and iframe retirement | Task 8 |
| All customer, intake, commerce, intelligence, report, and admin flows | Tasks 7-9 |
| Fact/rule/inference/decision/action AI model | Task 11 |
| Authoritative AI trigger provenance and honest legacy state | Task 10 |
| Coverage, sample sufficiency, stale state, and zero denominators | Task 11 |
| No auto-send or implicit CRM mutation | Tasks 10-11 |
| Technical task center and administrator-only governance | Task 12 |
| User layout preferences after access/flag filtering | Task 6 |
| Error, empty, loading, forbidden, and retry states | Tasks 5-9 and 11 |
| Desktop/mobile accessibility and browser verification | Task 13 |
| Same-release rollback, production smoke, and legacy retirement | Tasks 5 and 14 |

Self-review result: every approved design section maps to at least one implementation task; no deferred
requirement or unresolved interface remains in this plan.

## Execution Checkpoints

Stop for review after these task groups:

1. Tasks 1-5: parity baseline, core, services, components, reversible shell.
2. Tasks 6-9: all non-AI business modules and unified customer detail.
3. Tasks 10-12: AI provenance, business semantics, and role boundaries.
4. Task 13: browser, responsive, and accessibility gates.
5. Task 14: production cutover and legacy retirement.

At every checkpoint:

```bash
npm run frontend:parity
npm test
git diff --check
git status --short
```

Do not proceed with unreviewed task changes, a failing test, an unmapped capability, or an unreviewed
permission change. Preserve and report unrelated user changes rather than reverting them.

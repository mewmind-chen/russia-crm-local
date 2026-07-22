# Customer Flow Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Sales CRM around the real daily customer lifecycle while preserving the latest Issue #3 administration and identity-inspection features.

**Architecture:** Keep the existing single-page Sales CRM and permission model. Add route aliases for assigned and claimed intake states, reuse the existing intake and customer drawer views, and expose manager-generated AI labels as read-only customer profile/filter data without granting evaluation-management permissions.

**Tech Stack:** Node.js, Express, SQLite, vanilla JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Base every change on `codex/issue-3-access-groups-impersonation@60a870c`.
- Preserve permission groups, administrator password reset, and identity-inspection behavior.
- Keep `经营驾驶舱`, `CRM客户全景`, and `推进管道` visible when permitted.
- Do not restore `客户开发工作台`, `未开发线索池`, `联系人速览`, or `Recon结果速览` as primary navigation.
- Evaluation creation remains manager-only; customer viewers receive only the scoped read-only evaluation data already allowed by their permissions.

---

### Task 1: Lifecycle Navigation

**Files:**
- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js`
- Test: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: existing `view_intake`, `manage_intake`, `switchView(view)`, and `renderIntake()`.
- Produces: `viewPermissions`, `pending -> assigned`, and `claimed -> claimed` route aliases.

- [ ] **Step 1: Write failing navigation tests**

Assert the sidebar contains `经营驾驶舱`, `今日待办`, `待领取`, `已领取`, `CRM客户全景`, and `推进管道`, excludes obsolete research navigation, and retains `用户与权限`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/sales_menu.test.js`

Expected: FAIL because pending/claimed route aliases and the simplified menu are absent.

- [ ] **Step 3: Implement lifecycle aliases and menu groups**

Use this route contract:

```js
const viewPermissions = { pending: 'view_intake', claimed: 'view_intake' };
const sectionView = ['pending', 'claimed'].includes(view) ? 'intake' : view;
state.intakeStatus = view === 'pending' ? 'assigned' : view === 'claimed' ? 'claimed' : state.intakeStatus;
```

Render `今日工作`, `客户流转`, and `管理中心` groups without changing the permission attributes on retained management actions.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/sales_menu.test.js`

Expected: PASS.

### Task 2: Unified Customer Profile Clicks

**Files:**
- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Test: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: `table(headers, rows, attrs)`, `openCustomer(customerId)`, and `state.data.intake.items`.
- Produces: row-level `_attrs`, `data-customer`, `data-intake-profile`, and `openIntakeProfile(itemId)`.

- [ ] **Step 1: Write failing row-click tests**

Assert CRM table rows have `data-customer`, claimed rows use the CRM ID, and unclaimed intake rows use `data-intake-profile`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/sales_menu.test.js`

Expected: FAIL because intake rows do not expose a profile target.

- [ ] **Step 3: Add row attributes and intake profile rendering**

Extend `table()` to render optional row attributes:

```js
`<tr${row._attrs ? ` ${row._attrs}` : ''}>`
```

Use the existing customer drawer for intake profile facts, contacts, evidence, and assignment state. Interactive buttons and links must not trigger the row click.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/sales_menu.test.js`

Expected: PASS.

### Task 3: Evaluation Labels and Contextual AI

**Files:**
- Modify: `lib/sales_crm.js`
- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Test: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: scoped `loadInsights`, `manage_evaluations`, `/api/assistant/chat`, and the existing customer drawer.
- Produces: `labelsForAccount(customerId)`, `evaluationTagFilter`, and `customerAiSection(context)`.

- [ ] **Step 1: Write failing label and AI tests**

Assert evaluation labels are searchable/filterable, appear in the customer drawer, remain absent from primary navigation, and the drawer AI form posts a scoped customer context to `/api/assistant/chat`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/sales_menu.test.js`

Expected: FAIL because the CRM table lacks the label filter and contextual AI section.

- [ ] **Step 3: Implement scoped label data and drawer AI**

Expose only scoped insight rows already visible to the account viewer. Keep evaluation writes protected by `manage_evaluations`. Render a compact customer-context AI form in the drawer:

```js
await api('/api/assistant/chat', {
  method: 'POST',
  body: JSON.stringify({ message, history: [], context: state.drawerAiContext || {} }),
});
```

- [ ] **Step 4: Run focused permission and menu tests**

Run: `node --test test/sales_menu.test.js test/permission_integration.test.js test/assistant_scope.test.js`

Expected: PASS.

### Task 4: Regression and Browser Verification

**Files:**
- Verify: `sales-crm.html`
- Verify: `sales-assets/app.js`
- Verify: `sales-assets/app.css`
- Verify: `lib/sales_crm.js`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a deployable branch with test and browser evidence.

- [ ] **Step 1: Run syntax, diff, and full regression checks**

Run:

```bash
node --check sales-assets/app.js
node --check lib/sales_crm.js
git diff --check
npm test
```

Expected: 133 baseline tests plus new menu tests pass with zero failures.

- [ ] **Step 2: Start the latest-base server and verify desktop/mobile**

Check the lifecycle menu, Issue #3 user actions, pending and claimed profile clicks, CRM label filtering, pipeline profile clicks, and customer AI section. Confirm no console errors or overlapping navigation.

- [ ] **Step 3: Commit the implementation**

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css lib/sales_crm.js test/sales_menu.test.js docs/superpowers/plans/2026-07-22-customer-flow-menu.md
git commit -m "feat: streamline CRM customer flow navigation"
```

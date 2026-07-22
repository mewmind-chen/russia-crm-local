# Customer Profile Page And Automatic Customer Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the original detailed customer panel as a profile-only CRM page and make manual CRM customer creation generate a valid canonical customer code automatically.

**Architecture:** Reuse the existing workbench detail renderer through a `profile=1&customer=<id>` mode instead of duplicating profile markup. Add a non-sidebar profile host to the CRM shell with explicit return navigation. Replace the invalid `CUS-*` generator with the existing canonical customer ID allocator inside the account-creation transaction.

**Tech Stack:** Node.js, Express, SQLite, vanilla JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Do not restore `客户开发工作台` as a primary menu item.
- Reuse the original workbench customer details, tags, Recon information, editing behavior, and customer-scoped AI.
- Customer codes use `<country prefix>-<four-digit global sequence>` and the numeric portion is globally unique.
- Preserve explicit `externalCustomerId` attachment to an existing customer master.
- Preserve Issue 3 account, permission-group, override, password-reset, and identity-inspection behavior.
- Do not broaden access to unclaimed customer data or contact fields.

---

### Task 1: Canonical Automatic Customer Codes

**Files:**
- Modify: `lib/sales_crm.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Consumes: `allocateCustomerId(usedIds, prefix, counters)` and `normalizeCountryPrefix(country)` from `lib/customer_ids.js`.
- Produces: `addAccount(user, payload) -> { customerId, externalCustomerId }` for newly generated and explicitly attached customer masters.

- [ ] **Step 1: Write the failing integration test**

Add a test that creates an account without `externalCustomerId`, then asserts HTTP 200, a canonical Russian code, and matching records:

```js
test('manual CRM customer creation generates a canonical customer code', async t => {
  const fx = await fixtures.seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  const cookie = await fx.login('other@example.com', 'Password123!');
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie,
    method: 'POST',
    body: { companyName: 'Automatic Code Fixture', country: '俄罗斯', ownerId: 'U-OTHER' },
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.match(body.externalCustomerId, /^RU-\d{4}$/);
  assert.deepEqual(
    fx.db.prepare('SELECT external_customer_id FROM crm_accounts WHERE id=?').get(body.customerId),
    { external_customer_id: body.externalCustomerId },
  );
  assert.equal(
    fx.db.prepare('SELECT company_name FROM customer_pool WHERE customer_id=?').get(body.externalCustomerId).company_name,
    'Automatic Code Fixture',
  );
});
```

- [ ] **Step 2: Run the test and verify the current generator fails**

Run: `node --test --test-name-pattern="manual CRM customer creation generates" test/permission_integration.test.js`

Expected: FAIL with `customer_id must use country prefix + four digits`.

- [ ] **Step 3: Use the canonical allocator in the existing transaction**

Import the helpers:

```js
const { allocateCustomerId, normalizeCountryPrefix } = require('./customer_ids');
```

When no external customer ID is supplied, load existing IDs, allocate using the submitted country, insert the master, and return both IDs:

```js
const usedIds = new Set(value.prepare('SELECT customer_id FROM customer_pool').all().map(row => row.customer_id));
externalId = allocateCustomerId(usedIds, normalizeCountryPrefix(payload.country), {});
// existing customer_pool and crm_accounts inserts
return { customerId, externalCustomerId: externalId };
```

Wrap the master and account inserts in one SQLite transaction so a failed CRM insert cannot leave an orphan customer master.

- [ ] **Step 4: Run focused create-customer tests**

Run: `node --test --test-name-pattern="create_customer|manual CRM customer creation" test/permission_integration.test.js`

Expected: PASS with no failed tests.

### Task 2: Original Workbench Profile-Only Mode

**Files:**
- Modify: `Index.html`
- Test: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: existing `openRequestedCustomer()`, `openPoolCustomer(customerId)`, `openCustomer(followId)`, and `profile=1` URL query state.
- Produces: `profile-mode` body class and a full-page rendering of the existing `#modalBackdrop` customer detail panel.

- [ ] **Step 1: Write failing profile-mode contract tests**

Load `Index.html` in `test/sales_menu.test.js` and assert it recognizes `profile=1`, adds `profile-mode`, keeps `openRequestedCustomer()`, and contains CSS that hides `.app > .sidebar`, `.topbar`, and `.section` while making `#modalBackdrop` an unframed full-page surface.

- [ ] **Step 2: Run the focused menu test and verify failure**

Run: `node --test test/sales_menu.test.js`

Expected: FAIL because `profile-mode` is absent.

- [ ] **Step 3: Add profile-only boot and layout rules**

Extend the initial query bootstrap:

```js
if (q.get('profile') === '1') document.body.classList.add('profile-mode');
```

Add CSS that hides the workbench chrome, makes the app background neutral, keeps the existing detail panel visible at full width, removes the backdrop dimming, and hides only the workbench close button in profile mode. The original detail tabs, tags, editing fields, Recon panel, and AI controls remain unchanged.

When a requested customer is absent in profile mode, render a visible `未找到对应客户资料` message inside the detail surface rather than relying only on a transient toast.

- [ ] **Step 4: Run the focused menu test**

Run: `node --test test/sales_menu.test.js`

Expected: PASS.

### Task 3: CRM Customer Profile Host And Return Navigation

**Files:**
- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Test: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: CRM account `external_customer_id`, `switchView(view)`, and `/development-workbench?embedded=1&profile=1&customer=<id>`.
- Produces: `customerProfileView`, `openCustomerProfile(customerId)`, and `returnFromCustomerProfile()`.

- [ ] **Step 1: Write failing CRM navigation tests**

Assert the CRM HTML contains a non-sidebar `customerProfileView` with a back button and iframe. Assert `data-open-master` calls `openCustomerProfile`, does not call `switchView('pool')`, and the iframe URL contains `profile=1` plus the encoded external customer ID.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/sales_menu.test.js`

Expected: FAIL because the current handler switches to the hidden pool.

- [ ] **Step 3: Add the profile host and navigation functions**

Add an unframed profile section:

```html
<section id="customerProfileView" class="view customer-profile-view">
  <div class="customer-profile-toolbar">
    <button id="customerProfileBack" class="button secondary" type="button">返回</button>
    <div><p class="eyebrow">CUSTOMER PROFILE</p><h2 id="customerProfileTitle">客户资料</h2></div>
  </div>
  <iframe id="customerProfileFrame" class="customer-profile-frame" title="客户完整资料" allow="clipboard-write"></iframe>
</section>
```

Use these navigation semantics:

```js
function openCustomerProfile(externalCustomerId) {
  if (!externalCustomerId) return toast('缺少客户编码，无法打开完整资料');
  state.customerProfileReturnView = state.view;
  closeDrawer();
  switchView('customerProfile');
  $('#customerProfileFrame').src = `/development-workbench?embedded=1&profile=1&assistant=${can('use_ai_assistant') ? '1' : '0'}&prospect=0&customer=${encodeURIComponent(externalCustomerId)}`;
}

function returnFromCustomerProfile() {
  switchView(state.customerProfileReturnView || 'customers');
}
```

Treat `customerProfile` as an internal view that inherits `view_customers`; do not add it to the sidebar. Style the toolbar and iframe with stable viewport dimensions on desktop and mobile.

- [ ] **Step 4: Run focused UI and permission tests**

Run: `node --test test/sales_menu.test.js test/sales_access_ui.test.js test/permission_integration.test.js`

Expected: PASS.

### Task 4: Full Verification And Delivery

**Files:**
- Verify: `Index.html`
- Verify: `sales-crm.html`
- Verify: `sales-assets/app.js`
- Verify: `sales-assets/app.css`
- Verify: `lib/sales_crm.js`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a verified and pushed `codex/customer-flow-menu` branch.

- [ ] **Step 1: Run syntax and focused regression checks**

Run:

```bash
node --check sales-assets/app.js
node --check lib/sales_crm.js
node --test test/sales_menu.test.js test/sales_access_ui.test.js test/permission_integration.test.js test/assistant_scope.test.js
git diff --check
```

Expected: zero syntax errors, zero failed tests, and no whitespace errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Verify the browser workflow**

Verify desktop and 390px mobile behavior for CRM customer drawer to complete profile, original detail sections and tags, back navigation, manual CRM customer creation, generated customer code in the resulting record, and browser console errors.

- [ ] **Step 4: Commit and push**

```bash
git add Index.html sales-crm.html sales-assets/app.js sales-assets/app.css lib/sales_crm.js test/sales_menu.test.js test/permission_integration.test.js docs/superpowers/plans/2026-07-22-customer-profile-page-auto-code.md
git commit -m "feat: add customer profile page and automatic codes"
git push -u origin codex/customer-flow-menu
```

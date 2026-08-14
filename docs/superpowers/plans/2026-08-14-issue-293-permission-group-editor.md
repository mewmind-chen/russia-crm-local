# Issue #293 Permission Group Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Issue #293 by shipping a wide, desktop-no-scroll permission-group editor with current product terminology, complete card descriptions, category counts, and a confirmed role-default reset that preserves legacy keys and personal overrides.

**Architecture:** Keep the backend permission-key model unchanged. Add a frontend presentation/compatibility layer over the canonical definitions, use a permission-group-specific modal shell, and make reset-to-role-default a form state that changes the serializer fallback only after explicit confirmation. Existing permission-group APIs, server authorization, last-admin protection, and personal-permission behavior remain authoritative.

**Tech Stack:** Node.js 22, vanilla JavaScript, server-rendered HTML, CSS, Node test runner, Playwright through the Codex Browser plugin.

## Global Constraints

- Do not delete, rename, or reuse any persisted permission key.
- `view_development`, `view_pool`, and other hidden keys must round-trip unchanged during normal edits.
- A confirmed group reset must use the complete `ROLE_PERMISSIONS[role]`, including hidden keys.
- Reset affects only the current group's permissions after save; it must not alter name, role, description, another group, or any personal override row.
- `客户回收站` and `客户开发工作台` must not appear in either permission editor.
- Desktop widths of 1280px and 1668px must show the active category without an internal category scrollbar; 390px may scroll vertically.
- Existing service-side permission checks and 403 responses remain unchanged.
- Update the CRM JS/CSS cache token before release.

---

### Task 1: Current Permission Presentation Model

**Files:**
- Modify: `sales-assets/app.js:747-755`
- Modify: `sales-assets/app.js:9500-9596`
- Create: `test/issue293_permission_group_modal.test.js`

**Interfaces:**
- Consumes: `state.data.permissionDefinitions`, `state.data.permissionDescriptions`, `customerAIEnabled()`, and `aiPermissionKeys`.
- Produces: `visiblePermissionDefinitions()`, `visibleCategoryPermissions(category, definitions)`, and `permissionDescription(category, key, label, descriptions)` for both group and personal editors.

- [ ] **Step 1: Write failing presentation tests**

Create `test/issue293_permission_group_modal.test.js` with source-level contract tests that:

```js
test('Issue 293 uses current module names once and removes stale navigation wording', () => {
  const categories = section(app, 'const PERMISSION_CATEGORIES', 'function permissionCategoryMarkup');
  const permissionPresentationSource = section(app, 'function visiblePermissionDefinitions', 'function applyBusinessAIVisibility');
  for (const label of ['经营驾驶舱', '今日待办', '通知中心', '线索池', '客户联系人线索',
    'Recon 情报', 'CRM客户全景', '不对口记录', '推进管道', '主管介入任务',
    '团队状态', '经理评价', '用户与权限', '客户保护与查重', '数据维护']) {
    assert.match(permissionPresentationSource, new RegExp(label));
  }
  assert.doesNotMatch(permissionPresentationSource, /客户回收站|客户开发工作台/);
  assert.equal((categories.match(/'view_intake'/g) || []).length, 1);
  assert.match(app, /team: 'view_team'/);
});

test('every visible permission card has category-aware explanatory copy', () => {
  const groupFields = section(app, 'function permissionFields', 'function openEditUserModal');
  assert.match(groupFields, /permissionDescription\(/);
  assert.match(app, /允许进入/);
  assert.match(app, /允许执行/);
});

test('category counts use only definitions that are actually rendered', () => {
  assert.match(app, /function visibleCategoryPermissions\(/);
  assert.match(app, /visiblePermissions\.length/);
  assert.match(app, /本分类共 \$\{visiblePermissions\.length\} 项/);
});
```

Add the local `section()` helper and read `sales-assets/app.js` exactly as the existing Issue #291 UI tests do.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test test/issue293_permission_group_modal.test.js`

Expected: FAIL because current UI still contains `管理客户回收站`, lacks presentation overrides, category-aware fallback descriptions, and rendered category counts.

- [ ] **Step 3: Implement the presentation layer and real module grouping**

In `sales-assets/app.js`, add immutable presentation overrides near `visiblePermissionDefinitions()`:

```js
const retiredPermissionKeys = new Set(['view_development', 'view_pool']);
const permissionPresentation = Object.freeze({
  manage_customer_recycle: Object.freeze({
    label: '管理不对口记录',
    description: '恢复、重新分配或处理不对口记录。',
  }),
  manage_manual_customer_deletion: Object.freeze({
    label: '手工移除客户',
    description: '将确认需要移除的客户转入受控历史记录。',
  }),
  resolve_manager_tasks: Object.freeze({
    label: '主管介入任务',
    description: '查看并处理主管介入任务及相关统计。',
  }),
});
```

Update `visiblePermissionDefinitions()` to filter both retired keys and AI-gated keys, then apply every `permissionPresentation[key].label`. Add:

```js
function visibleCategoryPermissions(category, definitions) {
  return category.permissions.filter(key => Boolean(definitions[key]));
}

function permissionDescription(category, key, label, descriptions) {
  return permissionPresentation[key]?.description
    || descriptions[key]
    || (category.key === 'module' ? `允许进入“${label}”。` : `允许执行“${label}”。`);
}
```

Move module-backed keys into the `module` category without duplication:

```js
'manage_activity_corrections', 'view_users',
'manage_protected_customers', 'manage_data_maintenance'
```

Remove those keys from `customer` or `admin`. Keep `manage_customer_recycle` as a customer action with its current-product display mapping. In both `permissionCategoryMarkup()` and `permissionFields()`, derive `visiblePermissions`, use `permissionDescription()`, and append:

```html
<p class="permission-category-status">
  本分类共 ${visiblePermissions.length} 项，<span class="permission-desktop-status">已完整显示，无需滚动</span><span class="permission-mobile-status">全部权限均在当前分类中</span>
</p>
```

Change `viewPermissions.team` from `view_customers` to `view_team` so the menu
and direct page navigation use the same permission as the team-status APIs.

- [ ] **Step 4: Run focused presentation tests and verify GREEN**

Run: `node --test test/issue293_permission_group_modal.test.js test/issue291_permission_modal_ui.test.js test/issue229_permission_modal.test.js`

Expected: all tests PASS. If Issue #291's old `overflow:auto` assertion is the only failure, leave it for Task 2 where the layout contract changes.

- [ ] **Step 5: Commit Task 1**

```bash
git add sales-assets/app.js test/issue293_permission_group_modal.test.js
git commit -m "fix: align permission editor with current modules"
```

---

### Task 2: Wide Desktop-No-Scroll Group Modal

**Files:**
- Modify: `sales-assets/app.js:9614-9628`
- Modify: `sales-assets/app.css:237-260`
- Modify: `sales-assets/app.css:977-985`
- Modify: `test/issue293_permission_group_modal.test.js`
- Modify: `test/issue291_permission_modal_ui.test.js`

**Interfaces:**
- Consumes: the category markup and status produced by Task 1.
- Produces: `permission-group-modal`, `permission-group-form`, `permission-group-metadata`, `permission-group-footer`, and responsive no-scroll layout contracts.

- [ ] **Step 1: Add failing layout tests**

Add assertions that `openPermissionGroupModal()` passes `permission-group-modal`, the form uses dedicated metadata/footer classes, and CSS includes:

```js
assert.match(css, /\.permission-group-modal\{[^}]*width:min\(1320px,calc\(100vw - 48px\)\)/);
assert.match(css, /\.permission-group-modal\{[^}]*overflow:hidden/);
assert.match(css, /\.permission-group-modal \.permission-switch-panel\{[^}]*overflow:visible/);
assert.match(css, /\.permission-group-footer\{[^}]*position:sticky/);
assert.match(css, /@media\(max-width:1099px\)[\s\S]*permission-group-modal[\s\S]*overflow:auto/);
assert.match(app, /aria-controls="permission-group-panel-/);
assert.match(app, /role="tabpanel"/);
assert.match(app, /ArrowLeft|ArrowRight/);
assert.match(app, /event\.key === 'Home'|event\.key === 'End'/);
```

Replace the Issue #291 test that requires every `.permission-switch-panel` to scroll with assertions scoped to `.permission-modal-wide` for personal permissions and `.permission-group-modal` for the group editor.

- [ ] **Step 2: Run layout tests and verify RED**

Run: `node --test test/issue293_permission_group_modal.test.js test/issue291_permission_modal_ui.test.js test/issue229_permission_modal.test.js`

Expected: FAIL because the group modal still has only class `modal`, width 620px, and generic scrolling.

- [ ] **Step 3: Implement the dedicated group shell**

Update `openPermissionGroupModal()` to render:

```html
<form id="permissionGroupForm" class="form-grid permission-group-form">
  <div class="form-grid two permission-group-metadata">...</div>
  <label class="permission-group-description">...</label>
  <div class="recommendation permission-group-guidance">...</div>
  <div class="permission-editor">...</div>
  <div class="permission-group-footer">...</div>
</form>
```

Pass `permission-group-modal` as the fourth argument to `openModal()`.

Give group and personal category renderers stable prefixes. Each selected tab
has `tabindex="0"`; unselected tabs have `tabindex="-1"`; every tab's
`aria-controls` references a panel whose `aria-labelledby` points back to the
tab. Add `role="tabpanel"` to panels. Extend the existing document keydown
handler so Left/Right wrap through enabled category tabs, Home selects the first,
End selects the last, and selection delegates to the existing click handler.

Add desktop CSS with these exact constraints:

```css
.permission-group-modal{width:min(1320px,calc(100vw - 48px));max-height:calc(100dvh - 32px);overflow:hidden}
.permission-group-modal .modal-body{min-height:0;overflow:hidden;padding:16px 24px 0}
.permission-group-form{max-height:calc(100dvh - 112px);grid-template-rows:auto auto auto minmax(0,1fr) auto;gap:10px;overflow:hidden}
.permission-group-modal .permission-switch-panel{max-height:none;overflow:visible;padding-right:0}
.permission-group-footer{position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 -24px;padding:12px 24px;border-top:1px solid var(--line);background:#fff;z-index:1}
.permission-category-status{margin:9px 0 0;color:var(--muted);font-size:10px}
.permission-mobile-status{display:none}
```

At `max-width:1099px` or `max-height:760px`, allow the group modal/body to scroll and use two columns. At `max-width:700px`, use one column, show `.permission-mobile-status`, hide `.permission-desktop-status`, and stack the footer without fixed-width buttons.

- [ ] **Step 4: Run layout and regression tests and verify GREEN**

Run: `node --test test/issue293_permission_group_modal.test.js test/issue291_permission_modal_ui.test.js test/issue229_permission_modal.test.js test/sales_access_ui.test.js test/crm_ui_polish_shell.test.js`

Expected: all tests PASS, with personal-permission modal scroll behavior unchanged.

- [ ] **Step 5: Commit Task 2**

```bash
git add sales-assets/app.js sales-assets/app.css test/issue293_permission_group_modal.test.js test/issue291_permission_modal_ui.test.js
git commit -m "fix: expand permission group editor layout"
```

---

### Task 3: Confirmed Role-Default Reset With Hidden-Key Preservation

**Files:**
- Modify: `sales-assets/app.js:9614-9628`
- Modify: `sales-assets/app.js:10380-10398`
- Modify: `sales-assets/app.js:10935-11005`
- Modify: `sales-assets/app.js:11879-11887`
- Modify: `test/issue293_permission_group_modal.test.js`
- Modify: `test/permission_group_api.test.js`

**Interfaces:**
- Consumes: `state.data.rolePermissions`, `permissionsFromPayload(payload, fallback)`, existing permission-group PATCH API, and Task 2 footer.
- Produces: `permissionGroupRole(form, group)`, `applyPermissionGroupDefaults(form, defaults)`, inline confirmation controls, and `form.dataset.permissionsReset` serialization state.

- [ ] **Step 1: Add failing reset and compatibility tests**

Add source contract tests for these exact behaviors:

```js
assert.match(groupModal, /id="restorePermissionGroupDefaults"/);
assert.match(groupModal, /只恢复当前权限组的权限开关/);
assert.match(groupModal, /个人权限例外、其他权限组、名称、角色和描述不会改变/);
assert.match(groupModal, /保存权限组后生效/);
assert.match(app, /form\.dataset\.permissionsReset = 'true'/);
assert.match(submit, /form\.dataset\.permissionsReset === 'true'/);
assert.match(submit, /state\.data\.rolePermissions/);
```

Extend `test/permission_group_api.test.js` with a real API test that:

1. creates a sales group with hidden keys different from `ROLE_PERMISSIONS.sales`;
2. assigns `U-OTHER` to the group and adds a personal override;
3. PATCHes the group with the full role template;
4. verifies the group's hidden keys match the template;
5. verifies the user's personal override row and effective override remain unchanged.

- [ ] **Step 2: Run reset tests and verify RED**

Run: `node --test test/issue293_permission_group_modal.test.js test/permission_group_api.test.js`

Expected: UI contract FAIL because no group reset exists. The API preservation test may already pass, documenting the backend contract before frontend implementation.

- [ ] **Step 3: Implement inline confirmation and reset form state**

For existing groups, render the footer with a left-side button:

```html
<button type="button" class="button secondary" id="restorePermissionGroupDefaults">恢复权限组默认</button>
```

Render a hidden inline confirmation before the footer:

```html
<div class="permission-group-reset-confirm hidden" role="alert">
  <p><strong>恢复当前权限组默认？</strong><br>只恢复当前权限组的权限开关；个人权限例外、其他权限组、名称、角色和描述不会改变。保存权限组后生效。</p>
  <div class="assignment-actions">
    <button type="button" class="button secondary" id="cancelPermissionGroupDefaults">暂不恢复</button>
    <button type="button" class="button primary" id="confirmPermissionGroupDefaults">确认恢复</button>
  </div>
</div>
```

Add helpers that derive the role from the existing group or enabled role select and update only rendered `permission__*` switches. Confirming sets `form.dataset.permissionsReset = 'true'`; cancelling leaves all values unchanged. Changing the role for a new group reapplies the role template and clears stale reset state.

In submit handling, select the fallback exactly as follows:

```js
const groupRole = existingGroup?.role || payload.role;
const permissionFallback = form.dataset.permissionsReset === 'true'
  ? state.data.rolePermissions?.[groupRole] || {}
  : existingGroup?.permissions || state.data.rolePermissions?.[groupRole] || {};
```

Continue calling `permissionsFromPayload(payload, permissionFallback)` so hidden keys are present in the complete PATCH body.

- [ ] **Step 4: Run reset, API, and personal-permission tests and verify GREEN**

Run: `node --test test/issue293_permission_group_modal.test.js test/permission_group_api.test.js test/issue229_permission_modal.test.js test/permission_groups_migration.test.js`

Expected: all tests PASS. The API test confirms personal overrides survive the group reset semantics.

- [ ] **Step 5: Commit Task 3**

```bash
git add sales-assets/app.js test/issue293_permission_group_modal.test.js test/permission_group_api.test.js
git commit -m "fix: restore permission group role defaults safely"
```

---

### Task 4: Asset Version, Full Verification, And Browser Acceptance

**Files:**
- Modify: `sales-crm.html:9,772-774`
- Modify: exact tests that assert the current CRM asset token
- Modify: `test/issue293_permission_group_modal.test.js`

**Interfaces:**
- Consumes: completed editor behavior from Tasks 1-3.
- Produces: cache token `20260814-issue293-permission-group-editor` and release-ready browser evidence.

- [ ] **Step 1: Add a failing cache-token assertion**

In `test/issue293_permission_group_modal.test.js`, read `sales-crm.html` and assert:

```js
assert.match(html, /app\.css\?v=20260814-issue293-permission-group-editor/);
assert.match(html, /app\.js\?v=20260814-issue293-permission-group-editor/);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test test/issue293_permission_group_modal.test.js`

Expected: FAIL because production assets still use `20260814-issue291-browser-regressions`.

- [ ] **Step 3: Update all CRM asset-token contracts mechanically**

Change the `app.css`, `ui-format.js`, `next-action-time.js`, and `app.js` query token in `sales-crm.html` to `20260814-issue293-permission-group-editor`. Replace every test assertion for the previous token with the new token. Do not change shared filter-component tokens.

- [ ] **Step 4: Run static checks and focused tests**

Run:

```bash
git diff --check
node --check sales-assets/app.js
node --test test/issue293_permission_group_modal.test.js test/issue291_permission_modal_ui.test.js test/issue229_permission_modal.test.js test/permission_group_api.test.js test/sales_access_ui.test.js
```

Expected: exit 0 and all focused tests PASS.

- [ ] **Step 5: Run the full core suite**

Run: `npm test`

Expected: 1143 existing tests plus the new Issue #293 tests, zero failures.

- [ ] **Step 6: Perform browser acceptance without leaving production data changed**

Start an isolated local server with a copied test database. Use an administrator session and verify:

- 1668x1000 and 1280x800: modal is near viewport width, active panel has no internal scrollbar, footer is visible, and all three categories switch.
- The modal contains no `客户回收站` or `客户开发工作台` and contains each required current module name.
- Every visible card has a description and the category count matches visible switches.
- Cancel reset leaves switches unchanged.
- Confirm reset changes visible switches, save persists the complete role template, refresh preserves it, and personal overrides remain unchanged.
- 390x844: one-column cards scroll vertically without overlap; footer actions remain reachable.
- Browser console has no errors.

Restore the copied database fixture or discard the isolated runtime after the check. Do not mutate production during this acceptance step.

- [ ] **Step 7: Commit Task 4**

```bash
git add sales-crm.html test sales-assets/app.js sales-assets/app.css
git commit -m "test: verify issue 293 permission editor acceptance"
```

# Issue 296 Manager Assistance Submit No-Response Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "请求主管协助" (request manager assistance) submission always produce a visible, correct outcome: either the assistance request is saved (manager task created) or the user receives a clear inline error — never a silent no-op.

**Architecture:** Fix the root cause in the frontend activity modal (native constraint validation rejects hidden inactive-mode fields, so the `submit` event never fires), add a submit feedback fallback, and relax the backend plan-pairing rule for manager requests so a text-only original plan is accepted. Keep the backend manager-task pipeline (`addActivity` → `upsertManagerTask` → `notifyManagerTaskRecipients`) unchanged.

**Tech Stack:** Node.js, Express, better-sqlite3, SQLite, vanilla JS, `node:test`, jsdom-based UI tests (existing pattern in `test/issue291_browser_regressions.test.js`).

## Root Cause (verified on production 08eca7e, 2026-08-14)

Reproduction (sales account `bo@crm.local`, customer RU-0090 with an expired `next_action_at`):

1. Customer RU-0090 has `next_action_at = 2026-08-14 04:42:00` (UTC) — already in the past at test time.
2. `openActivityModal()` renders the activity form with all four mode sections in the DOM. `planNextActionAt` (plan section) and `managerNextActionAt` (manager section) are prefilled from the customer's `next_action_at` via `storedPlanDateInputWithBasis()`.
3. `constrainFutureDateTimes()` sets `min = now` on every `[data-future-datetime]` input, so the prefilled past value becomes `rangeUnderflow` invalid.
4. The user switches to the "请求主管协助" tab. `setActivityModalMode('manager')` only toggles `.hidden` classes — the plan section stays in the DOM with `display:none`.
5. Clicking `#activitySubmit` (default `type="submit"`) runs native constraint validation. **`display:none` controls are NOT exempt from constraint validation** (only `disabled` and `type=hidden` are). A hidden invalid `planNextActionAt` fails validation → **the `submit` event is never dispatched** → the frontend handler never runs → no fetch, no toast, no state change. User sees "点击提交无反应".

CDP evidence from the reproduction (`/tmp/issue296/repro3.cjs`):
- `#activitySubmit` type = `submit`, form id = `activityForm`, `activityMode` = `manager`, reason filled.
- `submitCount: 0` (a capture-phase submit listener never fired), `net: []`, `toast: ''`, `modalStillOpen: true`, `submitDisabled: false`.
- `form.checkValidity() === false`; `form.querySelector(':invalid')` = `planNextActionAt` (hidden section).
- `form.requestSubmit()` also silently aborts (it runs constraint validation first).

Secondary findings (same modal):
- `progress` mode is unaffected because its `nextActionAt` defaults to a future date (`dateInput(2)`).
- The intake-master-profile path (`openIntakeMasterProfile`, e.g. RU-0436) leaves `selectedCustomerId = ''`, so even when validation passes the submit shows a misleading toast "请先搜索并选择客户" instead of prefilling the current customer. (Related UX defect, fixed opportunistically in Task 2.)
- After the validation fix, a manager request with text but no time would hit backend `下一步计划和计划时间必须同时填写` (400) — needs the backend pairing exemption (Task 3).
- `#294`/`#295` (cache-busting) are NOT the cause; the bug reproduces on the current production bundle.

## Baseline (PENDING — do not start until confirmed)

> **Blocking dependency:** Issue #293 (权限组编辑弹窗) must be merged, deployed, and its production gate passed BEFORE this plan's implementation begins. The baseline SHA below must be re-verified at execution time.

- [ ] Fetch `origin/main` after #293 merges; record `git rev-parse origin/main`.
- [ ] Confirm production `/healthz` returns the same full SHA with `database=ok`.
- [ ] Confirm `current` tracked files match `origin/main` (no in-place hot patch).
- [ ] Create worktree and branch `codex/issue-296-manager-assistance-submit` from that baseline.
- [ ] Run the focused baseline tests and record results.

## Global Constraints

- Start from refreshed `origin/main` at or after the #293 merge commit; never from the dirty local `main` checkout.
- Do not edit `/Users/ylf/Desktop/projects/tradepulse-production/current` directly.
- Do not change the backend manager-task pipeline semantics (task creation, recipients, due date, evidence contacts).
- No new schema changes; no production data migration.
- Every UI change must keep role/permission defense in place (`record_activity` gate in `openActivityModal`, server-side `assertPermission`).
- Every task must pass its focused tests and the full `npm test` before merge.
- Deploy and verify this issue alone; do not bundle with other issues.

---

### Task 1: Exempt inactive activity-modal sections from constraint validation

**Files:**
- Modify: `sales-assets/app.js` (`setActivityModalMode`)
- Test: `test/issue296_activity_modal_constraints.test.js` (new, jsdom UI contract test following `test/issue291_browser_regressions.test.js` patterns)

**Interfaces:**
- `setActivityModalMode(mode)` additionally disables every `input`, `select`, `textarea` inside the three non-active mode sections (`#activityProgressFields`, `#activityPlanFields`, `#activityNoPlanFields`, `#activityManagerFields`) and enables the active section's controls.
- Disabled controls are exempt from native constraint validation and are excluded from `FormData`, so inactive sections can never block submission or leak stale values into the payload.

- [ ] **Step 1: Write failing UI contract tests**

Assert, for each mode (`progress`, `plan`, `noPlan`, `manager`):
- Only the active section's controls are enabled; the other three sections' controls are `disabled`.
- `form.checkValidity()` (jsdom stubs native behavior; assert payload assembly instead) — cover payload: switching to `manager` and submitting produces a payload containing `managerReason`/`managerNextAction` and NOT `planNextActionAt`/`planNextAction`/`progressType`.
- Switching back to `progress` re-enables progress controls and the modal still submits.

- [ ] **Step 2: Run the test and confirm failures**

Run: `node --test test/issue296_activity_modal_constraints.test.js`  
Expected: FAIL (controls are not disabled / payload contains inactive-section fields).

- [ ] **Step 3: Implement section-level control disabling in `setActivityModalMode`**

```js
function syncActivityModeSections(mode) {
  const form = $('#activityForm');
  if (!form) return;
  const sections = {
    progress: $('#activityProgressFields'),
    plan: $('#activityPlanFields'),
    noPlan: $('#activityNoPlanFields'),
    manager: $('#activityManagerFields'),
  };
  Object.entries(sections).forEach(([key, section]) => {
    if (!section) return;
    section.querySelectorAll('input, select, textarea').forEach(el => {
      el.disabled = key !== mode;
    });
  });
}
```
Call `syncActivityModeSections(mode)` inside `setActivityModalMode` (after the `.hidden` toggles). Verify every mode's submit path only reads its own section's fields (`progress`: `progressType/reactionOptionId/summary/nextAction/nextActionAt`; `plan`: `planNextAction/planNextActionAt/planNote`; `noPlan`: `noPlanReason`; `manager`: `managerReason/managerNextAction/managerNextActionAt`) plus shared hidden inputs.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/issue296_activity_modal_constraints.test.js`  
Expected: PASS.

- [ ] **Step 5: Manual browser check of payload integrity for RFQ step**

`showActivityRfqStep(true)` stays inside the progress section; confirm RFQ fields (`reference`, `bomLines`, `expectedValue`, `completeness`, `productCategory`) remain enabled in progress mode and are still submitted when the RFQ step is used.

- [ ] **Step 6: Run full regression subset**

Run: `node --test test/issue291_browser_regressions.test.js test/issue157_today_task_ui.test.js test/issue275_master_profile_form.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add sales-assets/app.js test/issue296_activity_modal_constraints.test.js
git commit -m "fix: exempt inactive activity modal sections from constraint validation"
```

### Task 2: Submit feedback fallback + intake master-profile prefill + approved manager-field copy/UI

**Files:**
- Modify: `sales-assets/app.js` (submit handling near `form.id === 'activityForm'`; `openIntakeMasterProfile`/`renderCustomerProfileHeader`; manager field section markup in `openActivityModal`)
- Test: extend `test/issue296_activity_modal_constraints.test.js`

**Approved design (gist https://gist.github.com/edwinwu218-boop/df7ffbf93d06adc198e11ac766d1ba83):**
- `申请原因` → `需要主管协助的原因`.
- `销售原计划` → `原计划`, with the original time shown as read-only text next to it (e.g. `原定 2026/08/14 12:42`).
- **Remove the editable `managerNextActionAt` datetime input** — the original plan time is informational only; sales must not mistake it for the assistance plan time. Consequence: manager-mode payloads never carry `nextActionAt` (empty), which makes the Task 3 backend pairing exemption mandatory (text-only original plan).

**Interfaces:**
- `#activitySubmit` click path guarantees a visible outcome: before relying on native submission, run `form.checkValidity()`; if invalid, call `form.reportValidity()` and, when the first `:invalid` control lives in a hidden section (should be impossible after Task 1), toast "存在未完成的必填项或无效时间，请检查表单" instead of staying silent.
- `openActivityModal` (or the modal open call site `#customerProfileActivity`) prefills the customer from the intake master profile context when `customerId` is empty but `state.customerProfileExternalId` maps to a CRM account; if no CRM account exists, keep the explicit "请先搜索并选择客户" but make it a modal-level inline error (not only a 2.3s toast).

- [ ] **Step 1: Extend tests**

Assert: clicking submit with an invalid visible field shows an error (toast or inline); with all valid fields the request fires; intake master-profile open with a known `externalCustomerId` prefills `customerId` in the modal when the account is present in `state.data.accounts`.

- [ ] **Step 2: Implement the fallback**

Add a click handler for `#activitySubmit` (or reuse the delegated click handler) that performs the validity check and, on failure, ensures a visible error before any native submission; keep the existing `document` submit delegation as the single submit path.

- [ ] **Step 3: Prefill intake master-profile customer**

In the `#customerProfileActivity` click path, when `state.selectedCustomerId` is empty, resolve `state.customerProfileExternalId` against `state.data.accounts` and call `openActivityModal(matchedAccount.id)`; otherwise keep current behavior with an inline error explaining that the lead is not in CRM yet ("该线索未进入 CRM，无法记录跟进").

- [ ] **Step 4: Run focused + regression tests**

Run: `node --test test/issue296_activity_modal_constraints.test.js test/issue291_browser_regressions.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/app.js test/issue296_activity_modal_constraints.test.js
git commit -m "fix: guarantee visible feedback on activity submit and prefill master-profile customer"
```

### Task 3: Backend pairing exemption for manager assistance requests

**Files:**
- Modify: `lib/sales_crm.js` (`addActivity`)
- Test: `test/issue296_manager_assistance_payload.test.js` (new, fixture style of `test/issue291_manager_assistance_loop.test.js`)

**Interfaces:**
- When `managerRequired` is true, the `下一步计划和计划时间必须同时填写` pairing check is skipped (text-only original plan allowed; `nextActionAt` may be empty — mandatory after Task 2 removes the editable `managerNextActionAt` input).
- When `managerRequired` is true, `crm_accounts.next_action/next_action_at` are NOT overwritten by the original-plan snapshot (the original plan lives only in `crm_manager_tasks.evidence_json.originalPlan`); the existing manager-required/status update still applies.
- Existing behavior for non-manager activities is unchanged.

- [ ] **Step 1: Write failing backend tests**

Fixture (based on `test/issue291_manager_assistance_loop.test.js` `progressPayload`):
- `managerRequired: true, nextAction: '希望主管协助查询联系人', nextActionAt: ''` → `POST /api/sales-crm/activities` returns 200, manager task created, `evidence_json.originalPlan` present, account `next_action` unchanged.
- `managerRequired: true, summary: ''` → still 400 (reason required).
- Non-manager activity with mismatched plan/time → still 400.

- [ ] **Step 2: Run and confirm failures**

Run: `node --test test/issue296_manager_assistance_payload.test.js`  
Expected: FAIL on the pairing check and/or account overwrite.

- [ ] **Step 3: Implement**

In `addActivity`, guard the pairing check with `&& !managerRequired`, and when `managerRequired`, run the account UPDATE with `next_action = account.next_action, next_action_at = account.next_action_at, next_action_time_basis = account.next_action_time_basis` (i.e. keep the customer's current plan; snapshot goes to evidence only).

- [ ] **Step 4: Run focused tests**

Run: `node --test test/issue296_manager_assistance_payload.test.js test/issue291_manager_assistance_loop.test.js`  
Expected: PASS (existing loop tests unchanged).

- [ ] **Step 5: Run full suite**

Run: `npm test`  
Expected: exit code `0`, no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/sales_crm.js test/issue296_manager_assistance_payload.test.js
git commit -m "fix: allow text-only manager assistance plans without overwriting customer plan"
```

---

## Execution gates

### Gate A: before starting (baseline)

- [ ] Issue #293 merged and deployed; production gate passed.
- [ ] `git rev-parse origin/main` == GitHub `main` == production `/healthz` `releaseSha`.
- [ ] Worktree + branch `codex/issue-296-manager-assistance-submit` created.
- [ ] Baseline focused tests recorded.

### Gate B: before merge

- [ ] Task focused tests pass (`node --test test/issue296_*.test.js`).
- [ ] `npm test` exit code `0` (full suite).
- [ ] Route authorization / data-scope review: no new routes; existing `record_activity` and server-side scope intact.
- [ ] No production path, database, backup, or generated report staged in the PR.
- [ ] `git diff --check` clean; PR CI green.

### Gate C: after deployment

- [ ] Production `/healthz` `releaseSha` equals the merged commit.
- [ ] Browser matrix (admin, manager, sales):
  - Sales on a customer with an expired `next_action_at` (RU-0090 class): switch to 请求主管协助, fill reason, submit → success toast + manager task appears under 主管介入任务.
  - Same customer, submit with reason empty → visible inline error.
  - Progress / plan / no-plan modes still submit normally (regression).
  - Admin opening an intake master profile with a CRM account (RU-0436 class) → activity modal prefills the customer or shows a clear non-CRM explanation.
- [ ] Record screenshots, release SHA, and timestamp in Issue #296.
- [ ] Update Issue #296 with the root-cause summary and this plan link.

## Commit and release boundaries

Task 1 and Task 2 are frontend-only; Task 3 is backend. Merge as one PR (or two sequential PRs if review prefers: UI first, backend second) — do not deploy between Task 1 and Task 3, because the pairing exemption and the validation fix are one user-visible fix. If a rollback is needed, the whole PR reverts together.

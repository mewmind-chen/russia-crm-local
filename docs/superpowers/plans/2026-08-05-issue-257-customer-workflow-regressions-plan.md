# Issue #257 Customer Workflow Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Fix all six regressions in GitHub Issue #257, prove them with regression tests, and deploy the merged release through the guarded Mac deployment flow.

**Architecture:** Keep the existing CRM, today-task, manager-task, intake, and drawer boundaries. Add one shared reason-visibility rule, extend the existing manager-task schema with a persisted `manager_assistance` reason, and make the frontend consume backend-derived state for assignment and history interactions. Keep legacy production `sales_return` records read-only.

**Tech Stack:** Node.js 22, Express, SQLite/better-sqlite3, browser JavaScript, Node test runner, GitHub CLI, zsh deployment scripts.

## Global Constraints

- Never modify production data directly during implementation or smoke testing.
- Sales must not receive or resolve manager-only tasks.
- Existing customer-scope and `403` permission checks remain authoritative.
- Profile PATCH requests must not include `nextAction` or `nextActionAt`.
- Returned CRM customers must keep their original CRM ID and history.
- Do not migrate or delete historical production `sales_return` rows.
- Every behavior change gets a failing regression test before production code.
- Deploy only merged `origin/main`, then verify the exact SHA on local and public `/healthz`.

---

### Task 1: Install the isolated runtime and capture the clean baseline

**Files:**
- Read: `package.json`, `package-lock.json`, `README.md`, `scripts/deploy-from-github.sh`
- Modify: none

**Interfaces:**
- Produces a working Node 22 dependency tree and baseline verification evidence.

- [ ] **Step 1: Install locked dependencies**

```bash
npm ci
```

Expected: exit `0`; dependencies match `package-lock.json`.

- [ ] **Step 2: Run the full baseline suite**

```bash
npm test -- --test-concurrency=1
```

Expected: record exact pass/fail counts before implementation.

- [ ] **Step 3: Run syntax and deployment checks**

```bash
node --check server.js
node --check scripts/deploy-state.js
zsh -n scripts/deploy-from-github.sh
bash -n deploy/backup.sh
```

Expected: every command exits `0`.

- [ ] **Step 4: Confirm runtime artifacts are ignored**

```bash
git status --short
```

Expected: `node_modules` is not shown.

---

### Task 2: Filter manager-only today-task reasons before grouping

**Files:**
- Create: `test/issue257_today_task_visibility.test.js`
- Modify: `lib/sales_crm.js:3099`
- Modify: `lib/business_page_filters.js:368`

**Interfaces:**
- Consumes individual alert reasons.
- Produces grouped alerts whose reason count, urgency, primary reason, totals, and actions contain only reasons visible to the effective user.

- [ ] **Step 1: Write failing bootstrap and list tests**

Create a sales-owned customer with `manager_required=1`. Assert sales bootstrap and `/lists/alerts` exclude `MANAGER_NEEDED`, while a scoped manager sees it. Add a mixed-reason case and assert the sales row retains the sales reason with recalculated `reasonCount`, primary title, urgency, and summary totals.

- [ ] **Step 2: Verify RED**

```bash
node --test test/issue257_today_task_visibility.test.js
```

Expected: FAIL because sales currently receives `MANAGER_NEEDED`.

- [ ] **Step 3: Implement the shared visibility rule**

Add a helper equivalent to:

```js
function canSeeTodayTaskReason(user, reason) {
  if (reason?.code !== 'MANAGER_NEEDED') return true;
  return ['admin', 'manager'].includes(String(user?.role || ''))
    && hasPermission(user, 'resolve_manager_tasks')
    && hasPermission(user, 'view_team')
    && hasPermission(user, 'view_alerts');
}
```

Apply it before grouping in both bootstrap and business-page paths. Keep the direct completion `403` and action authorization.

- [ ] **Step 4: Verify GREEN and regressions**

```bash
node --test test/issue257_today_task_visibility.test.js test/issue116_business_page_filters.test.js test/issue157_today_task_actions.test.js
```

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/sales_crm.js lib/business_page_filters.js test/issue257_today_task_visibility.test.js
git commit -m "fix: hide manager-only reasons from sales today tasks"
```

---

### Task 3: Persist sales-initiated manager assistance

**Files:**
- Create: `test/issue257_manager_assistance_task.test.js`
- Modify: `lib/manager_tasks.js`
- Modify: `lib/sales_crm.js:addActivity/completeManagerAssistanceTodayTask/manager task APIs`
- Modify: `lib/business_page_filters.js`
- Modify: `sales-assets/app.js`

**Interfaces:**
- Produces `crm_manager_tasks.reason='manager_assistance'` with stable idempotency, evidence, intervention history, and completed state.
- Existing manager-task list/detail/export response shapes remain compatible.

- [ ] **Step 1: Write failing schema migration tests**

Build a legacy manager-task schema without `manager_assistance`, insert an existing task and intervention, run schema installation, then assert all IDs survive, insertion of `manager_assistance` succeeds, and `PRAGMA foreign_key_check` is empty.

- [ ] **Step 2: Write failing request/completion tests**

Record an activity with `managerRequired=true` and assert one open task exists with requester/activity evidence. Replay the request and assert no duplicate. Complete the today task as manager and assert the task is completed, one intervention exists, one `manager_join` activity exists, and the existing audit row exists.

- [ ] **Step 3: Verify RED**

```bash
node --test test/issue257_manager_assistance_task.test.js
```

Expected: FAIL because the schema rejects the new reason and no manager task is created.

- [ ] **Step 4: Extend the schema safely**

Add `manager_assistance` to task reasons, completion labels, and filters. Detect legacy table SQL and rebuild `crm_manager_tasks` with the full existing column list, copied rows, recreated indexes, restored foreign keys, and a post-migration `foreign_key_check`.

- [ ] **Step 5: Create the task in the activity transaction**

After inserting an activity with `managerRequired=true`, call `upsertManagerTask` with idempotency key ``manager-assistance:${activityId}``, customer external ID, requester/owner snapshots, request timestamp, summary, outcome, and activity ID. Notify only eligible scoped manager recipients.

- [ ] **Step 6: Complete the task in the today-task transaction**

Locate the active manager-assistance task, write the existing `manager_join` activity and customer/audit changes, insert one immutable intervention containing result/activity ID, and update task status/result/resolver fields before returning.

- [ ] **Step 7: Add UI/filter/export labels**

Expose `销售请求经理协助` in task reason filters, cards, detail modal, and export. Completed rows remain read-only and show request/processing history.

- [ ] **Step 8: Verify GREEN and manager regressions**

```bash
node --test test/issue257_manager_assistance_task.test.js test/issue170_manager_tasks.test.js test/issue170_manager_api.test.js test/issue157_today_task_actions.test.js
```

Expected: zero failures and no duplicate assistance task.

- [ ] **Step 9: Commit**

```bash
git add lib/manager_tasks.js lib/sales_crm.js lib/business_page_filters.js sales-assets/app.js test/issue257_manager_assistance_task.test.js
git commit -m "feat: persist manager assistance in supervisor tasks"
```

---

### Task 4: Align returned-lead assignment and recycle defaults

**Files:**
- Create: `test/issue257_returned_lead_assignment.test.js`
- Modify: `lib/sales_crm.js:loadIntakeState/manageIntake/listRecycleBin`
- Modify: `sales-assets/app.js:intakeItemAssignable/renderIntake/recycle state`
- Modify: `sales-crm.html`

**Interfaces:**
- Intake rows expose `assignable` and `assignmentBlockReason` derived from backend assignment rules.
- Recycle-bin requests default to `mismatch`; explicit legacy `sales_return` remains readable.

- [ ] **Step 1: Write failing returned-row tests**

Create a returned intake linked to its active returned CRM account. Assert the API row is assignable and the frontend selection path accepts it. Assert ordinary active duplicates and review rows remain blocked.

- [ ] **Step 2: Write failing cleanup/default tests**

Return a pre-claim assigned row as sales and assert owner/suggestion/assigned/claim timestamps are cleared. Request recycle-bin without `kind` and assert it uses `mismatch`; request explicit `sales_return` and assert legacy data remains readable.

- [ ] **Step 3: Verify RED**

```bash
node --test test/issue257_returned_lead_assignment.test.js
```

Expected: FAIL on frontend assignability, pre-claim cleanup, and default recycle kind.

- [ ] **Step 4: Add backend-derived assignment fields**

Reuse `manualAssignmentBlockReason` and returned-account detection. Return `assignable=true` only for eligible `pending`, `approved`, or `returned` rows with no block reason.

- [ ] **Step 5: Clear pre-claim assignment state**

In `manageIntake` return action, clear `assigned_owner_id`, `suggested_owner_id`, `assigned_at`, `claim_due_at`, and `claimed_at` with the status update.

- [ ] **Step 6: Consume backend state and update recycle presentation**

Use `item.assignable` in selection/counts with a conservative fallback. Display `assignmentBlockReason` for blocked rows. Change initial and view-entry recycle kind to `mismatch`; update tabs/copy without deleting legacy backend support.

- [ ] **Step 7: Verify GREEN and returned-flow regressions**

```bash
node --test test/issue257_returned_lead_assignment.test.js test/issue241_return_mismatch.test.js test/issue96_intake_crm_invariant.test.js test/issue212_lead_pool_frontend.test.js
```

Expected: zero failures; returned accounts reuse the original CRM ID.

- [ ] **Step 8: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js sales-crm.html test/issue257_returned_lead_assignment.test.js
git commit -m "fix: align returned leads and recycle defaults"
```

---

### Task 5: Separate customer profile editing from next plans

**Files:**
- Create: `test/issue257_profile_plan_separation.test.js`
- Modify: `sales-assets/app.js:openCustomerProfileEditModal/profile submit`

**Interfaces:**
- Profile markup and PATCH payload contain no plan fields.
- Existing dedicated plan flows and backend future-time validation remain unchanged.

- [ ] **Step 1: Write failing contract tests**

Assert `customerProfileEditForm` has no `nextAction`/`nextActionAt`. Submit profile-only PATCH for a customer with a past plan and assert profile data saves while the plan remains unchanged. Assert an independent plan operation still rejects a past timestamp.

- [ ] **Step 2: Verify RED**

```bash
node --test test/issue257_profile_plan_separation.test.js
```

Expected: FAIL because the form and submit path currently include plan fields.

- [ ] **Step 3: Remove plan fields and conversions**

Remove plan inputs, legacy plan notes, future-time constraint mounting, and profile-submit `apiTime` conversion for plan fields. Do not change backend PATCH plan rules or reactivation validation.

- [ ] **Step 4: Verify GREEN and profile regressions**

```bash
node --test test/issue257_profile_plan_separation.test.js test/issue246_unified_profile_edit.test.js test/issue149_progress_backend.test.js
```

Expected: profile saves independently; dedicated plans remain strict.

- [ ] **Step 5: Commit**

```bash
git add sales-assets/app.js test/issue257_profile_plan_separation.test.js
git commit -m "fix: decouple customer profile edits from plans"
```

---

### Task 6: Fix alert redaction and customer-history feedback

**Files:**
- Create: `test/issue257_drawer_alert_history.test.js`
- Modify: `lib/access_control.js`
- Modify: `lib/sales_crm.js` if a structure-specific projection is needed
- Modify: `sales-assets/app.js:renderDrawer/history modal`
- Modify: `test/issue227_creator_timeline.test.js` only if existing assertions need replacement

**Interfaces:**
- Business alert copy survives contact redaction; actual contact data remains absent.
- One drawer command opens a visible modal containing activity and lifecycle history states.

- [ ] **Step 1: Write failing redaction tests**

Pass a mixed object containing alert `title/detail/action` and contact `email/phone/contactTitle`. Assert alert copy survives while contact data is removed. Add an HTTP bootstrap assertion for a no-contact-permission account.

- [ ] **Step 2: Write failing history interaction tests**

Assert drawer source exposes one history action, does not render an alert card without meaningful display text, and opens a modal with visible loading, empty, success, and error states instead of appending `customerHistoryList` below the timeline.

- [ ] **Step 3: Verify RED**

```bash
node --test test/issue257_drawer_alert_history.test.js test/issue227_creator_timeline.test.js
```

Expected: FAIL because generic business keys are redacted and history is rendered outside the current viewport.

- [ ] **Step 4: Narrow contact redaction**

Remove generic business keys from global recursive contact redaction and use existing structure-specific safe projections for contact-bearing records. Keep email, phone, contact names/titles, contact summaries, raw evidence, and report payloads protected.

- [ ] **Step 5: Add the alert completeness guard**

Render the alert card only when `title`, `detail`, or `action` contains meaningful text. Keep alert reason codes and severity available for task logic.

- [ ] **Step 6: Consolidate customer history into the modal**

Replace the inline history list with one action that opens the timeline modal immediately in loading state, fetches lifecycle history, merges or separates event groups clearly, and renders success/empty/error inside the modal. Preserve endpoint scope checks.

- [ ] **Step 7: Verify GREEN and permission regressions**

```bash
node --test test/issue257_drawer_alert_history.test.js test/issue227_creator_timeline.test.js test/issue116_business_page_filters.test.js
```

Expected: zero failures; contact secrets stay redacted.

- [ ] **Step 8: Commit**

```bash
git add lib/access_control.js lib/sales_crm.js sales-assets/app.js test/issue257_drawer_alert_history.test.js test/issue227_creator_timeline.test.js
git commit -m "fix: restore alert copy and history feedback"
```

---

### Task 7: Run cross-workstream verification and integrate

**Files:**
- Modify: GitHub Issue #257 comments/status through `gh`
- Modify: implementation documentation only when evidence changes it

- [ ] **Step 1: Run all Issue #257 tests**

```bash
node --test test/issue257_*.test.js
```

Expected: zero failures.

- [ ] **Step 2: Run the full core suite serially**

```bash
npm test -- --test-concurrency=1
```

Expected: zero failures and no unhandled warnings.

- [ ] **Step 3: Run syntax/deployment checks**

```bash
node --check server.js
node --check lib/sales_crm.js
node --check lib/manager_tasks.js
node --check lib/business_page_filters.js
node --check sales-assets/app.js
zsh -n scripts/deploy-from-github.sh
bash -n deploy/backup.sh
```

Expected: all exit `0`.

- [ ] **Step 4: Review final diff**

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Expected: only Issue #257 implementation, tests, and documentation.

- [ ] **Step 5: Push and create PR**

```bash
git push -u origin codex/fix-sales-manager-assistance-tasks
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/fix-sales-manager-assistance-tasks --title "fix: resolve issue 257 customer workflow regressions" --body-file docs/planning/2026-08-05-six-customer-workflow-regressions-issue.md
```

Expected: PR URL referencing #257.

- [ ] **Step 6: Wait for CI and merge**

```bash
pr_number="$(gh pr view codex/fix-sales-manager-assistance-tasks --repo mewmind-chen/russia-crm-local --json number --jq .number)"
gh pr checks "$pr_number" --repo mewmind-chen/russia-crm-local --watch
gh pr merge "$pr_number" --repo mewmind-chen/russia-crm-local --squash --delete-branch=false
```

Expected: required checks pass and `origin/main` contains the merged release.

---

### Task 8: Deploy and verify production

**Files:**
- Create: `docs/evidence/issue-257-verification.md`
- Read: `scripts/deploy-from-github.sh`, `scripts/verify-release-gate.sh`, `README.md`

- [ ] **Step 1: Record merged SHA**

```bash
git fetch origin main
git rev-parse origin/main
```

Expected: a 40-character SHA containing the merged PR.

- [ ] **Step 2: Run guarded deployment**

```bash
zsh scripts/deploy-from-github.sh --force
```

Expected: candidate `npm ci`, full tests, backup, atomic switch, service restart, local health, and public health succeed; failures roll back automatically.

- [ ] **Step 3: Verify health independently**

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
curl --fail --silent --show-error https://crm.newmindchen.com/healthz
```

Expected: both return `ok=true`, `database="ok"`, and the exact merged `releaseSha`.

- [ ] **Step 4: Run read-only production smoke checks**

Verify role-specific today tasks, manager-assistance history, returned-row assignability, mismatch recycle default, profile form assets, alert rendering, and customer-history modal without mutating a production customer.

- [ ] **Step 5: Record evidence and close #257**

Write target SHA, test counts, backup/release paths, health summaries, smoke results, and rollback status to `docs/evidence/issue-257-verification.md`. Commit/push the evidence and close #257 only after the evidence is available on GitHub.

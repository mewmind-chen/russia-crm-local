# Issue #257 Customer Workflow Regressions Design

## Goal

Resolve the six production workflow regressions tracked by GitHub Issue #257 while preserving existing permission isolation, customer history, returned-customer reuse, plan validation, audit history, and deployment rollback guarantees.

## Scope

The release covers four bounded workstreams:

1. Today-task visibility and manager-assistance persistence.
2. Returned-lead assignment and recycle-bin presentation.
3. Customer-profile editing and next-plan separation.
4. Customer-drawer alert redaction and history interaction.

Production `sales_return` history is not migrated or deleted in this release. The UI stops treating that legacy category as the normal recycle-bin entry point, while the existing records remain available for later audited migration or archival.

## Architecture

### 1. Role-aware today-task reasons

Today-task visibility is applied to individual reasons before customer grouping, primary-reason selection, pagination totals, and summary counts.

`MANAGER_NEEDED` is visible only when the effective user:

- is an administrator or manager;
- has `resolve_manager_tasks`;
- can access the customer through the existing account scope.

Sales users do not receive this reason in bootstrap or authorized-list responses. Direct attempts to complete manager assistance continue to return `403`.

The same helper is used by `lib/sales_crm.js` and `lib/business_page_filters.js` so the initial payload and paginated list cannot diverge.

### 2. Persistent manager-assistance tasks

The existing `crm_manager_tasks` model remains the single source for supervisor work. It is extended with a fourth reason, `manager_assistance`.

When a sales activity sets `managerRequired=true`, the activity transaction also upserts one open manager task for that request. Its evidence contains:

- request activity ID;
- requester ID and snapshot name where available;
- request time;
- request summary/outcome;
- current owner snapshot.

The idempotency key is based on the request activity ID, so repeated HTTP submissions cannot create duplicate tasks. A later manager-assistance request may create a new task only after the previous task has completed.

The existing manager-task table has a SQLite `CHECK` constraint on `reason`. Schema installation detects legacy table SQL and performs a guarded table rebuild that:

- disables foreign-key enforcement only around the immediate migration;
- copies every existing task unchanged;
- extends the reason constraint with `manager_assistance`;
- recreates all existing indexes;
- restores foreign-key enforcement;
- passes `foreign_key_check` and preserves intervention references.

Completing assistance from Today Tasks resolves the matching active manager task in the same database transaction that writes the `manager_join` activity, updates the customer, and writes the audit row. The task result records the manager response and the linked activity ID. A `manager_advice` intervention row is written for the immutable processing history.

The supervisor task list, detail view, filters, export, labels, and completed summary recognize `manager_assistance`. Completed tasks remain read-only in the existing detail modal.

Threshold tasks continue to use the existing three automatic reasons. The release does not add a scheduler for threshold scans because it is independent from the six reported regressions; that deployment concern remains documented but is not required to persist sales-initiated manager assistance.

### 3. Returned-lead assignment and recycle-bin semantics

The intake response exposes a backend-derived assignment decision for every row:

- `assignable`: boolean;
- `assignmentBlockReason`: empty for eligible rows, otherwise a user-facing reason.

The decision reuses the same returned-account and duplicate-account rules used by manual assignment preview/commit. Frontend selection, page select-all, bulk counts, and row affordances consume these fields instead of reimplementing CRM-link rules.

Returned rows linked to their original active `assignment_status=returned` CRM account are assignable and retain the original CRM ID and development history. Ordinary active duplicates, protected customers, review items, claimed rows, rejected rows, and hand-deleted customers remain blocked.

For the pre-claim sales return path, the intake row clears `assigned_owner_id`, `suggested_owner_id`, `assigned_at`, `claim_due_at`, and `claimed_at` so all returned rows have the same pool state.

The recycle-bin default changes from `sales_return` to `mismatch`. The visible categories and explanatory copy describe only mismatch and manual deletion as current recycle operations. Legacy `sales_return` remains readable through the backend for audit and future migration but is not the default user workflow.

### 4. Customer profile and next-plan separation

The unified customer-profile modal keeps customer master fields and authorized management fields but removes `nextAction` and `nextActionAt`.

Profile PATCH requests never include plan fields. Existing dedicated activity, deferred-plan, today-task, and manager-task flows remain responsible for plan creation and continue to enforce future timestamps. Reactivating a terminal customer still uses the existing explicit workflow that requires a new plan.

### 5. Contact redaction and alert rendering

Generic recursive contact redaction no longer treats common business keys such as `title`, `detail`, `action`, `summary`, `reason`, and `nextAction` as globally sensitive.

Contact-bearing payloads use the existing structure-specific safe projections or contact-specific fields for protection. Tests verify that email, phone, contact names/titles, contact summaries, raw evidence, and other actual contact data remain redacted.

The drawer also guards alert rendering: an alert card is rendered only when it contains meaningful display content. This is defense in depth, not the primary permission fix.

### 6. Customer history interaction

The two competing history commands are consolidated into one clear drawer action. It opens the existing timeline modal and loads the on-demand lifecycle history into a visible loading state before rendering results.

The modal distinguishes activity timeline events from lifecycle/audit events without placing newly loaded content below the current drawer viewport. Loading, empty, success, and error states remain visible in the modal. The history endpoint and customer-scope authorization are unchanged.

## Data Integrity

- Manager-task schema migration preserves all task and intervention IDs.
- Manager-assistance creation and completion are idempotent.
- Customer return and reassignment continue to reuse the original CRM account.
- No production customer or recycle record is deleted or rewritten by a deployment migration.
- Existing audit tables remain append-only.
- Deployment creates the standard SQLite online backup before switching releases.

## Permissions

- Sales can request manager assistance but cannot read or resolve supervisor tasks.
- Managers and administrators require `resolve_manager_tasks` and existing customer scope.
- Intake selection requires existing `manage_intake` authorization.
- Contact redaction continues to respect `view_contacts`.
- Profile editing continues to respect `edit_customer` and related field-level UI permissions.

## Testing Strategy

Every behavior change follows red-green TDD.

Backend tests cover:

- sales/manager today-task reason visibility in bootstrap and paginated lists;
- mixed-reason regrouping and counts;
- manager-assistance task creation, deduplication, completion, history, and rollback;
- legacy manager-task schema migration and foreign-key integrity;
- backend-derived intake assignability and pre-claim return cleanup;
- recycle-bin default semantics and preservation of legacy rows;
- profile PATCH behavior without plan fields;
- contact redaction that protects contacts without deleting alert copy.

Frontend tests cover:

- returned-row checkboxes and disabled reasons;
- profile form plan-field removal;
- alert-card completeness guard;
- a single visible customer-history action with loading/error/empty/success states;
- manager-assistance labels and completed read-only history.

The full core suite, syntax checks, deployment-script checks, and production candidate validation must pass before merge.

## Release Process

1. Implement and verify on `codex/fix-sales-manager-assistance-tasks` in the existing isolated worktree.
2. Commit the tested changes and push the branch.
3. Create a pull request referencing #257 and wait for required CI.
4. Merge to `main` only after CI passes.
5. Run `scripts/deploy-from-github.sh --force`, which fetches `origin/main`, validates the candidate with `npm ci` and the full test suite, creates the production database backup, atomically switches the release, restarts services, and rolls back on failure.
6. Verify local and public `/healthz` return `ok=true`, `database=ok`, and the exact merged release SHA.
7. Perform read-only production smoke checks for manager tasks, lead-pool visibility, recycle-bin defaults, profile editing markup, and customer-history assets.
8. Close #257 only after deployment and smoke evidence are recorded.

## Non-Goals

- Bulk migration or deletion of historical `sales_return` production records.
- Redesign of all manager-task trigger settings.
- New background scheduling infrastructure for threshold-task scans.
- Unrelated CRM UI refactoring.
- Changes to AI feature flags, providers, workers, or production credentials.

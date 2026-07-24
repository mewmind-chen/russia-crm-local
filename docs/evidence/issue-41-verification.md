# Issue #41 verification evidence

- Verification date: 2026-07-24 (Asia/Shanghai)
- Verified branch: `codex/issue-41-access-governance`
- Base production/main commit: `73f2e7b3aa4744db05b9c6f131e702a1979639da`
- Focused access-governance, permission, integration, and UI suites: 78 passed, 0 failed
- Full isolated suite: 431 passed, 0 failed, 0 cancelled, 0 skipped
- Static checks: `git diff --check` and Node syntax checks for `lib/sales_crm.js`, `lib/access_control.js`, and `sales-assets/app.js` passed

## Access-governance coverage

- `export_data` defaults to enabled for administrators and disabled for manager and sales groups. Export tests cover scope filtering, contact suppression, empty-scope arrays, migration identity fields, attachment naming, and credential-key absence.
- Customer reads and direct writes use the same account scope. Users without `view_all_customers` only receive owned accounts; unassigned accounts require both `view_all_customers` and `manage_intake`.
- Sales-created customers are forced to the current sales owner. Administrators can create unassigned customers, and `created_by` is recorded without guessing a creator for historical rows.
- Bulk assignment validates at most 500 distinct customer IDs and the active sales target before one immediate transaction. Failed validation leaves every owner unchanged; assignment and unassignment update linked intake state in the same transaction.
- Archive revokes all target sessions and removes the user from active assignment options. Restore reactivates the account. Permanent deletion returns `409 USER_REFERENCED` with sanitized counts for historical business, audit, configuration, or integration references.
- Password reset continues to use salted hashes, requires confirmation, creates no temporary-password state, and revokes existing target sessions.
- Suggested assignment is rendered only when both a real owner ID and owner name are present.

## Browser verification

The candidate ran on an isolated disposable database with all AI feature flags explicitly false.

- Desktop 1440 x 900: CRM customer list, export action, selection/bulk-owner controls, active and archived user sections, and customer profile rendered without page-level horizontal overflow or overlap.
- Mobile 390 x 844: the customer bulk bar stayed within x=15..360; the new-user modal stayed within x=20..370 and remained vertically scrollable; no page-level horizontal overflow was present.
- With AI disabled, the AI task navigation and customer-fit station were hidden.
- Customer profile grid regression: at 390 x 844 the iframe occupied y=178..829 (651 px) and ended exactly at the profile view bottom; at 1440 x 900 it occupied y=147..830 (683 px) and again ended at the view bottom.
- A mapped disposable customer profile loaded through the embedded workbench with zero browser console errors.

## Production-copy migration rehearsal

The live production database was read only through SQLite online backup. All migration writes were confined to the disposable backup copy.

- Live database before rehearsal: `PRAGMA quick_check=ok`, journal mode `wal`.
- Backup size: 43,151,360 bytes; SHA-256 `0ebcee305d80f3686fbf6210443354db55d6fd14114ca92226fa66f997a12bf2`.
- Before migration: 9 CRM accounts, 5 users, 38 sessions; `crm_accounts.owner_id` was `NOT NULL`; foreign-key violations: 0.
- After migration: 9 CRM accounts, 5 users, 38 sessions; `owner_id` was nullable; `created_by` existed with an empty historical default; nonzero `must_change_password` rows: 0; foreign-key violations: 0; `quick_check=ok`.
- Nullable-owner transaction probe changed one copied account to unassigned, observed one nullable owner, rolled back, and returned to zero unassigned rows.
- Default migrated groups reported `export_data`: admin=1, manager=0, sales=0.
- A second `crm:setup` run was idempotent and preserved all counts, schema constraints, foreign keys, and `quick_check=ok`.

## Release boundary

- Current production release during verification: `73f2e7b3aa4744db05b9c6f131e702a1979639da`.
- Confirmed rollback release before merge: `92e9f609026e`.
- Production deployment remains gated on the pull request merge commit, GitHub CI success, a fresh online backup plus `quick_check`, explicit false AI flags, exact-SHA health verification, and post-deploy smoke tests.

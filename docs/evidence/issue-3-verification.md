# Issue #3 verification evidence

- Verification date: 2026-07-22 (Asia/Shanghai)
- Verified branch: `codex/issue-3-access-groups-impersonation`
- Verified commit: `bebf919ba3546a9e54f3e38a9392889137d32ff5`
- Full isolated suite at final HEAD: 133 tests, 133 passed, 0 failed, 0 cancelled, 0 skipped (`node --test`)
- Static hygiene: `git diff --check` clean; no runtime reads or writes of `sales_users.permissions_json` remain outside the migration helper in `lib/permission_groups.js`, the schema-compatibility column in `lib/sales_crm.js`, and migration/regression tests and fixtures; no TBD/TODO/FIXME placeholders left in Issue #3 scope

## Production-copy migration rehearsal

- Source database: online SQLite `.backup` copy of the production database (the live database was never opened for write); the copy ran `npm run crm:setup` migrations and a disposable verification server on port 3310, then was deleted
- Users after migration: 5 (1 admin, 2 manager, 2 sales), all `active=1`, each mapped to the permission group matching their role
- Permission keys migrated: 25 per user; pre/post snapshot comparison: 0 mismatches
- Schema spot-check on the migrated copy: `sales_sessions` carries the four impersonation columns (context id, real user, expiry, ended-at), and `crm_audit_log` carries `real_user_id`, `effective_user_id`, `impersonation_context_id`

## HTTP-level end-to-end run against the migrated production copy

Server and asset checks:

- Server started cleanly (no startup errors); `GET /` 200; `GET /sales-assets/app.js` 200; unauthenticated bootstrap 401
- Admin bootstrap 200 with `realUser.id = USR-ADMIN`, `impersonation = null`, 3 permission groups, and per-user `permissionGroupId` / `permissionOverrideCount` fields

Last-admin invariant (two administrators, five scenarios):

1. Admin deactivates the second admin: 200
2. Admin deactivates themselves as the last valid admin: 409
3. Admin restores the second admin: 200
4. Second admin deactivates the first admin: 200
5. Second admin applies `manage_users: deny` to themselves as the last valid admin: 409

Password and session lifecycle:

- Admin-created sales user logged in with the initial password: 200; session bootstrap before reset: 200
- Permanent admin password reset (with double confirmation): 200
- Old session cookie after reset: 401; old password after reset: 401
- New password login: 200 with `mustChangePassword = false`

Identity inspection (impersonation):

- Start inspection as the sales user: 200; bootstrap shows effective user = sales id, real user = `USR-ADMIN`
- Write inside the inspected sales user's own scope: 200
- Write across scope (another owner's account): 403
- Audit row for the scoped write carries `user_id` = sales id, `real_user_id` = `USR-ADMIN`, `effective_user_id` = sales id, `impersonation_context_id` = `IMP-…` (dual identity recorded)
- Stop inspection: 200
- Start inspection as a manager: 200; manager-scope write: 200; audit row carries the same dual-identity triple plus context id
- Recon actions blocked during inspection: `createReconJob` 403 `IMPERSONATION_ACTION_BLOCKED`, `retryReconJob` 403 `IMPERSONATION_ACTION_BLOCKED`, `createContactReconJob` 403 `IMPERSONATION_ACTION_BLOCKED`
- Recon job counts unchanged across the blocked attempts: `recon_jobs` 86 → 86, `contact_recon_jobs` 786 → 786
- After forcibly expiring the impersonation context in the copy: write returns 409 `IMPERSONATION_ENDED` and the activity count did not change; the next bootstrap recovers to the real admin (`impersonation = null`)

## Known pre-existing behavior observed during verification

- `addAccount` generates a fallback `CUS-…` master id when no `externalCustomerId` is supplied, which conflicts with the `customer_pool` customer-id format triggers (`[A-Z][A-Z]-[0-9][0-9][0-9][0-9]`). Both the fallback and the triggers exist unchanged on `origin/main`, so this is not an Issue #3 regression; the verification run created accounts linked to existing `customer_pool` master rows, which succeeded (200)

## Browser screenshots

- Not captured in this environment: no browser automation tool was available to the verification agent. Desktop and mobile captures remain to be taken by the main agent with `kimi-webbridge`: permission group list and edit form, user table, three-state override editor, password reset double-confirmation, identity inspection banner, and hidden navigation while inspecting a sales user

All verification data was written only to a disposable copy of the production database; the copy and the temporary verification scripts were removed after the run. The production database was touched exclusively through the SQLite online backup API.

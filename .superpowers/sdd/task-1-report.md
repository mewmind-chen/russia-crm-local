# Task 1 Report: Permission Group Schema and Legacy Migration

## Implementation

- Added `lib/permission_groups.js` with the requested installation, hydration, effective-permission, and override-validation helpers.
- `installPermissionGroups(db)` creates `permission_groups` and `user_permission_overrides`, adds `sales_users.permission_group_id` when needed, and converts each legacy role/permission record into a role default group plus only the required allow/deny overrides.
- The migration runs in a SQLite transaction. It records each user's legacy effective permissions before changes and compares every known permission to the post-migration result before committing.
- Default groups are derived from the current `ROLE_PERMISSIONS` values. Repeated installs preserve system groups and existing overrides.
- `installSalesCrm()` installs permission groups after `permissions_json` is guaranteed to exist, and repeats installation after first-run user seeding so seeded users receive default group IDs.
- Runtime authorization continues to use the legacy access-control path. The legacy `permissions_json` column is retained.

## Files

- Created: `lib/permission_groups.js`
- Created: `test/permission_groups.test.js`
- Modified: `lib/sales_crm.js`

## RED

Command:

```sh
/opt/homebrew/bin/node --test test/permission_groups.test.js
```

Result: failed as expected before implementation with `Error: Cannot find module '../lib/permission_groups'`. Test runner summary: 0 passed, 1 failed.

## GREEN

Command:

```sh
/opt/homebrew/bin/node --test test/permission_groups.test.js
```

Result: passed. Both tests succeeded:

- `legacy migration preserves every effective permission and is idempotent`
- `hydrated permissions ignore later legacy permissions_json changes`

Test runner summary: 2 passed, 0 failed.

## Full Suite

Command:

```sh
/opt/homebrew/bin/node --test
```

Result: passed. Test runner summary: 94 passed, 0 failed, 0 skipped, duration 19128 ms.

## Self-Review

- The schema uses the exact role set and allow/deny effect checks required by the task.
- Migration persists only legacy values that differ from the matching role default, preserving the legacy effective object without duplicating defaults.
- Repeated installation does not duplicate default groups or override rows.
- Hydration obtains permissions from the permission-group tables, so later changes to `permissions_json` do not affect hydrated permissions.
- The `sales_crm` integration runs after `ensureUserPermissionColumns` and immediately after `seedUsers`, without changing existing runtime access-control reads.
- `git diff --check` completed without whitespace errors.

## Concerns

None identified for Task 1. Future tasks must switch runtime authorization and user-management writes from `permissions_json` to the new group/override model; that intentionally remains out of scope here.

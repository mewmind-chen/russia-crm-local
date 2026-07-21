# Task 3 Report: Permission Group, Override, and Last-Admin APIs

## Delivered

- Added permission-group list, create, and update APIs plus exact access-control policies.
- Added `PUT /api/sales-crm/users/:userId/permission-overrides` with `inherit`, `allow`, and `deny` semantics.
- Moved personal permission edits out of `PATCH /users/:userId`; account changes now accept only account fields and require a matching group when changing role.
- Enforced the last-valid-admin invariant transactionally for group creation/edit, override replacement, role/group changes, and active-status changes. Violations return HTTP 409 with `LAST_ADMIN_REQUIRED` and roll back.
- Added permission-group and override metadata to safe bootstrap users. Bootstrap returns group metadata only to users with `view_users`.
- Added the missing `crm_migration_review` schema used by the existing admin-only bootstrap path.

## Test Evidence

### RED

Command:

```sh
/opt/homebrew/bin/node --test test/permission_group_api.test.js
```

Result before implementation: 0 passing, 5 failing. The failures demonstrated the intended missing behavior:

- `POST /permission-groups` was denied as an unmapped route.
- Bootstrap did not expose `permissionGroups`.
- Unknown group permissions reached an unmapped route instead of validation.
- Last-admin account edits returned 200 instead of 409.
- `PATCH /users/:userId` still accepted the legacy `permissions` field.

### GREEN

Command:

```sh
/opt/homebrew/bin/node --test test/permission_group_api.test.js test/permission_integration.test.js test/access_control.test.js
```

Result: 54 passing, 0 failing.

### Full Suite

Command:

```sh
/opt/homebrew/bin/node --test
```

Result: 103 passing, 0 failing (13.15 seconds).

## Changed Files

- `lib/permission_groups.js`
- `lib/access_control.js`
- `lib/sales_crm.js`
- `test/permission_group_api.test.js`
- `test/helpers/permission_fixture.js`
- `test/access_control.test.js`
- `test/permission_integration.test.js`

## Self-Review

- Group and override writes validate known permission keys and boolean/tri-state values before mutation.
- All invariant-protected writes use `better-sqlite3` transactions; thrown invariant errors roll back the mutation.
- Runtime effective permissions continue to come from groups and override rows, not `sales_users.permissions_json`.
- Error handlers preserve `statusCode` and include the invariant error code.
- User-facing safe shapes omit legacy `permissions_json` while exposing effective permissions, group metadata, and overrides.

## Concerns

- User creation continues to accept the Task 2 compatibility `permissions` payload. Task 4's plan explicitly changes creation to require an explicit matching group and removes that compatibility payload, so this task leaves that change for Task 4.

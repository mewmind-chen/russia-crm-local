# Task 2 Report: Effective Permission Runtime and Test Fixtures

## Outcome

Runtime authorization now consumes only hydrated `user.permissions`. Session resolution, login responses, Sales payload user lists, and direct test user boundaries hydrate effective group plus override permissions before they reach permission checks or response serializers.

## RED Evidence

1. Added `permissionsFor trusts only hydrated group permissions` to `test/access_control.test.js`.
2. Ran `/opt/homebrew/bin/node --test test/access_control.test.js` before production changes.
3. Result: 7 passing, 1 failing. The new assertion expected `false` but received `true` for `{ role: 'admin', permissions_json: '{"view_users":true}' }`, proving `permissionsFor` still relied on role defaults and legacy JSON.
4. Converted fixture users to group-backed identities and added the existing-session group/override regression. Ran `/opt/homebrew/bin/node --test test/permission_integration.test.js` before runtime hydration.
5. Result: 23 passing, 16 failing. The new existing-session test returned 403 on its initial expected 200 because raw session rows carried no hydrated `permissions`, proving the database boundary needed hydration.

## GREEN Evidence

1. Replaced role/default and legacy JSON authorization resolution with normalized booleans from `user.permissions` only.
2. Hydrated users at session, login, and Sales payload user-list boundaries.
3. Added group-backed fixture users and `setUserPermissions(userId, patch)`, which manages overrides relative to the assigned group's defaults.
4. Updated integration mutations to use that helper; the session test now proves a group change takes effect on the next request and an individual allow override restores access before a deny removes it again.
5. Ran `/opt/homebrew/bin/node --test test/access_control.test.js test/sales_crm.test.js test/permission_integration.test.js`.
6. Result: 56 passing, 0 failing.

## Full Suite Evidence

1. First complete run found `test/assistant_scope.test.js` passing raw `sales_users` rows directly to `buildAccessContext`; this correctly resulted in no permissions under the new contract.
2. Updated both direct test boundaries to use `hydrateUserPermissions`, matching the runtime contract.
3. Re-ran the affected file: `/opt/homebrew/bin/node --test test/assistant_scope.test.js` produced 8 passing, 0 failing.
4. Final run: `/opt/homebrew/bin/node --test` produced 96 passing, 0 failing in 13.1 seconds.

## Files Changed

- `lib/access_control.js`: `permissionsFor` normalizes only hydrated permissions and defaults all unknown or omitted keys to false.
- `lib/sales_crm.js`: hydrates session users, login users, and loaded Sales user lists.
- `test/helpers/permission_fixture.js`: seeds group-backed users and exposes override-based `setUserPermissions`.
- `test/access_control.test.js`: adds the legacy-only denial regression and uses hydrated account-scope fixtures.
- `test/sales_crm.test.js`: uses hydrated permission fixtures.
- `test/permission_integration.test.js`: replaces direct legacy mutations with override changes and verifies immediate group/override session updates.
- `test/assistant_scope.test.js`: hydrates direct test-boundary rows before building access contexts.

## Self-Review

- `permissionsFor` returns every known permission key with a boolean value and ignores `permissions_json` entirely.
- `requireSalesUser`, `requireUnifiedUser`, `accountScope`, `safeUser`, and server capabilities receive the hydrated session user through `sessionUser`.
- Login serialization and Sales user lists receive hydrated data at their own query boundaries.
- Test scans show no test writes to `sales_users.permissions_json` outside explicit migration compatibility tests; the remaining integration group write targets `permission_groups.permissions_json` by design.
- `git diff --check` passed.

## Concerns

- Existing user create/update endpoints still write the legacy permission field. It is intentionally no longer authoritative at runtime; replacing those mutations with group/override management is deferred by this task's stated scope.

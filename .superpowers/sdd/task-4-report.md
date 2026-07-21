# Task 4 Report: Permanent Passwords and Administrator Reset

## Scope Delivered

- New accounts require an explicit, role-matching permission group and persist with `must_change_password=0`.
- Legacy inline `permissions` are rejected at account creation; permission variation remains on the dedicated override endpoint.
- Added an administrator-only `POST /api/sales-crm/users/:userId/password-reset` endpoint.
- Resets validate double entry and length, reject self-targets, replace the hash and salt, clear the forced-change flag, and revoke every target session in one SQLite transaction.
- Password-reset routes are normalized before generic user routes for policy and anonymous audit handling.
- Audit tests prove reset request details exclude password input, password storage field names, and the prior session credential.

## TDD Evidence

### RED

Command:

```sh
/opt/homebrew/bin/node --test test/admin_password_reset.test.js
```

The initial runnable RED test failed for the intended missing behavior: a newly created user had `must_change_password=1`, and reset requests returned `403` because the route had no policy mapping. A test syntax error in the first draft was corrected before this RED confirmation.

### GREEN

Command:

```sh
/opt/homebrew/bin/node --test test/admin_password_reset.test.js
```

Result: 4 passed, 0 failed. Coverage includes permanent creation, reset session revocation, old/new login behavior, confirmation and self-reset validation, manager/sales rejection, explicit group validation, legacy permission rejection, and audit redaction.

## Full Suite Evidence

Command:

```sh
/opt/homebrew/bin/node --test
```

Result: 109 passed, 0 failed.

## Files Changed

- `lib/access_control.js`
- `lib/sales_crm.js`
- `test/access_control.test.js`
- `test/admin_password_reset.test.js`
- `test/permission_integration.test.js`

## Self-Review

- Confirmed the reset policy is explicit and normalized before the generic `/users/:userId` match.
- Confirmed reset authorization is checked both by route permissions and by the service-level administrator role check.
- Confirmed credential replacement and session deletion are within one SQLite transaction.
- Confirmed self-service `changePassword` behavior was not altered.
- Confirmed audit payload redaction remains in place and is exercised by an API test without recording credential material in this report.

## Concerns

None.

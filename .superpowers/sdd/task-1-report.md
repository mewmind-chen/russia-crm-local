# Task 1 Report: SHA-aware health endpoint

## Implementation summary

- Added `lib/release_health.js` with `healthPaths`, `readReleaseSha`, `readDatabaseStatus`, and `registerReleaseHealth`.
- Registered unauthenticated `GET /healthz` in `createApp()` after security middleware and before Sales CRM authenticated routes.
- The endpoint performs a read-only `SELECT 1 AS ok` against SQLite and returns only `{ ok, database, releaseSha }`.
- Added real temporary SQLite/database HTTP tests for healthy, unavailable-database, and absent-release-metadata states.

## RED evidence

Command:

```sh
node --test test/release_health.test.js
```

Result before implementation: 3 failing tests. The healthy and missing-release-metadata cases received `404` instead of the expected status, and the unavailable-database case attempted to parse the route's `404` HTML as JSON. This confirms the failure was the missing `/healthz` route.

## GREEN evidence

Command:

```sh
node --test test/release_health.test.js && npm test
```

Result: the focused health suite passed 3/3 tests. The full suite passed 155/155 tests with 0 failures.

## Files changed

- `lib/release_health.js`
- `server.js`
- `test/release_health.test.js`
- `.superpowers/sdd/task-1-report.md`

## Self-review

- SHA data is accepted only as a 40-character hexadecimal value, normalized to lowercase, and otherwise reported as `unknown`.
- SQLite is opened with `readonly: true` and `fileMustExist: true`; only a read-only query is issued.
- Error responses expose neither filesystem paths nor database error details.
- The route is registered ahead of Sales CRM's route registration and requires no authentication.
- `git diff --check` completed without whitespace errors.

## Concerns

`registerSalesCrm(app)` invokes `installSalesCrm()` during app creation, which creates `CRM_DB_PATH` even when the fixture starts without a database. The unavailable-database fixture therefore removes that startup-created test file after the listener is ready, before issuing its health request. This is the minimal fixture correction needed to exercise the required unavailable-database behavior; production code remains exactly as specified.

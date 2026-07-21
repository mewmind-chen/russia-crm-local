# Issue #4 verification evidence

- Verification date: 2026-07-21 (Asia/Shanghai)
- Verified branch: `codex/issue-4-permission-isolation`, with review fixes based on `db9ab3e`
- Isolated full suite: 92 passed, 0 failed
- Focused permission suites: access control, assistant scope, HTTP permission integration, and legacy prospect migration
- Earlier production-copy permission suite: 40 passed, 0 failed against a SQLite online backup and a second disposable fixture copy
- Browser smoke test: login succeeded; Legacy workbench loaded without application console errors; after a permission was revoked and a protected request returned 403, forbidden navigation, assistant/contact-bearing browser state, and persisted assistant conversations were removed
- Verified status semantics: unauthenticated 401; missing permission/out-of-scope/default-deny 403; authorized missing resource 404 where applicable; invalid input 400
- Sensitive-field evidence: contact email, phone, person name/title, report content, assistant prompts and customer names were not recorded in this file or assistant audit logs

The final review closed six permission gaps:

1. Sales bootstrap contact redaction now covers intake, account, activity, alert, notification, audit, migration, report-link, and free-narrative fields.
2. Contact-restricted assistant SQL views omit contact-bearing narratives, and direct URL fetching is disabled before network access.
3. Prospect promotion cannot reuse an existing customer ID or domain match outside the caller's external-customer scope.
4. `GET /api/initial` performs no preset-tag or automatic-tag writes.
5. Scoped missing and out-of-scope resources both return 403, while full-scope authenticated misses return 404.
6. Legacy prospect tasks receive a valid configured owner or active administrator during migration; tasks without a valid owner remain quarantined.

The fresh independent re-review also closed four Important finding groups:

1. Sales UI and account writes now use explicit permissions instead of role shortcuts.
2. Intake self-actions require a sales user, and reassignment requires an active sales owner.
3. Notifications are constrained to the caller's account scope, assigned intake items, or user-global rows.
4. Contact-safe pool serialization removes `source_file` together with stored narratives and source links.

The source operational database was opened read-only by the backup API. Automated tests wrote only anonymous fixture IDs to disposable SQLite databases and removed those databases after each test.

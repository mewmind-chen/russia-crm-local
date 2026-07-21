# Issue #4 verification evidence

- Verification date: 2026-07-21 (Asia/Shanghai)
- Code baseline: `1b9f272` plus the documentation-only changes in this evidence commit
- Isolated full suite: 76 passed, 0 failed
- Production-copy permission suite: 39 passed, 0 failed
- Production-copy method: SQLite online backup of the local operational database, followed by a second disposable fixture copy
- Consistent copy SHA-256: `f96e14007f93bea5b4354498afeff44b346099a60d077bf149c6455d08849a33`
- Browser smoke test: login succeeded; Legacy workbench loaded without application console errors; after a permission was revoked and a protected request returned 403, forbidden navigation, assistant/contact-bearing browser state, and persisted assistant conversations were removed
- Verified status semantics: unauthenticated 401; missing permission/out-of-scope/default-deny 403; authorized missing resource 404 where applicable; invalid input 400
- Sensitive-field evidence: contact email, phone, person name/title, report content, assistant prompts and customer names were not recorded in this file or assistant audit logs

The source operational database was opened read-only by the backup API. Tests wrote only anonymous fixture IDs to disposable copies and removed those copies after each test.

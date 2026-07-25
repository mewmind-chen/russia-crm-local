# A3-03 `next_action` evidence

Date: 2026-07-25  
Branch: `codex/a3-03-next-action`  
Scope: implement and release the controlled next-action recommendation flow, then stop before A3-04.

## Delivered behavior

- `next_action@v1` is a strict, evidence-bound review contract with `reviewRequired=true`.
- Activity, reply, meeting, RFQ, and quote writes enqueue one idempotent next-action job after the
  business transaction. AI enqueue failure does not roll back the business event.
- The Worker persists a validated result as `needs_review`; it never writes `crm_accounts`.
- The customer page exposes the suggestion, task entry point, editable action/date fields, and
  manager-intervention checkbox.
- `POST /api/sales-crm/ai/jobs/:jobId/next-action/adopt` is the only AI path that can publish a
  next action. It rechecks login, AI permission, customer owner scope, job state, result evidence,
  and one-time consumption, then writes `next_action`, `next_action_at`, and manager state in one
  transaction with an audit row.
- Generic AI review is explicitly denied for `next_action`; existing deterministic SLA alerts keep
  working when AI is disabled, unavailable, stale, or denied.
- AI schema version 11 adds `crm_ai_next_action_consumptions` and migrates existing v10/legacy
  layouts without losing jobs.

## Verification

Commands run in the isolated integration worktree:

```text
node --test test/ai_next_action.test.js
# 7 passed, 0 failed

node --test --test-reporter=dot
# 488 passed, 0 failed

node --check <all modified JavaScript files>
git diff --check
# both passed
```

Focused coverage includes event idempotency, worker execution, strict schema validation, adoption
authorization and scope, duplicate adoption, permission revocation, deterministic SLA fallback,
v10-to-v11 migration, concurrent migration, and legacy-layout migration. The migration and
affected-regression suites were also included in the full 488-test run.

The customer page was checked at desktop width and 390px. The suggestion can be edited before
adoption; no adoption was performed during the UI check.

## Release gate

- Production baseline before release: `a0c645edda0a751ef4491e795179bd19f5801dff`.
- Production hard AI flags were explicitly enabled before this release:
  `CRM_AI_STATIONS_ENABLED=true`,
  `CRM_AI_CUSTOMER_ENRICHMENT_ENABLED=true`,
  `CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED=true`,
  `CRM_AI_SALES_PACK_ENABLED=true`.
- A SQLite online backup was created before switching `current`; both source and backup passed
  `PRAGMA quick_check`, the backup is mode 600, and its SHA-256 is recorded below.
- `previous` was confirmed before the switch and remains the immediate rollback target.

## Production result

Fill these values from the release operator output after merge and deployment:

- Merge commit / release SHA: `<release-sha>`
- Backup path: `<backup-path>`
- Backup SHA-256: `<backup-sha256>`
- Backup quick check: `ok`
- Previous release: `<previous-release>`
- Current release: `<current-release>`
- Local `/healthz`: `ok=true`, `database=ok`, `releaseSha=<release-sha>`
- Public `/healthz`: `ok=true`, `database=ok`, `releaseSha=<release-sha>`
- Homepage: HTTP 200
- Production smoke: controlled activity event accepted; exactly one `next_action` job observed;
  Worker reached `needs_review`; customer `next_action` remained unchanged before adoption.
- Production database after smoke: `quick_check=ok`; AI flags remained enabled; no real customer
  suggestion was adopted.

## Progress handoff

A3-03 moves the project from 27/38 to 28/38 completed tasks. Ten tasks remain. The next task is
A3-04, “消息和认领” (message delivery and claiming). This work stops here and does not implement
A3-04.

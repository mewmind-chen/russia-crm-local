# A1-09 Customer Enrichment Implementation Plan

> **历史资料（已冻结）**：本文记录 2026-07-24 的实现计划，不是当前进度、基线或执行指令。当前判断以 `docs/governance/README.md` 为准。

> **历史原文提示：** 本文当时包含面向执行器的技能与逐项执行要求；这些要求现已失效，不得继续执行。下方复选框只作为历史记录保留。

**Goal:** Let an authorized user create a minimal CRM customer from a company name or website and immediately return, then use the A1-08 control plane to durably orchestrate evidence-backed identity, Recon, contact, fit, completeness, proposal, and review work without changing ownership or bypassing permissions.

**Architecture:** Keep A1-08 as the workflow, concurrency, budget, cancellation, task-center, and audit authority. Keep the existing Python Recon and Contact Recon workers as execution engines. Add a persistent enrichment trigger/run store, deterministic station executors, legacy-task links, and a transactional completion-event outbox. Write only evidence-backed provisional values automatically; route confirmed-field conflicts to review.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3/WAL, Node test runner, vanilla JavaScript/CSS, existing Python Recon workers, existing AI Router and A1-08 worker process.

**Approved design:** `docs/superpowers/specs/2026-07-24-a1-09-customer-enrichment-design.md`

## Global Constraints

- Minimal customer creation requires only `create_customer`.
- Automatic or explicit enrichment requires `view_customers`, `use_ai_assistant`, `run_recon`, `view_recon`, and `view_contacts`.
- Revalidate the actor, permissions, ownership scope, flags, and budget before every node that can call an external capability.
- Sales keep their current owner behavior; managers/admins select an owner. AI never mutates `owner_id`.
- Production flags default off:
  - `CRM_AI_CUSTOMER_ENRICHMENT_ENABLED`
  - `CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED`
- The account transaction may write only local SQLite records. It must not call the Router, model, web, Recon worker, or Contact worker.
- Legacy result data and its completion event must commit atomically.
- Do not silently overwrite employee-confirmed fields.
- Do not deploy production during A1-09 implementation.
- Preserve unrelated user changes in every worktree.

## Branch and Merge Protocol

Before implementation, merge the approved design and this plan to `codex/ai-integration`.

Each milestone starts from the latest `origin/codex/ai-integration` and uses its own branch:

1. `codex/ai-customer-enrichment-a1-09-1`
2. `codex/ai-customer-enrichment-a1-09-2`
3. `codex/ai-customer-enrichment-a1-09-3`
4. `codex/ai-customer-enrichment-a1-09-4`
5. `codex/ai-customer-enrichment-a1-09-5`

For every milestone:

1. Run focused tests and the full regression.
2. Write an evidence artifact under `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/`.
3. Push a code branch and merge a GitHub PR into `codex/ai-integration`.
4. Create a separate docs branch from the new integration head.
5. Update both authoritative planning documents with SHA, tests, evidence, production boundary, progress, and next task.
6. Merge the docs PR into `codex/ai-integration`.
7. Report the final integration SHA and the next milestone.

---

## Milestone A1-09.1: Minimal Creation, Permission Gate, Durable Trigger, and DAG Skeleton

### Task 1: Add Enrichment Run, Link, and Event Schema

**Files:**

- Modify: `lib/ai_stations/schema.js`
- Create: `lib/ai_stations/enrichment/store.js`
- Modify: `scripts/sync-production-customer-data.js`
- Create: `test/ai_customer_enrichment_store.test.js`
- Modify: `test/development_customer_sync.test.js`

**Interfaces:**

- `createCustomerEnrichmentStore(db, options)`
- `createTrigger(input)`
- `getRun(runId)`
- `latestForCustomer(customerId)`
- `claimTrigger(dispatcherId)`
- `markSkipped(runId, reasonCode)`
- `attachWorkflow(runId, workflowId)`
- `linkNode(input)`
- `recordEvent(input)`
- `claimEvent(consumerId)`
- `completeEvent(eventKey, consumerId)`

- [ ] **Step 1: Write failing schema and store tests**

Cover:

- AI schema version increments from 4.
- Creating a run persists customer, account, actor, source, input fingerprint, and initial state.
- Same customer/input/version returns the same active run.
- Competing stores can claim a trigger only once.
- One AI job links to at most one legacy task identity.
- Duplicate completion events return the original row.
- Expired event leases can be reclaimed.
- Development customer sync clears enrichment events, links, and runs in foreign-key-safe order.

Example:

```js
test('competing dispatchers claim one enrichment trigger once', () => {
  const first = store.createTrigger(triggerInput);
  assert.equal(storeA.claimTrigger('dispatcher-a').id, first.id);
  assert.equal(storeB.claimTrigger('dispatcher-b'), null);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/ai_customer_enrichment_store.test.js
```

Expected: FAIL because the enrichment store and schema do not exist.

- [ ] **Step 3: Implement schema version 5 and the minimal store**

Add:

- `crm_ai_enrichment_runs`
- `crm_ai_enrichment_node_links`
- `crm_ai_enrichment_events`

Use:

- CHECK constraints for public run states and route states.
- Unique active input fingerprint semantics.
- Lease owner/expiry columns for triggers and events.
- Foreign keys to `customer_pool`, `crm_accounts`, and `crm_ai_jobs`.
- `INSERT ... ON CONFLICT` or immediate transactions for every claim/idempotency path.

Add all three derived tables to `CLEAR_ONLY_TABLES` before their referenced A1-08 tables, and extend the development-sync regression so a stale enrichment run cannot survive a customer-data refresh.

Do not add evidence or proposal tables yet.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/ai_customer_enrichment_store.test.js test/ai_station_jobs.test.js test/development_customer_sync.test.js
```

Expected: all tests pass, including legacy AI schema migration tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ai_stations/schema.js lib/ai_stations/enrichment/store.js scripts/sync-production-customer-data.js test/ai_customer_enrichment_store.test.js test/development_customer_sync.test.js
git commit -m "feat(ai): add durable customer enrichment runs"
```

### Task 2: Accept Company Name or Website and Persist the Start Gate

**Files:**

- Create: `lib/ai_stations/enrichment/intake.js`
- Create: `lib/ai_stations/enrichment/flags.js`
- Modify: `lib/sales_crm.js`
- Modify: `lib/access_control.js`
- Modify: `test/permission_integration.test.js`
- Create: `test/ai_customer_enrichment_intake.test.js`

**Interfaces:**

- `normalizeMinimalCustomerInput(payload)`
- `resolveCustomerEnrichmentFlags(options)`
- `evaluateEnrichmentStartGate(actor, flags)`
- `createEnrichmentTrigger(db, actor, account, input, options)`

- [ ] **Step 1: Write failing input and API tests**

Cover:

- Company-name-only creation.
- Website-only creation using a normalized URL and provisional hostname label.
- Country is optional.
- Missing both company name and website returns 400.
- Invalid website returns 400.
- Existing explicit owner behavior remains unchanged.
- Feature disabled creates the customer and a `skipped/feature_disabled` run.
- Missing one required permission creates the customer and a `skipped/missing_permissions` run.
- Eligible actor receives a pending enrichment summary.
- No Router or executor is called during the HTTP request.

Example:

```js
assert.equal(response.status, 200);
assert.equal(body.enrichment.state, 'skipped');
assert.equal(body.enrichment.reasonCode, 'missing_permissions');
assert.ok(fx.db.prepare('SELECT 1 FROM crm_accounts WHERE id=?').get(body.customerId));
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/ai_customer_enrichment_intake.test.js test/permission_integration.test.js
```

Expected: FAIL because website-only creation and enrichment summaries are unsupported.

- [ ] **Step 3: Implement normalization and start-gate persistence**

Normalization rules:

- Add `https://` only when a scheme is absent.
- Allow only HTTP(S).
- Lowercase and IDNA-normalize hostname.
- Remove credentials, fragment, default ports, and tracking query parameters.
- Use hostname as a provisional company label for website-only input.
- Preserve the user-entered company name when present.

In the existing `addAccount()` immediate transaction:

- Insert the customer pool record.
- Insert the CRM account.
- Insert the enrichment run with either `pending_dispatch` or `skipped`.

Return:

```js
{
  customerId,
  externalCustomerId,
  enrichment: { runId, state, reasonCode }
}
```

Keep the route permission as `create_customer`; do not add AI permissions to `POST /accounts`.

- [ ] **Step 4: Verify GREEN and regression**

Run:

```bash
node --test test/ai_customer_enrichment_intake.test.js test/permission_integration.test.js test/access_control.test.js
npm test
```

Expected: all tests pass; total test count is at least the current 335-test baseline.

- [ ] **Step 5: Commit**

```bash
git add lib/ai_stations/enrichment/intake.js lib/ai_stations/enrichment/flags.js lib/sales_crm.js lib/access_control.js test/ai_customer_enrichment_intake.test.js test/permission_integration.test.js
git commit -m "feat(crm): create minimal customers with enrichment gates"
```

### Task 3: Dispatch the First Runnable DAG Skeleton

**Files:**

- Create: `lib/ai_stations/enrichment/workflow.js`
- Create: `lib/ai_stations/enrichment/executors.js`
- Modify: `lib/ai_stations/prompt_registry.js`
- Modify: `lib/ai_stations/worker.js`
- Modify: `scripts/ai-station-worker.js`
- Create: `test/ai_customer_enrichment_workflow.test.js`
- Modify: `test/ai_station_worker_process.test.js`

**Interfaces:**

- `createEnrichmentWorkflow(db, run, options)`
- `dispatchPendingEnrichment(db, actorResolver, options)`
- deterministic job types:
  - `intake_precheck`
  - `identity_verify`
  - `recon_dispatch`
  - `recon_collect`
  - `contact_dispatch`
  - `contact_collect`
  - `enrichment_finalize`

- [ ] **Step 1: Write failing workflow tests**

Cover:

- One eligible trigger creates one workflow.
- Competing dispatcher hooks do not duplicate workflows or jobs.
- Jobs use one `workflow_id`, correct parents/dependencies, and stable idempotency keys.
- The first `intake_precheck` executor can run and complete.
- Unimplemented later stages remain dependency-blocked or explicitly skipped in the enrichment projection; no external worker is invoked.
- Dispatcher revalidates current permissions and customer scope.
- Permission revoked between creation and dispatch results in `skipped/permission_revoked`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/ai_customer_enrichment_workflow.test.js test/ai_station_worker_process.test.js
```

Expected: FAIL because no enrichment dispatcher or job types exist.

- [ ] **Step 3: Implement the dispatcher hook and deterministic job registration**

- Extend the registry so deterministic station definitions can be validated without rendering model prompts.
- Add a `beforeClaim` hook to `createAIStationWorker()` and call it before `jobs.claimNext()`.
- Configure the process entry point to drain at most one trigger per loop before claiming a job.
- Rehydrate the actor and rebuild customer access context before DAG creation.
- Enqueue only runnable A1-09.1 behavior; later milestone nodes may be represented in the run projection but must not claim without an executor.
- Keep total customer locking and global slots in A1-08.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/ai_customer_enrichment_workflow.test.js test/ai_station_worker.test.js test/ai_station_worker_process.test.js test/ai_station_jobs.test.js
npm test
```

Expected: all focused and full tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ai_stations/enrichment/workflow.js lib/ai_stations/enrichment/executors.js lib/ai_stations/prompt_registry.js lib/ai_stations/worker.js scripts/ai-station-worker.js test/ai_customer_enrichment_workflow.test.js test/ai_station_worker_process.test.js
git commit -m "feat(ai): dispatch customer enrichment workflows"
```

### Task 4: A1-09.1 Verification and Merge Gate

- [ ] Run:

```bash
node --test test/ai_customer_enrichment_store.test.js test/ai_customer_enrichment_intake.test.js test/ai_customer_enrichment_workflow.test.js test/permission_integration.test.js test/ai_station_worker.test.js test/ai_station_worker_process.test.js
npm test
git diff --check origin/codex/ai-integration...HEAD
git status --short
```

- [ ] Write an evidence artifact containing commands, counts, feature-flag state, no-production-deploy statement, and branch SHA.
- [ ] Push and merge the A1-09.1 code PR.
- [ ] Update both authoritative plan documents in a separate docs PR.
- [ ] Report progress as A1-09.1 complete and A1-09.2 next.

---

## Milestone A1-09.2: Dedupe, Identity Verification, and Evidence

### Task 5: Add Evidence and Field-Provenance Schema

**Files:**

- Modify: `lib/ai_stations/schema.js`
- Create: `lib/ai_stations/enrichment/evidence.js`
- Create: `test/ai_customer_enrichment_evidence.test.js`

- [ ] Write failing tests for URL/time/confidence/version requirements, content hashes, idempotent evidence insertion, contact-sensitive evidence classification, and rejection of evidence-free confirmed values.
- [ ] Run:

```bash
node --test test/ai_customer_enrichment_evidence.test.js
```

Expected: FAIL because the evidence store does not exist.

- [ ] Add `crm_ai_enrichment_evidence` and field provenance metadata needed to distinguish `employee_confirmed` from `ai_provisional`.
- [ ] Implement canonical evidence IDs and safe summaries. Never store full provider prompts or secrets.
- [ ] Re-run the focused test and `test/ai_station_results.test.js`.
- [ ] Commit:

```bash
git add lib/ai_stations/schema.js lib/ai_stations/enrichment/evidence.js test/ai_customer_enrichment_evidence.test.js
git commit -m "feat(ai): persist enrichment evidence provenance"
```

### Task 6: Implement Exact/Fuzzy Dedupe and Identity Verification

**Files:**

- Create: `lib/ai_stations/enrichment/dedupe.js`
- Create: `lib/ai_stations/enrichment/identity.js`
- Modify: `lib/ai_stations/enrichment/intake.js`
- Modify: `lib/ai_stations/enrichment/executors.js`
- Modify: `lib/sales_crm.js`
- Create: `test/ai_customer_enrichment_identity.test.js`
- Modify: `test/ai_customer_enrichment_intake.test.js`

- [ ] Write failing tests for:
  - exact canonical domain duplicate;
  - exact normalized name duplicate;
  - website URL variations;
  - fuzzy name/domain candidates;
  - uncertain official website;
  - legal entity/country evidence;
  - risk precheck;
  - no-evidence field rejection.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_identity.test.js test/ai_customer_enrichment_intake.test.js
```

- [ ] Implement synchronous exact dedupe before record insertion. Return a stable 409 payload with the existing IDs.
- [ ] Implement deterministic candidate scoring for fuzzy duplicates; never merge them automatically.
- [ ] Implement `identity_verify` behind an injected resolver so tests use fixtures and make no network calls.
- [ ] Persist each accepted identity field with evidence and mark uncertain cases `needs_review/identity_uncertain`.
- [ ] Verify GREEN and run:

```bash
node --test test/ai_customer_enrichment_identity.test.js test/ai_customer_enrichment_intake.test.js test/ai_station_scope.test.js
npm test
```

- [ ] Commit:

```bash
git add lib/ai_stations/enrichment/dedupe.js lib/ai_stations/enrichment/identity.js lib/ai_stations/enrichment/intake.js lib/ai_stations/enrichment/executors.js lib/sales_crm.js test/ai_customer_enrichment_identity.test.js test/ai_customer_enrichment_intake.test.js
git commit -m "feat(ai): verify customer identity with evidence"
```

### Task 7: A1-09.2 Verification and Merge Gate

- [ ] Run all A1-09.1/.2 focused tests, `npm test`, `git diff --check`, and clean-status checks.
- [ ] Write the A1-09.2 evidence artifact.
- [ ] Merge the code PR, then the separate authoritative-docs PR.
- [ ] Report A1-09.2 complete and A1-09.3 next.

---

## Milestone A1-09.3: Recon/Contact Adapters and Durable Completion Wakeup

### Task 8: Dispatch and Link Legacy Recon Tasks

**Files:**

- Create: `lib/ai_stations/enrichment/adapters.js`
- Modify: `lib/ai_stations/enrichment/executors.js`
- Modify: `lib/db.js`
- Create: `test/ai_customer_enrichment_adapters.test.js`

- [ ] Write failing tests for:
  - create-or-reuse active Recon job;
  - create-or-reuse active Contact Recon job;
  - unique A1 job/legacy job links under competing dispatchers;
  - actor and scope revalidation before dispatch;
  - budget reservation before external dispatch;
  - `estimated_missing` settlement when exact usage is unavailable.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_adapters.test.js
```

- [ ] Implement dispatch adapters using existing `createReconJob()` and `createContactReconJob()` behavior. Do not duplicate their queues.
- [ ] Store stable legacy IDs and expose them in task detail without leaking restricted content.
- [ ] Implement conservative budget attribution through the existing budget ledger.
- [ ] Verify GREEN with budget and task-center regressions:

```bash
node --test test/ai_customer_enrichment_adapters.test.js test/ai_station_budgets.test.js test/ai_task_center.test.js
```

- [ ] Commit:

```bash
git add lib/ai_stations/enrichment/adapters.js lib/ai_stations/enrichment/executors.js lib/db.js test/ai_customer_enrichment_adapters.test.js
git commit -m "feat(ai): adapt enrichment workflows to recon workers"
```

### Task 9: Add Transactional Completion Events and Recovery

**Files:**

- Modify: `lib/db.js`
- Modify: `lib/ai_stations/enrichment/store.js`
- Modify: `lib/ai_stations/enrichment/adapters.js`
- Modify: `lib/ai_stations/worker.js`
- Create: `test/ai_customer_enrichment_events.test.js`

- [ ] Write failing tests for:
  - Recon result and completion event commit together;
  - Contact result and completion event commit together;
  - rollback leaves neither result nor event;
  - crash after commit but before wakeup is recovered by event consumer;
  - duplicate callbacks advance collect exactly once;
  - event lease expiry permits recovery.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_events.test.js
```

- [ ] Insert completion events inside the existing `submitReconResult()` and `submitContactReconResult()` result transactions only when a linked enrichment node exists.
- [ ] Drain one event before normal job claim. The consumer must use leases and idempotent state transitions.
- [ ] Wake `recon_collect`/`contact_collect`, normalize the result, then mark the event consumed.
- [ ] Verify GREEN:

```bash
node --test test/ai_customer_enrichment_events.test.js test/ai_customer_enrichment_adapters.test.js test/ai_control_plane.test.js
```

- [ ] Commit:

```bash
git add lib/db.js lib/ai_stations/enrichment/store.js lib/ai_stations/enrichment/adapters.js lib/ai_stations/worker.js test/ai_customer_enrichment_events.test.js
git commit -m "feat(ai): recover enrichment completion events"
```

### Task 10: Propagate Cancellation to Legacy Workers

**Files:**

- Modify: `lib/db.js`
- Modify: `scripts/recon_agent_worker.py`
- Modify: `scripts/contact_recon_worker.py`
- Modify: `lib/ai_stations/enrichment/adapters.js`
- Create: `test/ai_customer_enrichment_cancellation.test.js`

- [ ] Write failing tests for cancellation before dispatch, during a legacy lease, and after legacy completion.
- [ ] Assert late results remain evidence-only and cannot auto-merge fields.
- [ ] Add additive cancellation columns to legacy job tables and safe-point checks to both Python workers.
- [ ] Keep cancellation cooperative: do not kill unrelated worker processes.
- [ ] Run:

```bash
node --test test/ai_customer_enrichment_cancellation.test.js test/ai_station_jobs.test.js test/ai_station_worker.test.js
python3 -m py_compile scripts/recon_agent_worker.py scripts/contact_recon_worker.py
npm test
```

- [ ] Commit:

```bash
git add lib/db.js scripts/recon_agent_worker.py scripts/contact_recon_worker.py lib/ai_stations/enrichment/adapters.js test/ai_customer_enrichment_cancellation.test.js
git commit -m "feat(ai): propagate enrichment cancellation"
```

### Task 11: A1-09.3 Verification and Merge Gate

- [ ] Run all A1-09 focused tests, Python syntax checks, `npm test`, `git diff --check`, and clean-status checks.
- [ ] Write the A1-09.3 evidence artifact.
- [ ] Merge the code PR, then the separate authoritative-docs PR.
- [ ] Report A1-09.3 complete and A1-09.4 next.

---

## Milestone A1-09.4: Field Proposals, Review, Finalization, and Customer UI

### Task 12: Persist Proposals and Enforce Merge Rules

**Files:**

- Modify: `lib/ai_stations/schema.js`
- Create: `lib/ai_stations/enrichment/proposals.js`
- Modify: `lib/ai_stations/enrichment/executors.js`
- Create: `test/ai_customer_enrichment_proposals.test.js`

- [ ] Write failing tests for:
  - mechanical normalization audit;
  - evidence-backed empty-field auto-apply as `ai_provisional`;
  - employee-confirmed field protection;
  - conflicting reliable sources;
  - accept/reject transactions;
  - context-change supersession;
  - completeness, tags, missing items, and final route.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_proposals.test.js
```

- [ ] Add `crm_ai_field_proposals` and implement compare-and-apply using original value hashes.
- [ ] Integrate existing `customer_fit` as the model node; use its result/evidence contract rather than duplicating scoring.
- [ ] Make `enrichment_finalize` compute only `missing_info`, `needs_review`, or `pending_assignment`.
- [ ] Verify GREEN:

```bash
node --test test/ai_customer_enrichment_proposals.test.js test/ai_station_contracts.test.js test/ai_station_results.test.js
```

- [ ] Commit:

```bash
git add lib/ai_stations/schema.js lib/ai_stations/enrichment/proposals.js lib/ai_stations/enrichment/executors.js test/ai_customer_enrichment_proposals.test.js
git commit -m "feat(ai): finalize evidence-backed customer proposals"
```

### Task 13: Add Protected Enrichment APIs

**Files:**

- Create: `lib/ai_stations/enrichment/routes.js`
- Modify: `lib/sales_crm.js`
- Modify: `lib/access_control.js`
- Modify: `lib/ai_stations/task_center.js`
- Create: `test/ai_customer_enrichment_api.test.js`
- Modify: `test/ai_task_center.test.js`

**Endpoints:**

- `GET /api/sales-crm/ai/customers/:customerId/enrichment`
- `POST /api/sales-crm/ai/customers/:customerId/enrichment/run`
- `POST /api/sales-crm/ai/enrichment/:runId/cancel`
- `POST /api/sales-crm/ai/proposals/:proposalId/review`

- [ ] Write failing API tests for login, full start permission set, customer scope, `edit_customer` review permission, impersonation block, idempotent rerun, cancellation, contact redaction, anonymous route audit, and degraded reads.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_api.test.js test/ai_task_center.test.js
```

- [ ] Implement route handlers with existing access-context helpers. Do not return raw database rows.
- [ ] Add enrichment workflow/node projection to the A1-08 task center and retain legacy task links.
- [ ] Verify GREEN:

```bash
node --test test/ai_customer_enrichment_api.test.js test/ai_task_center.test.js test/access_control.test.js
```

- [ ] Commit:

```bash
git add lib/ai_stations/enrichment/routes.js lib/sales_crm.js lib/access_control.js lib/ai_stations/task_center.js test/ai_customer_enrichment_api.test.js test/ai_task_center.test.js
git commit -m "feat(ai): expose protected customer enrichment APIs"
```

### Task 14: Add Customer Intake and Enrichment UI

**Files:**

- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Modify: `test/ai_station_ui.test.js`
- Create: `test/ai_customer_enrichment_ui.test.js`

- [ ] Write failing static/UI contract tests for:
  - company name or website requirement;
  - optional country;
  - immediate enrichment summary;
  - node status labels;
  - evidence expansion;
  - provisional badge;
  - conflict before/after values;
  - accept/reject, retry, and cancel controls;
  - degradation retaining last successful data.
- [ ] Verify RED:

```bash
node --test test/ai_customer_enrichment_ui.test.js test/ai_station_ui.test.js
```

- [ ] Update the new-customer form and customer drawer. Escape every server-provided value with the existing `esc()` helper.
- [ ] Poll only while a run is non-terminal, with the existing bounded customer-AI polling pattern.
- [ ] Hide contact details when the API marks them restricted.
- [ ] Verify GREEN and full regression:

```bash
node --test test/ai_customer_enrichment_ui.test.js test/ai_station_ui.test.js test/sales_access_ui.test.js
npm test
```

- [ ] Commit:

```bash
git add sales-assets/app.js sales-assets/app.css test/ai_customer_enrichment_ui.test.js test/ai_station_ui.test.js
git commit -m "feat(crm): show customer enrichment workflow and review"
```

### Task 15: A1-09.4 Verification and Merge Gate

- [ ] Run all A1-09 focused tests, `npm test`, `git diff --check`, and clean-status checks.
- [ ] Write the A1-09.4 evidence artifact.
- [ ] Merge the code PR, then the separate authoritative-docs PR.
- [ ] Report A1-09.4 complete and A1-09.5 next.

---

## Milestone A1-09.5: End-to-End, Concurrency, Real Smoke, and Full Regression

### Task 16: Add Three Structural End-to-End Scenarios

**Files:**

- Create: `test/ai_customer_enrichment_e2e.test.js`
- Create: `test/helpers/enrichment_fixture.js`

- [ ] Add deterministic end-to-end fixtures for:
  - company name only;
  - website only;
  - incomplete existing customer.
- [ ] Each scenario must assert profile, products/demand, contact candidates, score, tags, completeness, evidence, final route, task-center visibility, cost attribution, and unchanged owner.
- [ ] Run:

```bash
node --test test/ai_customer_enrichment_e2e.test.js
```

Expected: all three scenarios pass without external network access.

- [ ] Commit:

```bash
git add test/ai_customer_enrichment_e2e.test.js test/helpers/enrichment_fixture.js
git commit -m "test(ai): cover customer enrichment end to end"
```

### Task 17: Add Competition, Recovery, and Failure Matrix

**Files:**

- Create: `test/ai_customer_enrichment_concurrency.test.js`
- Create: `test/ai_customer_enrichment_failures.test.js`
- Modify as defects require: only A1-09 implementation files

- [ ] First add failing coverage for:
  - six worker processes competing for 20 cross-customer enrichment runs;
  - no lost or duplicate workflow, legacy task, completion event, proposal, or result;
  - global/resource peaks within configured limits;
  - same-customer serialization;
  - trigger/event/AI/legacy lease recovery;
  - 429, timeout, fallback, budget block, permanent model failure;
  - exact duplicate, uncertain identity, no contacts, evidence conflict;
  - permission revocation and owner scope change;
  - cancellation and late results.
- [ ] Run RED, implement only the minimal fixes revealed, then run GREEN:

```bash
node --test test/ai_customer_enrichment_concurrency.test.js test/ai_customer_enrichment_failures.test.js test/ai_control_plane.test.js test/ai_station_budgets.test.js
```

- [ ] Commit the two test files and only the exact implementation files changed to fix failures. Inspect `git status --short` first; do not stage the whole `lib/ai_stations` directory:

```bash
git status --short
git add test/ai_customer_enrichment_concurrency.test.js test/ai_customer_enrichment_failures.test.js
# Add each actually modified implementation file by its exact path.
git commit -m "test(ai): verify enrichment concurrency and failures"
```

### Task 18: Run Development Real-Model Smoke

**Files:**

- Create: `scripts/smoke-ai-customer-enrichment.js`
- Create: `docs/evidence/a1-09-real-model-smoke-template.md`
- Modify: `.env.example`

- [ ] Write a dry-run test or argument parser test ensuring the script:
  - refuses production database paths;
  - requires both enrichment flags explicitly;
  - never prints provider keys;
  - creates a uniquely named disposable development customer;
  - waits with a bounded timeout;
  - reports run/node IDs, engine/model, usage/cost, evidence count, and final route;
  - never sends external sales messages or changes owner.
- [ ] Run the parser/safety test.
- [ ] Run the smoke only against the isolated development database and existing development credentials.
- [ ] If credentials or a provider are unavailable, record the precise external blocker; do not substitute production secrets.
- [ ] Commit the reusable smoke harness, not generated secrets or runtime output:

```bash
git add scripts/smoke-ai-customer-enrichment.js docs/evidence/a1-09-real-model-smoke-template.md .env.example
git commit -m "test(ai): add customer enrichment smoke harness"
```

### Task 19: Final Verification, Code Merge, and Plan Closure

- [ ] Run focused suite:

```bash
node --test \
  test/ai_customer_enrichment_store.test.js \
  test/ai_customer_enrichment_intake.test.js \
  test/ai_customer_enrichment_workflow.test.js \
  test/ai_customer_enrichment_evidence.test.js \
  test/ai_customer_enrichment_identity.test.js \
  test/ai_customer_enrichment_adapters.test.js \
  test/ai_customer_enrichment_events.test.js \
  test/ai_customer_enrichment_cancellation.test.js \
  test/ai_customer_enrichment_proposals.test.js \
  test/ai_customer_enrichment_api.test.js \
  test/ai_customer_enrichment_ui.test.js \
  test/ai_customer_enrichment_e2e.test.js \
  test/ai_customer_enrichment_concurrency.test.js \
  test/ai_customer_enrichment_failures.test.js
```

- [ ] Run complete verification:

```bash
python3 -m py_compile scripts/recon_agent_worker.py scripts/contact_recon_worker.py
npm test
git diff --check origin/codex/ai-integration...HEAD
git status --short
```

- [ ] Confirm production remains unchanged with read-only checks only:
  - current production SHA;
  - health endpoint;
  - enrichment flags off;
  - no deployment performed.
- [ ] Write the final A1-09.5 evidence artifact with focused count, full count, real-smoke result, GitHub CI, production read-only state, and rollback boundary.
- [ ] Push and merge the A1-09.5 code PR.
- [ ] 历史步骤（不得执行）：当时拟创建单独的文档 PR 更新现已冻结的两份旧计划。
- [ ] Mark A1-09 complete only after CI and both PR merges.
- [ ] Report final integration SHA, total progress, production state, and A2-01 as the next task.

## Estimated Duration

- A1-09.1: 0.5–1 workday
- A1-09.2: 1–1.5 workdays
- A1-09.3: 1–2 workdays
- A1-09.4: 1–1.5 workdays
- A1-09.5: 0.5–1 workday

Total: **4–7 workdays**, assuming development provider credentials are available for the final smoke and GitHub CI is healthy.

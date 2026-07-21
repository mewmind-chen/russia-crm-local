# Permission Isolation Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six authorization and contact-data gaps found by the final Issue #4 code review.

**Architecture:** Keep authorization centralized in `lib/access_control.js`, make every read response contact-safe before serialization, and pass the same access context into every mutation that resolves an existing customer. Read endpoints remain side-effect free; legacy prospect tasks receive an explicit upgrade owner instead of silently disappearing.

**Tech Stack:** Node.js >=18, Express 4, better-sqlite3 11, Node `node:test`, native `fetch`.

## Global Constraints

- `view_contacts=false` means no names, titles, phones, emails, contact methods, evidence/report links, or free narrative that may embed them may enter a response, browser state, model prompt, or model answer.
- `view_all_customers=false` applies to every role and every existing-customer mutation.
- Scoped misses use a generic 403; full-scope authenticated misses use 404; malformed input uses 400.
- Browser GET handlers do not mutate CRM data.
- Existing user changes and operational data are preserved; tests use disposable SQLite fixtures only.

---

### Task 1: Contact-Safe Sales Bootstrap

**Files:**
- Modify: `lib/access_control.js`
- Modify: `lib/sales_crm.js`
- Test: `test/access_control.test.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Consumes: `redactContactFields(value)`.
- Produces: every collection in `loadPayload(user)` is contact-safe when `permissions.view_contacts` is false.

- [x] **Step 1: Seed bootstrap-only contact markers and write the failing HTTP assertion**

Insert markers into `crm_intake_items.contact_name/contact_title/contact_methods/evidence_urls/report_url`, `customer_pool.description/deep_report`, `crm_accounts.next_action`, `crm_activities.outcome/summary/next_action`, and `crm_notifications.detail`; request `/api/sales-crm/bootstrap`; assert the entire serialized body contains none of the markers.

- [x] **Step 2: Run the focused test and verify the markers leak**

Run: `node --test test/access_control.test.js test/permission_integration.test.js`

Expected: FAIL because bootstrap currently returns intake contact fields and narrative strings unchanged.

- [x] **Step 3: Apply contact redaction before bootstrap serialization**

Expand normalized contact-bearing keys to include `summary`, `outcome`, `detail`, `master_description`, `deep_report`, and other reviewed narrative/report fields. In `loadPayload`, compute each allowed collection first and apply `redactContactFields` to accounts, activities, alerts, intake, insights, notifications, audit, and migration-review payloads whenever `view_contacts` is false.

- [x] **Step 4: Re-run focused tests**

Run: `node --test test/access_control.test.js test/permission_integration.test.js`

Expected: PASS.

### Task 2: Contact-Safe Assistant Inputs

**Files:**
- Modify: `lib/assistant.js`
- Test: `test/assistant_scope.test.js`

**Interfaces:**
- Produces: `applyAssistantScope(db, accessContext)` blanks every contact-bearing free-text column before any deterministic/SQL/model path reads it; `fetchWebPagesContext` skips direct URLs when contacts are forbidden.

- [x] **Step 1: Write failing deterministic-description and direct-URL tests**

Put a unique email/name marker in `customer_pool.description` and `products`, then assert `searchCrmContext`, deterministic answers, and serialized assistant responses omit it. Stub page fetching and assert a user with `view_contacts=false` cannot fetch a URL from the question/context.

- [x] **Step 2: Run the assistant suite and verify both leaks**

Run: `node --test test/assistant_scope.test.js`

Expected: FAIL because `description/products` remain visible and direct URL fetching has no contact permission guard.

- [x] **Step 3: Blank narrative columns and gate page fetching**

Add `description`, `products`, `recommended_products`, and related contact-bearing narratives to the restricted TEMP-view column set. Return `{ skipped:true, reason:'contact_permission' }` from page fetching before reading URLs when the current access context forbids contacts.

- [x] **Step 4: Re-run the assistant suite**

Run: `node --test test/assistant_scope.test.js`

Expected: PASS.

### Task 3: Prospect Promotion Scope

**Files:**
- Modify: `server.js`
- Modify: `lib/db.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Changes: `promoteProspectCandidate(candidateId, { ownerId, accessContext, createRecon })`.
- Produces: existing customer IDs are reusable only when included in `accessContext.externalCustomerIds`; new pool records remain new and may create Recon after promotion.

- [x] **Step 1: Write failing cross-owner domain/candidate promotion tests**

Create an owned prospect candidate whose `existing_customer_id` or domain resolves to `RU-9003`, then assert promotion and `createRecon=true` both return 403 and do not change candidate/recon rows.

- [x] **Step 2: Run and verify the cross-owner mutation succeeds incorrectly**

Run: `node --test test/permission_integration.test.js`

Expected: FAIL because ownership is checked only on the prospect task.

- [x] **Step 3: Pass and enforce the access context**

Pass `req.accessContext` from `server.js`. Before reusing `existing_customer_id`, `promoted_customer_id`, or a domain match, call `assertExternalCustomerAccess(accessContext, customerId)`. Keep newly allocated IDs outside this assertion until insertion completes.

- [x] **Step 4: Re-run permission integration tests**

Run: `node --test test/permission_integration.test.js`

Expected: PASS.

### Task 4: Read-Only Initial Data

**Files:**
- Modify: `lib/db.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Produces: `getInitialData(accessContext)` performs SELECT-only work.

- [x] **Step 1: Write a failing before/after database-state test**

Insert an untagged customer, snapshot `tags` and `customer_tags`, call `GET /api/initial`, and assert both tables are unchanged.

- [x] **Step 2: Run and verify GET writes preset/automatic tags**

Run: `node --test test/permission_integration.test.js`

Expected: FAIL because `getInitialData` invokes `seedPresetTags` and `autoTagCustomers`.

- [x] **Step 3: Remove mutation from the request path**

Delete both calls from `getInitialData`. Keep preset seeding in `ensureTables()` and explicit automatic-tag refresh in `refreshAutoTags()`.

- [x] **Step 4: Re-run permission integration tests**

Run: `node --test test/permission_integration.test.js`

Expected: PASS.

### Task 5: Non-Enumerable Resource Semantics

**Files:**
- Modify: `lib/sales_crm.js`
- Modify: `server.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Produces: scoped missing/out-of-scope IDs both return 403; full-scope missing IDs return 404.

- [x] **Step 1: Write missing-versus-out-of-scope tests**

Cover account writes, evaluation retry, Recon result lookup, and report lookup for both scoped manager and full-scope manager sessions.

- [x] **Step 2: Run and verify mixed 400/403 semantics**

Run: `node --test test/permission_integration.test.js`

Expected: FAIL because global existence checks happen before scope checks.

- [x] **Step 3: Resolve through scope first**

Use `accountScope(user)` in `getAccountForUser`; if no scoped row exists, throw 403 for `view_all_customers=false` and 404 otherwise. Apply the same rule to evaluation, result, and report lookups.

- [x] **Step 4: Re-run permission integration tests**

Run: `node --test test/permission_integration.test.js`

Expected: PASS.

### Task 6: Legacy Prospect Ownership Migration

**Files:**
- Modify: `lib/db.js`
- Test: `test/permission_integration.test.js`

**Interfaces:**
- Produces: `assignLegacyProspectTasks(db)` assigns blank `created_by` tasks to an explicit configured owner or the first active admin; otherwise they remain quarantined and inaccessible.

- [x] **Step 1: Write an upgrade test with a pre-column prospect table**

Create a disposable database containing a legacy `prospect_tasks` row and an active admin, run `ensureTables()`, and assert the row receives the admin ID and is visible only to that owner.

- [x] **Step 2: Run and verify the legacy row remains blank**

Run: `node --test test/permission_integration.test.js`

Expected: FAIL because `ensureColumns` adds `created_by=''` without migration.

- [x] **Step 3: Add deterministic migration/quarantine logic**

After ensuring the column, resolve `CRM_LEGACY_PROSPECT_OWNER_ID` when valid; otherwise select the first active admin from `sales_users` when that table exists. Update only blank `created_by` rows. Never make blank tasks visible to normal users.

- [x] **Step 4: Run focused and full verification**

Run: `node --test test/permission_integration.test.js && npm test && git diff --check`

Expected: all tests PASS and no whitespace errors.

### Task 7: Evidence and Final Review

**Files:**
- Modify: `docs/evidence/issue-4-verification.md`
- Modify: `docs/permission-matrix.md`

- [x] **Step 1: Record anonymous test counts and the six closed findings**

Do not record real customer/contact data.

- [x] **Step 2: Request a fresh read-only review**

Review `origin/main...HEAD` plus the working tree and fix every remaining Critical/Important finding.

- [x] **Step 3: Run final verification and commit**

Run: `npm test && node --check server.js && node --check lib/access_control.js && node --check lib/assistant.js && node --check lib/db.js && node --check lib/sales_crm.js && git diff --check`

Expected: all commands exit 0; then commit the review fixes.

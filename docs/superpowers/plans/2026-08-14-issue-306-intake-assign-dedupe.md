# Issue 306 Intake Assign Unblock + Protection/Dedupe Rework Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers never see a clickable-but-dead 分配 on identity-verification leads (no infinite spinner, clear reason + next owner of the action), and the 客户保护与查重 page becomes a plain-language business workbench around one question — 它是不是同一个客户？ — with three resolutions that immediately reflect in the intake pool. No physical deletion, no complex auto-merge.

**Architecture:** Keep the existing backend duplicate-review pipeline (`crm_duplicate_reviews` statuses `pending/confirmed_same/confirmed_distinct/needs_info`, `resolveDuplicateReviewRow`) as the resolution engine; correct the frontend assign buttons and pool copy, rebuild the protection page UI, and add the confirmed-same linkage rules (master customer + linked record + complementary-info notice + audit/timeline), reusing `resolveDuplicateReview` where possible.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla JS, `node:test`, headless Chrome verification.

**Approved preview:** https://gist.github.com/edwinwu218-boop/edaa6183723fe3ef4107e42cb3e5eb09

## Current State (verified on production 3369789, 2026-08-14)

- Backend already blocks identity-warning intake items: `assignable=false`, `claimBlocked=true`, `assignmentBlockReason='待管理员确认客户身份'` (lib/sales_crm.js ~2705/3966).
- Frontend inconsistencies: pool row actions show a bare `管理员确认中` pill (no next step); `openIntakeAssignModal` has no identity check; batch/manual assignment preview can include blocked items; the single-item 分配 in the drawer is hidden when identityWarning is set — so the user's "分配" dead-end is the manual assignment flow; error/blocked handling depends on the API returning fast and on `blockedReasons` copy.
- Protection page (protectedCustomers view) renders duplicate-review admin data with technical fields (sha256-style keys, internal statuses) — confirmed as "审计工具风格" by the user.
- Backend resolution engine exists: `resolveDuplicateReview` with `confirmed_same` / `confirmed_distinct` / `needs_info`.

## Baseline

- Base: refreshed `origin/main` at or after `33697890fa2882d3fb3f6a3cd0409db2f5284be4`.
- [ ] Confirm `git rev-parse origin/main` == GitHub `main` == production `/healthz`.
- [ ] Create worktree and branch `codex/issue-306-intake-assign-dedupe`.
- [ ] Reproduce the spinner scenario in headless Chrome (manager account, pool filter 待领取 + 仅看领取超期, Eltron Group).

## Global Constraints

- No permission/data-scope expansion; sales must never see out-of-scope owner/stage/contacts/history/similarity evidence through dedupe surfaces.
- No physical deletion of any customer master, intake row, or stable ID; linked/rejected IDs are never reused.
- Keep the merge lightweight: master + linked record + complementary-info notice only; no field-level conflict engine; two simple actions `补充到主客户` / `暂不补充`.
- All resolutions keep audit rows and timeline entries with actor, time, reason.
- Full `npm test` must pass before merge.

---

### Task 1: Frontend — intake pool assign buttons always say what happens next

**Files:** `sales-assets/app.js` (row/drawer/batch assignment surfaces), tests.

**Interfaces:**
- For identity-warning items: managers see a **disabled** button `等待管理员核验` (title `管理员确认后才能分配`); admins/managers with dedupe access see `去处理核验` which deep-links to the exact duplicate review item (query param/route jump).
- Row copy under the item shows one of: `疑似重名，等待管理员确认` / `管理员确认后才能分配` / `已确认不是同一客户，可以分配` / `已关联主客户：<主客户>` / `资料不足，需要补充<要求>` (driven by review status + `assignmentBlockReason`).
- Manual/batch assignment preview excludes blocked items (or lists them as blocked with the reason), and the submit result copy uses the business reasons from Task 2.
- Every assign failure surfaces a toast/status with the reason; submitting flags always reset (no permanent spinner).

- [ ] **Step 1: Write failing contract tests** (button variants per state, deep-link target, spinner reset).
- [ ] **Step 2: Run RED.** **Step 3: Implement.** **Step 4: GREEN** → commit.

### Task 2: Backend — fast, readable assignment block reasons

**Files:** `lib/sales_crm.js` (manual assign eligibility + blockedReasons), tests.

- [ ] `blockedReasons` keys become business copy (`疑似重名，等待管理员确认` etc.); identity-warning items return `assignable=false` with that reason in preview and action paths; verify no long-running/blocking calls in the assign path (no spinner hang).
- [ ] Tests: manual assign preview/submit with identity-warning items → fast response, correct reason, no writes.

### Task 3: Frontend — protection & dedupe page rebuilt as a workbench

**Files:** `sales-assets/app.js`, `sales-assets/app.css`, tests.

**Interfaces:**
- Page title `客户保护与查重处理`; records default-collapsed cards: 客户/线索名称, 疑似重复数量, 当前处理建议, 当前状态, primary `查看并处理`.
- Expanded view: 新线索是什么 / 疑似已有客户是什么 / 系统为什么觉得相似 (plain language, no sha256, no internal keys) / the single question `它是不是同一个客户？`.
- Three choices only: `是同一个客户，关联已有客户` / `不是同一个客户，允许继续分配` / `资料不够，要求补充` (needs_info asks what to supplement).
- No technical/audit wording in user-visible copy.

### Task 4: Backend — three resolutions + confirmed-same linkage rules

**Files:** `lib/sales_crm.js` (resolveDuplicateReviewRow / duplicate review payloads), tests.

**Interfaces (correct/extend existing engine):**
- `confirmed_same`: mark new lead linked to master (`已关联已有客户`/`已合并到主客户`); keep original name/website/source batch/created time/discoverer/handler/reason; only the master ID remains the authoritative CRM identity; linked IDs never reusable; timeline + audit record who/when/linked-to/why.
- Complementary-info detection: obvious new contacts/website/industry tags → light `可补充资料确认` with only `补充到主客户` / `暂不补充`; conflicting fields (website/country/name) never auto-overwrite; future undo path must be auditable.
- `confirmed_distinct`: clear the block so the lead is assignable again.
- `needs_info`: record what to supplement; pool shows it.

- [ ] Failing tests first for each resolution (no deletion, ID non-reuse, audit rows, timeline entries, complementary-info flags).

### Task 5: Sync & refresh after a resolution

- [ ] After any resolution: pool list/status refreshes automatically (same page reload/refresh flow), protection page and related counts update; pool shows the post-resolution copy from Task 1.
- [ ] Manager flow end-to-end in headless Chrome: 超时领取 → pool → blocked lead → 去处理核验 → resolve → pool shows next step (no manual reload needed for correctness of copy, count refresh).

### Task 6: Regression, permission isolation, release

- [ ] Sales view: no dedupe/verification details, no out-of-scope master customer info leaked through pool copy or protection surfaces (tests + browser check).
- [ ] Full `npm test`; push; PR; CI; squash merge; auto-deploy; production `/healthz` == merged SHA.
- [ ] Browser matrix (admin/manager/sales) + screenshots; record evidence and close Issue #306.

## Commit and release boundaries

One PR (Tasks 1–5) or two sequential PRs if review prefers (pool buttons/backend reasons first, then protection page + linkage). No half state: a resolution must always be followed by the pool reflecting it; rollback reverts the whole PR. No schema/table rebuilds; new linkage columns must be additive with an idempotent installer.

---

# Detailed Execution Plan (step level)

> Live status: Task 1 ✅ complete (5e33941 + review fix 61a1217), Task 2 ✅ complete (dc009d6 + perf fix d30db61, re-review in flight), docs 633323a. Task 3–6 steps below are ready to execute.

## Progress record

| Task | Commits | Tests | Review |
| --- | --- | --- | --- |
| Task 1 线索池按钮状态化 | 5e33941, 61a1217 | 13 focused / full 1194 | APPROVED + re-review APPROVED (docs ruling) |
| Task 2 阻断原因业务化 | dc009d6, d30db61 | 4+1 focused / full 1199 | FINDINGS(perf) → fix → re-review in flight |
| docs (plans + roadmap) | 633323a | — | — |

## Task 3: 查重页面工作台 — step detail

**Files:** `sales-assets/app.js` (~6353 duplicate-review list, viewMeta ~267), `sales-assets/app.css`, new `test/issue306_protection_workbench.test.js`.

- [ ] **Step 1 — RED:** contract tests: (a) each review renders a COLLAPSED card with 名称/疑似重复数量/建议/状态 + `查看并处理` primary; (b) expanded view contains `它是不是同一个客户？` and three business-labeled resolution buttons; (c) no `规则 legacy-v1`, no `提交人`, no raw `客户编号` field-name labels; (d) deep-link hash `#protectedCustomers?review=<id>` / `?customer=<externalId>` expands + scrolls to the card; (e) CSS contract for collapsed grid + expanded two-column + mobile fallback.
- [ ] **Step 2 — Run RED** (`node --test test/issue306_protection_workbench.test.js`) and record failures.
- [ ] **Step 3 — Implement:** collapsed/expand state per review id (state.duplicateReviews.expandedId or per-item); business summary labels (`待处理/已确认同一客户/已确认不是同一客户/待补充资料`); title 客户保护与查重处理; remove technical copy; keep checkbox/candidate-search/bulk/recalculate/pagination/protectedExact guards intact; honor deep-link on view load.
- [ ] **Step 4 — GREEN:** focused tests pass; run headless Chrome 1440x900: collapsed list renders, expand works, no raw keys in DOM text.
- [ ] **Step 5 — Full suite** `npm test` once; commit `feat: rebuild protection and dedupe page as business workbench (#306)`.

## Task 4: 三裁决 + 关联主客户 — step detail

**Files:** `lib/sales_crm.js` (resolveDuplicateReviewRow ~8970, resolveDuplicateReview ~9029), possibly additive schema, new `test/issue306_dedupe_resolution_linkage.test.js`.

- [ ] **Step 1 — RED (backend fixtures):**
  - `confirmed_same`: intake item marked linked (`已关联已有客户`), master customer id recorded as authoritative; original name/website/source batch/created/discoverer/handler/reason preserved; timeline + audit rows (actor, time, linked-to, reason); linked id never reusable; complementary-info flag when new contacts/website/industry tags present with ONLY `补充到主客户`/`暂不补充` actions; conflicting fields (website/country/name) never auto-overwrite.
  - `confirmed_distinct`: block cleared, item assignable again.
  - `needs_info`: supplement requirement recorded; pool copy exposes it.
  - Assert NO physical deletion anywhere in these paths.
- [ ] **Step 2 — Run RED**, confirm failures.
- [ ] **Step 3 — Implement:** extend resolveDuplicateReviewRow payload handling; additive columns only (idempotent installer pattern in lib); reuse existing audit helpers (recordTodayTaskAudit/crm_audit_log + timeline write patterns).
- [ ] **Step 4 — GREEN:** focused pass; grep-assert no DELETE of customer/intake rows in the new path.
- [ ] **Step 5 — Full suite**; commit `feat: dedupe resolutions link master customer without deletion (#306)`.

## Task 5: 裁决后联动 — step detail

**Files:** `sales-assets/app.js` (post-resolution refresh), tests.

- [ ] **Step 1 — RED:** contract tests: after resolution the UI refreshes pool list + protection list + counts (calls existing loadAuthorizedBusinessPage/refresh intake + duplicate review reload); pool renders post-resolution copy from Task 1 label helper.
- [ ] **Step 2 — GREEN:** implement refresh wiring; end-to-end headless Chrome: manager 超时领取 → pool blocked lead → 去处理核验 → resolve distinct → pool shows 已确认不是同一客户，可以分配 without manual reload.
- [ ] **Step 3 — Full suite**; commit `feat: refresh pool and counts after dedupe resolution (#306)`.

## Task 6: 权限隔离 + 回归 + 发布 — step detail

- [ ] Sales browser check: no 去处理核验, no dedupe/protection details, no out-of-scope master info in pool copy.
- [ ] Admin/manager browser matrix: resolve all three ways; screenshots before/after.
- [ ] Full `npm test`; `git diff --check`; push; PR (describe linkage rules + permission boundary); CI green; squash merge; auto-deploy; production `/healthz` == merged SHA; record evidence in Issue #306 and close it.

## Commit & release boundaries

One PR (Tasks 1–6) or sequential PRs (pool buttons+backend reasons first — already implemented — then protection page + linkage). No half state: every resolution must immediately reflect in the pool; rollback reverts the whole PR. Schema changes must be additive with idempotent installers.

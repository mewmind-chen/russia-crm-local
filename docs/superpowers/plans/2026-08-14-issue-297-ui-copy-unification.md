# Issue 297 UI Copy Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all user-visible copy in TradePulse CRM — role-based terminology (sales / supervisor / management / audit), remove unnecessary English headers, warm neutral prompts, and concrete action names — without changing any permission rule, data scope, API semantics, or audit facts.

**Architecture:** Display-layer only. Keep internal keys, enum values, API fields, and database columns unchanged; map old copy to new copy through a single terminology mapping table used by every task. Add a static copy-scan guard first so forbidden words cannot regress.

**Tech Stack:** Node.js, vanilla JS (single-page app `sales-assets/app.js` + `sales-crm.html` + `tradelead-v2.html` + `Index.html`), `node:test`, shell/grep-based static scan script.

**Approved previews (user-confirmed):**
- Issue body: https://github.com/mewmind-chen/russia-crm-local/issues/297
- Gist preview: https://gist.github.com/edwinwu218-boop/df7ffbf93d06adc198e11ac766d1ba83

## Current State (verified scan on production 08eca7e, 2026-08-14)

All 23 English header labels from the issue exist in the frontend (1–2 files each):
`MANAGEMENT OVERVIEW`, `LEAD POOL`, `CUSTOMER INTAKE`, `CRM CUSTOMER PORTFOLIO`, `CUSTOMER RECYCLE BIN`, `CUSTOMER PROFILE`, `CONTACT EVIDENCE`, `PIPELINE CONTROL`, `TODAY TASKS`, `MANAGER INTERVENTION`, `DEFERRED PLAN METRICS`, `CRM NOTIFICATIONS`, `ACTIVITY CORRECTIONS`, `TEAM STATUS`, `MARKET INTELLIGENCE`, `ACCESS CONTROL`, `TEAM ACCOUNTS`, `PERMISSION GROUPS`, `AUTHORIZED FILTERS`, `MANAGER TASK RULES`, `AUDIT LOG`, `DUPLICATE REVIEW`, `IDENTITY REVIEW`.

Chinese copy hits (frontend `sales-assets/app.js` + backend `lib/`):
- `经理评价` 16 (app.js) + 6 (lib/) · `审批` 19 + 18 · `经理异常` 8 + 2 · `升级老板` 4 + 3 · `老板处理` 4 + 4 (lib `老板` 4) · `主管介入任务` 1 + 1 · `确认操作` 1 · `暂无数据` 3 · `等待经理处理` 1 · `需要管理者介入` 1 · `拒绝申请` 1 · `处理审批` 1 · `审批队列`/`待审批` 3+3.
- Tests referencing copy: 5 files, ~30 hits (`主管介入任务`, `经理评价`, `审批`, `升级老板`, `老板`) — must be updated in the same PRs.

## Baseline (PENDING — do not start until confirmed)

> **Blocking dependency:** Issues #293 and #296 must be merged, deployed, and their production gates passed BEFORE this plan's implementation begins. #296 changes the activity/manager-assistance modal that is also in this plan's copy scope; starting earlier causes conflicts. Baseline SHA must be re-verified at execution time.

- [ ] Fetch `origin/main` after #293 and #296 merge; record `git rev-parse origin/main`.
- [ ] Confirm production `/healthz` returns the same full SHA with `database=ok`.
- [ ] Confirm `current` tracked files match `origin/main` (no in-place hot patch).
- [ ] Create worktree and branch `codex/issue-297-ui-copy-unification` from that baseline.
- [ ] Run baseline focused tests and record results.

## Global Constraints

- Copy-only changes: no permission rule, data scope, API field meaning, or audit fact changes.
- Internal keys, enum values, API fields, DB columns stay compatible; if an internal key must change, provide a migration + compatibility note (avoid unless necessary).
- Historical audit-log rows are NOT rewritten; only new user-visible copy uses the new terminology.
- Do not touch #293's permission-group editor structure or #296's activity modal behavior; for copy that overlaps those modals, use the user-confirmed preview wording and note "no functional boundary change" in the PR.
- Every task updates the affected tests in the same commit (tests assert old copy and must be migrated to new copy).
- Every task runs the copy-scan guard (Task 1) before and after; full `npm test` must pass before merge.
- Deploy and verify this issue alone.

## Terminology Mapping Table (source of truth)

| Old (forbidden after this issue) | New |
| --- | --- |
| `MANAGEMENT OVERVIEW` | `经营概览` (or remove the eyebrow) |
| `LEAD POOL` | `线索池` |
| `CUSTOMER INTAKE` | `新增客户` / `客户录入` |
| `CRM CUSTOMER PORTFOLIO` | `CRM 客户全景` |
| `CUSTOMER RECYCLE BIN` | `不对口记录` / `已退回客户` |
| `CUSTOMER PROFILE` | `客户资料` |
| `CONTACT EVIDENCE` | `联系人凭证` |
| `PIPELINE CONTROL` | `推进管道` |
| `TODAY TASKS` | `今日待办` |
| `MANAGER INTERVENTION` | `主管协助事项` |
| `DEFERRED PLAN METRICS` | `计划跟进与协助统计` |
| `CRM NOTIFICATIONS` | `通知中心` |
| `ACTIVITY CORRECTIONS` | `跟进更正` |
| `TEAM STATUS` | `团队状态` |
| `MARKET INTELLIGENCE` | `市场策略` |
| `ACCESS CONTROL` | `用户与权限` |
| `TEAM ACCOUNTS` | `团队账号` |
| `PERMISSION GROUPS` | `权限组` |
| `AUTHORIZED FILTERS` | `筛选权限` |
| `MANAGER TASK RULES` | `主管协助规则` |
| `AUDIT LOG` | `操作记录` |
| `DUPLICATE REVIEW` | `重复客户确认` |
| `IDENTITY REVIEW` | `身份检查` |
| `主管介入任务` / `主管任务` | `主管协助事项` |
| `延期与介入统计` | `计划跟进与协助统计` |
| `经理评价` / `销售经理评价` | `客户经营复盘` / `客户推进判断` |
| `经理异常` | `需主管关注` |
| `需要管理者介入` | `需要主管协助` |
| `等待经理处理` | `等待主管回复` |
| `求助老大` / `提交老板` / `需要老板处理的难点` | `请求主管协助` / `升级为经营决策事项` / `需进一步决策的难点` |
| `升级老板处理` | `升级为经营决策事项` |
| `该销售异常` | 事实 + 下一步动作（中性） |
| `审批队列` | `更正待处理` |
| `待审批申请` | `待确认更正` |
| `处理审批` | `处理更正申请` |
| `拒绝申请` | `不通过并说明原因` |
| `批准` | `通过更正` |
| `确认操作` | concrete action, e.g. `确认退回线索池` / `确认标记不对口` / `确认恢复客户` |
| `暂无数据` | context-specific empty state, e.g. `目前还没有需要处理的记录` |
| `操作失败` | `没保存成功，请稍后再试` |
| `系统异常预警` | `需要关注的情况` |

---

### Task 1: Static copy-scan guard (write first, run in every task)

**Files:**
- Create: `scripts/check-forbidden-copy.sh` (or `scripts/check-forbidden-copy.js` if cross-platform consistency is preferred)
- Create: `test/issue297_copy_scan.test.js` (invokes the scan over `sales-assets/`, `sales-crm.html`, `tradelead-v2.html`, `Index.html`, `lib/`, and `test/`; asserts zero hits of the forbidden list; `test/` may assert hits are absent except where a test intentionally documents a legacy fixture — decide and document)
- Modify: `package.json` (`"check:copy"` script)

**Forbidden list (from the mapping table old column + acceptance):**
`MANAGEMENT OVERVIEW`, `MANAGER INTERVENTION`, `PERMISSION GROUPS`, `CUSTOMER RECYCLE BIN`, `LEAD POOL`, `CUSTOMER INTAKE`, `CRM CUSTOMER PORTFOLIO`, `CUSTOMER PROFILE`, `CONTACT EVIDENCE`, `PIPELINE CONTROL`, `TODAY TASKS`, `DEFERRED PLAN METRICS`, `CRM NOTIFICATIONS`, `ACTIVITY CORRECTIONS`, `TEAM STATUS`, `MARKET INTELLIGENCE`, `ACCESS CONTROL`, `TEAM ACCOUNTS`, `AUTHORIZED FILTERS`, `MANAGER TASK RULES`, `AUDIT LOG`, `DUPLICATE REVIEW`, `IDENTITY REVIEW`, `提交老板`, `升级老板`, `老板处理`, `求助老大`, `需要管理者介入`, `主管介入任务`, `经理异常`, `经理介入`, `等待经理处理`, `审批队列`, `待审批申请`, `处理审批`, `拒绝申请`, `确认操作`, `该销售异常`.

- [ ] **Step 1: Write the scan script and the failing test**
- [ ] **Step 2: Run `node --test test/issue297_copy_scan.test.js`** — Expected: FAIL with the current hit list (this documents the baseline).
- [ ] **Step 3: Commit the guard alone** (scan is red until later tasks replace copy; keep it red intentionally or gate it behind an env flag `ALLOW_COPY_LEGACY=1` for local runs — decide and document; the test must be green after Task 5, before merge).

```bash
git add scripts/check-forbidden-copy.sh test/issue297_copy_scan.test.js package.json
git commit -m "test: add forbidden-copy scan guard for issue 297"
```

### Task 2: Left navigation, page titles, and English eyebrows

**Files:** `sales-assets/app.js` (view meta, sidebar render, page title render), `sales-crm.html`, `tradelead-v2.html`, `Index.html` (any hard-coded eyebrows).

- [ ] **Step 1: Enumerate every user-visible English eyebrow** (`grep -rn` for the English list) and every navigation entry; record old → new per the mapping table.
- [ ] **Step 2: Replace** navigation labels and page-title eyebrows; keep `CRM`, `AI`, `Recon` as allowed technical words.
- [ ] **Step 3: Update affected UI tests** (view-meta assertions, nav render tests).
- [ ] **Step 4: Run the copy scan for the English list** — Expected: zero hits in user-visible sources.
- [ ] **Step 5: Commit**

```bash
git add sales-assets/app.js sales-crm.html tradelead-v2.html Index.html test/
git commit -m "fix: replace English eyebrows and nav labels with Chinese copy"
```

### Task 3: Role terminology — supervisor assistance, reviews, escalation, audit

**Files:** `sales-assets/app.js`, `lib/sales_crm.js`, `lib/access_control.js` (permission labels), test files.

- [ ] **Step 1: Enumerate** all `主管介入任务`/`主管任务`/`经理异常`/`经理评价`/`经理介入`/`等待经理处理`/`需要管理者介入`/`升级老板`/`老板处理`/`提交老板`/`该销售异常` hits with file:line; classify by role surface (sales / supervisor / management / audit).
- [ ] **Step 2: Replace** per the mapping table. For audit copy in `lib/`, use neutral fact statements (`已生成主管协助事项`, `已升级为需决策事项`, `更正申请已通过/未通过`); do NOT rewrite historical audit rows.
- [ ] **Step 3: Update affected backend and UI tests** (audit copy assertions, permission label assertions).
- [ ] **Step 4: Run scan for the Chinese role list** — zero hits expected (except documented legacy fixtures).
- [ ] **Step 5: Commit**

```bash
git add sales-assets/app.js lib/sales_crm.js lib/access_control.js test/
git commit -m "fix: unify role terminology across sales, supervisor, management and audit surfaces"
```

### Task 4: Correction workflow copy (approval language)

**Files:** `sales-assets/app.js` (activity correction pages/modals), `lib/sales_crm.js` (correction status copy), test files.

- [ ] **Step 1: Enumerate** `审批`/`待审批`/`审批队列`/`处理审批`/`拒绝申请`/`批准` hits in correction workflow surfaces; verify each maps to the correction domain (not AI approval etc.).
- [ ] **Step 2: Replace** with `更正申请` / `待确认更正` / `更正待处理` / `处理更正申请` / `不通过并说明原因` / `通过更正`.
- [ ] **Step 3: Update tests**; run scan.
- [ ] **Step 4: Commit**

```bash
git add sales-assets/app.js lib/sales_crm.js test/
git commit -m "fix: replace approval language with correction workflow copy"
```

### Task 5: Generic buttons, empty states, and error prompts

**Files:** `sales-assets/app.js`, `sales-crm.html`, test files.

- [ ] **Step 1: Enumerate** every generic `确认操作` button; identify the real action per page and rename (e.g. `确认退回线索池`, `确认标记不对口`, `确认恢复客户`); no generic label may remain.
- [ ] **Step 2: Enumerate** every `暂无数据` empty state; replace with page-context copy (e.g. `目前还没有需要处理的记录`); no bare `暂无数据` remains.
- [ ] **Step 3: Enumerate** `操作失败` and `系统异常预警`; replace with warm neutral prompts.
- [ ] **Step 4: Update tests**; run the full copy scan (all lists) — expected green.
- [ ] **Step 5: Commit**

```bash
git add sales-assets/app.js sales-crm.html test/
git commit -m "fix: replace generic confirm buttons and empty states with concrete copy"
```

### Task 6: Regression — #293 / #296 surfaces and full suite

- [ ] **Step 1: Verify #293 permission-group editor copy** uses the approved preview wording and no forbidden words; do not restructure the modal.
- [ ] **Step 2: Verify #296 activity modal copy** (approved preview: `请求主管协助` kept; `申请原因` → `需要主管协助的原因`; `销售原计划` → `原计划` with read-only time display) — the behavior fixes live in #296's plan; this issue only aligns copy and must not change behavior.
- [ ] **Step 3: Full test suite** — `npm test` exit code `0`.
- [ ] **Step 4: Browser walkthrough** (sales → request assistance; supervisor → handle assistance; escalation; correction; mismatch/return) using admin, manager, and sales accounts; record screenshots.
- [ ] **Step 5: Commit any remaining copy/test adjustments.**

---

## Execution gates

### Gate A: before starting
- [ ] #293 and #296 merged, deployed, production gates passed.
- [ ] `git rev-parse origin/main` == GitHub `main` == production `/healthz` `releaseSha`.
- [ ] Worktree + branch `codex/issue-297-ui-copy-unification` created.

### Gate B: before merge
- [ ] Copy scan green over all lists (Task 1 guard passes without env override).
- [ ] `npm test` exit code `0`.
- [ ] Diff review: no permission logic, no data-scope change, no API field semantics change; audit facts unchanged; no production path/database/backup staged.
- [ ] `git diff --check` clean; PR CI green; PR description lists copy scope, data/permission boundaries, and the two previews.

### Gate C: after deployment
- [ ] Production `/healthz` `releaseSha` equals the merged commit.
- [ ] Verify on production: nav + page titles, manager assistance surface, correction surface, empty states, audit trail new copy; screenshot key pages; record SHA + timestamp in Issue #297.

## Commit and release boundaries

One PR for the whole issue (Tasks 1–6), or two sequential PRs if review prefers: (1) guard + navigation/terminology (Tasks 1–3), (2) corrections/buttons/empty states + regression (Tasks 4–6). Do not deploy between them without the copy guard green. Rollback = revert the whole PR; no schema or data migration is involved.

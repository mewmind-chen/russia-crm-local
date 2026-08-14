# Issue 301 Manager Assistance Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 主管协助事项 board becomes a complete handling loop: manager can reply to a sales assistance request directly from the board (same business action as the 今日待办 entry), see the customer's past assistance timeline in the same detail view, no internal field names or stale terminology leak to users, and the detail modal is a two-column layout without long scrolling on 1440x900.

**Architecture:** Reuse the existing `complete_manager_assistance` backend action (today-tasks/actions) from the new board entry — one business action, two entries, identical results. Extend the manager-task detail API with a per-customer assistance history read model. Map all evidence keys through a presentation table; business users never see raw keys or JSON. Two-column modal with fixed footer; only the history region scrolls locally.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla JS, `node:test`, jsdom-style UI contract tests (existing pattern in `test/issue293_permission_group_modal.test.js`), headless Chrome layout verification.

**Approved preview:** https://gist.github.com/edwinwu218-boop/e877407ae26ae63ce74d0235772b6187 (also on htmlpreview.github.io in the issue).

## Current State (verified on production ad0ccbb8, 2026-08-14)

- `openManagerTaskDetail(taskId)` renders `请在今日待办中处理该经理协助请求。` for `manager_assistance` tasks — no form.
- `const evidence = Object.entries(task.evidence || {})` renders raw keys (`activityId`, `nextActionAt`, `progressType`, `requestReason`) and `JSON.stringify` for objects.
- Stale copy: `主管任务详情` (modal title), `主管任务 · 客户名`, `主管介入记录`, `暂无介入记录`, `经理协助` (CSV reason label at `lib/sales_crm.js` ~12454: `manager_assistance: '销售请求经理协助'`).
- The 今日待办 entry `openManagerAssistanceTaskModal(item)` already has the friendly form (`todayTaskManagerForm`: 申请原因/销售原计划/现有联系人/主管处理意见 → `submitTodayTaskAction` with `actionType: 'complete_manager_assistance'`). Reuse as interaction base.
- Backend: manager reply persists into `crm_manager_tasks.result_json` (`{action:'manager_replied', result, activityId, repliedAt}`); task rows carry `evidence_json` (`requestReason`, `originalPlan`, `contacts`, `requestedAt`, `nextAction`, `nextActionAt`, `progressType`, `dueAt`) and `status`.
- Detail API returns `task/account/interventions/risk`; no per-customer assistance history yet.

## Baseline

- Base: refreshed `origin/main` at or after `ad0ccbb8d3c241eb8682b2aff899d6b59f8c6f85`.
- [ ] Confirm `git rev-parse origin/main` == GitHub `main` == production `/healthz` `releaseSha`.
- [ ] Create worktree and branch `codex/issue-301-manager-assistance-loop`.
- [ ] Run baseline focused tests (`node --test test/issue291_manager_assistance_loop.test.js test/issue296_manager_assistance_payload.test.js test/issue293_permission_group_modal.test.js`) and record.

## Global Constraints

- No permission/data-scope changes: only accounts allowed to resolve manager assistance tasks may handle them; sales must not see out-of-scope customers/contacts/history.
- One business action for both entries: 今日待办 and 主管协助事项 both submit `complete_manager_assistance` (or an equivalent single backend path), producing identical state updates (task status, counts, timeline, notifications).
- Audit facts preserved; only display copy becomes business language. Internal keys stay in APIs and exports.
- Internal enum values (e.g. `manager_assistance`, `manager_replied`) unchanged.
- Every task updates affected tests in the same commit; full `npm test` must pass before merge.
- No production path, database, backup, or generated report staged.

## Copy mapping (source of truth)

| Internal / stale | User-visible |
| --- | --- |
| `activityId` | `关联跟进记录` |
| `nextAction` | `原下一步计划` |
| `nextActionAt` | `原计划时间` (business-formatted) |
| `dueAt` | `处理期限` |
| `progressType` | `原跟进方式` (labelized, e.g. email → 邮件) |
| `requestReason` | `请求协助原因` |
| `requestedAt` | `请求时间` |
| `contacts` | `已记录联系人` (readable list, never JSON) |
| `summary` | `情况摘要` |
| `主管任务详情` / `主管任务 · X` | `主管协助事项详情` / `主管协助 · X` |
| `主管介入记录` / `暂无介入记录` | `过往主管协助记录` / `该客户暂无历史主管协助记录` |
| `请在今日待办中处理该经理协助请求。` | (removed — form shown instead) |
| `经理协助` (CSV label) | `主管协助` |
| `回复销售并完成主管任务` | `回复销售并完成协助` |

---

### Task 1: Backend — per-customer assistance history read model

**Files:**
- Modify: `lib/sales_crm.js` (`GET /api/sales-crm/manager-tasks/:taskId` handler)
- Test: `test/issue301_manager_assistance_history.test.js` (new)

**Interfaces:**
- Response adds `customerAssistanceHistory`: rows for the customer's `manager_assistance` tasks (current + past), each with:
  - `taskId`, `requestedAt` (from `evidence_json.requestedAt` or `triggered_at`), `requestReason` (`evidence_json.requestReason`), `originalPlan` (`evidence_json.originalPlan`), `repliedAt`/`replyText` (from `result_json`), `status`, `confirmed` (sales confirmation flag — from the customer's activities carrying the confirmation marker used by today-task state, or the task completion/confirmation state already tracked; reuse existing query patterns at `lib/sales_crm.js` ~6416/6471), `resolvedAt`.
  - Order: newest first. Scope: only the account the manager is authorized to view (reuse `managerTaskAccount` scope).
- Empty → frontend renders `该客户暂无历史主管协助记录`.

- [ ] **Step 1: Write failing tests** (fixture with two manager_assistance tasks for one customer: one replied, one confirmed; assert response fields and ordering; assert no cross-customer leakage).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** the history query inside the existing detail handler.
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add lib/sales_crm.js test/issue301_manager_assistance_history.test.js
git commit -m "feat: return per-customer manager assistance history in task detail API"
```

### Task 2: Frontend — copy mapping, terminology, business evidence rendering

**Files:**
- Modify: `sales-assets/app.js` (`openManagerTaskDetail`, evidence rendering, modal titles)
- Test: extend `test/issue301_manager_task_detail.test.js` (new contract test)

**Interfaces:**
- `managerEvidencePresentation(key)` maps the 9 evidence keys to business labels; `formatManagerEvidenceValue(key, value)` renders dates via `shortDate`, `progressType` via existing progress labels, arrays of contacts as readable lists; unrecognized or object values are hidden from the UI (logged to console only).
- `manager_assistance` tasks render the business request block (请求协助原因 / 销售原计划 / 已记录联系人 / 请求时间 / 处理期限) instead of the generic evidence list.
- Titles: `主管协助事项详情`, `主管协助 · 客户名`; history section `过往主管协助记录`; empty copy `该客户暂无历史主管协助记录`; CSV label `manager_assistance` → `主管协助` (in `lib/sales_crm.js` export labels).

- [ ] **Step 1: Write failing contract tests** (markup assertions: no raw `activityId|nextActionAt|progressType|requestReason` rendered, new labels present, old terms absent).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** rendering changes.
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add sales-assets/app.js lib/sales_crm.js test/issue301_manager_task_detail.test.js
git commit -m "fix: map manager assistance evidence to business copy and unify terminology"
```

### Task 3: Frontend — direct handling from the board (same action as 今日待办)

**Files:**
- Modify: `sales-assets/app.js` (`openManagerTaskDetail`, submit delegation)
- Test: extend `test/issue301_manager_task_detail.test.js` + backend consistency test in `test/issue301_manager_assistance_history.test.js`

**Interfaces:**
- For `manager_assistance` tasks with status `open/overdue/escalated`, the detail modal renders `主管处理意见` textarea (name `managerReply`, required) + `回复销售并完成协助` submit, reusing the `todayTaskManagerForm` structure.
- Submission calls the SAME backend action as the 今日待办 entry: `POST /api/sales-crm/today-tasks/actions` with `actionType: 'complete_manager_assistance'`, `customerId: account.id`, `result`, `idempotencyKey` (if the today-task action API proves awkward with board context, extend `POST /api/sales-crm/manager-tasks/:id/resolve` with an equivalent action — but prefer zero new backend actions).
- On success: close modal, refresh authorized business list + today-task counts, toast `已回复销售，等待销售确认下一步计划`.
- Completed tasks remain read-only with the history timeline visible.
- Permission guard identical to 今日待办 (`complete_manager_assistance` + role + data scope); no scope expansion.

- [ ] **Step 1: Write failing tests** (source contract: board path submits complete_manager_assistance with account.id; backend test: the action resolves the task identically from both entries).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** form + submission + refresh.
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add sales-assets/app.js test/issue301_manager_task_detail.test.js test/issue301_manager_assistance_history.test.js
git commit -m "feat: handle manager assistance requests directly from the manager tasks board"
```

### Task 4: Frontend — two-column modal, fixed footer, local history scroll

**Files:**
- Modify: `sales-assets/app.js` (detail markup structure), `sales-assets/app.css` (layout)
- Test: extend `test/issue301_manager_task_detail.test.js` (CSS layout contracts)

**Interfaces:**
- `manager-task-modal` becomes a wide two-column grid: left (current task facts, request reason, original plan, reply form), right (customer background, contacts, plan risk, 过往主管协助记录 timeline).
- Footer actions fixed at bottom, always visible.
- On 1440x900 the whole modal does not scroll; only the right history region scrolls locally (or collapses when long).
- Narrow screens (<1100px / <700px): single column scroll allowed; primary action stays visible at the bottom.

- [ ] **Step 1: Write failing layout contracts** (CSS assertions mirroring `test/issue293_permission_group_modal.test.js` patterns: two-column rule, fixed footer rule, media queries).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** markup/CSS; verify with headless Chrome at 1440x900 (measure scrollHeight vs clientHeight of modal vs history region).
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add sales-assets/app.js sales-assets/app.css test/issue301_manager_task_detail.test.js
git commit -m "fix: two-column manager assistance detail with fixed footer and local history scroll"
```

### Task 5: Same-class audit of other detail modals

- [ ] Review 今日待办 detail, 跟进更正 detail/processing, 客户经营复盘 detail, AI task detail (business-visible parts), 筛选权限/权限组 details for: view-only actions that should be handleable in place, raw internal fields/JSON/English subtitles, long-scroll layouts at 1440x900.
- [ ] Fix small copy/layout issues in scope; list anything requiring permission/data-structure changes in the PR description and open follow-up issues.

### Task 6: Regression and release

- [ ] Full `npm test` (all suites, incl. 293/296/297 guards) — exit 0.
- [ ] `git diff --check` clean; push; PR; CI green; merge; auto-deploy; production `/healthz` == merged SHA.
- [ ] Browser matrix (admin/manager/sales):
  - Manager: board → 查看并处理 → reply → `已回复销售，等待销售确认下一步计划`; task becomes completed; today-task count refreshes; sales side sees the reply.
  - Same customer history timeline visible with request reason, reply, confirmation state.
  - 1440x900: no long modal scroll; footer visible; history region scrolls locally; screenshot.
  - Narrow viewport: single column; primary action visible.
  - No raw keys (`activityId` etc.) in DOM text.
- [ ] Record screenshots, release SHA, and timestamp in Issue #301; close it.

## Commit and release boundaries

One PR (Tasks 1–4 + 5/6) or two sequential PRs if review prefers (backend history first, then frontend loop + layout). Do not deploy a half state: the board entry and the 今日待办 entry must always resolve identically; rollback reverts the whole PR.

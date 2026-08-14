# Issue 302 Table Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stable column lines on the two high-frequency list pages — CRM客户全景 and 线索池 — with fixed-width 优先级/状态/操作 columns, headers and body cells on the same line, no right-side blank drift, and unchanged sorting/filtering/bulk/pagination/permissions.

**Architecture:** Display-layer only. Add a small render-time helper that assigns semantic column classes (`col-*`) to `th`/`td` after each table render (index-free, resilient to the pool page's conditional AI columns), then define column widths and alignment in CSS under the existing `.data-table` system. No table markup or data semantics change.

**Tech Stack:** Node.js, vanilla JS, CSS, `node:test` (UI contract tests), headless Chrome measurement (column x/width per header vs first body row).

## Current State (verified on production 87af116, 2026-08-14)

- Both pages render through `table(headers, rows)` into `#customerTable` / `#intakeTable` (`.data-table` container with `table{width:100%;min-width:850px}`).
- No column-width rules exist → all columns size to content; action buttons ("退回线索池 + 标记不对口") widen the 操作 column and push 优先级/状态 right; `td{vertical-align:top}` makes status pills sit unevenly; `—` placeholders and button groups drift between rows.
- CRM客户全景 columns (10): 勾选/客户/国家 行业/阶段/负责人/最近动作/下一步/优先级/状态/操作.
- 线索池 columns (7–9, conditional): 勾选?/线索资料 客户标签/Fit readiness 优先级?/候选销售排名?/联系质量 联系人/负责人 阻断原因 (sales: 负责人)/状态 时限/操作. Conditional columns depend on `customerAIEnabled()`/`showAssignmentAI`/`canManualAssign` → fixed nth-child rules would break; column classes must be assigned at render time from the same conditions.

## Baseline

- Base: refreshed `origin/main` at or after `b5931fef707757253cba65cf5889d79fdadf4da7` (current; #301 follow-up).
- [ ] Confirm `git rev-parse origin/main` == GitHub `main` == production `/healthz` `releaseSha`.
- [ ] Create worktree and branch `codex/issue-302-table-alignment`.
- [ ] Record baseline column measurements (headless Chrome 1440x900, before screenshots already at `/tmp/issue296/302-*-before.png`).

## Global Constraints

- Display-only: no permission, data-scope, API, enum, or export changes; no production data modification.
- Sorting, filtering, bulk selection, pagination, row actions and their permission checks must keep working (regression tests + browser checks).
- Reuse existing `.data-table` styling; no large UI refactor.
- Narrow screens keep the existing horizontal-scroll behavior; headers and cells must stay on the same line.
- Full `npm test` must pass before merge.

## Column plan (source of truth)

### CRM客户全景 (#customerTable)

| # | Column | Class | Width |
| --- | --- | --- | --- |
| 1 | 勾选 (conditional) | `col-check` | 36px |
| 2 | 客户 | `col-company` | min-width 260px (auto-flex) |
| 3 | 国家 / 行业 | `col-country` | 150px |
| 4 | 阶段 | `col-stage` | 116px |
| 5 | 负责人 | `col-owner` | 96px |
| 6 | 最近动作 | `col-last` | 110px |
| 7 | 下一步 | `col-next` | 190px |
| 8 | 优先级 | `col-priority` | 70px |
| 9 | 状态 | `col-status` | 128px |
| 10 | 操作 | `col-actions` | **210px fixed** |

### 线索池 (#intakeTable)

| Column | Class | Width |
| --- | --- | --- |
| 勾选 (conditional) | `col-check` | 36px |
| 线索资料 / 客户标签 | `col-company` | min-width 260px (auto-flex) |
| Fit / readiness / 优先级 (AI, conditional) | `col-fit` | 180px |
| 候选销售排名 (AI, conditional) | `col-candidates` | 200px |
| 联系质量 / 联系人 | `col-contact` | 210px |
| 负责人 / 阻断原因 | `col-owner` | 170px |
| 状态 / 时限 | `col-status` | 180px |
| 操作 | `col-actions` | **200px fixed** |

Action cells: `white-space:nowrap`; `.assignment-actions` inside the column stays left-aligned with consistent gap; `—` placeholder occupies the same column position. 优先级/状态/操作 cells use `vertical-align:middle`; pill and priority labels keep a stable line-height.

---

### Task 1: Column-class helper + CRM客户全景 column widths

**Files:**
- Modify: `sales-assets/app.js` (helper + `renderCustomers` calls), `sales-assets/app.css`
- Test: `test/issue302_table_alignment.test.js` (new)

**Interfaces:**
- `applyTableColumnClasses(containerSelector, columnClasses)` assigns `col-*` classes to each `thead th` and each row's `td` by index; no-op when lengths mismatch (defensive).
- `renderCustomers` builds its `columnClasses` array from the same conditions as its headers and calls the helper after `table(...)` renders.
- CSS: the CRM客户全景 column widths above under `#customerTable .data-table` scope; action column fixed 210px.

- [ ] **Step 1: Write failing tests** (source contract: helper exists, called in `renderCustomers` with 10 entries; CSS contains the 10 scoped width rules and the fixed action width).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** helper + call + CSS.
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add sales-assets/app.js sales-assets/app.css test/issue302_table_alignment.test.js
git commit -m "fix: stable column widths for CRM customer portfolio table"
```

### Task 2: 线索池 conditional column classes

**Files:** `sales-assets/app.js`, `sales-assets/app.css`, test file

- [ ] **Step 1: Extend tests** (helper call in `renderIntake` builds class list from the same `showAI`/`showAssignmentAI`/`canManualAssign` conditions; CSS scoped widths under `#intakeTable .data-table`; action column fixed 200px).
- [ ] **Step 2: Run and confirm failures.**
- [ ] **Step 3: Implement** in `renderIntake` after the table render.
- [ ] **Step 4: Focused tests pass** → commit.

```bash
git add sales-assets/app.js sales-assets/app.css test/issue302_table_alignment.test.js
git commit -m "fix: stable column widths for intake pool table with conditional AI columns"
```

### Task 3: Alignment, pill/priority rhythm, action column behavior

- [ ] CSS: short columns `vertical-align:middle`; stable line-height for `.pill`, `.priority`, `statusMarkup` outputs inside these columns; `.col-actions` nowrap + `.assignment-actions` left-aligned consistent gap; `—` placeholder same column line.
- [ ] Browser check: header vs first-row x-offsets equal for every column on both pages (1440x900).
- [ ] Commit.

```bash
git commit -m "fix: align status priority and action cells across customer and pool tables"
```

### Task 4: Other list pages review + regression

- [ ] Review 不对口记录 / 推进管道 / 主管协助事项 / 跟进更正 lists for the same drift; apply the shared `.data-table` rules where safe (small scope), otherwise list findings in the PR.
- [ ] Full `npm test` — exit 0; sorting/filtering/bulk/pagination contract tests untouched and green.
- [ ] Narrow viewport: horizontal scroll preserved, headers and cells aligned.

### Task 5: Release

- [ ] Headless Chrome 1440x900 after-measurements on both pages: per-column x/width equality (header vs first body row), no large right-side blank (table width ≈ container, action column at its fixed width); screenshots before/after stored.
- [ ] Push, PR with before/after screenshots + review findings, CI green, squash merge, auto-deploy.
- [ ] Production `/healthz` == merged SHA; record evidence and close Issue #302.

## Commit and release boundaries

One PR (Tasks 1–4) with the verification artifacts. Rollback = revert the whole PR; no schema or data migration involved.

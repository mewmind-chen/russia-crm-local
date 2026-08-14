# 2026-08-14 Production UI & Workflow Hardening Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each issue's plan. Each issue uses its own branch, tests, release gate, and production verification.

**Goal:** Close the production regression cluster reported on 2026-08-14: permission editor UX, the manager-assistance loop, system-wide copy, table alignment, and the intake assign dead-end with protection/dedupe rework — each as an independently releasable GitHub issue in dependency order.

**Architecture:** Display-layer and lightweight backend fixes only. No permission expansion, no data deletion, no complex auto-merge; stable customer IDs and audit facts preserved. Each issue: plan → worktree → TDD → full suite → PR → squash merge → auto-deploy → production verification → issue close.

**Tech Stack:** Node.js, Express, better-sqlite3, vanilla JS, `node:test`, headless Chrome verification.

## Global Constraints

- Base each issue on the refreshed `origin/main` at its start; confirm `origin/main` == GitHub `main` == production `/healthz` before implementation.
- Never edit `/Users/ylf/Desktop/projects/tradepulse-production/current` directly.
- Production DB restore is manual only; auto-deployer never restores databases.
- No permission/data-scope expansion; sales never see out-of-scope owner/stage/contacts/history/similarity evidence.
- No physical deletion of customers/intake rows/stable IDs; linked IDs are never reused.
- Every issue passes focused tests and full `npm test` before merge; deploy and verify one issue at a time.

---

## Release sequence & status

| Order | Issue | Plan | Production gate | Status |
| --- | --- | --- | --- | --- |
| 1 | [#293](https://github.com/mewmind-chen/russia-crm-local/issues/293) 权限组编辑弹窗 | `2026-08-14-issue-293-permission-group-editor.md` | Business permission model, packs, no scroll @1440x900 | ✅ shipped `2df4a33` |
| 2 | [#296](https://github.com/mewmind-chen/russia-crm-local/issues/296) 请求主管协助提交无反应 | `2026-08-14-issue-296-manager-assistance-submit.md` | checkValidity=true, submit 200, toast visible | ✅ shipped `98d6bb37` |
| 3 | [#297](https://github.com/mewmind-chen/russia-crm-local/issues/297) 全系统文案统一 | `2026-08-14-issue-297-ui-copy-unification.md` | copy scan clean, nav/copy Chinese | ✅ shipped `ad0ccbb8` |
| 4 | [#301](https://github.com/mewmind-chen/russia-crm-local/issues/301) 主管协助事项闭环 | `2026-08-14-issue-301-manager-assistance-loop.md` | board handles directly, history timeline, two-column | ✅ shipped `87af116` + narrow fix `b5931fe` |
| 5 | [#302](https://github.com/mewmind-chen/russia-crm-local/issues/302) 列表页表格对齐 | `2026-08-14-issue-302-table-alignment.md` | allAligned columns, fixed action width @1440x900 | ✅ shipped `3369789` |
| 6 | [#306](https://github.com/mewmind-chen/russia-crm-local/issues/306) 超时领取分配卡死 + 查重重整 | `2026-08-14-issue-306-intake-assign-dedupe.md` | pool shows next step + deep-link; workbench page; three resolutions + linkage; no deletion | 🔄 in progress (Task 1✅ Task 2 fix round) |

## Execution gates

### Gate A: before starting each issue
- [ ] `git fetch origin main`; confirm `origin/main` == GitHub `main` == production `/healthz` `releaseSha`.
- [ ] Create isolated worktree + branch `codex/issue-<n>-<slug>`.
- [ ] Record baseline focused tests.

### Gate B: before merge
- [ ] Focused tests + full `npm test` exit 0.
- [ ] Route authorization / data scope / audit / redaction review.
- [ ] No production path, database, backup, or generated report staged.

### Gate C: after deployment
- [ ] Production `/healthz` releaseSha equals merged commit.
- [ ] Browser matrix (admin/manager/sales) + screenshots; record SHA/timestamp in the issue; close it.

## Notes

- #296/297/301/302 plan documents were kept locally during their runs and are committed to `main` together with this roadmap via the #306 branch docs commit.
- #306 runs under superpowers:subagent-driven-development with a per-task ledger at `.superpowers/sdd/2026-08-14-issue-306-intake-assign-dedupe/progress.md` (worktree-local).

# TradePulse Planning

This directory contains the authoritative product and execution plans for the
TradePulse CRM. The files were migrated from the preserved
`tradepulse-ai-crm` experiment on 2026-07-24 so that planning history, code,
tests, and GitHub review share one repository. The imported snapshot matches
the experiment's documentation commit `dfa3c1451dd0dda16bddb4ac84c3d53de89fac8f`.

- `tradepulse-unified-master-plan.md` defines product boundaries, architecture,
  release gates, and the overall delivery sequence.
- `tradepulse-execution-plan.md` defines task-level implementation,
  verification, rollback, and progress records.

## Update workflow

For each implementation task:

1. Synchronize the clean `repo/main` and local `codex/ai-integration` refs.
2. Create a short-lived `codex/ai-*` branch from the latest
   `origin/codex/ai-integration`.
3. Implement and verify the task in an external worktree with an isolated
   runtime.
4. Push the branch, open a PR to `codex/ai-integration`, and merge only after
   CI passes.
5. Update both planning documents with the feature commit, PR, merge SHA,
   verification evidence, remaining scope, and next task. Publish that update
   through a short documentation PR before starting the next feature.
6. Merge to `main` and deploy only when the applicable stage release gate is
   explicitly satisfied.

The historical copies under `/Users/ylf/Desktop/projects/tradepulse-ai-crm`
are archived mirrors and are not the authoritative planning source after this
migration.

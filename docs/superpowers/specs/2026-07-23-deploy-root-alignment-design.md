# Production Deploy Root Alignment

## Decision

The only default production root is `$HOME/Desktop/projects/tradepulse-production`.
`DEPLOY_ROOT` overrides that root. All managed paths derive from it:

- `current`: stable runtime symlink used by every code LaunchAgent
- `releases`: immutable GitHub `main` releases
- `shared`: persistent `.env`, SQLite data, reports, logs, and run artifacts
- `state`: deploy state, lock, bare Git repository, and SQLite deployment backups

Existing fine-grained variables (`DEPLOY_CURRENT_LINK`, `DEPLOY_RELEASES_DIR`,
`DEPLOY_SHARED_ROOT`, `DEPLOY_STATE_DIR`, and `DEPLOY_GIT_DIR`) remain explicit
test and migration overrides. The auto-deploy LaunchAgent records `DEPLOY_ROOT`
so a scheduled run cannot fall back to another directory.

The development checkout is never a runtime path, release destination, or shared
data root. The installer still verifies that its bootstrap release is the active
CRM release before changing LaunchAgents.

## Verification

Contract tests cover root-derived defaults, fine-grained overrides, LaunchAgent
environment propagation, and installer dry-run output. Existing deployment,
rollback, health, and full-suite tests remain required.

# E0-06 Candidate Validation Environment Fix

Date: 2026-07-23

## Scope

The macOS LaunchAgent test fixture now removes inherited deployment path
overrides before it starts installer subprocesses. This keeps installer tests
hermetic while candidate validation continues to use an isolated CRM runtime.

No production account, permission, database, AI router, service, or release
pointer is changed by this fix.

## Failure Reproduced

Running the complete test suite with `CRM_RUNTIME_ROOT` set to the isolated
candidate validation runtime caused the legacy installer fixture to render
LaunchAgents against that inherited path instead of its fixture `current`
symlink.

## Verification

- `npm ci`: passed
- `npm test` with the candidate validation environment: 240 passed, 0 failed
- `node --check server.js`: passed
- `zsh -n scripts/deploy-from-github.sh`: passed
- `python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts`: passed
- `git diff --check`: passed

The production `current` symlink and running services were not changed.

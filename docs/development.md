# Development Environment

TradePulse development must run from an external Git worktree with its own runtime. It must never reuse the production database, `.env`, logs, reports, sessions, credentials, or outbound channels.

## Directory Layout

```text
/Users/ylf/Desktop/projects/tradepulse-development/
  repo/                         # clean main clone
  worktrees/
    environment-unification/    # codex/environment-unification
    ai-integration/             # future codex/ai-integration
  runtime/
    <worktree>/
      .env
      data/crm.db
      logs/
      reports/
      recon-runs/
      contact-recon-runs/
      contact-recon-reports/
      backups/
      output/
      tmp/
  snapshots/sanitized/
  artifacts/
```

The clean clone is only for fetching `origin/main` and managing worktrees. Make code changes in a named worktree, never in `repo/main`.

## Runtime Configuration

Create a development-only `.env` inside the selected runtime directory. Use absolute paths:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3100
CRM_PRODUCTION_ROOT=/Users/ylf/Desktop/projects/tradepulse-production
CRM_RUNTIME_ROOT=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>
CRM_DB_PATH=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/data/crm.db
RECON_OUTPUT_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/recon-runs
CONTACT_RECON_OUTPUT_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/contact-recon-runs
CONTACT_RECON_REPORT_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/contact-recon-reports
CRM_REPORTS_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/reports
CRM_BACKUP_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/backups/data-maintenance
CRM_LOGS_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/logs
CRM_OUTPUT_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/output
CRM_TMP_DIR=/Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/tmp
```

Do not copy the production `.env`. Add only development credentials that are explicitly approved for local use. Keep outbound email, messaging, and production webhooks disabled.

## Path Protection

At application startup, all managed paths are normalized and existing symlinks are resolved.

- `development` and `test` reject a runtime, database, output, report, or backup path that resolves inside `tradepulse-production`.
- `production` requires the runtime to resolve inside the production root.
- `production` requires the database to resolve inside `shared/data`.
- `production` requires generated output and backups to resolve inside `shared`.
- A symlink cannot be used to bypass these checks.

Tests must create temporary directories through the operating system and inject paths through environment variables. Tests must not hardcode a user home path.

## Commands

From the selected worktree:

```bash
npm ci
npm test
node --check server.js
git diff --check
```

Load the runtime file explicitly before starting a development server, then verify the resolved database is the development database:

```bash
set -a
source /Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/.env
set +a
npm start
```

Development uses port 3100. Additional worktrees use 3201 or higher. Bind only to `127.0.0.1`.

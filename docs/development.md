# Development Environment

> **当前重构工作区提示：** 下文的 `tradepulse-development`/`runtime` 布局仅保留为历史或通用隔离示例，不能据此选择当前基线。当前目录、权威入口和工作规则以 `docs/governance/README.md` 为准。

TradePulse development must run from an external Git worktree with its own runtime. It must never reuse the production database, `.env`, logs, reports, sessions, credentials, or outbound channels.

## Directory Layout

```text
/Users/ylf/Desktop/projects/tradepulse-development/
  repo/                         # clean main clone
  worktrees/
    environment-unification/    # codex/environment-unification
    <named-refactor>/           # a task-specific branch from the verified remote main baseline
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

Current work starts from a freshly verified remote `main` baseline. Current
facts and next steps are determined by production `current`/release state,
the `after/` Git checkout, code and tests, and `docs/governance/`; see
`docs/governance/WORK_PROTOCOL.md`. The 2026-07-25 planning material is frozen
archive evidence and must not drive a branch, task order, progress statement,
or release decision.

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

Set `CRM_AI_STATIONS_ENABLED=true` only in the isolated development runtime when testing AI stations. Production defaults to disabled when the variable is absent; a production rollout must opt in explicitly after the release gate.

AI Station requests only enqueue durable jobs. Run the independent development Worker in a second terminal with the same development runtime loaded:

```bash
set -a
source /Users/ylf/Desktop/projects/tradepulse-development/runtime/<worktree>/.env
set +a
npm run crm:ai-worker
```

Use `npm run crm:ai-worker -- --once` for one claim attempt. `CRM_AI_JOB_LEASE_MS`, `CRM_AI_WORKER_IDLE_MS`, `CRM_AI_EXECUTION_TIMEOUT_MS`, and `CRM_AI_WORKER_ID` may be set in the development runtime. Queue warnings use `CRM_AI_QUEUE_BACKLOG_WARNING` and `CRM_AI_QUEUE_WAIT_WARNING_MS`; only due, dependency-ready jobs contribute to the wait warning.

Worker concurrency is coordinated through the shared SQLite database, not process memory. The defaults are `global=10`, `deepseek=4`, `web=4`, `kimi-cli=1`, and `hermes=1`. Override the complete resource map with `CRM_AI_EXECUTION_RESOURCES_JSON`; each entry requires `maxConcurrency` and may set `rateLimit` plus `rateWindowMs`. For example:

```bash
CRM_AI_EXECUTION_RESOURCES_JSON='{"global":{"maxConcurrency":8,"rateLimit":60,"rateWindowMs":60000},"deepseek":{"maxConcurrency":4,"rateLimit":30,"rateWindowMs":60000},"kimi-cli":{"maxConcurrency":1,"rateLimit":0,"rateWindowMs":60000},"hermes":{"maxConcurrency":1,"rateLimit":0,"rateWindowMs":60000}}'
```

`CRM_AI_STATION_RESOURCES_JSON` optionally maps a station to an additional task-level resource. The Worker holds the global task slot and customer lock for the full job lease, while each real Router engine attempt holds its own engine slot. Heartbeats renew all claims; success, retry, cancellation, policy block, timeout, 429, and expired-lease recovery release them transactionally. Do not start this Worker against production until the Control Plane release gate explicitly enables AI Stations.

AI usage and budget governance is also coordinated through the shared database. Each Router attempt is normalized into the cost ledger; provider usage is preferred, while missing usage is explicitly marked and charged with the configured conservative estimate. The Worker reserves the maximum Router-attempt estimate before a model call, settles the actual attempts afterwards, and releases unused or orphaned reservations. Configure a versioned pricing snapshot and persistent policies with:

```bash
CRM_AI_COMPANY_ID=default
CRM_AI_PRICING_JSON='{"version":"internal-pricing-v1","default":{"defaultAttemptCost":0.05,"inputPerMillion":1,"outputPerMillion":4,"reserveInputTokens":3000,"reserveOutputTokens":1500},"engines":{},"models":{}}'
CRM_AI_BUDGET_POLICIES_JSON='[{"scopeType":"company","scopeId":"default","dailyLimit":20,"monthlyLimit":400,"perTaskLimit":0.5,"warningRatio":0.8}]'
```

Policy scopes are `company`, `team`, `user`, and `station`; limit amounts are USD and zero means no limit for that period. A projected 80% threshold writes an `ai_budget_alert`; reaching 100% blocks new nonessential model calls as durable policy blocks. CRM reads, history, and manual non-AI workflows remain available. Keep `CRM_AI_STATIONS_ENABLED=false` until the production release gate is approved.

## Production Customer Snapshot

Development must never point at the live production database. To refresh realistic customer data, use the one-way snapshot importer. It preserves development users, permission groups, sessions and AI router settings, maps production ownership to development accounts by role, and excludes production credentials, sessions, permission overrides, webhooks and bot bindings.

Preview only:

```bash
npm run crm:sync-production-customers
```

After stopping the development server, apply the snapshot:

```bash
npm run crm:sync-production-customers -- --apply
```

The importer creates a consistent read-only production snapshot, backs up the development database under `runtime/<worktree>/backups/customer-sync`, replaces only the customer-data whitelist in one transaction, and fails if the final foreign-key check is not clean.

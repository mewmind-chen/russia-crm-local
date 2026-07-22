# AI Engine Router Design

## Goal

Make CRM AI Q&A resilient to provider outages and slow responses. Administrators can set one global mode (`auto`, `kimi-cli`, `hermes`, or `deepseek`) without restarting the service. In automatic mode, the application checks cached engine health and selects the first usable engine in this order:

1. Kimi CLI
2. Hermes
3. DeepSeek

The router must avoid Cloudflare 504 responses by bounding total model time and skipping engines that recently failed.

## Scope

Included:

- Persistent global engine mode in SQLite.
- In-process engine health cache and circuit breaker.
- Lightweight engine probes and manual recheck.
- Automatic selection and bounded request fallback.
- Administrator status and settings API.
- Administrator control in the existing Users and Permissions view.
- Conversation engine affinity through `sessionEngine`.
- Structured logging of selection, attempts, failures, and fallback.
- Unit and route-level regression tests.

Excluded:

- Per-user or per-conversation model selection.
- Parallel model racing.
- Provider billing dashboards.
- Automatic credential updates or balance purchases.
- A general-purpose configuration center.

## Architecture

### Router Module

Add `lib/assistant_router.js` as the only component responsible for engine policy. It exposes operations equivalent to:

- `getAssistantRuntimeState()`
- `setAssistantMode(mode, actor)`
- `refreshAssistantHealth(options)`
- `routeAssistantModel(messages, options, adapters)`

The router owns policy and health state but receives engine adapters as dependencies. This keeps it testable without invoking real providers and avoids coupling provider-specific code to persistence and fallback rules.

### Engine Adapters

The existing adapters remain responsible for provider calls:

- `callKimi()` in `lib/kimi_assistant.js`
- `callHermes()` in `lib/hermes_assistant.js`
- `callDeepSeek()` in `lib/assistant.js`

Each adapter accepts an optional per-attempt timeout supplied by the router. Manual fixed mode continues to use the configured adapter timeout. Automatic mode uses shorter bounded attempts so one slow engine cannot consume the entire proxy deadline.

Each adapter keeps the existing read-only prompt and tool restrictions.

### Persistence

Create one SQLite settings table in `data/crm.db`:

```sql
CREATE TABLE IF NOT EXISTS assistant_runtime_settings (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'auto',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
```

Only the global `default` row is used. Allowed modes are `auto`, `kimi-cli`, `hermes`, and `deepseek`. An invalid or missing value falls back to `auto`.

Health state is intentionally in memory. A process restart resets it to `unknown` and triggers fresh probes; stale operational observations must not be treated as durable configuration.

## Health Model

Each engine has:

- `status`: `unknown`, `checking`, `healthy`, or `unhealthy`
- `latencyMs`
- `lastCheckedAt`
- `lastSuccessAt`
- `lastFailureAt`
- `retryAfter`
- `errorCode`
- `errorMessage`

Rules:

1. A successful probe or business request marks the engine healthy.
2. A provider/configuration/timeout failure marks it unhealthy and opens a five-minute circuit.
3. An open circuit is skipped in automatic mode.
4. The five-minute scheduler only probes unknown engines or unhealthy engines whose retry time has arrived. It does not repeatedly probe a healthy engine while successful business requests continue to refresh it.
5. An administrator recheck bypasses the circuit and probes all engines.
6. Probe prompts request a minimal response and use a short configurable timeout.
7. Only sanitized status is returned to clients; credentials and raw provider output are never exposed.

This approach limits synthetic model traffic while still recovering failed providers automatically.

## Request Routing

### Automatic Mode

1. Load the global mode and current health snapshot.
2. If a valid `sessionEngine` is supplied and is healthy, try it first to preserve conversation continuity.
3. Otherwise use healthy candidates in `kimi-cli`, `hermes`, `deepseek` order.
4. If no candidate is known healthy, synchronously probe candidates in order until one succeeds.
5. Execute the business request on the selected engine.
6. If it fails with an engine-level error and the overall deadline has enough remaining time, mark it unhealthy and try the next healthy candidate.
7. Attempt at most two engines for one business request.
8. Return the successful engine, model, attempt metadata, fallback reason, session ID, and `sessionEngine`.

The router enforces an overall model budget below the external proxy timeout. The initial implementation uses a configurable 75-second overall budget and shorter automatic per-attempt limits. Retrieval time remains outside the model router and is already logged in the request duration.

### Fixed Mode

Fixed `kimi-cli`, `hermes`, or `deepseek` mode invokes only that engine. If the cached circuit is open, the request fails immediately with the last sanitized reason. The administrator can run a manual recheck or return the system to automatic mode.

Fixed mode does not silently fall back because that would contradict the administrator's explicit selection.

### Error Classification

The router may fail over for engine-specific errors such as:

- Missing executable or credentials
- Provider HTTP errors, including insufficient balance
- Provider timeout
- Empty or invalid provider output
- Engine concurrency/busy errors

Input validation, CRM authorization, database errors, and evidence retrieval errors are not engine failures and must not trigger another model.

If all eligible engines fail, return one JSON error describing that no AI engine is currently available and include sanitized per-engine reasons. The API must not leak a provider-generated HTML error page.

## Conversation Behavior

Responses add `sessionEngine`. The workbench stores it with `sessionId` and sends both on the next turn.

- When the same engine remains available, the adapter resumes its native session.
- When policy or health selects another engine, the router omits the old native session ID and relies on the existing compact message history for continuity.
- The successful replacement engine returns a new `sessionId` and `sessionEngine`.
- Starting a new conversation clears both values.

The single-turn customer drawer requires no session changes.

## API

### Existing Chat API

`POST /api/assistant/chat` accepts the optional `sessionEngine` field and returns:

- `engine`
- `model`
- `sessionId`
- `sessionEngine`
- `fallbackReason`
- `engineAttempts`

Existing clients remain compatible when they omit `sessionEngine`.

### Runtime Status

`GET /api/assistant/runtime`

- Requires `use_ai_assistant` to read basic selected-engine state.
- Detailed engine errors and administrator controls require `manage_users`.

Response contains the global mode, automatic priority, health snapshot, active engine candidate, timestamps, and sanitized errors.

### Runtime Settings

`PATCH /api/assistant/runtime`

- Requires `manage_users`.
- Accepts `{ "mode": "auto|kimi-cli|hermes|deepseek" }`.
- Persists immediately and returns the updated runtime state.

`POST /api/assistant/runtime/recheck`

- Requires `manage_users`.
- Starts or awaits a bounded health refresh and returns the new snapshot.
- Concurrent rechecks share one in-flight refresh.

## Administrator UI

Add a compact AI Engine panel to the existing Users and Permissions view. It contains:

- Global mode selector: Automatic, Kimi, Hermes, DeepSeek.
- Current automatic priority text.
- One status row per engine with state, response time, last check, and sanitized failure reason.
- Recheck command with a pending state.

Saving a mode calls the runtime settings API and updates the displayed state without reloading or restarting the server. Non-administrators do not see the control.

## Logging

Extend assistant logs with:

- requested mode
- selected engine
- session engine
- attempted engines
- per-attempt duration and sanitized result code
- circuit skips
- final fallback reason

Health probes log compact events separately from user prompts and never log credentials.

## Configuration

Add documented defaults:

```dotenv
ASSISTANT_ENGINE=auto
ASSISTANT_ENGINE_PRIORITY=kimi-cli,hermes,deepseek
ASSISTANT_HEALTH_INTERVAL_MS=300000
ASSISTANT_HEALTH_RETRY_MS=300000
ASSISTANT_HEALTH_PROBE_TIMEOUT_MS=12000
ASSISTANT_ROUTER_TIMEOUT_MS=75000
ASSISTANT_ROUTER_MAX_ATTEMPTS=2
ASSISTANT_AUTO_ATTEMPT_TIMEOUT_MS=30000
```

The persisted SQLite mode overrides `ASSISTANT_ENGINE`. The environment value supplies the initial/default mode when the settings row does not exist.

## Testing

Use test-driven development. Tests must fail before production implementation is added.

Router unit tests cover:

- Default automatic priority.
- Manual fixed mode.
- Healthy-engine selection.
- Open-circuit skipping.
- Unknown-engine probing.
- Failure marking and fallback to the next engine.
- Maximum two attempts and overall budget enforcement.
- No fallback for non-engine errors.
- Manual recheck de-duplication.
- Settings validation and persistence.
- Session affinity and session reset on engine switch.

Route/UI tests cover:

- Administrator-only settings mutation and recheck.
- Basic status visibility for permitted non-admin users without detailed errors.
- Chat request/response `sessionEngine` compatibility.
- Admin UI selector and health rows.

Regression verification includes existing Hermes, Kimi, assistant, permission, and sales UI tests.

## Rollout

1. Deploy code with the persisted mode defaulting to `auto`.
2. Start the service and run the bounded health recheck.
3. Confirm Kimi is selected and answers a real CRM question through the local origin.
4. Confirm the same request through `https://crm.newmindchen.com` returns JSON before the proxy deadline.
5. Temporarily select a fixed engine and return to automatic mode to verify administrator switching.
6. Confirm logs show engine selection and no Cloudflare 504.

Rollback consists of selecting a known working fixed engine. The previous environment-only behavior remains available by setting the initial mode and leaving the stored setting fixed.

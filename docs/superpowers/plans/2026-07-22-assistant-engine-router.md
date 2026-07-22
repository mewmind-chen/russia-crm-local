# AI Engine Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent administrator-controlled AI engine mode with cached health checks, circuit breaking, and bounded automatic failover before deploying it to `crm.newmindchen.com`.

**Architecture:** A focused `lib/assistant_router.js` module owns SQLite settings, in-memory health, engine selection, probes, and fallback. Existing Hermes, Kimi, and DeepSeek adapters remain provider-specific and gain per-call timeout support. `server.js` exposes protected runtime APIs, while the existing Users and Permissions page provides the global control.

**Tech Stack:** Node.js CommonJS, Express, better-sqlite3, Node test runner, vanilla browser JavaScript/CSS, launchd deployment, Cloudflare Tunnel.

## Global Constraints

- Global modes are exactly `auto`, `kimi-cli`, `hermes`, and `deepseek`.
- Automatic priority is exactly `kimi-cli`, `hermes`, `deepseek`.
- Health retry and scheduler interval default to 300000 ms.
- A request attempts at most two engines and uses a 75000 ms model-routing budget.
- Fixed mode never silently falls back.
- Only `manage_users` may change mode or force a health recheck.
- Existing read-only CRM evidence and model tool restrictions remain unchanged.
- Existing uncommitted user changes must be preserved.

---

### Task 1: Router Policy, Health Cache, and Persistence

**Files:**
- Create: `lib/assistant_router.js`
- Create: `test/assistant_router.test.js`

**Interfaces:**
- Consumes: adapter map `{ 'kimi-cli': fn, hermes: fn, deepseek: fn }`, where each function accepts `(messages, options)` and returns an assistant result.
- Produces: `createAssistantRouter(options)`, `getAssistantRouter()`, `VALID_ASSISTANT_MODES`, and `DEFAULT_ENGINE_PRIORITY`.
- Router methods: `getRuntimeState(options)`, `setMode(mode, actor)`, `refreshHealth(adapters, options)`, `route(messages, requestOptions, adapters)`, and `stop()`.

- [ ] **Step 1: Write failing router tests**

Create tests that use a temporary SQLite database and deterministic fake adapters:

```js
test('auto mode selects the first healthy engine in configured priority', async () => {
  const router = createTestRouter();
  router.recordSuccess('kimi-cli', 25);
  router.recordSuccess('hermes', 10);
  const result = await router.route([{ role: 'user', content: 'test' }], {}, {
    'kimi-cli': async () => ({ answer: 'kimi', engine: 'kimi-cli' }),
    hermes: async () => ({ answer: 'hermes', engine: 'hermes' }),
    deepseek: async () => ({ answer: 'deepseek', engine: 'deepseek' }),
  });
  assert.equal(result.engine, 'kimi-cli');
});

test('auto mode opens a circuit and falls back after an engine timeout', async () => {
  const router = createTestRouter();
  router.recordSuccess('kimi-cli', 10);
  router.recordSuccess('hermes', 10);
  const result = await router.route([{ role: 'user', content: 'test' }], {}, {
    'kimi-cli': async () => { const e = new Error('timeout'); e.code = 'KIMI_CLI_TIMEOUT'; throw e; },
    hermes: async () => ({ answer: 'ok', engine: 'hermes', sessionId: 'hermes_session' }),
    deepseek: async () => ({ answer: 'unused', engine: 'deepseek' }),
  });
  assert.equal(result.engine, 'hermes');
  assert.equal(result.sessionEngine, 'hermes');
  assert.deepEqual(result.engineAttempts.map(item => item.engine), ['kimi-cli', 'hermes']);
  assert.equal(router.getRuntimeState({ detailed: true }).engines['kimi-cli'].status, 'unhealthy');
});

test('fixed mode returns the selected engine error without fallback', async () => {
  const router = createTestRouter({ mode: 'hermes' });
  let kimiCalls = 0;
  await assert.rejects(() => router.route([], {}, {
    'kimi-cli': async () => { kimiCalls += 1; },
    hermes: async () => { const e = new Error('down'); e.code = 'HERMES_FAILED'; throw e; },
    deepseek: async () => ({ answer: 'unused' }),
  }), /down/);
  assert.equal(kimiCalls, 0);
});
```

Also cover invalid modes, persistence across router instances, circuit expiry, unknown-engine probing, maximum two attempts, non-engine error behavior, shared in-flight refresh, and session ID removal when switching engines.

- [ ] **Step 2: Run router tests and verify RED**

Run:

```bash
node --test test/assistant_router.test.js
```

Expected: FAIL because `lib/assistant_router.js` does not exist.

- [ ] **Step 3: Implement the router**

Implement the public constants and factory. Use a single `assistant_runtime_settings` row named `default`, validate modes with a `Set`, keep health in memory, and sanitize errors:

```js
const VALID_ASSISTANT_MODES = new Set(['auto', 'kimi-cli', 'hermes', 'deepseek']);
const DEFAULT_ENGINE_PRIORITY = ['kimi-cli', 'hermes', 'deepseek'];

function isEngineError(error) {
  return Boolean(error && (
    /^[A-Z0-9_]*(HERMES|KIMI|DEEPSEEK|ASSISTANT_ENGINE)[A-Z0-9_]*$/.test(String(error.code || ''))
    || [402, 429, 502, 503, 504].includes(Number(error.statusCode))
  ));
}
```

Ensure `route()`:

- Applies session affinity only when `sessionEngine` is valid and usable.
- Probes in priority order only when no healthy candidate exists.
- Adds `timeoutMs` and remaining budget to adapter options.
- Marks provider failures unhealthy.
- Attempts no more than two engines.
- Omits a foreign `sessionId` after an engine switch.
- Returns `sessionEngine`, `engineAttempts`, and `fallbackReason`.
- Throws one JSON-safe `ASSISTANT_ENGINES_UNAVAILABLE` error when automatic candidates are exhausted.

- [ ] **Step 4: Run router tests and verify GREEN**

Run:

```bash
node --test test/assistant_router.test.js
```

Expected: all router tests pass with no provider network calls.

- [ ] **Step 5: Commit router core**

```bash
git add lib/assistant_router.js test/assistant_router.test.js
git commit -m "feat: add resilient AI engine router"
```

---

### Task 2: Provider Timeout Overrides and Assistant Integration

**Files:**
- Modify: `lib/hermes_assistant.js`
- Modify: `lib/kimi_assistant.js`
- Modify: `lib/assistant.js`
- Modify: `test/hermes_assistant.test.js`
- Modify: `test/kimi_assistant.test.js`
- Create: `test/assistant_model_router.test.js`

**Interfaces:**
- Consumes: singleton router from Task 1.
- Produces: `callAssistantModel(messages, options)` routed through the singleton; `assistantRuntimeState(options)`, `setAssistantRuntimeMode(mode, actor)`, and `recheckAssistantEngines(options)` for HTTP routes.

- [ ] **Step 1: Write failing adapter and integration tests**

Add adapter tests asserting `options.timeoutMs` overrides the environment timeout without mutating global configuration. Add integration tests with injected adapters:

```js
test('callAssistantModel reports the engine selected by auto routing', async () => {
  const result = await callAssistantModel([{ role: 'user', content: 'test' }], {
    router: createHealthyTestRouter('kimi-cli'),
    adapters: {
      'kimi-cli': async () => ({ answer: 'ok', engine: 'kimi-cli', model: 'Kimi CLI · k3' }),
      hermes: async () => ({ answer: 'unused', engine: 'hermes' }),
      deepseek: async () => ({ answer: 'unused', engine: 'deepseek' }),
    },
  });
  assert.equal(result.engine, 'kimi-cli');
  assert.equal(result.sessionEngine, 'kimi-cli');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/hermes_assistant.test.js test/kimi_assistant.test.js test/assistant_model_router.test.js
```

Expected: FAIL because adapters ignore request timeouts and `callAssistantModel` does not accept router injection.

- [ ] **Step 3: Add per-call timeout support**

In Hermes and Kimi adapters, compute the effective timeout from `options.timeoutMs` with safe bounds and pass it to `execFile`. Return the effective timeout in `guardrails.timeoutMs`.

Change DeepSeek to accept options:

```js
async function callDeepSeek(messages, options = {}) {
  const effectiveTimeout = boundedAssistantTimeout(options.timeoutMs, timeoutMs());
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  // existing request and response parsing
}
```

- [ ] **Step 4: Route all generative calls through the router**

Replace the current engine switch and Hermes-only fallback in `callAssistantModel()` with the singleton router. Keep deterministic SQL answers unchanged. Export runtime wrapper functions for `server.js` and include `sessionEngine` in both generic and current-customer model calls.

Update request extraction in `answerAssistantQuestion()`:

```js
const sessionId = cleanText(payload.sessionId);
const sessionEngine = cleanText(payload.sessionEngine);
```

Pass both values into model routing and return the selected engine metadata.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test test/hermes_assistant.test.js test/kimi_assistant.test.js test/assistant_model_router.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit provider integration**

```bash
git add lib/hermes_assistant.js lib/kimi_assistant.js lib/assistant.js test/hermes_assistant.test.js test/kimi_assistant.test.js test/assistant_model_router.test.js
git commit -m "feat: route assistant requests across healthy engines"
```

---

### Task 3: Protected Runtime APIs and Logging

**Files:**
- Modify: `server.js`
- Create: `lib/assistant_runtime_api.js`
- Create: `test/assistant_runtime_api.test.js`

**Interfaces:**
- Consumes: runtime wrapper functions from Task 2 and existing `hasPermission()`/`requireUnifiedUser` policy.
- Produces: `GET /api/assistant/runtime`, `PATCH /api/assistant/runtime`, and `POST /api/assistant/runtime/recheck`.

- [ ] **Step 1: Write failing API policy tests**

Test `createAssistantRuntimeHandlers()` from `lib/assistant_runtime_api.js` with fake users and router functions:

```js
test('assistant runtime mutation requires manage_users', async () => {
  const handler = createAssistantRuntimeHandlers(fakeRuntime);
  const response = await invoke(handler.patch, {
    salesUser: { permissions: { use_ai_assistant: true, manage_users: false } },
    body: { mode: 'kimi-cli' },
  });
  assert.equal(response.statusCode, 403);
});

test('administrator can persist auto mode and force recheck', async () => {
  // assert setMode and refreshHealth are called exactly once
});
```

Also assert ordinary AI users receive a redacted runtime view without raw engine failure details.

- [ ] **Step 2: Run API tests and verify RED**

Run:

```bash
node --test test/assistant_runtime_api.test.js
```

Expected: FAIL because runtime handlers and routes do not exist.

- [ ] **Step 3: Implement protected handlers and routes**

Implement `createAssistantRuntimeHandlers()` in `lib/assistant_runtime_api.js`. Inject `hasPermission`, runtime state, settings, and recheck functions so tests do not start the HTTP listener. Register the handlers in `server.js` and return JSON consistently:

```js
app.get('/api/assistant/runtime', runtimeHandlers.get);
app.patch('/api/assistant/runtime', runtimeHandlers.patch);
app.post('/api/assistant/runtime/recheck', runtimeHandlers.recheck);
```

Extend compact request logging with `sessionEngine`, and compact result logging with `engineAttempts` and selected runtime mode. Ensure provider failures are returned as `{ ok: false, error, code, engines? }` rather than HTML.

- [ ] **Step 4: Start the health monitor without holding process shutdown open**

Initialize the router monitor when the server starts. The interval must call `.unref()` and share any in-flight health refresh.

- [ ] **Step 5: Run API tests and verify GREEN**

Run:

```bash
node --test test/assistant_runtime_api.test.js
```

Expected: all runtime permission and response tests pass.

- [ ] **Step 6: Commit API support**

```bash
git add server.js lib/assistant_runtime_api.js test/assistant_runtime_api.test.js
git commit -m "feat: expose protected AI runtime controls"
```

---

### Task 4: Administrator Control, Documentation, and Full Verification

**Files:**
- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js`
- Modify: `sales-assets/app.css`
- Modify: `Index.html`
- Modify: `.env.example`
- Modify: `docs/ai-assistant.md`
- Modify: `test/sales_menu.test.js`

**Interfaces:**
- Consumes: runtime APIs from Task 3.
- Produces: administrator engine selector, health display, manual recheck, and workbench `sessionEngine` persistence.

- [ ] **Step 1: Write failing UI contract tests**

Extend `test/sales_menu.test.js` to assert:

```js
assert.match(salesHtml, /id="assistantRuntimePanel"/);
assert.match(appJs, /\/api\/assistant\/runtime/);
assert.match(appJs, /manage_users/);
assert.match(workbenchHtml, /sessionEngine/);
```

Add assertions for Automatic, Kimi, Hermes, DeepSeek labels and the recheck command.

- [ ] **Step 2: Run UI tests and verify RED**

Run:

```bash
node --test test/sales_menu.test.js
```

Expected: FAIL because the runtime panel and session engine persistence are absent.

- [ ] **Step 3: Implement the administrator panel**

Add an unframed runtime panel to the Users and Permissions section. Load status only for users with `manage_users`, save mode through `PATCH`, and run recheck through `POST`. Render stable rows for all three engines with state, latency, last check, and sanitized error. Disable controls while requests are pending.

- [ ] **Step 4: Persist the conversation engine**

In `Index.html`, add `sessionEngine` to assistant state, request payload, local storage, debug metadata, and new-conversation clearing. When a response changes engine, replace both native session fields.

- [ ] **Step 5: Update configuration and functional documentation**

Set the sample default to `ASSISTANT_ENGINE=auto`, add router/health environment variables, and update `docs/ai-assistant.md` with automatic routing, runtime endpoints, admin workflow, and deployment behavior.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node --test test/assistant_router.test.js test/assistant_model_router.test.js test/assistant_runtime_api.test.js test/hermes_assistant.test.js test/kimi_assistant.test.js test/sales_menu.test.js
npm test
git diff --check
```

Expected: all tests pass and `git diff --check` prints nothing.

- [ ] **Step 7: Commit UI and documentation**

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css Index.html .env.example docs/ai-assistant.md test/sales_menu.test.js
git commit -m "feat: add administrator AI engine controls"
```

---

### Task 5: Deploy and Verify Production

**Files:**
- Verify: feature worktree Git state
- Create: a detached release under `/Users/ylf/Desktop/projects/russia-crm-releases/`
- Modify: `/Users/ylf/Library/LaunchAgents/com.russia-crm.server.plist`
- Verify: `/Users/ylf/Desktop/projects/russia-crm-local/logs/assistant.log`

**Interfaces:**
- Consumes: committed implementation and existing release deployment workflow.
- Produces: running production service with automatic engine mode and evidence of local plus public success.

- [ ] **Step 1: Inspect the deployment diff and active release inputs**

Run:

```bash
git status --short
git log --oneline -5
git diff HEAD^ --stat
```

Expected: implementation commits contain only intended files; unrelated pre-existing changes remain preserved.

- [ ] **Step 2: Deploy with the repository's release mechanism**

Push `codex/assistant-engine-router`, merge it into `origin/main` through a reviewed pull request, fetch the merge commit, and create a detached release worktree named from its short SHA. Link `.env`, `data`, `logs`, report/output directories, and other runtime state using the same targets as the current release. Run `npm ci --omit=dev` and `npm test` in the candidate before switching launchd. Update only the server plist working directory/command to the new release, then use `launchctl bootout`, `launchctl bootstrap`, and `launchctl kickstart`. Keep the previous release directory intact for rollback.

- [ ] **Step 3: Verify process and runtime health locally**

Use the signed-in in-app browser session to open the Users and Permissions view, set Automatic mode, and trigger Recheck without exposing credentials. In the terminal, verify the new Node process cwd, port 3000 listener, local root response, and latest assistant runtime log. Confirm Kimi reports healthy in the administrator panel.

- [ ] **Step 4: Verify a real AI question through local origin and Cloudflare**

Send one bounded CRM question locally and one through `https://crm.newmindchen.com/api/assistant/chat`. Confirm both return JSON, select `kimi-cli` in automatic mode, and finish below the proxy deadline.

- [ ] **Step 5: Verify manual switching and rollback control**

Set fixed Kimi, read status, return to automatic mode, and confirm the persisted setting. Do not force known-broken Hermes in a way that delays production traffic.

- [ ] **Step 6: Inspect logs and report evidence**

Confirm `logs/assistant.log` contains selected engine, attempt durations, and no new 504 for the verification request. Report the release path, process status, public result duration, selected engine, and any residual provider failures.

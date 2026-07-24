# A1-09 Development Real-Model Smoke

- Timestamp (UTC):
- Integration/code SHA:
- Environment: isolated development only
- Database path (no secrets):
- Base URL:
- Provider/engine available:
- Result: passed / blocked

## Safety Preconditions

- `NODE_ENV=development`
- `CRM_AI_STATIONS_ENABLED=true`
- `CRM_AI_CUSTOMER_ENRICHMENT_ENABLED=true`
- `CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED=true`
- Explicit isolated `CRM_AI_ENRICHMENT_SMOKE_DB_PATH`
- Explicit loopback development base URL (production port 3000 is refused)
- Development-only login and provider credentials
- No production secret substitution
- No external sales message endpoint
- No owner mutation endpoint

## Command

Dry-run first:

```bash
node scripts/smoke-ai-customer-enrichment.js --dry-run
```

Live development run:

```bash
node scripts/smoke-ai-customer-enrichment.js
```

## Allowlisted Result

Record only the script's allowlisted JSON output:

- Disposable customer and CRM account IDs
- Enrichment run and node IDs
- Engine/model and token usage/cost
- Evidence count
- Final route
- Owner unchanged
- Elapsed time

Do not paste environment dumps, passwords, cookies, provider keys, raw contact evidence, or
generated runtime files into this document.

## External Blocker (if any)

- Missing prerequisite:
- Exact non-secret error:
- Production credentials used: no
- Follow-up owner:

## Cleanup / Rollback Boundary

The smoke creates one uniquely named `[DISPOSABLE ...]` customer in the explicitly selected
development database. It does not deploy code, touch the production database, send sales messages,
or change the customer's owner. Remove the disposable development database/customer through the
normal development-data cleanup process when the evidence is no longer needed.

# crm-recon-hermes memory

- This automation uses the original Hermes worker flow for daily Russia CRM recon.
- It prepares up to 10 queued jobs with `npm run recon:hermes:daily`.
- Hermes performs full-depth OSINT/recon through `scripts/recon_agent_worker.py` and the original `russia-recon` skill.
- Do not submit shallow or bootstrap reports. A valid report needs the same depth as the former Hermes worker: identity anchoring, official-site verification, procurement/public traces, sanctions checks, mandatory Step 5 contact search, mandatory Step 5+ when no concrete person is found, Chinese report sections, and at least 6 effective evidence URLs.
- If a report is rejected, the worker must补充 recon and rerun; do not bypass the original flow with the Codex submit script.
- Do not invoke Codex-only submission or codex-specific shortcuts for this workflow.

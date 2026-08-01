# Open Issues Controlled Dual-Track Execution Design

## Goal

Resolve the currently open CRM Issues, excluding #104, without losing any confirmed requirement and without allowing parallel branches to create an unsafe merge or production migration sequence.

The approved operating model is controlled dual-track parallelism:

- Independent analysis, tests, backend foundations, and frontend work may run concurrently when file ownership and contracts are explicit.
- Integration, database changes, and production deployment pass through serialized gates in dependency order.
- Every downstream branch rebases immediately after its prerequisite merges.
- One integration owner controls merge order, production rollout, and rollback decisions.

## Baseline

- Repository: `mewmind-chen/russia-crm-local`
- Planning baseline: `origin/main` at `47a882e06f87b16d2959a13d2a3fdb26b8831a32`
- Production release observed during assessment: the same SHA
- Open Issues in scope: #96, #168, #169, #170, #171, #172, #173, and the newly extracted #174
- Explicitly excluded: #104
- Open pull requests at assessment time: none

The production application is concentrated in several large shared files:

- `lib/sales_crm.js`
- `sales-assets/app.js`
- `sales-assets/app.css`
- `sales-crm.html`
- `lib/access_control.js`

Logical independence therefore does not imply conflict-free merging. The design uses short-lived branches, strict ownership during parallel work, and serialized merge gates.

## Scope And Requirement Ownership

### Issue #169: Customer Contact Lead Terminology

Rename only the contact-discovery concept from "负责人线索" to "客户联系人线索" and remove ambiguous contact-module wording.

Preserve:

- The `view_contacts` permission key.
- Existing routes, APIs, schemas, and role defaults.
- Internal sales-owner terminology where "负责人" genuinely means the assigned salesperson.

This is the first merge because it is a small vocabulary contract that later permission and UI work should consume.

### Issue #96: Intake And CRM State Invariant

Ensure one stable customer cannot remain both an actionable intake lead and an active CRM customer. This Issue owns:

- Repair of the intake/CRM synchronization invariant, including the `assigned` state.
- Audited cleanup of existing conflicting production records.
- Stable-customer grouping of today-task reasons after permission scoping.
- Consistent task counts across the sidebar, dashboard, top summary, and task list.
- Prevention of duplicate assignment and duplicate task actions.

Read-only assessment found three production conflicts: `RU-0019`, `RU-0027`, and `RU-0029`. The migration must preserve historical assignment evidence while removing their active intake assignment state.

### Issue #168: Mobile Today-Task Closure

Make the final today-task model usable on desktop and 320, 375, 390, and 430 pixel widths. This Issue owns:

- Responsive task rendering.
- Access to all valid task actions without horizontal page overflow.
- Refresh behavior after an action.
- Desktop regression coverage.

It does not define task identity or backend grouping; those contracts come from #96. It may be developed concurrently with #96 under frontend-only ownership, but it merges after #96 and rebases onto the corrected contract.

### Issue #172: Protected Customers And Global Nickname Identity

Establish the identity and visibility contract used by all later customer operations. This Issue owns:

- An administrator-only protected-customer list.
- Stable Alpha nickname matching.
- Company-wide uniqueness across current and historical nicknames.
- Previewed and auditable batch import, activation, and eligible rollback.
- Preservation of the stable customer number during activation.
- Complete exclusion of protected customers from sales search, assignment, tasks, notifications, workload, metrics, and ordinary exports.
- Generic non-disclosing duplicate responses to unauthorized users.

The design uses a normalized name registry mapped to one stable external customer ID. A protected customer remains a customer master plus a protection record and does not receive a CRM account row until activation.

#172 is divided into three mergeable increments:

1. Preflight scanner, canonical normalization, identity registry, migration conflict report, and permission/API contracts.
2. Import preview/commit/rollback, activation, exact/fuzzy privacy, concurrency protection, and uniqueness enforcement after conflicts are resolved.
3. Administrator UI, template/download, authorized mapping export, and responsive tests.

### Issue #170: Deferred Planning And Manager Intervention

Implement a truthful alternative to inventing a next step. This Issue owns:

- "已有明确计划" and "暂未确定" states.
- Mandatory future review time for an undetermined plan.
- Future-time validation in every frontend and backend plan entry point using one explicit business timezone.
- Configurable thresholds, enable/disable controls, minimum samples, ratios, and recipients.
- One open manager task per customer and reason, with real completion actions and escalation to the owner.
- Customer and salesperson measures, including plan formation and timely real action after a plan.
- Terminal-stage behavior and explicit reactivation requirements.
- Immutable actor and owner snapshots, audit, notifications, and role-scoped drill-down.

This feature uses additive event, task, and configuration tables. Historical missing plans are not retroactively treated as deferred-plan events.

### Issue #171: Correct Misfiled Customer Activity

Allow an authorized salesperson to correct an activity or supported milestone recorded against the wrong customer while preserving history. This Issue owns:

- Immutable original records marked superseded for operational calculations.
- Linked effective replacement records.
- Atomic and idempotent correction of source and destination customers.
- Creator, owner, target-scope, manager, and administrator authorization.
- Audit, notification, timeline, export, retry, and concurrency behavior.
- Recalculation of stage, latest activity, next plan, alerts, manager tasks, and statistics from effective history.
- Stable linkage between activity records and RFQ, quote, or order records before those milestones are correctable.

#171 must consume both #172's protected-customer identity contract and #170's deferred-plan and manager-task state. It is divided into:

1. Effective-activity schema, commerce linkage, deterministic account-state rebuild, and effective-only reader behavior.
2. Correction transaction/API, authorization, audit, notification, export, rollback, and idempotency.
3. Timeline, target search, confirmation UI, refresh persistence, and responsive end-to-end coverage.

### Issue #174: Team Status

#174 contains all implementation previously added to #173 for the new Team Status information architecture. It owns:

- Rename of the existing "销售能力" entry to "团队状态".
- Business Progress, Sales Capability, and Collaboration Support views.
- Preservation of the current sales score ring, capability breakdowns, personal funnel, strengths, weaknesses, coaching suggestions, sample count, and insufficient-sample state.
- Fact-based collaboration generated from real manager tasks, interventions, reassignments, plans, outcomes, and escalations.
- A short audited entry for assistance that occurred outside the system.
- Owner, manager, and salesperson scope rules.
- Desktop and mobile behavior, drill-down, filtering, empty states, errors, and source distinction.

It must not create a manager leaderboard, a manager score, or employee judgments based on login time, clicks, text length, or raw action counts. It depends on #170 and is implemented after #171 so all effective-history calculations are stable.

### Issue #173: Final Cross-Role Acceptance Gate

#173 remains the final end-to-end gate rather than a feature implementation branch. It validates:

- A salesperson recording a real customer action and plan.
- A manager understanding, acting on, completing, or escalating a task.
- An owner understanding recent 7-day, 30-day, and since-last-view team state.
- Permissions, duplicate submission, refresh recovery, failed-input preservation, and stable customer identity.
- Desktop and mobile screenshots.
- API/database state before and after representative actions.
- Findings and evidence from all prerequisite Issues, including #174.

Any defect discovered during #173 is fixed in a focused PR linked to its owning Issue or to #173 if it is purely cross-flow integration.

## Dependency Graph

```text
#169 terminology
  |
  +--> #96 backend invariant --------+
  |                                  |
  +--> #168 frontend/mobile ---------+  merge #96, rebase, merge #168
                                     |
                                     v
                         #172 identity/protection A -> B -> C
                                     |
                                     v
                         #170 deferred-plan A -> B -> C
                                     |
                                     v
                         #171 correction A -> B -> C
                                     |
                                     v
                              #174 Team Status
                                     |
                                     v
                         #173 final cross-role acceptance
```

## Controlled Dual-Track Model

### Track A: Stable Data And Workflow Contracts

Track A owns the backend invariants and data model:

1. #96 intake/CRM invariant and audited repair.
2. #172 normalized identity registry and protected-customer lifecycle.
3. #170 deferred-plan events, manager tasks, settings, notifications, and metrics.
4. #171 effective activity, account rebuild, and correction transaction.

Only one Issue in this track may be in integration or migration work at a time. Later Issues may prepare tests and designs but cannot merge code against a provisional predecessor contract.

### Track B: User Interface And Acceptance

Track B owns bounded UI work against an approved backend contract:

1. #168 mobile today-task presentation while #96 backend work proceeds.
2. #172 administrator UI after #172 backend APIs stabilize.
3. #170 workflow UI after its state and route contracts stabilize.
4. #171 correction UI after its service contract stabilizes.
5. #174 Team Status UI and drill-down after all metric/event contracts stabilize.
6. #173 cross-role acceptance evidence.

Track B may start test fixtures and layout work early. It must rebase before integration and must not duplicate backend policy in the browser.

## Parallel Work Matrix

| Work pair | Allowed concurrently | Merge rule |
| --- | --- | --- |
| #96 backend and #168 frontend | Yes, with strict file ownership | Merge #96 first; rebase and test #168 |
| #172 identity preflight and #96/#168 | Preparation and isolated backend tests only | Integrate #172 after #96; UI after #168 |
| #170 and #172 | Design/tests may overlap | Merge all #172 contracts before #170 implementation |
| #171 and #172 | State-machine design/tests only | Full #171 implementation waits for #172 |
| #171 and #170 | No shared backend implementation | Merge #170 before #171 |
| #174 and #170/#171 | Prototype and acceptance cases only | Data/API implementation waits for both |
| #173 and earlier Issues | Acceptance script preparation only | Execute and close last |

Parallel agents receive explicit file and contract ownership. No agent may modify a shared integration file outside its assigned boundary without notifying the integration owner.

## Branch And Pull Request Rules

- Create each branch from the current `origin/main`, never from the stale primary checkout or production release directory.
- Use one branch per listed increment when an Issue is split into A/B/C.
- Each pull request links its Issue and lists its predecessor SHA.
- Before review, fetch and rebase onto the latest `origin/main` after all prerequisites merge.
- Do not stack long-lived branches across more than one unmerged prerequisite.
- The integration owner reviews migrations, route contracts, permission changes, and shared-file conflicts.
- A PR is mergeable only when focused tests and the full test suite pass on the rebased commit.
- Merge commits or squash commits may follow repository convention, but the production release SHA must map unambiguously to the merged source.

## Database And Migration Design

All migrations are expand-only during this sequence:

- Add tables, columns, indexes, and compatible triggers before enabling new writes.
- Do not drop or rebuild live tables in an ordinary deployment.
- Do not reinterpret historical absence as a new event.
- Make every migration idempotent and test it against both an empty database and a production database copy.
- Run SQLite backup, integrity check, foreign-key check, and feature-specific preflight immediately before deployment.

#96 must explicitly replace faulty trigger definitions; `CREATE TRIGGER IF NOT EXISTS` is insufficient. Cleanup writes require before/after audit records for the three known conflicts.

#172 must not create a startup unique index until normalized duplicate preflight reports zero unresolved cross-table and historical conflicts. Name enforcement becomes database-backed only after conflict resolution.

#170 and #171 initially deploy with new write paths disabled when rollback to old code would misinterpret new records. Enable writes only after schema, permission, and read-path smoke tests pass.

The current deploy process backs up SQLite but code rollback does not automatically restore the database. After enabling incompatible new writes, rollback requires a deliberate compatibility or data-restore procedure, not only switching the release symlink.

## Test And Verification Gates

Each increment follows test-first implementation. The implementation plan will name exact tests and commands, but every merge gate includes:

1. Focused unit and integration tests for the Issue.
2. Permission tests for administrator, owner, manager, salesperson, archived user, and unauthorized direct API access where applicable.
3. Two-connection concurrency and retry tests for identity, correction, and task uniqueness.
4. Failure injection around multi-write transactions.
5. Full repository test suite with serialized database-sensitive tests when required.
6. Browser verification at desktop and 320/375/390/430 pixel widths for UI Issues.
7. No page-level horizontal overflow, clipped actions, console errors, or hidden permission bypass.
8. Production-database-copy migration and data-count verification before a migration PR is deployable.

## Merge And Release Gates

The serialized merge order is:

1. #169.
2. #96.
3. #168 after rebase.
4. #172-A, #172-B, #172-C.
5. #170-A, #170-B, #170-C.
6. #171-A, #171-B, #171-C.
7. #174.
8. #173 acceptance fixes and final evidence.

Production deployments follow the same order. A merge does not automatically authorize deployment of the next stage until the current release passes:

- Expected `/healthz` SHA locally and publicly.
- Process and reverse-proxy health.
- SQLite `integrity_check` and `foreign_key_check`.
- Feature-specific database counts and audit rows.
- Role-scoped API smoke tests.
- Controlled real-action smoke test for newly enabled writes.
- Browser checks for the changed desktop and mobile flows.
- Monitoring of logs and task/notification duplication after deployment.

If a gate fails, pause later merges and deployments. Roll back code only when the database remains backward compatible; otherwise disable the feature flag or execute the documented data rollback under a maintenance window.

## Completion Definition

This program is complete only when:

- #96, #168, #169, #170, #171, #172, and #174 meet their own acceptance criteria.
- #173 passes all three role workflows with the required screenshots, timing, permission, failure, retry, and data evidence.
- Production reports the intended final SHA and healthy database checks.
- No confirmed requirement from the source Issues or comments is omitted from its owner Issue or final acceptance matrix.
- #104 remains unchanged and excluded.


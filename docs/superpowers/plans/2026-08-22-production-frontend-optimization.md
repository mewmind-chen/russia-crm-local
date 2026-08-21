# Production Frontend Optimization Plan

> Status: proposed
> Scope: production frontend only
> Baseline: `main` at `5d13704` (2026-08-21)

## Goal

Improve the production CRM's accessibility, responsive workflows, information hierarchy, table scanning, and async feedback without changing business behavior.

## Scope Boundary

Included: `sales-crm.html`, `sales-assets/*.css`, `sales-assets/*.js`, `shared-assets/ui-system.css`, and frontend contract tests.

Excluded: server code, API routes and contracts, database/schema, permissions, customer lifecycle, Recon workers, AI workers, and the AI Task Center UI. The AI Task Center, AI governance panel, model/cost/worker filters, and AI task pagination are explicitly out of scope because they are not exposed in production.

## Issue Breakdown

| Order | Issue | Estimate |
| --- | --- | ---: |
| 0 | Baseline, release and test capture | 0.5-1 day |
| 1 | Accessibility and interaction baseline | 1-1.5 days |
| 2 | Responsive CRM workflow | 2-3 days |
| 3 | Visual tokens, typography and shapes | 1.5-2 days |
| 4 | Dashboard hierarchy | 1.5-2 days |
| 5 | Customer/lead tables and filters | 2-3 days |
| 6 | Customer Drawer and profile hierarchy | 1.5-2.5 days |
| 7 | Loading, empty, error and saving states | 1-1.5 days |
| 8 | Copy, icons and template-trace cleanup | 1-1.5 days |
| 9 | Multi-role browser regression and production verification | 1.5-2 days |

Total: 12-17 engineering days, or 14-19 days including browser and production verification. Approximately 40 tracked execution steps.

## Execution Order

`0 -> 1 -> 2 -> 3 -> 5 -> 6 -> 4 -> 7 -> 8 -> 9`

## Acceptance Gates

- Preserve API request paths, parameters, response contracts, permissions, and data scope.
- Verify Admin, Manager, and Sales roles.
- Verify 375x812, 768x1024, 1024x768, 1440x900, and 1920px+.
- No page-level horizontal scrolling.
- Keyboard navigation, focus return, reduced-motion, labels, and live regions pass review.
- `npm test`, frontend contract tests, Node syntax checks, and copy scan pass.
- Production `/healthz` release SHA matches the deployed commit.
- AI Task Center is absent from the implementation and acceptance matrix.

## Work Breakdown

### Issue 1 - Accessibility and interaction baseline

Add Dialog semantics and focus isolation to Customer Drawer; complete labels and accessible names; add explicit button types; improve Escape/Tab behavior; expose loading/error/success states; keep icon-only controls labeled.

### Issue 2 - Responsive CRM workflow

Use stable viewport units and safe areas; make the mobile Drawer full-screen; split common and advanced filters; keep only priority table columns on small screens; preserve intentional table scrolling; enforce 44px mobile controls.

### Issue 3 - Visual system

Normalize semantic colors, system-first Chinese typography, tabular figures, 11px minimum operational text, 6-8px panel/control radii, restrained shadows, explicit transitions, and reduced-motion behavior.

### Issue 4 - Dashboard hierarchy

Prioritize "需要我处理", make the funnel readable at wide widths, reduce equal-weight KPI treatment, and remove decorative section labels without changing metrics or APIs.

### Issue 5 - Tables and filters

Improve row rhythm, company-name anchoring, status semantics, secondary-field hierarchy, action-column stability, advanced-filter disclosure, applied-filter chips, reset behavior, and mobile detail routing. Keep authorization and serialization unchanged.

### Issue 6 - Customer Drawer and profile

Use grouped definition rows for identity, business, contacts, compliance, and lifecycle; promote next action; separate human evaluation, history, and audit; handle empty values and long content; preserve existing customer APIs.

### Issue 7 - Async states

Add shape-matched skeletons, actionable empty/error states, saving/submitting/claiming feedback, batch selection scope, and accessible live updates.

### Issue 8 - Copy and visual cleanup

Remove unnecessary English eyebrow labels, Unicode remnants, repeated pills, decorative dots, version strips, excess separators, and non-semantic motion. Do not remove valid product terminology.

### Issue 9 - Verification

Run focused and full tests; test all three roles and all production views; capture the viewport matrix; verify keyboard and reduced-motion behavior; check production health and record screenshots.

## Rollback

Each issue is independently revertible. No database or backend rollback is required. A release is accepted only after the production SHA and browser evidence are recorded.

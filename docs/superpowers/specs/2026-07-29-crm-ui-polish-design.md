# CRM UI Polish Design

## Goal

Improve the production TradePulse CRM as a focused B2B operations tool without
changing its business workflows, API contracts, permissions, or customer data.
The work must make daily scanning and repeated actions faster while giving the
interface a consistent, professional visual language.

The implementation will upgrade the existing HTML, CSS, and JavaScript in place.
It will not introduce React, Tailwind, shadcn/ui, a build step, or a parallel
frontend.

## Approved Direction

The selected direction is a professional operations interface:

- cool neutral backgrounds and clear white work surfaces;
- deep teal as the brand and primary-action color;
- blue reserved for links and informational actions;
- amber for pending attention and red for destructive or critical states;
- restrained borders, shadows, and radii;
- dense but readable typography suitable for repeated CRM work;
- Lucide-style line icons instead of Unicode symbols and emoji;
- stable interaction states without decorative bounce or scale effects.

Two alternatives were considered and rejected:

- A complete CSS rewrite would be faster initially but would create excessive
  regression risk across permission-driven and dynamically rendered views.
- Migrating to a component framework would expand the task beyond visual polish
  and duplicate mature DOM, API, and test contracts.

## Scope

### Included

- CRM shell, sidebar, top bar, buttons, inputs, badges, cards, panels, tables,
  drawers, modals, empty states, and feedback states.
- Dashboard visual hierarchy and the orphaned seventh metric.
- Customer panorama and lead-pool filter presentation.
- Customer and lead table readability.
- Embedded customer profile overview, Recon empty state, and tag editor.
- Desktop widths from 1024 to 2174 pixels and mobile widths down to 375 pixels.
- Chinese UI copy normalization where raw internal status values currently leak
  into the interface.

### Excluded

- Backend data model or API changes.
- Permission behavior, filter authorization, customer lifecycle, assignment,
  Recon execution, or AI behavior changes.
- New dashboards, charts, themes, or dark-mode controls.
- A wholesale redesign of every administration page.
- Modification of current user work in other branches or worktrees.

## Visual System

### Color Tokens

The existing CSS variables will be normalized into semantic tokens:

| Token | Value | Use |
|---|---|---|
| `--surface-page` | `#F5F7F9` | application background |
| `--surface-panel` | `#FFFFFF` | panels, tables, dialogs |
| `--surface-subtle` | `#F7F9FB` | table headers, grouped controls |
| `--text-primary` | `#18212F` | headings and body |
| `--text-secondary` | `#667085` | supporting information |
| `--border-default` | `#E2E7ED` | panels, rows, inputs |
| `--brand` | `#0F766E` | primary actions and active navigation |
| `--brand-hover` | `#0B625B` | primary hover |
| `--brand-subtle` | `#E7F5F2` | active and selected backgrounds |
| `--info` | `#2563EB` | links and informational states |
| `--warning` | `#B7791F` | due and pending states |
| `--warning-subtle` | `#FFF8E6` | warning backgrounds |
| `--danger` | `#C2413B` | destructive, overdue, failed |
| `--danger-subtle` | `#FFF1F0` | danger backgrounds |

Decorative radial gradients and glass effects will be removed from normal work
surfaces. Color must carry a stable semantic meaning and must not be the only
status indicator.

### Typography

The font stack remains system-first:

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
"Noto Sans CJK SC", "Noto Sans SC", sans-serif
```

The scale is:

| Role | Size | Weight | Line height |
|---|---:|---:|---:|
| page title | 24px | 650 | 1.3 |
| section title | 18px | 650 | 1.35 |
| panel title | 16px | 650 | 1.4 |
| body and controls | 14px | 400-600 | 1.5 |
| table body | 13px | 400-600 | 1.45 |
| metadata and labels | 12px | 500-600 | 1.45 |
| exceptional microcopy | 11px | 500 | 1.4 |

No operational text may be smaller than 11px. Page titles and panel titles must
not share the same size. Letter spacing is zero. Numeric KPI and comparison
columns use tabular figures.

### Shape, Borders, and Elevation

- Standard controls and panels use 6-8px radii.
- Pills remain fully rounded only for statuses and compact filters.
- Standard panels use a one-pixel border and no shadow.
- Menus, drawers, modals, and active floating controls may use a restrained
  elevation shadow.
- Nested card treatment is removed. A section can contain grouped rows but not
  another layer of decorative cards.

### Interaction

- Desktop controls are at least 40px high; mobile controls are at least 44px.
- Hover, focus, selected, disabled, loading, and destructive states are
  visually distinct.
- Transitions are limited to color, opacity, border, and shadow for 150-200ms.
- Button and card scale or translate effects are removed.
- Keyboard focus uses a visible teal focus ring.
- Reduced-motion preferences disable nonessential transitions.

## Shell and Navigation

The sidebar keeps its existing information architecture and permission-based
visibility. Navigation symbols are replaced with a consistent line-icon set.
The active item uses a pale teal background, teal icon, stronger text, and a
three-pixel active rail. Counts use neutral badges by default and red only for
critical counts.

The top bar becomes a calm 64px work header. The page title is the strongest
text element. Repeated English eyebrow labels are removed from routine pages;
English remains only where it communicates a product or technical identifier.
Primary and secondary actions follow a single hierarchy rather than competing
filled buttons.

The main work area remains fluid but stops expanding beyond approximately
1680px. At wider viewports it is centered within the available space after the
sidebar. This prevents funnel bars, header actions, and dense text from
stretching across an unreadable distance.

## Dashboard

The dashboard retains its existing data and panels.

- Six lifecycle KPIs remain in the primary metric row.
- `超期 / 待介入` moves into the `需要我处理` panel header as a prominent
  attention summary, eliminating the orphaned seventh card.
- KPI labels use 12px text, values use 28px tabular figures, and notes use 12px.
- The funnel retains horizontal bars but has a bounded measure so labels,
  values, and percentages remain visually connected on wide screens.
- `需要我处理` uses stronger row titles, readable supporting copy, and clear
  danger affordances without filling the whole row red.
- Market and activity panels use the same table and feed rhythm as the rest of
  the product.

## Customer Panorama and Lead Pool

### Filter Presentation

The authorization-aware filter controller and serialized filter payload remain
unchanged. Only presentation and default expansion change.

The always-visible filter row contains:

- keyword search;
- country;
- owner;
- customer stage or lead status;
- result count;
- apply and detailed-filter actions.

All other filters appear in a collapsible advanced region or right-side filter
drawer. Applied advanced filters remain visible as removable summary chips, so
collapsed controls never hide active state. The user can clear all active
filters in one action.

Large native listboxes are replaced visually with compact checkbox menus or
grouped disclosure controls while preserving the existing filter controller.
Repeated filter values are deduplicated before display. Customer-tag categories
are collapsed by default and show selected counts.

At 1440x900, the customer and lead table header must be visible without vertical
scrolling. Summary metrics may not push the lead table below the second screen.

### Tables

- Table headers use 12px semibold text on a subtle neutral surface.
- Company names use 14px semibold text and act as the row anchor.
- Body text uses 13px; secondary identifiers, dates, and sources use 12px.
- Rows use separators and a pale teal hover surface, not shadows.
- Website links display a normalized domain plus an external-link icon.
- Product arrays render as a maximum of three readable chips plus `+N`.
- Internal English statuses render through the existing Chinese label mapping.
- Status cells combine an icon or dot with text; color alone is insufficient.
- Sticky headers and the existing horizontal table containment remain.

## Customer Profile

The outer CRM profile toolbar and embedded workbench contract remain unchanged.
The embedded overview is reorganized visually into four section surfaces:

1. identity and location;
2. business profile and product demand;
3. contact channels;
4. compliance, source, and lifecycle timestamps.

Individual fields no longer render as independent cards. Each section uses a
compact definition-row layout with 12px labels and 14px values. Empty values use
a quiet `暂无` state; repeated empty optional fields may collapse into one
summary rather than producing a wall of dashes.

On desktop, related definition rows can use two columns. At 375px, they become a
single readable column without horizontal scroll. The identity header, profile
tabs, and available actions stay visually distinct and do not duplicate the
company name.

The Recon empty state uses one consistent line icon, a direct explanation, and
one primary action. It must fill the available section intentionally without
leaving an unexplained blank screen.

## Tag Editor

Existing tag IDs, permission checks, create-tag behavior, and save APIs remain
unchanged.

- A search field filters visible tag names client-side.
- Each category is a disclosure section with selected and total counts.
- Categories with selections start expanded; others start collapsed.
- Selected tags use a teal subtle surface and a visible check indicator.
- The mobile profile uses a sticky bottom action bar with Cancel and Save.
- Save remains available to keyboard and screen-reader users and reflects its
  loading state.
- The new-tag form is visually separated from preset selection but remains in
  the same Tags tab.

At 375px, users must not need to return to the top of a 2000px list to save.

## Empty, Loading, and Feedback States

Empty states use a compact line icon, one sentence describing the state, and a
recovery or creation action when one exists. Loading states reserve their final
space and use skeleton rows when the wait is perceptible. Toasts use
`aria-live="polite"`, do not steal focus, and remain visible long enough to
read. Error messages state the failure and the next recovery action.

## Responsive Behavior

Verification targets are 375x812, 768x1024, 1024x768, 1440x900, and a viewport
at least 1920px wide.

- No viewport may produce page-level horizontal scrolling.
- Mobile profile content remains within the iframe width.
- Tables keep intentional internal horizontal scrolling when columns cannot
  collapse safely.
- Fixed or sticky actions reserve content space and do not cover the last row.
- Text does not truncate critical customer names without an accessible way to
  read the full value.

## Accessibility

- All icon-only buttons have Chinese accessible names and tooltips where useful.
- Navigation, tabs, disclosure controls, menus, drawers, and dialogs are
  keyboard operable.
- Focus order follows visual order.
- Text and meaningful icons meet WCAG AA contrast.
- Status is never communicated by color alone.
- Reduced motion is respected.
- Mobile targets meet the 44px minimum.

## Implementation Boundaries

Primary files:

- `sales-assets/app.css`: shell, typography, navigation, dashboard, tables,
  profile shell, and responsive visual system.
- `sales-assets/filter-component.css`: compact and advanced filter presentation.
- `sales-assets/app.js`: dashboard metric grouping and display formatting only.
- `sales-crm.html`: icon markup and small semantic structure changes.
- `Index.html`: embedded profile sections, tag disclosures, empty states, and
  related styles.

JavaScript changes must preserve existing element IDs, events, permission gates,
filter serialization, API calls, and postMessage integration unless an automated
test is updated to document an intentional markup change.

## Testing

Automated tests will cover:

- visual-system tokens and minimum typography rules;
- semantic icon buttons and accessible labels;
- six dashboard KPI cards plus attention summary placement;
- customer and lead filters preserving controller payload and active state;
- advanced filters collapsed by default with active-filter summaries;
- product arrays and statuses formatted for display;
- profile field grouping without removing Issue 127/128 fields from the API;
- tag search, category disclosure, selection state, and sticky save controls;
- existing permission and profile-access behavior.

The existing Issue 116, 124, 128, and 130 frontend tests must remain green.
The full Node test suite must pass.

Browser verification will use authenticated production-equivalent data at all
target viewports. Screenshots will cover the dashboard, customer panorama, lead
pool, customer profile overview, Recon empty state, and tag editor. Verification
will check non-overlap, table visibility, scroll containment, focus states, and
legible content rather than relying only on screenshot appearance.

## Acceptance Criteria

1. The interface uses the approved semantic palette, type scale, radii, borders,
   icons, and interaction states consistently.
2. Page titles are visually distinct from panel titles; operational text is
   never smaller than 11px.
3. At 1440x900, customer and lead table headers are visible without vertical
   scrolling through the full advanced-filter catalog.
4. At 1920px or wider, the main content and funnel remain within a readable
   measure.
5. The dashboard has no orphan metric card and keeps urgent work visually
   prominent.
6. Tables show readable company anchors, normalized websites, formatted product
   tags, and Chinese statuses.
7. The 375px profile has no horizontal scroll and presents related fields as
   compact groups rather than 19 independent cards.
8. Tag selection supports search and grouped disclosure, and saving is available
   at the bottom of the mobile viewport.
9. Existing permissions, data, APIs, filters, customer lifecycle, Recon, and AI
   behavior are unchanged.
10. Targeted UI tests, the complete test suite, and desktop/mobile browser
    verification pass.

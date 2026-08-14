# Issue #293 Permission Group Editor Design

## Context

Issue #293 was written against `main` at `2bed57f`. The current baseline is
`08eca7e`, which already provides three permission categories, switch controls,
and a wide personal-permission editor. The permission-group editor still uses
the generic 620px modal, exposes legacy recycle-bin wording, lacks complete
descriptions and category counts, and has no group-default reset flow.

The confirmed preview at
`https://gist.github.com/edwinwu218-boop/154dbdd0c639db9d92528b5a3b97bd53`
is the visual reference. This design preserves its information hierarchy and
no-scroll desktop goal without requiring pixel-level reproduction.

## Goals

- Use the available desktop viewport so the active permission category is fully
  visible without an internal scrollbar at ordinary desktop sizes.
- Show only current product concepts and current navigation names.
- Keep all persisted permission keys, server checks, role templates, audit
  history, and personal overrides compatible.
- Make every visible permission understandable through a short description.
- Add an explicit, confirmed reset of the current permission group to its role
  template without changing personal overrides or other groups.
- Preserve the existing personal-permission editor behavior from Issues #229
  and #291.

## Non-Goals

- No role-model redesign or new approval workflow.
- No deletion or semantic reuse of persisted permission keys.
- No expansion of any user's customer, contact, identity-review, or audit scope.
- No redesign of the surrounding user-and-permissions page.
- No automatic save when resetting a group template.

## Approaches Considered

### 1. CSS-only expansion

Add a wide class to the existing modal and reduce card spacing. This has the
smallest diff, but it leaves stale labels, missing descriptions, hidden-value
semantics, and reset behavior unresolved. It does not satisfy the Issue.

### 2. Dedicated group editor with a frontend compatibility layer

Use a permission-group-specific modal shell, categorize real product modules,
map legacy backend keys to current UI terms, and preserve all hidden keys through
the existing fallback serializer. Resetting uses the complete role template as
the serializer fallback and leaves personal overrides untouched. This is the
selected approach because it completes the UI contract without changing the
authorization model.

### 3. Backend permission-key migration

Replace legacy keys with new canonical keys and migrate every group, user
override, policy, route, and audit consumer. This is broader than Issue #293 and
creates unnecessary authorization risk. It is rejected.

## Permission Model And Compatibility

`PERMISSION_DEFINITIONS` remains the canonical backend key set. Existing keys
such as `view_development`, `view_pool`, and `manage_customer_recycle` are not
deleted because routes and historical groups still depend on them.

The editor owns a presentation map:

- `view_development` and `view_pool` stay hidden aliases and round-trip through
  the fallback permission map.
- `manage_customer_recycle` remains persisted but is displayed using current
  product wording tied to `不对口记录`; the words `客户回收站` are not rendered.
- `manage_manual_customer_deletion` uses current action wording rather than an
  obsolete navigation name.
- Module-like keys for `用户与权限`, `跟进更正`, `客户保护与查重`, and `数据维护`
  move into the module category. They are not duplicated in another category.
- The `团队状态` navigation route uses `view_team`, matching its server APIs,
  instead of the broader `view_customers` permission.

All category counts are calculated from definitions that are actually visible
after AI feature gating. They must not use raw category-array lengths.

Saving a normal edit starts with the existing group's full permission map and
overlays visible switch values. This preserves hidden keys. After a confirmed
reset, saving starts with the full role template and overlays any switches the
administrator changed after reset. This restores hidden keys to role defaults
without adding a backend endpoint.

## Editor Layout

`openPermissionGroupModal()` passes a dedicated `permission-group-modal` class.
On viewports at least 1100px wide:

- The modal width is `min(1320px, calc(100vw - 48px))`.
- The shell uses grid rows for header and body and clips shell overflow.
- The form uses rows for compact metadata, guidance, category content, reset
  confirmation, and fixed actions.
- Name and role share one row; description remains full width.
- The category tabs remain horizontal.
- The active category uses three columns with compact, stable card heights.
- The category panel does not scroll internally.
- The footer stays visible and contains reset on the left and cancel/save on the
  right.

At narrower widths, the grid drops to two and then one column. Vertical scrolling
is allowed only for the modal body on narrow screens or unusually short
viewports. Text must wrap inside cards, and controls must remain reachable.

Each active panel ends with a responsive status:

- Desktop: `本分类共 N 项，已完整显示，无需滚动`
- Narrow screens: `本分类共 N 项，全部权限均在当前分类中`

## Reset Interaction

The reset button is available only when editing an existing group. Selecting it
reveals an inline confirmation region inside the current modal so unsaved name,
description, and switch changes are not destroyed.

The confirmation copy states that:

- only the current permission group's permission switches are reset;
- personal exceptions, other groups, name, role, and description are unchanged;
- the reset takes effect only after `保存权限组` is selected.

Confirming the inline prompt updates all rendered switches to the current
group's role template, marks the form to serialize hidden keys from that role
template, hides the prompt, and returns focus to the reset control or first
changed switch. Cancelling the prompt makes no changes. Saving continues through
the existing permission-group PATCH route and existing last-admin protection.

## Descriptions And Accessibility

Every rendered card contains a permission name and a short description. Existing
server-provided descriptions take precedence. Missing descriptions use concise
category-aware fallback copy (`允许进入…` for module access and `允许执行…` for
actions), so no card renders without explanatory text.

Tabs use roving `tabindex`, `aria-controls`, labelled `role="tabpanel"` panels,
and Left/Right/Home/End keyboard navigation. Switches retain their accessible
names. The inline reset confirmation uses a status/alert region, and all actions
remain keyboard reachable within the existing focus trap.

## Error Handling And Security

- Reset does not write data until the ordinary save succeeds.
- API errors keep the editor open and use the existing toast path.
- The backend continues validating complete boolean maps and enforcing the last
  valid administrator rule.
- No front-end label grants access; every API remains server-authorized.
- Existing personal overrides remain stored and effective after group reset.
- This release does not add a new permission-group audit event. It preserves the
  existing write and audit contract; adding a new audited mutation protocol is a
  separate backend governance change outside the confirmed Issue #293 scope.

## Testing

Automated tests cover:

- the dedicated wide class, desktop no-scroll rules, responsive fallback, fixed
  footer, compact metadata, and three-column cards;
- exact current module labels and absence of `客户回收站`, `客户开发工作台`, and
  duplicate `线索池` entries;
- one description and one switch for every rendered permission;
- rendered category counts based on visible definitions;
- reset confirmation copy and reset-state serialization;
- preservation of hidden legacy keys during normal save;
- restoration of hidden legacy keys from role defaults after reset;
- unchanged personal override records and existing 403 authorization behavior;
- regression coverage for the personal-permission modal.

Browser acceptance uses an administrator session at 1668x1000, 1280x800, and
390x844. It checks category switching, no desktop panel scrollbar, stable footer,
legacy-label absence, reset cancellation, reset plus save and refresh, and narrow
screen reachability. The tested group is restored to its original permission map
after mutation verification.

## Release

The change receives a new frontend asset cache token. Before merge, run the
focused permission suites, full `npm test`, syntax checks, and browser acceptance.
After merge, use the repository deployment script and verify local and public
release gates against the exact merged SHA.

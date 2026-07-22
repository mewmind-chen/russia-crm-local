# Customer Profile Page And Automatic Customer Code Design

## Goal

Keep the CRM navigation focused on the daily customer lifecycle while restoring access to the original detailed customer profile panel. Fix manual CRM customer creation so the system generates a valid customer code without asking the user to enter one.

## Customer Profile Page

The CRM shell will contain a non-sidebar `customerProfile` view. Clicking `查看完整客户资料` from a CRM customer drawer closes the drawer, records the current CRM view as the return target, and opens this view.

The profile view hosts the existing `/development-workbench` page in a dedicated profile-only mode:

```text
/development-workbench?embedded=1&profile=1&customer=<external_customer_id>
```

Profile-only mode reuses the original workbench customer lookup, detail rendering, tags, Recon information, editing behavior, and customer-scoped AI. It hides the workbench sidebar, top-level navigation, dashboard and customer lists, and presents only the selected customer's existing detail panel as a full-page profile.

The CRM shell supplies a visible back action. Back returns to the previous lifecycle view, such as CRM customer panorama or pipeline, without adding `客户开发工作台` or `客户资料` to the primary sidebar.

If the customer cannot be found, the profile page shows a clear error and the back action remains available. Profile access continues to use the current authenticated session and existing permissions.

## Automatic Customer Code

Manual CRM customer creation will not contain a customer-code input. The server generates the external customer code inside the same database transaction that creates the customer master and CRM account.

The generated code uses the existing canonical format:

```text
<country prefix>-<four-digit global sequence>
```

Examples are `RU-0937`, `DE-0938`, and `BR-0939`. The country prefix comes from the submitted country using the existing normalization helper. The numeric portion is globally unique across all country prefixes and follows the existing customer ID allocator and database triggers.

The create-account response includes both the internal CRM account ID and the generated external customer code. Existing flows that explicitly attach a known customer master by `externalCustomerId` remain supported.

## Data Flow

1. A user clicks `查看完整客户资料` for a CRM account.
2. The CRM shell reads the account's `external_customer_id` and loads the profile-only workbench URL.
3. The workbench loads its existing customer data and opens the matching original detail panel.
4. The user views or edits the existing detailed profile and tags, then returns to the previous CRM view.
5. For a new manually created CRM customer, the server validates the company and owner, allocates the canonical external ID, inserts the customer master, inserts the CRM account, and returns both IDs.

## Testing

Automated tests will verify:

- `查看完整客户资料` no longer switches to the hidden lead pool.
- A non-sidebar customer profile view exists and passes the external customer ID to profile-only mode.
- The original workbench recognizes profile-only mode and opens the requested customer.
- Back navigation restores the previous CRM view.
- Creating a CRM customer without `externalCustomerId` succeeds and stores a canonical country-prefixed ID.
- Generated numeric portions remain globally unique.
- Attaching an existing customer master still works.

Browser verification will cover the CRM drawer-to-profile flow, original details and tags, return navigation, manual customer creation, generated code display in the resulting customer record, and desktop/mobile layouts.

## Scope Boundaries

- Do not restore `客户开发工作台` as a primary menu item.
- Do not duplicate the customer profile fields or tag implementation in the CRM shell.
- Do not expose unclaimed customer data beyond existing permissions.
- Do not change Issue 3 account, permission-group, override, password-reset, or identity-inspection behavior.

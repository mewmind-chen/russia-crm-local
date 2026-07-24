# CRM permission matrix

后端策略是最终授权边界。页面隐藏入口只用于减少误操作；每个登录请求都会重新读取用户和权限，未知 Legacy route/action 默认返回 403。`view_all_customers=false` 时，不论角色，只能访问本人名下且未退回的 `crm_accounts` 及其 external customer ID。未分配客户仅对同时具备 `view_all_customers + manage_intake` 的账号可见。对 ID 资源，受限范围内的“不存在”和“越权”统一返回 403；拥有完整管理范围的已认证用户查询真实不存在资源时返回 404。

## Read permissions

| Permission | Page/module | HTTP route or collection | Data scope | Primary regression test |
|---|---|---|---|---|
| `view_dashboard` | 经营驾驶舱 | Sales bootstrap summary/funnel | allowed CRM accounts | Sales bootstrap and research do not use view_development |
| `view_intake` | 未开发线索分配 | bootstrap intake; `GET /api/delivery/*` | own items unless `manage_intake` | complete legacy deny matrix |
| `view_customers` | CRM 客户全景 | bootstrap accounts/activities/RFQ/quotes/orders | allowed account IDs | Sales account writes obey view_all_customers |
| `view_development` | Legacy 客户开发工作台 | `GET /development-workbench`; `GET /api/initial` | only collections separately permitted below | permission changes affect existing session |
| `view_pool` | 未开发线索池 | `GET /api/customers`; `GET /api/sales-crm/research/pool` | allowed external customer IDs | complete legacy deny matrix |
| `view_contacts` | 负责人线索 | people/contact state; Sales people; Recon result/report details; contact fields in bootstrap/AI | allowed IDs; false 时移除联系人字段、报告/证据链接及可能嵌入联系人的自由叙述，并禁止 AI 直接抓取 URL | Wu Wei cannot receive contact data; Sales bootstrap cross-permissions; assistant scope suite |
| `view_recon` | Recon 情报 | result/report/monitor; Sales recon; AI report/vector context | allowed external customer IDs; report details also require `view_contacts` | assistant never retrieves Recon rows |
| `view_pipeline` | 推进管道 | bootstrap account funnel collections | allowed account IDs | Sales bootstrap collection cropping |
| `view_alerts` | 异常与介入 | bootstrap alerts | allowed account IDs | bootstrap permission cropping |
| `view_insights` | 经理评价 | bootstrap evaluations/insights | allowed account IDs | bootstrap permission cropping |
| `view_team` | 销售能力 | bootstrap team report | approved team aggregate | bootstrap permission cropping |
| `view_markets` | 市场策略 | bootstrap market report | approved aggregate | bootstrap permission cropping |
| `view_users` | 用户与权限 | bootstrap users; user management routes | safe user fields | Sales user management requires both permissions |
| `view_all_customers` | 团队全盘 | all account-backed reads; `GET /api/quality/issues` | all accounts when true, owner rows when false | scoped manager cannot list/read/mutate another owner |

## Write and capability permissions

| Permission | HTTP route/action | Additional requirement and scope | Primary regression test |
|---|---|---|---|
| `manage_intake` | intake scan/settings/assign/reassign/bulk; team intake state | also `view_intake`; self claim/return/reject requires item ownership | manager without manage_intake cannot claim another item |
| `create_customer` | `POST /api/sales-crm/accounts` | explicit permission | Sales write policy coverage |
| `edit_customer` | account patch; Legacy update/tag; contacts | target must be in account scope; contacts also require `view_contacts` | scoped manager cannot mutate another owner |
| `record_activity` | `POST /api/sales-crm/activities` | allowed account ID | Sales write policy coverage |
| `record_quote` | `POST /api/sales-crm/quotes` | allowed account ID | Sales write policy coverage |
| `record_order` | `POST /api/sales-crm/orders` | allowed account ID | Sales write policy coverage |
| `manage_evaluations` | create/retry manager evaluation | allowed account ID | explicit permissions are authoritative |
| `run_recon` | Legacy create/retry Recon/contact Recon | target scope; also matching `view_recon` or `view_contacts` | scoped manager cannot start jobs for another owner |
| `use_prospect_agent` | Legacy prospect create/rerun/promote | tasks are isolated by creator; public search can run without CRM read access; local pool/Recon retrieval additionally obeys module permission, row scope, and contact permission; promote needs `edit_customer`; any reused customer ID/domain match must already be in caller scope; `createRecon=true` also needs `run_recon+view_recon` | scoped users cannot read or rerun another creator's task; scoped promotion cannot target another owner |
| `use_ai_assistant` | `POST /api/assistant/chat` | SQL, deterministic, report, source and matched-customer results are query-scoped; contact-bearing narrative columns, vector retrieval, web search, and direct URL fetch are disabled when `view_contacts=false` | assistant scope suite |
| `manage_users` | create/patch users; migration review | also `view_users` | Sales user management requires both permissions |
| `manage_data_maintenance` | data-maintenance capabilities/runs/preview/execute | real administrator only; blocked during identity inspection; execute requires a fresh preview, confirmation text and successful backup | data maintenance suite |
| `export_data` | `GET /api/sales-crm/export` | also `view_customers`; JSON only contains visible customer rows; contact collections require `view_contacts`; no authentication fields | access governance export suite |

`POST /api/sales-crm/accounts/bulk-assign` requires `view_customers + edit_customer + view_all_customers + manage_intake`, accepts at most 500 explicitly selected visible customer IDs, validates the complete batch and active target salesperson before one atomic update, and writes the normal sanitized route audit. Empty `ownerId` moves the batch to unassigned status.

User offboarding uses archive/restore routes. Archive sets the account inactive, revokes all sessions, removes it from assignment choices, and preserves historical references. Permanent deletion is allowed only after archive and only when no customer, activity, RFQ, quote, order, contact, evaluation, or intake reference remains.

## Explicit route/action policies

- Legacy read routes: `/api/session/capabilities`, `/api/initial`, `/api/customers`, `/api/customers/:customerId/people`, `/api/contact-recon/state`, `/api/recon/results/:jobId`, `/api/report`, `/api/recon-monitor`, `/api/quality/issues`, `/api/delivery/latest`, `/api/delivery/file`, `/api/assistant/chat`.
- Legacy `/api/app` actions: `updateCustomer`, `createTag`, `setCustomerTags`, `createReconJob`, `retryReconJob`, `createContactReconJob`.
- Legacy `/api/prospect-agent` actions: `createTask`, `rerunTask`, `promoteCandidate`.
- Sales routes: bootstrap; research pool/people/recon; account create/patch/bulk assignment; scoped export; activities; quotes; orders; user create/patch/archive/restore/delete; migration review; password; intake scan/action/settings; contacts; evaluation create/retry; data-maintenance capabilities/runs/preview/execute. The centralized Sales policy is enforced before handlers, unknown routes are default-denied, and denied writes are recorded with an anonymous route/permission audit event.
- `POST /api/recon` and `POST /api/contact-recon` are not browser-session routes: they require the independent `RECON_WORKER_TOKEN` boundary.
- `/share/report/*` and `/share/contact-report/*` are not browser-session routes: they require constant-time comparison against the independent share token and only serve validated report paths.
- Login/logout and password change are authentication/self-service boundaries. Unknown browser routes and actions are default-denied.

`GET /api/initial` is read-only: preset tags are seeded during schema initialization, and automatic tag refresh remains an explicit maintenance action. Legacy `prospect_tasks` with blank ownership are assigned only to a configured active user or the first active administrator during schema migration; when neither exists, they stay inaccessible instead of becoming globally visible.

Role checks that remain in `lib/sales_crm.js` are business defaults only: selecting active salespeople for automatic assignment, team-report membership, and choosing the default owner/manager attribution. They do not expand or deny an explicitly granted data permission.

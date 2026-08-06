# Issue #264 设计规格:线索池只展示可处理线索,已进入 CRM 客户移至独立入口

- **仓库**:`mewmind-chen/russia-crm-local`
- **实施基准**:`main` = `e53199ed160beddda0432277e31371ae74588a50`
- **日期**:2026-08-06
- **状态**:已确认(用户逐项批准)

## 1. 背景与目标

当前"线索池"同一列表混合展示两类数据:

- 已领取并已进入 CRM 的客户(`claimed` 且带 `crm_customer_id`):不可再分配,无勾选框,提示"状态不可分配"。
- 仍可处理的线索(`pending/approved/assigned/returned`):有勾选框。

用户看到同一张列表,会认为功能不一致。已进入 CRM 的客户不属于当前待处理线索,不应占用线索池列表。

**目标**:线索池默认列表只展示当前账号有权处理的可处理线索;已进入 CRM 的客户移到独立可点击入口;勾选、批量操作、数量口径全部统一为"可处理线索"语义。

## 2. 已确认决策

1. **新增独立「已进入 CRM」统计卡片**(所有角色可见),点击跳转 CRM 客户全景并自动应用 `intake_flow=claimed` 筛选;权限仍由后端客户数据范围检查。
2. **列表排除边界**:线索池列表只保留 `pending/approved/assigned(含领取超期)/returned`;排除 `claimed`、`rejected`、`duplicate`。
3. **状态 Tab 调整**:只保留 全部 / 待分配 / 已分配待领取(含领取超期) / 已退回;移除「已领取」「不对口」两个 Tab。
4. **侧栏数量口径分视角**:管理者 = 权限范围内可处理线索总数(`unassigned+assigned+returned`);销售 = 自己的待领取数(`assigned`,与销售列表一致)。
5. **每行都有勾选框 + 表头全选框**(仅选当前页、当前筛选结果中可处理线索,支持半选);批量操作只作用于勾选行。
6. **并发过期操作**:后端必须拒绝过期操作,前端明确提示并刷新该行,不静默失败。
7. **数字口径统一**:领取、退回、重新分配完成后,侧栏数字、顶部卡片、列表结果按同一口径立即刷新。

## 3. 现状事实(实施前核对)

| 项 | 位置 |
|---|---|
| 列表加载 | `GET /lists/intake` → `loadAuthorizedBusinessPage()`(`lib/sales_crm.js:2511-2585`)→ `queryIntakeFlowPage()`(`lib/intake_flow_filters.js:424-461`) |
| 状态枚举 | `BUSINESS_STATUSES = pending, approved, assigned, claimed, returned, rejected, duplicate`(`lib/intake_flow_filters.js:5-7`) |
| 行渲染 | `renderIntake()`(`sales-assets/app.js:2419-2551`),勾选框条件 `intakeItemAssignable()`(`:1963-1968`),"状态不可分配"提示来自后端 `assignmentBlockReason`(`:2506-2513`) |
| 统计卡片 | `intakeStatCards()`(`sales-assets/app.js:2287-2306`),点击跳 CRM 走 `jumpIntakeStatToCrm()`(`:2412-2417`)+ `pendingCustomerIntakeFlow`(`:1003-1011`) |
| 侧栏计数 | `navIntakeCount` 固定取 `stats.assigned`(`sales-assets/app.js:1544`) |
| 后端二次校验 | `manageIntake()`(`lib/sales_crm.js:4865-5203`),权限点 `view_intake`/`manage_intake`(`lib/access_control.js:3,16`) |
| 领取超期 | `UNCLAIMED` alert:`assignment_status==='assigned' && claim_due_at < now`(`lib/sales_crm.js:2918`);统计卡 overdue(`intakeStatDraft` `app.js:2348`) |
| 测试基建 | `test/helpers/permission_fixture.js`(内存 SQLite + 真实 HTTP server,`adminFixture` 种子数据) |

## 4. 数据 / API 契约

### 4.1 列表接口 `GET /lists/intake`

**行为变化**:默认与"全部"过滤只返回可处理状态 `pending/approved/assigned/returned`(领取超期是 `assigned` 的子集,不单独成状态)。

实现位置建议:
- `queryIntakeFlowPage()`(`lib/intake_flow_filters.js:424-461`)的默认状态范围,或
- `renderIntake`/列表请求的默认 filter 侧。

**约束**:
- 后端过滤是权威;前端隐藏只是体验层。
- 每行继续返回 `assignable` 与 `assignmentBlockReason`(既有字段,保持前端契约稳定)。
- 统计 `stats` 与列表必须同口径。

### 4.2 统计

- 新增「已进入 CRM」统计口径:已领取并已进入 CRM 的客户数(现有 `stats.claimed` 口径,即 `crm_customer_id` 非空的 claimed 线索数)。
- 「线索池」统计(管理者):`unassigned + assigned + returned`;销售:`assigned`。
- 现有 claimed 卡:管理者视角移除(避免与独立卡重复);销售视角保留「已领取」卡。

### 4.3 跳转契约

「已进入 CRM」卡片点击 → 切换到 CRM 客户全景视图(`customers`)并应用 `intake_flow=claimed` 筛选,复用现有 `jumpIntakeStatToCrm()` 与 `pendingCustomerIntakeFlow` 机制;跳转后的客户结果继续执行后端客户数据范围检查。

## 5. 前端改动(仅 `sales-assets/app.js` + `sales-crm.html` 必要时)

1. `intakeStatCards()`:新增「已进入 CRM」卡片(全角色);管理者移除 claimed 卡;销售保留「已领取」。
2. `renderIntake()`:状态 Tab 集合去掉 claimed/rejected;列表默认只展示可处理状态。
3. 表头全选框:当前页全选,支持半选状态;`intakeItemAssignable` 保证列表内每行都可勾选。
4. 侧栏计数 `navIntakeCount`:按角色取口径(管理者可处理总数 / 销售 assigned)。
5. 操作成功后的刷新路径沿用 `refresh()`(`app.js:9272-9304`),确保侧栏/卡片/列表同口径。

## 6. 后端改动

- 列表默认范围:在 `queryIntakeFlowPage()` 或列表查询层把默认状态集合收敛为 `pending/approved/assigned/returned`(claimed/rejected/duplicate 不再默认返回;显式筛选这些状态时返回空或按新语义处理,以"不返回不可处理行"为准)。
- 统计口径:确保 `stats` 与列表同口径(管理者可处理总数;销售 assigned)。
- **不新增 API**;`manageIntake()` 的权限与数据范围二次校验原样保留。

## 7. 权限与数据安全

- 不扩大任何账号的数据范围;销售只看到明确分配给自己的线索及现有权限允许的数据。
- 「已进入 CRM」入口仅对拥有 CRM 模块权限(`view_customers`)的账号可见、可用;跳转后的客户结果继续执行 `accountScope` 数据范围检查。
- 无权限接口统一 `403`,语义不变。
- 不允许通过统计数量、跳转参数、客户编号或接口绕过权限。

## 8. 测试计划

### 8.1 新增专项测试

1. **默认列表范围**:管理员/主管/销售进入线索池,默认列表不包含 claimed/rejected/duplicate 行。
2. **可处理行一致性**:列表内每行都有勾选框;`assignable=true`。
3. **已退回线索**:仍可勾选、重新分配;不得因本次调整丢失。
4. **已分配未领取**:仍可按现有规则重新分配/取消分配(含领取超期)。
5. **「已进入 CRM」卡片**:数量正确;点击后进入 CRM 客户全景并应用 `intake_flow=claimed` 筛选;无 CRM 权限时不可见/不可绕过。
6. **口径一致**:领取、退回、重新分配后,侧栏数量、顶部卡片、列表总数一致,无需整页刷新。
7. **表头全选/半选**:仅选中当前页、当前筛选结果中可处理线索。
8. **状态 Tab**:全部/待分配/已分配待领取/已退回 存在;已领取/不对口 移除。

### 8.2 回归(必须保持绿)

- `test/issue212_lead_pool_backend.test.js` / `issue212_lead_pool_frontend.test.js`
- `test/issue228_my_leads.test.js`
- `test/issue257_returned_lead_assignment.test.js`
- `test/issue141_manual_intake_assignment.test.js`
- `test/issue96_intake_crm_invariant.test.js`
- `test/issue103_backend.test.js`
- `test/issue157_today_task_actions.test.js`
- `test/issue107_lead_pool_filter_options.test.js`
- `test/issue207_impersonation_bulk_actions.test.js`

> 注意:`issue212_lead_pool_frontend.test.js` 断言了 9 个 manager 统计卡与 `jumpIntakeStatToCrm` —— 新增/移除卡片会使该测试的静态断言失效,需同步更新该测试(属本次改动的一部分,不算回归破坏)。

## 9. 验收标准(对齐 issue #264)

- [ ] 管理员、主管和销售进入线索池,默认列表不再出现"已领取·已进入 CRM"且"状态不可分配"的客户。
- [ ] 线索池中所有展示行均可按其当前状态执行真实操作,并具有一致的勾选逻辑。
- [ ] 已退回线索仍可被勾选、重新分配,不得丢失。
- [ ] 已分配但未领取的线索仍可按现有规则重新分配或取消分配。
- [ ] 点击"已进入 CRM"卡片后,进入 CRM 客户全景并看到对应结果;无 CRM 权限时不能看到或绕过入口。
- [ ] 完成领取后,该线索从线索池消失,并计入"已进入 CRM";退回后重新进入线索池可处理列表。
- [ ] 侧栏、统计卡片、结果总数在领取、退回、重新分配后保持一致,无需刷新整个页面才能纠正。

## 10. 不改的东西

- 不删除、不迁移任何客户数据(`crm_accounts`/`crm_intake_items` 不动)。
- 不新建第二套处理逻辑;退回/领取/分配全部沿用现有真实业务。
- 不动回收站、批量退回(CRM 侧)、数据维护面板。
- 不新增 API;不新增权限点。
- 客户编号、创建信息、负责人历史、领取记录、经营历史完整保留。

## 11. 实施顺序(写计划时细化)

1. 后端列表默认范围 + 统计口径(+ 相应后端测试)
2. 前端统计卡片/状态 Tab/列表范围/表头全选/侧栏计数
3. 前端测试(静态断言 + 交互契约)
4. 更新 `issue212_lead_pool_frontend.test.js` 受影响的断言
5. 全量回归 + CI
6. Draft PR(`codex/issue-264-lead-pool-clean-scope` → `main`)

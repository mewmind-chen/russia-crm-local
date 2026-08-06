# Issue #265 设计规格:CRM 客户全景「状态/操作」分列与操作闭环

- **仓库**:`mewmind-chen/russia-crm-local`
- **实施基准**:`main` = `9af8a46d4b753d672e7d6b40bf36ee5f6c3e084c`(PR #266 合并后,即当前生产版本)
- **日期**:2026-08-06
- **状态**:已确认(用户逐项批准)

## 1. 背景与目标

CRM 客户全景当前把「客户状态」和「退回线索池、标记不对口、删除到回收站」等操作挤在同一列。客户存在异常时,同一单元格同时出现较长的红色提示和多个操作入口,造成文字拥挤、阅读混乱,也容易把状态误认为按钮。

**目标**:按已确认方案拆分为独立的「状态」列与「操作」列;状态列只显示一个简短、清楚的主要状态;多异常详情在客户详情侧栏查看;操作闭环(真实更新、同步刷新、审计、失败说明)保持不变。

## 2. 已确认决策

1. **拆列**:客户全景表格最后区域拆成两个独立列 `状态`、`操作`。
2. **主状态规则**(4 类映射 + 其余用短 title):
   - 无异常 → `正常推进`(绿色)。
   - 最高优先级异常(code 来自 `groupAlerts` 排序后的第一条 reason):
     - `UNCLAIMED` → `领取超期`
     - `OVERDUE` → `跟进超期`
     - `MANAGER_NEEDED` → `需要管理者介入`
     - 其余异常码(`INTAKE_IDLE`/`NO_NEXT`/`NO_NEXT_DEFERRED`/`REPLY_IDLE`/`MEETING_NO_RFQ`/`RFQ_UNQUOTED`/`QUOTE_IDLE`/`STALE`/`POST_MANAGER_IDLE`/`NO_PLAN_STREAK`)→ 显示该 reason 的短 `title`(如「缺少下一步计划」)。
   - 多异常时列表只显示主状态(一条),不堆叠;完整原因在抽屉查看。
3. **颜色**:severity `critical` → 红;`today`/`warning` → 琥珀;正常推进 → 绿。
4. **操作列范围**:`退回线索池` + `标记不对口` + `删除到回收站`(保留全部 3 个;`canTrash` 仅真实管理员 + CRM 手工新增 + 非 intake 客户,现有权限条件不变)。操作列沿用 `assignment-actions` 容器,电脑端不折叠进「更多」。
5. **抽屉异常区**:保留现有 alert 卡(title/detail/操作 pill),下方追加「异常明细」列表——逐条显示每个异常的标题、原因、时间(dueAt/超时时长)与建议操作;无异常不显示。
6. **移动端**:沿用现有横向滚动布局(`.data-table{overflow:auto}` + `table{min-width:850px}`),操作列在表内不丢失;`assignment-actions` 保持 `flex-wrap` 不溢出。

## 3. 现状事实(实施前核对)

| 项 | 位置 |
|---|---|
| 列定义/行渲染 | `renderCustomers()`(`sales-assets/app.js:3632-3723`),表头 `:3688`,状态列 `:3709` = `alert pill + lifecycleActions` 同一单元格 |
| alert 来源 | `alertFor(customerId)` = `state.data.alerts.find(...)`(`app.js:1517-1519`);`alertHasCode(alert, code)` 检查 `reasons[].code`(`:1506-1511`) |
| alert 结构 | `groupAlerts()`(`lib/sales_crm.js:3012-3109`)输出:`title/detail/action`(primary)、`severity('critical'|'today'|'warning')`、`urgencyLabel`、`reasons[]`(code/title/detail/action/actionKind/allowedActions/dueAt/overdueHours/…)、`otherReasons[]`、`reasonCount`、`maxOverdueHours` |
| 异常码表 | `buildAlerts()`(`lib/sales_crm.js:2800-2968`):UNCLAIMED/INTAKE_IDLE/NO_NEXT/NO_NEXT_DEFERRED/OVERDUE/REPLY_IDLE/MEETING_NO_RFQ/MANAGER_NEEDED/RFQ_UNQUOTED/QUOTE_IDLE/STALE/POST_MANAGER_IDLE/NO_PLAN_STREAK |
| 操作权限 | `canReturnCustomer`/`canRejectCustomer`(`app.js:3593-3605`,需 `manage_customer_recycle` + 生命周期约束);`canTrash` 内联 `:3693-3694` |
| 抽屉 | `renderDrawer()`(`app.js:8006` 附近):alert 卡 = `hasMeaningfulAlertCopy(alert)` 时显示 title/detail/action pill,无 reasons 明细/时间 |
| 行点击 | `app.js:10195` `event.target.closest('[data-open-customer],[data-customer]')` → `openCustomer()`(点击行/状态打开抽屉,已具备) |
| 操作闭环 | 前端 `openRecycleReasonModal`(`:9201-9216`)→ 提交(`:9962-9980`)→ 后端 `returnCustomer`/`rejectCrmCustomer`(`lib/sales_crm.js:9369/9401`,二次权限 403 + 审计 `recordRecycleAudit`)→ 前端 `refresh()`(`:9272-9304`)全量刷新 |
| 移动端 | `app.css:66-67` `.data-table{overflow:auto}`、`table{min-width:850px}`(横向滚动);`:84` `.assignment-actions{display:flex;gap:6px;flex-wrap:wrap}` |
| 前端测试约束 | `test/issue210_customer_list_frontend.test.js` 断言 `renderCustomers` 的勾选框/选择逻辑(无状态列内容断言);`issue241`/`issue257` 断言 `data-reject-customer`/`canRejectCustomer`/`data-return-customer` 存在(`app.js` 层面) |

## 4. 改动点

### 4.1 前端 `sales-assets/app.js`(纯前端,后端零改动)

1. **`renderCustomers()` 拆列**(`:3688-3709`):
   - 表头:`'优先级', '状态', '操作'`。
   - 状态单元格:主状态文案 + 颜色(见决策 2/3),**不再包含操作按钮**。
   - 操作单元格:`lifecycleActions`(退回/标记不对口/删除到回收站)移入,`assignment-actions` 容器。
   - 新增辅助函数(如 `customerPrimaryStatus(alert)`)返回 `{ label, className }`;映射逻辑集中一处,便于测试。
2. **`renderDrawer()` 抽屉异常明细**(`:8006` 附近):alert 卡保留;`reasons.length > 1` 时追加「异常明细」列表(每条:title/detail、`dueAt` 时间、`overdueHours` 超时、action 建议操作);单异常时明细列表可省略(alert 卡已含)。

### 4.2 后端

- **零改动**。alert 数据(`reasons[]`/`dueAt`/`overdueHours`)已由 `groupAlerts` 下发完整。

### 4.3 样式(`sales-assets/app.css` 必要时)

- 主状态 pill 样式可复用现有 `.pill`;绿色状态可用现有 `.good-text` 或新增 `.pill.good`;「异常明细」列表样式(标题/时间/操作行)。

## 5. 权限与数据安全

- 不新增权限点;`canReturnCustomer`/`canRejectCustomer`/`canTrash` 条件原样保留。
- 后端 `returnCustomer`/`rejectCrmCustomer`/trash 的二次权限校验、数据范围(`accountForReturn` own/previous_owner)、403 语义、审计记录全部不变。
- 前端隐藏按钮只是体验层;直接调用接口仍由后端拒绝。

## 6. 测试计划

### 6.1 新增专项测试 `test/issue265_customer_status_actions.test.js`(前端静态断言,沿用 `functionBlock` 模式)

1. 表头含 `'状态'` 与 `'操作'` 两列。
2. 状态列不再包含操作按钮:`renderCustomers` 状态单元格不含 `data-return-customer`/`data-reject-customer`/`data-trash-customer`;操作单元格含。
3. 主状态映射函数:`customerPrimaryStatus(alert)`:
   - 无 alert → `正常推进`;
   - `reasons[0].code === 'UNCLAIMED'` → `领取超期`;
   - `'OVERDUE'` → `跟进超期`;
   - `'MANAGER_NEEDED'` → `需要管理者介入`;
   - 其他 code → 使用该 reason 的 `title`;
   - 多异常 → 只取最高优先级一条(主状态)。
4. 颜色:critical → red;today/warning → amber;正常 → green/good。
5. 抽屉:保留 `hasMeaningfulAlertCopy(alert)` 卡;`reasons` 明细列表在 `renderDrawer` 中存在(含 `dueAt`/`overdueHours` 渲染)。
6. 操作列保留 3 个操作:`data-return-customer`/`data-reject-customer`/`data-trash-customer`(trash 权限条件不变)。

### 6.2 回归(必须保持绿)

- `test/issue210_customer_list_frontend.test.js`(勾选框/选择逻辑)
- `test/issue241_return_mismatch.test.js`、`test/issue257_returned_lead_assignment.test.js`、`test/issue257_drawer_alert_history.test.js`(操作入口/抽屉 alert 断言)
- `test/issue209_recycle_chinese.test.js`、`test/issue130_profile_access_status.test.js`、`test/issue137_recycle_backend.test.js`、`test/customer_recycle_bin.test.js`(回收/权限后端)
- `test/issue112_tag_semantics.test.js`、`test/issue147_shared_nickname_ui.test.js`(renderCustomers 相关静态断言)
- `test/issue157_today_task_actions.test.js`、`test/issue225_today_filter_chinese.test.js`(alert 动作授权)

## 7. 验收标准(对齐 issue #265)

- [ ] CRM 客户全景表头明确分为「状态」和「操作」。
- [ ] 普通电脑宽度下,状态文字和操作按钮不挤压、重叠或换成难以阅读的竖排。
- [ ] 状态列不再堆叠「异常原因 + 退回线索池 + 标记不对口」。
- [ ] 客户有多个异常时,列表只显示主要状态,详情侧栏能看到全部原因。
- [ ] 退回线索池成功后,客户归属、CRM 列表、线索池、待办和数量同步刷新。
- [ ] 标记不对口成功后,状态、详情和相关待办同步刷新。
- [ ] 无权限账号看不到操作入口,直接调用接口返回 `403`。
- [ ] 管理员、主管、销售以及身份检查模式分别走通一次完整操作流程。
- [ ] 桌面端和手机端均无横向错位;手机端允许按现有移动布局重排,但不能丢失真实操作。
- [ ] 对正常推进、单一异常、多个异常三种客户状态进行回归测试。

## 8. 不改的东西

- 后端 API、权限点、操作业务逻辑(`returnCustomer`/`rejectCrmCustomer`/trash)、审计、回收站、数据维护均不动。
- 不新建第二套处理逻辑;操作闭环沿用现有真实业务。
- 不迁移/删除客户数据。

## 9. 实施顺序(写计划时细化)

1. `renderCustomers` 拆列 + 主状态映射辅助函数(+ 前端测试)
2. `renderDrawer` 异常明细(+ 前端测试)
3. CSS 微调(如需要)
4. 全量回归(重点 issue210/241/257)
5. 语法检查 + CI + Draft PR(`codex/issue-265-customer-status-actions` → `main`)

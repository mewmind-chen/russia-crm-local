# Issue #291：未闭环流程统一整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按预览和 issue 正文，把「进展记录与主管协助闭环」「权限配置面板」「线索核验/退回历史/昵称入口」三条业务链路做成真实可闭环、待办与统计同步刷新、越权直链全部被服务端拦截的完整整改。

**Architecture:** 服务端是 Node.js + Express + better-sqlite3 单体，业务集中在 `lib/sales_crm.js`（12735 行）与 `lib/manager_tasks.js`、`lib/access_control.js`、`lib/permission_groups.js`；前端是服务端渲染的 `sales-crm.html` + `sales-assets/app.js`（11760 行）。本次不新建子系统：在既有表结构和路由上补齐状态机（待介入 → 已回复 → 已完成）、把弹窗改成四模式、把权限面板改成分类开关，并给查重补第三条处置动作。所有写入走幂等键 + 审计日志，所有入口由服务端二次校验。

**Tech Stack:** Node.js（node:test + node:assert/strict）、Express 4、better-sqlite3、原生 HTML/CSS/JS（无构建步骤）、`npm test`（`scripts/run-core-tests.js`）。

## Global Constraints

- 基线：最新 `main` = `bc98c01`（PR #290）。开发分支：`fix/unresolved-workflows-regression`。
- 角色命名以当前系统真实角色为准（admin/manager/sales，界面为 系统管理员/销售经理/销售代表）；用户可见文案统一成当前菜单名称，内部权限 key 不得改名，不得破坏旧权限和旧数据。
- 「只更新下一步计划」不是客户进展事件：只允许更新下一步动作、下次跟进时间、备注和必要审计，不得在时间线生成“发送邮件、客户回复、已联系”等客户行为。
- 「暂无计划」必须是真实状态/事件，至少保存原因、记录人、时间和客户编号；统计要能识别这是“销售当前没有计划”。
- 主管协助闭环完成条件：主管已回复、销售已看到回执并保存新的下一步计划；销售未确认计划前，销售侧待办不得提前消失。
- 查重核验的销售端提示必须模糊：销售端不得展示候选数量、相似度、匹配字段、负责人、合作状态或历史。
- 退回线索历史查看是只读入口：不允许恢复、重新领取或改变负责人；恢复必须走现有独立流程。
- 昵称唯一校验按规范化值（NFKC、去首尾空格、合并空白、小写）执行；大小写、前后空格、全半角差异不能绕过。
- 已由最新 `main` 完整实现的项目不重复修改；PR 中列明对应提交或测试证据。
- 所有用户可见操作必须有服务端权限校验和审计记录；不得迁移、重建或覆盖稳定客户编号、线索编号、负责人历史和原始审计记录。
- 不得把 Alpha 询价、报价、订单、采购、价格、利润等交易明细引入 CRM；不新建独立系统、不新增自动同步接口。
- 验收必须覆盖销售、主管、管理员三类账号，并跑单元、接口、端到端关键流程与构建检查。

## File Structure

**Modify:**
- `lib/sales_crm.js` — 进展记录（四模式后端）、plan-only 幂等接口、主管回复/销售回执状态机、告警生成、查重 needs_info、线索池销售模糊提示、退回历史只读范围、昵称冲突文案。
- `lib/manager_tasks.js` — manager_assistance 任务的完成条件文案；任务查询保持不变。
- `lib/access_control.js` — 权限显示名对齐菜单、新增 `view_notifications` 权限。
- `lib/permission_groups.js` — `view_notifications` 权限组默认值迁移。
- `sales-crm.html` — 通知中心入口权限、昵称按钮文案「创建昵称」。
- `sales-assets/app.js` — 四模式进展弹窗、主管处理弹窗上下文、主管回执待办、权限三分类开关面板、恢复默认二次确认弹窗、查重第三动作、退回历史侧栏、昵称弹窗精简。
- `sales-assets/app.css` — 权限分类 tab、2-3 列开关网格、历史侧栏样式。

**Create:**
- `test/issue291_manager_assistance_loop.test.js`
- `test/issue291_plan_only.test.js`
- `test/issue291_progress_modal_ui.test.js`
- `test/issue291_permission_labels.test.js`
- `test/issue291_permission_modal_ui.test.js`
- `test/issue291_duplicate_needs_info.test.js`
- `test/issue291_sales_review_hint.test.js`
- `test/issue291_returned_history.test.js`
- `test/issue291_nickname_ui.test.js`

**Update（与既有断言冲突的旧测试，按新闭环口径改）:**
- `test/issue257_manager_assistance_task.test.js`
- `test/issue257_today_task_visibility.test.js`
- `test/issue148_binary_permissions.test.js`（个人权限完整布尔图新增 view_notifications）
- `test/issue229_permission_modal.test.js`（如发送完整权限图，补 view_notifications）

## 任务总览与提交粒度

- Phase 0：基线确认。
- Phase A（进展与主管闭环）：Task 1-7。
- Phase B（权限面板）：Task 8-11。
- Phase C（线索核验/退回历史/昵称）：Task 11-15。
- Phase D（收口）：Task 16-17。

建议提交粒度（每任务一提交，提交信息见各任务）：
- `fix: snapshot manager assistance request context`
- `fix: close manager assistance loop with sales receipt`
- `fix: align permission panel with CRM modules`
- `fix: complete lead review history and nickname flows`
- `test: cover unresolved workflow regression paths`

---

## Phase 0：基线确认

### Task 0: 基线确认与测试清单

**Files:**
- Create: 无
- Modify: 无

**Interfaces:**
- Consumes: `origin/main` = `bc98c01`
- Produces: 分支 `fix/unresolved-workflows-regression`，基线结论写入本计划

- [ ] **Step 1: 确认分支与 HEAD**

```bash
cd /Users/ylf/Desktop/projects/tradepulse-development/worktrees/issue-291-unresolved-workflows
git fetch origin
git status -sb
git log --oneline -1
```

Expected: `## fix/unresolved-workflows-regression...origin/main`，HEAD = `bc98c01 fix: refine customer drawer summary and timing (#290)`。

- [ ] **Step 2: 跑核心测试基线**

```bash
npm test
```

Expected: `# pass 1108`、`# fail 0`（约 50 秒）。

- [ ] **Step 3: 记录基线到本计划**

在下方勾选确认：基线 `bc98c01`、`npm test` 1108/1108、当前开放 PR 无、issue #291 仍 OPEN。

- [ ] **Step 4: 无需提交**（本任务只读）

### 已由最新 main 覆盖、只做验证/收口的事项（对应 issue 澄清第 8 条）

执行时先按下列证据核对，不要重复改同一逻辑；PR 中引用对应提交或测试：

- 个人权限恢复默认的后端闭环：`PUT /api/sales-crm/users/:id/permission-overrides` `{restoreDefault:true}` 已存在，测试 `test/issue229_permission_modal.test.js`（`empty overrides restore group defaults and audit clears`）。本次只改面板 UI 与二次确认。
- 昵称全公司规范化唯一（NFKC/trim/空白合并/小写）：`lib/customer_identity_registry.js` 的 `normalizeCustomerName` + `identityOwnersForName`，测试 `test/customer_nickname.test.js`、`test/issue147_shared_nickname_backend.test.js`。本次只改入口文案、弹窗内容和冲突提示。
- 时间线中文化与去重基础：`test/issue230_timeline_chinese.test.js` 已通过；本次只补「暂无计划 / 请求主管协助 / 主管回复」三个标题规则。
- 旧版查重遗留重算：`POST /api/sales-crm/duplicate-reviews/recalculate` 已存在，测试 `test/issue262_stale_duplicate_review_upgrade.test.js`。本次只加第三条处置动作。
- 主管协助任务持久化与上下文基础：`lib/manager_tasks.js` + `test/issue257_manager_assistance_task.test.js`。本次把「经理完成即关闭」改成「主管回复 → 销售回执确认」两步。

---

## Phase A：销售进展与主管协助闭环

### Task 1: 主管协助请求快照：原因必填 + 原计划/联系人/期限入 evidence

**Files:**
- Modify: `lib/sales_crm.js`（`addActivity`，约 7930-8030 行）
- Test: `test/issue291_manager_assistance_loop.test.js`

**Interfaces:**
- Consumes: `upsertManagerTask(value, input)`（`lib/manager_tasks.js:717`，`input.evidence` 为任意 JSON 对象）；`crm_account_contacts` 列 `name/title/department/match_status/archived_at`。
- Produces: 后续任务依赖 evidence 字段名：`requestReason`（申请原因）、`originalPlan`（销售原计划）、`contacts`（`[{name,title,department,matchStatus}]`）、`dueAt`（处理期限，`dateOffset(3)` 生成的 `YYYY-MM-DD HH:mm:ss`）。

- [ ] **Step 1: 写失败测试**

在 `test/issue291_manager_assistance_loop.test.js` 新建：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function progressPayload(overrides = {}) {
  return {
    customerId: 'CRM-OTHER',
    progressType: 'email',
    reactionOptionId: '',
    summary: '客户暂无回复，需要主管协助梳理联系人',
    occurredAt: '2026-08-13 13:50:00',
    managerRequired: true,
    nextAction: '希望主管协助查询联系人',
    nextActionAt: '2026-08-20 09:00:00',
    ...overrides,
  };
}

test('manager assistance requires a reason and snapshots original plan, contacts and deadline', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,title,department,phone,email,social,match_status,
     created_by,archived_at,created_at,updated_at)
    VALUES ('CT-1','CRM-OTHER','RU-9003','Ivan','Procurement','技术部','','','','mismatch',
      'U-OTHER','',?,?)`).run(
    '2026-08-10 08:00:00', '2026-08-10 08:00:00');

  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload(),
  });
  assert.equal(response.status, 200, await response.clone().text());

  const task = fx.db.prepare(
    "SELECT * FROM crm_manager_tasks WHERE reason='manager_assistance'",
  ).get();
  assert.ok(task);
  const evidence = JSON.parse(task.evidence_json);
  assert.equal(evidence.requestReason, '客户暂无回复，需要主管协助梳理联系人');
  assert.equal(evidence.originalPlan, '希望主管协助查询联系人');
  assert.deepEqual(evidence.contacts, [
    { name: 'Ivan', title: 'Procurement', department: '技术部', matchStatus: 'mismatch' },
  ]);
  assert.match(evidence.dueAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('manager assistance without a reason is rejected before any write', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload({ summary: '' }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, '请求主管协助必须填写申请原因');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) n FROM crm_manager_tasks WHERE reason='manager_assistance'").get().n,
    0,
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/issue291_manager_assistance_loop.test.js`

Expected: FAIL —— 第一条：evidence 里没有 `requestReason/originalPlan/contacts/dueAt`；第二条：空 summary 仍返回 200。

- [ ] **Step 3: 修改 `addActivity`**

在 `lib/sales_crm.js` 的 `addActivity` 中，找到 `const managerRequired = strictManagerRequired(payload.managerRequired);`（约 7949 行）之后、`const transaction = value.transaction(() => {` 之前，插入校验；在事务内拿到 account 后快照联系人；替换 `upsertManagerTask` 的 evidence。

```js
    const managerRequired = strictManagerRequired(payload.managerRequired);
    const noPlanReason = noPlan ? String(payload.summary || '').trim() : '';
    if (noPlan && !noPlanReason) {
      throw badRequest('暂无计划必须填写原因');
    }
    if (managerRequired && !String(payload.summary || '').trim()) {
      throw badRequest('请求主管协助必须填写申请原因');
    }
    const transaction = value.transaction(() => {
      const account = getAccountForUser(value, user, String(payload.customerId || ''));
      const assistanceContacts = managerRequired
        ? value.prepare(`SELECT name,title,department,match_status FROM crm_account_contacts
            WHERE customer_id=? AND COALESCE(archived_at,'')=''
            ORDER BY created_at ASC,id ASC`).all(account.id)
          .map(row => ({
            name: String(row.name || '').trim(),
            title: String(row.title || '').trim(),
            department: String(row.department || '').trim(),
            matchStatus: String(row.match_status || 'pending'),
          }))
        : [];
```

再把原来 evidence 块（`activityId, summary: ..., progressType, requestedAt, nextAction, nextActionAt`）替换为：

```js
          evidence: {
            activityId,
            requestReason: String(payload.summary || ''),
            originalPlan: terminal ? '' : nextAction,
            contacts: assistanceContacts,
            requestedAt: occurredAt,
            nextAction: terminal ? '' : nextAction,
            nextActionAt: terminal ? '' : nextActionAt,
            progressType: spec.progressKey,
            dueAt: dateOffset(3),
          },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/issue291_manager_assistance_loop.test.js`

Expected: PASS（2/2）。同时跑 `node --test test/issue257_manager_assistance_task.test.js test/issue243_no_plan_streak.test.js` 确保既有行为不回归。

- [ ] **Step 5: Commit**

```bash
git add lib/sales_crm.js test/issue291_manager_assistance_loop.test.js
git commit -m "fix: snapshot manager assistance request context"
```

### Task 2: 主管回执两步闭环：主管「已回复」→ 销售确认计划 → 任务完成

**Files:**
- Modify: `lib/sales_crm.js`（`buildAlerts` 约 2855-3040、`filterTodayTaskAlertsForUser` 约 3026-3034、`ALERT_REASON_ORDER` 约 3036-3050、`TODAY_TASK_ACTION_TYPES` 约 5327、`executeTodayTaskAction` 约 6228-6250、`completeManagerAssistanceTodayTask` 约 6076-6205）
- Modify: `lib/manager_tasks.js`（`completionCondition` 约 641-647）
- Update: `test/issue257_manager_assistance_task.test.js`
- Test: `test/issue291_manager_assistance_loop.test.js`（追加）

**Interfaces:**
- Consumes: `recordExplicitPlanIfEnabled(value, account, actorId, nextAction, nextActionAt, source, sourceEventId)`（`lib/sales_crm.js:5353`）；`recordTodayTaskAudit(value, user, identity, action, entityType, entityId, detail)`；`crm_manager_tasks.customer_id` 存的是 `external_customer_id || account.id`。
- Produces: 告警码 `MANAGER_REPLIED`（actionKind `confirm_manager_assistance`）；今日待办 actionType `confirm_manager_assistance`；`manager_status` 状态机 `待介入 → 已回复 → 已完成`；主管任务 status 保持 `open` 直到销售确认。

- [ ] **Step 1: 更新既有测试到两步闭环口径**

`test/issue257_manager_assistance_task.test.js` 中 `sales manager assistance creates one persisted task and manager completion closes it`（第 81 行）改为两步断言：

```js
test('manager reply keeps the task open until the sales confirms a new plan', async t => {
  // 保留原测试的建数据段（fixtures、POST /activities with managerRequired），accountId 用 CRM-OTHER
  // 第一步：经理（管理员）回复
  const reply = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: {
      idempotencyKey: `reply-${Date.now()}`,
      actionType: 'complete_manager_assistance',
      customerId: 'CRM-OTHER',
      result: '核对旧联系人，再查采购负责人',
    },
  });
  assert.equal(reply.status, 200, await reply.clone().text());
  const afterReply = fx.db.prepare('SELECT * FROM crm_manager_tasks WHERE reason=?').get('manager_assistance');
  assert.equal(afterReply.status, 'open');
  assert.match(afterReply.result_json, /manager_replied/);
  assert.equal(afterReply.completion_condition, '销售确认回执并保存下一步计划');
  const accountAfterReply = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-OTHER');
  assert.equal(accountAfterReply.manager_status, '已回复');
  assert.equal(accountAfterReply.manager_required, 1);
  assert.equal(fx.db.prepare(`SELECT COUNT(*) n FROM crm_audit_log
    WHERE action='today_task_manager_assistance_replied' AND entity_id='CRM-OTHER'`).get().n, 1);

  // 第二步：销售回执待办里保存下一步计划
  const confirm = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      idempotencyKey: `confirm-${Date.now()}`,
      actionType: 'confirm_manager_assistance',
      customerId: 'CRM-OTHER',
      nextAction: '两天后电话联系采购负责人',
      nextActionAt: '2026-08-20 09:00:00',
    },
  });
  assert.equal(confirm.status, 200, await confirm.clone().text());
  const afterConfirm = fx.db.prepare('SELECT * FROM crm_manager_tasks WHERE reason=?').get('manager_assistance');
  assert.equal(afterConfirm.status, 'completed');
  const accountAfterConfirm = fx.db.prepare('SELECT * FROM crm_accounts WHERE id=?').get('CRM-OTHER');
  assert.equal(accountAfterConfirm.manager_status, '已完成');
  assert.equal(accountAfterConfirm.manager_required, 0);
});
```

再在 `test/issue291_manager_assistance_loop.test.js` 追加：

```js
test('sales alert exposes MANAGER_REPLIED only to the owner and hides it from managers', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  // 销售 U-OTHER 名下客户发起协助并让经理回复
  const request = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: progressPayload({ customerId: 'CRM-OTHER', managerRequired: true }),
  });
  assert.equal(request.status, 200, await request.clone().text());
  fx.db.prepare(`UPDATE crm_accounts SET manager_status='已回复' WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,outcome,summary,stage_before,stage_after,
     manager_required,progress_key,reaction_label_snapshot,occurred_at,created_at)
    VALUES ('ACT-REPLY','CRM-OTHER','U-MGR','manager_join','已回复','核对旧联系人，再查采购负责人',
      'qualified','qualified',0,'manager_join','已回复',?,?)`).run(
    '2026-08-13 14:10:00', '2026-08-13 14:10:00');

  const salesList = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.otherCookie,
  })).json();
  assert.ok(salesList.rows.some(row =>
    row.customerId === 'CRM-OTHER' && row.code === 'MANAGER_REPLIED'));

  const managerList = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.cookie,
  })).json();
  assert.ok(!managerList.rows.some(row =>
    row.customerId === 'CRM-OTHER' && ['MANAGER_REPLIED', 'MANAGER_NEEDED'].includes(row.code)));
});

test('confirming the receipt without a plan is rejected and keeps the loop open', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`UPDATE crm_accounts SET manager_required=1,manager_status='已回复' WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_manager_tasks
    (id,idempotency_key,customer_id,reason,status,actor_id_snapshot,owner_id_snapshot,
     recipient_ids_json,evidence_json,completion_condition,settings_version,
     threshold_snapshot_json,evaluated_at,triggered_at,due_at,result_json,created_at,updated_at)
    VALUES ('MT-1','k-1','RU-9003','manager_assistance','open','U-OTHER','U-OTHER','[]',
      '{"requestReason":"无思路"}','销售确认回执并保存下一步计划',1,'{}',?,?,?, '{}',?,?)`).run(
    '2026-08-13 13:50:00', '2026-08-13 13:50:00', '2026-08-16 13:50:00',
    '2026-08-13 13:50:00', '2026-08-13 13:50:00');
  const response = await fx.request('/api/sales-crm/today-tasks/actions', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      idempotencyKey: 'confirm-no-plan', actionType: 'confirm_manager_assistance',
      customerId: 'CRM-OTHER', nextAction: '', nextActionAt: '',
    },
  });
  assert.equal(response.status, 400);
  const task = fx.db.prepare("SELECT * FROM crm_manager_tasks WHERE id='MT-1'").get();
  assert.equal(task.status, 'open');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/issue257_manager_assistance_task.test.js test/issue291_manager_assistance_loop.test.js`

Expected: FAIL —— 经理完成后 task 直接 completed、`manager_status='已完成'`；销售列表没有 MANAGER_REPLIED。

- [ ] **Step 3: 改 `completeManagerAssistanceTodayTask`（只回复，不关闭）**

`lib/sales_crm.js:6076` 附近，函数开头校验和两处写入改为：

```js
function completeManagerAssistanceTodayTask(value, user, payload, spec, identity) {
  assertTodayTaskManager(user, ['view_team', 'view_alerts']);
  const account = getAccountForUser(value, user, spec.targetId);
  if (!account.manager_required || account.manager_status !== '待介入') {
    throw todayTaskError(409, '该管理协助待办已完成或状态已变化', 'TODAY_TASK_STALE');
  }
  const result = String(payload.result || '').trim();
  if (!result) throw todayTaskError(400, '主管处理意见不能为空');
  if (Array.from(result).length > 2000) {
    throw todayTaskError(400, '主管处理意见最多2000个字符');
  }
  const repliedAt = nowText();
  const activityId = id('ACT');
  value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,
     stage_before,stage_after,manager_required,progress_key,reaction_option_id,
     reaction_label_snapshot,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    activityId, account.id, user.id, 'manager_join', '', '已回复', result,
    account.next_action || '', account.next_action_at || '', account.stage, account.stage,
    0, 'manager_join', '', '已回复', repliedAt, repliedAt,
  );
  value.prepare(`UPDATE crm_accounts SET manager_status='已回复',
    manager_id=?,last_activity_at=?,updated_at=? WHERE id=?`).run(
    user.id, repliedAt, repliedAt, account.id,
  );
  const taskResult = { action: 'manager_replied', result, activityId, repliedAt };
  value.prepare(`UPDATE crm_manager_tasks SET result_json=?,updated_at=?
    WHERE customer_id=? AND reason='manager_assistance'
      AND status IN ('open','overdue','escalated')
    ORDER BY triggered_at DESC,id DESC LIMIT 1`).run(
    JSON.stringify(taskResult), repliedAt,
    account.external_customer_id || account.id,
  );
  const request = latestManagerRequest(value, account.id);
  recordTodayTaskAudit(
    value, user, identity,
    'today_task_manager_assistance_replied',
    'crm_account', account.id,
    {
      requesterId: request?.requesterId || '',
      requestedAt: request?.requestedAt || '',
      requestReason: request?.reason || '',
      handlerId: user.id,
      result,
      repliedAt,
      activityId,
    },
  );
  return { actionType: spec.actionType, customerId: account.id, activityId, repliedAt };
}
```

删掉函数原来的「查 `listManagerTasks` → 直接 complete」两条分支（原 6097-6204 行），只保留上面这一条路径。

- [ ] **Step 4: 加 `confirmManagerAssistanceTodayTask` 并接入分发**

在 `addNextPlanTodayTask` 之后新增：

```js
function confirmManagerAssistanceTodayTask(value, user, payload, spec, identity) {
  assertPermission(user, 'view_alerts');
  assertPermission(user, 'record_activity');
  const account = getAccountForUser(value, user, spec.targetId);
  if (!account.manager_required || account.manager_status !== '已回复') {
    throw todayTaskError(409, '该主管协助回执已处理或状态已变化', 'TODAY_TASK_STALE');
  }
  const nextAction = String(payload.nextAction || '').trim();
  if (!nextAction) throw todayTaskError(400, '下一步动作不能为空');
  if (Array.from(nextAction).length > 1000) {
    throw todayTaskError(400, '下一步动作最多1000个字符');
  }
  const nextActionAt = normalizeTodayTaskDate(payload.nextActionAt);
  const changedAt = nowText();
  value.prepare(`UPDATE crm_accounts SET next_action=?,next_action_at=?,
    next_action_time_basis='utc',manager_required=0,manager_status='已完成',updated_at=?
    WHERE id=?`).run(nextAction, nextActionAt, changedAt, account.id);
  recordExplicitPlanIfEnabled(
    value, account, user.id, nextAction, nextActionAt, 'manager_receipt', spec.idempotencyKey,
  );
  value.prepare(`UPDATE crm_manager_tasks SET status='completed',
    result_json=?,resolved_by=?,resolved_at=?,updated_at=?
    WHERE customer_id=? AND reason='manager_assistance'
      AND status IN ('open','overdue','escalated')
    ORDER BY triggered_at DESC,id DESC LIMIT 1`).run(
    JSON.stringify({ action: 'sales_plan_confirmed', nextAction, nextActionAt, confirmedAt: changedAt }),
    user.id, changedAt, changedAt, account.external_customer_id || account.id,
  );
  recordTodayTaskAudit(
    value, user, identity,
    'today_task_manager_assistance_confirmed',
    'crm_account', account.id,
    { nextAction, nextActionAt, changedAt },
  );
  return { actionType: spec.actionType, customerId: account.id, nextAction, nextActionAt };
}
```

`TODAY_TASK_ACTION_TYPES`（5327 行）加一项：

```js
const TODAY_TASK_ACTION_TYPES = new Set([
  'resolve_overdue_lead',
  'add_next_plan',
  'complete_manager_assistance',
  'confirm_manager_assistance',
]);
```

`executeTodayTaskAction`（6243 行）分发改为：

```js
      if (spec.actionType === 'resolve_overdue_lead') {
        response = resolveOverdueLeadTodayTask(value, user, payload, spec, identity);
      } else if (spec.actionType === 'add_next_plan') {
        response = addNextPlanTodayTask(value, user, payload, spec, identity);
      } else if (spec.actionType === 'confirm_manager_assistance') {
        response = confirmManagerAssistanceTodayTask(value, user, payload, spec, identity);
      } else {
        response = completeManagerAssistanceTodayTask(value, user, payload, spec, identity);
      }
```

- [ ] **Step 5: 生成 MANAGER_REPLIED 告警并做角色过滤**

`buildAlerts` 顶部新建回执映射：

```js
  const managerReplyByCustomer = new Map();
  activities.forEach(activity => {
    if ((activity.progress_key || activity.progressType || '') !== 'manager_join') return;
    if ((activity.outcome || activity.reaction_label_snapshot || '') !== '已回复') return;
    if (!managerReplyByCustomer.has(activity.customer_id)) {
      managerReplyByCustomer.set(activity.customer_id, {
        repliedById: activity.user_id || '',
        repliedByName: activity.user_name || activity.actor_name || activity.user_id || '',
        repliedAt: activity.occurred_at || '',
        result: activity.summary || activity.outcome || '',
      });
    }
  });
```

`actionContract` 增加：

```js
      MANAGER_REPLIED: {
        actionKind: 'confirm_manager_assistance',
        allowedActions: ['confirm_manager_assistance'],
      },
```

`alerts.push` 的 managerRequest 行改为：

```js
      managerRequest: ['MANAGER_NEEDED', 'MANAGER_REPLIED'].includes(code)
        ? managerRequestByCustomer.get(account.id) || null
        : null,
```

`for (const account of accounts)` 循环里 `MANAGER_NEEDED` 行后追加：

```js
    if (account.manager_required && account.manager_status === '已回复') {
      const reply = managerReplyByCustomer.get(account.id) || null;
      add(account, 'critical', 'MANAGER_REPLIED',
        '主管已回复，待销售确认并制定下一步计划',
        reply?.result || '主管已完成处理，请确认回执并制定下一步计划',
        '制定下一步计划并完成协助闭环', 0, { managerReply: reply });
    }
```

`ALERT_REASON_ORDER` 增加一行：`MANAGER_REPLIED: 25,`。

`filterTodayTaskAlertsForUser`（3026 行）替换为：

```js
function filterTodayTaskAlertsForUser(alerts, user) {
  if (!user?.role) return alerts;
  const canSeeManagerReasons = ['admin', 'manager'].includes(String(user.role))
    && hasPermission(user, 'resolve_manager_tasks')
    && hasPermission(user, 'view_team')
    && hasPermission(user, 'view_alerts');
  if (canSeeManagerReasons) {
    return (Array.isArray(alerts) ? alerts : []).filter(alert => alert.code !== 'MANAGER_REPLIED');
  }
  return (Array.isArray(alerts) ? alerts : []).filter(alert =>
    alert.code !== 'MANAGER_NEEDED'
    && (alert.code !== 'MANAGER_REPLIED' || alert.ownerId === user.id));
}
```

`authorizeTodayTaskActions`（3166 行）在 `complete_manager_assistance` 分支后追加：

```js
    if (actionKind === 'confirm_manager_assistance') {
      return hasPermission(user, 'view_alerts') && hasPermission(user, 'record_activity');
    }
```

`lib/business_page_filters.js` 的 `allTodayTasks`（397 行）里有自己的 `canUse` 映射和 `builders.buildAlerts(accounts, activities, rfqs, quotes)` 调用，必须同步两处：

```js
  const managerTasks = ['admin', 'manager'].includes(String(user?.role || ''))
    && hasPermission(user, 'resolve_manager_tasks')
    ? builders.scopedManagerTasksForTodayAlerts(db, user)
    : [];
  const rawAlerts = [
    ...buildIntakeAlerts(db, user, nowText),
    ...builders.buildAlerts(accounts, activities, rfqs, quotes, [], managerTasks),
  ];
```

`canUse` 映射追加：

```js
    if (actionKind === 'confirm_manager_assistance') {
      return hasPermission(user, 'view_alerts') && hasPermission(user, 'record_activity');
    }
```

`lib/sales_crm.js` 的 `module.exports` 追加导出，并在文件里新增：

```js
function scopedManagerTasksForTodayAlerts(value, user) {
  if (!['admin', 'manager'].includes(String(user?.role || ''))) return [];
  return scopedManagerTasks(value, user, { limit: 100 });
}
```

- [ ] **Step 6: 完成条件文案**

`lib/manager_tasks.js:641` 的 `completionCondition` 中 `manager_assistance:` 值改为 `'销售确认回执并保存下一步计划'`。

- [ ] **Step 7: 运行测试确认通过**

Run: `node --test test/issue257_manager_assistance_task.test.js test/issue291_manager_assistance_loop.test.js test/issue257_today_task_visibility.test.js test/today_tasks.test.js test/today_tasks_integration.test.js`

Expected: PASS。若 `today_tasks*.test.js` 里有旧断言（经理完成后 `manager_status='已完成'` / 任务 completed），按 Step 1 的两步口径同步更新。

- [ ] **Step 8: Commit**

```bash
git add lib/sales_crm.js lib/manager_tasks.js test/issue257_manager_assistance_task.test.js test/issue291_manager_assistance_loop.test.js
git commit -m "fix: close manager assistance loop with sales receipt"
```

### Task 3: 主管处理弹窗补全上下文（原计划/联系人/期限/回执文案）

**Files:**
- Modify: `lib/sales_crm.js`（`buildAlerts` 增加第 6 个参数 `managerTasks`；bootstrap 调用处 7007 行传入）
- Modify: `sales-assets/app.js`（`openManagerAssistanceTaskModal` 约 8760-8790）
- Test: `test/issue291_manager_assistance_loop.test.js`（追加一条 managerRequest 契约测试）

**Interfaces:**
- Consumes: `scopedManagerTasks(value, user, { limit })`（5473 行附近）；`task.evidence.requestReason / originalPlan / contacts / dueAt`（Task 1 产出）。
- Produces: `item.managerRequest = { requesterId, requesterName, requestedAt, reason, progress, originalPlan, contacts, dueAt }`。

- [ ] **Step 1: 写失败测试**

`test/issue291_manager_assistance_loop.test.js` 追加：

```js
test('manager assistance alert carries original plan, contacts and deadline into managerRequest', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  fx.db.prepare(`INSERT INTO crm_account_contacts
    (id,customer_id,external_customer_id,name,title,department,phone,email,social,match_status,
     created_by,archived_at,created_at,updated_at)
    VALUES ('CT-2','CRM-OTHER','RU-9003','Ivan','Procurement','技术部','','','','mismatch',
      'U-OTHER','',?,?)`).run(
    '2026-08-10 08:00:00', '2026-08-10 08:00:00');
  const created = await fx.request('/api/sales-crm/activities', {
    cookie: fx.otherCookie, method: 'POST', body: progressPayload({ customerId: 'CRM-OTHER' }),
  });
  assert.equal(created.status, 200, await created.clone().text());

  const body = await (await fx.request('/api/sales-crm/lists/alerts?page=1&pageSize=50&filters=%7B%7D', {
    cookie: fx.cookie,
  })).json();
  const alert = body.rows.find(row =>
    row.customerId === 'CRM-OTHER' && row.code === 'MANAGER_NEEDED');
  assert.ok(alert);
  assert.equal(alert.managerRequest.originalPlan, '希望主管协助查询联系人');
  assert.equal(alert.managerRequest.contacts[0].name, 'Ivan');
  assert.match(alert.managerRequest.dueAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_manager_assistance_loop.test.js`

Expected: FAIL —— `managerRequest.originalPlan/contacts/dueAt` 为 undefined。

- [ ] **Step 3: `buildAlerts` 接收任务并用 evidence 覆盖请求信息**

函数签名改为 `function buildAlerts(accounts, activities, rfqs, quotes, planEvents = [], managerTasks = [])`。在 `managerRequestByCustomer` 填完后追加：

```js
  const managerTaskByCustomer = new Map();
  managerTasks.forEach(task => {
    if (task.reason === 'manager_assistance' && task.customerId) {
      managerTaskByCustomer.set(task.customerId, task);
    }
  });
  const accountIdByExternalId = new Map(accounts.map(account =>
    [String(account.external_customer_id || ''), String(account.id || '')]));
  for (const [customerId, task] of managerTaskByCustomer) {
    const accountId = accountIdByExternalId.get(String(customerId)) || String(customerId);
    const fromActivity = managerRequestByCustomer.get(accountId) || {};
    managerRequestByCustomer.set(accountId, {
      requesterId: fromActivity.requesterId || task.actorIdSnapshot || '',
      requesterName: fromActivity.requesterName || '',
      requestedAt: fromActivity.requestedAt || task.triggeredAt || '',
      reason: task.evidence?.requestReason || fromActivity.reason || '',
      progress: fromActivity.progress || '',
      originalPlan: task.evidence?.originalPlan || '',
      contacts: Array.isArray(task.evidence?.contacts) ? task.evidence.contacts : [],
      dueAt: task.dueAt || task.evidence?.dueAt || '',
    });
  }
```

bootstrap 调用处（7007 行）把 `managerTasks` 的计算上移到 `buildAlerts` 之前：

```js
    const hasManagerTaskRole = ['admin', 'manager'].includes(String(user.role || ''));
    const managerTasks = hasManagerTaskRole && permissions.resolve_manager_tasks
      ? scopedManagerTasks(value, user, { limit: 100 })
      : [];
    const alerts = authorizeTodayTaskActions(
      groupAlerts(filterTodayTaskAlertsForUser([
        ...buildIntakeAlerts(value, user),
        ...buildAlerts(accounts, effectiveActivities, effectiveRfqs, effectiveQuotes, planEvents, managerTasks),
      ], user)),
      user,
    );
```

并删除后面 payload 里的旧 `const managerTasks = ...` 声明（7097 行）。

- [ ] **Step 4: 前端弹窗展示完整上下文**

`sales-assets/app.js:8760` 的 `openManagerAssistanceTaskModal` 中，读取字段并重写表单：

```js
  function openManagerAssistanceTaskModal(item) {
    if (!todayTaskActionAllowed(
      item,
      ['complete_manager_assistance'],
      ['admin', 'manager'].includes(state.data?.user?.role)
        && can('view_team'),
    )) return toast('当前账号无权完成该协助请求');
    const account = state.data.accounts.find(row => row.id === item.customerId);
    const request = item.managerRequest || {};
    const requester = managerRequestValue(request, ['requesterName', 'applicantName', 'requestedByName', 'userName', 'requesterId']);
    const requestedAt = managerRequestValue(request, ['requestedAt', 'createdAt', 'occurredAt']);
    const reason = managerRequestValue(request, ['reason', 'requestReason', 'summary', 'content', 'progressContent', 'detail']) || item.detail;
    const originalPlan = managerRequestValue(request, ['originalPlan', 'nextAction', 'plan']) || '未记录';
    const dueAt = managerRequestValue(request, ['dueAt', 'deadline']);
    const contacts = Array.isArray(request.contacts) && request.contacts.length
      ? request.contacts.map(contact => `${esc(contact.name || '未命名')}${contact.title ? ` · ${esc(contact.title)}` : ''}${contact.department ? ` · ${esc(contact.department)}` : ''}${contact.matchStatus === 'mismatch' ? ' · 已标记不对口' : ''}`).join('<br>')
      : '暂无联系人记录';
    openModal('处理协助请求', '回复销售并完成主管任务', `
      <form id="todayTaskManagerForm" class="form-grid today-task-form" data-today-task-form>
        <input type="hidden" name="customerId" value="${esc(item.customerId)}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        ${todayTaskFactGrid([
          ['客户', accountDisplayName(account || item)],
          ['申请人', requester || '未记录'],
          ['处理期限', dueAt ? shortDate(dueAt, true) : '未设置'],
        ])}
        <div class="today-task-request"><span>申请原因</span><p>${esc(reason || '未记录具体原因')}</p></div>
        <div class="today-task-request"><span>销售原计划</span><p>${esc(originalPlan)}</p></div>
        <div class="today-task-request"><span>现有联系人</span><p>${contacts}</p></div>
        <label>主管处理意见<textarea name="result" rows="4" maxlength="2000" required placeholder="填写本次处理意见、已完成的协助和后续安排"></textarea></label>
        ${todayTaskErrorMarkup()}
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">回复销售并完成主管任务</button></div>
      </form>`, 'today-task-modal');
  }
```

- [ ] **Step 5: 运行测试**

Run: `node --test test/issue291_manager_assistance_loop.test.js test/issue257_today_task_ui.test.js`

Expected: PASS（257 UI 测试若断言旧按钮文案「完成协助」，改为新文案）。

- [ ] **Step 6: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js test/issue291_manager_assistance_loop.test.js
git commit -m "fix: show full manager assistance context and reply wording"
```

### Task 4: 只更新下一步计划独立幂等接口（不产生客户进展事件）

**Files:**
- Modify: `lib/sales_crm.js`（新增 `ensurePlanOnlyActionSchema` 挂到 `installSalesCrm` 的 schema 阶段约 955-980 行附近；新增 `planOnlyActivity` 函数；注册 `app.post('/api/sales-crm/activities/plan-only')`，必须放在 `/activities` 相关动态路由之前，建议紧挨 `app.post('/api/sales-crm/activities')` 注册点）
- Test: `test/issue291_plan_only.test.js`

**Interfaces:**
- Consumes: `recordExplicitPlanIfEnabled(...)`、`recordTodayTaskAudit(...)`、`getAccountForUser(...)`、`normalizeTodayTaskDate(...)`。
- Produces: `POST /api/sales-crm/activities/plan-only`，请求 `{ customerId, nextAction, nextActionAt, note?, idempotencyKey }`，返回 `{ ok:true, customerId, nextAction, nextActionAt, deduplicated }`；不写 `crm_activities`。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_plan_only.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('plan-only save updates the plan without creating an activity or fake progress', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const before = fx.db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE customer_id='CRM-OTHER'").get().n;
  const response = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-OTHER',
      nextAction: '联系客户采购负责人，确认是否有新项目',
      nextActionAt: '2026-08-18 10:00:00',
      note: '目前没有发生新的客户动作，只补充下一步安排',
      idempotencyKey: 'plan-only-1',
    },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const account = fx.db.prepare("SELECT * FROM crm_accounts WHERE id='CRM-OTHER'").get();
  assert.equal(account.next_action, '联系客户采购负责人，确认是否有新项目');
  assert.equal(account.next_action_time_basis, 'utc');
  assert.equal(
    fx.db.prepare("SELECT COUNT(*) n FROM crm_activities WHERE customer_id='CRM-OTHER'").get().n,
    before,
  );
  const audit = fx.db.prepare(`SELECT * FROM crm_audit_log
    WHERE action='activity_plan_only_saved' AND entity_id='CRM-OTHER' ORDER BY created_at DESC LIMIT 1`).get();
  assert.ok(audit);
  assert.equal(JSON.parse(audit.detail_json).note, '目前没有发生新的客户动作，只补充下一步安排');
});

test('plan-only is idempotent on the same key and requires a real plan pair', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const payload = {
    customerId: 'CRM-OTHER', nextAction: '两天后电话联系', nextActionAt: '2026-08-20 09:00:00',
    idempotencyKey: 'plan-only-2',
  };
  const first = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(first.status, 200);
  const second = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST', body: payload,
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).deduplicated, true);

  const missing = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie, method: 'POST',
    body: { customerId: 'CRM-OTHER', nextAction: '只有动作', nextActionAt: '', idempotencyKey: 'x-1' },
  });
  assert.equal(missing.status, 400);
});

test('sales cannot plan-only for a customer outside their scope', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  const response = await fx.request('/api/sales-crm/activities/plan-only', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: {
      customerId: 'CRM-WU', nextAction: '越权写计划', nextActionAt: '2026-08-20 09:00:00',
      idempotencyKey: 'plan-only-3',
    },
  });
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_plan_only.test.js`

Expected: FAIL —— 路由 404。

- [ ] **Step 3: schema**

在 `installSalesCrm` 的 ensure 区（955-980 附近）加：

```js
function ensurePlanOnlyActionSchema(value) {
  value.exec(`CREATE TABLE IF NOT EXISTS crm_plan_only_action_requests (
    idempotency_key TEXT PRIMARY KEY CHECK (length(trim(idempotency_key)) > 0),
    actor_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed')),
    response_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}
```

在 `installSalesCrm` 内 `ensureActivityProgressSchema(value)` 调用旁加 `ensurePlanOnlyActionSchema(value);`。

- [ ] **Step 4: 实现函数**

```js
function planOnlyActivity(user, payload, identity = {}) {
  assertPermission(user, 'view_alerts');
  assertPermission(user, 'record_activity');
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 240) throw badRequest('必须提供有效的幂等键');
  const nextAction = String(payload.nextAction || '').trim();
  if (!nextAction) throw badRequest('下一步动作不能为空');
  if (Array.from(nextAction).length > 1000) throw badRequest('下一步动作最多1000个字符');
  const nextActionAt = normalizeTodayTaskDate(payload.nextActionAt);
  const note = String(payload.note || '').trim().slice(0, 1000);
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const canonical = { customerId: account.id, nextAction, nextActionAt, note, idempotencyKey };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const changedAt = nowText();
    const existing = value.prepare(
      'SELECT * FROM crm_plan_only_action_requests WHERE idempotency_key=?',
    ).get(idempotencyKey);
    if (existing) {
      if (existing.actor_id !== user.id || existing.customer_id !== account.id
          || existing.request_hash !== requestHash) {
        throw conflictError('幂等键已绑定其他计划保存', 'PLAN_ONLY_IDEMPOTENCY_CONFLICT');
      }
      if (existing.status === 'completed') {
        return { ...json(existing.response_json, {}), deduplicated: true };
      }
      throw conflictError('相同计划保存正在处理中', 'PLAN_ONLY_IN_PROGRESS');
    }
    value.prepare(`INSERT INTO crm_plan_only_action_requests
      (idempotency_key,actor_id,customer_id,request_hash,status,response_json,created_at,updated_at)
      VALUES (?,?,?,?,'started','{}',?,?)`)
      .run(idempotencyKey, user.id, account.id, requestHash, changedAt, changedAt);
    value.prepare(`UPDATE crm_accounts SET next_action=?,next_action_at=?,
      next_action_time_basis='utc',updated_at=? WHERE id=?`)
      .run(nextAction, nextActionAt, changedAt, account.id);
    recordExplicitPlanIfEnabled(value, account, user.id, nextAction, nextActionAt, 'plan_only', idempotencyKey);
    recordTodayTaskAudit(
      value, user, identity, 'activity_plan_only_saved', 'crm_account', account.id,
      { note, nextAction, nextActionAt, changedAt },
    );
    const response = { customerId: account.id, nextAction, nextActionAt, deduplicated: false };
    value.prepare(`UPDATE crm_plan_only_action_requests
      SET status='completed',response_json=?,updated_at=? WHERE idempotency_key=?`)
      .run(JSON.stringify(response), nowText(), idempotencyKey);
    return response;
  } finally { value.close(); }
}
```

- [ ] **Step 5: 注册路由**

找到现有 `app.post('/api/sales-crm/activities', ...)`（约 10030 行，前端 10063 行消费），在它之前插入：

```js
  app.post('/api/sales-crm/activities/plan-only', (req, res) => {
    try {
      res.json({ ok: true, ...planOnlyActivity(req.salesUser, req.body || {}, auditIdentity(req)) });
    } catch (error) { sendApiError(res, error); }
  });
```

- [ ] **Step 6: 运行测试**

Run: `node --test test/issue291_plan_only.test.js test/issue149_progress_backend.test.js`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add lib/sales_crm.js test/issue291_plan_only.test.js
git commit -m "fix: add truthful plan-only progress action"
```

### Task 5: 「记录新进展」四模式弹窗 + 从待办进入时默认「只更新下一步计划」

**Files:**
- Modify: `sales-assets/app.js`（`todayTaskActionKind` 约 4277、`todayTaskActionMarkup` 约 4340、`openTodayTaskAction` 约 8793、`openActivityModal` 约 9169、`openNextPlanTaskModal`/`setNextPlanMode` 约 8589-8660、submit 分支约 10024）
- Modify: `sales-assets/app.css`（模式 tab 样式，可复用 `.segmented`/`.plan-mode-tabs`）
- Update: `test/issue149_progress_ui.test.js`（旧的「需要经理协助 checkbox / 暂无计划 checkbox」断言改为四模式断言）
- Test: `test/issue291_progress_modal_ui.test.js`

**Interfaces:**
- Consumes: Task 4 的 `POST /api/sales-crm/activities/plan-only`；`submitTodayTaskAction(form, body, message)`；`POST /api/sales-crm/today-tasks/actions`。
- Produces: `openActivityModal(customerId = '', mode = 'progress', options = {})`；`openActivityModal.todayTaskContext = { todayTaskTitle, todayTaskAction, todayTaskActionType }`；form 隐藏字段 `activityMode`。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_progress_modal_ui.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('progress modal exposes four truthful modes and the plan-only fields', () => {
  const modal = section(app, 'function openActivityModal', 'function openNewCustomerModal');
  for (const copy of [
    '记录新进展',
    '只更新下一步计划',
    '暂无计划',
    '请求主管协助',
    'data-activity-mode="plan"',
    'data-activity-mode="noPlan"',
    'data-activity-mode="manager"',
    '本次说明（选填）',
    '不会生成“发送邮件”等虚假进展',
    '保存计划',
  ]) assert.match(modal, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('NO_NEXT and manager receipt tasks open the modal in plan mode', () => {
  const routing = section(app, 'function openTodayTaskAction', 'async function loadActivityReactions');
  assert.match(routing, /openActivityModal\(item\.customerId, 'plan'/);
  const aliases = section(app, 'function todayTaskActionKind', 'function todayTaskDueText');
  assert.match(aliases, /confirm_manager_assistance: 'manager-receipt'/);
});

test('plan mode routes to plan-only or the receipt today task action and never to /activities', () => {
  const submit = section(app, "form.id === 'activityForm'", "form.id === 'customerForm'");
  assert.match(submit, /\/api\/sales-crm\/activities\/plan-only/);
  assert.match(submit, /confirm_manager_assistance/);
  assert.match(submit, /未生成客户进展事件/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_progress_modal_ui.test.js`

Expected: FAIL —— 现有弹窗没有四模式/plan-only 路由。

- [ ] **Step 3: 待办动作映射**

`todayTaskActionKind` 的 `aliases` 增加：

```js
      confirm_manager_assistance: 'manager-receipt',
```

`todayTaskActionMarkup` 的 `allowed` 增加：

```js
      'manager-receipt': todayTaskActionAllowed(
        item,
        ['confirm_manager_assistance', 'add_next_plan'],
        can('record_activity'),
      ),
```

`labels` 增加 `'manager-receipt': '确认并制定下一步计划',`。

- [ ] **Step 4: 待办入口路由**

`openTodayTaskAction` 中：

```js
    if (kind === 'next-plan') return openActivityModal(item.customerId, 'plan', {
      todayTaskTitle: item.title,
      todayTaskAction: '只更新下一步计划，不虚构客户新进展',
      todayTaskActionType: 'add_next_plan',
    });
    if (kind === 'manager-receipt') return openActivityModal(item.customerId, 'plan', {
      todayTaskTitle: '主管已回复，待销售确认并制定下一步计划',
      todayTaskAction: item.managerReply?.result || '保存下一步计划后完成协助闭环',
      todayTaskActionType: 'confirm_manager_assistance',
    });
```

**保留** `openNextPlanTaskModal`、`setNextPlanMode` 和 `todayTaskPlanForm` 提交分支——这是「暂未确定（deferred-plan）」既有能力，被 `test/issue170_deferred_plan_ui.test.js` 覆盖，不删除。只把普通「缺少下一步计划（NO_NEXT）」入口改到新四模式弹窗：

- `todayTaskActionKind` 的 code 映射增加 `if (code === 'NO_NEXT_DEFERRED') return 'deferred-plan';`
- `todayTaskActionMarkup` 的 `allowed` 增加 `'deferred-plan': todayTaskActionAllowed(item, ['add_next_plan'], can('record_activity'))`，`labels` 增加 `'deferred-plan': '设置复查时间'`。
- `openTodayTaskAction` 增加：`if (kind === 'deferred-plan') return openNextPlanTaskModal(item);`

- [ ] **Step 5: 重写 `openActivityModal`**

用下面完整实现替换 `openActivityModal`（9169 行起，到 `renderActivityReactionAdminModal` 之前）：

```js
  function setActivityModalMode(mode) {
    const form = $('#activityForm');
    if (!form || !['progress', 'plan', 'noPlan', 'manager'].includes(mode)) return;
    state.activityModalMode = mode;
    form.elements.activityMode.value = mode;
    $$('#activityModeTabs [data-activity-mode]').forEach(button => {
      const selected = button.dataset.activityMode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    $('#activityProgressFields')?.classList.toggle('hidden', mode !== 'progress');
    $('#activityPlanFields')?.classList.toggle('hidden', mode !== 'plan');
    $('#activityNoPlanFields')?.classList.toggle('hidden', mode !== 'noPlan');
    $('#activityManagerFields')?.classList.toggle('hidden', mode !== 'manager');
    const submit = $('#activitySubmit');
    if (submit) {
      submit.textContent = {
        progress: '保存进展',
        plan: '保存计划',
        noPlan: '保存暂无计划状态',
        manager: '提交主管协助请求',
      }[mode];
    }
  }

  async function openActivityModal(customerId = '', initialMode = 'progress', options = {}) {
    const todayOptions = options.todayTaskActionType ? options : (openActivityModal.todayTaskContext || {});
    openActivityModal.todayTaskContext = null;
    if (!can('record_activity')) return toast('当前账号没有记录进展权限');
    try {
      await loadActivityReactions({ force: true });
    } catch (error) {
      return toast(error.message || '客户反应选项读取失败');
    }
    const account = state.data.accounts.find(item => item.id === customerId);
    state.activitySelectedCustomer = account ? normalizeActivityCustomer(account) : null;
    state.activityCustomerResults = [];
    state.activityCustomerActiveIndex = -1;
    state.activityProgressType = 'email';
    state.activityType = 'email';
    const initialPlan = account?.next_action || '';
    const initialPlanAt = account?.next_action_at ? apiTime(account.next_action_at) : dateInput(2);
    openModal('记录新进展', '选择客户后，记录本次进展与下一步计划', `
      <form id="activityForm" class="activity-progress-form">
        <input type="hidden" name="customerId" value="${esc(state.activitySelectedCustomer?.id || '')}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        <input type="hidden" name="activityMode" value="${esc(initialMode)}">
        ${todayOptions.todayTaskTitle ? `<input type="hidden" name="todayTaskSource" value="alerts">` : ''}
        ${todayOptions.todayTaskActionType ? `<input type="hidden" name="todayTaskActionType" value="${esc(todayOptions.todayTaskActionType)}">` : ''}
        <input type="hidden" name="activityType" value="email">
        <input type="hidden" name="channel" value="email">
        <input type="hidden" name="outcome" value="">
        <input type="hidden" name="proposalJobId" value="">
        <section id="activityMainStep" class="activity-main-step">
          ${todayOptions.todayTaskTitle ? `<div class="today-task-context"><strong>${esc(todayOptions.todayTaskTitle)}</strong><span>${esc(todayOptions.todayTaskAction || '请记录完成该待办的真实客户进展')}</span></div>` : ''}
          <div id="activityModeTabs" class="segmented activity-mode-tabs" role="tablist" aria-label="进展记录模式">
            <button class="active" type="button" role="tab" data-activity-mode="progress">记录新进展</button>
            <button type="button" role="tab" data-activity-mode="plan">只更新下一步计划</button>
            <button type="button" role="tab" data-activity-mode="noPlan">暂无计划</button>
            <button type="button" role="tab" data-activity-mode="manager">请求主管协助</button>
          </div>
          <div id="activityCustomerPicker" class="activity-customer-picker"></div>
          <section id="activityProgressFields">
            <div class="activity-primary-grid">
              <div class="activity-field">
                <label for="activityProgressType">本次进展</label>
                <select id="activityProgressType" name="progressType" required>
                  ${activityProgressOptions.map(item => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}
                </select>
              </div>
              ${activityReactionField()}
            </div>
            <label class="activity-summary-field">进展内容
              <textarea id="activitySummary" name="summary" rows="2" maxlength="4000" placeholder="记录客户反馈、需求或当前障碍"></textarea>
            </label>
            <div class="activity-primary-grid">
              <label>下一步计划<input name="nextAction" placeholder="例如：追踪客户 BOM"></label>
              <label>下次跟进时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${dateInput(2)}"></label>
            </div>
            ${customerAIEnabled() && can('use_ai_assistant') ? `<details class="action-proposal-details">
              <summary>使用 AI 整理本次进展</summary>
              <section class="action-proposal-compose">
                <div><strong>AI 整理进展</strong><span>输入事实描述，AI 只填写草稿，不会直接写入 CRM。</span></div>
                <textarea id="actionProposalInput" maxlength="4000" placeholder="例如：客户通过邮件回复，对 STM32 有兴趣，本周五整理 BOM，下周一上午跟进。"></textarea>
                <button id="actionProposalGenerate" class="button secondary" type="button">整理为进展草稿</button>
                <p id="actionProposalStatus" class="action-proposal-status" role="status" aria-live="polite"></p>
              </section>
            </details>` : ''}
          </section>
          <section id="activityPlanFields" class="hidden form-grid activity-plan-fields">
            <label class="span-2">下一步计划<input name="planNextAction" maxlength="1000" placeholder="例如：联系客户采购负责人，确认是否有新项目"></label>
            <label class="span-2">下次跟进时间<input name="planNextActionAt" type="datetime-local" data-future-datetime value="${initialPlan ? esc(initialPlanAt) : dateInput(1)}"></label>
            <label class="span-2">本次说明（选填）<textarea name="planNote" rows="2" maxlength="1000" placeholder="目前没有发生新的客户动作，只补充下一步安排"></textarea></label>
            <p class="span-2 subtle activity-plan-hint">不会生成“发送邮件”等虚假进展。</p>
          </section>
          <section id="activityNoPlanFields" class="hidden form-grid activity-no-plan-fields">
            <label class="span-2">原因<textarea name="noPlanReason" rows="3" maxlength="1000" placeholder="说明当前为什么没有下一步计划"></textarea></label>
            <p class="span-2 subtle activity-plan-hint">将保存为真实状态，连续 3 次暂无计划会提醒经理介入。</p>
          </section>
          <section id="activityManagerFields" class="hidden form-grid activity-manager-fields">
            <label class="span-2">申请原因<textarea name="managerReason" rows="3" maxlength="1000" placeholder="例如：已发邮件且社媒无回应，目前没有思路"></textarea></label>
            <label class="span-2">销售原计划<input name="managerNextAction" maxlength="1000" value="${esc(initialPlan)}" placeholder="希望主管协助查询联系人或给出对接建议"></label>
            <label class="span-2">原计划跟进时间<input name="managerNextActionAt" type="datetime-local" data-future-datetime value="${account?.next_action_at ? esc(initialPlanAt) : ''}"></label>
            <p class="span-2 subtle activity-plan-hint">提交后会生成主管待办，包含客户、申请人、申请原因、原计划、联系人、处理期限和完结条件。</p>
          </section>
          <div class="form-actions activity-form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button id="activitySubmit" class="button primary">保存进展</button></div>
        </section>
        <section id="activityRfqStep" class="activity-rfq-step hidden">
          <div class="activity-step-intro"><strong>补充询价信息</strong><span>这些信息只在收到询价时填写，提交后与本次进展一次性保存。</span></div>
          <div class="activity-primary-grid">
            <label>询价编号<input name="reference" placeholder="如 RFQ-2026-0719"></label>
            <label>BOM 行数<input name="bomLines" type="number" min="0"></label>
            <label>预估金额（USD）<input name="expectedValue" type="number" min="0"></label>
            <label>资料完整度<input name="completeness" type="number" min="0" max="100" value="80"></label>
          </div>
          <label>产品类别<input name="productCategory" placeholder="MCU、连接器、传感器等"></label>
          <div class="form-actions activity-form-actions"><button type="button" class="button secondary" data-activity-main-step>返回修改</button><button class="button primary">保存进展</button></div>
        </section>
      </form>`, 'activity-progress-modal');
    renderActivityCustomerPicker({ focusSearch: !state.activitySelectedCustomer });
    setActivityModalMode(initialMode);
    setProgressType('email');
    resizeActivitySummary($('#activitySummary'));
    constrainFutureDateTimes($('#activityForm'));
  }
```

在 click 事件分发里增加模式切换（`setActivityReaction` 附近已有 `input[name="noPlan"]` 处理，参照它）：

```js
    const modeButton = event.target.closest('[data-activity-mode]');
    if (modeButton) { setActivityModalMode(modeButton.dataset.activityMode); return; }
```

同时删除 change 事件里旧的无计划勾选处理（约 11263-11273 行，`#activityForm input[name="noPlan"]` 的 nextAction/nextActionAt 联动），新模式由 `setActivityModalMode` 独立控制各分区。

- [ ] **Step 6: 提交路由分支**

把 submit 里 `form.id === 'activityForm'` 分支（10024 行）替换为：

```js
      } else if (form.id === 'activityForm') {
        if (state.activitySubmitting) return;
        const payload = formPayload(form);
        const mode = payload.activityMode || 'progress';
        if (!state.activitySelectedCustomer || payload.customerId !== state.activitySelectedCustomer.id) {
          throw new Error('请先搜索并选择客户');
        }
        const fromTodayTask = payload.todayTaskSource === 'alerts';
        const todayTaskActionType = payload.todayTaskActionType || '';
        delete payload.todayTaskSource;
        delete payload.todayTaskActionType;
        delete payload.activityMode;
        if (mode === 'plan') {
          if (!String(payload.planNextAction || '').trim()) throw new Error('请填写下一步计划');
          if (!payload.planNextActionAt) throw new Error('请选择下次跟进时间');
          if (!validateFutureDateTime(form.elements.planNextActionAt)) throw new Error('下一步时间必须晚于当前时间');
          const nextAction = String(payload.planNextAction || '').trim();
          const nextActionAt = apiTime(payload.planNextActionAt);
          const note = String(payload.planNote || '').trim();
          if (fromTodayTask && ['add_next_plan', 'confirm_manager_assistance'].includes(todayTaskActionType)) {
            await submitTodayTaskAction(form, {
              actionType: todayTaskActionType,
              customerId: payload.customerId,
              nextAction,
              nextActionAt,
              idempotencyKey: payload.idempotencyKey,
            }, todayTaskActionType === 'confirm_manager_assistance'
              ? '回执已确认，主管协助闭环完成'
              : '下一步计划已保存，待办已更新');
          } else {
            await api('/api/sales-crm/activities/plan-only', {
              method: 'POST',
              body: JSON.stringify({
                customerId: payload.customerId,
                nextAction,
                nextActionAt,
                note,
                idempotencyKey: payload.idempotencyKey,
              }),
            });
            await refresh('下一步计划已保存，未生成客户进展事件');
          }
          refreshDrawerNextActionTime();
          return;
        }
        if (mode === 'noPlan') {
          if (!String(payload.noPlanReason || '').trim()) throw new Error('请填写暂无计划的原因');
          payload.summary = String(payload.noPlanReason || '').trim();
          payload.noPlan = true;
          payload.nextAction = '';
          payload.nextActionAt = '';
          payload.activityType = 'note';
          payload.channel = '';
          delete payload.progressType;
          delete payload.reactionOptionId;
        }
        if (mode === 'manager') {
          if (!String(payload.managerReason || '').trim()) throw new Error('请填写申请原因');
          payload.summary = String(payload.managerReason || '').trim();
          payload.managerRequired = true;
          payload.activityType = 'note';
          payload.channel = '';
          payload.nextAction = String(payload.managerNextAction || '').trim();
          payload.nextActionAt = payload.managerNextActionAt ? apiTime(payload.managerNextActionAt) : '';
          if (!payload.nextAction) payload.nextActionAt = '';
          delete payload.progressType;
          delete payload.reactionOptionId;
        }
        if (mode === 'progress' && payload.progressType === 'rfq' && $('#activityRfqStep')?.classList.contains('hidden')) {
          showActivityRfqStep(true);
          return;
        }
        const submitButtons = Array.from(form.querySelectorAll('button[type="submit"],button:not([type])'));
        state.activitySubmitting = true;
        submitButtons.forEach(button => { button.disabled = true; });
        try {
          if (payload.noPlan) {
            payload.nextAction = '';
            payload.nextActionAt = '';
          }
          payload.nextActionAt = apiTime(payload.nextActionAt);
          payload.bomLines = Number(payload.bomLines || 0);
          payload.expectedValue = Number(payload.expectedValue || 0);
          payload.completeness = Number(payload.completeness || 0);
          if (payload.progressType !== 'rfq') {
            delete payload.reference;
            delete payload.bomLines;
            delete payload.expectedValue;
            delete payload.completeness;
            delete payload.productCategory;
          }
          const result = await api('/api/sales-crm/activities', { method: 'POST', body: JSON.stringify(payload) });
          const stageBefore = result.stageBefore || result.previousStage || '';
          const stageAfter = result.stageAfter || result.stage || '';
          const stageChanged = result.stageChanged ?? Boolean(stageBefore && stageAfter && stageBefore !== stageAfter);
          const message = stageChanged
            ? `进展已记录，客户阶段已更新为“${stageLabel(stageAfter)}”`
            : mode === 'noPlan' ? '暂无计划已记录为真实状态'
              : mode === 'manager' ? '主管协助请求已提交'
                : '进展已记录，客户阶段未发生变化';
          if (fromTodayTask) await refreshTodayTasksAfterAction(message);
          else await refresh(message);
          refreshDrawerNextActionTime();
        } finally {
          state.activitySubmitting = false;
          if (form.isConnected) submitButtons.forEach(button => { button.disabled = false; });
        }
      } else if (form.id === 'customerForm') {
```

注意：原分支里 `delete payload.todayTaskSource` 在新代码里提前执行，其余业务路径保持一致；`submitTodayTaskAction` 内部会调 `refreshTodayTasksAfterAction`，plan 分支因此不再重复 `refresh`。

- [ ] **Step 7: 更新旧 UI 测试**

`test/issue149_progress_ui.test.js` 的 `record progress modal uses the confirmed compact wording and fields` 中，把 `需要经理协助`、`勾选后提醒销售经理关注并协助本次进展`、`name="managerRequired"`、`name="noPlan"` 断言改为：

```js
  assert.match(modal, /data-activity-mode="progress"/);
  assert.match(modal, /data-activity-mode="plan"/);
  assert.match(modal, /data-activity-mode="noPlan"/);
  assert.match(modal, /data-activity-mode="manager"/);
  assert.match(modal, /不会生成“发送邮件”等虚假进展/);
  assert.match(modal, /保存计划/);
```

并删除 `assert.match(modal, /name="noPlan" .../)` 相关的 checkbox 断言（新模式不再渲染 checkbox）。

- [ ] **Step 8: 运行测试**

Run: `node --test test/issue291_progress_modal_ui.test.js test/issue149_progress_ui.test.js test/issue157_today_task_ui.test.js test/issue257_today_task_ui.test.js`

Expected: PASS。`openNextPlanTaskModal`/`setNextPlanMode`/`todayTaskPlanForm` 保留用于 deferred 流程；`issue170_deferred_plan_ui.test.js` 必须仍然通过。若 `issue257_today_task_ui.test.js` 或 `today_tasks` 相关测试断言「缺少下一步计划」按钮打开旧弹窗文案（`补充下一步计划`/`计划执行时间`），改为断言进入四模式弹窗并默认 `data-activity-mode="plan"` 高亮。

- [ ] **Step 9: Commit**

```bash
git add sales-assets/app.js sales-assets/app.css test/issue149_progress_ui.test.js test/issue291_progress_modal_ui.test.js
git commit -m "fix: replace progress modal with four truthful modes"
```

### Task 6: 时间线中文与去重：请求协助 / 主管回复 / 暂无计划

**Files:**
- Modify: `lib/sales_crm.js`（`buildAccountHistory` 约 6720-6740，活动事件补 `manager_required`、`outcome` 字段）
- Modify: `sales-assets/app.js`（`timelineEventTitle` 约 303；`renderActivityTimelineItem` 约 7508；抽屉 `buildAccountHistory` 渲染处约 7473）
- Test: `test/issue291_progress_modal_ui.test.js`（追加）

**Interfaces:**
- Consumes: 活动事件字段 `event.no_plan`、`event.manager_required`、`event.outcome`。
- Produces: 标题规则：`no_plan=1 → 暂无计划`；`manager_join 且 outcome=已回复 → 主管回复`；`manager_required=1 且非 manager_join → 请求主管协助`。

- [ ] **Step 1: 写失败测试**

`test/issue291_progress_modal_ui.test.js` 追加：

```js
test('timeline titles route request, reply and no-plan states through Chinese labels', () => {
  const titleFn = section(app, 'function timelineEventTitle', 'function timelineEventSummary');
  assert.match(titleFn, /暂无计划/);
  assert.match(titleFn, /主管回复/);
  assert.match(titleFn, /请求主管协助/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_progress_modal_ui.test.js`

Expected: FAIL。

- [ ] **Step 3: `buildAccountHistory` 活动事件补字段**

`lib/sales_crm.js:6731` 的 `kind: 'activity'` 事件对象增加两行：

```js
      manager_required: Number(activity.manager_required || activity.managerRequired || 0),
      outcome: activity.outcome || activity.reaction_label_snapshot || '',
```

- [ ] **Step 4: 前端标题规则**

`timelineEventTitle`（303 行）在 `const mapped = EVENT_LABELS[kind];` 之后插入：

```js
  if (event?.kind === 'activity') {
    if (Number(event.no_plan || 0) === 1) return '暂无计划';
    if (String(event.event_type || '') === 'manager_join' && String(event.outcome || '') === '已回复') {
      return '主管回复';
    }
    if (Number(event.manager_required || 0) === 1) return '请求主管协助';
  }
```

`renderActivityTimelineItem`（7508 行）里 `const title = timelineEventTitle(event);` 之前补一行，让客户抽屉时间线同样生效：

```js
    const activity = state.data.activities.find(row => String(row.id) === String(activityId));
    if (activity) {
      event.outcome = event.outcome ?? activity.outcome ?? activity.reactionSnapshot ?? '';
      event.manager_required = event.manager_required ?? Number(activity.managerRequired || 0);
    }
```

- [ ] **Step 5: 运行测试**

Run: `node --test test/issue291_progress_modal_ui.test.js test/issue230_timeline_chinese.test.js`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js test/issue291_progress_modal_ui.test.js
git commit -m "fix: render truthful Chinese timeline for plan and assistance states"
```

### Task 7: 链路 A 三角色回归

**Files:**
- Modify: 无（仅验证；如失败则修复对应实现）
- Test: `test/issue291_manager_assistance_loop.test.js`（已有）+ 现有测试

**Interfaces:** 无新增。

- [ ] **Step 1: 跑链路 A 全部相关测试**

```bash
node --test test/issue291_manager_assistance_loop.test.js test/issue291_plan_only.test.js test/issue291_progress_modal_ui.test.js test/issue149_progress_backend.test.js test/issue149_progress_ui.test.js test/issue149_reaction_options.test.js test/issue157_today_task_actions.test.js test/issue157_today_task_ui.test.js test/issue170_manager_api.test.js test/issue170_manager_tasks.test.js test/issue170_deferred_plan_state.test.js test/issue170_deferred_plan_ui.test.js test/issue243_no_plan_streak.test.js test/issue257_manager_assistance_task.test.js test/issue257_today_task_visibility.test.js test/issue257_profile_plan_separation.test.js test/issue230_timeline_chinese.test.js test/today_tasks.test.js test/today_tasks_integration.test.js
```

Expected: PASS。任何断言仍按旧闭环（经理完成即任务 completed / `manager_status='已完成'`）的测试，一律改成两步口径：主管回复后 task 仍 open、`manager_status='已回复'`；销售确认计划后 completed、`已完成`。

- [ ] **Step 2: 三角色手工验收（自动化之外的证据）**

- 销售：从「缺少下一步计划」待办进入，弹窗默认「只更新下一步计划」；保存后时间线没有“发送邮件”。
- 销售：选择「暂无计划」并填原因；时间线出现「暂无计划」。
- 销售：选择「请求主管协助」并填原因；自己今日待办不出现 MANAGER_NEEDED。
- 主管：今日待办「需要管理者介入」展示客户/申请人/期限/申请原因/原计划/联系人；点击后填写意见并「回复销售并完成主管任务」。
- 销售：今日待办出现「主管已回复，待销售确认并制定下一步计划」；保存计划后该待办消失，主管任务变为已完成。

- [ ] **Step 3: Commit（仅当回归产生修复）**

```bash
git add -A
git commit -m "test: cover unresolved workflow regression paths"
```

---

## Phase B：权限配置与权限面板

### Task 8: 权限显示名对齐菜单 + 新增 view_notifications（兼容迁移）

**Files:**
- Modify: `lib/access_control.js`（`PERMISSION_DEFINITIONS`、`ROLE_PERMISSIONS`）
- Modify: `lib/sales_crm.js`（新增 `ensureNotificationPermissionDefaults(value)`，挂到 `installSalesCrm`；bootstrap 的 notifications 与 `notificationNavigationSummary` 权限门改为 `view_notifications`，约 7098-7110）
- Modify: `sales-crm.html`（通知中心两处 `data-permission="view_customers"` 改 `view_notifications`：第 51、97 行）
- Update: 断言旧标签的既有测试（见 Step 4 清单）
- Test: `test/issue291_permission_labels.test.js`

**Interfaces:**
- Consumes: `PERMISSION_DEFINITIONS` 被 bootstrap 直接返回为 `permissionDefinitions`；权限 key 是权限校验的唯一依据。
- Produces: 新权限 key `view_notifications`（三角色默认 `true`）；显示名与左侧菜单一致；旧 key 全部保留。

显示名映射（key 不变，仅改 value）：

| key | 新显示名 | 旧显示名 |
| --- | --- | --- |
| view_dashboard | 经营驾驶舱 | 不变 |
| view_alerts | 今日待办 | 不变 |
| view_notifications | 通知中心 | （新增） |
| view_intake | 线索池 | 未开发线索分配 |
| view_contacts | 客户联系人线索 | 查看客户联系人线索 |
| view_recon | Recon 情报 | Recon情报 |
| view_customers | CRM 客户全景 | CRM客户全景 |
| view_own_mismatch_history | 不对口记录 | 查看本人不对口记录 |
| view_pipeline | 推进管道 | 不变 |
| resolve_manager_tasks | 主管介入任务 | 处理主管任务 |
| view_team | 团队状态 | 不变 |
| view_insights | 经理评价 | 不变 |
| view_users | 用户与权限 | 不变 |
| manage_protected_customers | 客户保护与查重 | 管理合作客户保护 |

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_permission_labels.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

test('bootstrap exposes menu-aligned permission labels and notification permission', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const body = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: fx.adminCookie });
  const definitions = body.permissionDefinitions;
  assert.equal(definitions.view_notifications, '通知中心');
  assert.equal(definitions.view_intake, '线索池');
  assert.equal(definitions.view_contacts, '客户联系人线索');
  assert.equal(definitions.view_recon, 'Recon 情报');
  assert.equal(definitions.view_customers, 'CRM 客户全景');
  assert.equal(definitions.view_own_mismatch_history, '不对口记录');
  assert.equal(definitions.resolve_manager_tasks, '主管介入任务');
  assert.equal(definitions.manage_protected_customers, '客户保护与查重');
  // 旧 key 不丢失
  for (const key of ['view_dashboard', 'view_alerts', 'view_customers', 'resolve_manager_tasks']) {
    assert.ok(definitions[key]);
  }
  // 默认授予，历史用户不丢通知权限
  for (const role of ['admin', 'manager', 'sales']) {
    assert.equal(body.rolePermissions[role].view_notifications, true);
  }
});

test('existing permission groups gain view_notifications without touching other values', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  const group = fx.db.prepare('SELECT permissions_json FROM permission_groups LIMIT 1').get();
  const permissions = JSON.parse(group.permissions_json);
  assert.equal(permissions.view_notifications, true);
});

test('notification gate is enforced server-side', async t => {
  const fx = await fixtures.adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-WU', { view_notifications: false });
  const salesCookie = await fx.login('wu@example.com', 'Password123!');
  const body = await fx.requestJson('/api/sales-crm/bootstrap', { cookie: salesCookie });
  assert.deepEqual(body.notifications, []);
  const summary = body.navigationCounts;
  assert.equal(summary.notificationsUnread, 0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_permission_labels.test.js`

Expected: FAIL。

- [ ] **Step 3: 定义与角色默认**

`lib/access_control.js:1` 的 `PERMISSION_DEFINITIONS` 按上表改值，并在 `view_alerts` 后插入：

```js
  view_notifications: '通知中心',
```

`ROLE_PERMISSIONS` 三处（admin 全量自动覆盖；manager/sales 显式列表）加 `view_notifications: true,`。

- [ ] **Step 4: 权限组与用户存量迁移**

`lib/sales_crm.js` 的 `ensureUserPermissionColumns`（1934 行）内或紧邻处新增并调用：

```js
function ensureNotificationPermissionDefaults(value) {
  for (const table of ['permission_groups', 'sales_users']) {
    if (!hasTable(value, table)) continue;
    const rows = value.prepare(`SELECT id,permissions_json FROM ${table}
      WHERE TRIM(COALESCE(permissions_json,''))!=''`).all();
    for (const row of rows) {
      let permissions;
      try { permissions = JSON.parse(row.permissions_json || '{}'); } catch { continue; }
      if (permissions && typeof permissions === 'object'
          && !Object.prototype.hasOwnProperty.call(permissions, 'view_notifications')) {
        permissions.view_notifications = true;
        value.prepare(`UPDATE ${table} SET permissions_json=?,updated_at=? WHERE id=?`)
          .run(JSON.stringify(permissions), nowText(), row.id);
      }
    }
  }
}
```

`installSalesCrm` 内 `ensureUserPermissionColumns(value)` 之后调用 `ensureNotificationPermissionDefaults(value);`。

- [ ] **Step 5: 前端与 bootstrap 门**

- `sales-crm.html:51` 与 `:97` 的通知中心按钮：`data-permission="view_customers"` → `data-permission="view_notifications"`。
- `sales-assets/app.js` 的 `viewPermissions` 映射（约 271-278 行）：`notifications: 'view_customers'` → `notifications: 'view_notifications'`。
- `lib/sales_crm.js` bootstrap 内 `notificationNavigationSummary` 的 `permissions.view_customers ? ... : ...` 改 `permissions.view_notifications ? ...`。
- 找到 payload 里 `notifications: contactSafe(notifications),`，改为 `notifications: permissions.view_notifications ? contactSafe(notifications) : [],`。

- [ ] **Step 6: 更新断言旧标签的测试**

`rg -n "未开发线索分配|查看客户联系人线索|Recon情报|CRM客户全景|查看本人不对口记录|处理主管任务|管理合作客户保护" test/`，把出现旧文案的断言改成新文案；任何发送「完整个人权限图」的测试（issue148、issue229、permission_groups、permission_integration）补 `view_notifications: true`。

- [ ] **Step 7: 运行测试**

Run: `node --test test/issue291_permission_labels.test.js test/issue148_binary_permissions.test.js test/issue229_permission_modal.test.js test/permission_groups.test.js test/permission_integration.test.js test/sales_menu.test.js test/access_control.test.js`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add lib/access_control.js lib/sales_crm.js sales-crm.html test/issue291_permission_labels.test.js test/issue148_binary_permissions.test.js test/issue229_permission_modal.test.js
git commit -m "fix: align permission labels with CRM menu and add notification permission"
```

### Task 9: 个人权限面板三分类 + 2-3 列开关 + 恢复默认二次确认

**Files:**
- Modify: `sales-assets/app.js`（新增 `PERMISSION_CATEGORIES`；重写 `personalPermissionFields`、`permissionFields`、`openOverridesModal`、`openUserModal` 的权限段、`openPermissionGroupModal` 的权限段；把 `#restoreUserPermissions` 的 `window.confirm` 换成自绘确认弹窗）
- Modify: `sales-assets/app.css`（`.permission-category-tabs`、`.permission-switch-grid`）
- Test: `test/issue291_permission_modal_ui.test.js`

**Interfaces:**
- Consumes: `state.data.permissionDefinitions`、`state.data.permissionDescriptions`、`visiblePermissionDefinitions()`；保存仍走 `PUT /api/sales-crm/users/:id/permission-overrides`，字段名保持 `personalPermission__<key>`。
- Produces: 三分类按钮文案 `模块访问` / `客户数据与操作` / `管理与审计`；恢复确认弹窗文案与预览一致。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_permission_modal_ui.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('permission editor renders three categories with switches', () => {
  const editor = section(app, 'const PERMISSION_CATEGORIES', 'function personalPermissionFields');
  assert.match(editor, /模块访问/);
  assert.match(editor, /客户数据与操作/);
  assert.match(editor, /管理与审计/);
  const fields = section(app, 'function personalPermissionFields', 'function renderPersonalPermissionEditor');
  assert.match(fields, /role="switch"/);
  assert.match(fields, /data-permission-category/);
});

test('restore default uses an explicit confirm dialog with the required copy', () => {
  assert.match(app, /恢复权限组默认\?/);
  assert.match(app, /将清除[^<]*的个人权限例外，之后自动跟随/);
  assert.match(app, /权限组本身不会改变/);
  assert.match(app, /确认恢复/);
  assert.doesNotMatch(app, /window\.confirm\('恢复权限组默认/);
});

test('permission switch grid is compact two to three columns', () => {
  assert.match(css, /\.permission-switch-grid/);
  assert.match(css, /repeat\(/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_permission_modal_ui.test.js`

Expected: FAIL。

- [ ] **Step 3: 分类常量与渲染**

在 `personalPermissionFields`（9363 行）之前新增：

```js
  const PERMISSION_CATEGORIES = Object.freeze([
    Object.freeze({
      key: 'module', label: '模块访问', permissions: Object.freeze([
        'view_dashboard', 'view_alerts', 'view_notifications', 'view_intake',
        'view_contacts', 'view_recon', 'view_customers', 'view_own_mismatch_history',
        'view_pipeline', 'resolve_manager_tasks', 'view_team', 'view_insights',
        'view_development', 'view_pool', 'view_markets',
      ]),
    }),
    Object.freeze({
      key: 'customer', label: '客户数据与操作', permissions: Object.freeze([
        'view_all_customers', 'manage_intake', 'manage_customer_recycle',
        'reject_own_customer_mismatch', 'manage_manual_customer_deletion',
        'manage_customer_contacts', 'create_customer', 'edit_customer',
        'record_activity', 'correct_own_activity', 'manage_activity_corrections',
        'record_collaboration_support', 'record_quote', 'record_order',
      ]),
    }),
    Object.freeze({
      key: 'admin', label: '管理与审计', permissions: Object.freeze([
        'view_users', 'manage_evaluations', 'run_recon', 'use_prospect_agent',
        'use_ai_assistant', 'cancel_ai_tasks', 'bulk_manage_ai_tasks',
        'manage_ai_budgets', 'review_ai_tasks', 'manage_users',
        'manage_data_maintenance', 'manage_protected_customers',
        'manage_manager_task_settings', 'export_data',
      ]),
    }),
  ]);

  function permissionCategoryMarkup(permissions = {}, groupPermissions = {}, active = 'module') {
    const definitions = visiblePermissionDefinitions();
    const descriptions = state.data.permissionDescriptions || {};
    const tabs = PERMISSION_CATEGORIES.map(category => `<button class="${category.key === active ? 'active' : ''}"
      type="button" role="tab" aria-selected="${category.key === active}"
      data-permission-category="${category.key}">${category.label}</button>`).join('');
    const panels = PERMISSION_CATEGORIES.map(category => `<section class="permission-switch-panel ${category.key === active ? '' : 'hidden'}"
      data-permission-panel="${category.key}">
      <div class="permission-switch-grid">${category.permissions.map(key => {
        const allowed = Boolean(permissions[key]);
        const followsGroup = allowed === Boolean(groupPermissions[key]);
        const label = definitions[key];
        if (!label) return '';
        const description = descriptions[key] || '';
        return `<label class="permission-override-row permission-switch-row">
          <span class="permission-switch-label"><strong>${esc(label)}</strong><small>${description ? `${esc(description)} · ` : ''}${followsGroup ? '跟随权限组' : '个人调整'}</small></span>
          <input type="checkbox" role="switch" name="personalPermission__${esc(key)}" ${allowed ? 'checked' : ''} aria-label="${esc(label)}">
        </label>`;
      }).join('')}</div>
    </section>`).join('');
    return `<div class="permission-category-tabs" role="tablist" aria-label="权限分类">${tabs}</div>${panels}`;
  }
```

把 `personalPermissionFields` 重写为：

```js
  function personalPermissionFields(permissions = {}, groupPermissions = {}) {
    return permissionCategoryMarkup(permissions, groupPermissions, 'module');
  }
```

把 `permissionFields`（9397 行，权限组编辑器）重写为同样结构但 name 前缀 `permission__`：

```js
  function permissionFields(permissions = {}) {
    const definitions = visiblePermissionDefinitions();
    const descriptions = state.data.permissionDescriptions || {};
    const tabs = PERMISSION_CATEGORIES.map(category => `<button class="${category.key === 'module' ? 'active' : ''}"
      type="button" role="tab" aria-selected="${category.key === 'module'}"
      data-permission-category="${category.key}">${category.label}</button>`).join('');
    const panels = PERMISSION_CATEGORIES.map(category => `<section class="permission-switch-panel ${category.key === 'module' ? '' : 'hidden'}"
      data-permission-panel="${category.key}">
      <div class="permission-switch-grid">${category.permissions.map(key => {
        const label = definitions[key];
        if (!label) return '';
        return `<label class="permission-check permission-switch-row">
          <input type="checkbox" role="switch" name="permission__${esc(key)}" ${permissions[key] ? 'checked' : ''} aria-label="${esc(label)}"><span>${esc(label)}${descriptions[key] ? `<small>${esc(descriptions[key])}</small>` : ''}</span>
        </label>`;
      }).join('')}</div>
    </section>`).join('');
    return `<div class="permission-category-tabs" role="tablist" aria-label="权限分类">${tabs}</div>${panels}`;
  }
```

`openOverridesModal`（9445 行）推荐文案改为「开关开启表示允许、关闭表示拒绝；与权限组相同的开关会自动跟随权限组。」，底部按钮保持「取消」「保存个人权限」。

- [ ] **Step 4: 分类切换事件**

click 分发里加：

```js
    const categoryButton = event.target.closest('[data-permission-category]');
    if (categoryButton) {
      const form = categoryButton.closest('form');
      $$('#modal [data-permission-category]').forEach(button => {
        const selected = button === categoryButton;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      $$('#modal [data-permission-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.permissionPanel !== categoryButton.dataset.permissionCategory);
      });
      return;
    }
```

- [ ] **Step 5: 恢复默认自绘确认弹窗**

把 `#restoreUserPermissions` 的 click 处理（10694 行）改为：

```js
    if (event.target.closest('#restoreUserPermissions')) {
      const form = document.querySelector('#permissionOverrideForm');
      const userId = form?.elements?.userId?.value || '';
      if (!userId) return;
      const user = state.data.users.find(item => item.id === userId);
      if (!user) return;
      openModal('恢复权限组默认？', 'PERMISSION RESTORE', `<form id="restorePermissionsForm" class="form-grid">
        <input type="hidden" name="userId" value="${esc(user.id)}">
        <p class="recommendation">将清除${esc(user.name)}的个人权限例外，之后自动跟随“${esc(user.permissionGroupName || '当前权限组')}”权限组。权限组本身不会改变。</p>
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button type="button" class="button primary" id="confirmRestorePermissions">确认恢复</button></div>
      </form>`);
      return;
    }
    if (event.target.closest('#confirmRestorePermissions')) {
      const form = document.querySelector('#restorePermissionsForm');
      const userId = form?.elements?.userId?.value || '';
      if (!userId) return;
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/permission-overrides`, {
          method: 'PUT',
          body: JSON.stringify({ restoreDefault: true }),
        });
        closeModal();
        await refresh('已恢复权限组默认');
      } catch (error) { toast(error.message); }
      return;
    }
```

- [ ] **Step 6: CSS**

`sales-assets/app.css` 追加：

```css
.permission-category-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.permission-category-tabs button { padding: 8px 12px; border-radius: 8px; }
.permission-category-tabs button.active { color: #fff; background: var(--accent, #2563eb); }
.permission-switch-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px;
}
@media (min-width: 900px) { .permission-switch-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.permission-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.permission-switch-row input[type="checkbox"] { appearance: auto; }
```

- [ ] **Step 7: 运行测试**

Run: `node --test test/issue291_permission_modal_ui.test.js test/issue148_binary_permissions.test.js test/issue229_permission_modal.test.js`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add sales-assets/app.js sales-assets/app.css test/issue291_permission_modal_ui.test.js
git commit -m "fix: three-category switch permission panel with explicit restore confirm"
```

### Task 10: 权限链路服务端回归

**Files:**
- Modify: 无（失败则修）
- Test: 现有 + `test/issue291_permission_labels.test.js`

- [ ] **Step 1: 越权直连回归**

```bash
node --test test/access_control.test.js test/access_governance.test.js test/issue148_binary_permissions.test.js test/issue170_manager_permissions.test.js test/issue174_team_status_permissions.test.js test/permission_groups.test.js test/permission_integration.test.js test/impersonation_authorization.test.js test/issue207_impersonation_business_actions.test.js test/issue291_permission_labels.test.js
```

Expected: PASS。重点确认：无 `view_users/manage_users` 直连用户与权限接口返回 403；无 `view_notifications` 时 bootstrap 通知为空；权限组名称/显示名调整后用户权限 key 不变。

- [ ] **Step 2: Commit（仅当有修复）**

```bash
git add -A && git commit -m "test: permission panel server-side regression"
```

---

## Phase C：线索核验、退回历史与昵称

### Task 11: 查重第三条处置「信息不足，要求补充」+ 补资料后重开核验

**Files:**
- Modify: `lib/sales_crm.js`（新增 `ensureDuplicateReviewNeedsInfoStatus` 迁移；`resolveDuplicateReview`、`resolveDuplicateReviewRow`、`listDuplicateReviews`；`updateCustomerMaster` 重开核验）
- Modify: `sales-assets/app.js`（重复核验卡片第三按钮 + note 弹窗 + 状态筛选）
- Test: `test/issue291_duplicate_needs_info.test.js`

**Interfaces:**
- Consumes: `crm_duplicate_reviews.status` 迁移后允许 `needs_info`；`crm_intake_items.duplicate_review_id`；`updateCustomerMaster` 的 `customerId` 是 `customer_pool.customer_id`（外部编号）。
- Produces: `POST /api/sales-crm/duplicate-reviews/:id/resolve` 支持 `{ resolution:'needs_info', note }`；管理员补资料（`PATCH /api/sales-crm/master/:customerId`）后 review 自动回到 `pending`。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_duplicate_needs_info.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { adminFixture } = require('./helpers/permission_fixture');

function seedReview(fx, id = 'REV-NEEDS-1') {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,created_at,updated_at)
    VALUES (?, 'intake_item','INTAKE-OTHER','fingerprint','U-OTHER',?,?,'pending',?,?)`).run(
    id,
    JSON.stringify({ companyName: 'Eltron Group', website: 'https://eltron-group.ru' }),
    JSON.stringify([{ customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'Eltron', matchedBy: 'fuzzy_domain', score: 0.75 }]),
    at, at,
  );
  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',duplicate_review_id=?,decision_reason='资料已提交管理层核验'
    WHERE id='INTAKE-OTHER'`).run(id);
}

test('admin can ask for more information and the intake stays blocked with the review open', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx);
  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-NEEDS-1/resolve', {
    cookie: fx.adminCookie,
    method: 'POST',
    body: { resolution: 'needs_info', note: '请补充采购负责人姓名与官网备案信息' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const review = fx.db.prepare("SELECT * FROM crm_duplicate_reviews WHERE id='REV-NEEDS-1'").get();
  assert.equal(review.status, 'needs_info');
  const intake = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='INTAKE-OTHER'").get();
  assert.equal(intake.duplicate_state, 'review');
  assert.equal(intake.decision_reason, '管理员要求补充资料后再判断');
});

test('needs_info without a note is rejected', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx, 'REV-NEEDS-2');
  const response = await fx.request('/api/sales-crm/duplicate-reviews/REV-NEEDS-2/resolve', {
    cookie: fx.adminCookie, method: 'POST', body: { resolution: 'needs_info', note: '  ' },
  });
  assert.equal(response.status, 400);
});

test('updating the customer master reopens a needs_info review', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedReview(fx, 'REV-NEEDS-3');
  fx.db.prepare("INSERT INTO customer_pool(customer_id,company_name) VALUES ('BR-9004','Intake Other')").run();
  fx.db.prepare("UPDATE crm_duplicate_reviews SET status='needs_info',resolution_note='补充资料',reviewed_by='USR-ADMIN',reviewed_at='2026-08-13 09:00:00' WHERE id='REV-NEEDS-3'").run();
  const response = await fx.request('/api/sales-crm/master/BR-9004', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { description: '补充后的企业简介' },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const review = fx.db.prepare("SELECT * FROM crm_duplicate_reviews WHERE id='REV-NEEDS-3'").get();
  assert.equal(review.status, 'pending');
  const intake = fx.db.prepare("SELECT * FROM crm_intake_items WHERE id='INTAKE-OTHER'").get();
  assert.equal(intake.decision_reason, '资料已更新，重新进入管理层核验');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_duplicate_needs_info.test.js`

Expected: FAIL —— `needs_info` 不在 CHECK 约束里 / resolve 拒绝该值。

- [ ] **Step 3: 表迁移**

`lib/sales_crm.js` 新增：

```js
function ensureDuplicateReviewNeedsInfoStatus(value) {
  const tableSql = value.prepare(`SELECT sql FROM sqlite_master
    WHERE type='table' AND name='crm_duplicate_reviews'`).get()?.sql || '';
  if (!tableSql || tableSql.includes('needs_info')) return;
  const foreignKeysEnabled = Number(value.pragma('foreign_keys', { simple: true })) === 1;
  value.pragma('foreign_keys = OFF');
  try {
    value.transaction(() => {
      value.exec(tableSql
        .replace(
          "CHECK(status IN ('pending','confirmed_same','confirmed_distinct'))",
          "CHECK(status IN ('pending','confirmed_same','confirmed_distinct','needs_info'))",
        )
        .replace(/crm_duplicate_reviews(?=[\s(])/g, 'crm_duplicate_reviews_v291')
        .replace('CREATE TABLE', 'CREATE TABLE')
      );
      value.exec('INSERT INTO crm_duplicate_reviews_v291 SELECT * FROM crm_duplicate_reviews');
      value.exec('DROP TABLE crm_duplicate_reviews');
      value.exec('ALTER TABLE crm_duplicate_reviews_v291 RENAME TO crm_duplicate_reviews');
      value.exec(`CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_status_idx
        ON crm_duplicate_reviews(status,created_at DESC);
        CREATE INDEX IF NOT EXISTS crm_duplicate_reviews_target_idx
        ON crm_duplicate_reviews(target_type,target_id)`);
    })();
  } finally {
    value.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
  }
}
```

在 `installSalesCrm` 的 `ensureDuplicateReviewColumns(value)` 之后调用 `ensureDuplicateReviewNeedsInfoStatus(value);`。

- [ ] **Step 4: resolve 逻辑**

`resolveDuplicateReview`（8611 行）校验改为：

```js
  if (!['confirmed_same', 'confirmed_distinct', 'needs_info'].includes(resolution)) {
    throw badRequest('请选择“确认同一客户”“确认不是同一客户”或“信息不足，要求补充”');
  }
  if (resolution === 'needs_info' && !String(payload.note || '').trim()) {
    throw badRequest('信息不足时必须填写需要补充的内容');
  }
```

`resolveDuplicateReviewRow` 的 `row.target_type === 'intake_item'` 分支改为三分支：

```js
    const intakeUpdate = resolution === 'confirmed_same'
      ? value.prepare(`UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,
          duplicate_state='exact',assigned_owner_id='',suggested_owner_id='',
          decision_reason='管理层已确认为同一客户',updated_at=?
        WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
        .run(selected.crmAccountId || '', at, row.target_id, row.id)
      : resolution === 'needs_info'
        ? value.prepare(`UPDATE crm_intake_items SET decision_reason='管理员要求补充资料后再判断',updated_at=?
          WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
          .run(at, row.target_id, row.id)
        : value.prepare(`UPDATE crm_intake_items SET status='approved',duplicate_state='cleared',
          assigned_owner_id='',suggested_owner_id='',decision_reason='查重核验已放行',updated_at=?
        WHERE id=? AND duplicate_review_id=? AND duplicate_state='review'`)
          .run(at, row.target_id, row.id);
```

`listDuplicateReviews` 状态白名单（8483 行）改为 `['pending', 'confirmed_same', 'confirmed_distinct', 'needs_info', 'all']`。

- [ ] **Step 5: 补资料后重开**

`updateCustomerMaster`（9275 行）在事务内 `UPDATE customer_pool` 之后追加：

```js
      const reopened = value.prepare(`UPDATE crm_duplicate_reviews
        SET status='pending',resolution_note='',reviewed_by='',reviewed_at='',
          resolution_source='',updated_at=?
        WHERE status='needs_info' AND id IN (
          SELECT duplicate_review_id FROM crm_intake_items
          WHERE external_customer_id=? AND TRIM(duplicate_review_id)!=''
        )`).run(updatedAt, cleanId);
      if (reopened.changes) {
        value.prepare(`UPDATE crm_intake_items SET decision_reason='资料已更新，重新进入管理层核验',updated_at=?
          WHERE external_customer_id=? AND duplicate_state='review'`).run(updatedAt, cleanId);
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.effectiveUserId || user.id, 'duplicate_review_reopened',
          'customer_master', cleanId, JSON.stringify({ reopenedCount: reopened.changes }),
          updatedAt, identity.realUserId || user.id, identity.effectiveUserId || user.id,
          identity.contextId || '',
        );
      }
```

- [ ] **Step 6: 前端第三动作**

`sales-assets/app.js` 的 duplicate review 卡片 footer（6275 行）加：

```js
          <button class="button secondary" type="button" data-duplicate-resolution="needs_info" data-review-id="${esc(review.id)}" ${interactionPending || protectedExact ? 'disabled' : ''}>信息不足，要求补充</button>
```

新增 note 弹窗与提交：

```js
  function openDuplicateNeedsInfoModal(reviewId) {
    openModal('信息不足，要求补充', 'DUPLICATE REVIEW', `<form id="duplicateNeedsInfoForm" class="form-grid">
      <input type="hidden" name="reviewId" value="${esc(reviewId)}">
      <label class="span-2">需要补充的内容<textarea name="note" rows="3" maxlength="500" required placeholder="例如：请补充采购负责人姓名与官网备案信息"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">确认要求补充</button></div>
    </form>`);
  }
```

click 分发：`data-duplicate-resolution="needs_info"` → `openDuplicateNeedsInfoModal(reviewId)`；submit 分支 `form.id === 'duplicateNeedsInfoForm'` → `POST /api/sales-crm/duplicate-reviews/:id/resolve`，成功后 `await reloadDuplicateReviewsAfterMutation()`。

- [ ] **Step 7: 运行测试**

Run: `node --test test/issue291_duplicate_needs_info.test.js test/issue208_duplicate_review_api.test.js test/issue208_duplicate_review_ui.test.js test/issue262_stale_duplicate_review_upgrade.test.js test/issue158_duplicate_protection.test.js`

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js test/issue291_duplicate_needs_info.test.js
git commit -m "fix: add needs-info duplicate action with reopen on supplement"
```

### Task 12: 销售端模糊提示 + 零泄露（只显示「该客户需要管理员确认，确认后可继续领取。」）

**Files:**
- Modify: `lib/sales_crm.js`（`loadIntakeState` scoped 分支与 countScope；`addAccount` 返回 message）
- Modify: `sales-assets/app.js`（线索列表与抽屉渲染 `reviewVagueHint`）
- Update: 断言「资料已提交管理层核验」文案的测试（issue158/issue208 等）
- Test: `test/issue291_sales_review_hint.test.js`

**Interfaces:**
- Consumes: `crm_duplicate_reviews.submitted_by` 是提交人；`crm_intake_items.duplicate_review_id`。
- Produces: 销售视角 `item.reviewVagueHint = '该客户需要管理员确认，确认后可继续领取。'`；销售拿不到 `candidates_json`、`decision_reason`、`suggested_owner_id`（现有 delete 逻辑保留）。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_sales_review_hint.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function seedSubmittedReview(fx) {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`UPDATE crm_intake_items SET duplicate_state='review',
    duplicate_review_id='REV-HINT',decision_reason='资料已提交管理层核验',status='pending'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_duplicate_reviews
    (id,target_type,target_id,fingerprint,submitted_by,input_json,candidates_json,status,created_at,updated_at)
    VALUES ('REV-HINT','intake_item','INTAKE-OTHER','fp','U-OTHER',?,?, 'pending',?,?)`).run(
    JSON.stringify({ companyName: 'Intake Other', website: 'https://other.example' }),
    JSON.stringify([{ customerId: 'RU-9002', crmAccountId: 'CRM-OWN', companyName: 'Owned Fixture', matchedBy: 'fuzzy_name', score: 0.81 }]),
    at, at,
  );
}

test('sales sees their submitted review item with only the vague hint', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSubmittedReview(fx);
  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  const item = body.items.find(row => row.id === 'INTAKE-OTHER');
  assert.ok(item, 'expected the sales submitted review item to be visible');
  assert.equal(item.reviewVagueHint, '该客户需要管理员确认，确认后可继续领取。');
  assert.equal(item.assignable, false);
  assert.equal(item.decision_reason, undefined);
  assert.equal(item.suggested_owner_id, undefined);
  assert.ok(!JSON.stringify(item).includes('Owned Fixture'));
  assert.ok(!JSON.stringify(item).includes('0.81'));
});

test('sales does not see other pending review items', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedSubmittedReview(fx);
  fx.db.prepare(`UPDATE crm_duplicate_reviews SET submitted_by='U-MGR' WHERE id='REV-HINT'`).run();
  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.ok(!body.items.some(row => row.id === 'INTAKE-OTHER'));
});

test('creating a customer that enters review returns the vague message to sales', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { create_customer: true });
  fx.db.prepare("UPDATE crm_accounts SET company_name='Eltron' WHERE id='CRM-OWN'").run();
  const response = await fx.request('/api/sales-crm/accounts', {
    cookie: fx.otherCookie,
    method: 'POST',
    body: { companyName: 'Eltron', website: 'https://eltron-group.ru' },
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.message, '该客户需要管理员确认，确认后可继续领取。');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_sales_review_hint.test.js`

Expected: FAIL。

- [ ] **Step 3: 后端 scope 与提示**

`loadIntakeState`（3674 行）scoped 分支：

```js
  if (scoped) {
    filters.push(`(i.status='assigned' OR (
      i.duplicate_state='review' AND i.duplicate_review_id IN (
        SELECT id FROM crm_duplicate_reviews WHERE submitted_by=?
      )
    ))`);
    params.push(user.id);
  } else {
    filters.push("i.status IN ('pending','approved','assigned','returned')");
  }
```

`countScope` 处同样处理：`buildIntakeQueryScope(user, query, { includeStatus: false })` 之后，若 `scoped`，追加同一子句并 `countScope.params.push(user.id)`。

在 `for (const item of items)` 循环的 `if (!canViewAssignmentDecisions)` 分支里，`continue` 之前加：

```js
    item.reviewVagueHint = item.duplicate_state === 'review'
      ? '该客户需要管理员确认，确认后可继续领取。'
      : '';
```

`addAccount` 里销售提交进入 review 的返回（8940 行）message 改为 `'该客户需要管理员确认，确认后可继续领取。'`。同时注册路由处（约 11499 行）的销售侧覆盖也要同步：

```js
      const publicResult = result.reviewRequired && req.salesUser.role === 'sales'
        ? { accepted: true, message: '该客户需要管理员确认，确认后可继续领取。' }
        : result;
```

- [ ] **Step 4: 前端渲染**

`renderIntakeTable` 的 assignment-cell（2588 行）在 `statusMarkup` 后追加：

```js
${item.reviewVagueHint ? `<span class="pill amber">${esc(item.reviewVagueHint)}</span>` : ''}
```

`openIntakeProfile` 的 `next-step` 提示（7297 行）在 status pill 前追加：

```js
      ${item.reviewVagueHint ? `<div class="next-step"><span class="pill amber">${esc(item.reviewVagueHint)}</span></div>` : ''}
```

- [ ] **Step 5: 运行测试**

Run: `node --test test/issue291_sales_review_hint.test.js test/issue158_duplicate_protection.test.js test/issue208_duplicate_review_api.test.js test/issue184_lead_identity_warning.test.js test/issue212_lead_pool_backend.test.js`

Expected: PASS；旧断言里 `资料已提交管理层核验` 若指销售侧返回文案，改为新文案。

- [ ] **Step 6: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js test/issue291_sales_review_hint.test.js
git commit -m "fix: show vague review hint to sales without leaking candidates"
```

### Task 13: 退回线索只读「查看开发历史」侧栏

**Files:**
- Modify: `lib/sales_crm.js`（新增 `getHistoryAccountForUser`；`GET /api/sales-crm/accounts/:customerId/history` 返回 account 摘要）
- Modify: `sales-assets/app.js`（退回线索行按钮 + `openReturnedHistoryModal`）
- Modify: `sales-assets/app.css`（历史侧栏）
- Test: `test/issue291_returned_history.test.js`

**Interfaces:**
- Consumes: `buildAccountHistory(value, account)`；`crm_accounts.previous_owner_id`、`lifecycle_status='recycled'`。
- Produces: `GET /api/sales-crm/accounts/:customerId/history` → `{ ok:true, timeline, account:{ companyName, nickname, externalCustomerId, country, stageLabel, status } }`；销售只读本人相关退回客户，主管/管理员按既有数据范围。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_returned_history.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/permission_fixture');

function seedReturned(fx) {
  const at = '2026-08-13 08:00:00';
  fx.db.prepare(`UPDATE crm_accounts SET owner_id=NULL,previous_owner_id='U-OTHER',
    assignment_status='returned',lifecycle_status='recycled',return_reason='暂时不跟进'
    WHERE id='CRM-OTHER'`).run();
  fx.db.prepare(`UPDATE crm_intake_items SET status='returned',crm_customer_id='CRM-OTHER'
    WHERE id='INTAKE-OTHER'`).run();
  fx.db.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,outcome,summary,stage_before,stage_after,
     occurred_at,created_at)
    VALUES ('ACT-R1','CRM-OTHER','U-OTHER','email','暂无回复','发了开发信，客户暂无回复',
      'qualified','contacted',?,?)`).run(at, at);
}

test('returning sales reads own returned history without reassigning', async t => {
  const fx = await fixtures.seededFixture({ permissions: { record_activity: true } });
  t.after(() => fx.close());
  seedReturned(fx);
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER/history', {
    cookie: fx.otherCookie,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.account.status, '已退回线索池');
  assert.ok(body.timeline.some(event => event.kind === 'activity' && event.summary.includes('暂无回复')));
  assert.ok(!body.timeline.some(event => event.kind === 'reassign' || event.kind === 'restore'));
});

test('a manager without team scope cannot read the returned history', async t => {
  const fx = await fixtures.seededFixture({ managerViewAll: false, permissions: { record_activity: true } });
  t.after(() => fx.close());
  seedReturned(fx);
  // fx.cookie 是 U-MGR（view_all_customers=false），不是该退回客户的负责人
  const response = await fx.request('/api/sales-crm/accounts/CRM-OTHER/history', {
    cookie: fx.cookie,
  });
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_returned_history.test.js`

Expected: FAIL —— 销售读已退回客户 403。

- [ ] **Step 3: 只读历史 scope**

`lib/sales_crm.js` 新增：

```js
function getHistoryAccountForUser(value, user, customerId) {
  if (hasPermission(user, 'view_all_customers') && hasPermission(user, 'manage_intake')) {
    return value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(customerId);
  }
  return value.prepare(`SELECT * FROM crm_accounts WHERE id=? AND (
    owner_id=?
    OR (COALESCE(lifecycle_status,'active')='recycled' AND previous_owner_id=?)
  )`).get(customerId, user.id, user.id);
}

function historyAccountSummary(account) {
  return {
    companyName: String(account.company_name || '').trim(),
    nickname: String(account.nickname || '').trim(),
    externalCustomerId: String(account.external_customer_id || ''),
    country: String(account.country || ''),
    stageLabel: STAGE_LABELS[account.stage] || account.stage || '',
    status: account.assignment_status === 'returned'
      ? '已退回线索池'
      : account.lifecycle_status === 'recycled' ? '历史客户' : 'CRM 客户',
  };
}
```

`GET /api/sales-crm/accounts/:customerId/history`（11575 行）改为：

```js
  app.get('/api/sales-crm/accounts/:customerId/history', (req, res) => {
    const value = db();
    try {
      const account = getHistoryAccountForUser(value, req.salesUser, req.params.customerId);
      if (!account) throw inaccessibleOrMissing(req.salesUser, '客户不存在');
      res.json({
        ok: true,
        timeline: buildAccountHistory(value, account),
        account: historyAccountSummary(account),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });
```

- [ ] **Step 4: 前端按钮与只读侧栏**

`renderIntakeTable` 的 actions 计算（2559 行附近），在赋值之前加：

```js
        const returnedHistoryAction = item.status === 'returned' && item.crm_customer_id
          ? `<button class="text-button" type="button" data-returned-history="${esc(item.crm_customer_id)}">查看开发历史</button>`
          : '';
```

并让 actions 数组在非分配场景下保留该按钮（如 `actions = returnedHistoryAction || '—'`）。

新增：

```js
  async function openReturnedHistoryModal(crmCustomerId) {
    openModal('查看开发历史', 'READ ONLY', '<div class="empty">正在读取开发历史…</div>', 'returned-history-modal');
    try {
      const result = await api(`/api/sales-crm/accounts/${encodeURIComponent(crmCustomerId)}/history`, {
        preserveOnForbidden: true,
      });
      const account = result.account || {};
      const displayName = account.nickname || account.companyName || account.externalCustomerId;
      openModal('查看开发历史', 'READ ONLY', `
        <div class="returned-history-side">
          <div class="returned-history-head">
            <span class="pill gray">只读查看</span>
            <h3>${esc(displayName)}</h3>
            <p>${esc(account.externalCustomerId)} · ${esc(account.country || '地区未标注')} · ${esc(account.status || '历史客户')}</p>
          </div>
          <div class="timeline">${(result.timeline || []).map(event => `
            <div class="timeline-item"><h4>${esc(timelineEventTitle(event))}</h4>
              ${event.summary ? `<p>${esc(event.summary)}</p>` : ''}
              <time>${esc(event.actor_name || '')}${event.actor_name ? ' · ' : ''}${shortDate(event.occurred_at, true)}</time></div>`).join('') || '<div class="empty">暂无开发历史</div>'}
          </div>
          <div class="form-actions"><button type="button" class="button secondary" data-close-modal>关闭</button></div>
        </div>`, 'returned-history-modal');
    } catch (error) {
      closeModal();
      toast(error.message);
    }
  }
```

click 分发加 `const returnedHistory = event.target.closest('[data-returned-history]'); if (returnedHistory) { void openReturnedHistoryModal(returnedHistory.dataset.returnedHistory); return; }`。

CSS 加 `.returned-history-side { min-width: 360px; } .returned-history-head h3 { margin: 8px 0 4px; }`。

- [ ] **Step 5: 运行测试**

Run: `node --test test/issue291_returned_history.test.js test/issue257_returned_lead_assignment.test.js test/issue221_returned_lead_reactivation.test.js test/issue209_ownerless_return.test.js test/issue212_lead_pool_backend.test.js`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add lib/sales_crm.js sales-assets/app.js sales-assets/app.css test/issue291_returned_history.test.js
git commit -m "fix: read-only returned lead development history"
```

### Task 14: 昵称入口「创建昵称」+ 弹窗精简 + 规范化唯一冲突文案

**Files:**
- Modify: `sales-crm.html`（757 行按钮文案）
- Modify: `sales-assets/app.js`（`openNicknameModal`）
- Modify: `lib/sales_crm.js`（`updateCustomerNickname` 与 `updateAccount` 的 nickname 冲突映射）
- Test: `test/issue291_nickname_ui.test.js`；`test/customer_nickname.test.js` 追加全半角冲突用例

**Interfaces:**
- Consumes: `normalizeCustomerName`（NFKC + trim + 空白合并 + 小写）；`assertCustomerIdentityAvailable` 抛 `CUSTOMER_IDENTITY_REVIEW_REQUIRED`。
- Produces: 昵称冲突返回 409 + `CUSTOMER_NICKNAME_TAKEN` + 文案「该昵称已被其他客户使用，请更换昵称」。

- [ ] **Step 1: 写失败测试**

新建 `test/issue291_nickname_ui.test.js`：

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('nickname entry and modal use the simplified creation wording', () => {
  assert.match(html, /id="drawerNicknameBtn"[^>]*>创建昵称</);
  const modal = section(app, 'function openNicknameModal', 'function openPasswordModal');
  assert.match(modal, /创建客户昵称/);
  assert.match(modal, /客户名称/);
  assert.match(modal, /客户编号/);
  assert.match(modal, /客户昵称/);
  assert.match(modal, /保存昵称/);
  assert.doesNotMatch(modal, /绑定客户主档并供公司内部共用|不影响正式名称、去重、AI、Recon、制裁核查/);
});

test('normalized nickname collision returns the friendly conflict message', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET nickname='ABC' WHERE customer_id='RU-9002'").run();
  const response = await fx.request('/api/sales-crm/customers/RU-9003/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: 'ＡＢＣ' },
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, '该昵称已被其他客户使用，请更换昵称');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/issue291_nickname_ui.test.js`

Expected: FAIL。

- [ ] **Step 3: 按钮与弹窗**

`sales-crm.html:757`：`共享昵称` → `创建昵称`。

`openNicknameModal`（9560 行）替换为：

```js
  function openNicknameModal(customerId) {
    let target = customerId || state.drawerNicknameTarget;
    if (typeof target === 'string') {
      const account = state.data.accounts.find(item => item.id === target);
      target = nicknameTarget(account, { source: 'crm', crmCustomerId: target });
    }
    if (!target?.externalCustomerId || !can('edit_customer')) {
      return toast('当前客户不在可编辑范围内');
    }
    openModal(`${target.nickname ? '修改' : '创建'}客户昵称`, 'CUSTOMER NICKNAME', `<form id="nicknameForm" class="form-grid">
      <input type="hidden" name="externalCustomerId" value="${esc(target.externalCustomerId)}">
      <input type="hidden" name="nicknameSource" value="${esc(target.source || '')}">
      <input type="hidden" name="crmCustomerId" value="${esc(target.crmCustomerId || '')}">
      <input type="hidden" name="intakeItemId" value="${esc(target.intakeItemId || '')}">
      <label>客户名称<input value="${esc(target.companyName || '')}" readonly></label>
      <label>客户编号<input value="${esc(target.externalCustomerId)}" readonly></label>
      <label>客户昵称<input name="nickname" value="${esc(target.nickname || '')}" maxlength="40" autocomplete="off" placeholder="最多40个字符"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存昵称</button></div>
    </form>`);
  }
```

同时删除 click 分发里 `[data-clear-nickname]` 处理（10719 行）。

- [ ] **Step 4: 冲突文案**

`updateCustomerNickname`（7311 行）的 `assertCustomerIdentityAvailable` 调用包 try：

```js
      try {
        assertCustomerIdentityAvailable(value, {
          externalCustomerId: customer.customer_id,
          name: nickname,
          source: 'crm_current_nickname',
          actorId: user.id,
        });
      } catch (error) {
        if (error?.code === 'CUSTOMER_IDENTITY_REVIEW_REQUIRED') {
          throw conflictError('该昵称已被其他客户使用，请更换昵称', 'CUSTOMER_NICKNAME_TAKEN');
        }
        throw error;
      }
```

`updateAccount` 里 nicknameChange 路径（9190 行）做同样包装。

- [ ] **Step 5: 运行测试**

Run: `node --test test/issue291_nickname_ui.test.js test/customer_nickname.test.js test/issue147_shared_nickname_backend.test.js test/issue147_shared_nickname_ui.test.js`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add sales-crm.html sales-assets/app.js lib/sales_crm.js test/issue291_nickname_ui.test.js
git commit -m "fix: simplify nickname creation entry and duplicate message"
```

### Task 15: 链路 C 三角色回归

- [ ] **Step 1: 全链路 C 测试**

```bash
node --test test/issue291_duplicate_needs_info.test.js test/issue291_sales_review_hint.test.js test/issue291_returned_history.test.js test/issue291_nickname_ui.test.js test/issue208_duplicate_review_api.test.js test/issue208_duplicate_review_ui.test.js test/issue208_duplicate_rules.test.js test/issue262_stale_duplicate_review_upgrade.test.js test/issue221_returned_lead_reactivation.test.js test/issue257_returned_lead_assignment.test.js test/issue209_ownerless_return.test.js test/issue158_duplicate_protection.test.js test/customer_nickname.test.js test/issue147_shared_nickname_backend.test.js test/issue147_shared_nickname_ui.test.js test/issue172_protected_customer_privacy.test.js test/issue184_lead_identity_warning.test.js
```

Expected: PASS。

- [ ] **Step 2: 手工证据**

- 管理员：查重队列三动作（关联现有客户 / 确认新客户 / 信息不足要求补充）。
- 销售：自己提交的疑似重复客户只显示模糊提示，无候选/相似度/负责人/历史。
- 管理员：补资料后记录自动回到待核验。
- 销售/主管/管理员：退回线索「查看开发历史」只读，权限按数据范围校验，直链越权 403。
- 销售：创建昵称弹窗只有名称/编号/昵称/取消/保存；重复昵称得到明确提示。

- [ ] **Step 3: Commit（仅当有修复）**

```bash
git add -A && git commit -m "test: lead review history and nickname regression"
```

---

## Phase D：收口

### Task 16: 全量测试、语法与构建检查

- [ ] **Step 1: 全量核心测试**

```bash
npm test
```

Expected: PASS（原有 1108 + 新增全部通过，无 fail）。

- [ ] **Step 2: 语法与残留检查**

```bash
node --check lib/sales_crm.js
node --check lib/manager_tasks.js
node --check lib/access_control.js
node --check lib/permission_groups.js
node --check sales-assets/app.js
rg -n "TODO|TBD|待实现" docs/superpowers/plans/2026-08-13-issue-291-unresolved-workflows.md lib/sales_crm.js sales-assets/app.js || true
node --test test/issue170_deferred_plan_ui.test.js
```

Expected: `node --check` 全部无输出；`rg` 无 TODO/TBD/待实现；deferred-plan UI 测试通过（`openNextPlanTaskModal`/`setNextPlanMode`/`todayTaskPlanForm` 保留为「暂未确定」流程）。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "test: cover unresolved workflow regression paths"
```

### Task 17: PR 描述、三角色验收与上线回写

- [ ] **Step 1: PR 描述**

包含：本 issue 链接（#291）、基线 `bc98c01`、三条业务链路说明、权限与数据安全说明（销售零泄露、服务端 403、昵称规范化唯一）、自动化测试结果（`npm test` 输出）、三角色验收截图/录屏。

- [ ] **Step 2: 合并前检查**

- 单元测试通过。
- 接口测试通过。
- Playwright/浏览器关键流程（销售补计划 → 主管回复 → 销售回执 → 计划确认；查重三动作；退回历史只读；昵称创建）。
- 构建检查（本仓库无前端构建步骤，`node --check` 视为构建检查）。
- 代码审查重点：权限泄露、虚假历史、待办刷新、审计记录。

- [ ] **Step 3: 部署后冒烟**

- 销售账号：下一步计划、暂无计划、主管协助入口。
- 主管账号：主管待办处理与回执。
- 管理员账号：权限面板、查重队列、退回历史、创建昵称。
- 检查生产日志与错误监控（无权限异常、500、前端空白）。
- 把部署时间、合并 PR、验收账号类型、发现的问题回写到 issue #291。

- [ ] **Step 4: PR 合并**

squash merge 到 `main`，确认 issue 自动/手动关闭。

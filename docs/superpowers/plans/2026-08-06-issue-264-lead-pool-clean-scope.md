# Issue #264 线索池只展示可处理线索 + 已进入 CRM 独立入口 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 线索池列表只展示可处理线索(pending/approved/assigned/returned),已进入 CRM 客户移入独立「已进入 CRM」统计卡入口,统一勾选与数量口径。

**Architecture:** 后端两处收敛( `/lists/intake` 走 `intake_flow_filters.js` 的 `INTAKE_FLOW_PAGE_CONFIG.statuses`;bootstrap 走 `sales_crm.js:loadIntakeState` 的 items 查询),统计 `stats` 保持全量(供新卡与侧栏);前端调整统计卡集合、状态 Tab、侧栏计数与跳转映射。不新增 API、不新增权限点、不动数据。

**Tech Stack:** Node.js(express + better-sqlite3 + node:test),前端为原生 JS 单文件 `sales-assets/app.js` + `sales-crm.html`。

## Global Constraints

- 实施基准:`main` = `e53199ed160beddda0432277e31371ae74588a50`(即生产 current 版本)。
- 测试命令:`npm test`(即 `node scripts/run-core-tests.js`);单测可用 `node --test test/<file>`。
- 测试基建:`test/helpers/permission_fixture.js`(`adminFixture()` 内存 SQLite + 真实 HTTP server)。
- 状态枚举:`pending/approved/assigned/claimed/returned/rejected/duplicate`。
- 可处理状态集合:`pending/approved/assigned/returned`(新增常量 `INTAKE_ACTIONABLE_STATUSES`)。
- 不扩大任何账号数据范围;无权限接口保持 `403`;不新建第二套处理逻辑;不迁移/删除任何业务数据。
- 每个 Task 结束时跑通该 Task 测试并提交;提交信息遵循仓库风格(`feat:`/`fix:`/`test:`/`docs:` 前缀)。

---
## 文件结构

| 文件 | 责任 |
|---|---|
| `lib/intake_flow_filters.js`(修改) | `/lists/intake` 列表与筛选项的状态收敛 |
| `lib/sales_crm.js`(修改,仅 `loadIntakeState`) | bootstrap items 收敛(不动 stats) |
| `sales-crm.html`(修改) | 状态 Tab 移除「已领取」「不对口」 |
| `sales-assets/app.js`(修改) | 统计卡集合、Tab 计数、侧栏计数、CRM 跳转映射 |
| `test/issue264_lead_pool_backend.test.js`(新建) | 后端收敛专项测试 |
| `test/issue264_lead_pool_frontend.test.js`(新建) | 前端静态断言专项测试 |
| `test/issue212_lead_pool_backend.test.js`(修改) | 更新列表/筛选项断言为新语义 |
| `test/issue212_lead_pool_frontend.test.js`(修改) | 更新 manager 统计卡集合断言 |

---

### Task 1: 后端收敛 `/lists/intake` 到可处理状态

**Files:**
- Modify: `lib/intake_flow_filters.js`
- Test: `test/issue264_lead_pool_backend.test.js`(新建)

**Interfaces:**
- Consumes: `adminFixture()`(`test/helpers/permission_fixture.js`)、`BUSINESS_STATUSES`、`INTAKE_STATUS_LABELS`(`intake_flow_filters.js`)
- Produces: 新导出常量 `INTAKE_ACTIONABLE_STATUSES = ['pending','approved','assigned','returned']`;`INTAKE_FLOW_PAGE_CONFIG.intake.statuses` 指向它;`intakeFlowFilterOptions` 的 `status` 选项仅含可处理状态(admin/manager)/仅 `assigned`(sales)。

- [ ] **Step 1: 写失败测试**

创建 `test/issue264_lead_pool_backend.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminFixture } = require('./helpers/permission_fixture');

function envelope(filters = {}) {
  return encodeURIComponent(JSON.stringify(filters));
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function utcDay() {
  return utcStamp().slice(0, 10);
}

function seedIntakeItems(fx) {
  const insert = fx.db.prepare(`INSERT INTO crm_intake_items
    (id,batch_id,external_customer_id,company_name,status,assigned_owner_id,
     assigned_at,claim_due_at,claimed_at,return_reason,decision_reason,
     duplicate_state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = utcStamp();
  const today = utcDay();
  insert.run('I264-PENDING', 'BATCH-264', 'BR-2641', 'Issue264 Pending', 'pending', '',
    '', '', '', '', '', 'cleared', `${today} 08:00:00`, now);
  insert.run('I264-APPROVED', 'BATCH-264', 'BR-2642', 'Issue264 Approved', 'approved', '',
    '', '', '', '', '', 'cleared', `${today} 08:30:00`, now);
  insert.run('I264-ASSIGNED', 'BATCH-264', 'BR-2643', 'Issue264 Assigned', 'assigned', 'U-OTHER',
    now, '2099-01-01 00:00:00', '', '', '待领取', 'cleared', `${today} 09:00:00`, now);
  insert.run('I264-CLAIMED', 'BATCH-264', 'BR-2644', 'Issue264 Claimed', 'claimed', 'U-OTHER',
    now, now, now, '', '', 'cleared', `${today} 10:00:00`, now);
  fx.db.prepare(`UPDATE crm_intake_items SET crm_customer_id='CRM-264-CLAIMED'
    WHERE id='I264-CLAIMED'`).run();
  insert.run('I264-RETURNED', 'BATCH-264', 'BR-2645', 'Issue264 Returned', 'returned', 'U-OTHER',
    now, '', '', '测试退回', '退回', 'cleared', `${today} 11:00:00`, now);
  insert.run('I264-REJECTED', 'BATCH-264', 'BR-2646', 'Issue264 Rejected', 'rejected', 'U-OTHER',
    now, '', '', '不对口', '不对口', 'cleared', `${today} 12:00:00`, now);
  insert.run('I264-DUPLICATE', 'BATCH-264', 'BR-2647', 'Issue264 Duplicate', 'duplicate', '',
    '', '', '', '', '客户已在CRM', 'exact', `${today} 13:00:00`, now);
}

test('Issue 264 lead pool default list only returns actionable statuses', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const result = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue264' },
  })}`, { cookie: fx.adminCookie });
  const ids = result.rows.map(row => row.id).sort();
  assert.deepEqual(ids, ['I264-APPROVED', 'I264-ASSIGNED', 'I264-PENDING', 'I264-RETURNED']);
});

test('Issue 264 status filter options only expose actionable statuses', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/intake', { cookie: fx.adminCookie });
  const statusField = schema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(
    Object.fromEntries(statusField.options.map(option => [option.value, option.label])),
    { approved: '待分配', assigned: '待领取', pending: '待分配', returned: '已退回' },
  );

  const salesSchema = await fx.requestJson('/api/sales-crm/filter-schema/intake', { cookie: fx.otherCookie });
  const salesStatus = salesSchema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(salesStatus.options.map(option => option.value), ['assigned']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_backend.test.js`
Expected: FAIL——列表返回 7 态(含 claimed/rejected/duplicate),`ids` 断言与 `statusField.options` 断言不匹配。

- [ ] **Step 3: 最小实现**

修改 `lib/intake_flow_filters.js`:

(a) 在 `BUSINESS_STATUSES` 常量后新增:

```js
const INTAKE_ACTIONABLE_STATUSES = Object.freeze([
  'pending', 'approved', 'assigned', 'returned',
]);
```

(b) `INTAKE_FLOW_PAGE_CONFIG` 的 `intake.statuses` 改为:

```js
  intake: Object.freeze({
    pageKey: 'intake',
    requiredPermission: 'view_intake',
    statuses: INTAKE_ACTIONABLE_STATUSES,
  }),
```

(c) `intakeFlowFilterOptions` 的 `item.key === 'status'` 分支整体替换为:

```js
    } else if (item.key === 'status') {
      const counts = Object.fromEntries(
        simpleOptions(db, scope, MULTI_COLUMNS[item.key], {}).map(option => [option.value, option.count]),
      );
      const salesOnlyAssigned = user?.role === 'sales' || !hasPermission(user, 'manage_intake');
      result[item.key] = Object.entries(INTAKE_STATUS_LABELS)
        .filter(([status]) => {
          if (!INTAKE_ACTIONABLE_STATUSES.includes(status)) return false;
          if (salesOnlyAssigned && status !== 'assigned') return false;
          return true;
        })
        .map(([status, label]) => ({
          value: status,
          label,
          ...(counts[status] ? { count: counts[status] } : {}),
        }));
    }
```

(d) 在 `module.exports` 中导出新常量(追加到导出对象):

```js
  INTAKE_ACTIONABLE_STATUSES,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_backend.test.js`
Expected: PASS(2 个测试)。

- [ ] **Step 5: 提交**

```bash
cd /tmp/rcl-dev
git add lib/intake_flow_filters.js test/issue264_lead_pool_backend.test.js
git commit -m "feat: lead pool list only exposes actionable statuses (#264)"
```

---

### Task 2: 收敛 bootstrap items(`/api/sales-crm/intake`)

**Files:**
- Modify: `lib/sales_crm.js`(`loadIntakeState`,约 `:3637-3639`)
- Test: `test/issue264_lead_pool_backend.test.js`(追加)

**Interfaces:**
- Consumes: `buildIntakeQueryScope(user, query)`(返回 `{ filters, params }`)、`scoped` 判定(已在函数内)
- Produces: bootstrap `items` 默认只含可处理状态;`stats` 保持不变(仍含 `claimed`/`rejected` 全量计数)。

- [ ] **Step 1: 写失败测试(追加到 issue264 backend 文件末尾)**

```js
test('Issue 264 bootstrap intake items exclude claimed/rejected/duplicate but stats stay complete', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  seedIntakeItems(fx);

  const body = await fx.requestJson('/api/sales-crm/intake?page=1&pageSize=50', {
    cookie: fx.adminCookie,
  });
  const statuses = [...new Set(body.items.map(item => item.status))].sort();
  assert.deepEqual(statuses, ['approved', 'assigned', 'pending', 'returned']);
  assert.equal(body.stats.claimed, 1, 'claimed 统计保持全量');
  assert.equal(body.stats.rejected, 1, 'rejected 统计保持全量');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_backend.test.js`
Expected: FAIL——`body.items` 仍含 `claimed/rejected/duplicate`。

- [ ] **Step 3: 最小实现**

修改 `lib/sales_crm.js` `loadIntakeState` 中 items 查询前的 scope 构建段(现为):

```js
  const { filters, params } = buildIntakeQueryScope(user, query);
  if (scoped) {
    filters.push("i.status='assigned'");
  }
```

改为:

```js
  const { filters, params } = buildIntakeQueryScope(user, query);
  if (scoped) {
    filters.push("i.status='assigned'");
  } else {
    filters.push("i.status IN ('pending','approved','assigned','returned')");
  }
```

> 注意:`stats` 使用 `buildIntakeQueryScope(user, query, { includeStatus: false })`(独立 `countScope`),不受此改动影响。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_backend.test.js`
Expected: PASS(3 个测试)。

- [ ] **Step 5: 提交**

```bash
cd /tmp/rcl-dev
git add lib/sales_crm.js test/issue264_lead_pool_backend.test.js
git commit -m "feat: bootstrap intake items match actionable scope (#264)"
```

---

### Task 3: 更新 issue212 后端测试到新语义

**Files:**
- Modify: `test/issue212_lead_pool_backend.test.js`(第一个测试「unifies the lead list scope」)

**Interfaces:**
- 保持 issue212 其余测试不变(它们操作具体 itemIds,不依赖列表默认状态集合)。

- [ ] **Step 1: 更新断言**

把「Issue 212 unifies the lead list scope while keeping every status visible」测试中的两处断言改为:

```js
  const result = await fx.requestJson(`/api/sales-crm/lists/intake?filters=${envelope({
    search: { operator: 'contains', value: 'Issue212' },
  })}`, { cookie: fx.adminCookie });
  const statuses = [...new Set(result.rows.map(row => row.status))].sort();
  assert.deepEqual(statuses, ['assigned', 'pending', 'returned']);
```

以及 status options 断言(删去 claimed/duplicate/rejected 行):

```js
  const statusField = schema.schema.fields.find(field => field.key === 'status');
  assert.deepEqual(
    Object.fromEntries(statusField.options.map(option => [option.value, option.label])),
    {
      approved: '待分配', assigned: '待领取', pending: '待分配', returned: '已退回',
    },
  );
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue212_lead_pool_backend.test.js`
Expected: PASS(其余 11 个测试不受影响)。

- [ ] **Step 3: 提交**

```bash
cd /tmp/rcl-dev
git add test/issue212_lead_pool_backend.test.js
git commit -m "test: update issue 212 assertions to actionable lead scope (#264)"
```

---

### Task 4: 前端——统计卡「已进入 CRM」、状态 Tab、侧栏计数、跳转映射

**Files:**
- Modify: `sales-crm.html`(`#intakeTabs` 区块,约 `:189-196`)
- Modify: `sales-assets/app.js`(`intakeStatCards` `:2287-2306`、`renderIntake` `:2419-2551`、`intakeActiveStatCard` `:2352-2389`、`intakeStatDraft` `:2340-2350`、`jumpIntakeStatToCrm` `:2412-2417`、`navIntakeCount` `:1544`)
- Test: `test/issue264_lead_pool_frontend.test.js`(新建)

**Interfaces:**
- Produces: 新统计卡 key `'crm'`(「已进入 CRM」,全角色,点击走 `jumpIntakeStatToCrm` → `flow='claimed'`);manager 统计卡集合 `[today,unassigned,assigned,crm,contacted,idle,returned,overdue]`;sales 统计卡集合 `[today,assigned,claimed,crm,contacted,returned,overdue]`;Tab 集合 `['','unassigned','assigned','returned']`;`navIntakeCount` 口径 manager=`pending+approved+assigned+returned`、sales=`assigned`。

- [ ] **Step 1: 写失败测试**

创建 `test/issue264_lead_pool_frontend.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('Issue 264 intake tabs drop claimed and rejected', () => {
  const tabs = html.slice(html.indexOf('id="intakeTabs"'), html.indexOf('</div>', html.indexOf('id="intakeTabs"') + 400));
  assert.match(tabs, /data-intake-status=""/);
  assert.match(tabs, /data-intake-status="unassigned"/);
  assert.match(tabs, /data-intake-status="assigned"/);
  assert.match(tabs, /data-intake-status="returned"/);
  assert.doesNotMatch(tabs, /data-intake-status="claimed"/);
  assert.doesNotMatch(tabs, /data-intake-status="rejected"/);
});

test('Issue 264 stat cards add CRM entry, drop manager claimed and rejected', () => {
  const cards = functionBlock(app, 'intakeStatCards');
  assert.match(cards, /\['crm', '已进入 CRM'/);
  const manager = cards.slice(cards.indexOf('] : [') + 4);
  assert.match(manager, /\['unassigned',/);
  assert.match(manager, /\['crm',/);
  assert.doesNotMatch(manager, /\['claimed',/);
  assert.doesNotMatch(manager, /\['rejected',/);
  const sales = cards.slice(0, cards.indexOf('] : [') + 1);
  assert.match(sales, /\['claimed', '已领取'/);
  assert.match(sales, /\['crm', '已进入 CRM'/);
});

test('Issue 264 renderIntake tab labels drop claimed and rejected', () => {
  const render = functionBlock(app, 'renderIntake');
  const labels = render.slice(render.indexOf('const tabLabels'), render.indexOf('$$(\'#intakeTabs button\')'));
  assert.doesNotMatch(labels, /claimed: '已领取'/);
  assert.doesNotMatch(labels, /rejected: '不对口'/);
  assert.match(labels, /returned: '已退回'/);
});

test('Issue 264 CRM jump maps crm and claimed cards to claimed flow', () => {
  const jump = functionBlock(app, 'jumpIntakeStatToCrm');
  assert.match(jump, /key === 'claimed' \|\| key === 'crm'/);
  assert.match(jump, /pendingCustomerIntakeFlow = flow/);
});

test('Issue 264 nav count uses role-scoped actionable totals', () => {
  const block = app.slice(app.indexOf("if ($('#navIntakeCount'))"), app.indexOf("if ($('#navIntakeCount'))") + 400);
  assert.match(block, /navIntakeCount/);
  assert.match(block, /canViewAssignmentDecisions/);
  assert.match(block, /stats\.pending/);
  assert.match(block, /stats\.returned/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_frontend.test.js`
Expected: FAIL(所有 5 个断言均未满足)。

- [ ] **Step 3: 最小实现**

(a) `sales-crm.html`:`#intakeTabs` 区块移除「已领取」「不对口」按钮,改为:

```html
            <div class="segmented" id="intakeTabs">
              <button class="active" data-intake-status="">全部</button>
              <button data-intake-status="unassigned">待分配</button>
              <button data-intake-status="assigned">待领取</button>
              <button data-intake-status="returned">已退回</button>
            </div>
```

(b) `sales-assets/app.js` `intakeStatCards()` 整体替换为:

```js
  function intakeStatCards(salesView, stats, settings) {
    return salesView ? [
      ['today', '今日收到线索', stats.todayImported, '领取前保留在线索池'],
      ['assigned', '待领取', stats.assigned, `领取时限 ${settings.claimSlaHours} 小时`],
      ['claimed', '已领取', stats.claimed, '已转入个人CRM'],
      ['crm', '已进入 CRM', stats.claimed, '点击进入 CRM 客户全景'],
      ['contacted', '当前触达', stats.contacted, '当前开发中已触达'],
      ['returned', '已退回', stats.returned, '必须说明原因'],
      ['overdue', '领取超期', stats.overdueClaim, '管理者将收到预警'],
    ] : [
      ['today', '今日同步线索', stats.todayImported, '仍属于线索池'],
      ['unassigned', '待分配', stats.pending + stats.approved, '勾选或筛选后手动指定销售'],
      ['assigned', '待销售领取', stats.assigned, `时限 ${settings.claimSlaHours} 小时`],
      ['crm', '已进入 CRM', stats.claimed, '已领取客户进入 CRM 全景'],
      ['contacted', '当前触达', stats.contacted, '当前开发漏斗中已触达'],
      ['idle', '闲置资源', stats.idle, '待分配或退回'],
      ['returned', '退回待处理', stats.returned, '需要重新分配'],
      ['overdue', '领取超期', stats.overdueClaim, '系统异常预警'],
    ];
  }
```

(c) `sales-assets/app.js` `jumpIntakeStatToCrm()` 改为:

```js
  async function jumpIntakeStatToCrm(key) {
    const flow = (key === 'claimed' || key === 'crm') ? 'claimed' : 'contacted';
    state.pendingCustomerIntakeFlow = flow;
    updateLeadWorkflowUrl(flow, 'customers');
    switchView('customers');
  }
```

(d) `sales-assets/app.js` `renderIntake()` 内两处:

- `tabCounts`/`tabLabels` 改为(移除 claimed/rejected,全部口径含 returned):

```js
    const tabCounts = {
      '': salesView
        ? Number(stats.assigned || 0)
        : Number(stats.pending || 0) + Number(stats.approved || 0) + Number(stats.assigned || 0)
          + Number(stats.returned || 0),
      unassigned: Number(stats.pending || 0) + Number(stats.approved || 0),
      assigned: Number(stats.assigned || 0),
      returned: Number(stats.returned || 0),
    };
    const tabLabels = { '': '全部', unassigned: '待分配', assigned: '待领取', returned: '已退回' };
```

- 统计卡渲染行的 `data-intake-stat-crm` 条件(`key === 'claimed' || key === 'contacted'`)改为:

```js
    $('#intakeSummary').innerHTML = summary.map(([key, label, value, note]) => `<button type="button" class="metric ${key === activeStat ? 'is-active' : ''} ${key === 'overdue' && value ? 'alert' : ''}" data-intake-stat="${key}" aria-pressed="${key === activeStat}" ${key === 'claimed' || key === 'contacted' || key === 'crm' ? 'data-intake-stat-crm="1"' : ''}><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`).join('');
```

(e) `sales-assets/app.js` `intakeActiveStatCard()` 的 `poolLeadViews` 移除 `rejected`:

```js
    const poolLeadViews = ['today', 'unassigned', 'assigned', 'idle', 'returned', 'overdue'];
```

(f) `sales-assets/app.js` `intakeStatDraft()` 移除 `rejected` 条目:

```js
  function intakeStatDraft(key) {
    return {
      today: { created_today: true },
      unassigned: { status: ['pending', 'approved'] },
      assigned: { status: ['assigned'] },
      idle: { status: ['pending', 'approved', 'returned'] },
      returned: { status: ['returned'] },
      overdue: { status: ['assigned'], claim_overdue: true },
    }[key] || {};
  }
```

(g) `sales-assets/app.js` `refresh()` 中 `navIntakeCount`(`:1544`)替换为:

```js
    const intakeStats = state.data.intake?.stats;
    if ($('#navIntakeCount')) {
      const intakeSalesView = !canViewAssignmentDecisions();
      $('#navIntakeCount').textContent = intakeSalesView
        ? Number(intakeStats?.assigned || 0)
        : Number(intakeStats?.pending || 0) + Number(intakeStats?.approved || 0)
          + Number(intakeStats?.assigned || 0) + Number(intakeStats?.returned || 0) || 0;
    }
```

> `canViewAssignmentDecisions` 在 `app.js:656-658` 定义(`app.js` 内作用域可访问)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue264_lead_pool_frontend.test.js`
Expected: PASS(5 个测试)。

- [ ] **Step 5: 提交**

```bash
cd /tmp/rcl-dev
git add sales-crm.html sales-assets/app.js test/issue264_lead_pool_frontend.test.js
git commit -m "feat: lead pool CRM entry card and actionable tabs (#264)"
```

---

### Task 5: 更新 issue212 前端测试到新统计卡集合

**Files:**
- Modify: `test/issue212_lead_pool_frontend.test.js`(第二个测试「nine native manager stat buttons」)

**Interfaces:**
- 其余 issue212 前端断言(全选框/半选、批量分配、生命周期操作等)不受影响,保持原样。

- [ ] **Step 1: 更新断言**

把第二个测试替换为:

```js
test('Issue 212 renders manager stat buttons with CRM entry and no claimed/rejected cards', () => {
  const cards = functionBlock(app, 'intakeStatCards');
  for (const key of ['today', 'unassigned', 'assigned', 'crm', 'contacted', 'idle', 'returned', 'overdue']) {
    assert.match(cards, new RegExp(`\\['${key}',`), key);
  }
  assert.doesNotMatch(cards, /\['claimed',/);
  assert.doesNotMatch(cards, /\['rejected',/);
  const render = functionBlock(app, 'renderIntake');
  assert.match(render, /<button type="button" class="metric/);
  assert.match(render, /data-intake-stat=/);
  assert.match(render, /aria-pressed=/);
  assert.match(render, /data-intake-stat-crm/);
  assert.match(css, /button\.metric\.is-active/);
});
```

> 注:该测试文件顶部已有 `css` 读取(`app.css`),保持不变;测试标题同步改为上述新标题。

- [ ] **Step 2: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue212_lead_pool_frontend.test.js`
Expected: PASS(其余断言不受影响)。

- [ ] **Step 3: 提交**

```bash
cd /tmp/rcl-dev
git add test/issue212_lead_pool_frontend.test.js
git commit -m "test: update issue 212 stat card assertions for CRM entry (#264)"
```

---

### Task 6: 全量回归、语法检查、Draft PR

**Files:** 无新增

- [ ] **Step 1: 全量测试**

Run: `cd /tmp/rcl-dev && npm test`
Expected: 全绿(含 `issue228_my_leads`、`issue257_returned_lead_assignment`、`issue141_manual_intake_assignment`、`issue96_intake_crm_invariant`、`issue103_backend`、`issue157_today_task_actions`、`issue107_lead_pool_filter_options`、`issue207_impersonation_bulk_actions` 等既有测试)。

- [ ] **Step 2: 语法检查**

Run: `cd /tmp/rcl-dev && node --check sales-assets/app.js && node --check lib/intake_flow_filters.js && node --check lib/sales_crm.js && node --check test/issue264_lead_pool_backend.test.js`
Expected: 无输出(exit 0)。

- [ ] **Step 3: 推送分支并建 Draft PR**

```bash
cd /tmp/rcl-dev
git push -u origin codex/issue-264-lead-pool-clean-scope
gh pr create --draft --repo mewmind-chen/russia-crm-local --base main \
  --head codex/issue-264-lead-pool-clean-scope \
  --title "feat: lead pool only exposes actionable leads with CRM entry (issue #264)" \
  --body "Issue #264 实现:
- 线索池列表只展示可处理状态(pending/approved/assigned/returned),排除 claimed/rejected/duplicate
- 新增「已进入 CRM」统计卡,点击跳 CRM 客户全景(intake_flow=claimed)
- 状态 Tab 移除「已领取」「不对口」
- 侧栏线索池数量按权限范围分视角(manager=可处理总数 / sales=待领取)
- 表头全选/半选沿用现有逻辑,列表内每行均可勾选
- 专项测试 issue264 + 更新 issue212 断言;全量回归通过"
```

Expected: 返回 PR 链接;CI 在 PR 上自动运行。

- [ ] **Step 4: 等待 CI 并汇报**

Run: `gh pr checks <PR_URL> --watch`
Expected: CI `test` job 通过后,向用户汇报 PR 链接与 CI 结果,等待用户授权合并。

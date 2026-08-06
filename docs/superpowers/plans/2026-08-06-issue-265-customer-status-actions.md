# Issue #265 CRM 客户全景「状态/操作」分列与操作闭环 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户全景表格拆成独立「状态」「操作」两列;状态列只显示主状态(4 类映射+其余短 title);多异常明细在客户详情侧栏展示;操作闭环不变。

**Architecture:** 纯前端改造(`sales-assets/app.js` + `sales-crm.html` 必要时 + `sales-assets/app.css`),后端零改动——alert 数据已含 `reasons[]`(code/title/detail/dueAt/overdueHours/actionKind)。新增 `customerPrimaryStatus(alert)` 映射函数集中管理主状态;`renderCustomers` 拆列;`renderDrawer` 追加异常明细。

**Tech Stack:** 原生 JS 单文件 `sales-assets/app.js` + `app.css`;测试用 `node:test` 静态断言(`functionBlock` 提取模式)。

## Global Constraints

- 实施基准:`main` = `9af8a46d4b753d672e7d6b40bf36ee5f6c3e084c`(当前生产版本)。
- 测试命令:`npm test`(全量);单测 `node --test test/<file>`。
- 主状态映射(决策 2):无 alert→`正常推进`;`UNCLAIMED`→`领取超期`;`OVERDUE`→`跟进超期`;`MANAGER_NEEDED`→`需要管理者介入`;其余 code→该 reason 的短 `title`。
- 颜色:tone `red`(critical)/`amber`(today/warning)/`good`(正常推进)。
- 操作列:保留 3 个操作(退回线索池/标记不对口/删除到回收站),权限条件 `canReturnCustomer`/`canRejectCustomer`/`canTrash` 原样。
- 抽屉:alert 卡保留;`alertReasons(alert).length > 1` 时显示「异常明细」列表。
- 后端零改动;权限点、403、审计、业务逻辑一律不动。
- 每个 Task 结束时跑通测试并提交;提交信息 `feat:`/`test:` 前缀。

---
## 文件结构

| 文件 | 责任 |
|---|---|
| `sales-assets/app.js`(修改) | `customerPrimaryStatus()` 新函数;`renderCustomers()` 拆列;`renderDrawer()` 异常明细 |
| `sales-assets/app.css`(修改) | `.alert-details`/`.alert-detail-row` 样式 |
| `test/issue265_customer_status_actions.test.js`(新建) | 专项静态断言 |

---

### Task 1: 主状态映射函数 + `renderCustomers` 拆列

**Files:**
- Modify: `sales-assets/app.js`(`alertFor` 附近新增 `customerPrimaryStatus`;`renderCustomers` `:3688-3709`)
- Test: `test/issue265_customer_status_actions.test.js`(新建,含 3 个测试)

**Interfaces:**
- Produces: `customerPrimaryStatus(alert)` → `{ label, tone }`(tone ∈ `'good'|'red'|'amber'`);`renderCustomers` 表头 `'优先级', '状态', '操作'`;状态单元格不含操作按钮;操作单元格含 `lifecycleActions`。

- [ ] **Step 1: 写失败测试**

创建 `test/issue265_customer_status_actions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

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

test('Issue 265 primary status maps codes to short labels', () => {
  const fn = functionBlock(app, 'customerPrimaryStatus');
  assert.match(fn, /UNCLAIMED/);
  assert.match(fn, /领取超期/);
  assert.match(fn, /OVERDUE/);
  assert.match(fn, /跟进超期/);
  assert.match(fn, /MANAGER_NEEDED/);
  assert.match(fn, /需要管理者介入/);
  assert.match(fn, /正常推进/);
  assert.match(fn, /primary\?\.title/);
  assert.match(fn, /tone: 'red'/);
  assert.match(fn, /tone: 'amber'/);
});

test('Issue 265 customer table headers split status and actions columns', () => {
  const render = functionBlock(app, 'renderCustomers');
  assert.match(render, /'优先级', '状态', '操作'/);
});

test('Issue 265 lifecycle actions live only in the actions column', () => {
  const render = functionBlock(app, 'renderCustomers');
  assert.match(render, /lifecycleActions = \[[\s\S]*?data-return-customer[\s\S]*?data-reject-customer[\s\S]*?data-trash-customer/);
  assert.match(render, /const primaryStatus = customerPrimaryStatus\(alert\)/);
  const statusCell = render.slice(
    render.indexOf('const primaryStatus = customerPrimaryStatus(alert)'),
    render.indexOf('const primaryStatus = customerPrimaryStatus(alert)') + 400,
  );
  assert.doesNotMatch(statusCell, /退回线索池|标记不对口|删除到回收站/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/rcl-dev && node --test test/issue265_customer_status_actions.test.js`
Expected: FAIL(3 个测试全部失败:`customerPrimaryStatus` 不存在、表头未拆、状态列含操作)。

- [ ] **Step 3: 最小实现**

修改 `sales-assets/app.js`:

(a) 在 `function alertFor(customerId)`(`:1517-1519`)之后新增:

```js
  function customerPrimaryStatus(alert) {
    if (!alert) return { label: '正常推进', tone: 'good' };
    const primary = alertReasons(alert)[0];
    const code = String(primary?.code || '');
    if (code === 'UNCLAIMED') return { label: '领取超期', tone: 'red' };
    if (code === 'OVERDUE') return { label: '跟进超期', tone: 'red' };
    if (code === 'MANAGER_NEEDED') return { label: '需要管理者介入', tone: 'amber' };
    return { label: primary?.title || '需关注', tone: alert.severity === 'critical' ? 'red' : 'amber' };
  }
```

(b) `renderCustomers()` 表头(`:3688`),把末尾 `'优先级', '状态'` 改为:

```js
      [canSelectCustomers ? '<input id="selectCustomerPage" type="checkbox" aria-label="选择当前页客户">' : '', '客户', '国家 / 行业', '阶段', '负责人', '最近动作', '下一步', '优先级', '状态', '操作'],
```

(c) `renderCustomers()` 行渲染(`:3693-3709`):在 `const lifecycleActions = [...]` 之后新增主状态计算:

```js
        const primaryStatus = customerPrimaryStatus(alert);
```

(d) 行数组末尾,把原状态单元格(alert pill + lifecycleActions 同一单元格)替换为两个独立单元格:

```js
          `${primaryStatus.tone === 'good'
            ? `<span class="good-text">${esc(primaryStatus.label)}</span>`
            : `<span class="pill ${primaryStatus.tone}">${esc(primaryStatus.label)}</span>`}`,
          `${lifecycleActions ? `<div class="assignment-actions">${lifecycleActions}</div>` : ''}`,
```

> 即:状态单元格只渲染主状态;操作单元格只渲染 lifecycleActions。原 `alert ? <span class="pill ...">${alert.title}</span> : <span class="good-text">正常推进</span>` 与 `lifecycleActions ? ...` 两段从原单元格移除。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue265_customer_status_actions.test.js`
Expected: PASS(3 个测试)。

- [ ] **Step 5: 提交**

```bash
cd /tmp/rcl-dev
git add sales-assets/app.js test/issue265_customer_status_actions.test.js
git commit -m "feat: split customer status and actions columns with primary status (#265)"
```

---

### Task 2: `renderDrawer` 异常明细 + CSS

**Files:**
- Modify: `sales-assets/app.js`(`renderDrawer` `:8008` 模板,alert 卡之后)
- Modify: `sales-assets/app.css`(追加 `.alert-details`/`.alert-detail-row`)
- Test: `test/issue265_customer_status_actions.test.js`(追加 1 个测试)

**Interfaces:**
- Consumes: `alertReasons(alert)`(`app.js:1506-1508`)、`shortDate(value, withTime)`(`app.js:456`)
- Produces: 抽屉内 `alert-details` 区块(仅 `alertReasons(alert).length > 1` 时渲染),每条 reason 显示 title/detail/计划时间/超时时长/建议操作。

- [ ] **Step 1: 写失败测试(追加到 issue265 测试文件末尾)**

```js
test('Issue 265 drawer lists alert details with time and overdue hours', () => {
  const drawer = functionBlock(app, 'renderDrawer');
  assert.match(drawer, /alert-details/);
  assert.match(drawer, /alertReasons\(alert\)\.length > 1/);
  assert.match(drawer, /overdueHours/);
  assert.match(drawer, /reason\.dueAt/);
  assert.match(css, /\.alert-details\{/);
  assert.match(css, /\.alert-detail-row\{/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/rcl-dev && node --test test/issue265_customer_status_actions.test.js`
Expected: FAIL(第 4 个测试)。

- [ ] **Step 3: 最小实现**

(a) `sales-assets/app.js` `renderDrawer()` 的 `$('#drawerContent').innerHTML` 模板中,在现有 alert 卡(以 `hasMeaningfulAlertCopy(alert)` 开头的 `<div class="next-step"` 行)之后、`<div class="next-step"><div><span class="eyebrow">NEXT ACTION</span>` 之前,插入:

```js
      ${alert && alertReasons(alert).length > 1 ? `<div class="alert-details"><span class="eyebrow">异常明细</span>${alertReasons(alert).map(reason => `<div class="alert-detail-row"><strong>${esc(reason.title)}</strong><p>${esc(reason.detail)}</p><span>${reason.dueAt ? `计划时间：${esc(shortDate(reason.dueAt, true))}` : ''}${Number(reason.overdueHours) > 0 ? ` · 已超时 ${Math.floor(Number(reason.overdueHours))} 小时` : ''}${reason.action ? ` · ${esc(reason.action)}` : ''}</span></div>`).join('')}</div>` : ''}
```

(b) `sales-assets/app.css` 追加(文件末尾):

```css
.alert-details{display:grid;gap:6px;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}
.alert-detail-row{display:grid;gap:3px;border-top:1px solid var(--line);padding-top:8px}
.alert-detail-row:first-of-type{border-top:0;padding-top:0}
.alert-detail-row strong{font-size:12px;color:var(--text-primary)}
.alert-detail-row p{font-size:11px;color:var(--muted);margin:0}
.alert-detail-row span{font-size:10px;color:var(--muted)}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /tmp/rcl-dev && node --test test/issue265_customer_status_actions.test.js`
Expected: PASS(4 个测试)。

- [ ] **Step 5: 提交**

```bash
cd /tmp/rcl-dev
git add sales-assets/app.js sales-assets/app.css test/issue265_customer_status_actions.test.js
git commit -m "feat: drawer alert details with time and overdue hours (#265)"
```

---

### Task 3: 全量回归、语法检查、Draft PR

**Files:** 无新增

- [ ] **Step 1: 全量测试**

Run: `cd /tmp/rcl-dev && npm test`
Expected: 全绿(重点回归:issue210/241/257/209/130/137/112/147/157/225)。

- [ ] **Step 2: 语法检查**

Run: `cd /tmp/rcl-dev && node --check sales-assets/app.js && node --check test/issue265_customer_status_actions.test.js`
Expected: 无输出(exit 0)。

- [ ] **Step 3: 推送分支并建 Draft PR**

```bash
cd /tmp/rcl-dev
git push -u origin codex/issue-265-customer-status-actions
gh pr create --draft --repo mewmind-chen/russia-crm-local --base main \
  --head codex/issue-265-customer-status-actions \
  --title "feat: customer status and actions split with primary status (issue #265)" \
  --body "Issue #265 实现(纯前端,后端零改动):

- 客户全景表格拆分「状态」「操作」两列
- 状态列只显示主状态:无异常→正常推进;UNCLAIMED→领取超期;OVERDUE→跟进超期;MANAGER_NEEDED→需要管理者介入;其余异常显示短 title;多异常只显示最高优先级一条
- 操作列:退回线索池 / 标记不对口 / 删除到回收站(权限条件不变)
- 客户详情侧栏:多异常时显示「异常明细」(每条含原因、计划时间、超时时长、建议操作)
- 操作闭环沿用现有真实业务(真实更新 + refresh + 审计 + 403)
- 专项测试 issue265;全量回归通过"
```

Expected: 返回 PR 链接;CI 自动运行。

- [ ] **Step 4: 等待 CI 并汇报**

Run: `gh pr checks <PR_URL> --watch`
Expected: CI `test` 通过后,向用户汇报,等待授权合并。

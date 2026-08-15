# Issue 314 待核验中心分栏工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已确认预览把生产端「客户保护与查重」改为三个独立一级视图，并把「待核验中心」改成桌面双栏、移动端列表/详情的连续核验工作台，同时完整保留 Issue #306 的裁决、权限、审计、深链和线索池联动。

**Architecture:** 只改现有 vanilla JS 前端层。`crm_customer_identity_conflicts` 与 `crm_duplicate_reviews` 继续使用各自 API 和裁决枚举；前端增加统一的核验记录适配器，把两类记录映射为队列项和详情模型，再由共享工作台渲染。保护客户列表与批量导入只从纵向堆叠改为一级视图切换，现有加载和写入函数不变。

**Tech Stack:** Node.js 22, Express, vanilla JavaScript, HTML/CSS, `node:test`, Chrome browser verification, macOS immutable release deployment.

**Issue:** https://github.com/mewmind-chen/russia-crm-local/issues/314

**Approved preview:** `/Users/ylf/Desktop/projects/tradepulse-ai-crm/artifacts/preview/verification-center/`（桌面与 390px 交互稿；产品实现必须沿用本仓库现有设计 token、权限和 API，不复制演示数据）。

## Global Constraints

- 开发基线必须是执行时最新 `origin/main`；开始前确认 GitHub `main`、本地 `origin/main`、生产 `/healthz.releaseSha` 一致。
- 使用隔离 worktree 和分支 `codex/issue-314-verification-center-redesign`；不得在当前含未跟踪生产数据的 `main` 工作副本直接开发。
- 不修改 `lib/customer_identity_registry.js`、`lib/protected_customer_conflicts.js`、`lib/sales_crm.js`、数据库 schema、裁决枚举或 API 路由。
- 不扩大 `manage_protected_customers`、`canReviewDuplicateCustomers()` 或任何客户数据范围；销售视角不得出现保护客户、候选、负责人、相似依据或核验入口。
- `link_existing`、`confirm_new`、`supplement_and_retry`、`confirmed_same`、`confirmed_distinct`、`needs_info` 的后端能力门控保持不变。
- 保留重复核验的批量放行、重算、候选搜索/切换、分页；保留保护客户搜索、激活、导出；保留批次预览、提交和条件回滚。
- 保留 `#protectedCustomers?conflict=<id>`、`?review=<id>`、`?customer=<id>` 深链；无权限或记录不存在时不得泄露信息。
- 桌面支持 1024px 以上双栏；移动端 320/375/390/430px 使用列表与详情两个屏幕状态；页面不得横向滚动。
- 所有可点击控件有明确 hover/focus/disabled 状态；移动端触控目标最小 44px；状态不能只靠颜色表达。
- 不引入新前端框架、构建系统或运行时依赖；继续使用 `sales-crm.html`、`sales-assets/app.js`、`sales-assets/app.css`。
- 搜索只过滤当前 API 已加载页（当前 `pageSize=50`），输入框必须标注 `搜索当前页客户名称或编号`；不得暗示为服务端全量搜索。现有类型筛选和分页保持不变。
- 生产只部署 `origin/main`。禁止手工修改 `/Users/ylf/Desktop/projects/tradepulse-production/current`、`previous`、`releases/*` 或 release 内文件。
- 每个实现 Task 的专项测试通过后提交；PR 前运行完整门禁；生产发布只在 PR 合并且 `main` CI 成功后进行。

## File Structure

| File | Responsibility |
| --- | --- |
| `sales-crm.html` | 页面唯一标题、三个一级视图、工作台队列/详情 DOM、保护与导入视图容器 |
| `sales-assets/app.js` | 一级视图状态、两类记录适配、队列选择、详情渲染、自适应裁决、连续处理、深链 |
| `sales-assets/app.css` | 双栏工作台、紧凑队列、详情、固定操作栏、移动端列表/详情和响应式约束 |
| `test/issue314_verification_center_structure.test.js` | HTML 信息架构、权限容器、版本与 CSS 结构契约 |
| `test/issue314_verification_center_interaction.test.js` | 模型适配、无候选/有候选、连续处理、深链与错误保留契约 |
| `test/issue306_identity_conflict_workbench.test.js` | #306 既有身份冲突门控与深链回归；仅在 DOM/function 边界变化时同步定位 |
| `test/issue306_protection_workbench.test.js` | #306 既有重复核验三裁决、候选搜索与版本回归；仅同步结构断言 |
| `docs/evidence/issue-314-verification.md` | 本地、PR、浏览器、生产发布与回滚状态证据 |

---

### Task 1: 建立三个一级视图和工作台 DOM

**Files:**
- Modify: `sales-crm.html:651`
- Modify: `sales-assets/app.js:219`
- Test: `test/issue314_verification_center_structure.test.js`

**Interfaces:**
- Produces: `state.protectionWorkspace = { activeView: 'verification' | 'directory' | 'import' }`。
- Produces: `activateProtectionView(view)`，负责 `aria-selected`、active class、三个面板显隐和视图相关动作显隐。
- Preserves: `#protectedTemplateBtn`、`#protectedExportBtn`、`#pendingTypeTabs`、`#protectedCustomerList`、`#protectedImportRows` 及所有现有事件 ID。

- [ ] **Step 1: 写失败的结构契约测试**

创建 `test/issue314_verification_center_structure.test.js`：

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

test('protection workspace has one title and three top-level views', () => {
  assert.equal((html.match(/<h2>客户保护与查重<\/h2>/g) || []).length, 1);
  for (const view of ['verification', 'directory', 'import']) {
    assert.match(html, new RegExp(`data-protection-view="${view}"`));
    assert.match(html, new RegExp(`data-protection-panel="${view}"`));
  }
  assert.match(app, /function activateProtectionView\(view/);
  assert.match(app, /activeView: 'verification'/);
});

test('directory and import actions live in their own panels', () => {
  const directory = html.slice(html.indexOf('data-protection-panel="directory"'), html.indexOf('data-protection-panel="import"'));
  const importPanel = html.slice(html.indexOf('data-protection-panel="import"'));
  assert.match(directory, /protectedExportBtn/);
  assert.doesNotMatch(directory, /protectedTemplateBtn/);
  assert.match(importPanel, /protectedTemplateBtn/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/issue314_verification_center_structure.test.js`

Expected: FAIL，缺少 `data-protection-view`、`data-protection-panel` 和 `activateProtectionView`。

- [ ] **Step 3: 实现一级视图外壳**

在 `#protectedCustomersView` 中保留一个标题，把原头部动作移入对应面板，并加入：

```html
<nav id="protectionWorkspaceTabs" class="protection-workspace-tabs" role="tablist" aria-label="客户保护功能">
  <button class="active" type="button" role="tab" aria-selected="true" data-protection-view="verification">待核验中心 <b id="protectionVerificationCount">0</b></button>
  <button type="button" role="tab" aria-selected="false" data-protection-view="directory">保护客户</button>
  <button type="button" role="tab" aria-selected="false" data-protection-view="import">批量导入</button>
</nav>
```

给现有三个 article 增加准确属性，不复制其内部内容：`#pendingVerificationPanel` 增加 `data-protection-panel="verification"`；`.protected-list-panel` 增加 `class="panel protected-list-panel hidden" data-protection-panel="directory"`；`.protected-import-panel` 增加 `class="panel protected-import-panel hidden" data-protection-panel="import"`。

在初始 state 和 reset state 中加入同一默认值，并实现：

```js
function activateProtectionView(view) {
  const allowed = new Set(['verification', 'directory', 'import']);
  const activeView = allowed.has(view) ? view : 'verification';
  state.protectionWorkspace.activeView = activeView;
  $$('[data-protection-view]').forEach(button => {
    const active = button.dataset.protectionView === activeView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-protection-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.protectionPanel !== activeView);
  });
}
```

在 delegated click handler 中处理 `[data-protection-view]`，并在 `renderProtectedWorkspace()` 中调用当前 active view。管理员可见三个视图；只有重复核验权限但无保护管理权限的用户只能看到 `verification`，另两个按钮和面板必须隐藏。

- [ ] **Step 4: 运行专项与 #306 结构回归**

Run: `node --test test/issue314_verification_center_structure.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js`

Expected: 全部 PASS；若 #306 测试依赖旧容器切片，只更新测试定位，不删除业务断言。

- [ ] **Step 5: 提交**

```bash
git add sales-crm.html sales-assets/app.js test/issue314_verification_center_structure.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js
git commit -m "refactor: split customer protection workspace views (#314)"
```

---

### Task 2: 将两类核验记录适配为共享队列与详情

**Files:**
- Modify: `sales-crm.html:662`
- Modify: `sales-assets/app.js:6293-6568`
- Test: `test/issue314_verification_center_interaction.test.js`

**Interfaces:**
- Produces: `pendingRecordKey(type, item)` → `conflict:<conflictId>` 或 `duplicate:<id>`。
- Produces: `pendingQueueRecords()` → `Array<{ key, type, name, reference, risk, status, time, raw }>`，仅包含当前核验类型和当前页数据。
- Produces: `state.pendingCenter.selectedKey: string` 与 `state.pendingCenter.query: string`；旧 `expandedConflictId` / `expandedId` 仅在迁移期间兼容，最终渲染不依赖展开卡。
- Produces: `selectPendingRecord(key, { openMobile = false, focus = false } = {})`。
- Produces: `renderPendingQueue()` 和 `renderPendingDetail()`；`renderPendingCenter()` 负责共同调用。

- [ ] **Step 1: 写失败的模型与渲染契约**

创建 `test/issue314_verification_center_interaction.test.js`：

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

test('pending center renders a selectable queue and persistent detail', () => {
  for (const signature of [
    'function pendingRecordKey',
    'function pendingQueueRecords',
    'function selectPendingRecord',
    'function renderPendingQueue',
    'function renderPendingDetail',
  ]) assert.match(app, new RegExp(signature));
  assert.match(app, /data-pending-record-key/);
  assert.match(app, /selectedKey/);
});

test('identity decision UI adapts to candidate availability', () => {
  assert.match(app, /function protectedConflictDecisionMarkup/);
  assert.match(app, /function duplicateReviewDecisionMarkup/);
  assert.match(app, /没有可比较的已有客户/);
  assert.match(app, /要求补充资料/);
  assert.match(app, /crmNames.*length/s);
  assert.match(app, /是同一个客户/);
  assert.match(app, /不是同一个客户/);
  assert.doesNotMatch(app, /当前线索没有可关联的已有客户，暂不能合并/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/issue314_verification_center_interaction.test.js`

Expected: FAIL，五个共享工作台函数和 `selectedKey` 尚不存在。

- [ ] **Step 3: 实现队列适配器与选择状态**

在 `state.pendingCenter` 增加 `selectedKey: ''`、`query: ''`、`mobileDetailOpen: false`。实现适配后，用统一过滤器处理当前加载页：

```js
function pendingRecordKey(type, item) {
  return type === 'conflicts' ? `conflict:${item.conflictId}` : `duplicate:${item.id}`;
}

function pendingQueueRecords() {
  let records;
  if (state.pendingCenter.activeTab === 'conflicts') {
    records = state.protectedCustomers.conflicts.map(item => ({
      key: pendingRecordKey('conflicts', item), type: 'conflicts', raw: item,
      name: item.leadNames?.[0]?.rawName || '待核验线索',
      reference: item.leadNames?.[0]?.externalCustomerId || '',
      risk: item.crmNames?.length ? '疑似已有客户' : '疑似重名',
      status: item.status === 'retry' ? '待补充资料' : item.status === 'resolved' ? '已解决' : '待管理员确认',
      time: item.createdAt || item.updatedAt || '',
    }));
  } else {
    records = state.duplicateReviews.items.map(item => ({
      key: pendingRecordKey('duplicates', item), type: 'duplicates', raw: item,
      name: item.input?.companyName || '未填写公司名称',
      reference: item.input?.externalCustomerId || item.id,
      risk: item.selectedCandidate?.customerId ? '疑似已有客户' : '证据不足',
      status: item.status === 'needs_info' ? '待补充资料' : item.status === 'pending' ? '待管理员确认' : '已解决',
      time: item.createdAt || '',
    }));
  }
  const query = state.pendingCenter.query.trim().toLocaleLowerCase('zh-CN');
  return query ? records.filter(item => `${item.name} ${item.reference}`.toLocaleLowerCase('zh-CN').includes(query)) : records;
}
```

每次加载/切类型后调用 `ensurePendingSelection()`：现有 selectedKey 仍存在则保留，否则选第一条；空列表清空。`selectPendingRecord` 必须验证 key 来自当前适配结果，禁止用任意 key 构造详情。

- [ ] **Step 4: 实现共享工作台 DOM 渲染**

把 `#pendingVerificationList` 替换为：

```html
<div id="pendingWorkbench" class="pending-workbench">
  <aside class="pending-queue" aria-label="待核验队列">
    <label class="pending-queue-search">搜索当前页客户名称或编号<input id="pendingQueueSearch" type="search" autocomplete="off" placeholder="输入名称或编号"></label>
    <div id="pendingQueueList" class="pending-queue-list"></div>
    <div id="pendingQueuePagination" class="shared-pagination" data-pagination="protected_conflicts"></div>
  </aside>
  <article id="pendingDetail" class="pending-detail" aria-live="polite"></article>
</div>
```

`renderPendingQueue()` 只渲染紧凑按钮行；`renderPendingDetail()` 根据 `selectedKey` 调用 `protectedConflictDetailMarkup(item)` 或 `duplicateReviewDetailMarkup(review)`。迁移现有比较、证据、候选搜索、批量选择和裁决控件时保留所有 `data-*` 事件属性。

在 delegated input handler 中处理 `#pendingQueueSearch`：同步 `state.pendingCenter.query`，调用 `ensurePendingSelection()` 后重新渲染队列和详情；切换身份冲突/重复核验类型时清空 query 并清空输入框。

- [ ] **Step 5: 实现无候选与有候选两种身份冲突详情**

实现 `protectedConflictDecisionMarkup(item, model)`：

```js
function protectedConflictDecisionMarkup(item, model) {
  const candidates = Array.isArray(item.crmNames) ? item.crmNames : [];
  if (!candidates.length) {
    return `<div class="pending-evidence-empty">
      <strong>没有可比较的已有客户</strong>
      <p>补充官网、企业注册号、公司邮箱或所在国家后重新核验。</p>
    </div>
    <label class="pending-decision-option">
      <input type="radio" name="conflict-decision-${esc(item.conflictId)}" value="supplement_and_retry" checked>
      <span><strong>要求补充资料</strong><small>退回补充身份信息后重新核验</small></span>
    </label>`;
  }
  return `<div class="pending-comparison">${protectedConflictComparisonMarkup(item)}</div>
    <div class="pending-decision-options">${protectedConflictPendingOptions(item, model)}</div>`;
}
```

无候选状态不能渲染 `link_existing` 和 `confirm_new` 两个 disabled 选项。有候选时继续使用 `protectedConflictPendingOptions` 保持后端门控。

重复核验使用同一原则，新增：

```js
function duplicateReviewDecisionMarkup(review, interactionPending) {
  const candidate = review.selectedCandidate || {};
  if (!candidate.customerId) {
    return `<label class="pending-decision-option">
      <input type="radio" name="duplicate-resolution-${esc(review.id)}" value="needs_info" data-duplicate-resolution="needs_info" data-review-id="${esc(review.id)}" checked ${interactionPending ? 'disabled' : ''}>
      <span><strong>要求补充资料</strong><small>补充官网、联系人或来源说明后重新核验</small></span>
    </label>`;
  }
  return duplicateReviewCandidateDecisionMarkup(review, interactionPending);
}
```

`duplicateReviewCandidateDecisionMarkup` 承接现有三个 radio、`protectedExact` 禁止放行和 candidate id 属性；不得改变既有 handler 所需的 `data-duplicate-resolution`、`data-review-id`、`data-candidate-id`。

- [ ] **Step 6: 运行专项和裁决回归**

Run: `node --test test/issue314_verification_center_interaction.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js test/issue306_resolution_refresh.test.js`

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add sales-crm.html sales-assets/app.js test/issue314_verification_center_interaction.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js
git commit -m "feat: add split-view verification workbench (#314)"
```

---

### Task 3: 连续处理、深链、错误保留和键盘焦点

**Files:**
- Modify: `sales-assets/app.js:6569-6784`
- Test: `test/issue314_verification_center_interaction.test.js`
- Test: `test/issue306_resolution_refresh.test.js`

**Interfaces:**
- Produces: `movePendingSelection(delta)`，仅在当前队列内移动并在边界禁用。
- Produces: `pendingSelectionIndex()` → 当前索引，未选择返回 `-1`。
- Produces: `selectPendingAfterMutation(previousIndex)`，刷新后选择 `min(previousIndex, lastIndex)`。
- Preserves: mutation 期间按钮 disabled；API 错误保留 selectedKey、radio、备注和候选搜索状态。
- Preserves: 成功后刷新线索池和今日任务计数；刷新失败只 toast，不撤销已成功裁决。

- [ ] **Step 1: 增加失败测试**

追加到 `test/issue314_verification_center_interaction.test.js`：

```js
test('sequential review keeps position and advances only after success', () => {
  assert.match(app, /function movePendingSelection\(delta/);
  assert.match(app, /function selectPendingAfterMutation\(previousIndex/);
  assert.match(app, /保存并处理下一条/);
  assert.match(app, /pendingSelectionIndex\(\)/);
  assert.match(app, /catch \(error\)[\s\S]*selectedKey/s);
});

test('deep links select detail instead of expanding an inline card', () => {
  const start = app.indexOf('function applyDuplicateReviewDeepLink');
  const end = app.indexOf('async function loadDuplicateReviews', start);
  const source = app.slice(start, end);
  assert.match(source, /selectPendingRecord/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /expandedConflictId/);
  assert.doesNotMatch(source, /expandedId/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/issue314_verification_center_interaction.test.js test/issue306_resolution_refresh.test.js`

Expected: FAIL，当前深链展开内联卡，身份冲突保存后没有统一下一条选择器。

- [ ] **Step 3: 实现上一条、下一条与保存后续选**

```js
function pendingSelectionIndex() {
  return pendingQueueRecords().findIndex(item => item.key === state.pendingCenter.selectedKey);
}

function movePendingSelection(delta) {
  const records = pendingQueueRecords();
  const current = pendingSelectionIndex();
  const next = Math.min(records.length - 1, Math.max(0, current + delta));
  if (records[next]) selectPendingRecord(records[next].key, { focus: true });
}

function selectPendingAfterMutation(previousIndex) {
  const records = pendingQueueRecords();
  if (!records.length) {
    state.pendingCenter.selectedKey = '';
    return;
  }
  const next = Math.min(Math.max(0, previousIndex), records.length - 1);
  selectPendingRecord(records[next].key, { focus: true });
}
```

在两个 resolve action 发请求前保存 `previousIndex`；API 成功并 reload 后调用 `selectPendingAfterMutation(previousIndex)`。按钮文案统一为 `保存并处理下一条`。API 抛错时不 reload、不改 selectedKey；详情根节点显示错误状态并保留当前输入。

- [ ] **Step 4: 改造深链和移动端返回**

`applyDuplicateReviewDeepLink()` 解析现有参数后：切换 protection view 到 `verification`，切换核验类型，加载完成后调用 `selectPendingRecord(key, { openMobile: true, focus: true })`。找不到记录只显示普通空/错误状态，不在 DOM 输出目标 ID 或权限外信息。移动端返回按钮只设 `mobileDetailOpen=false`，不清空 selectedKey。

- [ ] **Step 5: 运行专项回归**

Run: `node --test test/issue314_verification_center_interaction.test.js test/issue306_resolution_refresh.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add sales-assets/app.js test/issue314_verification_center_interaction.test.js test/issue306_resolution_refresh.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js
git commit -m "feat: support continuous verification and deep links (#314)"
```

---

### Task 4: 桌面双栏与移动端列表/详情响应式实现

**Files:**
- Modify: `sales-assets/app.css:697-801`
- Modify: `sales-assets/app.js`（仅移动端 open/back class）
- Test: `test/issue314_verification_center_structure.test.js`

**Interfaces:**
- Produces CSS classes: `.protection-workspace-tabs`、`.pending-workbench`、`.pending-queue`、`.pending-queue-item`、`.pending-detail`、`.pending-detail-actions`、`.pending-mobile-back`。
- Desktop: `grid-template-columns: minmax(330px, 380px) minmax(0, 1fr)`；详情和队列稳定，不因 hover/状态/文字改变宽度。
- Mobile (`max-width: 760px`): 队列与详情为两个屏幕状态；`.mobile-detail-open` 控制详情；操作栏 sticky/fixed 且内容有底部预留。

- [ ] **Step 1: 写失败 CSS 契约**

追加到 `test/issue314_verification_center_structure.test.js`：

```js
test('workbench has stable desktop tracks and mobile two-screen mode', () => {
  assert.match(css, /\.pending-workbench\{[^}]*grid-template-columns:minmax\(330px,380px\) minmax\(0,1fr\)/);
  assert.match(css, /\.pending-queue-item\{[^}]*min-height:72px/);
  assert.match(css, /\.pending-detail-actions\{[^}]*position:sticky/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.pending-detail\.mobile-detail-open/);
  assert.match(css, /min-height:44px/);
  assert.doesNotMatch(css, /font-size:clamp\([^)]*vw/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/issue314_verification_center_structure.test.js`

Expected: FAIL，新工作台 CSS 尚不存在。

- [ ] **Step 3: 实现桌面布局**

```css
.pending-workbench{display:grid;grid-template-columns:minmax(330px,380px) minmax(0,1fr);min-height:620px;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.pending-queue{min-width:0;border-right:1px solid var(--line);display:flex;flex-direction:column}
.pending-queue-list{min-height:0;overflow:auto}
.pending-queue-item{width:100%;min-height:72px;padding:12px 14px;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;cursor:pointer}
.pending-queue-item.active{background:var(--brand-subtle);box-shadow:inset 3px 0 var(--brand)}
.pending-detail{min-width:0;display:flex;flex-direction:column;background:#fff}
.pending-detail-body{min-width:0;overflow:auto;padding:18px}
.pending-detail-actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line);background:#fff}
```

沿用现有 `--brand`、`--brand-subtle`、`--line`、`--ink`、`--muted`。移除已不再使用的 inline expanded-card CSS，保留候选搜索、事实对比和批量栏规则。

- [ ] **Step 4: 实现移动端两个屏幕状态**

```css
@media(max-width:760px){
  .pending-workbench{display:block;min-height:0;border-left:0;border-right:0;border-radius:0;overflow:hidden}
  .pending-queue{border-right:0}
  .pending-queue-item{min-height:72px;padding:12px 14px}
  .pending-detail{position:fixed;inset:0;z-index:80;transform:translateX(100%);transition:transform .2s ease-out}
  .pending-detail.mobile-detail-open{transform:translateX(0)}
  .pending-detail-body{padding:14px 14px 96px;overflow-y:auto;overflow-x:hidden}
  .pending-mobile-back{display:inline-flex;align-items:center;min-height:44px}
  .pending-detail-actions{min-height:64px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -8px 24px rgba(23,35,29,.08)}
  .pending-comparison{grid-template-columns:minmax(0,1fr)}
}
```

增加 `@media (prefers-reduced-motion: reduce)` 关闭详情滑动；320px 下操作按钮改为单列或主按钮弹性占满，文本不截断。

- [ ] **Step 5: 运行结构、交互和现有移动端契约测试**

Run: `node --test test/issue314_verification_center_structure.test.js test/issue314_verification_center_interaction.test.js test/issue306_protection_workbench.test.js test/sales_access_ui.test.js test/sales_menu.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add sales-assets/app.css sales-assets/app.js test/issue314_verification_center_structure.test.js
git commit -m "style: add responsive verification workbench (#314)"
```

---

### Task 5: 完整回归、浏览器验收、版本号与 PR

**Files:**
- Modify: `sales-crm.html`（所有 `/sales-assets/*.js?v=` 与 `/sales-assets/app.css?v=`）
- Modify: 依赖旧版本字符串的测试文件
- Create: `docs/evidence/issue-314-verification.md`

**Interfaces:**
- Produces UI version: `20260816-issue314-verification-workbench`，`data-app-version` 与全部静态资源 query 一致。
- Produces browser evidence at 1440×900、320×844、375×844、390×844、430×932。
- Produces PR against `main`，body 包含 Issue #314、测试、桌面/移动截图、权限回归和发布说明。

- [ ] **Step 1: 更新缓存版本并写版本契约**

将 `sales-crm.html` 中本页 CSS/JS query 和 `data-app-version` 统一为 `20260816-issue314-verification-workbench`。更新现有版本断言，增加：

```js
test('all CRM frontend assets and visible badge share issue 314 version', () => {
  const version = '20260816-issue314-verification-workbench';
  assert.match(html, new RegExp(`data-app-version="${version}"`));
  const versions = [...html.matchAll(/sales-assets\/[^"]+\?v=([^"&]+)/g)].map(match => match[1]);
  assert.ok(versions.length >= 4);
  assert.deepEqual([...new Set(versions)], [version]);
});
```

- [ ] **Step 2: 运行静态与专项门禁**

```bash
node --check sales-assets/app.js
node --test test/issue314_verification_center_structure.test.js test/issue314_verification_center_interaction.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js test/issue306_resolution_refresh.test.js test/issue306_identity_conflict_loop.test.js test/issue306_dedupe_resolution_linkage.test.js
npm run check:copy
git diff --check
```

Expected: 所有命令 exit 0；Issue #314 和 #306 专项零失败；forbidden copy 扫描 clean。

- [ ] **Step 3: 运行完整 CI 等价门禁**

```bash
npm ci
npm test
npm run check:ai-boundary
node --check server.js
node --check scripts/deploy-state.js
node --check scripts/install-auto-deploy.js
zsh -n scripts/deploy-from-github.sh
bash -n deploy/backup.sh
python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts
```

Expected: 与 `.github/workflows/ci.yml` 一致，全部 exit 0。若仅出现已知环境失败，必须先与 `origin/main` 同命令对照并记录；不得把新增失败归为基线问题。

- [ ] **Step 4: 浏览器验收本地候选版本**

使用生产数据库副本和本地服务，分别以管理员与销售身份验证。每个 viewport 收集 screenshot 和只读 DOM 指标：

- 1440×900：双栏存在；队列宽 330–400px；详情固定；页面 `scrollWidth === innerWidth`。
- 搜索当前页：名称和编号均可过滤，切换核验类型后清空，分页能力保持可用。
- 无候选：只有 `要求补充资料`，不存在两个 disabled 裁决 radio。
- 有候选：对比、三裁决、候选切换可见；后端门控状态正确。
- 保存成功：toast 可见，选择进入下一条；保存失败：当前项、备注和决定保留。
- 深链：`?conflict=` 与 `?review=` 选择对应队列项，不依赖内联展开。
- 320/375/390/430px：进入详情、返回队列、固定操作栏、对比无横向溢出、页面无横向滚动。
- 销售：导航和核验详情均不可见，直接 API 仍按既有测试返回 403。

- [ ] **Step 5: 写验证证据并提交**

`docs/evidence/issue-314-verification.md` 必须记录：基线 SHA、专项/全量测试计数、五个 viewport 指标、管理员/销售结果、截图路径、无候选/有候选/失败状态、未解决风险。然后：

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/issue314_verification_center_structure.test.js test/issue314_verification_center_interaction.test.js test/issue306_identity_conflict_workbench.test.js test/issue306_protection_workbench.test.js test/issue306_resolution_refresh.test.js docs/evidence/issue-314-verification.md
git commit -m "test: verify issue 314 workbench across roles and viewports"
git push -u origin codex/issue-314-verification-center-redesign
```

- [ ] **Step 6: 创建 PR 并等待门禁**

```bash
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-314-verification-center-redesign --title "重构待核验中心分栏工作台（Issue #314）" --body-file docs/evidence/issue-314-verification.md
gh pr checks --repo mewmind-chen/russia-crm-local --watch
```

Expected: PR CI `test` SUCCESS。评审发现必须在分支修复、重跑专项和全量门禁后再合并。合并采用 squash；未获得合并授权时停在 CI 绿色 PR。

---

### Task 6: 合并后自动部署与生产仓库验收

**Files/State:**
- Source: `mewmind-chen/russia-crm-local` `main`
- Production root: `/Users/ylf/Desktop/projects/tradepulse-production`
- Production state: `/Users/ylf/Desktop/projects/tradepulse-production/state/state.json`
- Current symlink: `/Users/ylf/Desktop/projects/tradepulse-production/current`
- Previous symlink: `/Users/ylf/Desktop/projects/tradepulse-production/previous`
- Shared database: `/Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db`

**Interfaces:**
- Auto deploy source: only `origin/main` via `com.russia-crm.auto-deploy` / `scripts/deploy-from-github.sh`。
- Deploy sequence: fetch main → immutable candidate → `npm ci` + full tests → SQLite backup → atomic `previous`/`current` switch → services restart → local/public health checks。
- Failure behavior: deployment script records `lastFailedSha`/stage and atomically restores previous release; database is never automatically restored.

- [ ] **Step 1: 合并并确定权威 SHA**

合并授权后 squash merge PR，然后运行：

```bash
git fetch origin main
merged_sha="$(gh pr view --repo mewmind-chen/russia-crm-local --json mergeCommit -q '.mergeCommit.oid')"
test "$(git rev-parse origin/main)" = "$merged_sha"
gh run list --repo mewmind-chen/russia-crm-local --branch main --limit 3
```

Expected: `origin/main` 等于 PR merge SHA，`main` 的 CI run 为 SUCCESS。CI 未成功时禁止部署。

- [ ] **Step 2: 等待默认自动不可变部署**

先读取自动部署状态，不直接修改生产仓库：

```bash
npm run deploy:mac:status
launchctl print "gui/$(id -u)/com.russia-crm.auto-deploy"
```

Expected: LaunchAgent 已加载；轮询后 `lastSuccessfulSha` 更新为 merge SHA。默认等待自动部署；只有自动部署没有触发且状态无运行中任务时，才使用仓库脚本恢复：`zsh scripts/deploy-from-github.sh --force`。不得手动创建或替换 symlink。

- [ ] **Step 3: 核对生产仓库原子发布状态**

```bash
node scripts/deploy-state.js status
readlink /Users/ylf/Desktop/projects/tradepulse-production/current
readlink /Users/ylf/Desktop/projects/tradepulse-production/previous
```

Expected:
- `state.json.lastSuccessfulSha` 等于 merge SHA。
- `lastFailedSha`、`lastFailedAt`、`lastFailedStage` 为空。
- `current` 指向 `releases/<merge-sha前12位>`。
- `previous` 指向部署前 release，且不等于 `current`。
- `state/backups/` 存在本次 `crm-before-<short-sha>-<timestamp>-<pid>.db`。

- [ ] **Step 4: 运行本地、公网和数据库发布门禁**

```bash
merged_sha="$(gh pr view --repo mewmind-chen/russia-crm-local --json mergeCommit -q '.mergeCommit.oid')"
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
curl --fail --silent --show-error https://crm.newmindchen.com/healthz
scripts/verify-release-gate.sh --health-url https://crm.newmindchen.com/healthz --expected-sha "$merged_sha" --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db
```

Expected: 两个 health JSON 均为 `ok=true`、`database="ok"`，且 `releaseSha` 等于命令计算出的 `merged_sha`；release gate 输出同一个完整 SHA；SQLite integrity 和 foreign keys 通过。

- [ ] **Step 5: 生产浏览器只读验收**

管理员在 `https://crm.newmindchen.com/#protectedCustomers` 验证：

- 侧栏版本为 `20260816-issue314-verification-workbench`。
- 三个一级视图存在，待核验首屏为双栏。
- 当前真实 34 条或最新数量在队列呈现，不生成 34 个全宽展开卡。
- 无候选生产记录只显示补资料动作。
- 保护客户与批量导入视图原有功能可见；本步骤不提交真实裁决或真实批次。
- 390×844 页面无横向溢出，队列进入详情和返回正常，操作栏不遮挡内容。

销售只读验收：核验导航、保护客户、候选详情均不可见。保留桌面与移动截图，并将结果追加到 `docs/evidence/issue-314-verification.md` 的生产段落。

- [ ] **Step 6: 处理失败或完成发布记录**

若部署脚本失败：停止产品写入验收，读取 `state.json` 和 deploy log，确认 `current` 已自动回到 `previous` 且公网 health 返回旧 SHA；禁止自动恢复数据库。相同失败未定位前不得重复 `--force`。

若全部通过：在 Issue #314 评论 merge SHA、CI run、current/previous release、备份路径、release gate 输出、管理员/销售与移动端结果，然后关闭 Issue #314。

---

## Self-Review

- Spec coverage: Issue #314 的三个一级视图、双栏队列/详情、无候选自适应、连续处理、深链、移动端、权限、版本和生产发布分别由 Task 1–6 覆盖。
- Scope: 后端、数据库和裁决规则明确排除；现有 #306 测试作为防回退门禁。
- Type consistency: `activeView` 只使用 `verification|directory|import`；`activeTab` 只使用 `conflicts|duplicates`；`selectedKey` 统一使用 `conflict:<id>|duplicate:<id>`。
- Release consistency: 默认自动部署，仅 `origin/main`，生产 `current/previous/state.json`、本地/公网 health 和 SQLite gate 必须全部一致。

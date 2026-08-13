# Issue #283 Mismatch Record Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让销售、经理和管理员都能从“不对口记录”打开自己权限范围内的客户只读详情，修复首列错位，并让“查看完整客户资料”成为真实可用的展开入口。

**Architecture:** 列表与详情统一使用 `recordKey`（`account:<id>` / `intake:<id>`）和同一套 scope；新详情 API 返回统一 DTO，后端决定可见字段与 actions。前端只按 DTO 渲染，不通过“客户仍在 CRM”来猜权限；完整资料在当前侧栏展开同一份已授权 payload，不跳转到可能无权限的 CRM/iframe 页面。

**Tech Stack:** Node.js CommonJS、Express、better-sqlite3、原生 JavaScript/CSS、`node:test`、GitHub Actions、现有 release-gate 脚本。

## Global Constraints

- 前置条件：Issue #284 已合并、部署并完成三账户生产验收。
- 分支名：`codex/issue-283-mismatch-record-detail`，必须从包含 #284 的最新 `origin/main` 创建。
- 列表可见性与详情可见性必须严格相同；禁止前端扩大权限。
- 无目标返回 404；目标存在但超出 scope 返回 403；记录键格式错误返回 404。
- 销售只能查看自己曾负责或自己执行不对口处理的记录；`view_all_customers` 用户按现有定义查看全量。
- 联系人、AI 洞察、标签等字段继续执行既有权限裁剪。
- 详情只读；重分配/恢复操作只从服务端 `actions` 渲染，不能按角色在前端猜测。
- `account:` 与 `intake:` 必须返回相同顶层 DTO，缺失历史返回空数组而不是伪造 CRM 客户。

---

## Task 1: 建立 #283 分支与基线

**Files:**

- Verify: `docs/superpowers/specs/2026-08-13-five-customer-workflow-issues-design.md`
- Verify: `test/issue137_recycle_backend.test.js`
- Verify: `test/issue137_recycle_ui_contract.test.js`
- Verify: `test/issue273_mismatch_recycle_backend.test.js`

- [ ] **Step 1: 从最新主干创建隔离工作树**

```bash
cd /Users/ylf/Desktop/projects/tradepulse-development
git fetch origin
git worktree add worktrees/issue-283-mismatch-record-detail -b codex/issue-283-mismatch-record-detail origin/main
cd worktrees/issue-283-mismatch-record-detail
git log -1 --oneline
git status --short
```

Expected: 最新提交包含已部署的 #284；工作树干净。

- [ ] **Step 2: 跑现有回收链路基线**

```bash
node --test \
  test/issue137_recycle_backend.test.js \
  test/issue137_recycle_ui_contract.test.js \
  test/issue273_mismatch_recycle_backend.test.js
```

Expected: 全部通过。

---

## Task 2: 让列表 scope 成为详情权限的单一来源

**Files:**

- Modify: `lib/business_page_filters.js` — `recycleScope()`、`module.exports`
- Create: `test/issue283_mismatch_profile_backend.test.js`

- [ ] **Step 1: 创建详情后端测试骨架并写 recordKey/scope 失败用例**

测试 fixture 至少包含：

- 销售 `wu` 的 `account:CRM-WU` 不对口记录。
- 销售 `wu` 的 `intake:INTAKE-WU` 领取前不对口记录。
- 另一销售的 account/intake 记录。
- 经理或管理员拥有 `view_all_customers`。

先调用尚不存在的：

```text
GET /api/sales-crm/mismatch-recycle/:recordKey/profile
```

断言矩阵：

| 身份 | 自己 account | 自己 intake | 他人记录 | 格式错误 | 不存在 |
|---|---:|---:|---:|---:|---:|
| 销售 | 200 | 200 | 403 | 404 | 404 |
| view_all 用户 | 200 | 200 | 200 | 404 | 404 |

在实现前，200 用例应因路由不存在而失败。

- [ ] **Step 2: 运行新测试确认 Red**

```bash
node --test test/issue283_mismatch_profile_backend.test.js
```

Expected: 新详情路由返回 404，授权成功用例失败。

- [ ] **Step 3: 导出既有 `recycleScope()`**

在 `lib/business_page_filters.js` 的导出对象中加入：

```js
module.exports = {
  PAGE_CONFIG,
  accountScope,
  recycleScope,
  // existing exports remain unchanged
};
```

不要创建第二套 owner 条件。详情查询必须调用这个 helper，保证列表和详情同步演进。

- [ ] **Step 4: 为 intake scope 增加同源 helper**

将 `listRecycleRows()` 中的 intake 可见性条件提取为：

```js
function mismatchIntakeScope(user, alias = 'i') {
  const conditions = [
    `${alias}.status='rejected'`,
    `COALESCE(${alias}.crm_customer_id,'')=''`,
    `COALESCE(${alias}.rejected_at,'')!=''`,
  ];
  const params = [];
  if (!hasPermission(user, 'view_all_customers')) {
    conditions.push(`(${alias}.previous_owner_id=? OR ${alias}.rejected_by=?)`);
    params.push(String(user?.id || ''), String(user?.id || ''));
  }
  return { conditions, params };
}
```

让 `listRecycleRows()` 使用该 helper，并导出 `mismatchIntakeScope`。先运行既有 `issue273` 测试，确认列表行为不变。

- [ ] **Step 5: 运行列表回归并提交 scope 提取**

```bash
node --test test/issue273_mismatch_recycle_backend.test.js
git add lib/business_page_filters.js test/issue283_mismatch_profile_backend.test.js
git commit -m "refactor: share mismatch record visibility scopes"
```

Expected: 既有列表测试通过；新详情测试仍因路由未实现而失败。

---

## Task 3: 增加统一详情授权策略与路由识别

**Files:**

- Modify: `lib/access_control.js` — `SALES_ROUTE_POLICIES`、`salesRouteKey()`
- Modify: `test/access_control.test.js`
- Modify: `test/issue283_mismatch_profile_backend.test.js`

- [ ] **Step 1: 添加策略测试**

断言以下 route key 可识别：

```js
assert.equal(
  salesRouteKey('GET', '/mismatch-recycle/account%3ACRM-WU/profile'),
  'GET /mismatch-recycle/:recordKey/profile',
);
```

并断言策略允许任一权限：

```js
{
  anyPermissions: ['manage_customer_recycle', 'view_own_mismatch_history']
}
```

如果当前权限目录没有 `view_own_mismatch_history`，先在已有销售默认权限集合中加入它，并为销售/经理/管理员 bootstrap 权限测试补断言；不要借用写权限代表只读权限。

- [ ] **Step 2: 运行 access-control 测试确认失败**

```bash
node --test test/access_control.test.js
```

Expected: 新 route key 或新 policy 缺失。

- [ ] **Step 3: 添加策略与正则映射**

策略表加入：

```js
'GET /mismatch-recycle/:recordKey/profile': {
  anyPermissions: ['manage_customer_recycle', 'view_own_mismatch_history'],
},
```

在 restore route 的通配判断前加入：

```js
if (/^\/mismatch-recycle\/[^/]+\/profile$/.test(path)) {
  return `${verb} /mismatch-recycle/:recordKey/profile`;
}
```

- [ ] **Step 4: 运行策略测试并提交**

```bash
node --test test/access_control.test.js
node --check lib/access_control.js
git add lib/access_control.js test/access_control.test.js
git commit -m "feat: authorize read-only mismatch record profiles"
```

---

## Task 4: 实现统一 `recordKey` 解析和 account 详情

**Files:**

- Modify: `lib/sales_crm.js` — imports、`loadRecycleProfile()` 附近、route registration
- Modify: `test/issue283_mismatch_profile_backend.test.js`
- Verify: `test/issue137_recycle_backend.test.js`

- [ ] **Step 1: 添加严格 recordKey 解析测试**

覆盖：空值、没有冒号、多个冒号、未知 source、空 id、有效 `account:CRM-WU`、有效 `intake:INTAKE-WU`。无效键都返回 404 和稳定错误码 `MISMATCH_RECORD_NOT_FOUND`。

- [ ] **Step 2: 实现解析 helper**

在 `loadRecycleProfile()` 前加入：

```js
function parseMismatchRecordKey(recordKey) {
  const decoded = String(recordKey || '').trim();
  const parts = decoded.split(':');
  if (parts.length !== 2 || !['account', 'intake'].includes(parts[0]) || !parts[1]) {
    throw recycleError(404, '不对口记录不存在', 'MISMATCH_RECORD_NOT_FOUND');
  }
  return { sourceType: parts[0], sourceId: parts[1], recordKey: decoded };
}
```

- [ ] **Step 3: 先把 `loadRecycleProfile()` 拆成“查询 + payload 构建”**

提取两个具名函数：`findRecycleAccount(value, user, customerId, options = {})` 负责执行当前 scoped SELECT；`buildRecycleAccountProfile(value, user, account, options = {})` 包含当前从 AI feature-state 读取开始到联系人裁剪结束的完整 payload 构建代码。移动代码时不改变 SQL 字段、排序、timeline 或返回字段。

要求：

- 现有 `loadRecycleProfile()` 仍先要求 `manage_customer_recycle`。
- 现有 `GET /accounts/:customerId/recycle-profile` 的 JSON、状态码和联系人裁剪不变。
- `mismatchOnly` 查询必须额外要求 `a.recycle_kind='mismatch'`。
- scope 使用 `recycleScope(user)`，不能复制 owner 条件。

- [ ] **Step 4: 运行旧 recycle-profile 回归**

```bash
node --test test/issue137_recycle_backend.test.js
```

Expected: 全部通过，证明重构无行为变化。

- [ ] **Step 5: 实现 account 分支与 403/404 区分**

新增 `loadMismatchRecordProfile(user, recordKey, options)`。对于 account：

1. 用 `recycleScope(user)` + id + `recycle_kind='mismatch'` 查授权目标。
2. 未命中时再用 id + recycled + mismatch 做不带用户 scope 的 existence probe。
3. 存在但越权 → 403 `MISMATCH_RECORD_FORBIDDEN`；不存在 → 404 `MISMATCH_RECORD_NOT_FOUND`。
4. 使用 `buildRecycleAccountProfile()` 取得完整历史并规范为统一 DTO。

统一 DTO 的顶层必须固定：

```js
{
  ok: true,
  recordKey,
  sourceType: 'account',
  customer: {
    accountId, intakeItemId: '', externalCustomerId,
    nickname, companyName, country, city, website,
    industry, customerType, products, description,
  },
  recycle: {
    kind: 'mismatch', reason, previousOwnerId, previousOwnerName,
    recycledBy, recycledByName, recycledAt,
  },
  profile: {
    customerPool, customers, reconJobs, reconResults,
    contactReconJobs, people, accountContacts,
  },
  history: {
    activities, rfqs, quotes, orders, timeline, evaluations, auditLog,
  },
  actions,
}
```

销售只读请求的 `actions` 为空；管理用户只获得既有服务端允许的 actions。

- [ ] **Step 6: 注册 no-store GET route**

```js
app.get('/api/sales-crm/mismatch-recycle/:recordKey/profile', (req, res) => {
  const value = db();
  try {
    const payload = loadMismatchRecordProfile(req.salesUser, req.params.recordKey, {
      hardFlags: hardFeatureFlags,
      isImpersonating: Boolean(req.impersonation),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(redactUnauthorizedProfileTags(value, req.salesUser, payload));
  } catch (error) {
    sendApiError(res, error);
  } finally {
    value.close();
  }
});
```

- [ ] **Step 7: 跑 account 测试并提交**

```bash
node --test test/issue283_mismatch_profile_backend.test.js test/issue137_recycle_backend.test.js
node --check lib/sales_crm.js
git add lib/sales_crm.js test/issue283_mismatch_profile_backend.test.js
git commit -m "feat: load authorized account mismatch profiles"
```

---

## Task 5: 实现 intake 详情并保持统一 DTO

**Files:**

- Modify: `lib/sales_crm.js` — `loadMismatchRecordProfile()`
- Modify: `test/issue283_mismatch_profile_backend.test.js`

- [ ] **Step 1: 添加 intake 完整性与裁剪测试**

断言：

- `sourceType === 'intake'`，`customer.intakeItemId` 有值、`accountId === ''`。
- `profile.customerPool` 有对应客户主档。
- `history.activities/rfqs/quotes/orders/timeline/evaluations/auditLog` 都是数组；无 CRM 历史时为空。
- 无 `view_contacts` 时 `people`、`accountContacts` 和其他联系方式被裁剪。
- 管理员可能有 `restore` action，销售没有。

- [ ] **Step 2: 运行 intake 测试确认失败**

```bash
node --test test/issue283_mismatch_profile_backend.test.js
```

Expected: account 分支通过，intake 分支未实现而失败。

- [ ] **Step 3: 用 `mismatchIntakeScope()` 查询 intake 记录**

查询条件必须与列表一致；未命中时同样进行不带用户 scope 的 existence probe 区分 403/404。

构建访问上下文：

```js
const accessContext = buildAccessContext(value, user);
accessContext.externalCustomerIds.add(item.external_customer_id);
const master = getCustomerProfileData(accessContext, item.external_customer_id, {
  includeAI: aiEnabled,
  intakeReadOnly: true,
  intakeItemId: item.id,
  canEditNickname: false,
});
```

然后归一化到与 account 完全相同的 DTO；不存在的 CRM 历史明确使用 `[]`，不创建临时 account。

- [ ] **Step 4: 运行详情与恢复回归**

```bash
node --test \
  test/issue283_mismatch_profile_backend.test.js \
  test/issue273_mismatch_recycle_backend.test.js
```

Expected: 详情和 restore 均通过，联系人裁剪正确。

- [ ] **Step 5: 提交 intake 详情**

```bash
git add lib/sales_crm.js test/issue283_mismatch_profile_backend.test.js
git commit -m "feat: normalize intake mismatch profiles"
```

---

## Task 6: 前端所有记录可打开，修复首列对齐

**Files:**

- Modify: `sales-assets/app.js` — state、`renderRecycleBin()`、详情 open/close/click handlers
- Modify: `sales-assets/app.css`
- Create: `test/issue283_mismatch_profile_ui.test.js`
- Modify: `test/issue137_recycle_ui_contract.test.js`

- [ ] **Step 1: 写静态 UI 失败测试**

断言：

```js
assert.match(renderBlock, /data-open-mismatch-record/);
assert.doesNotMatch(renderBlock, /canOpenProfile = row\.sourceType === 'account'/);
assert.match(openBlock, /mismatch-recycle\/\$\{encodeURIComponent\(recordKey\)\}\/profile/);
assert.match(css, /\.mismatch-record-table[\s\S]*th:first-child/);
```

并断言恢复/重分配按钮仍按 `row.actions` 渲染。

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/issue283_mismatch_profile_ui.test.js test/issue137_recycle_ui_contract.test.js
```

Expected: 当前代码只允许 account + manage 权限打开，测试失败。

- [ ] **Step 3: 增加详情状态和竞态保护**

在 state 中加入：

```js
mismatchRecordDetail: null,
mismatchRecordRequestEpoch: 0,
mismatchRecordExpanded: false,
```

新增 `openMismatchRecord(recordKey)`：递增 epoch、显示 loading、请求新 API；响应时只有 epoch 和当前 recordKey 均匹配才渲染。失败时关闭当前 loading drawer 并 toast。

- [ ] **Step 4: 修改列表交互**

`renderRecycleBin()` 中所有客户名都用：

```html
<button type="button" class="text-button tp-company-anchor"
  data-open-mismatch-record="${esc(row.recordKey)}">${esc(accountDisplayName(row))}</button>
```

行属性也用 `data-open-mismatch-record`。事件代理必须排除行内 select、恢复、重分配按钮，防止一次点击触发两个动作。

- [ ] **Step 5: 添加页面专用对齐 class**

为列表根或 table 增加 `mismatch-record-table`，在 `sales-assets/app.css` 添加：

```css
.mismatch-record-table .data-table th:first-child,
.mismatch-record-table .data-table td:first-child {
  text-align: left;
}

.mismatch-record-table .company-cell {
  align-items: flex-start;
}
```

不要修改所有 `.data-table`，避免影响其他页面。

- [ ] **Step 6: 运行 UI 测试并提交**

```bash
node --test test/issue283_mismatch_profile_ui.test.js test/issue137_recycle_ui_contract.test.js
node --check sales-assets/app.js
git add sales-assets/app.js sales-assets/app.css test
git commit -m "fix: open every authorized mismatch record"
```

---

## Task 7: 渲染统一只读详情与真实“完整资料”入口

**Files:**

- Modify: `sales-assets/app.js` — `renderDrawer()`、`closeDrawer()`、new renderer and click handler
- Modify: `sales-assets/app.css`
- Modify: `test/issue283_mismatch_profile_ui.test.js`

- [ ] **Step 1: 先写紧凑/完整两态测试**

静态测试要求 renderer：

- 同时读取 `detail.customer`、`detail.recycle`、`detail.profile`、`detail.history`。
- 有 `data-expand-mismatch-profile` 按钮。
- 收起文案为 `查看完整客户资料 →`，展开文案为 `收起完整客户资料`。
- 完整态包含联系人、活动、询价、报价、订单、时间线、评价和审计的明确空状态。
- 只遍历 `detail.actions` 渲染操作。
- `closeDrawer()` 清空详情、expanded 并递增 request epoch。

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/issue283_mismatch_profile_ui.test.js
```

Expected: 统一详情 renderer 尚不存在。

- [ ] **Step 3: 实现 `renderMismatchRecordDrawer(detail)`**

顶部固定显示：客户名、recordKey、来源类型、原负责人、不对口原因、处理人、处理时间、主档摘要。

按钮：

```html
<button class="text-button" type="button" data-expand-mismatch-profile>
  ${state.mismatchRecordExpanded ? '收起完整客户资料' : '查看完整客户资料 →'}
</button>
```

展开时在当前 drawer 内渲染 `profile` 与 `history`；每一空数组都显示具体文案，如“暂无跟进记录”“暂无联系人记录”，不得显示空白卡片。不要调用 `openCustomerProfile()`，因为不对口客户已经不在普通 CRM 可见集合。

- [ ] **Step 4: 动作严格按 DTO 渲染**

```js
const actions = new Set(detail.actions || []);
```

- `actions.has('reassign')` 才显示重分配。
- `actions.has('restore')` 才显示恢复。
- 销售只读详情没有动作按钮。
- 事件执行成功后关闭 drawer、重新加载不对口列表及导航计数。

- [ ] **Step 5: 接入 `renderDrawer()`、关闭和展开事件**

`renderDrawer()` 最先判断 `state.mismatchRecordDetail`；`closeDrawer()` 必须：

```js
state.mismatchRecordRequestEpoch += 1;
state.mismatchRecordDetail = null;
state.mismatchRecordExpanded = false;
```

`data-expand-mismatch-profile` 点击只切换 expanded 并重新渲染，不发第二次请求。

- [ ] **Step 6: 运行 UI 测试并提交**

```bash
node --test test/issue283_mismatch_profile_ui.test.js test/issue137_recycle_ui_contract.test.js
node --check sales-assets/app.js
git add sales-assets/app.js sales-assets/app.css test
git commit -m "feat: render complete read-only mismatch details"
```

---

## Task 8: 缓存版本、完整验证和 PR

**Files:**

- Modify: `sales-crm.html`
- Modify: all tests found by cache-token scan
- Verify: all changed source and tests

- [ ] **Step 1: 更新前端资源版本**

前置 #284 的版本应为 `20260813-issue284-disqualified-entry`。将 `sales-crm.html` 中 `app.css` 与 `app.js` 统一改为：

```text
20260813-issue283-mismatch-profile
```

同步更新测试：

```bash
rg -n "20260813-issue284-disqualified-entry" sales-crm.html test
```

Expected: 修改后旧 token 无匹配，新 token 覆盖 HTML 和相关断言。

- [ ] **Step 2: 运行聚焦回归**

```bash
node --test \
  test/access_control.test.js \
  test/issue137_recycle_backend.test.js \
  test/issue137_recycle_ui_contract.test.js \
  test/issue273_mismatch_recycle_backend.test.js \
  test/issue283_mismatch_profile_backend.test.js \
  test/issue283_mismatch_profile_ui.test.js
node --check lib/business_page_filters.js
node --check lib/access_control.js
node --check lib/sales_crm.js
node --check sales-assets/app.js
```

Expected: 全部通过。

- [ ] **Step 3: 运行完整测试和静态检查**

```bash
npm test
git diff --check origin/main...HEAD
git status --short
```

Expected: `npm test` 退出 0；无空白错误；无计划外文件。

- [ ] **Step 4: 提交 cache token**

```bash
git add sales-crm.html test
git commit -m "chore: refresh mismatch detail assets"
```

- [ ] **Step 5: 推送并创建 PR**

```bash
git push -u origin codex/issue-283-mismatch-record-detail
gh pr create \
  --repo mewmind-chen/russia-crm-local \
  --base main \
  --head codex/issue-283-mismatch-record-detail \
  --title "fix: restore authorized mismatch record details" \
  --body $'Closes #283\n\n- use one scope for mismatch lists and details\n- support account and intake record keys\n- expose complete authorized read-only history\n- fix first-column alignment and real detail expansion'
gh pr checks --repo mewmind-chen/russia-crm-local --watch
```

Expected: PR URL 返回，所有 required checks 通过。

---

## Task 9: 合并、部署和三账户生产矩阵

**Files:**

- Verify: `scripts/deploy-state.js`
- Verify: `scripts/verify-release-gate.sh`

- [ ] **Step 1: 合并并取得 SHA**

```bash
gh pr merge --repo mewmind-chen/russia-crm-local --squash --delete-branch
git fetch origin
release_sha=$(git rev-parse origin/main)
printf '%s\n' "$release_sha"
```

Expected: #283 关闭；输出 40 位生产目标 SHA。

- [ ] **Step 2: 运行本地与公网 gate**

```bash
node scripts/deploy-state.js status
zsh scripts/verify-release-gate.sh \
  --health-url http://127.0.0.1:3000/healthz \
  --expected-sha "$release_sha" \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db
zsh scripts/verify-release-gate.sh \
  --health-url https://crm.newmindchen.com/healthz \
  --expected-sha "$release_sha" \
  --database /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db
```

Expected: 两个 gate 均显示精确 SHA 与数据库通过。

- [ ] **Step 3: 生产验收矩阵**

以 account 型和 intake 型各一条测试记录执行：

| 身份 | 列表 | 详情 | 完整展开 | 操作 |
|---|---|---|---|---|
| 原销售 | 可见自己记录 | 可打开 | 可看授权字段 | 无管理按钮 |
| 其他销售 | 不可见 | 直接 URL 403 | 不可看 | 无 |
| 经理 | 按 scope 可见 | 可打开 | 联系人按权限 | 仅服务端 actions |
| 管理员 | 全量可见 | 可打开 | 完整授权字段 | 可恢复/重分配 |

额外确认：首列左对齐；按钮点击不会误触发行打开；强制刷新后记录、侧栏计数和筛选总数一致。全部通过后才开始 #285/#286/#287。

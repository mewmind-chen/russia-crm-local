# Issue #284 Disqualified Entry Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 禁止通过普通客户阶段编辑和经理终止动作写入 `disqualified`，所有新增“不对口”记录只能经过带原因、审计和回收记录的专用流程。

**Architecture:** 后端在两个通用写入口做最终拒绝，前端同步移除两个误导选项；既有专用 `POST /accounts/:customerId/reject` 流程保持不变。历史 `disqualified` 客户不允许从普通编辑弹窗隐式恢复，必须经“不对口记录”的专用恢复链路处理。

**Tech Stack:** Node.js CommonJS、Express、better-sqlite3、原生 JavaScript、`node:test`、GitHub Actions、现有 release-gate 脚本。

## Global Constraints

- 基线必须是 `origin/main`，并且已包含设计提交 `6c82a6b`；不要在用户的脏工作树 `/Users/ylf/Desktop/projects/russia-crm-local` 上实施。
- 分支名：`codex/issue-284-disqualified-entry`。
- 本 PR 只解决 [#284](https://github.com/mewmind-chen/russia-crm-local/issues/284)，不顺手修改不对口详情页或客户侧栏。
- 专用不对口接口、权限、原因字段、审计日志和回收记录语义不得削弱。
- API 拒绝必须发生在任何数据库写入之前；失败请求不得改变客户、经理任务或介入记录。
- 修改 `sales-assets/app.js` 后必须更新 `sales-crm.html` 中前端资源版本，并同步相关静态测试断言。
- 每一任务按 Red → Green → Refactor 执行；测试失败原因必须与预期一致后才能写实现。

---

## Task 1: 建立隔离分支并确认基线

**Files:**

- Verify: `package.json`
- Verify: `scripts/run-core-tests.js`
- Verify: `docs/superpowers/specs/2026-08-13-five-customer-workflow-issues-design.md`

- [ ] **Step 1: 创建隔离工作树**

```bash
cd /Users/ylf/Desktop/projects/tradepulse-development
git fetch origin
git worktree add worktrees/issue-284-disqualified-entry -b codex/issue-284-disqualified-entry origin/main
cd worktrees/issue-284-disqualified-entry
```

Expected: 工作树干净，当前分支为 `codex/issue-284-disqualified-entry`。

- [ ] **Step 2: 确认设计文档可用**

```bash
test -f docs/superpowers/specs/2026-08-13-five-customer-workflow-issues-design.md
git status --short
```

Expected: `test` 返回 0；`git status --short` 无输出。

- [ ] **Step 3: 运行当前相关测试建立基线**

```bash
node --test \
  test/customer_stage_disqualified.test.js \
  test/issue170_manager_api.test.js \
  test/issue170_deferred_plan_ui.test.js \
  test/issue273_mismatch_recycle_backend.test.js
```

Expected: 基线全部通过；若失败，先记录并修复基线环境，不得把既有失败混入本 PR。

---

## Task 2: 普通客户阶段 API 拒绝写入 `disqualified`

**Files:**

- Modify: `test/customer_stage_disqualified.test.js`
- Modify: `lib/sales_crm.js` — `updateAccount()`

- [ ] **Step 1: 将旧的“普通 PATCH 可写不对口”测试改为拒绝测试**

在 `test/customer_stage_disqualified.test.js` 保留阶段字典/导出语义测试，替换普通 PATCH 成功用例。测试必须：

1. 创建一个 `qualified` 客户并记录其 `stage`、`updated_at`。
2. `PATCH /api/sales-crm/accounts/:id`，body 为 `{ "stage": "disqualified" }`。
3. 断言 HTTP 400，错误消息为 `请使用“标记不对口”操作`。
4. 重新查询数据库，断言 `stage`、`updated_at`、`lifecycle_status` 均未变化。
5. 断言没有新增 `crm_audit_log` 和不对口回收记录。

核心断言：

```js
assert.equal(response.statusCode, 400);
assert.equal(response.json.error, '请使用“标记不对口”操作');
assert.deepEqual(after, before);
assert.equal(auditAfter, auditBefore);
```

- [ ] **Step 2: 运行测试并确认因现有接口允许写入而失败**

```bash
node --test test/customer_stage_disqualified.test.js
```

Expected: 新用例失败，实际状态为 200 或数据库已变为 `disqualified`。

- [ ] **Step 3: 在 `updateAccount()` 的阶段合法性检查后、任何写入前添加保护**

在 `lib/sales_crm.js` 的 `updateAccount(user, customerId, payload)` 中加入：

```js
if (String(payload.stage || '') === 'disqualified') {
  throw badRequest('请使用“标记不对口”操作');
}
```

保持历史记录恢复判断：

```js
const reactivating = ['lost', 'disqualified'].includes(account.stage)
  && payload.stage
  && !['lost', 'disqualified'].includes(String(payload.stage));
```

不要删除 `disqualified` 阶段字典，也不要改变专用 reject/restore 逻辑。

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test test/customer_stage_disqualified.test.js
node --check lib/sales_crm.js
```

Expected: 测试通过，语法检查无输出且退出码为 0。

- [ ] **Step 5: 提交后端账户保护**

```bash
git add lib/sales_crm.js test/customer_stage_disqualified.test.js
git commit -m "fix: reject disqualified in ordinary account updates"
```

Expected: 生成一个只包含上述两文件的提交。

---

## Task 3: 经理终止动作只允许“丢单”

**Files:**

- Modify: `test/issue170_manager_api.test.js`
- Modify: `lib/sales_crm.js` — `managerTaskChange()`

- [ ] **Step 1: 添加经理动作的原子性失败测试**

在 `test/issue170_manager_api.test.js` 使用现有 `managerFixture()` 与 `upsertManagerTask()`：

- 创建待处理经理任务和 `qualified` 客户。
- 调用经理动作接口，action 为 `terminal_stage`、stage 为 `disqualified`。
- 断言 400 和消息 `不对口请使用专用“标记不对口”流程`。
- 对比请求前后的 `crm_accounts`、经理任务和 `crm_manager_interventions`，确认均未变化。
- 再创建一个独立任务，以 `lost` 调用同一动作，断言成功并正确终止，防止把整个终止动作关闭。

核心失败分支断言：

```js
assert.equal(rejected.statusCode, 400);
assert.equal(rejected.json.error, '不对口请使用专用“标记不对口”流程');
assert.deepEqual(accountAfterRejected, accountBefore);
assert.deepEqual(taskAfterRejected, taskBefore);
assert.equal(interventionsAfterRejected, interventionsBefore);
```

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/issue170_manager_api.test.js
```

Expected: `disqualified` 分支当前成功，导致新断言失败；`lost` 既有行为通过。

- [ ] **Step 3: 收紧 `managerTaskChange()` 的允许值**

将当前同时允许 `lost` 和 `disqualified` 的检查改为：

```js
if (stage !== 'lost') {
  throw badRequest('不对口请使用专用“标记不对口”流程');
}
```

该判断必须位于账户、任务、介入记录的所有更新之前。

- [ ] **Step 4: 运行经理 API 测试**

```bash
node --test test/issue170_manager_api.test.js
node --check lib/sales_crm.js
```

Expected: `disqualified` 被拒绝且零副作用，`lost` 仍成功。

- [ ] **Step 5: 提交经理动作保护**

```bash
git add lib/sales_crm.js test/issue170_manager_api.test.js
git commit -m "fix: reserve manager mismatch for dedicated flow"
```

---

## Task 4: 前端移除普通“不对口”选项并保护历史数据

**Files:**

- Modify: `sales-assets/app.js` — `setManagerTaskAction()`、`openCustomerProfileEditModal()`
- Modify: `test/issue170_deferred_plan_ui.test.js`
- Modify: `test/customer_stage_disqualified.test.js`
- Modify: `sales-crm.html`
- Modify token assertions in:
  - `test/issue112_tag_semantics.test.js`
  - `test/issue116_research_filter_component.test.js`
  - `test/issue147_shared_nickname_ui.test.js`
  - `test/issue149_progress_ui.test.js`
  - `test/issue170_business_timezone_ui.test.js`
  - `test/issue212_lead_pool_frontend.test.js`
  - `test/issue274_sales_stats_ui.test.js`
  - `test/issue275_master_profile_form.test.js`
  - `test/sales_access_ui.test.js`

- [ ] **Step 1: 先添加静态 UI 断言**

测试应从 `sales-assets/app.js` 提取 `setManagerTaskAction` 和 `openCustomerProfileEditModal` 函数块，断言：

```js
assert.doesNotMatch(managerBlock, /value="disqualified"/);
assert.match(managerBlock, /value="lost"/);
assert.match(editBlock, /item\.key !== 'disqualified'/);
assert.match(editBlock, /历史不对口客户请先通过不对口记录恢复/);
```

同时保留专用入口存在断言：

```js
assert.match(appSource, /data-reject-customer/);
assert.match(appSource, /rejectCustomerAsMismatch/);
```

- [ ] **Step 2: 运行 UI 测试确认失败**

```bash
node --test test/issue170_deferred_plan_ui.test.js test/customer_stage_disqualified.test.js
```

Expected: 仍存在 `disqualified` option，过滤和历史保护断言失败。

- [ ] **Step 3: 修改经理动作表单**

在 `setManagerTaskAction()` 的 `terminal_stage` 表单中只渲染：

```html
<select name="stage" required>
  <option value="lost">丢单</option>
</select>
```

保留“终止原因”必填，不在此处增加另一个不对口按钮。

- [ ] **Step 4: 修改客户资料编辑弹窗**

在 `openCustomerProfileEditModal(customerId)` 找到客户后先阻止历史不对口客户进入普通编辑：

```js
if (account.stage === 'disqualified') {
  toast('历史不对口客户请先通过不对口记录恢复');
  return;
}
const editableStages = state.data.stages.filter(item => item.key !== 'disqualified');
```

阶段下拉只遍历 `editableStages`。这样不会因为没有 selected option 而默认提交第一个阶段。

- [ ] **Step 5: 更新资源缓存版本**

将 `sales-crm.html` 中 `app.css` 和 `app.js` 的版本统一为：

```text
20260813-issue284-disqualified-entry
```

用以下命令确认需要同步的断言文件，再逐一通过补丁更新：

```bash
rg -n "20260811-issue281-navigation-counts" sales-crm.html test
```

Expected: 修改完成后该旧版本字符串无匹配。

- [ ] **Step 6: 运行前端测试和语法检查**

```bash
node --test \
  test/issue170_deferred_plan_ui.test.js \
  test/customer_stage_disqualified.test.js \
  test/issue275_master_profile_form.test.js \
  test/sales_access_ui.test.js
node --check sales-assets/app.js
```

Expected: 全部通过；`sales-assets/app.js` 语法有效。

- [ ] **Step 7: 提交前端入口收敛**

```bash
git add sales-assets/app.js sales-crm.html test
git commit -m "fix: remove mismatch from ordinary stage controls"
```

---

## Task 5: 验证专用不对口链路没有回归

**Files:**

- Verify: `lib/sales_crm.js`
- Verify: `test/issue241_return_mismatch.test.js`
- Verify: `test/issue265_customer_status_actions.test.js`
- Verify: `test/issue273_mismatch_recycle_backend.test.js`

- [ ] **Step 1: 运行专用链路回归测试**

```bash
node --test \
  test/issue241_return_mismatch.test.js \
  test/issue265_customer_status_actions.test.js \
  test/issue273_mismatch_recycle_backend.test.js
```

Expected: 销售专用“标记不对口”、原因记录、回收列表和管理员恢复行为全部通过。

- [ ] **Step 2: 扫描所有普通写入口**

```bash
rg -n "disqualified|terminal_stage" lib/sales_crm.js sales-assets/app.js test
```

Expected: UI 中不存在普通 `value="disqualified"`；后端通用写入口存在明确拒绝；专用 reject/restore 与历史读取代码仍存在。

- [ ] **Step 3: 运行完整核心测试**

```bash
npm test
```

Expected: 退出码 0，无失败测试。

- [ ] **Step 4: 做提交前检查**

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

Expected: 无空白错误；仅出现本 Issue 文件；提交历史清晰。

---

## Task 6: GitHub PR、顺序部署和生产验收

**Files:**

- Verify: `.github/workflows/`
- Verify: `scripts/deploy-state.js`
- Verify: `scripts/verify-release-gate.sh`

- [ ] **Step 1: 推送并创建 PR**

```bash
git push -u origin codex/issue-284-disqualified-entry
gh pr create \
  --repo mewmind-chen/russia-crm-local \
  --base main \
  --head codex/issue-284-disqualified-entry \
  --title "fix: unify disqualified customer entry" \
  --body $'Closes #284\n\n- reject disqualified in ordinary account updates\n- keep manager terminal action limited to lost\n- remove ordinary mismatch stage options\n- preserve the dedicated mismatch flow and audit trail'
```

Expected: 返回 PR URL，PR 正文关联并关闭 #284。

- [ ] **Step 2: 等待并核对 CI**

```bash
gh pr checks --repo mewmind-chen/russia-crm-local --watch
```

Expected: 所有 required checks 通过；失败时先读取日志并修复，不得跳过。

- [ ] **Step 3: 合并后取得精确生产 SHA**

```bash
gh pr merge --repo mewmind-chen/russia-crm-local --squash --delete-branch
git fetch origin
release_sha=$(git rev-parse origin/main)
printf '%s\n' "$release_sha"
```

Expected: Issue #284 关闭；输出 40 位生产目标 SHA。

- [ ] **Step 4: 执行本地与公网 release gate**

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

Expected: 两个 gate 均确认运行版本等于 `$release_sha`，数据库检查通过。

- [ ] **Step 5: 生产三账户验收**

使用测试客户分别验证：

1. 销售：普通“编辑客户资料”阶段中没有“不对口”；专用“标记不对口”仍可提交原因并进入不对口记录。
2. 经理：终止动作只有“丢单”，没有“不对口”。
3. 管理员：专用不对口记录及审计仍可见；普通 PATCH 构造请求返回 400。
4. 强制刷新后结果不反转，客户不会从所有页面无记录消失。

Expected: 以上全部通过并把截图/请求结果附到 PR；通过后才开始 Issue #283。

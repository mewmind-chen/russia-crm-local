# Issues #285 #286 #287 Customer Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理客户侧栏重复摘要、把官网统一为安全链接、将主档区域改为清晰的三卡布局，并为下一步动作增加克制且准确的相对倒计时。

**Architecture:** 保持现有 drawer 数据源与权限不变；#286 通过严格的 `ui-format.website()` 和字段级 HTML renderer 处理官网，#285 通过 drawer 专用 CSS class 完成布局，#287 新增独立 UMD 纯函数模块计算相对时间，`app.js` 只负责渲染和一分钟定时器生命周期。

**Tech Stack:** 原生 JavaScript/CSS/HTML、CommonJS/UMD、`node:test`、GitHub Actions、现有 release-gate 脚本。

## Global Constraints

- 前置条件：#284、#283 已依次合并、部署并通过生产验收。
- 分支名：`codex/issues-285-286-287-customer-drawer`，从最新 `origin/main` 创建。
- 同一 PR 内实施顺序固定为 #286 → #285 → #287，每个 Issue 独立提交。
- 不改变 API、数据库、客户权限、阶段或 48 小时业务规则。
- 普通事实继续纯文本转义；仅官网字段允许经过安全 helper 输出 HTML。
- 倒计时只对 `next_action_time_basis === 'utc'` 生效，不猜测历史时间时区。
- 不显示秒、进度条、闪烁、脉冲或整卡红色。
- 不修改其他页面日期展示；CSS 使用 drawer 专用 class，避免全局回归。

---

## Task 1: 建立分支和侧栏基线

**Files:**

- Verify: `sales-assets/app.js`
- Verify: `sales-assets/app.css`
- Verify: `sales-assets/ui-format.js`
- Verify: `sales-crm.html`
- Verify: `test/crm_ui_polish_shell.test.js`
- Verify: `test/issue170_business_timezone_ui.test.js`

- [ ] **Step 1: 创建隔离工作树**

```bash
cd /Users/ylf/Desktop/projects/tradepulse-development
git fetch origin
git worktree add worktrees/issues-285-286-287-customer-drawer \
  -b codex/issues-285-286-287-customer-drawer origin/main
cd worktrees/issues-285-286-287-customer-drawer
git status --short
git log -1 --oneline
```

Expected: 工作树干净，主干包含已部署 #283。

- [ ] **Step 2: 运行现有 UI 基线**

```bash
node --test \
  test/crm_ui_polish_shell.test.js \
  test/issue170_business_timezone_ui.test.js \
  test/issue275_master_profile_form.test.js
```

Expected: 全部通过。

---

## Task 2 (#286): 收紧官网规范化，仅允许 HTTP/HTTPS

**Files:**

- Modify: `test/crm_ui_polish_shell.test.js`
- Modify: `sales-assets/ui-format.js` — `website()`

- [ ] **Step 1: 添加官网输入矩阵测试**

在 `test/crm_ui_polish_shell.test.js` 增加：

```js
assert.deepEqual(format.website('smcbr.com.br/path'), {
  href: 'https://smcbr.com.br/path',
  label: 'smcbr.com.br',
});
assert.equal(format.website('javascript:alert(1)'), null);
assert.equal(format.website('data:text/html,boom'), null);
assert.equal(format.website('ftp://example.com/file'), null);
assert.equal(format.website('https://'), null);
assert.equal(format.website(''), null);
```

保留完整 HTTPS、带查询参数、无协议域名测试。

- [ ] **Step 2: 运行测试确认危险 scheme 当前会被错误拼接**

```bash
node --test test/crm_ui_polish_shell.test.js
```

Expected: 至少 `javascript:` / `ftp:` 用例失败。

- [ ] **Step 3: 最小修改 `website()`**

```js
function website(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const explicitScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (explicitScheme && !/^https?:\/\//i.test(raw)) return null;
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return { href: url.href, label: url.hostname.replace(/^www\./i, '') };
  } catch (_error) {
    return null;
  }
}
```

注意：`new URL()` 可能规范化尾斜杠；测试应断言规范化后的 `url.href`，不要保留未经解析的 raw href。

- [ ] **Step 4: 运行测试和语法检查**

```bash
node --test test/crm_ui_polish_shell.test.js
node --check sales-assets/ui-format.js
```

Expected: 全部通过。

---

## Task 3 (#286): 侧栏官网链接和摘要去重

**Files:**

- Create: `test/issue286_customer_drawer_summary.test.js`
- Modify: `sales-assets/app.js` — `renderDrawer()` 附近

- [ ] **Step 1: 写侧栏渲染失败测试**

测试从 `sales-assets/app.js` 提取 `renderDrawer()`，断言：

```js
assert.match(block, /\['官网', account\.website, 'website'\]/);
assert.match(block, /websiteMarkup\(value\)/);
assert.doesNotMatch(block, /<span>行业与客户类型<\/span>/);
assert.match(block, /<span>企业简介<\/span>/);
assert.match(block, /<span>产品与潜在需求<\/span>/);
assert.match(block, /<span>背调与来源<\/span>/);
```

另加安全边界断言：普通事实分支必须继续使用 `esc(value || '—')`。

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/issue286_customer_drawer_summary.test.js
```

Expected: 官网仍是 `<strong>` 文本，重复行业卡仍存在。

- [ ] **Step 3: 添加字段级 fact renderer**

在 `renderDrawer()` 前加入：

```js
function drawerFactMarkup([label, value, kind = 'text']) {
  const content = kind === 'website'
    ? websiteMarkup(value)
    : `<strong>${esc(value || '—')}</strong>`;
  return `<div class="fact"><span>${esc(label)}</span>${content}</div>`;
}
```

`websiteMarkup()` 已通过 `uiFormat.website()` 生成带 `target="_blank" rel="noopener"` 的安全链接；不要允许任意 fact 传 raw HTML。

- [ ] **Step 4: 官网 fact 使用专用 renderer**

将事实项改为：

```js
['官网', account.website, 'website'],
```

将渲染改为：

```js
${accountFacts.map(drawerFactMarkup).join('')}
```

- [ ] **Step 5: 删除重复行业卡**

在“企业背景与开发依据”中删除：

```html
<div><span>行业与客户类型</span><p>${esc([account.industry, account.customer_type].filter(Boolean).join(' · ') || '未标注')}</p></div>
```

顶部 `#drawerMeta` 和完整客户资料页中的行业/类型仍保留。

- [ ] **Step 6: 运行 #286 和 formatter 测试**

```bash
node --test test/issue286_customer_drawer_summary.test.js test/crm_ui_polish_shell.test.js
node --check sales-assets/app.js
```

Expected: 官网为安全链接、空/危险值为统一空值；主档区只剩三卡。

- [ ] **Step 7: 提交 #286**

```bash
git add sales-assets/ui-format.js sales-assets/app.js test/crm_ui_polish_shell.test.js test/issue286_customer_drawer_summary.test.js
git commit -m "fix: deduplicate drawer summary and link websites"
```

---

## Task 4 (#285): 三卡响应式布局

**Files:**

- Create: `test/issue285_customer_drawer_layout.test.js`
- Modify: `sales-assets/app.js` — master profile markup in `renderDrawer()`
- Modify: `sales-assets/app.css`

- [ ] **Step 1: 写 markup/CSS 失败测试**

断言 `renderDrawer()` 使用 drawer 专用 class：

```js
assert.match(block, /master-profile-grid drawer-master-grid/);
assert.match(block, /drawer-master-card-wide[^>]*>[\s\S]*企业简介/);
```

断言 CSS：

```js
assert.match(css, /\.drawer-master-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
assert.match(css, /\.drawer-master-card-wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
assert.match(css, /@media[^{}]*\(max-width:\s*720px\)[\s\S]*\.drawer-master-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
assert.doesNotMatch(css, /\.drawer-master-grid[^}]*height:/s);
```

- [ ] **Step 2: 运行测试确认失败**

```bash
node --test test/issue285_customer_drawer_layout.test.js
```

Expected: 专用 class 尚不存在。

- [ ] **Step 3: 修改三卡 markup**

```html
<div class="master-profile-grid drawer-master-grid">
  <div class="drawer-master-card-wide"><span>企业简介</span><p>${esc(account.master_description || '暂无企业简介')}</p></div>
  <div><span>产品与潜在需求</span><p>${esc(account.product_focus || '未标注')}</p></div>
  <div><span>背调与来源</span><p>${esc([account.deep_report, account.source_file].filter(Boolean).join(' · ') || '暂无关联资料')}</p></div>
</div>
```

DOM 顺序固定为简介、产品、来源，确保单列时阅读顺序正确。

- [ ] **Step 4: 添加 drawer 专用 CSS**

```css
.drawer-master-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.drawer-master-grid > div {
  min-width: 0;
  overflow-wrap: anywhere;
}

.drawer-master-card-wide {
  grid-column: 1 / -1;
}

@media (max-width: 720px) {
  .drawer-master-grid {
    grid-template-columns: 1fr;
  }

  .drawer-master-card-wide {
    grid-column: auto;
  }
}
```

不设置固定高度/min-height，不制造空白。

- [ ] **Step 5: 运行布局测试并提交 #285**

```bash
node --test test/issue285_customer_drawer_layout.test.js test/issue286_customer_drawer_summary.test.js
node --check sales-assets/app.js
git add sales-assets/app.js sales-assets/app.css test/issue285_customer_drawer_layout.test.js
git commit -m "fix: arrange customer master data in three cards"
```

---

## Task 5 (#287): 新增纯相对时间模块

**Files:**

- Create: `sales-assets/next-action-time.js`
- Create: `test/issue287_next_action_time.test.js`

- [ ] **Step 1: 写固定时钟测试矩阵**

固定 `nowMs = Date.parse('2026-08-13T00:00:00Z')`，覆盖：

| 计划差值 | state | label |
|---:|---|---|
| +49h | normal | 还有 2 天 |
| +36h | normal | 还有 1 天 12 小时 |
| +12h | approaching | 还有 12 小时 |
| +5h | dueSoon | 还有 5 小时 |
| +59m | dueSoon | 还有 59 分钟 |
| 0 | dueSoon | 已到计划时间 |
| -1m | overdue | 已超时 1 分钟 |
| -26h | overdue | 已超时 1 天 2 小时 |

另断言：basis 非 `utc`、空值、无效时间均为 `unavailable` 且相对 label 为空。

- [ ] **Step 2: 运行测试确认模块不存在**

```bash
node --test test/issue287_next_action_time.test.js
```

Expected: `MODULE_NOT_FOUND`。

- [ ] **Step 3: 创建完整 UMD 纯函数模块**

`sales-assets/next-action-time.js`：

```js
(function initTradePulseNextActionTime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TradePulseNextActionTime = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNextActionTime() {
  'use strict';

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  function utcTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return NaN;
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
      ? raw
      : `${raw.replace(' ', 'T')}Z`;
    return Date.parse(normalized);
  }

  function futureLabel(diff) {
    if (diff >= 48 * HOUR) return `还有 ${Math.floor(diff / DAY)} 天`;
    if (diff > DAY) {
      return `还有 1 天 ${Math.floor((diff - DAY) / HOUR)} 小时`;
    }
    if (diff > HOUR) return `还有 ${Math.ceil(diff / HOUR)} 小时`;
    return `还有 ${Math.max(1, Math.ceil(diff / MINUTE))} 分钟`;
  }

  function overdueLabel(elapsed) {
    if (elapsed > DAY) {
      const days = Math.floor(elapsed / DAY);
      const hours = Math.floor((elapsed % DAY) / HOUR);
      return `已超时 ${days} 天${hours ? ` ${hours} 小时` : ''}`;
    }
    if (elapsed > HOUR) return `已超时 ${Math.ceil(elapsed / HOUR)} 小时`;
    return `已超时 ${Math.max(1, Math.ceil(elapsed / MINUTE))} 分钟`;
  }

  function describeNextActionTime(value, basis, nowMs = Date.now()) {
    if (basis !== 'utc') {
      return { state: 'unavailable', label: '', ariaLabel: '' };
    }
    const targetMs = utcTimestamp(value);
    if (!Number.isFinite(targetMs) || !Number.isFinite(Number(nowMs))) {
      return { state: 'unavailable', label: '', ariaLabel: '' };
    }
    const diff = targetMs - Number(nowMs);
    if (diff < 0) {
      const label = overdueLabel(Math.abs(diff));
      return { state: 'overdue', label, ariaLabel: label };
    }
    if (diff === 0) {
      return { state: 'dueSoon', label: '已到计划时间', ariaLabel: '已到计划时间' };
    }
    const state = diff > DAY ? 'normal' : diff > 6 * HOUR ? 'approaching' : 'dueSoon';
    const label = futureLabel(diff);
    return { state, label, ariaLabel: label };
  }

  return Object.freeze({ describeNextActionTime });
}));
```

- [ ] **Step 4: 运行时间矩阵和语法检查**

```bash
node --test test/issue287_next_action_time.test.js
node --check sales-assets/next-action-time.js
```

Expected: 全部通过。

- [ ] **Step 5: 提交纯模块**

```bash
git add sales-assets/next-action-time.js test/issue287_next_action_time.test.js
git commit -m "feat: calculate restrained next-action countdowns"
```

---

## Task 6 (#287): 接入倒计时渲染与定时器生命周期

**Files:**

- Modify: `sales-crm.html`
- Modify: `sales-assets/app.js` — module reference、state、`renderDrawer()`、`closeDrawer()`、refresh hooks
- Modify: `sales-assets/app.css`
- Modify: `test/issue287_next_action_time.test.js`
- Modify: `test/issue170_business_timezone_ui.test.js`

- [ ] **Step 1: 添加浏览器接入静态测试**

断言：

- HTML 在 `app.js` 之前加载 `/sales-assets/next-action-time.js`。
- app 引用 `window.TradePulseNextActionTime`。
- state 有 `drawerNextActionTimer`。
- markup 同时保留 `storedPlanDateLabel()` 和相对文案容器。
- `closeDrawer()` 调用 stop。
- drawer render 调用 start。
- `visibilitychange` 在可见时立即 refresh。
- 不出现刷新周期为 `1000` 毫秒的 `setInterval` 或其他秒级刷新。

- [ ] **Step 2: 运行接入测试确认失败**

```bash
node --test test/issue287_next_action_time.test.js test/issue170_business_timezone_ui.test.js
```

Expected: 纯函数通过，浏览器接入断言失败。

- [ ] **Step 3: 加载模块并增加状态**

在 `sales-crm.html` 的 `app.js` 前加入：

```html
<script src="/sales-assets/next-action-time.js?v=20260813-issues285-287-customer-drawer"></script>
```

`app.js` 顶部：

```js
const nextActionTime = window.TradePulseNextActionTime;
```

state 加入：

```js
drawerNextActionTimer: null,
```

- [ ] **Step 4: 添加精确 markup helper**

```js
function nextActionTimeMarkup(account, nowMs = Date.now()) {
  const accurate = storedPlanDateLabel(account.next_action_at, account.next_action_time_basis);
  if (!account.next_action_at) {
    return '<span class="next-action-time unavailable">尚未安排时间</span>';
  }
  const description = nextActionTime?.describeNextActionTime(
    account.next_action_at,
    account.next_action_time_basis,
    nowMs,
  ) || { state: 'unavailable', label: '', ariaLabel: '' };
  const relativeMarkup = description.label
    ? `<strong class="next-action-relative ${esc(description.state)}" aria-label="${esc(description.ariaLabel)}">${esc(description.label)}</strong>`
    : legacyPlanTimeNote(account.next_action_time_basis);
  return `<span class="next-action-time" data-next-action-time
    data-plan-at="${esc(account.next_action_at)}"
    data-time-basis="${esc(account.next_action_time_basis || '')}">
      ${relativeMarkup}<time>${esc(accurate)}</time>
    </span>`;
}
```

在 NEXT ACTION 卡中用该 helper 替换单独的 `<time>`，准确时间仍始终保留。

- [ ] **Step 5: 添加一分钟生命周期**

```js
function stopDrawerNextActionTimer() {
  clearInterval(state.drawerNextActionTimer);
  state.drawerNextActionTimer = null;
}

function refreshDrawerNextActionTime() {
  if (!$('#customerDrawer')?.classList.contains('open')) return;
  const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
  const mount = $('[data-next-action-time]');
  if (!account || !mount) return;
  const holder = document.createElement('div');
  holder.innerHTML = nextActionTimeMarkup(account);
  mount.replaceWith(holder.firstElementChild);
}

function startDrawerNextActionTimer() {
  stopDrawerNextActionTimer();
  refreshDrawerNextActionTime();
  if (document.visibilityState === 'visible') {
    state.drawerNextActionTimer = setInterval(refreshDrawerNextActionTime, 60 * 1000);
  }
}
```

`renderDrawer()` 完成 DOM 写入后调用 start；`closeDrawer()` 先 stop。浏览器可见性监听：隐藏时 stop，可见且普通 CRM drawer 打开时 start。

- [ ] **Step 6: 确保数据更新后立即重算**

所有会更新 `next_action` / `next_action_at` 的成功路径已调用 `refresh()` 或 `renderDrawer()`；在这些路径完成后明确调用 `refreshDrawerNextActionTime()`。测试静态断言至少覆盖活动表单提交和客户编辑提交两个 handler。

- [ ] **Step 7: 添加克制样式**

```css
.next-action-time {
  display: grid;
  justify-items: end;
  gap: 3px;
  min-width: 104px;
}

.next-action-time time {
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
}

.next-action-relative {
  color: var(--green);
  font-size: 11px;
}

.next-action-relative.approaching,
.next-action-relative.dueSoon {
  color: #9a6700;
}

.next-action-relative.dueSoon {
  font-weight: 800;
}

.next-action-relative.overdue {
  color: var(--danger);
}

.next-action-time.unavailable {
  color: var(--muted);
  font-size: 10px;
}
```

不得加入 animation、闪烁或红色卡片背景。

- [ ] **Step 8: 运行 #287 测试并提交**

```bash
node --test test/issue287_next_action_time.test.js test/issue170_business_timezone_ui.test.js
node --check sales-assets/app.js
git add sales-crm.html sales-assets/app.js sales-assets/app.css test
git commit -m "feat: show live next-action relative time"
```

---

## Task 7: 缓存版本、回归、自审

**Files:**

- Modify: `sales-crm.html`
- Modify: all cache-token assertion tests found by `rg`
- Verify: all changed files

- [ ] **Step 1: 统一所有本 PR 资源 token**

最终 HTML 应为：

```html
<link rel="stylesheet" href="/sales-assets/app.css?v=20260813-issues285-287-customer-drawer">
<script src="/sales-assets/ui-format.js?v=20260813-issues285-287-customer-drawer"></script>
<script src="/sales-assets/next-action-time.js?v=20260813-issues285-287-customer-drawer"></script>
<script src="/sales-assets/app.js?v=20260813-issues285-287-customer-drawer"></script>
```

使用前置 #283 token 搜索并通过补丁同步断言：

```bash
rg -n "20260813-issue283-mismatch-profile|20260729-ui-polish" sales-crm.html test
```

Expected: 最终相关资源都使用新 token；旧 token 在本页契约测试中无残留。

- [ ] **Step 2: 运行三个 Issue 的聚焦测试**

```bash
node --test \
  test/crm_ui_polish_shell.test.js \
  test/issue170_business_timezone_ui.test.js \
  test/issue285_customer_drawer_layout.test.js \
  test/issue286_customer_drawer_summary.test.js \
  test/issue287_next_action_time.test.js
```

Expected: 全部通过。

- [ ] **Step 3: 语法、危险内容和占位扫描**

```bash
node --check sales-assets/ui-format.js
node --check sales-assets/next-action-time.js
node --check sales-assets/app.js
rg -n "TODO|FIXME|javascript:|setInterval\([^,]+,\s*1000\)" \
  sales-assets/app.js sales-assets/app.css sales-assets/ui-format.js sales-assets/next-action-time.js
git diff --check origin/main...HEAD
```

Expected: 无 TODO/FIXME、无秒级 timer；测试中的 `javascript:` 只存在于安全拒绝用例；diff 无空白错误。

- [ ] **Step 4: 运行完整测试**

```bash
npm test
```

Expected: 退出码 0。

- [ ] **Step 5: 设计覆盖自审**

逐项确认：

- #286：顶部行业/类型仍在；主档重复卡删除；官网仅 HTTP/HTTPS；普通 facts 仍转义。
- #285：三卡 DOM 顺序正确；简介全宽；窄屏单列；无固定高度；长文本可换行。
- #287：49h/36h/12h/5h/59m/到期/逾期矩阵通过；历史 basis 无倒计时；准确时间保留；关闭清 timer；标签恢复立即重算。
- 非目标：无 API/DB/权限/阶段/业务规则变化。

- [ ] **Step 6: 提交最终 token 更新**

```bash
git add sales-crm.html test
git commit -m "chore: refresh customer drawer assets"
git status --short
git log --oneline origin/main..HEAD
```

Expected: 工作树干净；提交顺序清晰对应 #286、#285、#287。

---

## Task 8: PR、CI、合并和生产发布

**Files:**

- Verify: `.github/workflows/`
- Verify: `scripts/deploy-state.js`
- Verify: `scripts/verify-release-gate.sh`

- [ ] **Step 1: 推送并创建关联三个 Issue 的 PR**

```bash
git push -u origin codex/issues-285-286-287-customer-drawer
gh pr create \
  --repo mewmind-chen/russia-crm-local \
  --base main \
  --head codex/issues-285-286-287-customer-drawer \
  --title "fix: refine customer drawer summary and timing" \
  --body $'Closes #285\nCloses #286\nCloses #287\n\n- deduplicate customer master summary\n- render safe website links\n- arrange the remaining data in a responsive three-card layout\n- add a restrained minute-updated next-action countdown'
```

Expected: PR URL 返回，正文同时关联 #285/#286/#287。

- [ ] **Step 2: 等待 CI**

```bash
gh pr checks --repo mewmind-chen/russia-crm-local --watch
```

Expected: required checks 全绿；失败必须修复后重跑。

- [ ] **Step 3: 合并并获取精确 SHA**

```bash
gh pr merge --repo mewmind-chen/russia-crm-local --squash --delete-branch
git fetch origin
release_sha=$(git rev-parse origin/main)
printf '%s\n' "$release_sha"
```

Expected: #285/#286/#287 全部关闭；输出 40 位生产目标 SHA。

- [ ] **Step 4: 本地与公网 release gate**

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

Expected: 两个 gate 都显示 `$release_sha` 且数据库健康。

- [ ] **Step 5: 生产视觉与生命周期验收**

销售、经理、管理员分别打开同一测试客户，验证：

1. 官网是安全可点击超链接，新标签页打开；空值和危险值不产生链接。
2. 行业/类型在顶部保留，主档区不重复。
3. 桌面简介全宽，产品/来源并排；窄屏三卡单列且长文本不横向溢出。
4. 下一步动作显示相对时间和准确时间；无秒、无闪烁。
5. 修改下一步时间后立即更新；关闭侧栏等待后无后台 DOM 更新；重新打开和标签页恢复均正确重算。
6. 强制刷新后中文、布局和倒计时仍一致，无旧缓存资源。

Expected: 三身份结果一致且权限未变化；把桌面/窄屏截图、资源 token 和 release SHA 附到 PR。

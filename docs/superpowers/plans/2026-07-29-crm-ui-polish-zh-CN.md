# CRM 前端美化实施计划

> **给执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）
> 或 `superpowers:executing-plans`，按任务逐项实施，并使用复选框跟踪进度。

**目标：** 在保留全部 API、权限、生命周期、筛选和资料集成契约的前提下，
将现有 TradePulse CRM 调整为紧凑、清晰、适合 B2B 日常操作的界面。

**架构：** 在现有服务端 HTML、CSS 和浏览器 JavaScript 上渐进升级。
新增一个小型 UMD 展示格式模块，统一官网、产品、状态和 SVG 图标渲染；
业务状态和 API 调用继续由现有模块负责。所有视觉和结构变化先通过 Node 契约测试锁定。

**技术栈：** HTML5、CSS 自定义属性、响应式 CSS、浏览器 JavaScript、
CommonJS/UMD、Node.js 18+ `node:test`、现有 Express 应用和带认证的浏览器验证。

> 本文是实施计划的中文阅读版。代码、正则、选择器、函数名和命令不做中文化，
> 以免改变执行含义。每个任务的完整测试和实现代码块见
> [英文原计划](./2026-07-29-crm-ui-polish.md)，任务编号和步骤顺序完全一致。

## 全局约束

- 只在 `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/ui-polish`
  的 `codex/ui-polish` 分支工作。
- 不修改 `/Users/ylf/Desktop/projects/tradepulse-ai-crm` 和
  `/Users/ylf/Desktop/projects/russia-crm-local` 两个包含用户改动的工作树。
- 不引入 React、Tailwind、shadcn/ui、前端构建步骤或另一套并行前端。
- 不修改后端数据模型、API 契约、权限门控、筛选授权、筛选序列化、
  客户生命周期、分配、Recon 执行、AI 行为或 `postMessage` 集成。
- 除非同一任务中的测试记录了有意的语义标记变化，否则保留现有元素 ID 和事件钩子。
- 使用批准的语义颜色：
  `#F5F7F9`、`#FFFFFF`、`#F7F9FB`、`#18212F`、`#667085`、`#E2E7ED`、
  `#0F766E`、`#0B625B`、`#E7F5F2`、`#2563EB`、`#B7791F` 和 `#C2413B`。
- 使用系统字体栈以及 `24 / 18 / 16 / 14 / 13 / 12 / 11px` 字体层级。
- 业务文本不得小于 11px，字间距固定为 0。
- 控件和面板使用 6-8px 圆角；只有状态和紧凑筛选使用全圆角。
- 普通面板使用一像素边框，不使用阴影；浮层、抽屉和弹窗可使用克制阴影。
- 桌面控件高度至少 40px，780px 以下至少 44px。
- 动画只允许颜色、透明度、边框和阴影在 150-200ms 内过渡；
  移除缩放和位移，并支持 `prefers-reduced-motion`。
- 使用统一线性 SVG 图标；纯图标按钮具有中文无障碍名称和必要的提示。
- 主工作区最大可读宽度为 1680px。
- 验证 375x812、768x1024、1024x768、1440x900 和至少 1920px 宽。
- 不允许页面级横向滚动。
- 1440x900 下，无需滚过完整高级筛选目录即可看到客户和线索表头。
- Issue 116、124、128、130 现有测试和完整 Node 测试套件必须保持通过。

## 文件职责

- 新建 `sales-assets/ui-format.js`：
  纯 UMD 展示辅助函数，负责线性图标、官网、产品和状态格式化。
- 新建 `test/crm_ui_polish.test.js`：
  覆盖视觉系统、外壳、驾驶舱、筛选、表格、资料、标签和无障碍契约。
- 修改 `sales-assets/app.css`：
  语义令牌、外壳、控件、驾驶舱、表格、资料外层和响应式规则。
- 修改 `sales-assets/filter-component.css`：
  紧凑基础筛选、高级展开区、条件标签和移动端布局。
- 修改 `sales-assets/filter-component.js`：
  只调整展示分组和展开标记，不调整控制器或载荷。
- 修改 `sales-assets/app.js`：
  只调整驾驶舱分组和表格展示格式。
- 修改 `sales-crm.html`：
  图标标记、提醒汇总目标、资源版本和少量语义结构。
- 修改 `Index.html`：
  资料分组、Recon 空状态、可搜索标签分类、吸底保存及内嵌样式。
- 修改 `test/issue128_profile_frontend.test.js`：
  将旧的独立卡片断言更新为分组定义布局断言。

---

## 任务 1：语义视觉基础和线性图标

### 文件

- 新建 `sales-assets/ui-format.js`
- 新建 `test/crm_ui_polish.test.js`
- 修改 `sales-assets/app.css:1-10`
- 修改 `sales-crm.html:8-104`

### 接口

- 输入：现有 `window`、CommonJS `module.exports` 和已转义字符串。
- 输出：`TradePulseUIFormat.icon(name, label = '') -> string`、
  `mountIcons(scope) -> void`，以及后续任务使用的语义 CSS 变量。

### 执行步骤

- [ ] 编写失败测试，锁定颜色令牌、24px 页面标题、12px 表头、13px 表格正文、
  64px 顶栏、浅色激活导航、减少动画规则和 SVG 图标标记。
- [ ] 运行：

```bash
node --test test/crm_ui_polish.test.js
```

  预期：失败，因为格式模块、语义变量、字号契约和图标标记尚不存在。

- [ ] 按英文原计划任务 1 第 3 步创建 `ui-format.js`：
  提供 `icon()` 和 `mountIcons()`，同时兼容浏览器全局对象和 CommonJS。
- [ ] 替换全局视觉令牌、字体、按钮、焦点和减少动画规则。
- [ ] 将外壳改为 232px 浅色侧边栏、64px 顶栏和最大 1680px 工作区。
- [ ] 按原计划的精确映射，将导航、账户、菜单和通知符号替换为
  `data-tp-icon` 标记；保留所有 ID、权限属性、数量和事件目标。
- [ ] 删除会重新恢复 100px 顶栏、深色导航、9-13px 圆角或圆形图标按钮的旧重复规则。
- [ ] 运行：

```bash
node --test test/crm_ui_polish.test.js test/sales_menu.test.js
```

  预期：全部通过。

- [ ] 提交：

```bash
git add sales-assets/ui-format.js sales-assets/app.css sales-crm.html test/crm_ui_polish.test.js
git commit -m "feat: establish CRM visual system"
```

---

## 任务 2：驾驶舱层级和待处理汇总

### 文件

- 修改 `test/crm_ui_polish.test.js`
- 修改 `sales-crm.html:107-139`
- 修改 `sales-assets/app.js:1072-1111`
- 修改 `sales-assets/app.css` 中的驾驶舱规则

### 接口

- 输入：`computeSummary(accounts)` 现有结果以及 `#attentionList`。
- 输出：恰好六张 `.metric` 卡，以及 `需要我处理` 标题区中的
  `#attentionSummary`。

### 执行步骤

- [ ] 增加失败测试，要求删除 `超期 / 待介入` 第七张卡，
  并出现 `#attentionSummary` 和有宽度限制的漏斗。
- [ ] 运行：

```bash
node --test test/crm_ui_polish.test.js
```

  预期：因为仍存在第七张指标卡而失败。

- [ ] 将 `需要我处理` 标题结构改为中文标题、提醒摘要和 `查看全部`。
- [ ] 将 `renderDashboard()` 指标数组缩减为六项。
- [ ] 把 `summary.overdue` 和 `summary.managerNeeded` 写入 `#attentionSummary`；
  有超期项时增加 `critical` 类。
- [ ] KPI 使用 12px 标签、28px 等宽数值、12px 说明；
  面板使用 8px 圆角和一像素边框；漏斗最大宽度 900px。
- [ ] 运行驾驶舱和导航测试，预期全部通过。
- [ ] 提交：

```bash
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/crm_ui_polish.test.js
git commit -m "feat: clarify dashboard action hierarchy"
```

---

## 任务 3：紧凑的授权筛选区

### 文件

- 修改 `test/issue116_filter_component.test.js`
- 修改 `test/crm_ui_polish.test.js`
- 修改 `sales-assets/filter-component.js:338-545`
- 修改 `sales-assets/filter-component.css`

### 接口

- 输入：规范化筛选结构、现有控制器状态、`data-filter-*` 事件和
  不变的 `controller.serialize()`。
- 输出：`splitFilterFields(schema)`、紧凑基础行、国家弹出选项菜单、
  默认折叠的 `.tp-filter-advanced`、始终可见的条件标签和结果数量。

### 执行步骤

- [ ] 增加失败测试：
  常用字段始终可见，高级筛选默认关闭，结果数量可见，
  并且序列化载荷仍只包含授权字段。
- [ ] 将原有蓝色和 600px 样式断言更新为 `#0F766E` 和 780px。
- [ ] 运行：

```bash
node --test test/issue116_filter_component.test.js test/crm_ui_polish.test.js
```

  预期：新结构测试失败，原有控制器和载荷测试仍通过。

- [ ] 新增 `PRIMARY_FILTER_KEYS`、`splitFilterFields()`、
  `renderCompactField()` 和 `renderPrimaryField()`。
- [ ] 关键词、国家、负责人、阶段或状态进入基础行。
- [ ] 国家等多选常用项使用 40px 的 `.tp-filter-menu` 弹出菜单，
  不使用高大的原生多选列表。
- [ ] 其他项目进入默认关闭的 `<details class="tp-filter-advanced">`。
- [ ] 已应用条件和结果数量始终显示；条件仍可单独删除或全部清除。
- [ ] 不修改控制器方法、存储键、授权结构、事件属性和 `serialize()`。
- [ ] 添加桌面和移动端紧凑样式；移动端控件至少 44px。
- [ ] 运行：

```bash
node --test \
  test/issue116_filter_component.test.js \
  test/issue116_business_page_component.test.js \
  test/issue116_research_filter_component.test.js \
  test/crm_ui_polish.test.js
```

  预期：全部通过。

- [ ] 提交：

```bash
git add sales-assets/filter-component.js sales-assets/filter-component.css test/issue116_filter_component.test.js test/crm_ui_polish.test.js
git commit -m "feat: compact authorized CRM filters"
```

---

## 任务 4：提升客户和线索表格可读性

### 文件

- 修改 `sales-assets/ui-format.js`
- 修改 `test/crm_ui_polish.test.js`
- 修改 `sales-assets/app.js:1517-1665,2644-2785`
- 修改 `sales-assets/app.css` 表格规则
- 修改 `sales-crm.html` 资源版本

### 接口

- 输入：官网字符串、数组或 JSON 或分隔文本形式的产品值，以及现有中文状态映射。
- 输出：
  `website(value) -> { href, label } | null`、
  `products(value, limit = 3) -> { items, overflow }`、
  `status(value, labels) -> { label, tone }`。

### 执行步骤

- [ ] 增加纯函数测试：
  官网只显示规范域名；四个产品只显示前三个和 `+1`；
  `claimed` 显示为 `已领取` 和 `success`。
- [ ] 增加静态表格契约：
  公司锚点 14px、正文 13px、表头 12px、状态点和浅青绿色悬停。
- [ ] 运行定向测试，预期因三个格式函数尚未导出而失败。
- [ ] 在 `ui-format.js` 增加 `website()`、`products()` 和 `status()`，
  并与 `icon()`、`mountIcons()` 一起导出。
- [ ] 在 `app.js` 增加 `websiteMarkup()`、`productChipMarkup()` 和
  `statusMarkup()`。
- [ ] 线索行使用规范域名、产品标签和中文状态点。
- [ ] 客户行的公司名称使用 `.tp-company-anchor`，补充官网，
  阶段使用中文状态点和文字。
- [ ] 不修改负责人、活动、下一步、潜力、提醒、生命周期操作、
  选择状态、`_attrs` 或行点击目标。
- [ ] 更新表格边框、吸顶表头、字号、悬停、产品标签、链接和状态点样式。
- [ ] 运行：

```bash
node --test test/crm_ui_polish.test.js test/issue124_intake_profile.test.js test/sales_menu.test.js
```

  预期：全部通过。

- [ ] 提交：

```bash
git add sales-assets/ui-format.js sales-assets/app.js sales-assets/app.css sales-crm.html test/crm_ui_polish.test.js
git commit -m "feat: improve CRM table readability"
```

---

## 任务 5：客户资料分组和 Recon 空状态

### 文件

- 修改 `test/crm_ui_polish.test.js`
- 修改 `test/issue128_profile_frontend.test.js`
- 修改 `Index.html:1083-1108` 及内嵌资料样式

### 接口

- 输入：Issue 127/128 的全部客户字段、现有 `renderWebsite()`、
  `customerSanctionStatus()`、Recon 状态、权限和操作 ID。
- 输出：`renderDetailSection(title, rows) -> string`、
  四个 `.detail-section` 分组，以及无 Recon 结果时的 `.recon-empty-state`。

### 执行步骤

- [ ] 将旧的独立卡片测试改为分组定义布局测试，同时逐项断言
  Issue 127/128 的 19 个字段仍存在。
- [ ] 增加四个资料分组和 Recon 空状态测试。
- [ ] 运行：

```bash
node --test test/issue128_profile_frontend.test.js test/crm_ui_polish.test.js
```

  预期：因为仍使用 19 张 `.detail-item` 卡片而失败。

- [ ] 新增 `renderDetailValue()` 和 `renderDetailSection()`。
- [ ] 将客户池资料组织为四组：
  `身份与地区`、`业务画像与产品需求`、`联系渠道`、
  `合规、来源与生命周期`。
- [ ] 空值统一显示 `暂无`，保留官网的安全 HTML 渲染。
- [ ] 在既没有 Recon 任务也没有结果时显示：
  线性图标、`尚未生成客户情报`、简要说明和一个主要操作。
- [ ] 只读资料显示只读状态，不提供执行按钮。
- [ ] 保留排队、运行、失败、完成、证据、报告和重试分支。
- [ ] 桌面端定义行两列，375px 下单列，无横向滚动。
- [ ] 运行：

```bash
node --test \
  test/issue128_profile_frontend.test.js \
  test/issue124_intake_profile.test.js \
  test/issue130_profile_access_status.test.js \
  test/crm_ui_polish.test.js
```

  预期：全部通过，Issue 127/128 字段完整保留。

- [ ] 提交：

```bash
git add Index.html test/issue128_profile_frontend.test.js test/crm_ui_polish.test.js
git commit -m "feat: group customer profile information"
```

---

## 任务 6：可搜索标签分类和移动端吸底保存

### 文件

- 修改 `test/crm_ui_polish.test.js`
- 修改 `Index.html:1007,1086-1099` 及标签样式

### 接口

- 输入：现有标签 ID、`state.tags`、权限检查、`.customer-tag-check`、
  `saveCustomerTags()` 和 `createCustomTag()`。
- 输出：`filterTagEditor(query) -> void`、原生分类 `<details>`、
  `#tagSearch`、`#tagEditorCancel` 和 `.tag-editor-actions`。

### 执行步骤

- [ ] 增加失败测试，要求标签搜索、分类数量、默认展开规则、
  原有复选框 ID、保存 ID 和吸底操作栏存在。
- [ ] 运行定向测试，预期因当前所有分类都展开且保存只在顶部而失败。
- [ ] 将可编辑标签分类改为 `<details class="tag-group">`。
- [ ] 有选中标签的分类默认 `open`，其他分类默认关闭。
- [ ] 分类标题显示 `已选数量 / 总数`。
- [ ] 增加 `#tagSearch`，每个标签保存小写的 `data-tag-name`。
- [ ] 增加 `filterTagEditor(query)`，客户端隐藏不匹配标签；
  搜索时自动展开包含匹配项的分类。
- [ ] 继续使用事件委托处理保存、新建、取消和搜索。
- [ ] 保留 `.customer-tag-check`、标签 ID、权限判断和原有两个 API 动作。
- [ ] 增加吸底操作栏；375px 下取消和保存按钮各占一半，至少 44px，
  并为安全区域预留底部空间。
- [ ] 运行：

```bash
node --test \
  test/crm_ui_polish.test.js \
  test/issue112_tag_semantics.test.js \
  test/issue128_profile_frontend.test.js \
  test/issue130_profile_access_status.test.js
```

  预期：全部通过。

- [ ] 提交：

```bash
git add Index.html test/crm_ui_polish.test.js
git commit -m "feat: streamline customer tag editing"
```

---

## 任务 7：响应式、无障碍和浏览器验收

### 文件

- 修改 `test/crm_ui_polish.test.js`
- 修改 `sales-assets/app.css`
- 修改 `sales-assets/filter-component.css`
- 修改 `Index.html`
- 修改 `sales-crm.html` 资源版本

### 接口

- 输入：任务 1-6 产生的全部 UI 契约。
- 输出：五个目标尺寸的验证结果、完整回归证据和最终资源版本。

### 执行步骤

- [ ] 增加页面宽度、移动端操作、焦点、加载和 `aria-live` 静态契约。
- [ ] 将两个现有 Toast 根节点改为：

```html
<div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>
```

  `Index.html` 保持原有属性顺序，只增加相同的无障碍属性。

- [ ] 运行：

```bash
node --test test/crm_ui_polish.test.js
```

  预期：全部通过；如果布局仍溢出，应修复样式，不能弱化断言。

- [ ] 运行全部直接受影响的测试：

```bash
node --test \
  test/issue116_filter_component.test.js \
  test/issue116_business_page_component.test.js \
  test/issue116_research_filter_component.test.js \
  test/issue124_intake_profile.test.js \
  test/issue128_profile_frontend.test.js \
  test/issue130_profile_access_status.test.js \
  test/issue112_tag_semantics.test.js \
  test/sales_menu.test.js \
  test/crm_ui_polish.test.js
```

  预期：零失败。

- [ ] 运行完整测试：

```bash
npm test
```

  预期：退出码为 0，全部测试通过。

- [ ] 启动隔离的本地服务：

```bash
PORT=3117 HOST=127.0.0.1 node server.js
```

  预期：监听 `http://127.0.0.1:3117`。

- [ ] 在 375x812、768x1024、1024x768、1440x900 和 1920x1080
  验证六个使用流程：
  驾驶舱、CRM 客户全景、线索池、客户资料概览、Recon 空状态和标签编辑器。
- [ ] 每个尺寸执行：

```js
({
  pageScrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  hasPageOverflow: document.documentElement.scrollWidth > window.innerWidth,
})
```

  预期：`hasPageOverflow` 为 `false`。表格可以在自身内部横向滚动。
- [ ] 检查无文字重叠、无按钮文字裁切、悬停不位移、键盘焦点可见，
  移动端点击目标至少 44px。
- [ ] 截图：
  1440x900 和 375x812 驾驶舱、1440x900 客户全景和线索池、
  375x812 资料概览、Recon 空状态和标签编辑器，以及 1920x1080 宽屏页面。
- [ ] 将修改过的资源统一使用版本键 `20260729-ui-polish`。
- [ ] 最终运行：

```bash
node --test test/crm_ui_polish.test.js test/sales_menu.test.js
npm test
git diff --check
git status --short
```

  预期：测试退出码为 0，`git diff --check` 无输出，
  状态只列出计划中的 UI 文件。

- [ ] 提交：

```bash
git add sales-assets/app.css sales-assets/filter-component.css sales-crm.html Index.html test/crm_ui_polish.test.js
git commit -m "test: verify responsive CRM polish"
```

## 完成定义

只有满足以下条件才能声明实施完成：

1. 七个任务均按 TDD 顺序完成并分别提交；
2. 视觉规格的十项验收标准全部满足；
3. Issue 116、124、128、130 和标签语义测试通过；
4. `npm test` 完整通过；
5. 五个目标尺寸不存在页面级横向滚动；
6. 1440x900 可直接看到客户和线索表头；
7. 375px 资料页和标签页没有遮挡、重复标题或返回顶部保存问题；
8. API、权限、筛选载荷、客户生命周期、Recon、AI 和 `postMessage` 行为无变化。


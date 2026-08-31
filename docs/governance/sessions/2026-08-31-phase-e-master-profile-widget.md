# Session Checkpoint：阶段 E 续片——CRM 客户主档区块共用 UMD widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`96024b0 → 3e84f63`（业务）

## 本轮切片

### `3e84f63` feat(frontend): extract CRM master profile section into a shared UMD widget

阶段 E 续片：把抽屉客户主档区块（`CUSTOMER MASTER DATA`）抽为自包含 UMD widget
（`sales-assets/master-profile-widget.js`），CRM 抽屉、线索抽屉、回收抽屉共用
同一模板，兑现路线图关键动作 3"customerDrawer 与完整资料共用同一 widget 集合"。

- **新增 `sales-assets/master-profile-widget.js`**（UMD，`TradePulseMasterProfileWidget`）：
  自持 `master-profile` section 模板（insight-head + 卡片网格）与 `label`/`cardClass`
  安全转义；`valueHtml`/`actions` 为宿主传入的已过滤安全 HTML（链接等）。对外暴露
  `renderMasterSectionHtml(ctx)`（纯函数，便于契约测试）/`cardMarkup`/`escapeHtml`/
  `render`。ctx：`{ eyebrow, title, actions, gridClass, rows }`，rows 为
  `[label, valueHtml, cardClass]`。
- **`sales-assets/app.js`**：新增 `masterProfileSectionHtml` 辅助（widget 优先，缺
  widget 时内联回退到逐字节一致模板，保证无 widget 环境行为不变）；
  `renderDrawer`/`openIntakeProfile`/`renderRecycleDrawer` 三处主档区块改为组装 rows
  并委托 helper——CRM 抽屉保留 `drawer-master-grid`/`drawer-master-card-wide`，
  intake 保留 `wide` 与 `assignment-actions`，recycle 保留 `只读` pill。`esc` 在内联
  回退中承担转义，行为与既有模板一致。
- **`sales-crm.html`**：`master-profile-widget.js` 在 `widget-registry.js`/`app.js`
  之前加载。
- **契约测试 +3**（`widget_registry_contract.test.js`）：加载顺序、模板转义与可选
  cardClass/gridClass、三源（renderDrawer intake recycle）委托 helper 的 rows 组装。

## 测试证据

- 全量 `node --test`：1997/1997（较上轮 +3，均新增 master-profile 契约断言）。
- 专项：widget_registry + issue285/286/287/291/137/103/325 60/60 全绿。
- 受影响断言更新：issue285（主档结构改由 widget 模板保真 + 调用处 rows）、issue286
  （master 提取改经 helper）、issue291（lead drawer 改经 helper 组装）、issue103
  （退回原因改 rows 委托）、issue325（研究与来源证据改 rows 委托）、issue287
  （executable renderDrawer dependency stub 增加 masterProfileSectionHtml）。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `3e84f63` feat(frontend): extract CRM master profile section into a shared UMD widget

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：其余功能 widget 化（身份、业务画像、洞察/评价、时间线、商务、下一步、
   回收状态——主档已就位，行程/商务/时间线等区域可逐块下沉）；AI 完整资料站
   （customerAiStation 的评分/资料包/补全渲染）评估纳入 widget 注册表。
3. 全量绿灯，可继续。
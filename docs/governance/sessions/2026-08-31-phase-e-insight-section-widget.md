# Session Checkpoint：阶段 E 续片——共享洞察 section 壳 widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`3a42f1c → 6aa9353`（业务）

## 本轮切片

### `6aa9353` feat(frontend): extract shared insight section shell for customer drawers

阶段 E 续片：把客户/回收抽屉中重复的 `insight-section` 宿主壳抽为自包含 UMD widget
（`sales-assets/insight-section-widget.js`），让联系人历史、客户经营复盘、商务分组、
完整时间线、客户审计历史等块只组装 bodyHtml/actionHtml，不再重复 section 模板。

- **新增 `sales-assets/insight-section-widget.js`**（UMD，`TradePulseInsightSectionWidget`）：
  自持 `insight-section` 模板（`insight-head` + `panel-note` + body 容器），对外暴露
  `renderSectionHtml(ctx)`/`render`/`escapeHtml`。ctx：`{ eyebrow, title, note, actionHtml,
  bodyClass, bodyHtml }`；`actionHtml` 和 `bodyHtml` 由宿主传入已过滤的安全 HTML。
- **`sales-assets/app.js`**：新增 `insightSectionHtml` 辅助（widget 优先，缺 widget 时回退到
  同结构模板）；`renderRecycleDrawer` 中的 5 个重复 `insight-section` 改为调用 helper，
  分别组装 CONTACT HISTORY / MANAGER INSIGHT / 商务分组 / FULL TIMELINE / AUDIT TRAIL。
  时间线区块改为 `bodyClass: 'timeline'`，并保留 `data-open-timeline-modal`。
- **`sales-crm.html`**：`insight-section-widget.js` 在 `widget-registry.js`/`app.js` 之前加载。
- **契约测试 +3**（`widget_registry_contract.test.js`）：加载顺序、模板转义与 bodyClass/
  actionHtml、recycle drawer 的 5 块 section 壳委托；原有 timeline/recycle 相关测试继续锁定
  body 内容和行为。

## 测试证据

- 全量 `node --test`：2000/2000（较上轮 +3，均新增 insight-section 契约断言）。
- 专项：widget_registry + issue137/242/257/230/287/291/171/227 78/78 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `6aa9353` feat(frontend): extract shared insight section shell for customer drawers

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：继续拆其余重复区块（业务画像/洞察内容/商务/下一步/回收状态中的具体 body），
   以及 AI 完整资料站（customerAiStation 的评分/资料包/补全渲染）评估纳入注册表。
3. 全量绿灯，可继续。
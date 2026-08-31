# Session Checkpoint：阶段 E 续片——抽屉告警条与异常明细下沉 next-step widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`9ccbdd4 → e920f7b`（业务）

## 本轮切片

### `e920f7b` feat(frontend): route drawer alert bar and details through the shared next-step widget

阶段 E 续片：把 CRM 抽屉的告警条（`.next-step` 变体）与异常明细列表也下沉到
next-step-widget，模板/转义/严重度配色统一收口。

- **`sales-assets/next-step-widget.js`**：新增 `renderAlertStepHtml`（severity →
  边框色（critical `#e0a09c` / 其他 `#e5c27c`）与 pill 色调（red/amber），
  title/detail/action 转义）与 `renderAlertDetailsHtml`（rows 的 title/detail
  转义，metaHtml 由宿主组装安全 HTML）。
- **`sales-assets/app.js`**：新增 `alertStepHtml`（`hasMeaningfulAlertCopy` 门槛 +
  widget 优先/内联回退）与 `alertDetailsHtml`（`reasons.length > 1` 门槛 + 行数据
  组装 + widget 委托）；`renderDrawer` 内联告警条/异常明细改为委托。
- **契约测试 +2**（`widget_registry_contract.test.js`）：alert 变体转义/色调、
  app 委托与门槛归属。
- **issue265/257/287**：断言更新到新归属——门槛与行组装在 `alertDetailsHtml`，
  renderDrawer 只委托（`alertStepHtml(alert)`/`alertDetailsHtml(alert)`）；issue287
  executable renderDrawer 依赖 stub 增加 `alertStepHtml`/`alertDetailsHtml`。

## 测试证据

- 全量 `node --test`：2007/2007（较上轮 +2，均新增 alert 契约断言）。
- 专项：widget_registry + issue265/257/287 48/48 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `e920f7b` feat(frontend): route drawer alert bar and details through the shared next-step widget

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - 其余 widget 化：身份、业务画像、洞察/时间线/商务/回收状态的具体 body
     （主档、insight 壳、AI 站、facts、next-step、告警条已就位，可按区块逐块下沉）；
   - 验收后 `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。
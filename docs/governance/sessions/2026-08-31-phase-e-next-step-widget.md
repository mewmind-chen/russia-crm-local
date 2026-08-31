# Session Checkpoint：阶段 E 续片——下一步/状态条 shell 统一 widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`e6de1a8 → f8e67c9`（业务）

## 本轮切片

### `f8e67c9` feat(frontend): extract shared next-step bar shell for customer drawers

阶段 E 续片：把 CRM/线索/回收三处抽屉重复的 `.next-step` 状态条壳抽为自包含
UMD widget，三源共用同一模板并统一转义，兑现"customerDrawer 与完整资料共用
同一 widget 集合"。

- **新增 `sales-assets/next-step-widget.js`**（UMD，`TradePulseNextStepWidget`）：
  自持 next-step 模板（eyebrow + 主文本 + 尾部 actionHtml + 可选 className），
  对外暴露 `renderStepHtml(ctx)`/`render`/`escapeHtml`；eyebrow/text 内部转义，
  actionHtml 为宿主传入的安全 HTML。
- **`sales-assets/app.js`**：新增 `nextStepHtml` 辅助（widget 优先/缺 widget 内联
  回退到逐字节一致模板）；`renderDrawer`（NEXT ACTION）、`openIntakeProfile`
  （LEAD PROFILE）、`renderRecycleDrawer`（RECYCLED CUSTOMER · READ ONLY）三处
  内联 next-step 改为委托，行为一致（CRM 保留 nextActionTimeMarkup 尾部）。
- **`sales-crm.html`**：`next-step-widget.js` 在 widget-registry/app.js 前加载。
- **契约测试 +3**（`widget_registry_contract.test.js`）：加载顺序、模板转义与
  可选 className、三源委托调用点。
- **issue287**：executable renderDrawer 依赖 stub 增加 `nextStepHtml`；
  精确匹配 `\$\{nextActionTimeMarkup(account)\}` 断言更新为
  `nextActionTimeMarkup(account)`（现已作为 nextStepHtml 的 actionHtml 参数）。

## 测试证据

- 全量 `node --test`：2005/2005（较上轮 +3，均新增 next-step 契约断言）。
- 专项：widget_registry + issue287/291/257/265/137 56/56 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `f8e67c9` feat(frontend): extract shared next-step bar shell for customer drawers

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - 其余 widget 化：身份、业务画像、洞察/时间线/商务/回收状态的具体 body
     （主档、insight 壳、AI 站、facts、next-step 已就位，可按区块逐块下沉）；
   - 验收后 `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。
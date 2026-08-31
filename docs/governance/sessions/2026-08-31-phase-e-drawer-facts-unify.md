# Session Checkpoint：阶段 E 续片——三源抽屉事实区统一经 drawer-facts widget

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`a79b7ab → 8135ac2`（业务）

## 本轮切片

### `8135ac2` feat(frontend): route intake and recycle drawer facts through the shared facts widget

阶段 E 续片：CRM/线索/回收三种抽屉的事实区统一经 drawer-facts-widget 渲染，
兑现路线图关键动作 3"customerDrawer 与完整资料共用同一 widget 集合"的最后一处
facts 收敛（CRM 抽屉此前已走 widget，intake/recycle 仍内联）。

- **`sales-assets/app.js`**：
  - 新增 `drawerFactsFallbackHtml(rows)` 辅助：widget 优先
    （`TradePulseDrawerFactsWidget.renderFactsHtml({ fallback: rows })`），缺 widget
    时内联回退到 `rows.map(drawerFactMarkup).join('')`（逐字节一致，label/value
    转义行为与内联等价）。
  - `openIntakeProfile` 与 `renderRecycleDrawer` 的 `account-facts` 内联 map 改为
    委托 `drawerFactsFallbackHtml`，与 `renderDrawer` 共用同一 fallback 渲染路径。
- **契约测试 +1**（`widget_registry_contract.test.js`）：`drawerFactsFallbackHtml`
  委托 widget + 内联回退；intake/recycle 调用点委托断言（原 label/value 数据
  仍在 app.js，行为不变）。

## 测试证据

- 全量 `node --test`：2002/2002（较上轮 +2，均新增契约断言）。
- 抽屉专项：widget_registry + issue285/286/287/291/137/283 82/82 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `8135ac2` feat(frontend): route intake and recycle drawer facts through the shared facts widget

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - 其余 widget 化：身份、业务画像、洞察/时间线/商务/下一步/回收状态的具体 body
     （主档、insight 壳、AI 站、facts 已就位，可按区块逐块下沉）；
   - 验收后 `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。

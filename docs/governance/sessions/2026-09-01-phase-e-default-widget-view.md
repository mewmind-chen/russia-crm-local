# Session Checkpoint：阶段 E 续片——widget 壳成为完整资料默认视图

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`2eeca3f → 29282df`（业务）

## 背景

按上一轮 session 的下一步，先对 `/development-workbench` profile 模式做使用方摸底：
- 唯一生产入口：`customerProfileFrameUrl()`（sales-assets/app.js）为完整资料页
  iframe 加载 `profile=1&customer=<id>`（或 `intake=<id>`）。
- 测试锁定：sales_menu.test.js 3 个测试断言 workbench 的 profile-only 行为
  （openRequestedCustomer/renderRequestedCustomerError/只读）。
- 现状：资料页默认 iframe，`profileView=widgets` 时试验性切换到 widget 集合
  （7 个区块已就位：facts/contacts/master/timeline/insight/next-step/AI 站）。

结论：widget 集合已覆盖完整资料主要区块且与抽屉共用同一套模板，是收敛
（路线图关键动作 6）的正确时机。第一步先让 widget 壳成为默认视图。

## 本轮切片

### `29282df` feat(frontend): make the widget shell the default customer profile view

- **`isProfileWidgetsMode`**：默认 `true`（widget 集合为统一壳），仅
  `profileView=legacy` 显式回退旧 iframe；`applyProfileViewMode` 显隐逻辑不变
  （widget 容器常显、iframe 按模式隐藏）。
- 旧 iframe 路径完整保留（兼容入口），workbench 的 profile 模式仍可用，后续
  评估只读化。
- **契约测试 +1**：默认 widget 模式 + legacy 回退 + 显隐委托。

## 测试证据

- 全量 `node --test`：2024/2024（较上轮 +1，新增默认视图契约断言）。
- core `npm test`：1663/1663。
- 专项：widget_registry 40/40 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `29282df` feat(frontend): make the widget shell the default customer profile view

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - workbench profile 模式评估只读化（renderRequestedCustomerError 等只读路径
     保留，可写入口按兼容策略收敛）；
   - widget 模式身份/来源标签（sourceTagMarkup）评估下沉；
   - 浏览器双角色验证 widget 默认视图（sales/manager）。
3. 全量绿灯，可继续。
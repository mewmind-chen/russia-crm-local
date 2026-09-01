# Session Checkpoint：阶段 E 续片——抽屉注册表组合与 iframe 兼容边界

日期：2026-09-01  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `79036e5` feat(widget): compose crm drawer from registry

阶段 E 续片：

- `crmDrawer` 注册表新增下一步、事实、主档、时间线四个非 AI widget；`renderDrawer` 通过注册表按序同步选配，单个 widget 不可用时回退原模板，保留即时 DOM 契约、动作区和权限门控。
- 默认 customerProfile widget 模式清理兼容 iframe 的遗留 `src`，`openCustomerProfile`、`openIntakeMasterProfile`、主题切换和 frame reload 仅在显式 `profileView=legacy` 时设置/刷新 iframe。
- AI 区域仍走既有冻结路径；本轮未新增、恢复或修改 AI 行为。
- 更新抽屉布局、widget registry、profile iframe 静态契约，确保架构变化不放松原有安全/布局约束。

### `6bfa5f0` test(widget): align drawer summary contracts

按注册表组合后的实际结构更新抽屉摘要/布局静态契约断言；不改变运行时代码或 AI 边界。

## 测试证据

- 列表 widget/访问控制/API 定向：`62/62`。
- widget/抽屉/iframe 定向：`105/105`。
- `npm test`：core `1716/1716`。
- `node --test`：全量 `2078/2078`。
- `node --check sales-assets/app.js scripts/progress_board.js test/issue286_customer_drawer_summary.test.js`：通过。
- `git diff --check`：通过。
- `npm run check:governance-authority`、`npm run check:ai-boundary`：将在本 checkpoint 文档生成并提交后复跑。
- `npm run phase:e:browser-preview`：当前环境无锁定可用 Playwright/Puppeteer，按设计 fail-closed 退出 78；未伪造浏览器通过。

## 当前判断与下一步

阶段 E 的普通业务列表迁移与 CRM 抽屉非 AI 注册表组合已落地；仍不宣称阶段 E 完成。剩余硬门是具备锁定浏览器依赖后完成 sales/manager 双角色真实验收，并继续评估 CRM 复杂 activity timeline 的 widget 化与兼容层收敛。

AI 功能继续弃用冻结；生产目录、远端 `main` 和部署状态保持只读。

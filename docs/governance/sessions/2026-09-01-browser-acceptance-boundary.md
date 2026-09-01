# Session Checkpoint：阶段 E 续片——浏览器验收边界

日期：2026-09-01  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `3b2fe24` test(widget): strengthen phase E browser acceptance

- 加强 `scripts/phase-e-browser-preview.js` 的 sales/manager 双角色验收断言。
- 默认 `customerProfile` 路径必须进入 active 视图、挂载 widget host、保持兼容 iframe 无 `src`；profile-only 兼容入口必须打开详情但隐藏保存动作。
- 断言继续通过 loopback 隔离预览、AI 关闭与 fail-closed 依赖检查，不改 bootstrap 查询、后端写入或 AI 行为。

## 测试证据

- `node --check scripts/phase-e-browser-preview.js`：通过。
- `node --test test/phase_e_browser_preview_contract.test.js test/server_factory.test.js`：8/8 通过。
- 使用本机全局 `playwright-core 1.59.1` 连接系统 Chrome `152.0.7977.65` 做临时真实浏览器检查：manager/sales 均通过 root/profile HTTP 200、5 个 widget host、无 legacy iframe、profile-only 无保存动作、无 page error。
- 通过 Codex 隔离浏览器打开同一 loopback fixture 做只读界面核验：manager 客户列表可打开“列设置”，隐藏“国家 / 行业”并下移“客户”后刷新，active customer table 仍保持用户布局（列设置不回退）；仅使用合成 fixture 账号，不触碰生产数据。
- 官方 `npm run phase:e:browser-preview -- --run` 仍按设计 fail-closed：项目 `package.json` 未声明精确锁定的 Playwright/Puppeteer，未安装依赖，不将全局模块证据写成项目可复现验收。
- `npm run check:governance-authority`、`npm run check:ai-boundary`、`git diff --check`：本轮收口后复跑。

## 当前判断与下一步

Phase E 的浏览器核心断言已经具备；但项目完成门仍未通过。下一步只有在用户授权并具备项目内精确锁定的浏览器驱动及浏览器二进制后，运行官方 harness 完成 sales/manager 双角色验收；在此之前不删除旧入口、不进行生产动作、不触碰 AI 代码。

# 2026-09-01 Phase E 浏览器验收完成

## 目标

在不触碰生产进程、不改变 AI 业务行为的前提下，运行项目锁定的 Phase E 浏览器验收 harness，完成 sales/manager 双角色默认 customerProfile widget 与 profile-only 只读兼容入口验收。

## 执行

- 在 `after` 项目以精确版本 `playwright@1.62.1` 写入 `package.json`/`package-lock.json`；Chromium 151.0.7922.34、headless shell 与 ffmpeg 安装到用户缓存目录，不写入生产目录。
- `scripts/phase-e-browser-preview.js` 仍保持显式 opt-in、临时 SQLite、`127.0.0.1` 随机端口和 AI 全关闭；验收断言扩展为 widget ID、source-tag 宿主、AI widget/AI 标记隐藏、legacy iframe 边界与 profile-only 只读动作。
- 依赖缺失的 fail-closed 契约仍保留：模拟无驱动环境必须返回退出码 78。

## 证据

- 双基线（2026-09-01）一致：`origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 实现提交：`062f31a`（锁定 Playwright 与依赖契约）、`583f314`（补齐浏览器验收断言与输出语义）。
- `npm run phase:e:browser-preview -- --run`：退出码 0；driver=`playwright`、version=`1.62.1`、loopback 随机端口；manager/sales 均 root=200、capabilities=200、默认 profile active、5 个 widget host、`frameSrc` 为空且 iframe hidden、source-tag 容器存在、`aiWidgetMounted=false`、`aiBusinessVisible=false`、profile-only modal 打开且 actions 隐藏/save 不可见。
- Phase E harness 合同测试：`5/5`；`npm test`：`1726/1726`；`node --test`：`2088/2088`。
- `node --check scripts/phase-e-browser-preview.js`、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary` 均通过。
- `npm audit --omit=dev` 仍报告 `body-parser` 低危与 `fast-uri` 高危依赖链；与本次 dev-only Playwright 无关，本轮未执行扩大范围的 `npm audit fix`。

## 结论

阶段 E 的浏览器完成门已通过：定义范围内的 sales/manager 双角色 widget/profile-only 验收成功，生产未启动、未写入，AI 继续冻结。后续进入阶段 G 兼容层评估前保持当前实现稳定。

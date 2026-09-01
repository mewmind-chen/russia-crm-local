# Session Checkpoint：阶段 E 续片——旧入口兼容边界

日期：2026-09-01  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `bc84567` test(widget): lock legacy entrypoint compatibility boundary

- 明确并锁定统一入口：`/` 始终返回 `sales-crm.html` 统一壳。
- `CRM_ENABLE_LEGACY` 关闭时，`/legacy` 与 `/tradelead-v2.html` 均不可访问（404）。
- `CRM_ENABLE_LEGACY=true` 时，两个旧 HTML 路由继续提供兼容页面；未删除旧页面，也未改变 `/development-workbench` 的权限与 profile-only 只读契约。
- 该边界为阶段 E 当前可验证的兼容收敛结果；是否进入阶段 G 下线旧页面，保留到真实使用方与浏览器双角色验收之后再裁决。

## 测试证据

- `node --test test/server_factory.test.js`：4/4 通过，覆盖开关关闭/开启与 canonical root。
- `npm test`：core `1719/1719` 通过。
- `node --test`：全量 `2081/2081` 通过。
- `npm run check:governance-authority`、`npm run check:ai-boundary`：通过。
- `git diff --check`：通过。
- `npm run phase:e:browser-preview`：按设计 fail-closed；当前环境没有锁定 Playwright/Puppeteer，未安装依赖、不伪造浏览器验收。

## 当前判断与下一步

旧入口的运行时开关边界已具备自动化证据，阶段 E 当前仅剩 sales/manager 真实浏览器双角色验收。确认锁定浏览器依赖后，运行 Phase E harness，验证默认 customerProfile widget 视图及 `/development-workbench?profile=1` 只读兼容入口；在此之前不删除旧入口、不进行生产动作。

AI 功能继续弃用冻结；生产目录、远端 `main` 和 `before/` 保持只读。

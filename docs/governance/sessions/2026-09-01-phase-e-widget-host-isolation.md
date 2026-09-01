# Session Checkpoint：阶段 E——widget 注册表挂载宿主隔离

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
远端 main / production current：`57c4c42a89e7730545b726b29fd932c5bfb20574`
当前业务提交：`8a86425`（父提交回滚点：`8a86425^`）

## 背景

阶段 E 已将 customerProfile 接入 widget 注册表，并在 `29282df` 让统一壳默认使用 widget 视图；`e59bf22` 为 `/development-workbench` 的 profile-only 只读兼容门槛补了契约。本轮代码审计发现注册表缺少真正的逐 widget 宿主隔离，因此先修复组合根基，再继续新增 widget。

## 缺陷根因

`renderPage` 原先把所有 widget 直接渲染到同一个 root，没有每个 widget 自己的挂载边界。现有 facts/contacts/master/timeline/insight/next-step renderer 会调用 `replaceChildren()` 或写 `innerHTML`，因此后挂载区块会覆盖先前区块；注册表自身也不负责重跑清理，单个宿主创建失败还可能跳出整轮装配。现有测试只锁定调用顺序，没有验证多个区块同时留存。

## 实现

`8a86425` 在 `sales-assets/widget-registry.js` 完成以下收敛：

- 每次 `renderPage` 先清空 root；按本轮 `pages` 与 permission/feature/when 门槛计算 eligible widget。
- 每个 eligible widget 创建独立 host，设置 `data-widget-id`，再以 `render(host, ctx)` 渲染；因此每轮只保留本轮宿主，且宿主可观察、可定点回滚。
- host 创建与 widget render 均在同一 widget 边界内捕获异常，返回 `{ id, error }` 并继续后续 widget；保留 async render 与顺序装配。
- `test/widget_registry_contract.test.js` 增加重跑清理、权限变化裁剪、host 创建失败隔离及后续 widget 继续挂载的契约。

## 验证证据

- 前端专项：`98/98`。
- 最终 widget registry 契约：`42/42`。
- core `npm test`：`1665/1665`。
- 全量 `node --test`：`2026/2026`。
- `check:ai-boundary`、`check:governance-authority`、`git diff --check`：通过。

## 权限、AI 与生产边界

注册表既有 permission/feature/when 门槛保持不变；权限或开关变化只影响本轮 eligible host，不扩大数据范围。AI 区域仍由现有 customer AI 开关控制，未修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*`、既有 AI 触发点或运行时开关。本轮未执行 sales/manager 浏览器双角色验收，未执行生产验证、部署或生产目录写入。

## 回滚与下一最小动作

回滚点为 `8a86425^`；旧 profile iframe 仍可通过 `profileView=legacy` 显式兼容回退，profile-only workbench 保持只读兼容入口。下一最小动作是将 `sourceTagMarkup`／身份来源标签下沉为 UMD widget，之后做 sales/manager 浏览器双角色验证；阶段 E 仍不宣称完成。

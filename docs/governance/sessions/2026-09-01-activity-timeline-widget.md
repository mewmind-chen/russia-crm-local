# Session Checkpoint：阶段 E 续片——复杂活动时间线 widget 化

日期：2026-09-01  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `092d8a0` feat(widget): extract correction-aware timeline renderer

- `sales-assets/timeline-widget.js` 新增 correction-aware activity item/items 渲染器，负责时间线条目模板、文本转义、下一步、`data-timeline-kind`、更正按钮的 ready/disabled 状态和溯源文案。
- `sales-assets/app.js` 仅注入 `canStartActivityCorrection`、写入可用状态、已授权客户名称和活动标题/摘要等宿主回调；不把 state、API 或客户查询带入 UMD。`renderActivityTimelineItemFallback` 保留旧内联回退。
- CRM 抽屉时间线经 `activityTimelineItemsHtml` 使用 widget；全局事件委托仍处理 `[data-correct-activity]`，不新增 listener，不改变更正 API 或权限边界。
- 完整资料/线索/回收的普通时间线仍使用原 `renderItemsHtml` 路径；AI 功能、AI 专用列表与既有触发点未修改。

## 测试证据

- `node --check sales-assets/app.js sales-assets/timeline-widget.js`：通过。
- widget/抽屉/iframe + Issue 171/287 定向：全部通过（新增 correction-aware UMD 合约与 adapter 合约）。
- `npm test`：core `1718/1718` 通过。
- `node --test`：全量 `2080/2080` 通过。
- `git diff --check`：通过。
- 浏览器 Phase E harness 仍按设计 fail-closed：未锁定 Playwright/Puppeteer，不安装依赖、不伪造双角色验收。

## 当前判断与下一步

复杂 CRM activity timeline 的展示层已完成 widget 下沉，宿主仍保留权限/授权溯源判定与兼容回退；阶段 E 仍不宣称完成。下一硬门仍是具备锁定浏览器依赖后运行 sales/manager 双角色 customerProfile/profile-only 验收，随后再评估剩余旧入口兼容层。

AI 功能继续弃用冻结；生产目录、远端 `main` 和 `before/` 保持只读。

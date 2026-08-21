# 生产前端优化执行计划

> 状态：提案
> 范围：仅生产前端
> 基线：`main` 分支 `5d13704`（2026-08-21）

## 目标

在不改变业务行为的前提下，优化生产 CRM 的可访问性、响应式工作流、信息层级、表格扫描效率和异步反馈。

## 范围边界

包含：`sales-crm.html`、`sales-assets/*.css`、`sales-assets/*.js`、`shared-assets/ui-system.css` 和前端契约测试。

排除：服务端代码、API 路由和契约、数据库/schema、权限、客户生命周期、Recon Worker、AI Worker 以及 AI 任务中心 UI。由于生产环境不提供 AI 任务中心，AI 任务中心、AI 治理面板、模型/成本/Worker 筛选和 AI 任务分页明确不在本次范围内。

## 任务拆分

| 顺序 | 任务 | 预计耗时 |
| --- | --- | ---: |
| 0 | 基线、版本和测试记录 | 0.5-1 day |
| 1 | 无障碍与基础交互修复 | 1-1.5 days |
| 2 | CRM 响应式工作流优化 | 2-3 days |
| 3 | 视觉 Token、字体和形状系统 | 1.5-2 days |
| 4 | Dashboard 信息层级优化 | 1.5-2 days |
| 5 | 客户/线索表格与筛选器优化 | 2-3 days |
| 6 | 客户 Drawer 与 Profile 层级优化 | 1.5-2.5 days |
| 7 | Loading、Empty、Error、Saving 状态 | 1-1.5 days |
| 8 | 文案、图标和模板痕迹清理 | 1-1.5 days |
| 9 | 多角色浏览器回归和生产验证 | 1.5-2 days |

总计：12-17 个开发工作日；包含浏览器和生产验证：14-19 个工作日；约 40 个可跟踪执行步骤。

## 执行顺序

`0 -> 1 -> 2 -> 3 -> 5 -> 6 -> 4 -> 7 -> 8 -> 9`

## 验收标准

- Preserve API request paths, parameters, response contracts, permissions, and data scope.
- Verify Admin, Manager, and Sales roles.
- Verify 375x812, 768x1024, 1024x768, 1440x900, and 1920px+.
- No page-level horizontal scrolling.
- Keyboard navigation, focus return, reduced-motion, labels, and live regions pass review.
- `npm test`, frontend contract tests, Node syntax checks, and copy scan pass.
- Production `/healthz` release SHA matches the deployed commit.
- AI Task Center is absent from the implementation and acceptance matrix.

## 工作拆分

### Issue 1 - 无障碍与基础交互修复

为客户 Drawer 增加 Dialog 语义和焦点隔离；补全表单标签和可访问名称；明确按钮类型；改善 Escape/Tab 行为；补充加载、错误和成功状态；保留 icon-only 控件的可访问名称。

### Issue 2 - CRM 响应式工作流优化

使用稳定视口单位和安全区；让移动端 Drawer 接近全屏；拆分常用和高级筛选；小屏只保留优先表格列；保留有意的表格滚动；移动端控件至少 44px。

### Issue 3 - Visual system

统一语义颜色、系统优先中文字体、等宽数字、11px 最小操作文字、6-8px 面板/控件圆角、克制阴影、明确过渡属性和减少动效行为。

### Issue 4 - Dashboard 信息层级优化

Prioritize "需要我处理", make the funnel readable at wide widths, reduce equal-weight KPI treatment, and remove decorative section labels without changing metrics or APIs.

### Issue 5 - Tables and filters

Improve row rhythm, company-name anchoring, status semantics, secondary-field hierarchy, action-column stability, advanced-filter disclosure, applied-filter chips, reset behavior, and mobile detail routing. Keep authorization and serialization unchanged.

### Issue 6 - Customer Drawer and profile

Use grouped definition rows for identity, business, contacts, compliance, and lifecycle; promote next action; separate human evaluation, history, and audit; handle empty values and long content; preserve existing customer APIs.

### Issue 7 - Async states

Add shape-matched skeletons, actionable empty/error states, saving/submitting/claiming feedback, batch selection scope, and accessible live updates.

### Issue 8 - Copy and visual cleanup

Remove unnecessary English eyebrow labels, Unicode remnants, repeated pills, decorative dots, version strips, excess separators, and non-semantic motion. Do not remove valid product terminology.

### Issue 9 - Verification

Run focused and full tests; test all three roles and all production views; capture the viewport matrix; verify keyboard and reduced-motion behavior; check production health and record screenshots.

## 回滚规则

每个任务都应可独立回滚，不需要数据库或后端回滚。只有在记录生产 SHA 和浏览器验证证据后，才算该版本通过验收。

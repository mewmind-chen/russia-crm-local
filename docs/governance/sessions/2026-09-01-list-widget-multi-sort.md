# 2026-09-01 List widget 多级排序收口

## 目标

在不触碰 AI 功能的前提下，把“所有普通列表页的用户级列显隐、列顺序、升降序/多级排序和布局偏好”从 UI 配置推进到可执行的前后端协议，并保持远端基线与生产基线作为唯一双基线。

## 实现

- `sales-assets/list-widget.js` 增加排序描述归一化、排序控件读取、稳定多级比较和表格渲染排序；列设置面板提供每列优先级与升/降序，偏好仍按用户存储并按当前授权 schema 清洗。
- `lib/list_sort.js` 提供服务端 JSON 排序解析与 SQL `ORDER BY` 生成；字段只允许页面白名单，非法字段、方向、重复字段、格式或超长描述统一 fail-closed 为 `SORT_NOT_AUTHORIZED`（403），合法排序追加稳定主键。
- 客户、Intake/Lead Flow、Research People/Recon、Pipeline、Alerts、回收站、通知、Insights、主管任务/风险/指标及受保护客户目录均接入服务端授权排序；Dashboard、Markets、Team、维护/更正/审计、用户管理和入库批次在统一 widget 内执行页内排序。
- 保留既有标量排序预设、筛选、分页、导出、行操作和权限/脱敏边界；清空多级排序后安全回退到页面默认预设。AI 专用列表、AI 内部模块与既有 AI 触发点未修改。

## 证据

- 双基线（2026-09-01）一致：`origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 实现提交：`549fdfd`（`feat(list-widget): add authorized per-user multi-sort`）。
- `npm test`：1725/1725；`node --test`：2087/2087。
- 列表/排序定向测试：67/67；全量 `node --check`、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary` 均通过。
- 逐页面 JSON 排序接口烟测：Intake、Lead Flow、Pipeline、Alerts、Insights、回收站、通知、主管任务/风险/指标、Research People/Recon、受保护客户目录及各自字段映射均返回 200；未触发生产写入。

## 未完成项

官方 Phase E 浏览器 harness 仍需项目内锁定 Playwright/Puppeteer 后执行 sales/manager 双角色验收；既有临时全局浏览器检查仅作边界证据，不替代项目门禁。生产未部署、未修改。

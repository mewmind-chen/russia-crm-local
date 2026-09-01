# 2026-09-01 List widget Team 业务列表

## 范围

- 将 Team 业务推进的销售汇总、客户/主管待办/事实时间线明细，以及协作支持记录接入 `sales-assets/list-widget.js`。
- 新增 `team_progress_sales`、`team_progress_drilldown`、`team_collaboration` 三套非 AI 字段目录；动作列仍由页面按权限固定提供。
- 为三类列表分别提供当前用户的列显隐、列顺序、排序预设和布局持久化；排序只作用于当前已授权结果页，不改变服务端筛选、分页、数据范围或导出。
- 保留客户/待办钻取、协作补充/更正/撤销、事实来源与操作人信息；Team 能力/辅导区的 AI 内容未触碰。

## 权限与边界

- 有效字段继续由 `/api/sales-crm/field-schema/:pageKey` 按角色与权限返回，客户端偏好不能扩大字段范围；必需身份/客户/动作列不可隐藏。
- Team 进度继续消费 `/team-status`（含 since-last-view 服务端游标）与既有授权过滤器；协作继续消费 `/collaboration-support` 及原写权限门控。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --check sales-assets/app.js`、`node --check lib/field_catalog.js`、`git diff --check`：通过。
- Team/列表专项 `node --test test/issue174_team_status_ui.test.js test/list_widget.test.js test/field_catalog.test.js`：`31/31` 通过。
- `npm test`：core `1704/1704` 通过。
- AI boundary 与 governance authority 门禁：通过。

## 结果与后续

Team 三类非 AI 业务列表已接入统一 List widget，原有授权过滤、分页、钻取和协作写操作保持不变。

阶段 E 仍未完成。下一步在继续迁移其余业务列表前，优先运行已建立的隔离 preview harness 完成 sales/manager 双角色浏览器验收；随后评估 Insights 人工评价列表和受保护客户目录，明确排除 AI 字段及后台管理/运维列表。

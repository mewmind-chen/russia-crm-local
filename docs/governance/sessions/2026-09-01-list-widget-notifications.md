# 2026-09-01 List widget Notifications

## 范围

- 将销售工作台通知中心接入 `sales-assets/list-widget.js`。
- 新增通知字段目录：状态、通知、客户、详情、时间、投递；操作列由页面动作负责并保持必选。
- 按当前用户保存列显隐、列顺序与排序预设；排序只接受服务端白名单：未读优先、最近更新、严重程度、通知标题。
- 桌面端使用共享 descriptor table，移动端继续使用既有通知卡片；保留未读/全部筛选、已读动作、客户/业务跳转、汇总统计和授权分页。

## 权限与边界

- 字段目录由 `/api/sales-crm/field-schema/notifications` 提供；客户端布局只在服务端有效字段 schema 内生效。
- `/api/sales-crm/lists/notifications` 对未授权排序返回 `403 SORT_NOT_AUTHORIZED`；排序 SQL 只从后端白名单映射生成。
- 本轮不改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；没有新增 AI 列、推荐或生成行为。通知现有 AI 过滤与脱敏继续由原服务端/客户端门控负责。
- `repo/` 远端 `main`、生产 `current` 与 `state.json.lastSuccessfulSha` 均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，未部署、未合并、未推送。

## 验证

- `node --test test/issue116_business_page_api.test.js test/list_widget.test.js`：`21/21` 通过。
- `npm test`：core `1689/1689` 通过。
- `node --test`：全量 `2050/2050` 通过。
- `node --check`（修改后的 JS）与 `git diff --check`：通过。
- `npm run check:governance-authority`：通过。
- `npm run check:ai-boundary`：通过（193 个文件）。

## 结果与后续

通知中心成为第七套 List widget 样板，与 customers、Research People、不对口记录、Pipeline、Intake/lead_flow 和 Alerts/今日待办共同验证授权字段目录与用户级布局协议。阶段 E 仍未完成；其余业务列表迁移及隔离预览环境中的销售/经理浏览器验收继续排队。

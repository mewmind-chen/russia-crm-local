# Phase C/E：List widget 协议与客户列表样板

日期：2026-09-01

## 目标

开始执行“所有业务列表页支持用户级列显隐、列顺序和排序偏好”的联合目标，先建立
可复用协议并迁移一个分页业务列表作为样板。

## 本轮范围

- 新增 `sales-assets/list-widget.js` UMD widget：列 schema 归一化、必选列保护、
  显隐/顺序设置面板、升降序/多级排序描述、偏好读写、descriptor table 渲染。
- 新增 `customers` 服务端字段目录，沿用 `/api/sales-crm/field-schema/:pageKey`
  的有效 schema 门控；前端偏好只在该 schema 与本页静态动作列范围内生效。
- 客户列表接入列设置按钮：每个用户按 user id + page key 保存 `visibleColumns`、
  `columnOrder` 和既有五种服务端排序预设；公司和操作列保持必选。
- 保留现有客户分页、筛选、选择、权限和服务端排序 API；不改 AI 内部、生产数据、
  远端分支或部署。

## 验证

- 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 生产 `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- after 分支：`codex/frontend-widget-pilot`
- 业务提交：`c246360 feat(frontend): add shared list widget customer pilot`；后续 `e76ae96` 在切换用户时清空旧有效 schema，避免权限短暂串用。
- List widget/字段目录专项：`27/27`
- `npm test`：`1677/1677`
- `node --test`：`2038/2038`
- `node --check sales-assets/app.js`：通过
- `git diff --check`：通过
- 未启动 runtime，未执行浏览器验收，未写入生产；AI 代码零改动。

## 当前结论

通用协议和客户列表样板已可回归验证，但“所有列表页”尚未宣称完成。当前分页授权
业务列表仍有多套状态机，下一切片优先迁移 Research People 只读列表，再按页面逐步
迁移线索池、管道、告警、洞察、回收站、主管列表和通知等页面。

## 回滚点

回退 `c246360` 即可移除 List widget 和 customers schema；既有客户 table、分页、
筛选、选择和五种服务端排序行为保留在前一提交中。生产目录保持只读。

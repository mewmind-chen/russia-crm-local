# Issue #157 开发交接

更新时间：2026-07-31

Issue：[修复今日待办操作闭环：超时线索、补充计划与管理者协助可直接处理并完结](https://github.com/mewmind-chen/russia-crm-local/issues/157)

## 项目背景

管理员、老板和主管原先能在“今日待办”看到异常提醒，但部分唯一建议动作只打开普通客户
详情或无定位地跳转到分配中心，无法直接完成业务处理。Issue #157 将今日待办改为可执行入口：
超时未领取线索可重新分配或退回线索池，缺少下一步计划可独立补计划，管理者协助请求可
填写结果并办结。待办是否消失始终由后端业务状态决定。

## 分支与发布方式

- 仓库：`mewmind-chen/russia-crm-local`
- 功能分支：`codex/issue-157-today-task-actions`
- 功能基线：`origin/main@37e885814e2131b7699e95f9a94af2086cf623ea`
- 功能提交：`1c4b853ce5e477e6c3f7847227892bdf0458cefc`
- 功能 PR：[PR #162](https://github.com/mewmind-chen/russia-crm-local/pull/162)
- 合并提交：`f066b134fa9c9a1d5d33f0e347ae3ba927cc8a4b`
- 发布方式：PR 合并 `main` 后由 macOS 不可变发布脚本自动部署

生产目录未被手工修改。自动部署器只接受 `origin/main`，先验证、备份，再切换不可变
release 并执行健康检查。

## 已完成功能

### 1. 超时未领取线索

- “处理超时线索”在当前页面打开紧凑弹窗，显示客户、负责人、分配时间和超时时长。
- 可搜索启用中的销售人员并重新分配；新负责人获得新的 24 小时领取期限。
- 原负责人领取资格立即失效，新负责人可正常领取。
- 可退回线索池，负责人和领取时间清空，固定记录原因“超过24小时未领取”。
- intake 与已关联 CRM account 在同一事务中更新，不删除客户、线索或历史负责人数据。
- `crm_intake_decisions` 和 `crm_audit_log` 保留原负责人、处理人、处理方式、新负责人和时间。

### 2. 独立补充下一步计划

- “立即补计划”打开独立弹窗，展示客户、当前负责人和阶段。
- 下一步计划和执行时间必填，只更新客户计划字段，不伪造客户活动或客户新进展。
- 销售仅能为自己负责的客户补计划；管理员和经理仅能处理授权范围内客户。
- 管理者代填时审计记录标记实际操作人、客户负责人和 delegated 状态。
- 保存后由最新后端状态重新计算待办；其他未解决原因仍保留并提升为主要原因。

### 3. 管理者协助办结

- “处理协助请求”显示客户、申请人、申请时间和最近一条真实的管理协助原因。
- 管理者必须填写处理意见或协助结果，完成后清除待介入状态。
- 处理结果写入真实客户时间线，相关销售可在客户历史中查看。
- 时间线、客户状态、审计和幂等结果在同一事务中完成；任一步失败全部回滚。

### 4. 今日待办一致性

- 所有现有原因均映射到真实业务入口：超时线索、补计划、经理协助、报价或记录新进展。
- 每条待办携带后端 `actionKind` 和 `allowedActions` 能力标记；前端仍保留角色和权限防御。
- 成功后刷新 bootstrap、顶部及侧栏数量、四个严重程度汇总和当前列表。
- 当前严重程度标签保持不变，不做前端乐观删除。
- 保存失败、权限拒绝或状态冲突时保留待办并显示后端错误。
- 稳定幂等键和提交锁防止双击、网络重试造成重复分配或重复时间线。

### 5. 权限与数据范围

- 新路由 `POST /api/sales-crm/today-tasks/actions` 要求 `view_alerts`，身份检查期间阻止写入。
- 重新分配/退回要求管理员或经理角色及 `manage_intake`。
- 补计划要求 `record_activity` 和客户数据范围。
- 完成协助要求管理员或经理角色、`view_team`、`view_alerts` 和客户数据范围。
- 无权限统一返回 `403`；过期或已变化的业务状态返回 `409`，不写入部分结果。

## 测试与验证

- 本地最终完整回归：`807/807`，0 失败，耗时约 33.5 秒。
- Issue #157 后端专项：8 项通过，覆盖三条闭环、权限拒绝、幂等、冲突和事务回滚。
- Issue #157 UI 专项：6 项通过，覆盖动作路由、紧凑弹窗、错误保留、数量刷新和权限能力。
- 既有 access control、今日待办、业务筛选回归：24 项通过。
- `node --check` 通过 `lib/sales_crm.js`、`lib/business_page_filters.js` 和
  `sales-assets/app.js`；`git diff --check` 通过。
- 浏览器实测桌面及 `390x844`：三类弹窗均位于视口内，无横向溢出，按钮和必填字段可用。
- PR CI：[Actions #30631247968](https://github.com/mewmind-chen/russia-crm-local/actions/runs/30631247968)
  第 1 次运行成功，校验 SHA 为 `1c4b853ce5e4`，耗时 3 分 45 秒。
- `main` CI：[Actions #30631622308](https://github.com/mewmind-chen/russia-crm-local/actions/runs/30631622308)
  第 1 次运行成功，校验 SHA 为 `f066b134fa9c`，耗时 5 分 6 秒。

## 生产发布证据

- PR #162 于 `2026-07-31T12:42:47Z` 合并，Issue #157 于下一秒自动关闭。
- 自动部署于 `2026-07-31T12:45:14.235Z` 成功。
- 当前 release：`/Users/ylf/Desktop/projects/tradepulse-production/releases/f066b134fa9c`。
- 回滚 release：`/Users/ylf/Desktop/projects/tradepulse-production/releases/37e885814e21`。
- 上线前自动备份：
  `/Users/ylf/Desktop/projects/tradepulse-production/state/backups/crm-before-f066b134fa9c-20260731T124511Z-51749.db`。
- 备份数据库和当前生产数据库 `PRAGMA quick_check` 均返回 `ok`。
- 本机 `http://127.0.0.1:3000/healthz` 与公网
  `https://crm.newmindchen.com/healthz` 均返回 `ok=true`、`database=ok` 和完整合并 SHA。
- 公网首页返回 HTTP 200，线上 `sales-assets/app.js` 已包含“处理超时线索”、
  “补充下一步计划”和“处理协助请求”入口。
- 部署状态没有 `lastFailedSha` 或失败阶段。
- GitHub Actions 仍有一条非阻塞 Node.js 20 弃用注解，运行器自动使用 Node.js 24；
  与前次发布一致，不影响本次结果。

## 已修改文件

- `lib/access_control.js`：新动作路由权限与身份检查阻断。
- `lib/business_page_filters.js`：超时 intake 动作能力、授权过滤和待办汇总。
- `lib/sales_crm.js`：三类动作事务、审计、幂等、状态冲突和待办上下文。
- `sales-assets/app.js`：所有待办动作路由、三个弹窗、提交锁、错误和成功刷新。
- `sales-assets/app.css`：紧凑弹窗与窄屏布局。
- `test/access_control.test.js`：高风险路由策略回归。
- `test/issue157_today_task_actions.test.js`：后端闭环和安全专项。
- `test/issue157_today_task_ui.test.js`：前端契约与响应式专项。

## 未完成事项

- Issue #157 功能、发布和生产验收均已完成，没有遗留的必做开发项。
- GitHub Actions Node.js 20 弃用注解可在后续基础设施维护中单独处理。

## 注意事项

- 生产只部署 `origin/main`，不要直接修改生产目录或手工替换 `current`。
- 待办完成状态必须继续由后端业务状态计算，不能增加前端忽略或仅隐藏功能。
- 重新分配必须同时更新 intake 和关联 account，并重新生成 24 小时领取期限。
- 补计划与记录客户新进展是两种业务动作，不要用虚假 activity 代替计划更新。
- 管理协助结果必须保留真实时间线、处理人和审计记录。
- 所有写动作必须继续执行角色权限、客户范围、身份检查和幂等保护。
- SQLite 恢复属于人工操作，必须停止服务后执行；自动部署器不得自动恢复数据库。

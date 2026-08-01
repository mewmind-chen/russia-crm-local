# Issue #174、#173 与生产发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 完成“团队状态”的业务推进、销售能力、协作支持，并通过 #173 的销售、主管、老板三角色验收安全部署上线。

**架构：** `team_status` 服务只聚合 #170/#171 的结构化事实并执行后端 scope；前端保留现有销售能力渲染并增加两个栏目。#173 不再实现大型功能，只运行跨流程验收并修复明确集成缺陷。

**技术栈：** Node.js、SQLite、Express、原生前端、Node test、GitHub CLI、Mac release deployer。

## 全局约束

- #174 依赖 #170 和 #171 全部完成。
- 保留现有综合得分环、能力分项、个人漏斗、优势、短板、辅导建议、样本数和样本不足提示。
- 不创建主管排行榜、主管评分或员工“优秀/不合格”结论。
- 生产部署只以 `origin/main` 为源码；数据库恢复永远是人工操作。

---

### Task 1：#174 团队状态数据与权限

**文件：**

- 创建：`lib/team_status.js`
- 修改：`lib/sales_crm.js: buildTeamReport、bootstrap、paged routes`
- 修改：`lib/access_control.js`
- 创建：`test/issue174_team_status_data.test.js`
- 创建：`test/issue174_team_status_permissions.test.js`

**接口：**

- `buildTeamStatus(db,user,{range,since}) -> {progress,capability,collaboration,sample}`。
- `listCollaborationSupport(db,user,{status,ownerId,from,to}) -> scoped rows`。
- `recordExternalAssistance(db,user,payload) -> collaboration event`。
- `getTeamStatusViewCursor(db,userId) -> {lastViewedAt}`，`markTeamStatusViewed(db,userId,viewedAt) -> {lastViewedAt}`。
- 权限键 `record_collaboration_support`：admin/manager 默认允许，sales 默认拒绝。

- [ ] **步骤 1：写数据口径失败测试**

业务推进同时返回真实推进、沉默、延期、形成计划、计划后有效动作的数量、比例、样本范围；capability 输出和现有 `buildTeamReport` 数据一致；collaboration 区分系统事实和手工补记。

- [ ] **步骤 2：写三角色权限测试**

老板看到团队汇总、长期未解决、主管逾期和升级；主管看到授权范围；销售只看到本人及本人客户协作；销售直接请求他人 detail/export 返回 403 或不枚举；手工补记路由要求 `record_collaboration_support`。

- [ ] **步骤 3：实现聚合服务**

消费 #170 manager tasks/deferred plans 和 #171 effective activity/corrections；创建 `crm_team_status_views(user_id PRIMARY KEY,last_viewed_at,updated_at)`，服务端按用户读取和更新查看游标，返回 7d、30d、since-last-view；样本不足使用结构化 `unavailable`，不得用 raw total 生成员工评价。

- [ ] **步骤 4：实现系统外协助补记**

新增 `crm_collaboration_events`，保存 sales user、可选 stable customer ID、问题、建议、结果/下一步、actor、source、status、timestamps 和 audit。自动业务事实不要求主管重复填日报。

- [ ] **步骤 5：测试和 PR**

```bash
node --test test/issue174_team_status_data.test.js test/issue174_team_status_permissions.test.js test/issue171_effective_activity.test.js test/issue170_manager_metrics.test.js
npm test -- --test-concurrency=1
git add lib/team_status.js lib/sales_crm.js lib/access_control.js test/issue174_team_status_data.test.js test/issue174_team_status_permissions.test.js
git commit -m "feat: add scoped team status data"
git push -u origin codex/issue-174-team-status-data
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-174-team-status-data --title "feat: add scoped team status data" --body "Refs #174. 提供业务推进、销售能力和协作支持的数据及权限契约。"
```

---

### Task 2：#174 团队状态界面

**文件：**

- 修改：`sales-crm.html`
- 修改：`sales-assets/app.js: viewMeta.team、renderTeam、renderTeamDetail`
- 修改：`sales-assets/app.css`
- 创建：`test/issue174_team_status_ui.test.js`

- [ ] **步骤 1：写 UI 失败测试**

入口名称为“团队状态”；三栏为“业务推进/销售能力/协作支持”；现有 score ring、能力条、个人 funnel、优势短板、辅导建议仍有实际渲染；源码和页面不存在主管排行榜/评分。

- [ ] **步骤 2：实现三栏和下钻**

复用 `renderTeam/renderTeamDetail`；增加时间范围、status filter、summary -> customer/task/timeline drill-down 和返回状态保持；处理 loading、empty、insufficient sample、forbidden 和 server error。

- [ ] **步骤 3：实现响应式布局**

桌面使用紧凑工作界面；移动端单列，只有页签容器可横向滚动，页面主体无横向溢出。协作事实显示来源和处理状态，不使用主管榜单。

- [ ] **步骤 4：三角色浏览器验证**

在 1280/430/390/375/320px 分别以老板、主管、销售验证三栏、筛选、下钻、返回和权限；控制台无错误，sales 无法获取他人 detail。

- [ ] **步骤 5：测试、提交并关闭 #174**

```bash
node --test test/issue174_team_status_ui.test.js test/issue174_team_status_data.test.js test/issue174_team_status_permissions.test.js test/sales_evaluation_ai.test.js
npm test -- --test-concurrency=1
git add sales-crm.html sales-assets/app.js sales-assets/app.css test/issue174_team_status_ui.test.js
git commit -m "feat: add team status workspace"
git push -u origin codex/issue-174-team-status-ui
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-174-team-status-ui --title "feat: add team status workspace" --body "Closes #174. 保留销售能力并新增业务推进、协作支持和响应式权限下钻。"
```

---

### Task 3：#173 三角色端到端验收

**文件：**

- 创建：`test/issue173_three_role_acceptance.test.js`
- 创建：`docs/acceptance/issue-173-three-role-evidence.md`
- 修改：只允许修复跨流程集成缺陷；能归属前置 Issue 的缺陷回链原 Issue。

- [ ] **步骤 1：创建隔离账号和数据**

扩展 `test/helpers/permission_fixture.js` 的临时数据库，创建老板、主管、销售、本人客户、他人客户、保护客户和多个待办原因；禁止连接生产运行数据库。

- [ ] **步骤 2：验收销售流程**

搜索有权客户 -> 记录动作 -> 填明确计划或暂未确定 -> 保存。断言 stage、last activity、next plan、alerts、metrics、notification 和刷新一致；过去时间、重复请求、无权目标、500 失败分别验证拒绝、幂等、权限和输入保留。

- [ ] **步骤 3：验收主管流程**

打开今日待办 -> 查看销售/客户/原因/证据 -> 形成计划、暂停/流失、重新分配、记录辅导或升级。断言只关闭当前 reason，其他 reason 保留；list/count/notification 即时刷新且刷新后不复现。

- [ ] **步骤 4：验收老板流程**

查看 7 天、30 天、since-last-view 的推进、沉默、延期、计划后动作、主管处理/逾期/升级和协作；下钻到事实；确认无主管评分或销售定性。

- [ ] **步骤 5：记录桌面、移动和数据库证据**

在 1280/430/390/375/320px 截图；记录每条流程操作前后的 stable customer ID、activities、plan events、manager tasks、corrections、notifications、metrics 和 audit rows。

- [ ] **步骤 6：运行最终自动测试**

```bash
node --test test/issue173_three_role_acceptance.test.js test/issue96_intake_crm_invariant.test.js test/issue168_today_task_mobile.test.js test/issue170_manager_tasks.test.js test/issue171_correction_transaction.test.js test/issue174_team_status_permissions.test.js
npm test -- --test-concurrency=1
```

预期：全部通过，证据文档包含三个角色的步骤、实际耗时、截图路径、数据对照、失败与重试结果。

- [ ] **步骤 7：提交验收 PR**

```bash
git add test/issue173_three_role_acceptance.test.js docs/acceptance/issue-173-three-role-evidence.md
git commit -m "test: complete three-role CRM acceptance"
git push -u origin codex/issue-173-e2e-acceptance
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-173-e2e-acceptance --title "test: complete three-role CRM acceptance" --body "Closes #173. 汇总所有前置 Issue 的三角色、权限、移动、失败恢复和数据证据。"
```

---

### Task 4：阶段生产部署和回滚门禁

**文件/路径：**

- 使用：`scripts/deploy-from-github.sh`
- 使用：`scripts/verify-release-gate.sh`
- 数据库：`/Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db`
- 备份：`/Users/ylf/Desktop/projects/tradepulse-production/state/backups/`

- [ ] **步骤 1：确认远端目标**

```bash
cd /Users/ylf/Desktop/projects/russia-crm-local
git fetch origin main
git rev-parse origin/main
gh pr list --repo mewmind-chen/russia-crm-local --state open
```

预期：目标 SHA 是刚合并提交，没有未审查且会改变本阶段源码的开放 PR。

- [ ] **步骤 2：备份和数据库检查**

```bash
release_backup_path="/Users/ylf/Desktop/projects/tradepulse-production/state/backups/crm-before-release-$(date -u +%Y%m%dT%H%M%SZ).db"
sqlite3 /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db ".backup '$release_backup_path'"
sqlite3 /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db 'PRAGMA integrity_check'
sqlite3 /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db 'PRAGMA foreign_key_check'
```

预期：`$release_backup_path` 存在，integrity 输出 `ok`，foreign key 无行；时间戳保证不覆盖上一份。

- [ ] **步骤 3：在生产副本运行功能预检**

#96 检查冲突数；#172 检查 identity unresolved；#170 检查 schema/settings；#171 检查 effective activity/correction schema；#174 检查聚合 query。任何 unresolved 或 integrity 异常均停止部署。

- [ ] **步骤 4：部署 origin/main**

```bash
cd /Users/ylf/Desktop/projects/russia-crm-local
DEPLOY_ROOT=/Users/ylf/Desktop/projects/tradepulse-production npm run deploy:mac:once
```

预期：candidate 中 `npm ci`、全量串行测试、语法验证通过；部署器完成 backup、atomic switch、restart、本地/公网 health check。

- [ ] **步骤 5：发布后验证**

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://crm.newmindchen.com/healthz
```

使用 `verify-release-gate.sh` 对 expected SHA 和生产 DB 执行校验；再按阶段执行真实低风险冒烟：#96 冲突 0、#168 移动按钮、#172 销售隔离、#170 未来时间/主管任务、#171 test customer 更正、#174 三角色视图。

首次部署 #172/#170/#171 时，对应写开关保持 `false`；读取、权限、schema 和回滚兼容检查通过后，只启用当前阶段的一个开关，重启服务并重复健康检查和真实低风险写入冒烟。

- [ ] **步骤 6：回滚判定**

若新写入尚未启用且 schema 向后兼容，可切 `previous` release 并重启。若已经产生 #171 correction 或不兼容身份写入，先停 CRM/worker，在维护窗口恢复对应 `.backup`，再切旧代码；禁止只切 symlink 后声称数据库已回滚，禁止运行状态复制 WAL。

- [ ] **步骤 7：记录生产证据并关闭 Issue**

在 #173 evidence 中记录 release SHA、备份路径、health JSON、integrity/foreign key、角色账号、截图、业务计数、审计计数、日志观察和回滚判断。对应 Issue 只有在生产门禁通过后关闭。

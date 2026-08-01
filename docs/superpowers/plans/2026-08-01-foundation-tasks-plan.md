# 基础、#169、#96、#168 实施计划

> **执行约束：** 本轮不使用或依赖任何 `superpowers:*` 技能。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 建立统一发布门禁，完成客户联系人线索术语、线索池/CRM 状态唯一性和今日待办移动端闭环。

**架构：** #96 后端和 #168 前端是唯一允许同时编码的首个并行窗口；两者分别拥有后端 identity/task contract 和前端 responsive rendering，#96 先合并，#168 rebase 后合并。

**技术栈：** Node.js 22、Express、SQLite、原生前端、Node test、GitHub CLI。

## 全局约束

- 继承总控计划全部约束。
- 计划基线为 `d0bdd104f924b736d8e653938c7899ede2272318`；执行时 fetch/rebase 当时最新 `origin/main`。
- #169 不修改 `view_contacts` key、API、schema 或角色权限布尔值。
- #96 生产清理保留原分配历史和审计。
- #168 不修改后端 alert identity、SQL 或权限规则。

---

### Task 1：发布检查基础

**文件：**

- 创建：`scripts/verify-release-gate.sh`
- 创建：`test/release_gate.test.js`
- 修改：`README.md`

**接口：** `verify-release-gate.sh --health-url <url> --expected-sha <full_sha> --database <absolute_db_path>` 依次检查健康 JSON、release SHA、SQLite integrity 和 foreign keys，失败返回非零。

- [ ] **步骤 1：创建失败测试**

在测试中启动临时 HTTP 服务并建立临时 SQLite：错误 SHA、非 JSON 健康响应、损坏数据库均应失败；正确 `{ok:true,releaseSha}` 和健康数据库应成功。

运行：`node --test test/release_gate.test.js`。

预期：脚本尚不存在，测试失败。

- [ ] **步骤 2：实现脚本**

脚本严格执行：`curl -fsS`；Node 解析并比较 `ok/releaseSha`；`sqlite3 "$db" 'PRAGMA integrity_check'` 必须等于 `ok`；`PRAGMA foreign_key_check` 必须为空。校验参数均为显式绝对路径，不读取运行中数据库的隐式默认值。

- [ ] **步骤 3：验证和提交**

```bash
node --test test/release_gate.test.js
zsh -n scripts/verify-release-gate.sh
git add scripts/verify-release-gate.sh test/release_gate.test.js README.md
git commit -m "chore: add release verification gate"
```

预期：测试通过，提交只包含上述三个文件。

---

### Task 2：Issue #169 联系人术语

**文件：**

- 修改：`sales-crm.html`
- 修改：`sales-assets/app.js: viewMeta.contacts`
- 修改：`Index.html: updateViewTitle 和联系人模块`
- 修改：`lib/access_control.js: PERMISSION_DEFINITIONS、PERMISSION_DESCRIPTIONS`
- 修改：`README.md`
- 创建：`test/issue169_contact_lead_copy.test.js`

**接口：** 可见标签统一为“客户联系人线索”，内部 key 仍为 `view_contacts`。

- [ ] **步骤 1：写失败测试**

断言两套运行时导航、页面标题和权限标签均使用“客户联系人线索”；联系人模块不再出现“负责人线索”；`view_contacts` 和三角色默认布尔值保持原值；代表内部 owner 的“负责人”文案仍存在。

运行：`node --test test/issue169_contact_lead_copy.test.js`。

预期：基线文案导致失败。

- [ ] **步骤 2：按上下文修改文案**

只修改联系人发现模块、L0/L2/L3 联系人描述和联系人快捷提示；禁止全局替换“负责人”，禁止改 owner filter、`missing_owner`、路由或数据库。

- [ ] **步骤 3：运行测试和视觉验证**

```bash
node --test test/issue169_contact_lead_copy.test.js test/sales_menu.test.js test/sales_access_ui.test.js test/access_control.test.js test/permission_integration.test.js
```

预期：全部通过。在桌面及 320/375/390/430px 验证侧栏、标题、权限组和个人权限弹窗无截断。

- [ ] **步骤 4：提交和 PR**

```bash
git add sales-crm.html sales-assets/app.js Index.html lib/access_control.js README.md test/issue169_contact_lead_copy.test.js
git commit -m "fix: clarify customer contact lead terminology"
git push -u origin codex/issue-169-contact-lead-copy
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-169-contact-lead-copy --title "fix: clarify customer contact lead terminology" --body "Refs #169. 仅修改联系人模块术语，保留 view_contacts 和销售负责人语义。"
```

---

### Task 3：Issue #96 状态唯一性和数据修复

**文件：**

- 修改：`lib/sales_crm.js: installIntakeCrmStatusSync、protectOpenIntakeForAccount、buildAlerts、groupAlerts、loadPayload`
- 修改：`lib/business_page_filters.js: buildIntakeAlerts、allTodayTasks、listTodayTasks`
- 创建：`scripts/audit-intake-crm-conflicts.js`
- 创建：`test/issue96_intake_crm_invariant.test.js`
- 修改：`test/today_tasks.test.js`、`test/today_tasks_integration.test.js`、`test/issue158_duplicate_protection.test.js`、`test/issue157_today_task_actions.test.js`

**接口：**

- `auditIntakeCrmConflicts(db,{apply:false}) -> {conflicts,applied}`。
- alert 必须包含 `externalCustomerId`。
- `groupAlerts` 优先按稳定外部编号，其次 account ID，最后 intake ID 分组。

- [ ] **步骤 1：写缺陷重现测试**

插入同一外部编号的 `assigned` intake 和 `claimed` CRM account，断言安装迁移后 intake 变成 `duplicate`、关联 `crm_customer_id`、清除活跃分配字段、保留审计；今日待办只返回一个客户对象并合并所有原因。

运行：`node --test test/issue96_intake_crm_invariant.test.js`。

预期：`assigned` 未被同步且待办按 intake/customer 分裂，测试失败。

- [ ] **步骤 2：修复触发器和回填**

在 `installIntakeCrmStatusSync` 中先显式 `DROP TRIGGER IF EXISTS`，再创建覆盖 `pending/approved/assigned` 的触发器；幂等回填已存在冲突，记录修改前 owner/status/assignment 时间，清除当前分配但不删除历史证据。

- [ ] **步骤 3：修复 alert identity**

CRM alert 和 intake alert 都携带稳定外部客户编号；先按用户 scope 过滤，再调用 `groupAlerts`，防止用跨范围数据合并并泄露。处理一个 reason 只移除该 reason。

- [ ] **步骤 4：实现只读预检脚本**

默认 `node scripts/audit-intake-crm-conflicts.js --db "$production_copy"` 仅输出 JSON；只有 `--apply` 才在 `BEGIN IMMEDIATE` 事务中修复并写 `crm_audit_log`。禁止脚本自行定位生产数据库。

- [ ] **步骤 5：运行聚焦测试**

```bash
node --test test/issue96_intake_crm_invariant.test.js test/today_tasks.test.js test/today_tasks_integration.test.js test/issue158_duplicate_protection.test.js test/issue157_today_task_actions.test.js
```

预期：全部通过；重复运行迁移不新增重复审计或改变已正确数据。

- [ ] **步骤 6：生产副本验证**

```bash
production_copy=/Users/ylf/Desktop/projects/tradepulse-production/state/preflight/crm-production-copy.db
mkdir -p /Users/ylf/Desktop/projects/tradepulse-production/state/preflight
sqlite3 /Users/ylf/Desktop/projects/tradepulse-production/shared/data/crm.db ".backup '$production_copy'"
node scripts/audit-intake-crm-conflicts.js --db "$production_copy"
node scripts/audit-intake-crm-conflicts.js --db "$production_copy" --apply
node scripts/audit-intake-crm-conflicts.js --db "$production_copy"
```

预期：第一次明确列出 `RU-0019`、`RU-0027`、`RU-0029`；apply 后冲突为 0，三条审计存在，数据库 integrity 为 `ok`。

- [ ] **步骤 7：提交和 PR**

```bash
git add lib/sales_crm.js lib/business_page_filters.js scripts/audit-intake-crm-conflicts.js test/issue96_intake_crm_invariant.test.js test/today_tasks.test.js test/today_tasks_integration.test.js test/issue158_duplicate_protection.test.js test/issue157_today_task_actions.test.js
git commit -m "fix: enforce one active intake or CRM state per customer"
git push -u origin codex/issue-96-intake-crm-invariant
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-96-intake-crm-invariant --title "fix: enforce one active intake or CRM state per customer" --body "Refs #96. 修复 assigned 同步、稳定客户待办分组和生产冲突审计迁移。"
```

合并并部署 #96，确认生产冲突为 0 后，才能合并 #168。

---

### Task 4：Issue #168 移动端今日待办

**并行边界：** 可与 Task 3 同时编码，只修改前端与 UI 测试。

**文件：**

- 修改：`sales-assets/app.js: todayTaskActionMarkup、renderAlerts、刷新逻辑`
- 修改：`sales-assets/app.css`
- 修改：`sales-crm.html`
- 创建：`test/issue168_today_task_mobile.test.js`

**接口：** 消费 #96 的 `{customerId,externalCustomerId,reasons,allowedActions}`，操作继续调用 `/api/sales-crm/today-tasks/actions`。

- [ ] **步骤 1：写移动端失败测试**

断言窄屏使用堆叠任务卡片；每个 reason 的允许操作有真实按钮；成功后局部刷新并保持筛选；桌面表格选择器仍存在。

运行：`node --test test/issue168_today_task_mobile.test.js test/issue157_today_task_ui.test.js`。

预期：基线缺少窄屏任务规则，新测试失败。

- [ ] **步骤 2：实现响应式结构**

桌面保留表格；`max-width:700px` 下改为 grid 卡片，字段 `min-width:0`，操作区 flex wrap，按钮最小高度 44px，文本允许换行，body 不横向溢出。

- [ ] **步骤 3：统一动作提交和刷新**

使用单一 `runTodayTaskAction` 管理 pending、错误、成功和列表刷新；请求失败保留弹窗输入，成功刷新 alerts 列表、数字和当前筛选，不复制后端动作权限。

- [ ] **步骤 4：浏览器验证**

在 1280/430/390/375/320px 验证 `document.documentElement.scrollWidth === window.innerWidth`；分别执行补计划、记录进展、经理协助，确认按钮可达，其他未解决 reason 保留。

- [ ] **步骤 5：在 #96 合并后 rebase、测试和提交**

```bash
git fetch origin main
git rebase origin/main
node --test test/issue168_today_task_mobile.test.js test/issue157_today_task_ui.test.js test/issue157_today_task_actions.test.js
npm test -- --test-concurrency=1
git add sales-assets/app.js sales-assets/app.css sales-crm.html test/issue168_today_task_mobile.test.js
git commit -m "fix: close today-task workflow on mobile"
git push -u origin codex/issue-168-today-task-mobile
gh pr create --repo mewmind-chen/russia-crm-local --base main --head codex/issue-168-today-task-mobile --title "fix: close today-task workflow on mobile" --body "Refs #168. 消费 #96 待办契约并完成移动和桌面回归。"
```

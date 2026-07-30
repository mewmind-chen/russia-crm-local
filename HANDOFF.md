# Issue #148 开发交接

更新时间：2026-07-30

Issue：[个人权限简化为“允许/拒绝”并自动处理权限组例外](https://github.com/mewmind-chen/russia-crm-local/issues/148)

## 项目背景

TradePulse 的账号权限采用“角色匹配的权限组 + 少量个人调整”模型。Issue #148
要求管理员只面对每项权限最终的“允许 / 拒绝”结果，不再手工理解或维护三态来源。
数据库仍以权限组为基础，只在个人选择与权限组不同的时候保存
`user_permission_overrides`，从而保留权限组批量调整能力。

本次还要求：

- 新建用户必须选择与角色匹配的权限组，并可在创建前调整最终权限。
- 保存个人权限时，服务端自动增加或删除个人调整。
- 更换权限组时明确确认、清空旧个人调整，并与审计处于同一事务。
- 历史账号升级前后的有效权限保持一致。
- 权限变化对现有登录态及时生效。
- 未知、缺失、非布尔权限值和伪造字段全部拒绝。
- 只有真实、有效的管理员可管理账号和权限，身份检查期间禁止修改。
- 最后一个有效管理员不能被停用、降权、换到受限组或关闭管理权限。
- 成员列表取消“更多操作”，符合条件的操作直接展示且适配手机、平板和桌面。

## 分支与工作区

- 仓库：`mewmind-chen/russia-crm-local`
- 开发分支：`codex/issue-148-binary-permissions`
- 隔离 worktree：
  `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/issue-148-binary-permissions`
- 开发基线：`origin/main@54ef0bef7b408c0b553c88927df2b1b0f39796eb`
- 主工作区：`/Users/ylf/Desktop/projects/russia-crm-local`
- 发布方式：PR 合并 `main` 后由 macOS 不可变发布脚本自动部署

主工作区包含用户自己的未提交改动，不要在其中 reset、checkout 或覆盖文件。本 Issue
始终在上述隔离 worktree 中开发和发布。

## 当前进度

### 已完成

1. 二选一个人权限

   - 个人权限弹窗每项只展示“允许 / 拒绝”。
   - 不再展示继承来源、权限组默认值、个人开启或个人关闭等技术状态。
   - 前端提交完整的最终布尔权限图。
   - 服务端以当前权限组为基准，只保存不同项；相同项自动删除个人调整。
   - 新建用户选择权限组后立即预览最终权限，并可在创建前调整。

2. 权限组与换组事务

   - 权限组保存同样要求完整布尔权限图。
   - 权限组修改后，无个人调整的字段自动跟随；个人调整继续保留。
   - 更换用户权限组前显示：
     `更换后将清除该用户原有的个人权限调整，并采用新权限组设置。`
   - 服务端不信任前端确认；只要权限组实际变化，就在更新事务内清空旧个人调整。
   - 换组审计 `user_permission_group_changed` 与账号更新、例外清理同事务提交。
   - 最后管理员校验失败时，账号组、个人调整和换组审计全部回滚。

3. 权限与安全

   - 账号新增、账号更新、权限组新增/更新、个人权限更新都要求真实管理员。
   - 身份检查期间继续由路由策略统一阻止安全写操作。
   - 个人权限接口只接受 `{ permissions: 完整布尔权限图 }`。
   - 未知权限、缺失权限、字符串状态和额外顶层字段返回 `400`。
   - 个人权限成功保存记录 `user_personal_permissions_updated` 专门审计。
   - 新建用户记录角色、权限组和个人调整数量，不记录密码。
   - 有效权限继续在每次会话解析时从数据库计算，无需重新登录。
   - 既有迁移逻辑和 `user_permission_overrides` 表结构未修改，历史有效权限不变。

4. 成员列表与响应式界面

   - 删除“更多操作”下拉菜单及相关 CSS。
   - 直接展示编辑账号、个人权限、修改密码、身份检查和归档账号。
   - 当前管理员只显示编辑账号、个人权限和“当前账号”，不显示身份检查或归档。
   - 身份检查只对启用的经理和销售展示。
   - 归档账号继续使用危险操作样式。
   - 手机卡片标签统一为“个人调整”，操作区允许自然换行。
   - 个人权限二选一保留原生单选语义、可见焦点，并支持空格和 Enter。
   - 资产缓存版本更新为 `20260730-issue148`。

5. 验证

   - Issue #148 专项及权限相关回归：`105/105`。
   - 修正缓存版本断言后的相关回归：`17/17`。
   - 最终全量测试：`764/764`，0 失败。
   - `lib/permission_groups.js`、`lib/sales_crm.js`、`sales-assets/app.js`
     均通过 `node --check`。
   - `git diff --check` 通过。
   - 浏览器实测 375、768、1024、1440 四档宽度，成员操作区无横向溢出，
     不存在“更多操作”菜单。
   - 375px 权限弹窗共 33 个二选一控件，弹窗、列表和控件均无横向溢出。
   - 浏览器键盘实测可用空格把“经营驾驶舱”从允许切换为拒绝。

### 发布状态

- 功能提交：待创建
- 功能 PR：待创建
- PR CI：待运行
- `main` CI：待运行
- 自动部署：待执行
- 生产健康检查：待验证
- Issue #148：保持打开，等待 PR 通过 `Closes #148` 自动关闭

## 已修改文件

- `lib/access_control.js`
  - 账号和权限写接口增加真实管理员策略。
- `lib/permission_groups.js`
  - 完整权限图校验、服务端差异计算、个人权限审计。
- `lib/sales_crm.js`
  - 新建用户权限、换组清理与同事务审计、个人权限新请求契约。
- `sales-assets/app.js`
  - 二选一编辑器、新用户权限预览、换组确认、直接操作按钮和键盘支持。
- `sales-assets/app.css`
  - 二选一控件、焦点样式、直接操作区和移动端布局。
- `sales-crm.html`
  - 权限文案、成员区说明和 Issue #148 资产版本。
- `test/issue148_binary_permissions.test.js`
  - 新建、差异保存、组传播、换组、回滚、安全校验和 UI 专项回归。
- `test/permission_group_api.test.js`
  - 三态接口回归改为完整布尔权限契约。
- `test/permission_integration.test.js`
  - 账号换组后的个人权限请求更新为新契约。
- `test/sales_access_ui.test.js`
  - 二选一和直接操作 UI 契约。
- `test/issue112_tag_semantics.test.js`
- `test/issue116_research_filter_component.test.js`
- `test/issue147_shared_nickname_ui.test.js`
  - 更新共享 CRM 资产缓存版本断言。
- `HANDOFF.md`
  - 本交接文档。

## 未完成事项

- 使用 `gh` CLI 创建提交、推送分支和 ready PR。
- 等待并确认 PR GitHub Actions 全部通过。
- 合并 PR 并确认 Issue #148 自动关闭。
- 等待 `main` CI 和 macOS 自动部署完成。
- 核对不可变 release、部署状态、本地与公网 `/healthz` 的精确提交 SHA。
- 上线后更新本交接文档中的发布证据。

## 下一步计划

1. 提交当前实现并推送 `codex/issue-148-binary-permissions`。
2. 使用 `gh pr create` 创建带 `Closes #148` 的 ready PR。
3. 使用 `gh pr checks --watch` 等待 PR CI。
4. CI 全绿后使用 `gh pr merge` 合并。
5. 等待 `main` CI、自动部署和生产健康检查。
6. 将最终 SHA、PR、Actions run、release 路径和健康检查写回 `HANDOFF.md`。

## 注意事项

- 不要修改或重置主工作区中的用户改动。
- 不要把个人权限 API 恢复为 `inherit / allow / deny` 三态。
- UI 可以隐藏当前关闭的 AI 权限项，但提交时必须保留这些权限的现有效值，服务端要求完整图。
- 换组清理必须保留在服务端事务中，不能只依赖浏览器确认。
- `user_permission_overrides` 是存储实现，不应重新暴露为管理员需要理解的来源选择。
- 权限组和个人权限请求都必须保持拒绝未知、缺失和非布尔权限值。
- 最后有效管理员保护必须覆盖角色、状态、权限组、权限组内容和个人权限五类变更。
- 生产部署只接受 `main`，不要直接修改生产目录或手工替换 `current`。

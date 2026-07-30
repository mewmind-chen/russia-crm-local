# Issue #147 开发交接

更新时间：2026-07-30

Issue：[将客户昵称提升为客户主档共享数据并修复线索页修改](https://github.com/mewmind-chen/russia-crm-local/issues/147)

## 项目背景

TradePulse 是面向电子元器件外贸团队的 CRM。Issue #147 要把原先保存在
`crm_accounts.nickname` 的昵称提升为稳定客户主档数据，使同一个
`external_customer_id` 在线索池、我的线索、CRM、回收站、客户选择器和导出中共享
同一昵称。

本次变更还要求：

- 未进入 CRM 的线索也能在 `edit_customer` 权限和当前数据范围内修改昵称。
- 展示时优先使用昵称，并同时保留正式名称和稳定客户编号。
- 昵称、正式名称和编号都能参与服务端搜索，且不能扩大用户的数据范围。
- 历史昵称无损迁移；冲突采用确定性规则并留下审计。
- 新增、修改、清空昵称均记录操作审计；身份检查场景同时记录真实用户和有效用户。
- 抽屉切换客户时重新计算操作按钮，不能遗留上一个客户的权限状态。
- 保持 Issue #144 和 #146 的线索状态与 CRM 状态语义不回归。

## 分支与工作区

- 仓库：`mewmind-chen/russia-crm-local`
- 开发分支：`codex/issue-147-shared-nickname`
- 隔离 worktree：
  `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/issue-147-shared-nickname`
- 开发基线：`origin/main@6cd62eb2c3a7a78ee2ed6b1955fde019e4eda199`
- 主工作区：`/Users/ylf/Desktop/projects/russia-crm-local`
- 发布方式：PR 合并 `main` 后由 macOS 不可变发布脚本自动部署

主工作区包含用户自己的未提交改动，不要在其中 reset、checkout 或覆盖文件。本 Issue
始终在上述隔离 worktree 中开发和发布。

## 当前进度

### 已完成

1. 共享昵称主档

   - `customer_pool.nickname` 成为唯一事实源。
   - `crm_accounts.nickname` 保留为兼容镜像，便于旧代码和回滚版本读取。
   - 主档更新会同步所有关联 CRM 账号；旧账号昵称写入会回写主档。
   - 线索、CRM、回收站、客户池和选择器统一昵称优先展示。

2. 历史迁移

   - 生产快照中 58 个 CRM 账号、2 个非空历史昵称均成功迁移。
   - 主档已有昵称时保留主档值。
   - 主档为空时按 `updated_at DESC`、`created_at DESC`、账号 ID 升序选择。
   - 迁移候选、选中值、规则和冲突状态写入
     `customer_nickname_migration_audit`。
   - 冲突另写入 `crm_audit_log`。
   - 重复执行迁移不会重复增加迁移审计。

3. 权限、范围和审计

   - 新增接口：
     `PATCH /api/sales-crm/customers/:externalCustomerId/nickname`。
   - 接口必须具备 `edit_customer`。
   - CRM 客户按账号 scope 校验；线索按 `manage_intake` 或本人已分配 scope 校验；
     回收客户按回收站 scope 校验。
   - 越权请求返回 `403`，不会通过搜索或稳定编号扩大数据范围。
   - 身份检查使用有效用户权限和数据范围，审计同时记录真实用户、有效用户和上下文 ID。
   - 新增 `customer_nickname_audit` 保存旧值、新值和操作身份。

4. 搜索、导出和生命周期

   - 线索池、线索流转、CRM、客户池和回收站搜索均包含共享昵称。
   - `CONTACT_SAFE_POOL_KEYS` 已允许非联系人敏感的 `nickname` 字段。
   - 导出继续将昵称、正式名称和稳定客户编号分列。
   - 客户退回、重新分配、软删除和恢复后昵称保持不变。
   - Issue #144/#146 的线索真实状态和 CRM 分配状态逻辑未被替换。

5. 前端

   - 统一 `accountDisplayName()`、`accountIdentity()` 和稳定客户 ID 解析。
   - 线索、CRM、回收站、提醒、经理评价和客户选择器使用昵称优先展示。
   - 共享抽屉每次打开先清空按钮，再按当前客户能力位重新计算。
   - 未进入 CRM 的线索可以直接打开共享昵称编辑。
   - 保存后同步当前列表、抽屉、客户页、回收站和已加载的授权业务列表。
   - 资产版本更新为 `20260730-issue147`。

6. 验证

   - Issue #147 与相关权限、迁移、回收站、Issue #144/#146 专项回归：`39/39`。
   - 发布前聚焦回归：`28/28`。
   - 全量测试：`758/758`，0 失败。
   - 所有修改的 JavaScript 文件均通过 `node --check`。
   - `git diff --check` 通过。
   - 生产数据库只读快照迁移结果：
     `58` 个账号、`2` 个历史昵称、`2` 个主档昵称、`0` 个镜像不一致、
     `2` 条幂等迁移审计、`integrity_check=ok`。

### 发布状态

当前文档生成时，代码已完成本地验证，正在进行最终只读审查。PR、合并、远端 CI 和生产
部署信息将在发布完成后更新到本节。

## 已修改文件

### 后端与数据

- `lib/access_control.js`
  - 注册共享昵称写接口权限策略。
  - 将昵称加入安全客户主档投影。
- `lib/business_page_filters.js`
  - 推进、经理评价和回收站读取/搜索主档昵称。
- `lib/customer_filters.js`
  - CRM 客户搜索使用主档昵称。
- `lib/db.js`
  - 客户池新增 `nickname`，资料响应加入昵称能力位。
- `lib/intake_flow_filters.js`
  - 授权线索列表读取和搜索主档昵称。
- `lib/sales_crm.js`
  - 主档 schema、迁移、镜像触发器、冲突与操作审计。
  - 新昵称接口、数据范围校验和能力位。
  - CRM、线索、回收、导出和研究列表的共享昵称读取。
- `server.js`
  - 旧客户池接口搜索支持昵称。

### 前端

- `sales-assets/app.js`
  - 统一客户显示标识、抽屉操作重算、共享昵称编辑和本地状态同步。
- `sales-crm.html`
  - “共享昵称”操作文案和 Issue #147 资产版本。

### 测试

- `test/issue147_shared_nickname_backend.test.js`
- `test/issue147_shared_nickname_ui.test.js`
- `test/issue116_intake_flow_filters.test.js`
- `test/issue130_profile_access_status.test.js`
- `test/issue137_recycle_backend.test.js`
- `test/issue112_tag_semantics.test.js`
- `test/issue116_research_filter_component.test.js`

### 文档

- `HANDOFF.md`

## 未完成事项

发布完成前仍需：

1. 完成最终只读代码审查并处理阻断项。
2. 提交并推送 `codex/issue-147-shared-nickname`。
3. 使用 GitHub CLI 创建包含 `Closes #147` 的 PR。
4. 等待 PR CI 全绿后合并到 `main`。
5. 等待 `main` CI 和自动部署完成。
6. 核对本地与公网 `/healthz` 的 `releaseSha` 等于本次合并提交。
7. 在生产库只读确认昵称列、迁移审计、镜像一致性和数据库完整性。
8. 用最终 PR、SHA、CI、部署时间和生产验证结果更新本文件。

## 下一步计划

1. 查看最终审查结果，必要时补测试和修复。
2. 再跑受影响专项、全量测试和静态检查。
3. 通过 GitHub CLI 提交 PR，观察检查结果。
4. CI 通过后合并并等待不可变发布完成。
5. 使用确切合并 SHA 验证本地服务、公网 Cloudflare 入口和部署状态。
6. 完成生产数据库只读验收并关闭交接中的发布待办。

## 注意事项

- `customer_pool.nickname` 是事实源；新增代码不能重新把
  `crm_accounts.nickname` 当作独立业务字段。
- `crm_accounts.nickname` 是兼容镜像，部署后不要手工删除，旧版本回滚仍需读取它。
- 迁移必须先于唯一外部客户索引恢复执行，以兼容历史重复账号的确定性冲突处理。
- 昵称清空只接受空字符串；纯空白、控制字符和超过 40 个字符会被拒绝。
- 所有昵称写入必须走共享接口或现有 CRM 更新事务并写审计。
- 身份检查不能使用真实管理员权限越过有效用户范围。
- 搜索昵称时必须保留原有账号、线索或回收站 scope。
- 昵称只用于内部显示和检索，不改变去重、AI、Recon、制裁核查或正式外部名称。
- 不要把“已推送分支”称为“已上线”；必须确认 `main` 合并、部署状态和公网
  `/healthz` 都指向同一个 SHA。
- 发布脚本在切换前会备份数据库、验证隔离运行时，并在健康检查失败时自动回滚。

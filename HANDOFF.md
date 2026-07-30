# Issue #149 开发交接

更新时间：2026-07-31

Issue：[重构“记录新进展”：客户搜索、紧凑表单与自定义客户反应](https://github.com/mewmind-chen/russia-crm-local/issues/149)

## 项目背景

TradePulse CRM 原“快速更新”入口依赖顶栏的国家、负责人和周期全局筛选，并在弹窗内
长期展示动作类型、渠道及询价扩展字段。Issue #149 将其改为独立的“记录新进展”
工作流：先按昵称、正式名称或客户编号搜索有权客户，再用十个稳定进展类型填写紧凑表单；
询价资料只在第二步出现。客户反应由真实管理员维护，历史记录保存稳定 ID 和当时文字快照。

本次同时清理顶栏隐式筛选依赖，保持现有权限范围、阶段推进和 AI 人工确认边界，并要求
手机、平板和桌面均无嵌套或横向滚动。

## 分支与工作区

- 仓库：`mewmind-chen/russia-crm-local`
- 开发分支：`codex/issue-149-progress-modal`
- 隔离 worktree：
  `/Users/ylf/Desktop/projects/tradepulse-development/worktrees/issue-149-progress-modal`
- 开发基线：`origin/main@002afd3296891e1803eb27a444ad3b60136c8a7d`
- 主工作区：`/Users/ylf/Desktop/projects/russia-crm-local`
- 发布方式：PR 合并 `main` 后由 macOS 不可变发布脚本自动部署

主工作区包含用户自己的未提交改动，不要在其中 reset、checkout 或覆盖文件。本 Issue
始终在上述隔离 worktree 中开发和发布。

## 当前进度

### 已完成

1. 顶栏与客户选择

   - 顶栏仅保留通知、新增 CRM 客户和记录新进展。
   - 删除工作区标签及国家、负责人、周期全局筛选和全部 JavaScript 隐式依赖。
   - 新接口按昵称、正式名称、外部客户编号或 CRM ID 搜索，并同时执行
     `record_activity` 权限和客户范围过滤。
   - 搜索结果昵称优先，展示正式名称、稳定客户编号和负责人；手工客户回退显示 CRM ID。
   - 顶栏、客户详情和抽屉入口统一复用同一弹窗，详情入口自动预选当前客户。

2. 紧凑进展表单

   - 固定十个进展选项：邮件、电话、WhatsApp、Telegram、LinkedIn、客户回复、
     视频会议、收到询价、商务谈判、暂停/流失。
   - 服务端固定映射 `progressType → activity_type / channel / stage`，不信任客户端伪造渠道。
   - 客户反应为可选下拉；0 个有效选项时销售端不显示，真实管理员仍保留配置入口。
   - 文本区初始两行，最多自然增长至约五行，之后只在文本区内部滚动。
   - “需要经理协助”使用稳定 18×18 原生复选框和独立说明。
   - 收到询价后进入第二步补充编号、BOM、金额、完整度和产品类别，最终只调用一次活动写接口。
   - 前端提交锁和服务端幂等键共同防止双击、超时重试导致重复活动或重复 RFQ。

3. 自定义客户反应

   - 新表 `crm_activity_reaction_options` 保存稳定 ID、名称、排序、启用状态和审计字段。
   - 默认安装六项：已完成、有兴趣、需要跟进、未接通、暂无回复、明确拒绝。
   - 真实且未处于身份检查的管理员可新增、改名、排序和软移除；每种变更写专门审计。
   - 活动同时保存 `reaction_option_id` 与 `reaction_label_snapshot`，改名或移除不会改写历史。
   - 名称拒绝空值、超长、重复、`Cc` 控制字符和 `Cf` 格式控制字符。
   - 打开配置页会保存当前客户、字段、AI 草稿和 RFQ 步骤；完成、关闭或按 Escape 都恢复草稿。

4. 数据、迁移与导出

   - 活动新增 `progress_key`、反应 ID/快照和 `stage_before`。
   - 旧 WhatsApp、Telegram、LinkedIn 活动迁移为稳定
     `whatsapp / telegram / linkedin` 键，迁移可重复执行。
   - JSON 导出升级为 schemaVersion 2，并携带活动客户编号、稳定进展和反应快照。
   - CSV 支持 `dataset=activities`，默认客户 CSV 行为保持不变。
   - CSV 对首个非空白字符为 `= + - @` 的单元格前置单引号，防止表格公式注入。
   - 生产客户快照同步仅在源表和目标表同时存在时才清空复制表；旧源库缺少新反应表时
     不会删除目标默认配置。
   - 同步替换活动数据时会清理陈旧活动幂等响应，避免重放不存在的 activityId。

5. AI 兼容

   - AI 仍只生成待人工确认草稿，不直接写业务状态。
   - 客户反应改为可选自由文本提示，不再硬编码旧六项枚举，也不再作为确认必填字段。
   - AI 反应只有与当前配置精确匹配时才选择；未匹配时清空并提示人工选择。
   - 不支持的活动类型/渠道不再静默回退到邮件或 WhatsApp，而是清空必填进展并提示重新选择。
   - 手工客户没有稳定外部编号时隐藏 AI 入口，并在调用层再次拒绝。
   - AI proposal 重试优先重放首次结果，不依赖后来已改名或移除的反应，并返回原始阶段变化。

6. 权限与事务

   - 搜索、反应读取和活动写入均要求 `record_activity`。
   - 客户搜索和直接写入共享相同 account scope，越权客户不会泄露或落库。
   - 反应管理只允许真实管理员，身份检查期间由路由策略统一阻止。
   - 活动、客户阶段/下次行动、RFQ、proposal 确认和幂等完成标记在同一立即事务中。
   - 任一步失败时整体回滚；严格布尔校验经理协助字段。
   - 新增反应快照别名已加入联系人敏感字段脱敏，避免低权限导出泄露。

7. 验证

   - 最终全量测试：`793/793`，0 失败。
   - Issue #149 与 AI、同步专项：`39/39`；独立综合审查相关回归：`55/55`。
   - `lib/sales_crm.js`、`lib/access_control.js`、`sales-assets/app.js`、
     `scripts/sync-production-customer-data.js`、AI action proposal 与 prompt 文件均通过
     `node --check`。
   - `git diff --check` 通过。
   - 浏览器实测 `375×812`、`768×1024`、`1024×768`、`1440×900`、
     `1920×1080`：弹窗完全位于视口内，文档、弹窗、表单均无横向溢出。
   - 浏览器确认复选框始终 18×18，七行文本高度约 120px 且 `overflow-y:auto`。
   - 浏览器确认客户搜索、配置页草稿恢复和 RFQ 第二步；临时数据库只新增
     1 条活动、1 条 RFQ 和 1 条幂等记录，控制台无错误。
   - 多代理独立综合审查最终结论：无阻塞问题。

### 发布状态

- 功能代码、本交接文档和测试已在隔离 worktree 完成。
- 当前尚未提交、创建 PR、合并或部署；下一步按本文件“下一步计划”执行。
- 部署完成后需在本节补充功能提交、PR、合并 SHA、CI、不可变 release、回滚点、
  本机/公网健康检查和 Issue 关闭证据。

## 已修改文件

- `lib/access_control.js`
  - 新反应配置路由权限和身份检查阻断策略。
- `lib/sales_crm.js`
  - 搜索、稳定进展映射、反应配置/审计/迁移、活动事务/幂等、导出和脱敏。
- `lib/ai_stations/action_proposal.js`
- `lib/ai_stations/prompts/v1.js`
- `lib/ai_stations/schemas/action_proposal.v1.json`
  - 自定义反应可选契约及稳定进展兼容。
- `sales-crm.html`
  - 精简顶栏、统一文案和 Issue #149 资产版本。
- `sales-assets/app.js`
  - 搜索选择器、紧凑表单、RFQ 第二步、反应管理、草稿恢复、AI 兼容和提交锁。
- `sales-assets/app.css`
  - 弹窗、选择器、反应管理、复选框、文本区和五档响应式约束。
- `scripts/sync-production-customer-data.js`
  - 新反应配置复制、旧源缺表保护和陈旧幂等清理。
- `test/issue149_progress_backend.test.js`
- `test/issue149_reaction_options.test.js`
- `test/issue149_progress_ui.test.js`
  - Issue #149 后端、配置、幂等、迁移、安全和 UI 专项测试。
- `test/ai_action_proposal.test.js`
- `test/development_customer_sync.test.js`
  - AI 可选反应、重试与生产同步边界回归。
- `test/a3_06_sales_execution_gate.test.js`
- `test/access_control.test.js`
- `test/ai_next_action.test.js`
- `test/customer_nickname.test.js`
- `test/issue62_ux.test.js`
- `test/sales_access_ui.test.js`
  - 既有行为适配新的进展请求与界面契约。
- `test/issue112_tag_semantics.test.js`
- `test/issue116_research_filter_component.test.js`
- `test/issue147_shared_nickname_ui.test.js`
  - 更新共享 CRM 资产缓存版本断言。
- `HANDOFF.md`
  - 本交接文档。

## 未完成事项

- 必做事项仅剩 GitHub 发布、CI、合并、自动部署和生产验收。
- 上线后需把最终发布证据回填到 `HANDOFF.md`；建议使用独立文档 PR，避免改变首次功能
  release 的代码证据。
- 未发现需要继续开发的 Issue #149 功能缺口。

## 下一步计划

1. 审查最终 diff，提交 `codex/issue-149-progress-modal` 并推送。
2. 用 GitHub CLI 创建包含 `Closes #149` 的 ready PR。
3. 等待 PR CI 全部通过后合并，确认 Issue #149 自动关闭。
4. 等待 `main` CI 和自动部署完成，记录合并 SHA、release 与回滚点。
5. 验证本机和公网 `/healthz`、首页 HTTP 200、Issue #149 CSS/JS 缓存版本。
6. 用独立文档 PR 回填最终发布证据，再次确认文档合并后的部署健康。

## 注意事项

- 不要修改或重置主工作区中的用户改动。
- 生产部署只接受 `main`，不要直接修改生产目录或手工替换 `current`。
- 不要恢复已删除的顶栏全局筛选或用其隐式限制记录新进展。
- `progressType` 是公开稳定键；客户端不能自行控制其 activity type、channel 或阶段映射。
- 反应 option ID 是配置身份，snapshot 是历史显示文字；改名和软移除不能改写旧活动。
- 反应管理必须保持真实管理员限制，并在身份检查期间阻止写入。
- activity、阶段、RFQ、proposal 确认和幂等结果必须继续处于同一事务。
- 普通活动前端必须继续发送随机 `idempotencyKey`；AI 活动以 proposal job 作为重试键。
- 生产快照同步不能在旧源缺表时清空目标新表，替换活动时必须清理陈旧幂等响应。
- CSV 导出新增自由文本字段时必须继续经过 `csvCell` 公式中和。
- AI 无法映射当前配置时应要求人工选择，不得静默回退到另一个进展类型或反应。

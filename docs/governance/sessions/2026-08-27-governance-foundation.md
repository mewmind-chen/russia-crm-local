# Session: 建立项目治理基础

日期：2026-08-27

## 目标

在开始任何业务重构前，建立 TradePulse 的长期项目宪章、仓库地图、当前状态、领域初始地图、工作协议和风险登记，确保后续工作可恢复、可追溯、可验证。

## 基线

- 仓库：`/Users/ylf/Desktop/projects/tradepulse-development/repo`
- 当前权威基线：`origin/main`，已执行 `git fetch origin --prune`
- 当前 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 当前 checkout：`codex/issue-145-lead-status`
- 当前 checkout 工作区：干净
- 当前 checkout upstream：已删除，不作为重构分支
- 重构业务代码：尚未修改

## 已读取和核对

- `README.md`
- `HANDOFF.md`
- `docs/development.md`
- `docs/planning/README.md`
- `package.json`
- `.gitignore`
- `lib/db.js`
- 路由和模块导出清单
- git history、远端 main、worktree 和 runtime 布局

## 已完成

- 创建 `docs/governance/`。
- 创建 `PROJECT_CHARTER.md`。
- 创建 `REPOSITORY_MAP.md`。
- 创建 `CURRENT_STATE.md`。
- 创建 `DOMAIN_MAP.md`。
- 创建 `DATA_MODEL.md`。
- 创建 `STATE_MACHINES.md`。
- 创建 `PERMISSION_MODEL.md`。
- 创建 `API_CONTRACTS.md`。
- 创建 `REQUIREMENTS_INDEX.md`。
- 创建 `DECISION_LOG.md`。
- 创建 `WORK_PROTOCOL.md`。
- 创建 `RISK_REGISTER.md`。
- 创建本 session checkpoint。

## 关键事实

- 项目是 Node.js/Express/better-sqlite3 单体，前端为原生 HTML/JS/CSS。
- 旧数据库模型、统一 CRM 模型和 AI Station schema 分散在多个模块。
- `lib/db.js` 约 3028 行，`lib/sales_crm.js` 约 5872 行。
- 主线包含 CRM、线索、联系人、Recon、AI、权限、数据治理和部署能力。
- `test/` 当前约 125 个测试文件，`scripts/` 当前约 62 个脚本文件。

## 未完成

- 完整 schema/字段级数据字典和 ER 图
- 状态写入点、状态真源和完整状态机
- 权限矩阵和敏感字段清单
- API 完整契约
- 需求/Issue/测试之间的索引和冲突清单
- 目标架构和重构路线

## 安全边界

本 session 未修改业务代码、数据库、生产配置、部署配置或历史 worktree。治理文档写入当前 repo 工作区，尚未提交。

## 第二轮取证结果

- 确认 `crm_accounts.stage`、`assignment_status`、`lifecycle_status`、`recycle_kind`、`manager_status` 和计划字段是不同维度。
- 确认阶段通过 `ACTIVITY_STAGE` 和 `advanceStage` 由活动推进，报价和订单还有独立的直接写入路径。
- 确认线索拒绝会将账户阶段写为 `lost`，重新分配时可能将 `lost` 恢复为 `qualified`。
- 确认普通列表主要从 `crm_accounts` 读取当前投影，并以 `customer_pool` 补充主档；统计同时使用账户、活动、RFQ、报价和订单。
- 将阶段写入路径、当前投影关系和状态风险写入 `STATE_MACHINES.md`、`DATA_MODEL.md`。

## 第六轮取证结果（范围裁定）

- 用户明确：重构**不包括 AI 内容**；现有系统通过开关控制 AI 显示（`feature_flags.js`：`CRM_AI_STATIONS_ENABLED` 等 + capabilities `features.aiStations`），AI 原样保留。
- 用户明确：客户完整资料界面**不是一个底层**；核实 `sales-crm.html#customerProfileView` 通过 `<iframe id="customerProfileFrame">` 加载 `/development-workbench?profile=1`（旧版 `Index.html`，`body.profile-mode` 隐藏导航），并在 iframe 内叠加 `profile-contacts.js`（联系人管理）和 `profile-insights.js`（洞察/评价）两个独立切片；另有轻量抽屉 `#customerDrawer` 与 `CRM_ENABLE_LEGACY` 控制的 `/legacy`、`/tradelead-v2.html`。目标为统一单一客户完整资料视图层。
- 已更新：`TARGET_ARCHITECTURE.md`（原则 8/9、痛点、领域表、8.1 节、非目标）、`REFACTOR_ROADMAP.md`（原则 6/7、阶段 E 客户完整资料视图统一、阶段 F AI 保持原样、阶段 G 兼容层）、`DECISION_LOG.md`（D-005/D-006、修正编号）、`REQUIREMENTS_INDEX.md`（REQ-011 标注不纳入重构、新增 REQ-015）、`DOMAIN_MAP.md`（AI 标注、新增资料视图领域）、`RISK_REGISTER.md`（R-011/R-012）、`CURRENT_STATE.md`（范围裁定）。

## 第五轮取证结果

- 已确认领域地图中的所有领域边界可以归并为 12 个核心包：identity、customer、activity、commerce、intake、assignment、lifecycle/recycle、planning、contact、recon、ai、filter/delivery。
- 已创建 `TARGET_ARCHITECTURE.md` 和 `REFACTOR_ROADMAP.md`，分别用于目标分层和分阶段绞杀顺序。
- 项目宪章已补充最新 main 优先级规则，风险表已更新状态/fixture 风险确认。
- 需求索引已保持“最新 main 优先、planning 仅历史背景”的声明，不再把 07-25 的 R5-01 误当当前起点。

## 第八轮取证结果（用户澄清：字段内容也要自由显示）

- 用户澄清：不止 UI 结构，还有各种字段内容（线索池、客户资料等）的字段也要能自由显示。
  - 已核对现状：`lib/filter_catalog.js` 已有字段级定义范式（`key/label/type/displayMode/sortOrder/sensitive/requiredPermissions/pages`），服务端已按权限生成筛选 schema（`authorizedFilterSchema`）；`lib/access_control.js` 有 `CONTACT_KEYS` 黑名单 + `CONTACT_SAFE_POOL_KEYS`/`CONTACT_SAFE_RECON_KEYS` 白名单；前端列表/详情字段渲染仍硬编码在 `app.js`。
  - 已定方向：**字段目录（FIELDS_CATALOG） + 有效字段 schema**：每个字段声明 `key/label/section/sortOrder/kind(列|详情|编辑)/visibility(roles|permissions|features)/editable/sensitive`，服务端按 角色+权限+开关 计算 per-page/per-user 的有效字段 schema（含版本），Widget 按 schema 渲染，前端不再硬编码字段名；未授权字段不下发数据（白名单投影替换 `CONTACT_KEYS` 黑名单）；字段 schema 与筛选 schema 同源。
  - 已更新 `TARGET_ARCHITECTURE.md 7.5`、`REFACTOR_ROADMAP.md 阶段C`、`DECISION_LOG.md D-008`、`REQUIREMENTS_INDEX.md REQ-017`、`CURRENT_STATE.md`。

## 第八轮取证结果（字段目录落地）

- 用户进一步明确：不止 UI 结构，线索池、客户资料等页面的字段内容也要能自由显示。
- 已核实真实数据结构：
  - 线索池：`queryIntakeFlowPage`（`crm_intake_items` + `assigned_owner_name/suggested_owner_name`），前端 `renderIntake()` 硬编码列（约 1762-1860 行）。
  - 客户资料：`getCustomerProfileData` -> `customerPool[0]`（`buildPoolCustomer`，约 37 字段分四段）+ `customers`（历史）+ `reconResults` + `people` + `profileAccess`；旧版 `Index.html` 内嵌脚本 `renderPoolDetails()` 等硬编码四段。
  - 客户列表：`listCustomerAccounts`（`crm_accounts` + `customer_pool` 合并 + owner/creator + customerTags）。
  - 权限门控基础：`view_contacts`（联系方式/联系人等级）、`view_recon`（报告/来源）、`view_all_customers`（创建人）、标签类别授权、`features.ai_stations`（AI 字段组）。
- 已创建 `FIELD_CATALOG.md`：字段定义 schema、可见性解析规则、线索池/客户资料/客户列表三页字段目录（字段名与最新代码核对）、`/field-schema/:pageKey` API 草案、`FIELD_SCHEMA_VERSION_CONFLICT`、白名单投影替换 `CONTACT_KEYS` 的过渡方案、试点顺序（线索池 -> 客户资料 -> 客户列表）。
- 已同步更新 `REFACTOR_ROADMAP.md` 阶段 C、`REQUIREMENTS_INDEX.md REQ-017`、`CURRENT_STATE.md`。

## 第七轮取证结果（用户澄清：AI 零动作 + 前端 widget 化）

- 用户澄清：AI 部分不能删除，也不希望大任务量；此前“原样搬运”的说法需要修正。
  - 已更正：本次重构对 AI **零动作**（不删除、不迁移、不搬运）；`sales_crm.js` 中既有 AI 触发点留在原位置，重构不对其做任何移动。
  - 前端将 AI 区域登记为 widget，由现有开关（`[data-ai-business]` + `applyBusinessAIVisibility` + capabilities `features.aiStations`）决定显示，AI 内部代码零改动。
  - 已更新 `TARGET_ARCHITECTURE.md 0.1/8`、`REFACTOR_ROADMAP.md 原则6/阶段F`、`DECISION_LOG.md D-005`、`REQUIREMENTS_INDEX.md`、`PLANNING_SUPPLEMENT.md`、`CURRENT_STATE.md`。
- 用户澄清：之前很多前端显示/交互 issue 不好改，希望重构后方便修改和构建，能够模块化、自由搭建、自由选择显示内容。
  - 已核对前端现状：`sales-assets/app.js` 约 1.4 万行承担统一壳几乎所有渲染逻辑；已有 `filter-component.js` 独立 UMD 组件范式；已有 `[data-permission]` / `[data-ai-business]` 显隐机制；bootstrap 下发 `permissions + features`。
  - 已定方向：**Widget 注册表 + 页面配置化组装**；客户完整资料收敛为统一壳内的 widget 集合（身份、业务画像、联系人、洞察/评价、时间线、商务、下一步、回收状态、AI 区域），抽屉与完整资料共用同一集合；后续前端 issue 只改对应 widget 或注册表配置。
  - 已更新 `TARGET_ARCHITECTURE.md 0.2/8.1`、`REFACTOR_ROADMAP.md 原则7/阶段E/阶段G`、`DECISION_LOG.md D-007`、`REQUIREMENTS_INDEX.md REQ-015/REQ-016`。

## 第六轮取证结果（用户范围确认）

- 用户明确：重构不包含 AI 内容；现有系统 AI 由开关控制显示。
  - 已核对 `lib/ai_stations/feature_flags.js`：`ai_stations/customer_enrichment/customer_enrichment_auto_trigger/sales_pack/qwen_online/qwen_batch` 六组开关，由 `CRM_AI_*` 环境变量 + `crm_ai_feature_flags` 运行时开关 + capabilities `features.aiStations` 控制。
  - 已更新 `TARGET_ARCHITECTURE.md 0.1/8`、`REFACTOR_ROADMAP.md 原则6/阶段F`、`REQUIREMENTS_INDEX.md REQ-011`、`DECISION_LOG.md D-005`：AI 不纳入重构，触碰触发点只原样搬运。
- 用户明确：之前的版本存在两种界面组合，客户完整资料那个界面不是一个底层，需要重构处理。
  - 已核对代码：`sales-crm.html#customerProfileView` 用 `<iframe id="customerProfileFrame">` 加载 `/development-workbench?embedded=1&profile=1&assistant=0&prospect=0&customer=…[&intake=…]`；`server.js` 中该路由 `res.sendFile(Index.html)`；旧版 `Index.html` 同一页面同时承担“旧工作台”与“被嵌入的客户完整资料”两种用途（`profile-mode/embedded-mode/no-assistant/no-prospect` body class）。
  - 资料数据源为 `/api/sales-crm/profile/:customerId` 与 `/api/sales-crm/intake/:itemId/profile`（均走 `getCustomerProfileData`）。
  - 已更新 `TARGET_ARCHITECTURE.md 0.2/8.1`、`REFACTOR_ROADMAP.md 原则7/阶段E`、`REQUIREMENTS_INDEX.md REQ-015`、`DOMAIN_MAP.md`、`API_CONTRACTS.md`、`DECISION_LOG.md D-006`。
  - 确认 `profile-contacts.js`/`profile-insights.js` 存在于 origin/main 根目录，由 `Index.html` 在 profile 模式下加载；`CRM_ENABLE_LEGACY` 为 `server.js:73-78` 的真实环境变量（控制 `/legacy`、`/tradelead-v2.html`）

## 第四轮取证结果

- 已确认最新权威基线：`origin/main@57c4c42`，执行 `git fetch origin --prune` 验证主线与规划状态一致。
- 发现 `docs/planning` 两份文档冻结于 2026-07-25，当前 35/38、下一项等结论已滞后最新代码约 300+ 提交。
- 归并完成 2026-07-25 后主线增量主题：前端重构回滚后转入 V3 studio/deck 与筛选联动、客户域持续加固、筛选/权限演进、线索分配、任务推进、部署与基础设施。
- 明确前端 `90/91` 模块化重构发布已被撤回，不能视为现有能力。
- 已创建 `PLANNING_SUPPLEMENT.md` 作为规划与最新 main 的桥梁，后续重构以该补充和最新主线为准。
- 已更新 `CURRENT_STATE.md`、`REQUIREMENTS_INDEX.md`、`DECISION_LOG.md`。

## 第三轮取证结果

- 确认角色为 `admin`、`manager`、`sales`，最终权限来自角色权限组和用户级 allow/deny 覆盖。
- 确认页面访问权限、功能权限、客户资源范围和字段脱敏是分层控制。
- 确认筛选配置拥有独立定义、组授权、用户额外授权、版本号和审计记录。
- 确认普通销售按负责人范围访问客户，管理者/管理员的全量范围还受 `manage_intake` 等权限影响。
- 确认联系人、Recon、内部评价和下一步计划通过字段过滤进行脱敏；该黑名单机制是重构时的风险点。
- 权限路由还受到 admin-only、real-admin-only 和身份查看期间禁止操作等策略限制。
- 已更新 `PERMISSION_MODEL.md`、`CURRENT_STATE.md`。

## 下一步最小动作

继续只读整理需求、规划文档、最新主线提交和测试之间的对应关系，形成需求索引和冲突清单；之后再制定目标架构和第一阶段重构路线。完成前不开始业务重构。

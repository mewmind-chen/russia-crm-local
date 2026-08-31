# TradePulse 决策记录

更新时间：2026-08-29

## D-001：先做理解基础，不直接重构业务

- 日期：2026-08-27
- 决策：当前进入阶段 0，只读盘点和治理文档先行。
- 原因：现有系统包含旧模型、统一 CRM、AI、Worker 和大量历史兼容逻辑；直接改代码有较高跑偏和数据风险。
- 影响：暂不修具体 Bug、改 schema、迁移数据或拆分核心模块。
- 解除条件：现状架构、数据模型、状态机、权限、API 和需求冲突清单完成后，明确批准目标架构和第一条重构切片。

## D-002：所有后续工作以最新 `origin/main` 为基线

- 日期：2026-08-27
- 决策：现状分析、设计和后续重构均以执行 `git fetch origin --prune` 后确认的最新 `origin/main` 为唯一代码基线。
- 当前基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 原因：当前 repo checkout 是旧分支且 upstream 已删除；不能把旧 checkout 或历史 worktree 当作最新实现。
- 影响：后续新任务须从该基线建立隔离 worktree；已有治理文档中的历史 checkout 只作为调查记录。

## D-003：重构使用隔离 worktree 和 runtime

- 日期：2026-08-27
- 决策：重构代码必须基于明确的最新主线，在独立 worktree 和独立 runtime 中执行。
- 原因：当前 repo checkout 是旧分支且 upstream 已删除，目录中还有大量历史 worktree/runtime。
- 影响：不能直接在当前旧分支作为重构工作区操作，也不能复用生产数据库。

## D-004：2026-07-25 旧规划冻结，不参与当前判断

- 日期：2026-08-27
- 决策：07-25 冻结的两份旧计划移入 `docs/archive/planning-2026-07-25/`，只作为历史背景；它们不得用于当前进度、代码/生产基线或下一步判断。最新 main 已包含后续 CRM、权限、客户生命周期、分配和 UI 增量，后续任务不得按旧“下一项”直接执行。
- 依据：最新 `origin/main@57c4c42` 的提交历史和当前代码。
- 影响：当前判断只使用实时远端 `main`、生产 `current`/release state、`after/` Git/代码/测试和 `docs/governance/`；先完成规划补充和最新主线需求索引，再制定当前目标架构与重构路线。

## D-005：AI 内容完全不触碰（零动作）

- 日期：2026-08-27
- 决策：`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 环境开关与 `ai_stations` 运行时开关不在本次领域重构范围内，保持原样；**不删除、不迁移、不搬运**，`sales_crm.js` 中既有 AI 触发点留在原位置，本次重构对 AI 的总工作量 = 0。
- 依据：用户明确要求（AI 不删除、不迁移，避免大任务量）；现有 `feature_flags.js` 开关语义；前端已有 `[data-ai-business]` + `applyBusinessAIVisibility` + capabilities `features.aiStations` 控制显示。
- 影响：重构路线移除一切 AI 相关阶段；前端把 AI 区域登记为 widget，由现有开关决定显示，AI 内部代码零改动。

## D-006：客户完整资料界面必须统一为单一底层

- 日期：2026-08-27
- 决策：客户完整资料不再是“新壳 iframe + 旧版 `Index.html` 双用途页面”组合；本次重构须将其收敛为统一壳 `sales-crm.html` 的第一方视图。
- 依据：用户明确要求；`sales-crm.html #customerProfileView` 通过 iframe 加载 `/development-workbench`（返回旧版 `Index.html`），旧版同一页面承担工作台与资料页两种用途。
- 影响：前端重构阶段 E 落地；旧版工作台/资料页双用途解除，旧入口收敛为兼容；`view_customers`/`view_intake` 权限与联系人/洞察脱敏语义保持不变。

## D-007：前端采用 widget 注册表 + 配置化组合架构

- 日期：2026-08-27
- 决策：前端统一壳改为 **Widget 注册表 + 页面配置化组装**：每个 widget 自包含模板/状态/事件，页面 = 按权限和开关（复用 `data-permission` / `data-ai-business` / bootstrap features）自由选择显示内容的配置组合，后续前端 issue 只需改对应 widget 或注册表配置。
- 依据：用户反馈“之前很多前端显示交互 issue 不好改，希望重构后方便修改和构建、自由搭建、自由选择显示内容”；系统已有 `sales-assets/filter-component.js` 独立组件范式和 `data-permission`/`data-ai-business` 显隐机制。
- 影响：客户完整资料由同一 widget 集合在统一壳内组装；抽屉与完整资料共用同一集合；`app.js` 不再需要整体改动即可调整页面显示。

## D-008：字段级自由显示采用字段目录 + 有效字段 schema

- 日期：2026-08-27
- 决策：不止 UI 结构，**字段内容**（线索池、客户资料、客户列表、回收站、联系人、Recon 等页面的字段）也要能自由显示/隐藏。方案是新建 **字段目录（FIELDS_CATALOG）**：每个字段声明 `key/label/section/sortOrder/kind/visibility(roles|permissions|features)/editable/sensitive`，服务端按 角色+权限+开关 计算有效字段 schema（per-page、per-user、含版本），Widget 按 schema 渲染，前端不再硬编码字段名。
- 依据：用户明确要求；系统已有 `filter_catalog.js` 字段级定义范式和 `CONTACT_KEYS`/`CONTACT_SAFE_*_KEYS` 脱敏基础；前端字段渲染目前硬编码在 `app.js`。
- 影响：字段显隐改配置不改代码；替换 `CONTACT_KEYS` 黑名单为字段级白名单投影（未授权字段不下发数据）；字段 schema 与筛选 schema 同源，避免两套口径。

## D-009：治理文档作为长期外部记忆

- 日期：2026-08-27
- 决策：项目宪章、当前状态、领域地图、数据模型、状态机、权限、API、风险和 session checkpoint 保存到 `docs/governance/`。
- 原因：长期项目不能依赖聊天上下文或模型记忆恢复。
- 影响：每次重要任务结束都必须更新当前状态和 session。

## D-010：重构工作区迁移到独立根目录

- 日期：2026-08-29
- 决策：当前重构统一使用 `/Users/ylf/Desktop/projects/tradepulse-refactor`，采用 `repo/`、`before/`、`after/` 三目录表达中心 clone、重构前基线和重构后开发分支。
- 依据：用户明确要求不再使用 `tradepulse-development`，并要求把重构前后的完整内容迁入一个新根目录。
- 影响：`after/` 成为唯一开发和治理入口；旧 `tradepulse-development` 只读保留，不再同步维护；生产目录不复制、不修改。
- 验证：`repo/` 与 `before/` 均为 `57c4c42`，`after/` 为 `76b7b56`；迁移前后 5 个未提交业务文件的二进制 patch SHA-256 一致；53 个原治理文件逐文件一致后再在新目录校准。

## D-011：红灯工作区先恢复，不继续叠加拆分

- 日期：2026-08-29
- 决策：当前 5 个未提交业务文件造成全量 12 项失败；在 WIP 意图确认并恢复全量测试前，暂停新的单体拆分、widget 扩展和跨域接线。
- 原因：继续叠加会混淆 62 个已提交切片与当前 WIP 的责任边界，增加权限、状态和白名单回归风险。
- 影响：下一任务只围绕现有 WIP 和失败测试；绿灯后再审计接线状态并选择下一最小切片。

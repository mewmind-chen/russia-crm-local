# Session: 阶段 C 字段目录试点（线索池 + 客户抽屉字段自由显示）

日期：2026-08-28

## 目标

落地 `FIELD_CATALOG.md` 设计的字段级自由显示能力：服务端按 角色+权限+AI 开关 计算有效字段 schema，前端 widget 按 schema 渲染，线索池/客户抽屉字段显隐改配置不改代码。同时为 3201 服务接入线索池 demo 数据，便于预览。

## 基线

- 隔离 worktree：`worktrees/frontend-widget-pilot`，分支 `codex/frontend-widget-pilot`
- worktree 基线 commit：`57c4c42`（= origin/main@57c4c42，相差 0 提交）
- 隔离 runtime：`runtime/frontend-widget-pilot`，端口 3201
- 服务启动参数：`CRM_SEED_DEMO_DATA=true node server.js`
- 数据库：`runtime/frontend-widget-pilot/data/crm.db`（仅此库被操作）

## 已确认事实

- 登录接口为 `POST /api/sales-auth/login`（不是 `/api/sales-crm/login`，之前用错导致 401）
- admin@crm.local / ChangeMe123! 密码哈希与库中一致，登录成功
- 该实例 `ai_stations` 开关关闭 → AI fit 字段全部隐藏，符合预期
- crm_drawer 字段目录 9 项，intake 字段目录 21 项，lead_flow 为 intake 别名
- sales 默认权限组 `PGRP-SALES-DEFAULT` 含 `view_contacts: true`，所以销售在 intake 也能看到 contact 字段（符合现状权限，非 bug）

## 本轮完成的实现

| 文件 | 变更 |
|---|---|
| `lib/field_catalog.js`（新增） | 字段目录定义与可见性解析（roles&&permissions&&features） |
| `lib/sales_crm.js` | 接入字段目录；新增 `GET /field-schema/:pageKey`；销售 disclaimer 门控 |
| `lib/access_control.js` | 路由政策补 `GET field-schema` |
| `sales-assets/field-widget.js`（新增） | UMD 组件 `TradePulseFieldWidget`：renderFieldSchema / intakeColumnKeys |
| `sales-assets/app.js` | preloadFieldSchemas() 预载；renderDrawer() 按 schema 渲染事实区 |
| `sales-crm.html` | 引入 field-widget 脚本 |
| `scripts/seed-demo-intake.js`（新增） | 线索池演示数据（16 线索 + customer_pool 主档 + 联系人） |
| `test/field_catalog.test.js`（新增） | 12 测试：可见性解析/列映射/角色门控/AI 回退/一致性 |

## 已验证结果

- `node --test test/field_catalog.test.js`：12/12 pass
- 全量回归（`npm test` 核心套件）：1704/1704 pass（含 12 个新字段目录测试）
- 字段门控实测（curl，3201）：
  - admin crm_drawer：9 字段（含"客户来源"，因有 view_all_customers）
  - anna crm_drawer：8 字段（无"客户来源"，销售不可见）
  - intake 列表：total=10，rows 含 company_name/status/contact_name/match_score
- 浏览器（admin）：登录 → CRM客户全景列表 → 打开客户抽屉，事实区按 schema 渲染，字段顺序与 sortOrder 一致（负责人→…→联系人质量）
- 浏览器（anna）：数据范围收窄（CRM客户 5），抽屉按销售权限门控

## 重要注意事项（本会话踩过的坑）

- **登录端点**必须是 `/api/sales-auth/login`
- **intake 列表接口**响应字段是 `rows` 不是 `items`（用错 key 导致误判为 0 条）
- **worktree 与 repo 文档路径分离**：业务代码只改 `worktrees/frontend-widget-pilot/`，治理文档只写 `repo/docs/governance/`
- **4001 复盘工具**：曾把"另一个服务 4001 无 field-schema 路由"误当成 bug，实际那是不同 worktree/runtime，不是本切片范围
- 之前修正文档时的判断错误：`profile-contacts.js`/`profile-insights.js` 确实存在于 origin/main 根目录，被 Index.html 在 profile 模式下加载——已在早期修正

## 未完成事项

- 客户完整资料 iframe 拆分为 widget 组合视图（字段 schema 已就绪，待做）
- 用户级字段显示偏好（个人配置）未做
- 下一层：把 `field_catalog.js` 与 `intakeColumnKeys` 加版本/字段增删时的回归断言（当前一致性测试只覆盖固定目录，未覆盖字段目录动态变更）

## 已验证（本轮追加）

- **renderIntake 已接 schema 驱动列裁剪**：`app.js:2958` `schemaColumns = fieldWidget.intakeColumnKeys(intakeSchema)`，`app.js:2973` 按 schemaColumns 过滤列，schema 缺失时回退旧硬编码列（修正了此前 checkpoint 中"未接"的过时判断）
- **preloadFieldSchemas 默认预载三个页面**：`['crm_drawer','intake','lead_flow']`，并有 requestAnimationFrame 竞态保护（epoch 放弃旧轮延迟重绘）
- **intakeColumnKeys 列矩阵实测**（node 直接验证）：
  - admin（有 view_contacts，AI 关）→ `[company, contact, owner, status]`
  - 无 view_contacts 销售 → `[company, owner, status]`（**contact 列消失**，权限门控生效）
  - AI 开关开 → `[company, fit, contact, owner, status]`（**fit 列出现**，AI 开关生效）
- 结论：线索池字段自由显示链路已全闭环——服务端 schema → 前端预载 → intakeColumnKeys 列裁剪 → 回退兼容，列显隐改 `field_catalog.js` 配置即可，无需改 `app.js` 硬编码

## 本会话续接确认（2026-08-28）

- 代码已提交：`7a26074 feat(field-catalog): 字段目录试点`，提交 stat 10 文件 / +731 / -22，全量 1353/1353 pass
- 追加内容已合入同一提交：intake 目录补充 `fit_score/fit_grade/readiness/priority`（AI 开关门控，关闭时回退 `match_score/match_group`）、`lead_flow` 别名解析（`field_catalog.js:130`）；对应测试同步合入，`test/field_catalog.test.js` 12/12 pass
- 3201 服务已重启并运行在 `7a26074` 上（`CRM_SEED_DEMO_DATA=true`），admin 登录后 `/field-schema/intake` 返回 21 个可见字段（AI 关）、`/lists/intake` total=10
- 登录账号（实测）：`admin@crm.local / ChangeMe123!`（系统管理员）、`manager@crm.local / Manager123!`（林总）、`anna/ivan/mia/leo@crm.local / Sales123!`（销售）
- 浏览器可验证：线索池列表列裁剪（contact 列随 `view_contacts`、fit 列随 AI 开关）、客户抽屉事实区按 schema 顺序渲染
- 注意：本切片期间有并行会话共同推进，worktree 内代码以最新提交为准；治理文档只写 `repo/docs/governance/`

## 下一步最小动作

1. 提交当前切片（8 文件 + 测试），在 worktree 打 tag，然后做客户完整资料 widget 组合视图
2. 或先补字段目录动态变更的回归断言（改 field_catalog.js 时 lint/test 防漏）
3. 或先做用户级字段显示偏好（个人配置）

## 里程碑

- **commit** `7a26074` `feat(field-catalog): 字段目录试点 — schema 驱动的字段/列自由显隐`
- **tag** `pilot/field-catalog-v1`（可回滚里程碑）
- 分支：`codex/frontend-widget-pilot`（worktree `worktrees/frontend-widget-pilot`，基于 origin/main@57c4c42）
- 未 push（长期重构项目，按协议隔离开发，不主动 push）
- 3201 服务已用最新代码重启（`CRM_SEED_DEMO_DATA=true`），验证：field-schema 9 字段、intake 10 条

## 提交内容（10 文件，+731/-22）

新增：`lib/field_catalog.js`、`sales-assets/field-widget.js`、`scripts/seed-demo-intake.js`、`test/field_catalog.test.js`
修改：`lib/sales_crm.js`（field-schema 路由 + seedDemoIntake）、`lib/access_control.js`（路由政策）、`sales-assets/app.js`（schema 驱动渲染）、`sales-crm.html`（引入 widget 脚本）
测试更新：`test/issue100_ai_visibility_ui.test.js`、`test/issue103_frontend.test.js`（AI 门控源码断言从硬编码数组字面量更新为 schema 驱动结构，行为契约不变，等价性由 field_catalog.test.js 覆盖）

## 提交前修复的回归

1. **issue286（3 个）**：`fieldSchemaRenderEpoch` 重复声明 —— preload 块原先插在 `drawerFactMarkup` 与 `productChipMarkup` 之间，被 issue286 的重叠 functionSource 切片重复包含；已把 preload 块移到 `state` 定义之后（255 行与 viewMeta 之间），不在任何测试切片范围内
2. **issue100/issue103**：源码正则断言 `const intakeHeaders = [...]` + `...(showAI ? [...])` 匹配不到新 schema 驱动实现；已更新断言为匹配 `intakeColumns` 数组 + `.filter()` 的新结构，保留 showAI/showAssignmentAI 门控语义断言
3. **seedDemoIntake 数据歧义**：`city` 值无对应表列（crm_intake_items 无 city 列），已从演示数据移除并加注释，避免误导

## 全量回归

- `npm test`：**1353/1353 pass，0 fail**（含 12 个字段目录测试）
- `git diff --check`：clean
- 语法检查（5 个文件）：全部通过

## 恢复指令

从 `worktrees/frontend-widget-pilot` 恢复（分支 `codex/frontend-widget-pilot`，HEAD=`7a26074`，tag=`pilot/field-catalog-v1`）。先跑 `node --test test/field_catalog.test.js` 确认 12/12，再读取 `lib/field_catalog.js` 与 `sales-assets/field-widget.js`。演示数据脚本 `scripts/seed-demo-intake.js` 幂等可重跑（跑完重启 3201 生效）。3201 服务已加载最新代码，可直接登录预览。

## 风险

- field-schema 接口是新增契约，未纳入过滤版本号体系（FILTER_VERSION_CONFLICT 那套），若日后字段目录改动需评估是否加版本冲突码 FIELD_SCHEMA_VERSION_CONFLICT
- demo 数据脚本只针对隔离 runtime，误对生产库运行时可能写入脏数据——脚本内已限定 db.createDataConnection()
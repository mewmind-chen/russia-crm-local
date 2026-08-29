# TradePulse 当前状态

更新时间：2026-08-29
最近核验：2026-08-29，Asia/Shanghai

> 本文档是重构进度的滚动真源。远端基线以 `git fetch origin --prune` 后的 `origin/main` 为准；重构实现状态以 `after/` 的 Git、工作区和测试结果为准。

## 1. 当前工作区

| 角色 | 绝对路径 | Git 状态 | 用途 |
|---|---|---|---|
| 中心 clone | `/Users/ylf/Desktop/projects/tradepulse-refactor/repo` | `main@57c4c42`，跟踪 `origin/main`，干净 | fetch、分支和 worktree 管理 |
| 重构前 | `/Users/ylf/Desktop/projects/tradepulse-refactor/before` | `baseline/pre-refactor@57c4c42`，干净 | 只读前后对照 |
| 重构后/开发中 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after` | `codex/frontend-widget-pilot@03d3e91`，干净 | 当前唯一重构开发入口 |

- 远程：`https://github.com/mewmind-chen/russia-crm-local.git`
- 当前 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- 当前重构提交：`03d3e91`（阶段 B 续：addQuote/addOrder 的 stage/updated_at 写收敛到 state_write 网关）
- 重构分支相对 `origin/main`：ahead 67（业务）+ 2（治理），未合并；本地未配置发布或生产动作。
- 旧目录 `/Users/ylf/Desktop/projects/tradepulse-development` 只保留为迁移来源，不再作为当前权威路径。

## 2. 已提交的重构进度

`origin/main..HEAD` 当前 66 个业务提交 + 1 个治理提交。相对 `76b7b56`（62 提交）已追加：`92c3879`（WIP 收敛）、`09ef77e`（治理文档），以及本轮三个阶段 B 切片：

- `13cd37a`：`rejectCrmCustomer` 的 stage/lifecycle/assignment/owner 写收敛到 `lib/domains/lifecycle/state_write` 网关，回收专属字段仍直写。
- `06a9868`：`applyCustomerReturn` 的 assignment/owner 写经同一网关，lifecycle 保持 active、stage 不动。
- `a783c8c`：`addQuote`/`addOrder` 增加 stage 前置校验（报价前 stage≤quoted、首单前 stage≤won、复购任意），放在幂等回放短路之后。
- `03d3e91`：`addQuote`/`addOrder` 的 stage/updated_at **写入**也收敛到 `applyAccountStatePatch`；`next_action*` 与 `last_activity_at` 仍直写（计划收敛为下一切片）。

已经形成的主要切片包括：

- 字段目录与 schema 驱动显示：线索池、客户资料字段分组、profile widgets、用户级 section 偏好。
- identity/filter 兼容 facade 与认证中间件抽取。
- lifecycle 状态投影、状态写入 shim、协作状态写入、前端 DTO 消费。
- contact-restricted 读取的多类白名单投影。
- customer、activity、planning、intake、assignment、commerce、reporting 等纯函数或辅助逻辑抽取。
- `lib/domains/` 当前有 42 个文件。

接线索计（详见 `sessions/2026-08-29-state-write-convergence.md`）：审计确认 `92c3879` 的内联回退覆盖了 `lib/domains/` **全部 42 个模块**在 `sales_crm.js` 的引用（非此前文档所记"部分"）；当前生产代码中仅 `lifecycle/state_projection`（经 `business_page_filters.js`，pipeline 行）与 `lifecycle/state_write`、`lifecycle/collaboration_write`（经 `crm_account_rebuild.js`）仍被接线。本轮三个切片是阶段 B 首批：把 `state_write` 写网关重新接入 `sales_crm.js`。

规模变化仅表示已经开始拆分，不代表单体拆分完成：

- `origin/main` 的 `lib/sales_crm.js`：13,758 行。
- 当前提交态 `03d3e91`：13,861 行。
- `sales-assets/app.js` 当前仍为 14,096 行。
- 客户完整资料仍保留 iframe 兼容路径；尚未形成完整 widget 注册表。

因此当前结论是：重构已经实质推进，但仍处于渐进迁移中，不能描述为“拆分完成”或“可合并”。

## 3. 已提交 WIP 收敛（2026-08-29）

迁移 WIP 已按用户裁定保留并提交为 `92c3879`。收敛内容：

- `lib/domains/identity/index.js`：精简 facade，不再转发 `PERMISSION_DEFINITIONS` 等常量与 `contactSafe*`/`redactContactFields` 白名单代理。
- `lib/sales_crm.js`：移除 accounts/bootstrap/profile 的 state DTO 投影（`projectAccountState`），并内联/回放此前抽取的部分 domain 引用，保持外部 API 行为不变。
- `sales-assets/app.js`：删除 `accountStageOf`/`managerStateDisplay`/`accountLifecycleActive`/`accountAssignmentReturned`，直读裸字段。
- `test/domain_facades.test.js`、`test/issue103_frontend.test.js`、`test/issue209_ownerless_return.test.js`、`test/lifecycle_state_projection.test.js`：同步更新契约断言；白名单兼容测试改为从 `access_control` 直连导入。

注意：pipeline 行仍由 `business_page_filters.js` 附加 state DTO（未内联），与 accounts/bootstrap/profile 的“无 state DTO”存在边界差异，已通过测试确认前端不依赖该差异。

`after/` 工作区干净：5 个迁移 WIP 业务文件已提交为 `92c3879`；仅剩 `docs/governance/` 治理文档待提交。

## 4. 最近验证结果

在 `/Users/ylf/Desktop/projects/tradepulse-refactor/after` 执行：

- `npm ci`：成功安装；审计报告未升级依赖。
- `npm test`：全量 core `1497/1497` 通过。
- `node --test`：全量 `1857/1857` 通过（含此前修复的 12 个失败场景）。
- 专项：`domain_facades`+`issue103` 9/9；`lifecycle_state_projection` 22/22；`issue209` 5/5；`state_write_reject_contract` 2/2；`state_write_return_contract` 2/2；`state_write_stage_contract` 4/4；`state_write_commerce_contract` 5/5。

本轮新增 3 个契约测试文件共 8 个断言（reject/return 状态写收敛 + quote/order stage 前置校验），覆盖阶段 B 契约 §4 不变量与 §3.2 stage 推进。

此前 12 个全量失败已在一轮修复（ownerless return 前端兼容、lifecycle state projection 契约、contact whitelist 兼容导出）。

当前测试结论是“绿灯”。旧文档中的 1353/1353 或 1361/1364 只属于历史 checkpoint，不能作为当前完成证据。

## 5. 当前阶段判断

- 阶段 0 治理基础：已建立；2026-08-29 已迁移到新根目录并完成校准。
- 前端字段目录/widget 试点：已实现多个切片，但 widget 注册表和 iframe 收敛尚未完成。
- 后端领域拆分：`lib/domains/` 42 个文件；审计确认 WIP 回退了其在 `sales_crm.js` 的全部引用，生产接线仅剩 3 个 lifecycle 模块经其他 lib 存活。
- 阶段 B 状态真源：首批 + 续：`rejectCrmCustomer`/`applyCustomerReturn` 写路径收敛到 `state_write` 网关，`addQuote`/`addOrder` 加 stage 前置校验并把 stage/updated_at 写收敛到网关；剩余直写为 `next_action*`/`last_activity_at`（计划字段，属 collaboration_write 收敛范围）。
- 状态、权限与白名单：state DTO 按用户裁定收敛为直读裸字段；白名单投影改为 `access_control` 直连。
- 生产部署/UAT：本轮未执行，不得从本地结果推断生产状态。

## 6. 下一步允许动作

1. 单独提交治理文档 checkpoint（当前更新），与业务提交分离。
2. 阶段 B 后续：把 `addQuote`/`addOrder`（及 `addActivity`/AI next_action 等）的 `next_action*`/`last_activity_at` 直写收敛到 `collaboration_write`/计划网关。
3. 按接线清单逐模块把 `lib/domains/` 中被 WIP 回退的模块重新接入 `sales_crm.js`（保持兼容 forwarder；优先从有契约测试的 lifecycle 网关开始）。
4. 收敛 pipeline 与 accounts/bootstrap/profile 之间 state DTO 的边界差异。
5. 未全绿前不叠加下一阶段新功能或拆分范围。

## 7. 红线

- 不在 `repo/`、`before/` 或旧 `tradepulse-development` 中编辑业务代码。
- 不修改 `/Users/ylf/Desktop/projects/tradepulse-production`、生产数据库、生产配置或生产部署。
- 不重构、迁移或搬运 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。
- 新根目录尚未建立专用预览 runtime；在明确数据库路径前，不启动会误连旧 runtime 的服务。
- 未经用户明确要求，不 push、不合并、不删除旧目录。

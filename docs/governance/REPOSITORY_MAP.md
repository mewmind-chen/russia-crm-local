# TradePulse 仓库地图

更新时间：2026-08-29

## 权威工作区

```text
/Users/ylf/Desktop/projects/tradepulse-refactor/
├── README.md
├── repo/      # 中心 clone；同步远端与管理 worktree
├── before/    # 重构前基线；只读
└── after/     # 当前重构分支；唯一业务开发入口
```

| 内容 | 路径 | 当前结论 |
|---|---|---|
| 远端主线 | `origin/main@57c4c42` | 每次开始前 fetch 后重新核实 |
| 中心 clone | `/Users/ylf/Desktop/projects/tradepulse-refactor/repo` | `main`，不直接开发 |
| 重构前代码 | `/Users/ylf/Desktop/projects/tradepulse-refactor/before` | `baseline/pre-refactor@57c4c42`，只读 |
| 重构后代码 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after` | `codex/frontend-widget-pilot@76b7b56`，当前开发入口 |
| 治理文档 | `/Users/ylf/Desktop/projects/tradepulse-refactor/after/docs/governance` | 当前治理真源，尚待提交 |
| 独立 runtime | 尚未建立 | 创建并明确数据库路径前不得复用旧 runtime |

旧 `/Users/ylf/Desktop/projects/tradepulse-development` 不是当前开发根目录；其中的历史 worktree/session 路径只表示迁移前事实。生产目录 `/Users/ylf/Desktop/projects/tradepulse-production` 不在重构工作区内。

## 主要代码入口

- `server.js`：Express 主入口、通用 API、共享报告、Recon 和 Assistant 路由。
- `sales-crm.html`：统一 CRM 页面入口。
- `sales-assets/app.js`：CRM 前端单体脚本，当前仍约 1.4 万行。
- `lib/sales_crm.js`：销售 CRM 聚合安装、API 和兼容逻辑，仍是主要后端单体。
- `lib/domains/`：渐进抽取的领域模块；当前 42 个文件。
- `lib/db.js`：基础数据库初始化、旧数据模型和 Recon 相关能力。
- `docs/governance/`：长期目标、当前状态、路线、风险和 session 证据。

## 领域与模块映射

| 领域 | 主要代码 | 主要数据 |
|---|---|---|
| 客户/旧跟进 | `lib/db.js`、`lib/customer_filters.js`、`lib/domains/customer/` | `customers`、`customer_pool`、`crm_accounts` |
| 线索/入库 | `lib/sales_crm.js`、`lib/intake_flow_filters.js`、`lib/domains/intake/` | `crm_intake_*`、`customer_pool` |
| 权限/身份 | `lib/access_control.js`、`lib/permission_groups.js`、`lib/domains/identity/` | `sales_users`、权限组、授权表 |
| 筛选 | `lib/filter_catalog.js`、`lib/filter_authorization.js`、`lib/domains/filter/` | 筛选定义、授权与版本 |
| 生命周期 | `lib/domains/lifecycle/`、`lib/sales_crm.js` | account stage/lifecycle、intake assignment、plan/manager 状态 |
| 活动/计划 | `lib/domains/activity/`、`lib/domains/planning/` | `crm_activities`、下一步和告警 |
| 联系人 | `lib/contact_quality.js`、`lib/sales_crm.js` | `contacts`、`person_candidates`、`contact_methods` |
| Recon | `lib/recon_contract.js`、`lib/recon_grading.js`、Python workers | `recon_jobs`、`recon_results`、`recon_evidence` |
| AI（冻结） | `lib/ai_stations/`、`lib/assistant*.js` | `crm_ai_*`、assistant 表 |

## 操作规则

- fetch、查看远端和管理 worktree：进入 `repo/`。
- 查看重构前行为：进入 `before/`，保持只读。
- 修改、测试和提交重构：只进入 `after/`。
- 新 runtime 必须建在新根目录并使用独立数据库；不得引用旧目录数据库。
- 路径、SHA、测试数不一致时，以现场命令核验并更新 `CURRENT_STATE.md`。

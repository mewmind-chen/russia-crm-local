# Session Checkpoint：阶段 G 路由与兼容装配收尾

日期：2026-09-02  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
实现回滚点：`f0ab815`  

## 目标与范围

本轮以远端 `main` 与生产 `current` 双基线为唯一基准，完成阶段 G 可安全抽取的兼容装配收敛：将旧入口、profile 资源、CRM 路由组和后台管理路由的 HTTP 注册/数据库生命周期/错误响应装配移出大聚合文件，保持外部路径、注册顺序、权限、脱敏、分页、筛选、导出、事务和 impersonation 行为等价。

本轮明确不做：不恢复、新增或迁移任何 AI；不修改生产；不 push、merge 或 deploy；不搬迁资料聚合、profile 写入、迁移复核、密码、入库/评价等高耦合业务。

## 双基线

- `repo/` `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- production `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- production `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`

三者一致；生产目录保持只读。

## 装配切片

| 提交 | 独立装配边界 |
|---|---|
| `d615410` | `/legacy`、`/tradelead-v2.html` 可选兼容入口 |
| `7d6e88a` | profile 资源与 `/development-workbench` 权限分流 |
| `23b6365` | Team 状态与协作路由 |
| `0359cff` | 联系人维护路由 |
| `efb4da9` | 页面入口路由 |
| `bf1f114` | 认证、账号与回收路由 |
| `fc5bfcd` | 读取/列表与 intake/research 路由 |
| `9804e0b` | 主管任务/风险/指标路由 |
| `fb1b795` | 非 AI 活动、更正与反应路由 |
| `4be94c3` | 受保护客户与身份冲突路由 |
| `077617b` | bootstrap 与筛选 schema 路由 |
| `575cd23` | 导出、活动、commerce、计划与 impersonation 写入路由 |
| `f0ab815` | 数据维护、用户、权限组与筛选权限（19 条路由） |

`lib/sales_crm.js` 从远端基线约 13,758 行收敛到当前约 11,773 行；各注册器只接收显式依赖，未复制或改变业务服务实现。

## 保留边界

- 全局认证/审计/策略中间件留在聚合根，确保所有路由共享同一安全边界。
- `profile/:customerId`、`intake/:itemId/profile` 及资料相关写入留在原位；它们共享资料投影、联系人门控、标签/Recon 和 legacy fallback 的私有状态。
- migration-review 事务、password、intake scan/action/settings、evaluations 及其测试保持原位；它们分别依赖跨表事务、旧兼容 API 或高耦合状态。
- AI task middleware、`registerAIStationRoutes`、`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 零改动。

## 契约与验证

- 每个新增注册器均有路由矩阵测试；本轮后台注册器矩阵覆盖 19 条路由。
- 管理/维护/筛选/访问控制/impersonation 专项：`56/56`；静态兼容契约修复后三项回归：`16/16`。
- 最终全量：`npm test` core `1745/1745`；`node --test` `2107/2107`。
- `node --check`（变更 JS）、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary` 均通过。

## 结论与回滚

阶段 G 的兼容层完成门通过：旧入口与可安全抽取的路由装配已独立化，旧 API/页面行为保持兼容；高耦合边界有明确审计记录并保留原位。每个切片为独立提交，可按提交粒度回滚；`f0ab815` 是本轮最后一个业务回滚点。后续如要继续缩小 `sales_crm.js`，必须先对保留边界重新独立审计。

未 push、未 merge、未部署；生产保持只读，AI 功能继续冻结。

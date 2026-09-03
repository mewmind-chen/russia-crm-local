# Session Checkpoint：Stage C raw shape / `SELECT *` 收口

日期：2026-09-03（Asia/Shanghai）  
范围：`after/` 的非 AI 读取边界（recon、people、prospect、templates）

## 基线与约束

- `repo/origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha`
  均为 `57c4c42a89e7730545b726b29fd932c5bfb20574`；本次只写 `after/`。
- AI runtime、AI UI、`/api/prospect-agent` 行为与 `crm_ai_*` 保持冻结；本页只记录其
  数据形状门控，不改变 AI 生产者、任务执行或存储协议。
- 未启动生产、UAT、部署、push/merge；顶层 composite 白名单仍不迁移。

## Raw 形状风险矩阵

| 形状/来源 | 风险 | 当前规则 | 决定 | 证据 |
|---|---|---|---|---|
| `recon_results` / `recon_jobs` | `SELECT *` 会随 schema 增长；结果 JSON、机会叙事和联系方式混在同一行 | `view_recon` 先做范围门；无 `view_contacts` 的结果走 `contactSafeReconRecord`（固定业务键），`result_json/evidence` 不下发 | 保留 raw 查询，受限端点继续专用投影；未完成逐键/嵌套等价前不迁移复合白名单 | `phase_c_s6_bootstrap_contract`、`phase_c_raw_shape_contract`、`/api/recon/results/:jobId` |
| `people` / `person_candidates` + `contact_methods` | 这是联系人资料，不适合“部分脱敏”推断；`pc.*` 可能引入未知联系人列 | 仅 `view_contacts` 查询；旧 `/api/customers/:id/people` 与 `/api/contact-recon/state` 由 legacy policy 直接 403；统一 Research People 同一权限门 | 保留完整联系人形状给授权角色，拒绝为无权限角色复制半安全 shape | `permission_integration`、`phase_c_raw_shape_contract`、`loadResearchPage` |
| `prospect_tasks/candidates/sources` | AI/Prospect 自由文本、来源摘要、URL、未知列可能携带联系方式；`SELECT *` 形状会漂移 | `use_prospect_agent` 是源头门；`buildProspectTask/Candidate/Source` 只映射已知字段；无 `view_contacts` 时最终 bootstrap 递归脱敏 | AI 行为冻结；显式 builder 关闭未知列漂移，但不重写自由文本语义、不做 AI 迁移 | `phase_c_s6_bootstrap_contract`、`phase_c_raw_shape_contract` |
| `templates` | 开发话术为自由文本；未知 schema 列可能被公共 spread 原样带出 | 保留 `view_development` 门；`buildTemplate` 只输出既有六个业务字段；联系人边界仍由最终 payload 递归规则处理 | 允许此独立叶子形状收口；不把模板字段推断为客户联系人字段 | `phase_c_raw_shape_contract`、`Index.html:renderTemplates` |
| `contact_recon_jobs` | 任务状态行与 worker/output/error 字段并存；未知列可能包含凭据或联系方式 | 仅 `view_contacts` 查询；无权限返回空数组/空统计；worker POST 由 token 保护 | 继续源头门控，不复制为 blacklist/whitelist 混合 shape | `phase_c_s6_bootstrap_contract`、legacy route policy |

## 递归/自由文本契约

1. `redactContactDynamicFields` 只在已完成资源/权限检查后调用；对象、数组和可解析 JSON
   文本递归访问，规范化联系人别名在任意深度移除，未命中 JSON 的字符串保持原文。
2. P1/P3 `redactIntakeAggregate` 仍是 intake 专用边界：`developmentHistory` 采用显式元数据
   投影（`lastActivitySummary` 永不下发），`complementaryInfo` 只保留 `website/industry`
   布尔标记，`arbitration/assignmentAudit` 逐层递归裁剪；不得把它当全局黑名单。
3. `contactSafeReconRecord`、`contactSafePoolRecord`、`contactSafeCustomerRecord` 是已授权
   业务叶子投影，不等同于 generic recursive helper；`result_json`、联系人 evidence 和
   `pc.*` 不在无权限响应内。
4. 已知自由文本（prospect/template/recon opportunity）不做内容猜测或自动改写；它们只能
   通过源头权限、显式 shape builder 或专用 projection 进入响应。未知自由文本后代在没有
   独立等价证明前视为迁移 blocker。

## 本次实现与验证

- `lib/db.js` 新增 `buildTemplate`，`getInitialData` 的模板查询改为显式六字段映射，未知
  schema 列不再经 `SELECT *` 直接进入 API。
- 新增 `test/phase_c_raw_shape_contract.test.js`：
  - 静态锁定 raw shape 的 builder/permission gate；
  - 真实 SQLite fixture 注入未知 JSON 列，验证受限 bootstrap 丢弃未知列、prospect/recon
    保持既有角色边界、管理员 recon 保持 raw 兼容；
  - 真实 legacy people/contact-recon 端点验证无 `view_contacts` 返回 403。
- 专项组合验证：`node --test test/phase_c_raw_shape_contract.test.js
  test/phase_c_s6_bootstrap_contract.test.js test/phase_c_load_intake_aggregate_audit.test.js
  test/phase_c_s4_dynamic_fields_contract.test.js`，16/16 通过。

## 未迁移/回滚

- 不迁移 `recon`、`people`、`contact_recon` 或任何 profile/bootstrap composite 顶层白名单；
  其 raw SQL 作为存储读取实现保留，响应边界由权限和专用 projection 负责。
- 若 `buildTemplate` 导致 legacy template renderer 需要新增字段，可回滚本切片
  `e10793c`；不得以恢复公共 spread 作为兼容方案。

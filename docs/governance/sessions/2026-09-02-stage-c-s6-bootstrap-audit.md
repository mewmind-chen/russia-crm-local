# Session Checkpoint：阶段 C S6/P2 Bootstrap 与 masterProfile 共享叶子逐形状审计

日期：2026-09-02（Asia/Shanghai）  
实现/契约提交：`3022dae`  
工作区：`after/`，分支 `codex/frontend-widget-pilot`

## 目标与边界

本切片审计 `lib/db.js:getInitialData`（`/api/initial`）返回的所有形状，并把可复用的
叶子结论提供给后续 S4/P4 `masterProfile` 逐形状证明。范围包括：`customers`、
`customerPool`、`reconJobs`、`reconResults`、`people`、`contactReconJobs`、
`contactQualityStats`、`prospectTasks/Candidates/Sources`、`tags`、`templates`、`stats`
以及外层 payload。

本切片不改 AI 运行时、AI 专用 UI 或任何生产目录；不启动 `contactSafeBootstrapPayload`
或其他高耦合复合白名单迁移；不把已证明的单行投影外推成整个 bootstrap/masterProfile 等价证明。

## 双基线与实现证据

| 证据 | SHA/状态 |
|---|---|
| 中心 clone `repo/` 的 `origin/main` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `current/.release-sha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `state/state.json.lastSuccessfulSha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| `after/` HEAD | `3022daef02538e1176dc0e99a44706b6c63d58c7` |
| 生产写入/部署 | 未执行；生产目录只读 |

三份基线一致，满足继续审计的前置条件。`.impeccable/` 是预存在的未跟踪工具目录，未触碰。

## 字段风险矩阵与决定

| 形状 | 来源与权限门 | 主要风险 | 决定 |
|---|---|---|---|
| `customers[]` | `customers` `SELECT *` → `buildCustomer` → `attachTags`；`view_customers`；无 `view_contacts` 使用 `contactSafeCustomerRecord` | legacy 表可扩列；状态、联系叙事和 tags 混合 | 已有叶子白名单与递归黑名单逐键等价；继续复用叶子，不外推复合 |
| `customerPool[]` | `CUSTOMER_POOL_PROFILE_SELECT` → `buildPoolCustomer` → `attachTags`；`view_pool`；无联系人权限使用 `contactSafePoolRecord` | 多表最新 recon/sanction join；未来 pool 列扩展 | 补入安全业务字段 `establishedYear`；组装后 pool 行可等价，原始 join 行不作为复合白名单输入 |
| `reconJobs[]` | `recon_jobs` `SELECT *`；`view_recon`，否则 `[]` | `error/output` 和未来列可能含叙事、内部材料 | 保留源头门与外层递归脱敏，不创建独立复合投影 |
| `reconResults[]` | `recon_results` `SELECT *`；`view_recon`；无联系人权限使用 `contactSafeReconRecord` | raw 行出现 `contact_classification`、`missing_steps`、`evidence_url`、`artifacts_json`；严格投影与通用黑名单键集漂移，JSON 文本可能含未知联系方式 | 专用投影 fail-closed 丢弃漂移键；不满足 blacklist≡whitelist，作为复合迁移阻塞 |
| `contactReconJobs[]` | 仅 `view_contacts` 查询，否则 `[]` | `result_json`、worker/目标角色等动态列 | 以源头空数组为边界；等待独立 people/contact-recon 形状契约 |
| `people[]` | `person_candidates SELECT pc.*` + `methods_summary`；仅 `view_contacts` | `SELECT *`；`methods_summary` 拼接真实联系方式 | 以源头空数组为边界；不在本切片新建白名单 |
| `contactQualityStats` | 从已查询的 people/jobs 计数；仅 `view_contacts` 返回，否则 `{}` | 计数反映联系人数据规模，不能从通用递归输出推导等价 | 保留源头门；不并入复合白名单证明 |
| `prospectTasks[]` | `prospect_tasks` → `buildProspectTask`；`use_prospect_agent`，按 owner 限定 | `query`、focus、`error` 等动态叙事；能力邻接 AI 红线 | 保留现有权限和最终递归裁剪；不改 AI、不新建 prospect 白名单 |
| `prospectCandidates[]` | `prospect_candidates` → `buildProspectCandidate`；同上 | description/products/need/sell/contact/decision/sourceSummary 等值可携带联系方式 | 记录为动态叙事 blocker；不作为安全叶子 |
| `prospectSources[]` | `prospect_sources` → `buildProspectSource`；同上 | title/url/snippet 可能为联系人或外链，文本值无法用键名证明安全 | 保留最终递归裁剪，不改变既有能力行为 |
| `tags[]` | `tags SELECT *` → `buildTag`；`view_development` | 查询可扩列；自定义 name/category 值语义未证明 | builder 固定扁平 DTO，但保留外层递归作为兜底 |
| `templates[]` | `templates SELECT *`；`view_development` | 英文/俄文模板与 description 为动态文本，未来列可扩展 | 保留外层递归，不建立模板白名单 |
| `stats` | `getStats(visibleCustomers, customerPool, reconJobs)` | 动态 `byOwner/byType/byPool` map，依赖权限投影后的输入 | 作为派生聚合保留；需组合行为证明，不单独迁移 |
| 外层 payload | user、客户/pool、stats、templates、recon、contacts、prospect、options | 跨域复合；未来新增顶层键可能绕过单一白名单 | 继续 `view_contacts ? payload : redactContactFields(payload)`；不创建 `contactSafeBootstrapPayload` |

## 契约与运行时结果

`test/phase_c_s6_bootstrap_contract.test.js` 共 5 个子测试，覆盖：

1. `getInitialData` 的组装顺序、`SELECT *` 来源、每个权限门、`/api/initial` 的
   `view_development` policy，以及最终递归裁剪；静态锁定不存在
   `contactSafeBootstrapPayload`。
2. customer 和组装后的 pool 行满足 `contactSafe*Record(row)` 与
   `redactContactFields(row)` 的逐键等价，且 tags/`establishedYear` 不丢失；raw recon
   明确锁定四个黑名单/严格投影漂移键，并验证严格投影结果再次递归裁剪稳定。
3. 无 `view_contacts` 的受限主管仍获得客户、pool、recon 的业务结构，但
   `contactReconJobs`、`people`、`contactQualityStats` 源头为空，prospect 叙事字段和
   recon 动态字段不泄漏。
4. sales、manager、admin 保持既有客户范围、联系人可见性和联系人计数行为。
5. 复合迁移门禁：没有新增 bootstrap 白名单 helper，外层仍为递归脱敏。

专项结果：`node --test test/phase_c_s6_bootstrap_contract.test.js` **5/5**。

## 迁移门禁与后续关系

本切片的叶子结果不能开启 bootstrap 复合迁移：

- raw `recon_results` 已有可复现的严格 projection/递归 blacklist 键集漂移；
- `reconJobs`、`contactReconJobs`、`people`、`templates`、prospect 依赖 `SELECT *` 或动态
  文本/JSON，未知后代尚未完成递归等价证明；
- `contactQualityStats` 是联系人规模的门控派生对象；stats、tags、外层 options 是跨域动态聚合。

因此继续保留 `getInitialData` 的外层 `redactContactFields`，保留已证明的 customer/pool/recon
源头与叶子边界，不创建或接线 `contactSafeBootstrapPayload`。该结论可供下一阶段 S4
`masterProfile`/people/recon 逐形状契约复用，但不自动开启 S4/S6 复合迁移；P1/P3 递归规则、AI
冻结和生产只读均保持不变。

## 下一步最小动作

进入 S4/P4 的 `masterProfile`/people/recon 独立逐形状证明：先补稳定字段目录、嵌套未知 JSON
和权限行为契约，再重新评估复合迁移门禁。若 recon 漂移或 people 动态来源未收敛，继续保留
递归边界，不扩大范围。

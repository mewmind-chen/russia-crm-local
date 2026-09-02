# Session Checkpoint：阶段 C S4/P4 masterProfile、people、recon 逐形状证明

日期：2026-09-02（Asia/Shanghai）  
实现/契约提交：`343f166`  
工作区：`after/`，分支 `codex/frontend-widget-pilot`

## 目标与非目标

本切片承接 S4/P4 回收资料审计和 S6/P2 Bootstrap 共享叶子审计，针对
`getCustomerProfileData` 共享的 `masterProfile`，完成 `people`、`contactReconJobs`、
`reconJobs`、`reconResults` 以及 profile/intake 路由追加字段的逐形状风险矩阵、权限行为
和递归脱敏契约。重点是确定“哪些来源必须为空、哪些叶子可以复用、哪些动态字段阻止
复合白名单迁移”。

本切片不创建或接线 `contactSafeRecycleProfilePayload`，不启动任何高耦合复合白名单迁移，
不修改 AI 生产逻辑、AI 专用 UI、生产目录或生产数据。评价记录中的既有 AI 字段只作为
联系人递归边界的测试哨兵，不改变其生成、存储和开关语义。

## 双基线与实现证据

| 证据 | SHA/状态 |
|---|---|
| 中心 clone `repo/` 的 `origin/main` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `current/.release-sha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `state/state.json.lastSuccessfulSha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| `after/` HEAD | `343f166bf4660b997faecf0f49eda6e6dd710306` |
| 生产写入/部署 | 未执行；生产目录只读 |

三份基线一致，满足继续审计的前置条件。`.impeccable/` 是预存在的未跟踪工具目录，未触碰。

## 来源与字段风险矩阵

| 形状 | 来源与权限门 | 关键风险 | 当前规则/决定 |
|---|---|---|---|
| `masterProfile` 外层 | `getCustomerProfileData` 先做外部客户范围校验；`view_contacts` 控制 customer/people/contact jobs/contacts，`view_recon` 控制 recon；普通 profile/intake 路由会在函数返回后追加自有字段 | 共享于普通 profile、intake、recycle；路由追加字段可能绕过函数内部早已执行的递归裁剪 | 保留外层 `redactContactFields`；profile/intake 统一在所有追加完成后调用 `redactProfileResponse`；不创建复合 payload 白名单 |
| `people[]` | `person_candidates` `SELECT pc.*`，并拼接 `contact_methods` 的 `methods_summary`；只在 `view_contacts` 下查询 | raw 扩列和 summary 拼接直接携带真实联系方式 | 无 `view_contacts` 固定 `[]`；有权限保持既有 raw 形状；未知扩展尚未具备稳定白名单键集 |
| `contactReconJobs[]` | `contact_recon_jobs` `SELECT *`；只在 `view_contacts` 下查询 | `result_json`、worker/目标角色字段以及未来列可能包含联系人或内部叙事 | 无 `view_contacts` 固定 `[]`；有权限保持既有形状；不单独投影，不进入复合迁移 |
| `reconJobs[]` | `recon_jobs` `SELECT *`；只在 `view_recon` 下查询 | `error`/output 与未来动态列可能包含叙事或内部材料 | 无 `view_recon` 固定 `[]`；有 `view_recon` 但无联系人权限时仍走外层递归，剥离 `error` 等 CONTACT_KEYS |
| `reconResults[]` | `recon_results` `SELECT *`；只在 `view_recon` 下查询；无联系人权限使用 `contactSafeReconRecord` | `contact_classification`、`missing_steps`、`evidence_url`、`artifacts_json` 等 raw 漂移键；JSON 文本可能带未知联系方式 | 继续严格叶子投影 + 外层递归；已授权用户保留 raw；四个漂移键使复合等价继续阻塞 |
| route-owned `insights.evaluations` | 普通 profile 路由在 `getCustomerProfileData` 后加载 `loadInsights` 并追加评价与 access；受 `view_insights`、既有 AI 开关控制 | evaluationText、AI 摘要/标签/风险/策略等字段是在早期裁剪后追加，可能重新泄漏叙事 | `redactProfileResponse` 在响应前再次递归裁剪；保留结构元数据，不改变评价/AI 生产逻辑 |
| route-owned recycle `account`/`recycle` | `buildRecycleAccountProfile` 在 masterProfile 外组装 account、recycle 元数据，最终已有联系人边界 | `account.recycle_reason` 不在旧 CONTACT_KEYS 时会绕过递归边界 | 将规范化键 `recyclereason` 纳入 CONTACT_KEYS；同步移出 account 叶子白名单以保持 blacklist≡whitelist，受限 recycle 不返回 reason |

## 递归规则与权限契约

规则顺序固定为：

1. 先执行资源范围和端点权限（profile 的客户范围、recycle 的生命周期/范围、`view_recon`、
   `view_contacts`、`view_insights`）；
2. 对已证明的扁平叶子继续使用专用投影，对 people/contactReconJobs 等联系人集中来源直接
   使用源头空数组门控；
3. 组装所有 route-owned 字段后，再执行 `redactUnauthorizedProfileTags` 与联系人递归裁剪。

`redactProfileResponse` 只返回新对象，不修改查询行或共享 payload；有 `view_contacts` 的
   调用者不改变原有 people/contact jobs、recon raw 字段和评价文案；没有该权限时仍保留
   customer/pool/recon 的业务结构，但删除联系人、联系人叙事、recon job error、评价文案/
   AI 叙事以及回收原因。`view_insights` 不是联系人权限的替代品。

## 契约与运行时证据

新增 `test/phase_c_s4_master_profile_contract.test.js`，共 4 个子测试：

1. 静态锁定 profile/intake 两条路由都在 route-owned 字段追加完成后调用
   `redactProfileResponse`，并锁定共享 profile/recycle builder 的最终递归边界；
2. 受限 master profile（`view_insights`/`view_recon` 有、`view_contacts` 无）验证 people 与
   contactReconJobs 为空，pool/customer/recon 联系字段、recon job error 和追加的评价文本/
   AI 叙事均不可见；
3. admin 形状验证 people/contact jobs、recon email/artifacts 和 evaluationText 仍按已有
   授权返回；
4. 受限 recycle composite 验证 `readOnly:true`、source=`recycle`、people/recon/evaluation
   门控，且 `account.recycle_reason` 与 `recycle.reason` 均被移除。

专项结果：

- `node --test test/phase_c_s4_master_profile_contract.test.js`：**4/4**；
- S4 recycle、S6 bootstrap、S7 redaction 和 account whitelist 相关回归：全绿；
- 真实 fixture 哨兵复现了 profile 路由在早期裁剪后追加 evaluationText/AI 字段的泄漏，
  `343f166` 已关闭该边界；同时修复 `recycle_reason` 在受限 recycle account 上的遗漏。

## 迁移门禁决定

本轮完成的是 masterProfile/people/recon 的逐形状安全证明和路由后处理修复，不是复合
白名单迁移。以下门禁仍未满足：

- `people`、`contactReconJobs`、`reconJobs` 继续依赖 `SELECT *` 或动态拼接；
- raw `reconResults` 的严格叶子投影与通用黑名单已经存在稳定键集漂移；
- account、commerce、timeline 的动态后代和叙事字段尚未完成结构/逐键等价/嵌套泄漏证明。

因此不创建或接线 `contactSafeRecycleProfilePayload`，继续保留
`getCustomerProfileData`/`buildRecycleAccountProfile` 的外层 `redactContactFields`，仅复用
已经证明的 customer/pool/recon/activity/commerce/timeline/audit 叶子边界。下一目标是
account、commerce、timeline 动态字段的独立证明；在该目标完成前，S4/S6/P1/P3 顶层复合迁移
继续冻结。

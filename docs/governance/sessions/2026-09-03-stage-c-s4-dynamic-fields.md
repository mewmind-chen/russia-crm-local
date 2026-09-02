# Session Checkpoint：阶段 C S4/P4 account、commerce、timeline 动态字段递归边界

日期：2026-09-03（Asia/Shanghai）
实现/契约提交：`e030900`
工作区：`after/`，分支 `codex/frontend-widget-pilot`

## 目标与非目标

本切片承接 `343f166` 的 masterProfile/people/recon 逐形状证明，针对 S4/P4 回收资料中
`account`、`activities`、`rfqs`、`quotes`、`orders`、`timeline` 的动态后代收口。重点是
确认 `SELECT *`、公共活动行 spread、商务动态列和 timeline 嵌套值在无
`view_contacts` 时不会因 JSON 文本编码绕过递归联系人边界。

本切片不创建或接线 `contactSafeRecycleProfilePayload`，不启动任何高耦合复合白名单迁移，
不修改 AI 生产逻辑、AI 专用 UI、生产目录或生产数据。AI 只作为既有 aggregate 的冻结边界；
契约 fixture 使用 `aiStationsEnabled:false`，不调用或改变 AI 路由/触发点。

## 双基线与实现证据

| 证据 | SHA/状态 |
|---|---|
| 中心 clone `repo/` 的 `origin/main` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `current/.release-sha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `state/state.json.lastSuccessfulSha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| `after/` 实现提交 | `e030900c19e0fde14777fe5ff48dbdb891b23cee` |
| 生产写入/部署 | 未执行；生产目录只读 |

三份基线一致，满足继续审计的前置条件。`.impeccable/` 是预存在的未跟踪工具目录，未触碰。

## 动态来源与字段风险矩阵

| 形状 | 真实来源与权限/范围门 | 动态后代风险 | 当前规则与决定 |
|---|---|---|---|
| `account` | 回收路径由 `loadRecycleProfile` 先校验 `manage_customer_recycle`、生命周期与回收范围；`findRecycleAccount` 读取 `crm_accounts a.*` 并补负责人/回收人/客户池 join；普通 bootstrap 也读取 `crm_accounts a.*` | 未来新增 JSON/TEXT 列会随 `a.*` 原样进入 account；回收原因、备注和扩展对象可能携带联系人叙事 | 资源/权限先门控；无 `view_contacts` 时经 `redactContactDynamicFields` 递归处理对象、数组和 JSON object/array 文本；有权限保持原始行形状 |
| `activities[]` | `crm_activities x` `SELECT x.*`，左连接用户名称，再经 `addActivityProvenance`、`publicActivityRecords`；按 account 范围且排除测试数据 | public serializer 使用公共字段 spread，未来 metadata JSON、provenance 扩展或动态列可绕过仅按键的旧递归边界 | 保留活动有效性/溯源行为；无联系人权限采用动态 JSON 递归边界；不修改活动写入、纠正或 AI 触发 |
| `rfqs[]` | `crm_rfqs SELECT *`，回收资料和 bootstrap/export 按客户范围读取；只读组合 | 动态备注、line item 或 JSON 列可能含 email/phone/contact 别名 | 金额、币种、BOM、阶段等业务值保持；受限 composite 使用动态递归边界，不把数组提升为顶层白名单 |
| `quotes[]` | `crm_quotes SELECT *`，按客户范围读取；只读组合 | 同上，未来商业扩展列可能是 JSON 文本或嵌套对象 | 保留金额、币种、毛利和状态；递归删除规范化联系人键与常见动态别名；授权用户不裁剪 |
| `orders[]` | `crm_orders SELECT *`，按客户范围读取；只读组合 | 同上，订单扩展字段可能携带联系人或叙事 | 保留订单业务字段；与 RFQ/quote 使用相同动态边界，复合白名单仍门控 |
| `timeline[]` | `buildCustomerTimeline` 从 account、activity、RFQ/quote/order 组装固定事件，保留结构化 `provenance`；活动原始动态列另在 `activities[]` 返回 | 当前 builder 不复制未知来源列，但未来事件后代、`before/after`、provenance 或 JSON 文本可能新增敏感键；叙事键不能靠顶层值复制证明安全 | timeline 仍走统一动态递归边界；未授权时不复制未知源字段；既有 AI timeline 分支保持冻结，不在本切片改动 |

## 递归投影契约

新增 `redactContactDynamicFields(value, options)`，仅由已经完成资源和权限判定的复合读取路径
调用：

1. 继承 `redactContactFields` 的规范化 `CONTACT_KEYS` 规则，并补齐动态来源常见别名
   `emailAddress`、`phoneNumber`、`mobilePhone`、`contactEmail`、`contactPhone`、
   `personEmail`、`personPhone`、`workEmail` 等；
2. 对 hydrated object/array 继续任意深度递归；对 JSON object/array TEXT 先解析，再按同一
   规则递归；内部没有被删除字段时保留原始字符串字节，发生删除时才重序列化；
3. malformed JSON、JSON scalar 和普通字符串原样保留，不猜测或改写自由文本；投影不修改源行；
4. 有 `view_contacts` 的调用者不进入该 helper，保留既有 raw shape；AI route 不使用该 helper。

接线范围为 `db.js` 的 bootstrap/profile、`sales_crm.js` 的普通 aggregate、profile 后处理、
recycle composite 和 export 的联系人阶段。P1/P3 仍专用 `redactIntakeAggregate`，AI assistant
仍使用原冻结调用点，不把本 helper 当作 AI 或 intake 的替代实现。

## 契约与运行时证据

新增 `test/phase_c_s4_dynamic_fields_contract.test.js`，共 4 个子测试：

1. 静态锁定 account/commerce/timeline 的真实来源、动态 `SELECT *`、统一边界和 timeline
   组装关系；
2. 对 hydrated object/array、嵌套 JSON、双层 JSON、别名、malformed JSON 和非敏感未知键做
   递归投影、原文保留、非变异与旧 helper 差异验证；
3. 在隔离 SQLite 中为 account/activity/RFQ/quote/order 追加动态 JSON 列，用受限回收资料和
   `/api/initial` 验证所有联系人哨兵不可见，同时业务字段仍在；
4. 用 admin 回收资料验证动态 JSON 文本及联系人值保持原样。

已通过：

- `node --test test/phase_c_s4_dynamic_fields_contract.test.js`：**4/4**；
- S4 master/recycle、S6 bootstrap、S7 redaction 与导出凭据相关专项：全绿；
- 目标 core 回归：**1781/1781**；
- `node --check`（access/db/sales_crm/契约测试）与 `git diff --check`：通过。

## 迁移门禁与下一步

本切片关闭的是动态后代的递归 JSON 穿透风险，不等同于复合 payload 的顶层白名单等价。以下
门禁仍保持：

- `crm_accounts`、`crm_activities`、RFQ/quote/order 继续存在 `SELECT *`/公共 spread，未知键集
  和自由文本值无法据此形成稳定白名单；
- timeline 的业务叙事和 raw recon/people 等共享形状仍需独立逐键、结构和嵌套等价证明；
- 不创建或接线 `contactSafeRecycleProfilePayload`，不启动 S4/S6/P1/P3 顶层复合迁移。

下一个最小动作是继续审计剩余 raw recon/people 及其 JSON/`SELECT *` 漂移，或在治理层确认
它们长期保留递归边界；在新的逐形状证据完成前，复合白名单迁移继续冻结。

未 push、未 merge、未部署；当前实现回滚点为 `e030900`，此前 S4/P4 masterProfile/people/recon
回滚点为 `343f166`。

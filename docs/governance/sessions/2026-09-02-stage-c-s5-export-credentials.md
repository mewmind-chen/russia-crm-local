# 2026-09-02 Stage C S5/P5 导出凭据字段合规闭环

## 目标

在不改变导出授权、客户范围、联系人权限和合法商务字段的前提下，关闭
`/api/sales-crm/export` JSON/CSV payload 中凭据字段的递归泄漏风险。凭据边界独立于
P1/P3 顶层白名单迁移，不启动高耦合白名单迁移，不涉及 AI 或生产。

## 双基线与范围

- `repo/` 远端 `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 生产 `current/.release-sha` 与 `state/state.json.lastSuccessfulSha`：同为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`；生产目录只读，本轮未部署。
- 实现 worktree：`after/`，代码提交 `ccc9bb5`；治理文档与看板随后同步。
- 目标形状：`users`、`customers`、`contacts`、`activities`、活动更正/提案、
  `rfqs`/`quotes`/`orders`、`evaluations`，以及客户/活动 CSV。

## 字段风险矩阵

| 形状 | 来源风险 | 合规决定 | 合法保留范围 |
|---|---|---|---|
| `users[]` | `SELECT *` 行含 `password_hash`/`password_salt`，未来列可能扩展 | 显式用户 DTO 后仍对整个 payload 递归删除凭据键 | 用户身份、角色、权限组、激活状态、创建时间 |
| `customers[]` | 动态账户列可能携带 token/secret | 保留既有范围/联系人投影，再做凭据递归投影 | 客户、阶段、负责人、国家/行业、状态等授权字段 |
| `contacts[]` | `view_contacts` 用户可见原始动态列 | 联系人权限与凭据权限正交；所有角色都执行凭据投影 | 已授权联系人业务字段 |
| `activities[]` | 活动追加列、溯源或嵌套 JSON 可能携带凭据 | 对对象/数组和 JSON 文本递归处理 | 活动、客户关联、有效状态、非敏感业务元数据 |
| 更正/提案 | 历史 JSON 或追加列可能携带 session/secret | 保持客户可见性、审批和原因语义，再统一凭据投影 | 更正状态、审批及业务字段 |
| `rfqs[]`/`quotes[]`/`orders[]` | 商务表动态列可能引入密钥 | 递归删除凭据键，不改变金额、币种、毛利和范围 | RFQ、报价、订单及商务字段 |
| `evaluations[]` | 评价扩展列可能携带 secret | 先执行既有 AI/联系人语义，再执行凭据投影 | 既有人工评价字段 |
| CSV | 固定导出表头若改为动态取值可能带入凭据 | 继续使用固定合法列映射；上游 JSON 也已过凭据边界 | 既有客户/活动 CSV 列 |

## 运行时契约

`lib/access_control.js` 的 `redactExportCredentials(value)` 是导出专用、fail-closed 的
安全边界：

1. `exportCrmData` 先执行原有联系人投影，再对整个 payload 调用 helper；admin、非 admin、
   `view_contacts` 有/无和 JSON/CSV 格式均不能绕过。
2. 键名规范化后删除 `password/passphrase/passwd`、`token`、`session`、`secret`、
   `credential`、`authorization`、`cookie`、`apiKey`、`privateKey`、`encryptionKey`、
   `salt` 及其 hash/json/header 等复合别名。
3. 对对象、数组任意深度递归；对 JSON object/array TEXT 值递归解析，并处理双重编码 JSON。
   只在确实删除字段时重序列化，未命中的 JSON 文本保持原字节。
4. 直接删除凭据字段，不输出 `[REDACTED]`；非敏感未知业务键保留。CSV 仍由固定列映射生成，
   不借本切片启动其他 payload 的顶层业务白名单迁移。

## 契约与验证

- `test/phase_c_export_credential_contract.test.js`：5/5，覆盖 helper 源对象不变、对象/数组、
  嵌套及双重编码 JSON、普通 `tokenCount`/`secretary` 保留、admin/非 admin、JSON/CSV、空结果、
  无 `export_data` 403 及静态接线契约。
- 兼容回归组：43/43，覆盖导出范围/更正、筛选、AI 全局关闭、路由装配及既有权限/安全合同。
- 全量 `node --test`、core `npm test`、治理权威、AI 边界、语法和差异门禁结果记录在
  `CURRENT_STATE.md` 与生成看板中。

## 非目标与后续

- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或 AI 触发点；不启动生产、不写生产。
- 不把 S5 凭据边界等同于 P1/P3 顶层业务白名单迁移；后者继续按嵌套等价风险暂缓。
- 后续可在独立逐形状审计后评估其他复合 payload 的业务字段白名单，不从本切片直接扩张。

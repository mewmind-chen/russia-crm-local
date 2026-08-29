# TradePulse 字段目录设计与试点状态（FIELDS_CATALOG）

更新时间：2026-08-29
基线：`origin/main@57c4c42a89e7730545b726b29fd932c5bfb20574`
状态：设计已进入试点实现；`crm_drawer`、`intake/lead_flow`、`customer_profile` 已有代码和测试，完整页面覆盖与白名单收口仍未完成
上游决策：`DECISION_LOG.md D-008`（字段级自由显示）、`TARGET_ARCHITECTURE.md 7.5`
配套机制：`DECISION_LOG.md D-007`（Widget 注册表）、`filter_catalog.js`（筛选字段范式）

> 2026-08-29 校准：首个试点已不再是“待执行”。相关提交从 `7a26074` 开始，profile widgets 与用户偏好也已落地；但当前未提交 WIP 导致全量测试红灯，不能把本设计标记为整体完成。实时状态见 `CURRENT_STATE.md`。

## 1. 目标

- 线索池、客户资料、客户列表等页面的字段可**自由显示/隐藏**，改配置不改代码。
- 字段 schema 与筛选 schema 同源，服务端统一计算，前端 Widget 按 schema 渲染。
- 未授权字段不下发数据（白名单投影），替代 `CONTACT_KEYS` 黑名单递归删除。

## 2. 字段定义 schema

```text
{
  key: 字段键（与数据 payload 键一致）
  label: 显示名
  section: 所属分区（客户资料用）/ 列分组（列表用）
  kind: 'column' | 'detail' | 'form' | 'filter'
  sortOrder: 显示顺序
  visibility: {                // 全部满足才可见；缺省 = 始终可见
    roles?: ['admin','manager','sales'],
    permissions?: ['view_contacts', ...],
    features?: ['ai_stations', ...],   // 与 crm_ai_feature_flags 键一致
  },
  editable: {                   // 表单可编辑条件（缺省 = 不可编辑）
    roles?: ['admin','manager'],
    permissions?: ['edit_customer', ...],
  },
  sensitive: true,              // 未授权时不下发数据（白名单投影）
  redactWhenMissing: false,     // 无权限时整块区域隐藏而非显示占位
}
```

## 3. 可见性解析规则（服务端，单一实现）

```text
effective(field, ctx) =
  (roles 缺省 || ctx.user.role ∈ roles)
  && (permissions 缺省 || 全部 permission ∈ ctx.permissions)
  && (features 缺省 || 全部 feature ∈ resolveFeatureState(db).effectiveEnabled)
```

- 逐页、逐用户计算，输出 `fieldKey -> { visible, editable }`。
- 与筛选 schema 共用 `effectiveFilterSchemaFor` 的版本机制：字段版本变化返回 `FIELD_SCHEMA_VERSION_CONFLICT`（新增错误码）。
- AI 相关字段的 features 值来自现有 `feature_flags.js`（`ai_stations`、`customer_enrichment`、`sales_pack` 等），不新建开关。

## 4. 字段目录（按页面）

> 字段键均取自最新代码实际 payload，见证据列。

### 4.1 线索池（intake / lead_flow）

数据源：`lib/intake_flow_filters.js queryIntakeFlowPage`（`crm_intake_items i` + `assigned_owner_name/suggested_owner_name`），无 `view_contacts` 时 `redactContactFields`。
前端硬编码渲染点：`sales-assets/app.js renderIntake()`（约 1762-1860 行）。

| key | 标签 | kind | 可见性 | editable | sensitive | 证据 |
|---|---|---|---|---|---|---|
| company_name | 公司 | column/detail | - | - | - | `renderIntake` businessColumns[0] |
| external_customer_id | 客户ID | column/detail | - | - | - | 同上 |
| country | 国家 | column/detail | - | - | - | `item.country` |
| city | 城市 | column/detail | - | - | - | 同上 |
| website | 官网 | column/detail | - | - | - | `websiteMarkup` |
| industry | 行业 | column/detail | - | - | - | 同上 |
| customer_type | 客户类型 | column/detail | - | - | - | 同上 |
| product_focus | 产品需求 | column/detail | - | - | - | `productChipMarkup` |
| batch_id | 来源批次 | detail | - | - | - | `批次 ${batch_id}` |
| updated_at | 更新时间 | detail | - | - | - | `更新 ${shortDate(...)}` |
| contact_level | 联系人等级 | column/detail | view_contacts | - | 是 | `pill ${contact_level}` |
| contact_name | 具名联系人 | column/detail | view_contacts | - | 是 | `item.contact_name` |
| contact_title | 职位 | detail | view_contacts | - | 是 | `item.contact_title` |
| contact_methods | 联系方式 | column/detail | view_contacts | - | 是 | `item.contact_methods` |
| status | 线索状态 | column/detail | - | - | - | `statusMarkup` |
| assigned_owner_name | 分配销售 | column/detail | - | - | - | `item.assigned_owner_name` |
| suggested_owner_name | 建议销售 | detail | - | - | - | `showAI ? suggested_owner_name` |
| decision_reason | 分配/阻断原因 | column/detail | - | - | - | `decision-stack` |
| return_reason | 退回原因 | detail | - | - | - | `item.status==='returned'` 条件显示 |
| claim_due_at | 领取截止 | column/detail | - | - | - | `领取截止 ...` |
| crm_assignment_status | CRM 状态 | detail | - | - | - | `CRM：已领取/待领取/已退回` |
| fit_score | Fit 评分 | column/detail | features.ai_stations | - | - | `signals.fitScore`（AI 关闭时回退 match_score） |
| fit_grade | Fit 等级 | column/detail | features.ai_stations | - | - | `signals.fitGrade` |
| readiness | 联系就绪度 | detail | features.ai_stations | - | - | `signals.readiness` |
| priority | 优先级 | detail | features.ai_stations | - | - | `signals.priority` |

> 注意：`fit_score/fit_grade` 在 AI 关闭时应回退到非 AI 字段 `match_score/match_group`——这是“AI 零改动 + 字段自由显示”的兼容规则，试点时必须保留。

### 4.2 客户资料（profile，含客户/线索/回收三来源）

数据源：`lib/db.js getCustomerProfileData` -> `customerPool[0]`（`buildPoolCustomer`）+ `customers`（历史跟进）+ `reconResults` + `people` + `profileAccess`。
前端硬编码渲染点：旧版 `Index.html` 内嵌脚本 `renderPoolDetails()` 等（资料页四段：身份与地区 / 业务画像与产品需求 / 联系渠道 / 合规来源与生命周期）。

| key | 标签 | section | kind | 可见性 | editable | sensitive |
|---|---|---|---|---|---|---|
| customer_id | 客户ID | 身份与地区 | detail | - | - | - |
| company_name | 公司名称 | 身份与地区 | detail | - | edit_customer | - |
| russian_name | 俄文名称 | 身份与地区 | detail | - | edit_customer | - |
| english_name | 英文名称 | 身份与地区 | detail | - | edit_customer | - |
| country | 国家 | 身份与地区 | detail | - | edit_customer | - |
| city | 城市 | 身份与地区 | detail | - | edit_customer | - |
| website/domain | 官网 | 身份与地区 | detail | - | edit_customer | - |
| inn | INN | 身份与地区 | detail | - | - | - |
| sanction_status | 制裁状态 | 身份与地区 | detail | - | - | - |
| industry | 行业 | 业务画像 | detail | - | edit_customer | - |
| customer_type | 客户类型 | 业务画像 | detail | - | edit_customer | - |
| description | 简介 | 业务画像 | detail | - | edit_customer | - |
| products | 产品需求 | 业务画像 | detail | - | edit_customer | - |
| rating | 评级 | 业务画像 | detail | - | - | - |
| current_pool | 当前分组 | 业务画像 | detail | - | - | - |
| risk_status | 风险状态 | 业务画像 | detail | - | - | - |
| email | 邮箱 | 联系渠道 | detail | view_contacts | - | 是 |
| phone | 电话 | 联系渠道 | detail | view_contacts | - | 是 |
| contact_count | 联系人数量 | 联系渠道 | detail | view_contacts | - | 是 |
| best_contact_level | 最优联系人等级 | 联系渠道 | detail | view_contacts | - | 是 |
| best_person_id | 最优联系人 | 联系渠道 | detail | view_contacts | - | 是 |
| sales_ready_contact_count | 可交付联系人 | 联系渠道 | detail | view_contacts | - | 是 |
| contact_recon_status | 联系人背调状态 | 来源与生命周期 | detail | view_contacts | - | 是 |
| contact_last_checked_at | 联系人检查时间 | 来源与生命周期 | detail | view_contacts | - | 是 |
| deep_report | 深度报告 | 来源与生命周期 | detail | view_recon | - | 是 |
| source_file | 来源文件 | 来源与生命周期 | detail | view_recon | - | 是 |
| first_found | 首次发现 | 来源与生命周期 | detail | - | - | - |
| last_found | 最近发现 | 来源与生命周期 | detail | - | - | - |
| search_count | 搜索次数 | 来源与生命周期 | detail | - | - | - |
| verified | 已验证 | 来源与生命周期 | detail | - | - | - |
| notes | 备注 | 来源与生命周期 | detail | - | edit_customer | - |
| created_at | 创建时间 | 来源与生命周期 | detail | - | - | - |
| updated_at | 更新时间 | 来源与生命周期 | detail | - | - | - |
| profileAccess.read_only | 只读状态 | 资料头部 | widget | - | - | - |
| profileAccess.source | 来源（crm/intake/recycle） | 资料头部 | widget | - | - | - |
| profileAccess.status | 状态 | 资料头部 | widget | - | - | - |

AI 资料块（`AI评价标签`、AI 标注、评估 AI 摘要等）统一为 `features.ai_stations` 门控字段组，登记为可隐藏的 widget，不进入核心字段目录实现。

### 4.3 CRM 客户列表（customers）

数据源：`lib/sales_crm.js listCustomerAccounts`（`crm_accounts` + `customer_pool` 合并 + `owner_name/creator_name` + `customerTags`）。
前端硬编码渲染点：`sales-assets/app.js renderCustomers()`（列头 + 行渲染）。

| key | 标签 | kind | 可见性 | editable | sensitive | 证据 |
|---|---|---|---|---|---|---|
| company_name | 公司 | column | - | - | - | 列表主列 |
| nickname | 昵称 | column | - | edit_customer | - | 搜索提示含昵称 |
| external_customer_id | 客户ID | column | - | - | - | - |
| country | 国家 | column | - | - | - | - |
| city | 城市 | column | - | - | - | - |
| website | 官网 | column | - | - | - | - |
| industry | 行业 | column | - | - | - | - |
| customer_type | 客户类型 | column | - | - | - | - |
| product_focus | 主推产品 | column | - | - | - | - |
| priority | 优先级 | column | - | - | - | - |
| potential_value | 潜在价值 | column | - | - | - | - |
| stage | 阶段 | column | - | - | - | STAGE_LABELS |
| owner_name | 负责人 | column | - | - | - | 列表 owner |
| creator_name | 创建人 | column | view_all_customers | - | 是 | filter_catalog creator 同款门控 |
| next_action | 下一步 | column | - | - | - | - |
| next_action_at | 下一步时间 | column | - | - | - | - |
| last_activity_at | 最近动作 | column | - | - | - | - |
| assignment_status | 分配状态 | column | - | - | - | - |
| lifecycle_status | 生命周期 | column | - | - | - | - |
| customerTags | 客户标签 | column | 按 tagCategory 权限 | - | 部分 | 标签类别授权（同 `allowedCustomerTagCategories`） |

## 5. 服务端 API 形态（草案）

```text
GET /api/sales-crm/field-schema/:pageKey
  -> { pageKey, version, fields: [{ key, label, section, kind, sortOrder, editable, ... }] }

列表/资料接口响应头或 body 附带 fieldSchemaVersion：
  版本不匹配 -> 409 FIELD_SCHEMA_VERSION_CONFLICT（前端重新拉取 schema 与数据）
```

- `pageKey` 取值与现有 `/filter-schema/:pageKey` 对齐：`customers/intake/lead_flow/pipeline/alerts/insights/recycle_bin/contacts/recon/profile`。
- 初期字段目录为服务端静态配置（`FIELDS_CATALOG`），后续可选管理员配置界面与用户级偏好覆盖。

## 6. 数据投影（替换 CONTACT_KEYS）

- 构造响应时按 effective schema 计算下发字段：`sensitive && !visible` 的字段**从 payload 删除**（含嵌套对象/数组），替代 `redactContactFields` 黑名单。
- `CONTACT_SAFE_POOL_KEYS` / `CONTACT_SAFE_RECON_KEYS` 白名单语义并入字段目录（`sensitive: true` + 对应 permission）。
- 过渡期：字段目录全量建成前，`redactContactFields` 保留为兜底，两套逻辑用同一测试夹具断言结果一致。

## 7. 试点顺序（首个切片）

1. **线索池（intake/lead_flow）字段目录** + `/field-schema/intake`。
2. `renderIntake()` 改为按 schema 渲染列，字段显隐走配置。
3. 保持现有 `view_contacts` 门控与 AI 回退（`fit_score` -> `match_score`）行为不变，专项测试断言前后渲染一致。
4. 通过后扩展到客户资料、客户列表。

## 8. 验收门

- 三角色 + 开关组合下，字段可见性 = 配置声明，与现状一致（快照对比）。
- 未授权 sensitive 字段不在响应中出现（白名单投影测试）。
- `FIELD_SCHEMA_VERSION_CONFLICT` 语义与 `FILTER_VERSION_CONFLICT` 一致。
- AI 关闭时 AI 字段组不显示且不报错（回退字段生效）。
- 后续前端 issue 改字段显示只需改目录配置或用户偏好，不改 `app.js`。

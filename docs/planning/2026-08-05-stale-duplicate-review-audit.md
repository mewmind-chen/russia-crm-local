# 旧版查重误判永久阻断线索分配

## 问题

线索池中有 15 条业务状态为“待分配”的线索显示“待管理层查重核验”，因此复选框禁用、无法分配。

这不是前端假字段：`crm_intake_items.duplicate_state='review'` 会真实阻断分配，且系统已有“客户保护与查重”处理入口。但这些记录全部由旧规则 `legacy-v1` 于 2026-07-31 生成，升级到 `duplicate-v2` 后从未自动重算，因此形成永久遗留阻断。

## 生产只读证据

- pending review：15
- created_rule_version：全部 `legacy-v1`
- evaluated_rule_version：全部 `legacy-v1`
- decision_reason：全部“资料已提交管理层核验”
- 生产数据库仅做只读查询，真实数据未修改

旧候选示例：

- Pyrotec (`pyrotec.com.br`) -> DBTEC，0.750，`fuzzy_domain`
- Vaportec (`vaportec.com.br`) -> DBTEC，0.720，`fuzzy_domain`
- Unitek (`unitek.ind.br`) -> DBTEC，0.741，`fuzzy_name`
- ECNC (`ecnc.com.br`) -> DBTEC，0.762，`fuzzy_domain`
- EMS-Expert (`ems-expert.ru`) -> SMD Эксперт，0.750，`fuzzy_domain`
- Electronika+ (`electronicaplus.ru`) -> Ruselectronics / PT Electronics

## 隔离副本核验

使用 SQLite online backup 创建生产数据库隔离副本，并通过应用现有
`POST /api/sales-crm/duplicate-reviews/recalculate` 接口按 `duplicate-v2` 重算：

- examinedCount：15
- releasedCount：15
- retainedCount：0
- exactCount：0

15 条均无同注册主域名、同规范名称或其他可靠交叉证据，不是真重复客户。副本中均转为：

- review status：`confirmed_distinct`
- intake status：`approved`
- duplicate_state：`cleared`
- resolution_source：`rule_recalculation`

## 根因

新版规则和人工重算闭环已存在，但旧版本 pending review 仅能依赖管理员手动点击“按新规则重算”。部署新版规则时没有幂等升级旧记录，导致旧误判长期阻断线索分配。

## 修复范围

- 启动/部署时自动重算尚未由当前规则评估的 pending review。
- 无可靠候选时自动放行并恢复勾选、分配能力。
- 同域名、同规范名称、受保护客户精确命中或有可靠交叉证据时继续阻断。
- 已由当前规则评估的 pending review 不做自动重复处理。
- 保留审计记录，不修改 `crm_manager_interventions`。
- 不通过手写 SQL 修改生产业务数据；随合并版本运行应用的幂等升级。

## 验收

- 上述 15 条旧误判全部可勾选并可分配。
- 真正重复客户仍显示查重核验并无法分配。
- 自动升级可重复启动且第二次不再处理任何记录。
- 无处理权限账号不获得查重候选详情。
- 全量测试及 release gate 通过。

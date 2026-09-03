# Session Checkpoint：非 AI、非生产重构收尾大目标清单

日期：2026-09-03（Asia/Shanghai）
目标：把当前可执行的剩余项统一收口为可验证完成或明确冻结决定
工作区：`after/`，分支 `codex/frontend-widget-pilot`

## 1. 权威基线

| 证据 | SHA/状态 |
|---|---|
| 中心 clone `repo/` 的 `origin/main` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `current/.release-sha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 `state/state.json.lastSuccessfulSha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| `after/` 当前 HEAD | `9eb20c4c282b4a7b95c4827cb0d52be6db49cd5e` |
| 当前全量证据 | `node --test` 2143/2143；`npm test` 1781/1781 |

三份基线一致。生产目录只读；`.impeccable/` 为预存在的未跟踪工具目录，不属于本目标改动。

## 2. 已完成，不再重复实现

| 领域 | 当前证据 |
|---|---|
| 阶段 A | 44 个 domain 文件中 41 个已接线；3 个按用户裁定保持内联/精简 |
| 阶段 B 业务侧 | 状态/计划/主管写点、守卫、投影、回收/恢复不变量和 smoke basis 已收口 |
| 阶段 D | intake/assignment/planning/commerce 以及非 AI manager intervention/deferred plan 已完成 |
| 阶段 E | customerProfile widget、统一 List widget、用户布局/排序、抽屉注册表、浏览器双角色验收已完成 |
| 阶段 G | 兼容入口和路由注册器装配完成；高耦合边界已完成首轮审计 |
| S4/P4 动态字段 | `e030900` 已收口 account/commerce/timeline 的对象、数组和 JSON 文本递归联系人边界 |

## 3. 本大目标的可执行剩余项

### C：权限、字段与复合读取

1. 对 `raw recon`、`people`、`prospect`、`templates`、`reconJobs`、`contactReconJobs` 等
   `SELECT *`、公共 spread、动态 JSON/自由文本后代建立统一风险矩阵。
2. 为每个非 AI 读取形状补齐结构、递归泄漏、blacklist≡whitelist 和真实端点角色行为契约；
   只有稳定键集、嵌套等价和自由文本风险均可证明时，才接线独立叶子白名单。
3. 对 P1/P3、S4/P4、S6/P2 顶层 composite 形成“可迁移/继续递归保留”的明确决定；在证据
   不足时继续保留 `redactIntakeAggregate`/`redactContactDynamicFields`，不创建
   `contactSafeBootstrapPayload` 或 `contactSafeRecycleProfilePayload`。

### B/D：状态与业务一致性

1. 审计 `state_projection` 与前端裸字段消费是否仍存在语义漂移；当前 WIP 裁定已移除 state
   DTO，若无实际漂移则用契约和治理记录关闭，不恢复第二套状态模型。
2. 复核 manager intervention、deferred plan、today-task 的权限、范围、幂等、事务和生命
   周期边界；已完成的用例只补缺失证据，不重复拆分。

### G：高耦合保留边界

为资料聚合、迁移复核、入库/评价、认证/密码等原位边界补齐接口/服务契约和最小回归证据，
明确保留原因、输入输出和回滚点；不进行机械拆分或改变事务生命周期。

### API 与治理

1. 补齐非 AI 核心 API 的方法/路径、认证、角色权限、数据范围、字段可见性、请求/响应、
   错误码、写入表、审计、幂等和兼容约束矩阵。
2. 校准 `CURRENT_STATE.md`、`REFACTOR_ROADMAP.md`、`RISK_REGISTER.md`、`API_CONTRACTS.md`
   与自动看板的当前状态，历史 checkpoint 保持原样并明确标记。
3. 对现有 npm audit/架构风险做只读评估；没有独立兼容性证据时不升级依赖。

## 4. 明确冻结，不计入“未完成实现”

- `lib/ai_stations/**`、`assistant.js`、`/api/assistant/*`、AI 专用 UI、`crm_ai_*`、
  `CRM_AI_*` 和既有 AI 触发/写点：只做边界核验，不修改、不迁移、不恢复。
- 生产目录、生产数据库、部署、UAT、push、merge 和发布：本目标不执行。
- `identity/index`、`identity/middleware`、`filter/index`：按用户裁定保持内联/精简。
- 顶层复合白名单及高耦合 `SELECT *`：没有逐键、嵌套和行为等价证据前继续冻结。
- `last_activity_at`：继续按活动溯源规则处理，不擅自纳入状态网关。

## 5. 完成定义

每个可执行项必须有风险矩阵、契约测试、专项/全量证据、可回滚提交和治理记录；最终复核
双基线仍一致，`node --test`、`npm test`、治理权威、AI 边界、语法和差异门禁全绿。只有
明确冻结并有证据的项才可从“剩余”移到“已关闭”；本清单不把本地完成描述为生产完成。

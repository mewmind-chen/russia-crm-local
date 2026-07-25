# A4-01 经理异常与通知中心验收证据

日期：2026-07-25

## 范围

- 新增 `manager_anomaly@v1` 严格结构化合同。
- 服务端在经理授权客户范围内确定性扫描：
  - 会议后 7 天无 RFQ；
  - RFQ 超过 24 小时未报价；
  - 报价后 3 天无客户回复；
  - 高价值客户超过 7 天未推进；
  - 团队活跃客户负荷不均。
- AI 只解释服务端已经确认的异常、生成优先分和中文干预建议。
- AI 结果保持 `reviewRequired=true`，不修改客户阶段、金额、负责人、活动或介入状态。
- 经理异常结果生成后创建接收人网页通知。
- 补齐 A3-04 遗漏的用户可见通知中心：侧边栏和顶部未读入口、通知列表、渠道降级、
  本人已读操作、关联客户和经理异常跳转、桌面与手机布局。
- 所有员工可见的结构化 AI 解释、摘要、理由和建议强制使用简体中文；自由问答和经理评价
  同步增加中文约束。专有名词、枚举、ID、模型名和明确要求的客户外发草稿可保留原语言。

## 权限和安全

- 扫描范围完全取自服务端 `accessContext.accountIds`。
- 异常 ID、异常代码、客户 ID 和证据 ID 均执行服务端白名单校验。
- 销售无法读取或执行经理异常任务，也无法从通用 AI 任务列表和详情绕过。
- 经理可以查看授权范围内的团队通知，但只能标记本人接收的通知为已读。
- 企微失败或未配置时，网页通知保持可见和可处理。

## 验证结果

- A4-01、通知中心及权限聚焦测试：`26/26`。
- 全部 AI 回归：`214/214`。
- 完整 Node 回归：`503/503`。
- JavaScript 语法检查、JSON Schema 解析和 `git diff --check`：通过。
- 浏览器桌面端 `1440x900` 和手机端 `390x844` 验收通过：
  - 通知未读数按本人计算；
  - 标记已读后未读数立即更新；
  - 通知可打开关联客户；
  - 经理不能替团队成员标记已读；
  - 页面无横向溢出、元素重叠或控制台错误。

## 发布状态

- 分支：`codex/a4-01-manager-anomaly`
- 实现提交：`5e7f690`
- PR：[#79](https://github.com/mewmind-chen/russia-crm-local/pull/79)
- 合并提交：`a7f2841c8edcbe534e44ce8c3628873b764e224a`
- 生产 current：`releases/a7f2841c8edc`
- 生产 previous（回滚点）：`releases/cc4ea9b0d552`
- 部署前 SQLite online backup：
  `state/backups/crm-before-a7f2841c8edc-20260725T074542Z-93149.db`
- 备份 SHA-256：
  `93eafc498bba9844823b5eb9e0c74eb41a1bd111c46bed1fac413529bcd510ad`
- 备份权限/大小：`0600` / `44015616` bytes
- 生产数据库与备份 `quick_check`：`ok`
- 生产数据库 journal mode：`wal`
- GitHub CI 和生产隔离验证：`503/503`，全部语法检查通过
- local/public `healthz`：`200`、`database=ok`、SHA 均为 `a7f2841c8edc...`
- server、AI Station Worker 和自动部署服务状态正常，部署状态无失败记录
- 生产四个 AI 开关：`ai_stations=1`、`customer_enrichment=1`、
  `customer_enrichment_auto_trigger=1`、`sales_pack=1`
- 生产首页与静态资源已包含通知中心、`manager_anomaly` API 和 `20260725-16` 资源版本

## 结论

A4-01 的经理异常、中文输出、通知中心、权限隔离和生产发布门均已完成。项目进度更新为
`32/38`，下一项为 A4-02 `sales_coaching`；本轮不实现 A4-02。

# Issue #173 三角色端到端验收证据

## 基线与范围

- 源码基线：`d3f6633506c09ba6ef31254d24771af5abce32a7`
- 生产 release：`d3f6633506c09ba6ef31254d24771af5abce32a7`
- 回滚 release：`a5e54d0278d59ad852c36cc4e43abdde6af0a3cd`
- #104 不在本轮范围。
- 所有自动写入验收使用临时 SQLite 数据库；生产只执行受控 test customer 冒烟。

## 销售流程

隔离账号只看到本人客户。记录真实电话动作并形成下一步后，活动、系统推导的 `contacted` 阶段、最近动作、下一步和刷新后的 bootstrap 保持一致。重复提交只形成一条活动；对他人客户请求返回 403。过去时间、接口错误和输入保留由 #149、#157、#170 专项测试共同覆盖。

## 主管流程

同一客户创建两个不同原因的主管任务。主管完成其中一个原因后，仅该任务变为 completed，另一个仍为 open；按未完成状态筛选刷新后不再返回已完成原因。相同幂等键重放只保留一条 intervention 和一套审计事实。

## 老板流程

老板可读取最近 7 天、30 天和服务端事务游标管理的“自上次查看以来”，并下钻客户、待办和事实时间线，按同一授权口径导出 JSON/CSV。销售直接访问团队汇总返回 403，只能读取本人协作范围，响应不含分配原因、候选、排除原因或额度。

## 浏览器与移动端

- 角色：老板、主管、销售。
- 宽度：1280、430、390、375、320px。
- 结果：老板/主管看到业务推进、销售能力、协作支持；销售仅看到协作支持。
- 页面级横向溢出：全部为 0；仅页签容器允许横向滚动。
- AI hard gate 关闭：AI 导航和团队 AI 辅导内容 `display:none`。
- 写开关关闭：协作补记、更正、撤销和补充入口隐藏，服务端拒绝旧页面写请求。
- 控制台：无 error/warning。

## 自动化证据

- #149/#157/#170/#171/#173/#174/AI hard gate 专项：251/251 通过。
- 完整串行测试：1155/1155 通过，`fail 0`。
- PR #201、#202、#203 CI 和最终 main CI 均成功。

## 生产发布

- 部署备份：`/Users/ylf/Desktop/projects/tradepulse-production/state/backups/crm-before-d3f6633506c0-20260802T051204Z-35423.db`
- 备份：`quick_check=ok`、`integrity_check=ok`、foreign key 无异常。
- 活动库：`integrity_check=ok`、foreign key 无异常。
- 本地和公网 `/healthz` 均返回目标完整 SHA，双 release gate 通过。
- #174 受控冒烟追加 original、supplement、correction、revocation，各有对应 audit，最终测试链为 revoked。
- `CRM_TEAM_STATUS_WRITES_ENABLED=true`，重启后再次通过双 release gate。

## 回滚判断

当前 schema 为只增不删，#174 写入开关已开启并已产生受控测试链。代码回滚可切换 `previous` 并重启；数据库恢复必须在维护窗口人工执行，不能只切 symlink 后声称数据库已回滚。

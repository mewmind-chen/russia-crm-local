# 上线前准备包（非 AI、非生产）

更新时间：2026-09-03
状态：**NO-GO（候选尚未进入远端，依赖高风险尚未处置）**

本文件是上线前准备的发布清单、验收矩阵、只读数据保护流程和决策记录。
它只描述如何形成可审计、可复现、可回滚的 release candidate；本次没有 push、merge、UAT、
部署或生产写入。

## 1. 双基线与候选身份

发布决策始终以三份实时证据为准，不能引用归档计划中的计数：

| 项目 | 读取位置 | 2026-09-03 核验值 |
|---|---|---|
| 远端基线 | `repo/` 的 `origin/main` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产 release | `tradepulse-production/current/.release-sha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 生产成功状态 | `tradepulse-production/state/state.json:lastSuccessfulSha` | `57c4c42a89e7730545b726b29fd932c5bfb20574` |
| 本地候选 | `after/` 的 `git rev-parse HEAD` | 运行 preflight 时实时读取，不手填 |

候选 SHA 不在文档中硬编码：文档提交会改变 Git SHA，最终候选必须由同一工作树的 preflight
报告记录。生成命令：

```bash
cd /Users/ylf/Desktop/projects/tradepulse-refactor/after
CANDIDATE_SHA="$(git rev-parse HEAD)"
npm run release:preflight -- \
  --candidate-sha "$CANDIDATE_SHA" \
  --report "/absolute/path/to/release-preflight-${CANDIDATE_SHA}.log" \
  --audit-report "/absolute/path/to/npm-audit-${CANDIDATE_SHA}.json"
```

`release-preflight.sh` 只读 `repo/` 的远端引用和生产的两个 SHA 文件；它不会调用部署脚本、
服务重启命令、合并/推送命令，也不会打开生产数据库。

## 2. 发布清单（manifest）

候选报告必须包含以下字段，缺一不可：

| 字段 | 规则 |
|---|---|
| candidateSha | 40 位小写 SHA，且等于执行报告时 `after/HEAD` |
| remoteMainSha / productionReleaseSha / productionLastSuccessfulSha | 三者必须一致；不一致立即暂停 |
| changedFiles | `remoteMain...candidateSha` 的完整文件清单 |
| codeChanges | 列表 widget、统一客户资料、权限/字段/脱敏、状态/经理/今日待办、兼容入口和路由装配的提交与测试证据 |
| databaseChanges | 本候选不执行生产迁移；若未来有 schema 变化，必须附副本 dry-run、schema fingerprint、备份 SHA 和回滚演练 |
| configChanges | 只记录候选需要的配置；生产 secrets、AI 开关和运行时目录不纳入候选变更 |
| freezeList | `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*`、生产目录、UAT、push/merge/deploy 均冻结 |
| dependencyAudit | `npm audit --omit=dev --json` 原始报告、处置决定和回归证据 |
| rollbackRef | 候选前一份可启动 release 的 SHA、`current`/`previous` 链接和数据库备份 provenance |

当前实现候选的变更面仍只在 `after/`；没有数据库迁移提交，也没有生产配置写入。
依赖风险已知但尚未消除：`fast-uri` 链为 1 high，`qs`/`body-parser`/`express` 链为 3 moderate。
此前的只读评估决定暂不盲目升级；因此本 manifest 的发布结论必须保持 NO-GO，直到完成兼容回归
并获得明确风险接受或修复证据。

## 3. 可重复 preflight 门禁

`npm run release:preflight` 按固定顺序检查：

1. 候选 SHA、`origin/main`、生产两个 SHA 和祖先关系；候选未发布到 `origin/main` 时阻断。
2. `after/` 工作树清洁（预先存在的 `.impeccable/` 工具目录不计入业务变更）。
3. 输出相对远端的完整变更清单，阻止 AI、生产数据、secret 路径，提示 package manifest 变更。
4. committed/working-tree `git diff --check`、JavaScript `node --check`、治理权威和 AI 边界。
5. `npm test` 与串行 `node --test` 全量套件；`--skip-tests` 永远只能得到 NO-GO。
6. `npm audit --omit=dev --json`；high/critical 阻断，moderate 形成警告并要求处置记录；用
   `--audit-report` 将原始 JSON 另存到非生产目录。

报告结尾只有 `RESULT: GO` 或 `RESULT: NO-GO`。NO-GO 报告仍是有效证据，必须保留 blockers，
不能用“测试通过”覆盖发布阻断。

## 4. 非 AI 功能验收矩阵

| 验收域 | 必须验证的行为 | 证据/门槛 |
|---|---|---|
| 所有列表页 | 用户可在授权字段范围内选择显隐、拖动顺序、升降序和多级排序；偏好按用户保存；schema 变化安全回退 | List widget 契约、各 pageKey 列表专项测试、`node --test` |
| 线索池/客户全景/客户资料 | 数据库已有客户资料按授权完整呈现；统一资料 widget 与旧资料语义一致；旧入口只在显式兼容开关下工作 | profile/intake/legacy shape 契约、Phase E 浏览器验收 |
| 权限与字段 | `view_contacts`、客户/团队范围、字段 schema、筛选和导出投影一致；越权 fail-closed | API_CONTRACTS、permission/filter/shape 契约 |
| 递归脱敏 | `developmentHistory.lastActivitySummary`、`complementaryInfo` 任意 JSON、`arbitration` 动态嵌套不泄漏联系人/凭据 | P1/P3、S4/P4、S5/P5 递归测试 |
| 状态与流程 | stage、lifecycle、assignment、owner、next action、manager intervention/deferred plan/today task 投影一致；写入经 gateway | Stage B/D `83/83` 组合证据与 `npm test` |
| 旧入口兼容 | canonical `/`、`/legacy`、`/tradelead-v2.html`、`development-workbench` 的开关、权限、错误码和 iframe/widget 边界保持 | 阶段 G 路由矩阵、Phase E 双角色浏览器验收 |
| 高耦合边界 | 资料聚合、迁移复核、密码、入库/评价及事务 preview/review 不做机械白名单迁移 | service/API contract；若变更需另立切片 |
| AI 与生产隔离 | AI runtime/UI/触发点无改动；生产目录只读；本目标不执行 UAT、部署、push/merge | `check:ai-boundary`、敏感路径门禁、双基线核验 |

## 5. 生产只读数据保护与回滚 runbook

以下步骤是未来获得明确生产授权后的操作清单，本次只固化路径和验收条件，没有执行：

1. **备份**：先停止写入口并使用 approved backup 目录；对显式数据库路径执行 SQLite online
   backup，记录备份文件的绝对路径、SHA-256、size、mtime、inode/device、`quick_check`、
   `integrity_check`、`foreign_key_check`，且备份旁不得有可疑 `-wal/-shm` 残片。不得复制正在变化
   的 WAL，也不得覆盖原库。
2. **schema/迁移 dry-run**：只在备份副本或隔离 runtime 上执行 `node scripts/migrate-unified-crm.js`
   （默认 dry-run）和候选初始化/迁移检查；记录完整 `sqlite_master` fingerprint、表/索引/视图/触发器
   差异和行数对账。任何 dry-run 失败都不能进入维护窗口。
3. **发布后健康检查**：使用既有 `scripts/verify-release-gate.sh`，显式传入 health URL、候选
   SHA 和绝对数据库路径；要求 health JSON 的 `ok/database/releaseSha` 匹配，并通过 SQLite 两项检查。
4. **回滚**：若健康检查、页面验收或数据对账失败，停止写入口，原子切回 `previous` release；
   如 schema/数据已写入且不兼容，使用带 provenance 的 pre-release backup 整体恢复，再做完整健康检查。
   回滚不得依赖“重新跑迁移”来猜测数据状态。
5. **证据归档**：保存候选 SHA、preflight、backup manifest、dry-run、健康检查和回滚结果；只有
   全部证据齐全且没有 blocker，才允许另行评审 GO。

## 6. GO/NO-GO 决策

当前结论：**NO-GO**。

- 功能和治理证据已具备：此前 `npm test` `1786/1786`、`node --test` `2148/2148`、Stage B/D `83/83`、
  raw shape `16/16`、治理权威、AI 边界和浏览器验收均通过。
- 发布仍被两项硬条件阻断：本地候选尚未进入 `origin/main`；生产依赖审计仍有 1 high 和 3 moderate。
- 需要用户/发布负责人明确授权的动作：依赖修复或风险接受、push/merge、生产备份、维护窗口、UAT、
  部署和回滚执行。它们不属于本目标的自动动作。

下一个可执行动作不是直接上线，而是在依赖风险决策明确后，重新生成干净工作树的 preflight 报告；
只有报告为 GO 且候选已审阅，才进入单独的发布执行目标。

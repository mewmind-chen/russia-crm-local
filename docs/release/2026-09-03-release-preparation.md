# 上线前准备包（非 AI、非生产）

更新时间：2026-09-03
状态：**GO（授权发布已完成；生产门禁通过）**

本文件是上线前准备的发布清单、验收矩阵、只读数据保护流程和决策记录。
它记录如何形成可审计、可复现、可回滚的 release candidate，以及本次获得授权后的发布结果。
本次未执行数据库迁移或 AI 操作；生产部署仅由既有自动发布链完成。

## 1. 双基线与候选身份

发布决策始终以三份实时证据为准，不能引用归档计划中的计数：

| 项目 | 读取位置 | 2026-09-03 核验值 |
|---|---|---|
| 远端基线 | `repo/` 的 `origin/main` | 执行时实时读取（本次授权发布证据：`81812031dbbd904e7cc9aefa6ce1606401572c61`） |
| 生产 release | `tradepulse-production/current/.release-sha` | 执行时实时读取（本次授权发布证据：`81812031dbbd904e7cc9aefa6ce1606401572c61`） |
| 生产成功状态 | `tradepulse-production/state/state.json:lastSuccessfulSha` | 执行时实时读取（本次授权发布证据：`81812031dbbd904e7cc9aefa6ce1606401572c61`） |
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

远端集成已按授权完成：`origin/main` 从 `57c4c42a89e7730545b726b29fd932c5bfb20574`
fast-forward 到候选 `81812031dbbd904e7cc9aefa6ce1606401572c61`。

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

当前实现候选的变更面仍只在 `after/`；没有数据库迁移提交，也没有生产配置写入。依赖修复已在
隔离副本、远端候选和生产 release 中完成。

当前处置基线（每次发布前需重新核验）：

- `fast-uri` 高风险来自 `ajv@8.20.0` 的间接依赖；锁文件由 `3.1.4` 固定到 `3.1.7`。
- `qs` 的两个 moderate advisories 覆盖 `>=2.2.5 <6.16.0` 与 `>=6.14.2 <=6.15.3`；
  `express@4.22.2 -> body-parser@1.20.6 -> qs@6.16.0` 通过受控 overrides 固定。
- `body-parser` 已由 `1.20.5` 更新到 `1.20.6`；Express 主版本保持 `4.22.2`，避免改变冻结 AI
  路由的 `req.query` 语义。
- 隔离副本证据：Express 4 + overrides 的 `npm audit` 为 0，串行 core `1791/1791`、repository
  `2150/2150`、路由/分页专项 `11/11`。Express 5.2.1 虽能改善依赖链，但 repository 为 `2149/2150`，
  `issue205_pagination_backend` 的 AI task center pageSize 从预期 50 变为 20；AI 面冻结，故明确拒绝。

因此不执行无审查的 `npm audit fix` 或 Express 5 升级。Express 4 受控 overrides 已随候选发布，
生产 `npm audit --omit=dev` 为 0。

## 3. 可重复 preflight 门禁

`npm run release:preflight` 按固定顺序检查：

1. 候选 SHA、`origin/main`、生产两个 SHA 和祖先关系；候选未发布到 `origin/main` 时阻断。
2. `after/` 工作树清洁（预先存在的 `.impeccable/` 工具目录不计入业务变更）。
3. 输出相对远端的完整变更清单，阻止 AI、生产数据、secret 路径，提示 package manifest 变更。
4. committed/working-tree `git diff --check`、JavaScript `node --check`、治理权威和 AI 边界。
5. `npm test` 与项目标准并发模式的 `node --test` 全量套件；`--skip-tests` 永远只能得到 NO-GO。
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
| AI 与生产隔离 | AI runtime/UI/触发点无改动；生产写入仅限既有发布器的 release/backup/state 操作；数据库迁移与 AI 仍冻结 | `check:ai-boundary`、敏感路径门禁、双基线核验 |

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

## 6. 本次授权执行结果

- 推送：`git push origin HEAD:main` 成功（`57c4c42 -> 8181203`）。
- 发布：既有 `com.russia-crm.auto-deploy` 通过候选验证后完成切换；`current` 指向
  `releases/81812031dbbd`，`previous` 保留 `releases/57c4c42a89e7`。
- Preflight：19 pass、0 warning、0 blocker，`RESULT: GO`；core 与 repository 全量测试分别为
  `1791/1791`、`2150/2150`，候选和生产 `npm audit --omit=dev` 均为 0。
- 发布后健康：本地和公网 `/healthz` 均返回 `ok=true`、`database=ok`、release SHA 匹配；
  `verify-release-gate.sh` 通过。
- 数据保护：备份为
  `/Users/ylf/Desktop/projects/tradepulse-production/state/backups/crm-before-81812031dbbd-20260903T124314Z-62139.db`，
  SHA-256 `276fd1664c6c47192b101cb4727bfb4e9cd5731e94b70d8ed6256bf404bd9030`，47,173,632 bytes；
  immutable snapshot 的 `quick_check`、`integrity_check` 为 `ok`，`foreign_key_check` 无记录，且无残留
  `-wal/-shm` sidecar。
- Schema/迁移：在备份副本隔离 runtime 执行默认 dry-run，`legacyFollowups=0`、`migratable=0`、
  `needsReview=0`；未对生产数据库执行迁移。
- 回滚：隔离部署夹具的 validation-failure、previous pointer 恢复和 post-switch health rollback
  三项测试均通过（3/3）；生产 `previous` 链接和备份 provenance 均可用，未为演练制造生产停机。
- 非 AI UAT 冒烟：公网 `/`=200 且包含 `TradePulse`/`widget-registry`，未认证 bootstrap/profile 返回
  `401 AUTH_REQUIRED`，legacy 入口在关闭开关下返回 404；未使用或改变 AI 功能。

## 7. GO/NO-GO 决策

当前结论：**GO（本次授权发布）**。

- 功能和治理证据已具备：当前 after 串行发布验证 `npm test -- --test-concurrency=1` `1791/1791`、`node --test` `2150/2150`、Stage B/D `83/83`、
  raw shape `16/16`、治理权威、AI 边界和浏览器验收均通过。
- 远端、生产 current 和成功状态三份 SHA 已一致；依赖风险已解除，生产健康和数据库门禁均通过。
- 后续若有数据库迁移、schema 变更或高耦合 composite 拆分，仍须另立授权目标；AI runtime/UI/触发点继续冻结。

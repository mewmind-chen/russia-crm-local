# 2026-08-29 工作区迁移与治理校准

## 目标

把 TradePulse 重构前、重构后和中心 Git clone 迁入一个新的独立根目录，并将治理文档更新为可以准确恢复工作的当前状态。

## 用户确认的范围

- 正确重构来源是原中心 `repo` 与 `worktrees/frontend-widget-pilot`。
- 不把历史 `ai-integration` 当作本次重构基线。
- 不再使用 `tradepulse-development` 作为当前项目根目录。
- 重构前后内容集中到一个新目录。
- 不删除旧目录，不修改生产目录或生产数据库。

## 新目录

```text
/Users/ylf/Desktop/projects/tradepulse-refactor/
├── repo/      # 中心 clone，main@57c4c42
├── before/    # baseline/pre-refactor@57c4c42，只读
└── after/     # codex/frontend-widget-pilot@76b7b56，当前开发入口
```

远程仓库：`https://github.com/mewmind-chen/russia-crm-local.git`

## 迁移证据

- `repo/`：`57c4c42a89e7730545b726b29fd932c5bfb20574`，`main...origin/main`，干净。
- `before/`：同一基线 SHA，分支 `baseline/pre-refactor`，干净。
- `after/`：`76b7b5638ad7247cf8b282beae5748121e09acd0`，分支 `codex/frontend-widget-pilot`。
- 原、新重构工作区的未提交二进制 patch SHA-256 均为 `35ebe6428d1caecb17f6fd24760731efaedd7fe40e3705e481d33d0aa6ea6a8f`。
- 原治理目录与迁移后治理目录在校准前均为 53 个文件，`diff -qr` 无差异。
- `git fsck --full` 未报告仓库损坏；仅存在历史 dangling objects。
- 原 `tradepulse-development` 保留，生产目录和生产数据库未复制、未修改。

## 迁入的未提交 WIP

以下 5 个文件保持为未提交修改：

- `lib/domains/identity/index.js`
- `lib/sales_crm.js`
- `sales-assets/app.js`
- `test/domain_facades.test.js`
- `test/issue103_frontend.test.js`

迁移没有对这些差异作“修复”或“清理”。当前 diff 为 `+1130/-455`，其中包含移除部分 domain facade/白名单导出并把逻辑重新内联进 `sales_crm.js` 的变化，需要单独确认意图。

## 验证结果

在新 `after/` 执行：

- `npm ci`：成功，安装 112 个包；npm audit 为 1 high、1 low，未自动升级。
- `npm test`：1484 项，1472 通过、12 失败、0 跳过。
- `node --test test/domain_facades.test.js test/issue103_frontend.test.js`：9/9 通过。

全量失败集中在 ownerless return 前端兼容、lifecycle projection/DTO，以及 identity facade 的联系人白名单兼容导出。结论：迁移一致，但当前 WIP 不是绿灯状态。

## 治理文档校准

本次更新：

- 新增 `docs/governance/README.md` 作为治理索引和权威性规则。
- 重写 `CURRENT_STATE.md`、`REPOSITORY_MAP.md`、`WORK_PROTOCOL.md`、`GOAL_PROMPT.md`。
- 更新 `REFACTOR_ROADMAP.md` 的阶段状态和恢复点。
- 更新 `FIELD_CATALOG.md` 与 `IDENTITY_FILTER_EXTRACTION.md` 的历史/实施状态。
- 新增决策 D-010、D-011，并补充当前风险。
- 保留此前 session 的原路径和当时测试数，不把历史证据改写成当前事实。

## 当前恢复点

1. 不新增机械拆分或 widget 功能。
2. 只分析并收敛 5 个 WIP 文件。
3. 恢复 12 个全量失败，重新跑专项与全量测试。
4. 绿灯后分别提交治理 checkpoint 与业务切片。
5. 再审计 62 个已提交切片的接线/回退状态，制定后续最小切片。

## 未执行

- 未 push、未 merge、未部署。
- 未创建或连接新预览 runtime。
- 未修改 AI 内部代码。
- 未删除旧根目录。

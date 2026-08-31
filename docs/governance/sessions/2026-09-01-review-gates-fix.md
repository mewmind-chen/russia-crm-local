# Session Checkpoint：审查门禁修复——时间线续片 + AI 边界白名单 + 治理权威门

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`70e7e49 → 28fb124`（业务 + 治理）

## 背景

审查结论逐条核实（结论估算产品 92% / 重构 70–75%，当前阶段 E 前端 widget 化）：
- 有 4 个未提交文件（CRM 完整时间线 widget 续片），核心测试 1648/1649——唯一失败为
  测试夹具缺 `timelineSectionHtml` stub，已核实并补齐。
- 全量曾 2010/2010（已提交 HEAD），审查时在途；承诺：先完成 timeline WIP 恢复全绿，
  再处理 AI 边界，随后冻结阶段 E、进入兼容层与大文件收口，最后按逻辑切片集成 194+
  提交。

## 本轮切片

### `2e1210c` feat(frontend): extract CRM drawer full timeline section into the shared timeline widget

把 CRM 抽屉 FULL TIMELINE 区块壳（panel-head 风格）下沉到 timeline-widget，
补齐三源时间线共用（客户完整/回收完整/线索开发历史）：
- timeline-widget.js 新增 `renderSectionHtml`（区块壳，eyebrow/title/note 转义）。
- app.js 新增 `timelineSectionHtml`（widget 优先/内联回退）；renderDrawer 内联改委托；
  活动时间线条目（renderActivityTimelineItem 含校正交互）保留内联。
- issue287 executable renderDrawer 依赖 stub 增加 `timelineSectionHtml`（修复唯一失败）。
- progress_board 阶段 E 条目同步 widget 集合。

### `8e0d187`/`96733f6` docs(governance): freeze planning pair + authority guard + harden

治理收口：把 2026-07-25 主计划/执行计划对冻结归档为审计证据；新增
`check-governance-authority` 门禁，确保活跃文档只引用实时远端 main、生产 current／
release 状态与 after 的 Git/代码/测试；契约测试锁定冻结标记与活跃文档。其中
`96733f6` 为并行审查进程补充的加固（隔离点样式扫描等），已纳入分支。

### `28fb124` fix(ai-boundary): allowlist customer dedupe as the single existing coupling isolation

修复审查门禁（check-ai-boundary 违约）。性质核验：**既有耦合迁移而非新增**——
before 基线 sales_crm.js 本就 require `ai_stations/enrichment/dedupe`
（DUPLICATE_RULE_VERSION/canonicalDomain/canonicalHostname/normalizeCompanyName）；
阶段 A 抽域把指纹工具收敛到 `lib/domains/customer/dedupe.js` 单一隔离点，sales_crm.js
不再直接 import 指纹工具；AI 模块零改动，白名单不扩大耦合面。处置（经用户确认）：
- check-ai-boundary.js ALLOWLIST 加入 `lib/domains/customer/dedupe.js` 并注释理由。
- 契约测试 +1：锁定 dedupe 为唯一新增隔离点、sales_crm 不直接引用
  canonicalDomain/canonicalHostname。

## 测试证据

- `node --test` 全量 2019/2019；`npm test` core 1658/1658。
- 门禁：`check:ai-boundary` OK（193 files）；`check:governance-authority` OK。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `2e1210c` feat(frontend): extract CRM drawer full timeline section into the shared timeline widget
- `8e0d187` docs(governance): freeze 2026-07-25 planning pair and add authority guard
- `96733f6` docs(governance): harden frozen planning boundary（并行进程提交）
- `28fb124` fix(ai-boundary): allowlist customer dedupe as the single existing coupling isolation

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 冻结阶段 E 前：其余 widget 化（身份/业务画像/洞察/商务/回收状态 body，CRM 活动
   时间线评估下沉）；`/development-workbench` profile 模式收敛为只读/兼容入口。
3. 进入阶段 G 兼容层收口（sales_crm.js 12,883 行 → `<3500` 门槛、app.js 14,307 行），
   按逻辑切片集成 198 个提交。
4. 全量绿灯，可继续。
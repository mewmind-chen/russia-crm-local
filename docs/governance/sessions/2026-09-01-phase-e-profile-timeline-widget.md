# Session Checkpoint：阶段 E 续片——customerProfile widget 视图补时间线区块

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`cc915ea → bdc802c`（业务）

## 本轮切片

### `bdc802c` feat(frontend): render timeline in the customerProfile widget view

阶段 E 关键动作 3 续片：完整资料 widget 模式补时间线区块，与抽屉共用同一时间线模板。

- **`registerProfilePageWidgets`**：注册 `profile-timeline`（pages: ['customerProfile']，
  order 27，when 门槛 = `ctx.account`）。
- **新增 `renderProfileTimelineWidget`**：按 `account.id` 过滤 `state.data.timeline`，
  复用 `timelineSectionHtml`（panel-head 壳）+ `timelineItemsHtml`（条目），
  customerProfile 视图与 CRM/回收抽屉时间线保持一致；保留 `data-customer-history`
  入口。
- **契约测试 +1**：profile-timeline 注册（id/pages/when/render）、数据过滤、委托
  `timelineSectionHtml`/`timelineItemsHtml`。

## 测试证据

- 全量 `node --test`：2021/2021（较上轮 +1，新增 profile-timeline 契约断言）。
- core `npm test`：1660/1660。
- 专项：widget_registry 37/37 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `bdc802c` feat(frontend): render timeline in the customerProfile widget view

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - widget 模式继续补区块：洞察（profile-insight，复用 insightSectionHtml）、
     下一步/状态条（复用 nextStepHtml）、身份（sourceTagMarkup 评估下沉）；
   - `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。
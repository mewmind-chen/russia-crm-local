# Session Checkpoint：阶段 E 续片——customerProfile widget 视图加入主档区块

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`a844b7f → 3c9369d`（业务）

## 本轮切片

### `3c9369d` feat(frontend): render master profile in the customerProfile widget view

阶段 E 关键动作 3（客户完整资料由统一 widget 集合组装）的落地片：让完整资料
widget 模式与抽屉共用同一主档模板，业务画像区块进入统一 widget 集合。

- **`profileWidgetContext`**：注入 `ctx.account`（按 `external_customer_id` 查
  `state.data.accounts` 行），供 profile-master 使用。
- **`registerProfilePageWidgets`**：注册 `profile-master`（pages:
  ['customerProfile']，order 25，when 门槛 = `ctx.account`）。
- **新增 `renderProfileMasterWidget`**：复用 `masterProfileSectionHtml`（与 CRM/
  回收抽屉共用同一 master-profile 模板），组装「企业背景与开发依据 / 产品与
  潜在需求 / 背调与来源（非销售可见）」行；`isSalesRepresentative()` 控制
  technical 行，行为与抽屉一致。
- **契约测试 +1**：profile-master 注册（id/pages/when/render）、ctx.account 注入、
  render 委托 `masterProfileSectionHtml`。

## 测试证据

- 全量 `node --test`：2020/2020（较上轮 +1，新增 profile-master 契约断言）。
- core `npm test`：1659/1659。
- 专项：widget_registry 36/36 全绿。
- `git diff --check` 通过；lint 无错误；工作区干净。

## 提交

- `3c9369d` feat(frontend): render master profile in the customerProfile widget view

## 下一步最小动作

1. 单独提交治理文档 checkpoint（session + CURRENT_STATE + 看板）。
2. 阶段 E 续片：
   - widget 模式继续补区块：时间线（profile-timeline，复用 timelineSectionHtml）、
     洞察（profile-insight，复用 insightSectionHtml）、下一步/状态条（复用
     nextStepHtml），使完整资料 widget 集合与抽屉对齐；
   - 身份区块（customerProfileTags/sourceTagMarkup）评估下沉；
   - `/development-workbench` profile 模式收敛为只读/兼容入口。
3. 全量绿灯，可继续。
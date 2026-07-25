# A3-02 `action_proposal` 验收

日期：2026-07-25
分支：`codex/a3-02-action-proposal`
基线：`origin/main` @ `a8591a028e11`

## 范围

- 新增严格 `action_proposal@v1` Schema、Prompt Registry 和 Worker 执行链。
- 销售在“记录客户动作”弹窗输入自然语言触达结果，任务异步入队并生成可编辑草稿。
- 草稿包含 activity type、channel、outcome、summary、next action、时间、置信度和缺失字段。
- AI 结果固定 `reviewRequired=true`，不会直接创建活动或改变 CRM 状态。
- 员工核对、修改并点击“确认并记录”后，才复用现有 `/api/sales-crm/activities` 写入。
- 低置信度或缺字段显示警告；字段未补全时服务端拒绝写入并保留待复核状态。
- 通用 AI 任务复核接口不能绕过活动表单确认。
- 一次性消费表保证同一 `proposalJobId` 重复确认只返回原活动，不重复写入。
- AI 任务中心新增“活动提案”类型、筛选和待复核状态。

## 自动化验收

聚焦测试覆盖合同、异步执行、人工确认、重复确认、缺字段阻断、权限和 UI 合同：

```text
36 tests, 36 passed, 0 failed
```

最终完整回归：

```text
node --test --test-reporter=dot
480 tests, 480 passed, 0 failed
```

静态检查：

```text
node --check <全部变更 JavaScript 文件>
git diff --check
```

## 浏览器验收

- 本地隔离测试环境：`http://127.0.0.1:58140/`。
- 桌面端登录后打开“快速更新”，选择专用测试客户并输入触达事实。
- Worker 返回固定测试提案，页面正确回填“客户回复”、`email`、“有兴趣”、摘要、下一步和时间。
- 页面显示“AI 草稿置信度 91%。请核对并修改，确认后才会写入客户时间线。”
- AI 任务中心显示“活动提案 / 需要复核”和模型、费用、耗时。
- 390x844 视口无横向溢出：文档 `scrollWidth=clientWidth=375`，弹窗和提案区均在视口内。
- 验收没有点击“确认并记录”，因此没有创建测试客户活动。

## 发布门

代码完成本地验收后进入 PR、完整 CI、生产 SQLite online backup、源库/备份
`quick_check`、current/previous 回滚点确认、`origin/main` 部署和生产 smoke。生产 smoke
只验证真实提案进入 `needs_review`，不自动确认业务写入。

完成 A3-02 后停止，下一项为 A3-03 `next_action`。

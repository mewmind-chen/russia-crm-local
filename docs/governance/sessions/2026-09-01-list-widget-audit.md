# Session Checkpoint：阶段 E 续片——审计只读列表迁移

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `3e55b41` feat(widget): migrate audit list

阶段 E 续片：将 Users & Permissions 页的审计只读表接入统一 List widget，先完成低风险的只读边界；不改 bootstrap 查询、后端权限、脱敏、审计写入或任何高风险行操作。

- **`lib/field_catalog.js`**：新增 `audit` 人工字段目录（时间、操作人、动作、对象、详情），不含 AI 字段。
- **`sales-assets/app.js`**：审计表使用 `listWidget.renderTable`；按 `view_users` 保留可见性，字段 schema 做 allowlist 门控；详情继续转义并截断 140 字；支持当前 bootstrap 结果的本地排序、用户级列显隐/顺序/布局偏好、上移/下移、恢复默认与完成关闭，存储键按用户隔离。
- **`sales-crm.html`**：新增审计排序选择器与列设置面板，保持“仅管理员可见”提示。
- **`test/list_widget.test.js`**：增加审计字段、无 AI、控件与安全截断契约。

归档用户、在职用户与迁移复核的按钮/写操作未纳入本轮；后端仍返回原有最多 200 条 bootstrap 审计数据，没有新增分页、导出或写入接口。

## 测试证据

- 定向：审计/更正历史/维护 runs/受保护目录/API/List widget 与访问控制 `60/60`。
- `npm test`：core `1711/1711`。
- `node --test`：全量 `2073/2073`。
- `node --check sales-assets/app.js lib/field_catalog.js`：通过。
- `git diff --check`：通过。
- `npm run check:governance-authority`、`npm run check:ai-boundary`：待治理文档提交后复跑并记录。
- 真实浏览器双角色验收未执行；当前环境缺少锁定浏览器依赖时 harness fail-closed。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（CURRENT_STATE、路线图、看板生成器、生成看板与本 session）。
2. 阶段 E 下一切片：用户/归档用户与迁移复核列表，继续把只读列配置与高风险行操作边界分开。
3. 获得锁定浏览器依赖后，独立运行 sales/manager 双角色 preview harness；未运行不得写成通过。

AI 功能保持弃用与冻结，本轮没有新增、迁移或恢复任何 AI 字段/行为。

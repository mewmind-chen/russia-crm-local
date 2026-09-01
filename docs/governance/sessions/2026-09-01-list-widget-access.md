# Session Checkpoint：阶段 E 续片——后台与入库列表迁移

日期：2026-09-01
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
双基线：`57c4c42a89e7730545b726b29fd932c5bfb20574`（远端 `main` 与生产 `current` 一致）

## 本轮切片

### `8d1bb05` feat(widget): migrate access and intake batch lists

阶段 E 续片：将后台账号、归档用户、权限组、迁移复核和线索池入库批次列表接入统一 List widget；用户级列显隐、列顺序、排序与布局偏好均以服务端字段 schema 为上限。保留既有权限和高风险操作边界，不改 bootstrap 查询、后端写入或动作语义。

- **`lib/field_catalog.js`**：新增 users、archived_users、permission_groups、migration_review、intake_batches 人工字段目录。
- **`sales-assets/app.js`**：新增按用户隔离的列表偏好恢复/保存、列设置面板、排序与本地排序；列表继续保留 `view_users` / `manage_users`、身份检查、密码重置、归档/恢复/删除、迁移确认等门控。入库批次也纳入同一协议。
- **`sales-crm.html`**：为账号、归档用户、权限组、迁移复核、入库批次加入排序与列设置入口。
- **`test/list_widget.test.js`、`test/sales_access_ui.test.js`**：新增普通后台列表、入库批次、动作保留与偏好隔离契约。

权限配置矩阵（`filterPermissionTable`）包含继承态、复选框和定义操作，记录为专用编辑组件例外；保护批次预览、待核验队列、更正申请卡片同样不强行套普通列表壳。AI 任务/治理/异常列表属于弃用冻结面，本轮没有新增、恢复或迁移 AI 行为。

## 测试证据

- 定向：列表 widget/访问控制/API `62/62`。
- `npm test`：core `1713/1713`。
- `node --test`：最终全量复跑 `2075/2075` 通过；此前一次并行运行出现与本切片无关的 `mountContacts` 异步时序抖动，单独 `test/profile_widgets.test.js` `12/12` 通过。
- `node --check sales-assets/app.js lib/field_catalog.js`：通过。
- `git diff --check`：通过。
- 真实浏览器双角色验收未执行；当前环境 Playwright/Puppeteer 均未声明、锁定或安装，`phase:e:browser-preview` 按设计退出 78（fail-closed），不得伪造通过。

## 下一步

1. 同步治理文档、生成看板并运行治理权威/AI 边界门禁。
2. 最终门禁复跑 `npm test`、`node --test`、定向测试与静态检查。
3. 在具备锁定浏览器依赖的环境运行 Phase E sales/manager 双角色验收；依赖未满足时保持 fail-closed。

AI 功能继续弃用冻结；生产目录、远端 `main` 和部署状态保持只读。

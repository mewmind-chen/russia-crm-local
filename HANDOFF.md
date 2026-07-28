# Issue #116 开发交接

更新时间：2026-07-28

状态：阶段性实现完成，Issue 仍为 OPEN；当前分支不应合并或部署到生产
Issue：[增加客户筛选字段权限配置：管理员分配，销售按授权使用](https://github.com/mewmind-chen/russia-crm-local/issues/116)

## 项目背景

TradePulse CRM 是面向外贸销售的本地 CRM。Issue #116 将原 #111 的统一筛选组件、客户全景与推进管道接入范围合并进来，目标是建立一套由服务端授权的筛选体系：

- 管理员维护筛选定义、全局启停、权限组基线和成员额外授权。
- 销售只能收到并使用“全局启用 ∩ 字段可见权限 ∩ 权限组授权 ∩ 成员额外授权 ∩ 页面适用”的筛选项。
- 未授权字段的名称、选项、数量、聚合结果和查询能力均不能从接口泄露。
- 所有业务列表复用统一组件、授权 schema、服务端分页、计数、导出和刷新口径。
- 权限变更必须版本化、可审计，并使旧本地筛选状态立即失效。
- #113 继续负责回收站特有参数、分页和三类计数，但必须复用 #116 的组件和授权内核。

Issue 指定的完整列表范围包括：线索池、负责人线索、Recon 情报、线索流转、CRM 客户全景、客户回收站、推进管道、今日待办和经理评价客户列表。

## 分支与工作区

- 仓库：`mewmind-chen/russia-crm-local`
- 开发分支：`codex/issue-116-filter-permissions`
- 隔离 worktree：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/issue-116-filter-permissions`
- 基线：`origin/main@13c11329b09beeb3e5a693235f4ef98b87b8594e`
- 发布方式：草稿 PR；首次推送后补充 PR URL
- 生产状态：未合并、未部署、未上线

不要在 `/Users/ylf/Desktop/projects/russia-crm-local` 继续本 Issue；该主工作区存在用户自己的未提交改动。后续工作应继续使用上述隔离 worktree。

## 当前进度

### 已完成

1. 筛选授权内核

   - 新增 19 个筛选定义和 7 个独立客户标签分类。
   - 新增筛选定义、权限组授权、成员额外授权、权限版本和审计表的安装/迁移逻辑。
   - 实现全局启用、字段权限前置条件、权限组 allowlist、成员追加授权的有效权限解析。
   - 实现统一 AST 校验；未知或未授权字段返回一致的 `FILTER_NOT_AUTHORIZED`，不回显字段名。
   - 实现权限版本冲突检测；前端保存状态按 `permissionVersion` 与新 schema 求交集。

2. 服务端 API

   - `GET /api/sales-crm/filter-schema/:pageKey`
   - `GET /api/sales-crm/accounts`
   - `GET /api/sales-crm/filter-permissions`
   - `PUT /api/sales-crm/filter-permissions/groups/:groupId`
   - `PUT /api/sales-crm/filter-permissions/users/:userId`
   - `PATCH /api/sales-crm/filter-permissions/definitions/:filterKey`
   - 客户列表已使用授权 AST、数据范围、服务端分页、总数、标签分类 OR/跨分类 AND 和授权选项。
   - 管理 API 已限制为真实管理员且同时要求 `view_users`、`manage_users`。

3. 客户全景

   - 已移除原静态客户筛选 DOM，接入统一筛选组件和服务端授权 schema。
   - 支持待应用/已应用条件、清空、更多筛选、标签多选、独立本地状态键和权限版本失效。
   - 客户结果改为服务端分页；支持继续加载、加载状态和总数。
   - 增加请求 epoch，防止旧请求结果覆盖新筛选结果。
   - 快捷查看中的负责人、下一步、阶段等隐式查询能力也进行授权校验。

4. 管理界面

   - 唯一入口位于“用户与权限”，业务列表不显示管理入口。
   - 支持权限组基线、成员额外授权、组继承只读、恢复组默认、身份预览。
   - 配置表已拆为“筛选项目 / 销售可使用 / 页面显示 / 数据安全 / 定义操作”列。
   - 支持全局启停和编辑显示名称、字段类型、展示方式、顺序、运算符、敏感标记。
   - 保存/恢复有进行中状态；失败会在状态区和提示中明确显示，不伪装为成功。

5. 安全收口

   - 无 `view_contacts` 时，客户搜索不查询联系人、产品和可能携带联系信息的叙述字段。
   - “客户经营产品”和“需求/采购产品”标签筛选要求 `view_contacts`。
   - 客户列表、录入列表和导出在无联系人权限时统一脱敏。
   - 无 `view_insights` 时，搜索和导出不查询或返回经理评价。
   - 导出拒绝新授权 AST 与旧筛选参数混用，避免用 `filters={}` 绕过校验。
   - 用户目录仅在具备 `view_users` 时进入导出。
   - bootstrap、列表、录入、资料和标签历史中的标签分类按有效授权过滤。

6. 设计参考

   - 已把用户提供的 HTML 和 PNG 原样纳入 `docs/design-references/issue-116/`。
   - 增加参考说明和自动化存在性/一致性测试。

### 页面覆盖矩阵

| 页面 | 当前状态 | 说明 |
| --- | --- | --- |
| CRM 客户全景 | 已接入基础版本 | 唯一完整挂载统一组件并使用服务端 `/accounts` 的业务列表 |
| 线索池 | 部分安全加固 | 录入搜索和返回值已按联系人/标签权限收口，尚未接统一组件与统一 schema |
| 负责人线索 | 未接入 | 仍需页面 schema、服务端查询和统一组件 |
| Recon 情报 | 未接入 | 仍需页面字段目录、状态字段和服务端分页 |
| 线索流转列表 | 未接入 | 仍需保留实际状态语义并迁移到统一组件 |
| 客户回收站 | 未接入 | #113 负责特有分页/计数；#116 仍需提供组件和授权 schema 复用点 |
| 推进管道 | 未接入 | 目录声明了页面权限，但 UI、查询端点和分页尚未迁移 |
| 今日待办 | 未接入 | 严重程度、负责人、日期/超期状态仍需服务端授权迁移 |
| 经理评价客户列表 | 未接入 | 评价覆盖和客户字段筛选仍需迁移；必须继续受 `view_insights` 约束 |

结论：本分支是 Issue #116 的授权基础和客户页阶段性实现，不是完整验收版本。

## 已修改文件

### 授权、查询和服务端

- `lib/filter_catalog.js`：筛选目录、类型、运算符、页面和字段权限前置条件。
- `lib/filter_authorization.js`：表结构、迁移、有效权限解析、版本、审计、保存和 AST 校验。
- `lib/customer_filters.js`：客户查询构建、联系人/评价敏感搜索保护。
- `lib/access_control.js`：扩展联系人及叙述字段脱敏集合。
- `lib/sales_crm.js`：schema、客户列表、管理 API、导出校验、标签授权和录入响应脱敏。
- `server.js`：旧接口及入口的权限/标签输出安全衔接。

### 前端

- `sales-assets/filter-component.js`：统一筛选组件。
- `sales-assets/filter-component.css`：统一筛选组件的桌面和移动样式。
- `sales-assets/app.js`：客户页接入、服务端分页、竞态保护、权限管理界面与反馈。
- `sales-assets/app.css`：权限配置界面和客户筛选相关样式。
- `sales-crm.html`：统一组件容器、继续加载按钮、权限配置结构和资产版本。

### 设计参考

- `docs/design-references/issue-116/README.md`
- `docs/design-references/issue-116/admin-filter-permission-preview.html`
- `docs/design-references/issue-116/admin-filter-permission-preview.png`

### 新增测试

- `test/issue116_design_reference.test.js`
- `test/issue116_filter_api.test.js`
- `test/issue116_filter_authorization.test.js`
- `test/issue116_filter_component.test.js`
- `test/issue116_filter_inference.test.js`
- `test/issue116_security_contract.test.js`

### 更新的兼容与回归测试

- `test/access_control.test.js`
- `test/customer_smart_filters.test.js`
- `test/customer_tag_history.test.js`
- `test/issue103_backend.test.js`
- `test/issue107_lead_pool_filter_options.test.js`
- `test/issue112_tag_semantics.test.js`
- `test/sales_menu.test.js`

### 交接文档

- `HANDOFF.md`

## 验证结果

在隔离 worktree 中执行：

```text
node --check lib/sales_crm.js
node --check sales-assets/app.js
结果：通过

node --test \
  test/issue116_filter_api.test.js \
  test/issue116_filter_inference.test.js \
  test/issue116_security_contract.test.js \
  test/customer_smart_filters.test.js \
  test/access_governance.test.js
结果：24/24 通过

npm test
结果：648/648 通过，0 失败，耗时约 34.4 秒

git diff --check -- . \
  ':(exclude)docs/design-references/issue-116/admin-filter-permission-preview.html'
结果：通过。参考 HTML 是用户文件的逐字节归档，保留了原文件的 CRLF 和行尾空白，
因此仅在差异空白检查中排除该归档文件。
```

尚未完成浏览器视觉验收和最终截图，因此自动化测试通过不等于 Issue 验收完成。

## 未完成事项

### P0：合并前必须完成

1. 将统一筛选组件和服务端授权 schema 接入其余 8 个明确业务列表。
2. 为每个页面建立页面专属字段目录、查询端点、授权选项、分页、总数和刷新口径。
3. 将线索池现有硬编码筛选完整迁移到统一 AST；当前只是敏感参数和响应脱敏，不是统一内核。
4. 推进管道、今日待办、经理评价必须停止只基于 bootstrap 快照做前端过滤。
5. 审计所有 `filterOptions`、bootstrap、profile、自动补全、计数和聚合接口，确认未授权字段名称、选项和数量均不返回。
6. 完成桌面 `1440 × 900` 与移动 `390 × 844` 浏览器验收和截图。
7. 对照参考稿补齐管理界面的效果预览区、管理视图页签、基础条件预览、7 类标签完整预览、已启用条件和结果预览。
8. 完整验证权限刚撤销、保存失败、无授权筛选、空结果、加载中和移动布局状态。

### P1：管理员能力缺口

1. 当前可编辑既有定义，但没有“新增筛选定义”的 API 和 UI；Issue 验收明确要求管理员可新增。
2. “页面显示”目前支持横向、更多、日期范围；尚未实现可配置的“不显示”语义。全局停用和未授权会隐藏，但不是同一配置项。
3. 管理页身份预览当前只显示可见/隐藏徽标与数量，未达到参考图中的完整业务筛选预览。
4. 需要增加完整管理操作审计的浏览器级验收，包括备注显示和版本冲突恢复流程。

### P1：查询一致性与安全复核

1. 所有新增页面必须复用 `effectiveFilterSchemaFor()` 和 `validateFilterQuery()`，不能再各自维护 allowlist。
2. 线索池客户标签的旧查询需要按同类 OR、跨类 AND 重构并与统一 AST 对齐。
3. 缓存或页面状态键必须包含权限版本；权限撤销后要销毁旧组件、删除失效值并重新请求。
4. 导出、统计和分类计数需逐页面与列表结果做一致性测试。
5. 负责人线索、Recon 和经理评价涉及联系人/情报/评价三类敏感权限，需要单独增加推断攻击测试。

## 下一步计划

1. 先补齐“新增筛选定义”和“不显示”配置语义，固定管理端数据契约。
2. 抽取页面查询适配层，让每个页面只提供 `pageKey`、字段目录、基础 scope 和结果序列化函数。
3. 按依赖和风险分三组并行迁移：

   - 线索池、线索流转、客户回收站复用录入/客户标签内核。
   - 负责人线索、Recon 情报复用联系人和情报字段权限。
   - 推进管道、今日待办、经理评价复用 CRM 账号 scope 和统计口径。

4. 每完成一页，同时交付 schema API、列表 API、选项/计数、统一组件挂载、分页/竞态、权限推断测试。
5. 完成管理预览区和 9 页桌面/移动浏览器截图。
6. 再跑全量测试、静态差异检查和真实管理员/经理/销售三身份验收。
7. 只有全部 P0 完成后，才把 PR 从 Draft 改为 Ready；合并 `main` 后再观察自动部署和生产健康检查。

## 注意事项

- 当前 Issue 仍为 OPEN，不能使用 `Closes #116`；PR 只应使用 `Refs #116`。
- 当前分支不得直接部署，也不要在生产环境手工复制文件。
- 不要把草稿 PR 的推送误称为“上线”；只有合并 `main` 且自动部署健康检查成功后才算生效。
- 主工作区有用户改动，禁止 reset、checkout 或覆盖；继续使用隔离 worktree。
- `docs/design-references/issue-116/` 中的 HTML/PNG 是验收基准，不要替换成重绘版本。
- 七类标签必须保持七个独立权限 key；同类多值 OR，跨类 AND。
- 产品字段和两类产品标签当前按 `view_contacts` 处理，后续若产品数据被拆成独立权限，需要同时更新目录前置条件、搜索范围、输出脱敏和测试。
- 成员级筛选授权只能追加或恢复组默认，不能提供关闭组授权的 deny UI。
- 错误响应不得回显未知字段名或泄露未授权字段是否存在。
- 新页面禁止读取全量 bootstrap 后只在浏览器中过滤；筛选、分页、计数、导出和刷新必须由服务端执行。
- 前端测试目前以 DOM/源码契约和 API 集成为主，最终仍必须做真实浏览器视觉与交互验收。

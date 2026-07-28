# Issue #116 统一筛选权限验收记录

日期：2026-07-29

## 交付结果

Issue #116 明确列出的 9 个业务列表全部使用服务端授权 schema 和统一筛选组件：

| 页面 | pageKey | 服务端列表 |
| --- | --- | --- |
| 线索池 | `intake` | `/api/sales-crm/lists/intake` |
| 负责人线索 | `contacts` | `/api/sales-crm/research/people` |
| Recon 情报 | `recon` | `/api/sales-crm/research/recon` |
| 线索流转 | `lead_flow` | `/api/sales-crm/lists/lead_flow` |
| CRM 客户全景 | `customers` | `/api/sales-crm/accounts` |
| 客户回收站 | `recycle_bin` | `/api/sales-crm/lists/recycle_bin` |
| 推进管道 | `pipeline` | `/api/sales-crm/lists/pipeline` |
| 今日待办 | `alerts` | `/api/sales-crm/lists/alerts` |
| 经理评价 | `insights` | `/api/sales-crm/lists/insights` |

每页在执行查询前校验当前权限版本和有效筛选 AST；未知字段、未授权字段及已撤销字段
统一拒绝且不回显字段名。分页、继续加载、结果总数和筛选选项均由同一个服务端 scope
生成。客户全景已有的“导出当前结果”复用相同授权 AST；其他业务列表没有独立导出操作。
回收站专属三类计数仍按 Issue #113 的边界独立交付。

## 管理与安全验收

- 管理入口只存在于“用户与权限”。
- 支持筛选定义新增、编辑、启用、停用、不显示、展示方式、顺序、类型和运算符。
- 支持权限组基线、成员追加授权、组继承只读和恢复组默认。
- 身份预览同时考虑筛选授权、全局状态和既有字段权限。
- 保存、失败、版本冲突和恢复均有明确状态；变更写入审计。
- 七类客户标签保持七个独立权限 key；同类多值 OR、跨类 AND。
- 无联系人或经理评价权限时，不搜索、不返回对应敏感叙述、选项或聚合信息。
- 权限版本变化会销毁所有已挂载筛选器，并清除已失效的本地字段值。

## 浏览器验收

环境：本地 `NODE_ENV=test`、隔离 SQLite、测试管理员及一条无真实客户信息的验收记录。

- `1440 × 900`：
  - 管理端显示权限组/个人例外、恢复组默认、身份预览和完整定义表。
  - Anna 身份预览显示 32 个当前可见筛选项。
  - 客户全景动态显示 `7 个分类 · 7 个可用标签`。
  - 选择“俄罗斯”并点击应用后，已启用条件显示“国家 / 地区：俄罗斯”，服务端结果为 1 条。
- `390 × 844`：
  - `innerWidth=390`，`document.scrollWidth=375`，`body.scrollWidth=375`。
  - 管理面板宽 347；客户筛选容器宽及 scrollWidth 均为 345。
  - 页面无横向溢出；配置选择器和筛选分类保持可操作。
- 控制台：无 error/warning。
- 六个新增业务列表均观察到对应 `/lists/:pageKey` 请求；联系人和 Recon 使用各自授权研究接口。

验收过程中发现 `#customers` 深链接可能并发初始化两次筛选器。实现已加入
`customerInitializeEpoch`，过期 schema 响应不会再挂载重复监听器；浏览器复验确认单次
点击保持选中并可生成已启用条件。

设计基准继续使用仓库中的：

- `docs/design-references/issue-116/admin-filter-permission-preview.html`
- `docs/design-references/issue-116/admin-filter-permission-preview.png`

## 自动化与发布门

合并前最终执行结果：

```text
npm ci: pass（110 packages）
npm test: 695/695 pass
Issue #116 前端专项复验: 18/18 pass
node --check server.js: pass
node --check lib/sales_crm.js: pass
node --check lib/filter_authorization.js: pass
node --check lib/business_page_filters.js: pass
node --check lib/intake_flow_filters.js: pass
node --check lib/research_filters.js: pass
node --check sales-assets/app.js: pass
node --check scripts/deploy-state.js: pass
node --check scripts/install-auto-deploy.js: pass
zsh -n scripts/deploy-from-github.sh: pass
bash -n deploy/backup.sh: pass
python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts: pass
git diff --check: pass
```

生产发布只允许使用已合并的 `origin/main` 完整 SHA，并由
`scripts/deploy-from-github.sh` 完成 candidate 验证、SQLite online backup、原子切换、
服务重启、内外网 health 检查和失败自动回滚；部署不会自动恢复数据库。

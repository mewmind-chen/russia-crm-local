# 模块化前端首轮发布门证据

日期：2026-07-26

## 标准任务记录

- Task ID：`FR-01`
- Branch：`codex/frontend-modular-refactor-design`
- Implementation commit：`660345a61da824cdf853852229d9e4a94f649222`
- Database migration：无
- Feature flag：`CRM_UX_REDESIGN_ENABLED`
- Production impact：双外壳代码已发布；旧外壳 smoke 后已开启新外壳，旧外壳继续保留用于快速回退
- Rollback point：发布前生产 `79800f529d1d98e8a936959d88cbbbebce6f559f`，并可独立关闭前端开关
- Known gaps：旧外壳和临时开关继续保留；稳定观察后退役属于后续发布门
- Decision：PR、CI、自动部署和生产切换验收通过；进入稳定观察

## 交付范围

- 客户详情统一为同一原生模块，保留七个中文标签页、旧深链和来源页返回。
- AI 结果统一为来源事实、确定性规则、AI 推断、人工决定和系统动作五层。
- 销售、经理、管理员使用不同的 AI 可见范围；治理、成本、模型尝试和 Prompt
  技术字段仅管理员可见。
- 新增 `manage_ai_governance`，治理、预算、模型运行和功能开关使用同一管理员权限。
- stale、样本不足、零分母、受限证据和历史未知触发来源均有明确业务状态。
- 移动导航增加焦点管理、背景隔离、Escape 关闭和 44px 触控目标。
- 登录退出后清空邮箱和密码；AI 动作保留明确的业务能力上下文。

## 自动化验收

- 客户详情、路由、外壳、AI API 和业务 UI 聚焦回归：`31/31`。
- 最终完整 Node 回归：`615/615`。
- `npm run frontend:parity`：通过，35 个能力；未映射路由、权限策略和无效记录均为 0。
- 全部 `sales-assets/**/*.js` 执行 `node --check`：通过。
- `git diff --check`：通过。
- 一次集中代码审查发现并修复 AI 动作缺少 capability 上下文和移动标签 42px 两项问题；
  修复后定向测试与完整回归通过。

## 浏览器验收

- 使用独立非生产数据库 `data/acceptance.db`，未连接或修改生产数据库。
- 管理员、经理、销售三个角色完成权限和导航验证。
- 销售访问 AI 控制面会返回本人首页；经理只见授权任务及业务结果；管理员保留完整治理。
- 客户详情七个标签均可加载，旧 `#customerProfile` 自动规范化为
  `#customer-detail`，AI 深链显示客户名称。
- `390x844` 下首屏滚动位置、导航焦点、背景 `inert`、Escape、客户名称入口、
  标签方向键焦点和 44px 触控目标通过。
- 桌面和移动页面无页面级横向溢出，浏览器控制台无 warning 或 error。
- 退出后登录表单的邮箱和密码均为空。

## 发布门

- 发布来源必须是 GitHub `origin/main` 的完整合并 SHA。
- GitHub PR CI 必须通过；评审期间 `origin/main` 前进时必须重新验证。
- 自动部署必须完成在线备份及 `quick_check`，构建无 `.git` 的不可变 release。
- 首次部署保持 `CRM_UX_REDESIGN_ENABLED` 关闭，验证旧外壳、本地/公网 `/healthz`
  和首页后再开启。
- 开启后重复三角色、客户详情、AI 权限、390px、关键业务入口和控制台 smoke。
- 任一检查失败时先关闭前端开关；需要代码回滚时将 `current` 原子切回发布前 release。

## 发布结果

- PR [#90](https://github.com/mewmind-chen/russia-crm-local/pull/90) 的 pull request CI
  和 `main` push CI 均通过；合并 SHA 为
  `9aaa8b38c85d93eaa5f1a9244538dd670ea065e6`。
- 自动部署于 2026-07-26 完成，`current=releases/9aaa8b38c85d`，
  `previous=releases/79800f529d1d`，deployment state 无失败 SHA 或失败阶段。
- release 的 `.release-sha` 为目标完整 SHA，release 内无 `.git`。
- 自动部署备份
  `state/backups/crm-before-9aaa8b38c85d-20260725T204414Z-91287.db`
  使用只读 immutable 模式执行 `quick_check=ok`；活动库 `quick_check=ok`、WAL。
- 新外壳开启前，旧外壳、本地/公网首页均为 200，未登录 bootstrap 为 401；
  本地和公网 `/healthz` 均返回目标完整 SHA 与 `database=ok`。
- 已备份生产 `.env` 到
  `state/backups/env-before-fr01-enable-20260726T0448.env`，随后设置
  `CRM_UX_REDESIGN_ENABLED=true` 并只重启 server。
- 开启后本地和公网 `/healthz` 继续返回目标 SHA；生产首页加载
  `sales-assets/modular-app.js`。
- 公网未登录页面在 1280 桌面和 `390x844` 下均为模块化外壳，无横向溢出；
  登录输入和按钮高度均为 44px，邮箱和密码初始为空，控制台无 warning/error。
- 发布后三角色业务验收沿用相同 release 内容在独立非生产数据库上的验收结果；
  未创建、复制或重置生产账号，未修改生产业务数据。
- server 近期日志未发现 5xx、未处理异常或 fatal 错误。

## 进度边界

本发布不改变统一主计划 `35/38` 的 AI 任务进度，下一项仍为 `R5-01 影子运行`。
本次只完成模块化前端首轮双外壳发布；旧外壳退役必须经过稳定观察和单独发布门。

# TradePulse 长期执行目标提示词

更新时间：2026-08-29

> 用途：会话恢复时提供稳定目标与边界。实时进度、Git 和测试数必须再读取 `CURRENT_STATE.md`，不能只凭本文件继续实现。

## 一、角色与目标

你是 TradePulse（本地外贸 CRM + Russia Recon 调研调度系统）的长期重构工程师。目标是在保持 API、数据、权限、审计和生产安全的前提下，把后端及前端大单体渐进拆成可测试、可组合、可回滚的领域模块和 widgets。

长期方向：

1. 后端按 identity、filter、customer、activity、planning、lifecycle、intake、assignment、commerce、contact、recon、delivery 等边界拆分。
2. 前端建立 widget 注册与组合机制，所有业务列表页通过统一 List widget 支持授权列显隐、列顺序、用户级布局偏好和升降序/多级排序；字段通过字段目录和有效 schema 控制。
3. 统一状态真源、权限范围、字段投影与筛选授权。
4. 客户完整资料最终解除旧 iframe 依赖，成为统一壳的一方视图。
5. 每个切片保持兼容、测试、证据和回滚点。

## 二、当前权威入口

```text
中心 clone：/Users/ylf/Desktop/projects/tradepulse-refactor/repo
重构前对照：/Users/ylf/Desktop/projects/tradepulse-refactor/before
当前开发：/Users/ylf/Desktop/projects/tradepulse-refactor/after
治理入口：/Users/ylf/Desktop/projects/tradepulse-refactor/after/docs/governance
远端基线：origin/main（每次 fetch 后核实）
当前开发分支：codex/frontend-widget-pilot（每次以现场 Git 为准）
```

`repo/` 不写业务代码，`before/` 只读，所有重构修改仅在 `after/`。旧 `/Users/ylf/Desktop/projects/tradepulse-development` 不再是当前治理或开发入口。

## 三、当前恢复点

- 已提交重构停在 `76b7b56`，相对 `origin/main@57c4c42` ahead 62、尚未合并。
- 字段目录/profile widgets、多个 domain helper/facade、lifecycle projection/write shim、白名单投影等已有提交。
- 仍未完成：完整 widget 注册表、客户资料 iframe 收敛、单体主体拆分、最终集成。
- 当前另有 5 个业务文件的未提交 WIP；全量测试为 1472/1484，12 失败。
- 在恢复全量绿灯并确认 WIP 意图前，不开始新的拆分切片。

详细事实和失败分类只读取 `CURRENT_STATE.md`，不要把本节当作永久测试基线。

## 四、范围边界

- **AI 零动作**：不删除、不迁移、不搬运、不重构 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 或既有 AI 触发点；前端只能沿用既有开关决定相关区域是否显示。
- **不碰生产**：不修改生产数据库、配置、部署和外发通道。
- **不维护双份项目**：不再向旧 `tradepulse-development` 写代码或治理文档。
- **不直接开发中心 clone**：业务改动只在 `after/`。
- **不把 planning 当当前事实**：历史规划仅作背景，当前实现以代码、测试和 `CURRENT_STATE.md` 为准。
- **不跳过红灯**：当前回归未恢复时，不继续机械拆单体文件。

## 五、每次会话开始协议

1. 读取本文件、`CURRENT_STATE.md`、`WORK_PROTOCOL.md` 和最新 session。
2. 在 `repo/` 执行 `git fetch origin --prune`，核实 `origin/main`。
3. 在 `after/` 执行 `git status --short --branch`、`git rev-parse HEAD`，识别用户改动。
4. 确认目标、范围、非目标、数据/权限影响、测试与回滚方式。
5. 当前有红灯时先复现和归因；只有恢复约定门禁后才进入下一切片。

## 六、实施纪律

- 小步提取：先锁契约，再抽纯函数/服务，再接线，最后缩兼容层。
- 一个文件只有一个明确写入者；保护用户未提交改动。
- 外部 API、错误码、数据范围、字段脱敏和审计默认不变。
- 每个切片运行专项测试和全量测试；前端行为还需浏览器双角色验证。
- 一个逻辑切片一个 commit；重要阶段建立可回滚 checkpoint。
- 结束时更新 `CURRENT_STATE.md` 和新的 session，不覆盖历史 session。

## 七、当前下一步

只处理当前 5 个 WIP 文件及其 12 个失败：确认是继续、修正还是撤回该 WIP，恢复全量测试，然后形成 checkpoint。绿灯后再审计现有 62 个提交的接线状态并选择下一最小切片。

## 八、完成定义

- 业务目标与兼容要求满足；
- 专项和全量测试通过；
- 前端改动完成必要的真实运行验证；
- 权限、数据、迁移和回滚影响已记录；
- `CURRENT_STATE.md` 与 session 已更新；
- 提交状态、是否 push/merge/deploy 被准确说明。

本地完成不等于生产完成；未提交 WIP、红灯测试或未验证 runtime 均不得描述为完成。

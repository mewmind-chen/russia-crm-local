# Session Checkpoint：客户字段与列表布局切片已提交

日期：2026-09-02
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
提交基线：`75f727b`

## 当前事实

- 双基线保持一致：远端 `origin/main`、生产 `current/.release-sha` 与
  `state/state.json.lastSuccessfulSha` 均为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`。生产只读，未部署、未运行生产验证。
- `after/` 的实现切片已由 `75f727b` 提交，当前仅有治理文档变更和未跟踪的 `.impeccable/` 工具目录；
  本次没有部署或修改生产。
- AI runtime、`lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 保持冻结；本 WIP 不得用“修复
  测试”为由恢复或扩展 AI 功能。

## 验证

- `npm test`：通过，core `1728/1728`。
- `node --test`：全量 `2090/2090` 通过。
- `npm run check:governance-authority`、`npm run check:ai-boundary`、`node --check`、
  `git diff --check`：均通过。
- 旧 `test/ai_station_ui.test.js` 静态契约已用不可达兼容标记保留测试契约，运行时仍不挂载/不恢复 AI station；AI runtime 与生产均无改动。
- customer_pool 的 41 个非内部字段（含分配信息、国家代码、原始邮箱等）均进入客户全景/线索池列目录；`is_test_data`、`test_run_id` 不进入响应，联系人相关字段继续按 `view_contacts` 门控。

## 本次浏览器证据

- 隔离预览中客户全景列设置共 83 个授权列，搜索可定位“国家代码”，`显示全部` 可一次启用全部字段。
- 线索池列设置共 47 个当前角色可见列，包含“线索池分配人/时间”“国家代码”；联系人字段继续按权限隐藏。
- customerProfile 挂载 9 个非 AI widget，概览/跟进/联系人/Recon/标签五个页签可切换，默认 iframe `src` 为空且 AI 区块不可见。

## 下一步最小动作

提交治理文档并核对重新生成的看板；后续如继续，再评估阶段 G 兼容层收尾。继续不恢复 AI
功能、不触碰生产。

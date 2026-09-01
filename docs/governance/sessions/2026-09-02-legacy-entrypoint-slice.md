# Session Checkpoint：旧兼容入口装配抽取

日期：2026-09-02  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
实现提交：`d615410`  

## 范围

- 将 `server.js` 中 `/legacy` 与 `/tradelead-v2.html` 的 `CRM_ENABLE_LEGACY` 条件路由抽取到 `lib/legacy_entrypoints.js`。
- 保持开关语义、精确路径映射、canonical `/` 与 `/development-workbench` 行为不变。
- 新增严格开关与启用/禁用路由矩阵测试；不改 `sales_crm.js`、资料页 iframe、AI runtime 或生产目录。

## 基线与验证

- 远端 `origin/main`、生产 `.release-sha` 与 `state.json.lastSuccessfulSha` 仍一致为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- `npm test`：core `1730/1730`。
- `node --test`：全量 `2092/2092`。
- `node --check server.js`、`node --check lib/legacy_entrypoints.js`、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：均通过。
- 未 push、未 merge、未部署；生产保持只读，AI 功能继续冻结。

## 后续

这只是阶段 G 的第一块纯装配抽取。后续是否继续拆分资料页/profile 路由组，需先做独立审计，避免把高耦合行为改变混入兼容层收尾。

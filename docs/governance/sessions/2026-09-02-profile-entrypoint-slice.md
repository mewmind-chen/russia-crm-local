# Session Checkpoint：Profile 入口装配抽取

日期：2026-09-02  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
实现提交：`7d6e88a`  

## 范围

- 将 `server.js` 的 `/profile-contacts.js`、`/profile-insights.js` 认证资源路由抽到 `lib/profile_entrypoints.js`。
- 将 `/development-workbench` 的普通工作台、客户资料、线索资料三路权限分流与只读兼容响应抽到同一模块。
- 保持注册顺序、认证中间件、403 中文文案、`X-Frame-Options: SAMEORIGIN`、`Index.html` 映射不变。
- 不抽取 `lib/sales_crm.js` 的资料 API；不改资料聚合、权限/脱敏、标签、跟进、Recon、AI 或生产目录。

## 基线与验证

- 远端 `origin/main`、生产 `.release-sha` 与 `state.json.lastSuccessfulSha` 仍一致为 `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 定向 profile/权限/工作台与服务工厂回归：72/72。
- `npm test`：core `1732/1732`。
- `node --test`：全量 `2094/2094`。
- `node --check server.js`、`node --check lib/profile_entrypoints.js`、`git diff --check`、`npm run check:governance-authority`、`npm run check:ai-boundary`：均通过。
- 未 push、未 merge、未部署；生产保持只读，AI 功能继续冻结。

## 后续

资料 API 路由组与 `getCustomerProfileData`、权限/脱敏、标签/跟进/Recon 强耦合，暂不搬迁。下一块应先独立审计可抽取的纯装配边界。

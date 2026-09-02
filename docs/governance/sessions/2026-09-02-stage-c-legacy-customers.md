# Session Checkpoint：阶段 C legacy customers 安全字段收口

日期：2026-09-02  
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`  
分支：`codex/frontend-widget-pilot`  
实现提交：`c595bf0`  
预览门禁修复：`dc51fed`

## 目标与范围

本轮只完成阶段 C 的安全字段收口：为 legacy `customers` 行建立字段级白名单，并接入两个仍返回该形状的 `db.js` 聚合路径：`getInitialData` bootstrap 与 `getCustomerProfileData` profile。保留业务/状态字段，剥离联系方式及联系叙事；`tags` 作为唯一嵌套值再做标签级白名单。

明确不做：不修改 AI（包括 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 与既有 AI 触发点），不动生产，不迁移 `loadIntakeState` 的深度嵌套聚合，不处理 export 的 users/password hash，也不拆 profile/迁移/入库/评价等高耦合边界。

## 双基线

- `repo/` `origin/main`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- production `current/.release-sha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`
- production `state/state.json.lastSuccessfulSha`：`57c4c42a89e7730545b726b29fd932c5bfb20574`

三者一致；生产目录保持只读。

## 实现

- `lib/access_control.js` 新增 `CONTACT_SAFE_CUSTOMER_ROW_KEYS` 与 `contactSafeCustomerRecord`；行级键集镜像 `redactContactFields` 在 `buildCustomer` 输出上的可见字段，标签通过 `CONTACT_SAFE_CUSTOMER_TAG_KEYS` 递归投影，阻止未来标签字段穿透。
- `lib/db.js` 的 bootstrap/profile 在 `!view_contacts` 时将 legacy rows 显式映射到白名单；统计使用投影后的业务行，view_contacts 用户保持原始完整行为。
- `test/phase_c_customer_whitelist_contract.test.js` 覆盖结构接线、blacklist≡whitelist 逐键等价、tags 嵌套泄漏与 bootstrap/profile 双端行为。
- `scripts/phase-e-browser-preview.js`（`dc51fed`）只修复验收 harness 首帧竞态：widget host、iframe 隐藏、空 `src` 三项同时满足后再采样，不改变产品行为。

## 验证

- `node --test`：`2114/2114` 通过。
- `npm test`：core `1752/1752` 通过。
- `npm run check:governance-authority`：通过。
- `npm run check:ai-boundary`：通过（210 files checked）。
- `node --check`（上述 4 个变更 JS 逐文件执行）：通过。
- `git diff --check`：通过。
- `npm run phase:e:browser-preview`：Playwright `1.62.1` 在隔离 SQLite、loopback、AI 关闭环境下 manager/sales 双角色通过；默认 customerProfile 挂载 9 个 widget、无 legacy iframe，profile-only 入口只读且无保存动作；生产未触碰。

## 结论与后续边界

legacy `customers` 这一 S6 可选残值已收口，Stage C 安全字段目标完成。P1/P3 `loadIntakeState` 的深度嵌套内容与 S5 export 的 users/password hash 风险仍按设计文档暂缓；不因本轮结果扩大范围。未 push、未 merge、未部署。

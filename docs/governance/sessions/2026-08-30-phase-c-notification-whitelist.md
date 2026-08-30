# Session Checkpoint：阶段 C 通知白名单切片

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`5e992fe` → `1835f73`

## 本轮切片

### `1835f73` listNotificationRows 切字段级白名单
- `access_control.js`：新增 `CONTACT_SAFE_NOTIFICATION_KEYS`（id/recipientid/recipientname/customerid/code/severity/status/createdat/readat/webdeliverystatus/wecomdeliverystatus/wecomstatus）+ `contactSafeNotificationRecord` + 导出。
- `business_page_filters.js`：通知列表无 view_contacts 分支 `redactContactFields(rows)` → `contactSafeNotificationRecord(rows)`；`redactContactFields` import 移除（该文件最后一名调用方）；sales 角色 `recipientId`/`recipientName` 裁剪保持。
- 关键语义（忠实镜像黑名单）：`title`/`detail` 均在 `CONTACT_KEYS` 中——无 view_contacts 用户无论黑名单/白名单都会同时剥离 title/detail（`issue325` 断言 title 的测试仅对 view_contacts 用户成立，因为 U-OTHER 默认有 view_contacts 才不触发 redact）。
- 契约测试 `test/phase_c_notification_whitelist_contract.test.js`（3 断言）：
  - 结构：通知页用白名单、不再用黑名单。
  - 等价：业务 copy 通知行上 `contactSafeNotificationRecord ≡ redactContactFields`（deepEqual）。
  - 行为：无 view_contacts sales 经 `GET /api/sales-crm/lists/notifications`（AI 功能开启 fixture）看到 SALES_PACK 通知的标识字段、无联系方式。

## 测试证据

- 新契约 3/3；通知/销售文案边界/AI 销售包/AI 全局开关/销售执行门/权限回归 24/24。
- `node --test` 全量 `1952/1952`；`npm test` core `1591/1591`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `1835f73` refactor(access): drive notification list contact projection from a field whitelist

## 风险与回滚

- 行为保持：等价契约证明无 view_contacts 通知行逐键一致；AI 功能门控与销售文案边界（`issue325`）回归确认不受影响。
- 可独立 `git revert`；未 push/未合并/未部署；未触碰 AI 内容与 intake 触发器。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 续：剩余 `redactContactFields` 路径评估——evaluation/alert payload（`sales_crm.js:7022/9975/10631/11631`）、db bootstrap（`db.js:1564/1707`；`assistant.js`/`task_center.js` 红线除外）。每片沿用"白名单键集 + 等价契约 + API 行为契约"范式。
3. 统一 `buildAccessContext` 与列表查询范围解释器；按页面落地"权限→字段→筛选"合同。
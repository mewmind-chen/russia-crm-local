# Session Checkpoint：阶段 C S3 形状（timeline/auditLog 白名单）+ S5 审计发现

日期：2026-08-30
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`1835f73` → `38bfe7d`

## 本轮切片

### `38bfe7d` S3 形状：timeline/auditLog 字段级白名单
- `access_control.js`：新增 `CONTACT_SAFE_TIMELINE_KEYS`（12 键）与 `CONTACT_SAFE_AUDIT_LOG_KEYS`（11 键）+ `contactSafeTimelineRecord`/`contactSafeAuditLogRecord` + 导出。
- timeline 事件（claim/activity/rfq/quote/order）保留结构键与 `provenance`，剥离 copy 字段（`title`/`summary`/`next_action`/`outcome` 均属 CONTACT_KEYS，黑名单也剥）；`provenance` 纯结构键（kind/activityId/customerId/ids），已做泄漏校验（保留值在黑名单下不变）。
- audit 行保留归属/用户身份键、剥离 `action`（'action' 在 CONTACT_KEYS）。
- 契约测试 `test/phase_c_timeline_audit_whitelist_contract.test.js`（2 等价 + 1 泄漏校验 = 3）。

### S5（export）审计发现（记入设计文档）
- export payload 的 `users`（仅 `view_users` 时非空）为 sales_users 行；黑名单**保留 `password_hash`/`password_salt`**（不在 CONTACT_KEYS）。
- 忠实镜像白名单会把密码哈希列入显式键集（合规隐患）；改行为破坏等价。
- 判定：**S5 暂缓**（与 P1/P3 同理——保留黑名单或先修 users 形状合规）。design 文档已更新。

## 测试证据

- 新契约 3/3；全量 `node --test` `1955/1955`；core `1594/1594`。
- `git diff --check` 通过；lint 无错误；`node -e require` 加载正常；工作区干净。

## 提交

- `38bfe7d` refactor(access): add timeline and audit-log field whitelists with leak check

## 风险与回滚

- 白名单为可复用形状、尚无接线（纯新增函数 + 契约），无行为面；可独立 `git revert`。
- 未 push/未合并/未部署；未触碰 AI 内容。

## 下一步最小动作

1. 单独提交治理文档 checkpoint（当前更新），重新生成进度看板。
2. 阶段 C 续：S6（db bootstrap 复合：people/recon 形状 + 泄漏校验）→ S4（recycle-profile 复合：masterProfile 形状，依赖 S6）。P1/P3/S5 暂缓已记录。
3. 统一 `buildAccessContext` 与列表查询范围解释器；按页面"权限→字段→筛选"合同。
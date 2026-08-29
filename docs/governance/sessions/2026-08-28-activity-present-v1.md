# Session Checkpoint：阶段 A-6 activity 域首刀 — 展示辅助抽离

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`a08a350` / `pilot/customer-contacts-v1`

## 本次范围

customer 域六刀完成后进入 activity 域拆分，先把活动展示纯辅助抽离。

## 迁移内容

- 新增 `lib/domains/activity/present.js`：
  - `normalizeActivityReactionName`：NFKC 折叠/控制字符/空白/40 字校验
  - `activityReactionNameKey`：zh-CN 小写名键
  - `legacyProgressKey`：social 渠道回退映射
  - `scopedActivityProvenance`：superseded/replacement 可见性裁剪
- `sales_crm.js` 本地实现改为 `activityPresent.*` 转发，删除重复代码。

## 行为保证

- 反应名校验错误（控制字符/空/超长）、进展键回退、provenance 可见性裁剪全部不变。

## 测试

- 新增 8 项活动展示契约测试（校验边界、大小写、渠道回退、provenance 可见/隐藏）。
- 客户域测试 16/16 通过；全量 `node --test` 1436/1436 通过。

## 提交与回滚

- 提交：`a013621 refactor(activity): extract reaction normalization and provenance scoping`
- Tag：`pilot/activity-present-v1`
- 工作区 clean，未 push。

## 下一步

activity 域继续：活动请求规格解析（`resolveActivityRequestSpec`/`PROGRESS_TYPE_MAP`）、活动记录序列化（`publicActivityRecord`）按同模式抽离。
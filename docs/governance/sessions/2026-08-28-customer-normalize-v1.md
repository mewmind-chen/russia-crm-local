# Session Checkpoint：阶段 A-3 客户域首刀 — 资料规范化抽离

日期：2026-08-28
工作区：`/Users/ylf/Desktop/projects/tradepulse-development/worktrees/frontend-widget-pilot`
分支：`codex/frontend-widget-pilot`
基线：`6d7e540` / `pilot/lifecycle-commerce-whitelist-v1`

## 本次范围

按推荐顺序进入阶段 A（结构化切分 `sales_crm.js`）剩余域的第一刀：customer 域。先把客户资料规范化纯函数抽离到独立域模块。

## 迁移内容

- 新增 `lib/domains/customer/normalize.js`：
  - `normalizeCountry`：国家缩写/别名映射，未识别保留。
  - `normalizeEstablishedYear`：四位年份校验（1000~当前年），`now` 可注入。
  - `normalizeAccountNickname`：空白/控制字符/40 字上限校验。
- 错误构造器 `badRequest` 由调用点注入，保持原错误语义（消息与 statusCode）。
- `sales_crm.js` 三个本地函数改为转发到新模块，删除本地实现。

## 行为保证

- 所有调用点（资料编辑、新增客户、线索分配、迁移）行为不变。
- 契约测试锁定规范化边界与注入错误。

## 测试

- 新增 `test/customer_normalize.test.js`：5 项。
- 资料编辑/权限专项 60/60 通过；全量 `node --test` 1425/1425 通过。

## 提交与回滚

- 提交：`d7c9be5 refactor(customer): extract profile normalization helpers`
- Tag：`pilot/customer-normalize-v1`
- 工作区 clean，未 push。

## 下一步

继续 customer 域拆分：客户列表/详情行映射、资料编辑动态字段、回收/不对口流程按同模式逐步抽离；之后进入 activity、planning 域。

# Issue #314 验收证据

## 范围

验证分栏待核验工作台、保护客户和批量导入三个一级视图，以及管理员与销售角色的数据边界。候选服务运行在 `http://127.0.0.1:4314/`，使用生产数据库的 SQLite 在线备份作为本地副本；生产服务和生产数据库未修改。

候选服务健康检查返回：

```text
HTTP 200
ok=true
database=ok
releaseSha=b076a1efaee0d607f94bb9a7e432ef998eff9ee4
```

## 浏览器矩阵

| 角色 | 视口 | 结果 |
| --- | --- | --- |
| 管理员 | 1440x900 | 通过。队列宽 380px，详情固定在右侧，页面 `scrollWidth=1425`，无横向溢出。版本 badge 为 `20260816-issue314-verification-workbench`。 |
| 管理员 | 320x844 | 通过。队列和详情为双状态，详情可全屏打开，底部操作栏按钮高 44px，页面 `scrollWidth=305`，无横向溢出。 |
| 管理员 | 375x844 | 通过。队列正常显示，返回队列后当前 `selectedKey` 保留。页面 `scrollWidth=360`。 |
| 管理员 | 390x844 | 通过。队列和详情布局稳定，页面 `scrollWidth=375`。 |
| 管理员 | 430x932 | 通过。详情操作区和客户对比不溢出，页面 `scrollWidth=415`。 |

## 功能结果

- 当前页搜索提示为“搜索当前页客户名称或编号”；输入 `ITTELO` 只返回对应当前页记录，切换到 `DCS Russia` 可定位候选记录。
- 无候选记录只展示“要求补充资料”一个可用单选动作，不渲染另外两个不可用裁决卡。
- 有候选的 `DCS Russia` 展示新线索 `RU-1353` 与疑似已有客户 `RU-1350` 的对比；“是同一个客户”可选，“不是同一个客户”按后端门控为 disabled，“资料还不够”可选。
- 待核验详情支持上一条、下一条和“保存并处理下一条”；返回队列后选择项保留。
- 管理员通过带 `?conflict=` 的深链进入对应详情；离开后再次访问同一深链可以重新应用。
- 保护客户与批量导入是独立一级视图，旧的保护客户与导入能力仍由原视图承载。

## 权限边界

- 管理员可访问待核验中心和保护客户数据。
- 销售登录后导航不显示“客户保护与查重”；直接访问带冲突深链的 URL 仍显示经营驾驶舱，待核验工作台不可见。
- 销售直接请求 `GET /api/sales-crm/protected-customer-conflicts?...` 返回 HTTP 403。
- 主管账号沿用现有权限组，未为验收扩大权限；保护客户 API 仍按既有权限门控。

## 测试数据隔离与证据

为覆盖有候选分支，仅在候选数据库副本中加入了测试 CRM 影子账号：`task5-crm-candidate-ru1350`，`external_customer_id=RU-1350`，`is_test_data=1`，`test_run_id=issue-314-browser-qa`。该记录不在生产数据库中。无候选记录使用候选副本中的本地 fixture。浏览器验收包含管理员桌面、320px/375px 移动详情和销售越权边界截图；截图与 DOM/溢出断言均在验收会话中核对。

## 自动化门禁

```text
Issue #314/#306 focused gates: 53/53
Version-dependent regression suites: 138/138
Full npm test: 1,255/1,255
npm run check:copy: pass
npm run check:ai-boundary: pass (143 files)
JavaScript, shell, and Python syntax checks: pass
git diff --check: pass
```

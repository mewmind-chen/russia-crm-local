# Issue #62 / A2-06 验收证据

日期：2026-07-25

## 结果

- Issue #62 页面与交互修订已完成：漏斗累计口径、入库搜索/分页/筛选、批量负责人确认、筛选导出 CSV、经理评价入口、客户资料跟进入口、导航历史和移动端提示。
- A2-06 五项验收门全部通过：
  - 同一客户并发扫描只保留一个 intake/account。
  - AI 不能指定不具备候选资格的销售。
  - 规则阻断不能被 AI 越过。
  - AI 故障时确定性自动/人工分配继续可用。
  - 管理员、经理、销售三角色权限测试通过。

## 自动化验证

```text
node --test test/issue62_ux.test.js test/a2_06_acceptance.test.js: 7/7
node --test test/admin_password_reset.test.js test/sales_menu.test.js test/issue62_ux.test.js test/a2_06_acceptance.test.js: 18/18
npm test: 466/466
node --check lib/sales_crm.js: pass
node --check sales-assets/app.js: pass
git diff --check: pass
```

## 本地 smoke

- `PORT=3101 npm start` 启动成功；默认端口 3000 已被其他本地进程占用，因此使用 3101。
- 管理员登录成功，侧栏显示“经理评价”，入库中心可打开并使用 `#intake` hash。
- 从 `#intake` 执行浏览器后退可返回 `#dashboard`。
- 390px 移动视口下主体保持可用，表格横向滚动提示可见。

未执行生产迁移、合并到 `main` 或部署；生产 AI 开关继续保持关闭。

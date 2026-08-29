# Session: 用户级客户资料字段显示偏好

日期：2026-08-28
基线：origin/main@57c4c42（git fetch 后仍为 57c4c42）
隔离：worktree frontend-widget-pilot / 分支 codex/frontend-widget-pilot / runtime/frontend-widget-pilot (3201)

## 目标

在已完成的 `customer_profile` 31字段/6分组 widget 基础上，支持用户个人隐藏/显示 profile 分区，同时不改变服务端授权、不扩展数据下发范围，并保留 iframe 回退。

## 实现

- `sales-assets/field-widget.js`
  - 新增 `normalizeProfilePreferences()`
  - `profileSections(schema, preferences)` 支持 `hiddenSections`
  - `renderProfileFacts({ schema, data, formatters, preferences })` 透传偏好
  - 只过滤已授权 schema 字段，偏好不能恢复服务端已隐藏字段
- `sales-assets/app.js`
  - `tp-profile-prefs:<userId>` localStorage key，用户之间隔离
  - JSON/非法数据安全回退 `{ hiddenSections: [] }`
  - profile widget 渲染读取偏好
  - 增加“字段显示偏好”按钮组，可隐藏/显示六个 profile section
  - 切换后重新从 profile 端点拉数据并渲染，contacts widget 契约不变
- `sales-assets/app.css`
  - 新增偏好控制栏和按钮样式
- `test/profile_widgets.test.js`
  - 新增 `hiddenSections` 分区过滤测试，确认联系方式隐藏且身份/来源仍显示

## 约束与安全

- 不新增 schema、不改 API、不修改生产数据库、不改部署配置
- localStorage 仅保存当前用户的 section UI 偏好
- `view_contacts/view_recon/view_all_customers` 仍由服务端 field-schema 决定，前端偏好仅能进一步隐藏
- AI 代码和 AI 开关零动作；iframe 默认仍存在，`?profileView=widgets` 仍为预览开关

## 验证

```bash
node --check sales-assets/app.js sales-assets/field-widget.js lib/field_catalog.js
# OK
node --test test/field_catalog.test.js test/profile_widgets.test.js
# 29 pass 0 fail
node scripts/run-core-tests.js
# 1370 tests 1367 pass 3 fail
# 3 fail 与 7a26074 基线一致：permission_integration 1205/1219/1245（测试编号随新增测试偏移）
# 本切片未新增失败
ReadLints paths=[app.js, field-widget.js, app.css, profile_widgets.test.js]
# No linter errors found
git diff --check
# clean
```

## 提交

- `077c88c feat(field-catalog): add per-user profile section preferences`
- tag `pilot/profile-widgets-v1-preferences`
- 未 push
- worktree clean

## 下一步

1. 复核 3201 admin/sales 浏览器实际点击隐藏/显示与刷新持久化
2. 修复已知 3 个基线权限回归（1205/1214/1240，测试编号可能随新增用例偏移）
3. 或进入阶段 A-1 identity/filter 拆分前的规划与测试边界确认

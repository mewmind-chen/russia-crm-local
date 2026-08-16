# Issue #314 验收证据

## 范围

验证待核验中心是否按已批准的 `4173` 预览实现，并验证纯线索重名时是否展示真实可比较记录。候选服务运行在 `http://127.0.0.1:4315/`，数据库来自生产 SQLite 独立备份；只在候选副本重置本地管理员密码和会话，未插入 CRM 影子账号，生产服务和生产数据库未修改。

## 真实数据验证

生产副本中 `DCS Russia` 的冲突数据为：

- 新线索：`RU-1353`，俄罗斯 · Москва，`https://www.servmarket.ru/`，`info@servmarket.ru`
- 可比较线索：`RU-1350`，俄罗斯 · Москва，`https://dcs-russia.ru/`，`corporatesales@dcs-russia.ru`
- 两条记录均位于 `customer_pool`，`crm_accounts` 命中数为 `0`

页面和 API 均展示两条身份记录；选择 `RU-1350` 后提交 `link_existing` 的接口闭环由自动化测试覆盖，未依赖 CRM 影子账号。

## 浏览器矩阵

| 角色 | 视口 | 结果 |
| --- | --- | --- |
| 管理员 | 1440x900 | 通过。工作台高 600px，底部操作栏完整可见，横向溢出 0。 |
| 管理员 | 320x844 | 通过。对比矩阵宽 262px，双按钮操作栏可见，横向溢出 0。 |
| 管理员 | 375x844 | 通过。对比矩阵宽 317px，横向溢出 0。 |
| 管理员 | 390x844 | 通过。对比矩阵宽 332px，两个客户编号同屏可见，横向溢出 0。 |
| 管理员 | 430x932 | 通过。对比矩阵宽 372px，返回队列与操作栏可用，横向溢出 0。 |

截图：

- `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/issue-314-preview-fidelity/desktop-1440x900-dcs-final.png`
- `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/issue-314-preview-fidelity/mobile-320x844-dcs.png`
- `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/issue-314-preview-fidelity/mobile-375x844-dcs.png`
- `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/issue-314-preview-fidelity/mobile-390x844-dcs.png`
- `/Users/ylf/Desktop/projects/tradepulse-development/artifacts/issue-314-preview-fidelity/mobile-430x932-dcs.png`

## 功能结果

- 纯线索重名不再显示“没有可比较的已有客户”，而是展示两条真实身份卡片。
- 对比矩阵展示编号、国家/地区、官网、邮箱和行业；不同字段有明确底色提示。
- “是同一个客户”会使用当前选择的线索或 CRM 记录作为目标；CRM 候选优先，无 CRM 时允许选择另一条线索作为主记录。
- “暂不处理”返回队列；“处理说明”弹窗可打开；“保存并处理下一条”保留原有工作流。
- 页面在桌面和 `320/375/390/430px` 手机视口无横向溢出。

## 自动化门禁

```text
Focused identity/workbench tests: 40/40
Full npm test: 1,257/1,257
npm run check:copy: pass
npm run check:ai-boundary: pass (143 files)
JavaScript and shell syntax checks: pass
git diff --check: pass
Browser console errors: 0
```

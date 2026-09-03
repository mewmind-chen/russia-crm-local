# 依赖与架构只读风险审计

日期：2026-09-03  
范围：`after/` 当前重构工作树；不升级依赖、不改生产

## 双基线与审计约束

- `origin/main`、生产 `current/.release-sha`、生产 `state/state.json.lastSuccessfulSha` 均为
  `57c4c42a89e7730545b726b29fd932c5bfb20574`。
- 本审计只读取 package manifest/lock、已安装依赖树和代码装配关系；没有运行安装、升级、
  lockfile 重写、生产命令或部署动作。

## 依赖链结果

命令：

```text
npm audit --omit=dev --json
npm ls --omit=dev express qs body-parser fast-uri --depth=3
npm explain fast-uri
npm explain qs
```

当前生产依赖树：

```text
express@4.22.2
└─ body-parser@1.20.5 ─┐
   └─ qs@6.15.2       ├─（express 也直接依赖 qs@6.15.2）
ajv@8.20.0
└─ fast-uri@3.1.4
```

`npm audit --omit=dev` 报告 `4` 项：`1 high`（`fast-uri`，由 `ajv` 引入）和 `3 moderate`
（`qs`、`body-parser`、`express` 链）。均标记 `fixAvailable`，但本轮没有独立兼容性、性能、
锁文件和回滚证据，因此不在收尾目标内升级。当前风险记录见 `RISK_REGISTER.md` 的 R-016；
后续应另立依赖切片，先跑完整回归和安全专项，再决定最小版本变更。

## 架构装配结果

| 检查项 | 只读证据 | 结论 |
|---|---|---|
| 路由注册顺序/入口 | 阶段 G 各注册器契约与专项回归；`server.js`/`sales_crm.js` 仅装配 | 未发现重复注册或路径漂移；不再扩大拆分 |
| 高耦合边界 | `2026-09-02-high-coupled-stage-d-audit.md` service/API contract | 资料聚合、迁移复核、入库/评价、认证/密码继续原位 |
| manager workflow 依赖 | `lib/manager_workflows.js` 通过显式依赖注入；无 `sales_crm`/AI runtime 依赖 | 独立应用边界成立；继续保留组合根装配 |
| domain 接线 | 现有看板 `domains=41/44`；identity/index、identity/middleware、filter/index 按裁定内联 | 不为数字强行机械抽取 |
| AI 边界 | `check:ai-boundary` 与现有冻结清单 | AI runtime/UI/触发点零动作 |
| 工作区/生产 | `after/` 仅有未跟踪 `.impeccable/`；生产目录只读 | 未发现本轮误写或额外 WIP |

## 风险决定

1. 依赖风险已从“未评估”变为“已评估、未处置”；不把盲目升级混入重构收尾。
2. 架构风险集中在高耦合事务和三处按裁定内联模块；均已有契约或冻结说明，不新增拆分。
3. 后续若依赖或架构发生变化，必须重新核验双基线，并以独立提交提供等价测试、故障回滚和
   AI/生产边界证据。


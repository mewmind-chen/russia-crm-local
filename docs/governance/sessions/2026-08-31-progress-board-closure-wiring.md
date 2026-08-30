# Session Checkpoint：看板域间接线口径修正

日期：2026-08-31
工作区：`/Users/ylf/Desktop/projects/tradepulse-refactor/after`
分支：`codex/frontend-widget-pilot`
基线：`b7ec871`（working tree：boards + progress_board.js 未提交）

## 背景

`b4cfdfc` 把 quote/order 幂等生命周期（action_request）与行级写下沉进 `commerce/write.js` 后，`commerce/action_request` 在运行时经 `write.js` 内部 `require('./action_request')` 存活，不再被 `sales_crm.js` 直接 require。看板生成器的"域模块接线状态"此前只统计生产代码对 `lib/domains` 的直接 require，把 `action_request` 误报为"未接线（被 WIP 回退，待恢复）"。

## 本轮切片：看板接线口径扩展为传递闭包

修改 `scripts/progress_board.js` 的 `wiredDomainModules()`：

- **解析范围**：从"仅生产代码 `require('./domains/*')`"扩展为"直接 require + 域间接线传递闭包"。扫描 `lib/`（排除 `ai_stations`/`ai`，红线不触碰 AI 面），对域模块文件内的相对 require（`./x`、`../y`、`../y/z`）做 Node 式解析（目录→`index.js` 回退），把落在 `lib/domains/**` 的目标作为域到域的边。
- **传递闭包**：从生产代码直接接线的集合出发，沿已接线域模块的域内边继续标记，直到稳定。计入 `action_request`（经 `commerce/write` → `./action_request`）、`rules`（`write`/`action_request` 内部 `./rules`）、以及 `auth/*`→`../identity`、`reporting/builders`→`../auth/user`/`../lifecycle/state_projection`、`intake/owner`→`../customer/normalize`、`activity/*`→`./present` 等相对边。
- **裁定保持**：用户在 WIP 收敛时裁定的内联/精简模块（`identity/index`、`identity/middleware`、`filter/index`）即使存在域间接线，仍在传递闭包后从已接线中剔除，按"按裁定保持内联（不接线）"展示。
- **接线提交归属**：改用该条实际 require 语句（`-S "require('...')"`）在宿主文件上的 pickaxe 归属，`action_request` 归到 `b4cfdfc`。

## 修正后接线口径

- `lib/domains/` 44 个文件；
- 41 已接线 = 40 个生产代码直接 require + `commerce/action_request`（经 `write.js` 传递闭包）；
- 3 个按用户裁定保持内联/精简：`identity/index`、`identity/middleware`、`filter/index`。

## 证据

- 重新生成后 `PROGRESS_BOARD.md`/`progress-board.html` 模块表：`action_request` 恢复为 `[x] 已接线 | b4cfdfc`；其余 40 个已接线归属不变；3 个裁定内联保持 `[ ] 按裁定保持内联（不接线）`；总览 `lib/domains 44 个文件，生产接线 41 个`。
- `node --test` 全量 1975/1975 通过（未触碰 `lib/` 生产代码，仅看板工具与治理文档）。
- `git diff --check` 通过；工作区改动仅 `scripts/progress_board.js`、`docs/governance/PROGRESS_BOARD.md`、`docs/governance/progress-board.html`、`docs/governance/CURRENT_STATE.md` + 本 session。

## 下一步最小动作

1. 单独提交本治理 checkpoint（session + CURRENT_STATE + 看板 + progress_board.js），与业务提交分离。
2. 看板口径已与"44 文件 / 41 接线 / 3 裁定内联"一致；后续若继续减单体（阶段 A 已收尾），以新口径辅助发现仍内联的调用点。
3. 阶段 D 商业闭环已成型；可评估进入阶段 E（前端 widget 注册表 / iframe 收敛）的准备动作。
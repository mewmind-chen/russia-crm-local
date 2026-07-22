# GitHub Main 自动部署设计

## 背景

生产 CRM 运行在当前 Mac 上，通过 macOS LaunchAgents 常驻，并由 Cloudflare Tunnel
暴露 `https://crm.newmindchen.com`。现有上线方式会从 Git 提交创建独立 release 目录，
再把 `.env`、SQLite、日志和报告目录链接到持久化目录。这一方向能够隔离代码和数据，
但目前仍依赖人工创建 release、改写 LaunchAgent、重启和验证。

仓库中尚未启用 GitHub Actions。开发仓库的 `main` 可能包含未提交修改或与远端分叉，
因此不能作为生产部署输入。当前 CRM 服务运行在 release 目录，而 Recon 和 Contact
Worker 仍运行开发目录代码，也存在同一时刻代码版本不一致的问题。

## 已确认决策

1. GitHub `origin/main` 的最新提交是唯一生产代码来源。
2. 不允许从本地分支、开发工作区或未提交文件发布。
3. Mac 主动轮询 GitHub，不开放 SSH 或 Webhook 入站端口。
4. 新提交必须在 Mac 上通过完整候选验证后才能切换生产。
5. CRM、Recon Worker、Contact Worker 和定时任务必须使用同一个 release。
6. 切换后健康检查失败时自动恢复上一 release；SQLite 不自动恢复。
7. 第一版不发送企业微信通知，结果写入本地日志和部署状态文件。

## 目标

- 合并到 GitHub `main` 后，无需人工复制文件或编辑 LaunchAgent。
- 正常情况下在一次轮询和候选验证完成后自动上线最新 `main` SHA。
- 生产代码不受开发仓库脏状态、当前分支或本地提交影响。
- 每个 release 都能追溯到完整 Git SHA，线上可以通过健康接口查询。
- 候选失败不影响当前生产；切换后失败能够恢复上一稳定代码版本。
- 每次切换前使用 SQLite online backup 创建一致备份。

## 非目标

- 第一版不做企业微信、邮件或飞书通知。
- 第一版不让 GitHub 托管 Runner 直接连接生产 Mac。
- 第一版不自动合并 PR，也不绕过 GitHub 的代码评审流程。
- 第一版不自动回滚数据库。数据库 schema 变更必须保持向后兼容。
- 第一版不搬迁现有 SQLite、报告和日志目录；继续把它们作为共享持久化目录。
- 第一版不实现零停机双实例切换；重启窗口预计为数秒。

## 方案比较

### 方案 A：Mac 轮询并创建不可变 release（采用）

LaunchAgent 每分钟运行部署器。部署器在独立 Git 缓存中获取 `origin/main`，从目标 SHA
创建候选 release，完成测试和备份后原子切换 `current` 软链，再统一重启服务。

优点是无需开放 Mac 入站访问、不依赖开发工作区、沿用已经验证过的 release 目录模式，
并且切换和回滚边界清晰。代价是最多约一分钟检测延迟，Mac 必须能够访问 GitHub。

### 方案 B：GitHub Actions 自托管 Runner

GitHub workflow 直接在 Mac 上执行部署。触发更即时，但 Runner 长期执行仓库代码，权限面
更大，Runner 自身升级和离线状态也会成为额外维护项。第一版不采用。

### 方案 C：GitHub Webhook 或 SSH 推送部署

需要额外公开接收端点、管理签名或 SSH 凭据。当前 Cloudflare Tunnel 只需服务 CRM，
没有必要为部署再增加入站攻击面。第一版不采用。

## 目录模型

默认路径都允许通过环境变量覆盖：

```text
~/Desktop/projects/
├── russia-crm-local/                 # 现有开发目录，只提供持久化数据
│   ├── .env
│   ├── data/
│   ├── logs/
│   ├── reports/
│   ├── recon-runs/
│   └── contact-recon-reports/
├── russia-crm-deploy/
│   ├── repo.git/                     # 独立 bare Git 缓存
│   └── state/                        # 部署状态和互斥锁
├── russia-crm-releases/
│   ├── <12位SHA>/                    # 已完成验证、不可修改的 release
│   └── <12位SHA>.candidate-*/        # 构建中的临时目录
└── russia-crm-current -> russia-crm-releases/<12位SHA>/
```

release 完成候选验证后才链接生产 `.env` 和持久化目录。候选测试期间使用自身的临时
`data/`，不得连接生产数据库。`node_modules` 属于每个 release，不共享。

## 模块边界

### `scripts/deploy-from-github.sh`

单次、幂等的部署执行器：

- 获取独立 bare Git 缓存中的 `origin/main`；
- 解析唯一目标完整 SHA；
- 对已部署 SHA 或已记录失败 SHA直接退出；
- 从目标 SHA 创建候选目录；
- 安装依赖并执行候选验证；
- 创建 SQLite online backup；
- 完成持久化链接并把候选目录提升为正式 release；
- 原子切换 `russia-crm-current`；
- 重启同一组 LaunchAgents；
- 执行本地健康检查和公网冒烟检查；
- 成功时记录 SHA，失败时切回旧 release 并重启。

脚本使用目录锁防止重入。每条日志包含 UTC 时间、阶段和 SHA，不输出 `.env` 内容或凭据。

### `scripts/install-deploy-services.js`

一次性安装器：

- 验证 Git、Node、npm、curl、sqlite3 和 GitHub 访问；
- 创建部署、release 和日志目录；
- 从现有 CRM LaunchAgent 解析当前人工 release，把它设为初始 `current` 回滚基线；
- 把 CRM、Worker 和定时任务的路径统一改为 `russia-crm-current`；
- 保留 Cloudflare Tunnel 的既有配置与凭据；
- 手动执行一次部署器，从 GitHub `main` 创建并验证首个自动 release；
- 首次部署成功后写入 `com.russia-crm.auto-deploy.plist`，每 60 秒运行一次；
- 打印当前 SHA、服务状态和日志查看命令。

安装器不从当前 feature 分支直接上线。首次启用前，自动部署实现必须先合并到 GitHub
`main`，首次部署也必须从独立 Git 缓存解析该 `main` SHA。

### `GET /healthz`

无认证的最小健康接口，只返回：

```json
{
  "ok": true,
  "database": "ok",
  "releaseSha": "5e7e23dc3db1d57a04a4112e2dfaac5e3a5d283d"
}
```

接口读取 release 根目录的 `.release-sha`，并通过只读 SQLite 连接执行 `SELECT 1`。
它不返回路径、配置、账号、版本依赖或数据库业务数据。数据库不可读时返回 HTTP 503。

## 部署数据流

1. LaunchAgent 每 60 秒启动部署器；目录锁保证同一时间只有一个实例。
2. 部署器执行 `git fetch origin main`，目标固定为 fetch 后的 `refs/remotes/origin/main`。
3. 若目标等于 `lastSuccessfulSha`，立即退出。
4. 若目标等于 `lastFailedSha`，自动轮询不重复构建；目标 SHA 变化或显式 `--force` 后重试。
5. 使用 `git archive` 从 bare 缓存导出候选，写入完整 `.release-sha`。
6. 候选依次运行：`npm ci`、`npm test`、`node --check server.js`、部署脚本语法检查、
   `python3 -m compileall -q scripts automation/hermes-skills/russia-recon/scripts`。
7. 候选通过后，使用 `sqlite3 .backup` 备份生产 `data/crm.db`。备份失败则不切换。
8. 删除候选测试产生的临时持久化目录，再创建到现有共享目录的软链。
9. 将候选重命名为 `<12位SHA>`，原子替换 `russia-crm-current` 软链。
10. 依次重启 CRM、Recon Worker 和两个 Contact Worker；定时任务下次运行自动读取新软链。
11. 最多等待 30 秒访问 `http://127.0.0.1:3000/healthz`，要求 HTTP 200 且
    `releaseSha` 精确等于目标 SHA；随后检查公网 `/healthz`。
12. 全部通过后写入 `lastSuccessfulSha` 和完成时间。

## 失败与回滚

### 切换前失败

Fetch、导出、依赖安装、测试、语法检查或备份失败时：

- 不修改 `current`；
- 不重启生产服务；
- 删除未完成候选目录；
- 记录 `lastFailedSha`、阶段、退出码和时间；
- 后续轮询等待 GitHub 出现新 SHA，避免每分钟重复消耗资源。

### 切换后失败

服务重启失败、本地健康检查失败、SHA 不一致或公网冒烟失败时：

- 把 `current` 原子切回切换前目标；
- 再次重启 CRM 和 Worker；
- 验证旧 release 的本地 `/healthz`；
- 记录目标 SHA 为失败并保留候选 release、日志和数据库备份供排查。

SQLite 不自动恢复，因为新代码启动后可能已经接受业务写入。所有 schema 变更必须采用
新增表、列或兼容读取等向后兼容方式；需要破坏性迁移时必须暂停自动部署并使用单独方案。

### 没有可回滚版本

安装器必须先从现有 CRM LaunchAgent 找到一个正在运行的人工 release，或者由操作者通过
`DEPLOY_BOOTSTRAP_RELEASE` 明确指定目录。两者都不存在时安装器返回失败，不改写任何
LaunchAgent。旧 release 没有 `/healthz` 时，回滚验证使用本地 `/` HTTP 200；首个自动
release 成功后，所有后续版本都必须通过带 SHA 校验的 `/healthz`。

## GitHub CI

新增 `.github/workflows/ci.yml`，在 pull request 和 `main` push 上运行：

- 使用 Node 22；
- `npm ci`；
- `npm test`；
- `node --check server.js`；
- Shell 和 Python 语法检查。

CI 用于在合并前尽早反馈。由于当前私有仓库套餐不能启用分支保护，Mac 部署器仍必须对
目标 SHA 独立执行同样的候选验证，不能仅信任 GitHub 状态。

## 运行时稳定性

- Node 主版本固定为 22，CI 和生产保持一致。
- LaunchAgent 使用安装时解析出的绝对 Node 路径，并在部署前执行 `node --version`。
- 部署器拒绝 Node 主版本不是 22 的环境，避免 Homebrew 自动升级造成原生依赖或动态库漂移。
- `package-lock.json` 是依赖唯一锁定来源，生产只执行 `npm ci`。

## 本地状态与日志

状态文件使用 JSON，至少包含：

- `lastSuccessfulSha`
- `lastSuccessfulAt`
- `lastFailedSha`
- `lastFailedAt`
- `lastFailedStage`
- `previousRelease`
- `currentRelease`

标准输出和错误输出继续写入现有 `logs/`。状态文件使用临时文件加同目录重命名更新，避免
进程中断留下半截 JSON。第一版不把日志或状态上传到第三方。

## 测试策略

### Node 单元和集成测试

- `/healthz` 在数据库可读时返回 200、真实 release SHA 和固定字段集合。
- 数据库不可读时返回 503，响应不泄露绝对路径和底层错误详情。
- server 作为模块导入时不监听端口，健康接口可在隔离临时数据库上测试。

### Shell 集成测试

部署脚本支持通过环境变量注入临时 Git 仓库、release 目录、共享目录、状态目录、健康 URL
和服务重启命令。测试使用本地临时 Git remote，不访问真实 GitHub、不操作真实 LaunchAgent：

- 只部署 remote `main` 的最新 SHA；
- 开发目录脏状态不影响部署；
- 同一 SHA 不重复部署；
- 候选验证失败不切换；
- 健康检查失败切回旧 release；
- CRM 和 Worker 重启命令接收相同 `current` release；
- `--force` 可以重试已失败 SHA。

### 安装器测试

将 plist 渲染与实际 `launchctl bootstrap` 分离。单元测试验证所有代码服务都使用
`russia-crm-current`，自动部署间隔为 60 秒，Cloudflare 配置不被覆盖。

## 上线验收

首次正式启用必须满足：

1. 实现代码已合并到 GitHub `main`。
2. Mac 对该 SHA 的独立候选验证成功。
3. 部署器从独立缓存解析到同一 SHA。
4. 自动创建数据库备份。
5. `russia-crm-current/.release-sha` 等于 GitHub `main` 完整 SHA。
6. CRM 与三个 Worker 的工作目录都解析到 `russia-crm-current` 指向的 release。
7. 本地和公网 `/healthz` 均返回 200 和同一 SHA。
8. 开发目录保留现有未提交修改且不参与生产运行。
9. 第二次运行部署器输出 no-op，不重启服务。

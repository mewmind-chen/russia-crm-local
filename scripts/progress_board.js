'use strict';

/**
 * TradePulse 重构进度看板生成器。
 *
 * 数据源（全部自动推导，不手工维护）：
 *   - git：origin/main..HEAD 提交、HEAD、分支、工作区状态、模块接线提交归属
 *   - 代码：lib/sales_crm.js 行数、lib/domains 文件清单、生产代码对 domains 的 require
 *   - 治理文档：CURRENT_STATE.md 的测试计数、sessions/ 最近 checkpoint
 *
 * 输出：docs/governance/PROGRESS_BOARD.md（仓库内真值）
 *       docs/governance/progress-board.html（浏览器可视化看板）
 *
 * 运行：node scripts/progress_board.js（npm run board）
 * 自动更新：每个切片收尾时随 session 一起重新生成并提交，无需手工提醒。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GOV_DIR = path.join(ROOT, 'docs', 'governance');
const BOARD_MD = path.join(GOV_DIR, 'PROGRESS_BOARD.md');
const BOARD_HTML = path.join(GOV_DIR, 'progress-board.html');

// 用户裁定保持内联/精简、不接线的域模块（WIP 收敛时的"内联版"边界）。
// identity/index（facade 精简）、identity/middleware（认证逻辑内联）、
// filter/index（调用方直连 filter_authorization）。
const KEPT_UNWIRED = new Set(['identity/index', 'identity/middleware', 'filter/index']);

function sh(command, fallback = '') {
  try {
    return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return fallback;
  }
}

function git(args) {
  return sh(`git ${args}`);
}

function collectGitState() {
  const lines = git('log --format=%h%x7c%s%x7c%cd --date=short origin/main..HEAD').split('\n').filter(Boolean);
  const commits = lines.map(line => {
    const [hash, subject, date] = line.split('|');
    return { hash, subject, date };
  });
  const headShort = git('rev-parse --short HEAD');
  const branch = git('branch --show-current');
  const clean = git('status --porcelain') === '';
  return { commits, headShort, branch, clean, ahead: commits.length };
}

function countType(commits, type) {
  return commits.filter(commit => new RegExp(`^${type}`).test(commit.subject)).length;
}

function domainFileList() {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(path.relative(path.join(ROOT, 'lib'), full));
    }
  };
  walk(path.join(ROOT, 'lib', 'domains'));
  return files.sort();
}

function wiredDomainModules() {
  // 生产代码（lib/ 下非 domains、非 ai_stations）中对 lib/domains 的直接 require，
  // 再沿被已接线域模块 require 的域模块做传递闭包（域间接线，如 commerce/write
  // 内部 require('./rules')/require('./action_request')、reporting/builders 依赖
  // ../auth/user 与 ../lifecycle/state_projection）。
  const LIB_DIR = path.join(ROOT, 'lib');
  const directTargets = new Map(); // module -> { host, spec }（生产代码 require）
  const domainEdges = new Map(); // requirerModule -> Map(requiredModule -> { host, spec })
  const scan = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'ai_stations' && entry.name !== 'ai') scan(full);
      } else if (entry.name.endsWith('.js')) {
        const source = fs.readFileSync(full, 'utf8');
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        const modulePath = path.relative(LIB_DIR, full).split(path.sep).join('/').replace(/\.js$/, '');
        const isDomainFile = modulePath.startsWith('domains/');
        const key = isDomainFile ? modulePath.replace(/^domains\//, '') : '';
        for (const match of source.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
          const spec = match[1];
          if (!isDomainFile) {
            const m = spec.match(/^\.\/domains\/(.+)$/);
            if (!m) continue;
            const required = m[1].replace(/\.js$/, '');
            if (!directTargets.has(required)) {
              directTargets.set(required, { host: relative, spec: `require('${spec}')` });
            }
          } else {
            const resolved = path.resolve(path.dirname(full), spec);
            let resolvedPath = resolved.endsWith('.js') ? resolved : `${resolved}.js`;
            if (!fs.existsSync(resolvedPath) && fs.existsSync(path.join(resolved, 'index.js'))) {
              resolvedPath = path.join(resolved, 'index.js');
            }
            if (!fs.existsSync(resolvedPath)) continue;
            const fullRequired = path.relative(LIB_DIR, resolvedPath).split(path.sep).join('/').replace(/\.js$/, '');
            if (!fullRequired.startsWith('domains/') || fullRequired === modulePath) continue;
            const required = fullRequired.replace(/^domains\//, '');
            if (!domainEdges.has(key)) domainEdges.set(key, new Map());
            if (!domainEdges.get(key).has(required)) {
              domainEdges.get(key).set(required, { host: relative, spec: `require('${spec}')` });
            }
          }
        }
      }
    }
  };
  scan(LIB_DIR);
  // 传递闭包：从生产直接接线集合出发，跟随已接线域模块的域内 require
  const wired = new Map(directTargets); // module -> { host, spec }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [requirer, edges] of domainEdges) {
      if (!wired.has(requirer)) continue;
      for (const [required, meta] of edges) {
        if (!wired.has(required)) {
          wired.set(required, meta);
          grew = true;
        }
      }
    }
  }
  // 用户裁定保持内联/精简的模块始终按"不接线"展示（即使被已接线域模块 require）
  for (const kept of KEPT_UNWIRED) wired.delete(kept);
  const attribution = (module, meta) => {
    const hit = git(
      `log --format=%h -S "${meta.spec}" -- ${meta.host} | head -1`,
    ).split('\n')[0];
    return hit || '';
  };
  return [...wired.entries()]
    .map(([module, meta]) => ({ module, host: meta.host, commit: attribution(module, meta) }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

function parseTestCounts() {
  const source = fs.readFileSync(path.join(GOV_DIR, 'CURRENT_STATE.md'), 'utf8');
  const full = source.match(/`node --test`：全量 `(\d+)\/(\d+)`/);
  const core = source.match(/`npm test`：(?:全量 )?core `(\d+)\/(\d+)`/);
  return {
    full: full ? `${full[1]}/${full[2]}` : '—',
    core: core ? `${core[1]}/${core[2]}` : '—',
  };
}

function latestSession() {
  // 以 git 追踪为准：最近一次改动 sessions/ 目录的提交所新增的会话文件。
  const commit = git('log -1 --format=%h -- docs/governance/sessions');
  if (!commit) return '';
  const file = git(`show --name-only --format= ${commit} -- docs/governance/sessions`)
    .split('\n')
    .filter(line => line.includes('sessions/'))[0] || '';
  return file ? path.basename(file) : '';
}

function phaseBSlices(commits) {
  const map = [
    ['rejectCrmCustomer account-state writes', 'B1', 'rejectCrmCustomer 状态写收敛（state_write）'],
    ['applyCustomerReturn assignment write', 'B2', 'applyCustomerReturn 仅 assignment 收敛'],
    ['addQuote/addOrder behind a stage precondition', 'B3', 'addQuote/addOrder stage 前置校验'],
    ['addQuote/addOrder stage writes', 'B4', 'addQuote/addOrder stage 写收敛'],
    ['addQuote/addOrder next-action writes', 'B5', 'addQuote/addOrder 计划写收敛（collaboration_write）'],
    ['addActivity account writes', 'B6', 'addActivity 状态/计划/主管三路写收敛'],
    ['today-task and plan-only next-action writes', 'B7', '今日任务/纯计划写收敛'],
    ['claim, manager-task, overdue-lead, and reassign writes', 'B8', '领取/主管任务/超时线索/重分配写收敛'],
    ['recycle and restore account writes', 'B9', '回收/恢复写收敛'],
    ['route updateAccount (profile edit) state writes through gateways', 'B10', 'updateAccount profile 编辑写收敛'],
    ['drop the state DTO from pipeline rows to match account boundary', 'B11', 'pipeline 行 state DTO 边界收敛'],
    ['assert state contract on merged views in recycle/restore paths', 'B12', '回收/恢复完整视图守卫接线'],
    ['align production smoke fixture with §4.3 plan semantics', 'B13', 'smoke 种子 time_basis 收敛'],
  ];
  return map.map(([match, id, title]) => {
    const found = commits.find(commit => commit.subject.includes(match));
    return { id, title, commit: found ? `${found.hash}` : '', date: found ? found.date : '' };
  });
}

function phaseAStats(domainFiles, wired) {
  const wiredSet = new Set(wired.map(item => item.module));
  const unwired = domainFiles
    .map(file => file.replace(/\.js$/, '').replace(/^domains\//, ''))
    .filter(file => !wiredSet.has(file))
    .sort();
  return { wired, unwired, wiredCount: wired.length, total: domainFiles.length };
}

function buildPhases(env) {
  const { commits } = env;
  return [
    {
      id: '0',
      title: '阶段 0：治理基础',
      status: 'done',
      summary: '治理目录、权威顺序、前后基线（before/repo/after）、工作区迁移、会话纪律。',
      done: [
        ['governance', '治理文档体系与权威顺序建立', '09ef77e', ''],
        ['governance', '新根目录迁移与基线校准', '2026-08-29 会话', ''],
        ['governance', '进度看板自动生成（本文件）', '本次', ''],
      ],
      pending: [],
    },
    {
      id: 'A',
      title: '阶段 A：后端结构化切分（sales_crm 拆域）',
      status: 'done',
      summary: 'lib/domains 44 个文件；WIP 收敛曾回退全部接线，接线恢复已完成（41/44 已接入，含 action_request 经 write.js 域间接线，3 个按裁定保持内联）。',
      done: [
        ['domains', 'lifecycle 网关接线（state_write/collaboration_write）', '13cd37a…227b3d7', ''],
        ['domains', '纯 helper 接线：json/list/audit/notifications', '0560e9c', ''],
        ['domains', 'http 接线：error/routes', 'd51596c', ''],
        ['domains', 'csv/insights 接线', '873d1b0', ''],
        ['domains', 'activity/planning、intake/assignment、auth/customer、reporting 接线', '7328b51…13c5368', ''],
        ['domains', 'B 组：commerce/recycle、activity/present、customer/dedupe 等接线', 'a853a16…5c23b32', ''],
      ],
      pending: [],
      moduleTable: true,
    },
    {
      id: 'B',
      title: '阶段 B：状态真源',
      status: 'wip',
      summary: '§1 写点收敛完成门达成（含 updateAccount profile 编辑 aabe4d9，lib/ 对状态/计划/主管列零裸写）；§4 强化完成（守卫/投影/读路径收敛，含 assertAccountStateContract 接入回收/恢复 da34bc2）；state DTO 边界已收敛（pipeline 行不再附加，6b88d74）；smoke 种子收敛 929b8c1；契约测试 66 断言。',
      sliceTable: 'B',
      pending: [
        ['B-P1', 'AI next_action 写点（红线，仅评估）；last_activity_at 归属已明确为活动溯源', '', ''],
      ],
    },
    {
      id: 'C',
      title: '阶段 C：权限/筛选/字段',
      status: 'wip',
      summary: 'field catalog、schema 渲染、白名单投影已提交；accounts/intake/通知列表与 S3 timeline/auditLog 形状已白名单化；范围解释器等价契约（2ca107b）与代码级统一（f2056e5）、按页面权限→字段→筛选合同（45e0c05）均已落地。',
      done: [
        ['field', '字段目录与 schema 驱动显示（5 提交）', '7a26074…077c88c', ''],
        ['access', 'contact-restricted 白名单投影（access_control 直连）', '9607123…6d7e540', ''],
        ['access', '身份/筛选 facade 与认证中间件抽取（被 WIP 精简，调用方直连真源）', '003b527…61f8c34', ''],
        ['access', 'accounts 列表切字段级白名单（contactSafeAccountRecord 接线，blacklist≡whitelist 契约）', '78e698b', ''],
        ['access', 'intake 页切字段级白名单（contactSafeIntakeRecord 新投影，contact_* 隐藏）', '5e992fe', ''],
        ['access', '通知页切字段级白名单（contactSafeNotificationRecord 新投影）', '1835f73', ''],
        ['access', 'S3 形状：timeline/auditLog 白名单（含 provenance 泄漏校验）', '38bfe7d', ''],
        ['access', '范围解释器等价契约：accountScope ≡ buildAccessContext', '2ca107b', ''],
        ['access', '范围解释器代码级统一：共享 accountVisibilityScope', 'f2056e5', ''],
        ['access', '按页面权限→字段→筛选合同（sensitive/filter/whitelist 一致性）', '45e0c05', ''],
      ],
      pending: [
        ['access', '可选残值：legacy customers 形状白名单（S6 审计确认其余联系形状已源头门控）', '', ''],
        ['access', 'P1/P3 loadIntakeState 与 S5 export 暂缓（嵌套泄漏 / users 密码哈希暴露，见设计）', '', ''],
      ],
    },
    {
      id: 'D',
      title: '阶段 D：线索/任务/商业闭环',
      status: 'done',
      summary: 'intake/assignment/planning/commerce 域模块已抽取并接线；RFQ→quote→order 商业闭环与非 AI manager intervention / deferred plan 应用服务均已收口，既有权限、幂等、事务、生命周期网关和审计语义保持。',
      done: [
        ['intake', 'intake/assignment/decision/query/owner 域模块接线恢复', '48ba93c…8a0ee7d', ''],
        ['planning', 'planning/alerts/risk/streak/today_task 域模块接线恢复', '7328b51…5c23b32', ''],
        ['commerce', 'commerce 域模块接线恢复（rules/write/action_request 级联）', 'a853a16…b4cfdfc', ''],
        ['commerce', '商业闭环成型：action_request 事务边界 + 行级写 + 金额/币种/毛利校验 + commitQuote/commitOrder 域服务', '1d15546…b4cfdfc', ''],
        ['manager', '非 AI manager intervention / deferred plan 独立应用服务（注入授权、范围、生命周期网关、通知与审计）', '89e6509', ''],
      ],
      pending: [],
    },
    {
      id: 'E',
      title: '阶段 E：前端 widgets',
      status: 'done',
      summary: '阶段 E 完成门已通过：customerProfile 默认 widget、profile-only 只读兼容、独立 host、全范围非 AI List widget（含用户级多级排序）、CRM 抽屉非 AI 注册表、复杂 activity timeline widget 与旧入口兼容边界均已落地；`062f31a` 锁定 Playwright `1.62.1`，`583f314` 补齐 browser acceptance 断言，隔离临时 SQLite/loopback/AI 关闭环境下 sales/manager 双角色均通过默认 widget、无 legacy iframe、source-tag 宿主存在、AI widget/标记隐藏、profile-only 无保存动作。权限配置矩阵、事务预览/审核工作区保留专用组件；AI 列表与 AI 专用工作区冻结，不纳入迁移。',
      done: [
        ['frontend', '字段目录/widget 试点提交', '7a26074…077c88c', ''],
        ['frontend', 'widget 注册表落地 + customerProfile 注册表化组装', '2d98eea', ''],
        ['frontend', 'customerProfile 默认 widget view 接线（profile-only 兼容入口保留）', '29282df', ''],
        ['frontend', '/development-workbench profile-only 只读兼容契约（浏览器运行时无写入待验证）', 'e59bf22', ''],
        ['frontend', 'widget registry 每个 widget 独立 mount host（失败隔离/重渲染清理）', '8a86425', ''],
        ['frontend', 'profile-facts 抽为自包含 UMD widget（模板/偏好/事件下沉）', '41a722e', ''],
        ['frontend', 'drawer-facts 抽为自包含 UMD widget（三源 facts 统一）', '7c76fb3…8135ac2', ''],
        ['frontend', 'drawer-ai 抽为自包含 UMD widget（AI 问答区，AI 零改动）', '64b9418', ''],
        ['frontend', 'customer-ai-station 登记为 widget（现有开关决定挂载）', '39990be', ''],
        ['frontend', 'master-profile 抽为共用 UMD widget（三源主档统一）', '3e84f63', ''],
        ['frontend', 'insight-section 抽为共用壳 widget（洞察/商务/审计/时间线壳）', '6aa9353', ''],
        ['frontend', 'next-step 抽为共用 widget（三源状态条 + 告警条/异常明细）', 'f8e67c9…e920f7b', ''],
        ['frontend', 'timeline 抽为共用 widget（开发历史/完整时间线条目）', '93b5dbb', ''],
        ['frontend', 'identity/source tags：sourceTagMarkup 抽为自包含 UMD widget（只读投影、去重/limit/转义；AI gate 由 app 注入）', '3adc1d1', ''],
        ['frontend', 'List widget 协议 + 客户列表样板（列显隐/顺序、用户布局偏好、服务端排序预设、客户字段 schema）', 'c246360', ''],
        ['frontend', 'List widget 用户级升降序/多级排序收口（服务端授权白名单、稳定主键、非法请求 403）', '549fdfd', ''],
        ['frontend', 'Research People 列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', '3c9a97f', ''],
        ['frontend', 'Research Recon 列表迁移（授权列 schema、用户布局偏好、三种服务端排序）', '2f3dc4a', ''],
        ['frontend', '不对口记录列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', '1bbc5c4', ''],
        ['frontend', 'Pipeline 推进动作台列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', 'eb73388', ''],
        ['frontend', 'Intake/lead_flow 线索列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', 'fffde40', ''],
        ['frontend', 'Alerts/今日待办列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', 'dfe5937', ''],
        ['frontend', '通知中心列表迁移（授权列 schema、用户布局偏好、四种服务端排序）', '302454f', ''],
        ['frontend', 'Dashboard 国家转化与价值快照迁移（授权列 schema、用户级布局偏好、六种本地排序）', 'ebf0dbe', ''],
        ['frontend', 'Markets 国家矩阵、分配批次与细分报表迁移（授权列 schema、用户级布局偏好、本地排序预设）', 'cd9f198', ''],
        ['frontend', '主管任务列表迁移（授权列 schema、用户级布局偏好、期限/状态/负责人排序，保留任务动作）', 'b1fa1cc', ''],
        ['frontend', '主管风险明细列表迁移（授权列 schema、独立用户布局偏好、期限/状态/负责人排序，保留查看历史动作）', '807b56c', ''],
        ['frontend', '主管指标列表迁移（聚合字段 schema、独立用户布局偏好、销售/指标排序，保留数字钻取动作）', 'ed40d76', ''],
        ['frontend', 'Team 进度/协作列表迁移（三套非 AI 字段 schema、独立用户布局偏好、排序与原有钻取/追加动作）', 'a52e42b', ''],
        ['frontend', 'Insights 人工评价列表迁移（非 AI 字段 schema、独立用户布局偏好、服务端排序与人工评价动作）', '75a30b7', ''],
        ['frontend', '受保护客户目录迁移（授权人工字段 schema、用户布局偏好、安全服务端排序，保留导入/批次/冲突/导出/行操作）', 'f1fe7d1', ''],
        ['frontend', '维护运行记录只读列表迁移（人工字段 schema、用户布局偏好、本地排序，保留 limit=20 与预览/执行契约）', '6001f61', ''],
        ['frontend', '跟进更正历史只读列表迁移（人工字段 schema、用户布局偏好、本地排序，保留筛选/分页与 target/proposal/review 审批流）', '61a6572', ''],
        ['frontend', '审计只读列表迁移（人工字段 schema、用户布局偏好、当前 bootstrap 结果本地排序，保留 view_users/脱敏/详情截断）', '3e55b41', ''],
        ['frontend', '账号、归档用户、权限组、迁移复核与入库批次列表迁移（人工字段 schema、用户级列显隐/顺序/排序，保留高风险动作门控）', '8d1bb05', ''],
        ['frontend', '权限配置矩阵及事务预览/审核工作区明确为专用组件例外；AI 列表与 AI 专用工作区保持弃用冻结', '8d1bb05', ''],
        ['frontend', 'Phase E 隔离浏览器预览 harness（临时 SQLite/loopback/随机端口/AI 关闭/fail-closed）', 'dd650ba', ''],
        ['frontend', 'Phase E harness 加强：验证默认 customerProfile widget/iframe 边界与 profile-only 只读动作', '3b2fe24', ''],
        ['frontend', 'CRM 抽屉非 AI 区块纳入 crmDrawer 注册表；默认 widget 模式清理兼容 iframe src，legacy-only 刷新', '79036e5', ''],
        ['frontend', '复杂 CRM activity timeline 条目 widget 化（宿主注入权限/溯源回调，保留 inline fallback）', '092d8a0', ''],
        ['frontend', '旧入口兼容边界锁定：统一根路径为 canonical，/legacy 与 /tradelead-v2.html 仅在 CRM_ENABLE_LEGACY=true 时开放', 'bc84567', ''],
        ['frontend', 'Phase E sales/manager 浏览器验收（Playwright 1.62.1、默认 widget/无 iframe、source-tag 宿主、AI 关闭、profile-only 只读）', '062f31a…583f314', ''],
      ],
      pending: [],
    },
    {
      id: 'F',
      title: '阶段 F：AI 零动作',
      status: 'done',
      summary: 'lib/ai_stations/**、crm_ai_*、CRM_AI_* 与既有 AI 触发点零改动（红线持续遵守）。',
      done: [['ai', 'AI 面冻结持续核验', '持续', '']],
      pending: [],
    },
    {
      id: 'G',
      title: '阶段 G：兼容层收尾',
      status: 'done',
      summary: '兼容层路由/入口装配已收敛：旧 HTML 入口、profile 资源、认证/账号、列表/读取、团队/主管、活动、受保护客户、bootstrap、业务写入与后台管理路由均由独立注册器装配；资料聚合、迁移复核、入库/评价和 AI 运行时等高耦合边界按审计保留原位。',
      done: [
        ['compat', '旧入口 /legacy 与 /tradelead-v2.html 抽为独立可选装配，保持 CRM_ENABLE_LEGACY 与 canonical / 行为', 'd615410', ''],
        ['compat', 'profile 资源与 development-workbench 权限分流抽为独立装配', '7d6e88a', ''],
        ['compat', '团队/协作、联系人、页面入口与认证/账号路由注册器接线', '23b6365…bf1f114', ''],
        ['compat', '读取/列表、主管、活动、受保护客户路由注册器接线', 'fc5bfcd…4be94c3', ''],
        ['compat', 'bootstrap、业务写入与后台管理/维护/筛选路由注册器接线', '077617b…f0ab815', ''],
        ['compat', '高耦合资料聚合、迁移复核、密码、入库/评价与 AI 路由保留原位并记录边界', '审计结论', ''],
      ],
      pending: [],
    },
  ];
}

function renderMarkdown(env, phases, aStats) {
  const lines = [];
  lines.push('# TradePulse 重构进度看板');
  lines.push('');
  lines.push(`> 自动生成于 \`${env.stamp}\`；运行 \`npm run board\` 手动重新生成，每个切片收尾自动更新。`);
  lines.push(`> 数据源：git 提交（origin/main..HEAD）、lib/ 代码扫描、CURRENT_STATE.md、sessions/。`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push('| 指标 | 当前值 |');
  lines.push('|---|---|');
  lines.push(`| 分支 | \`${env.branch}\` |`);
  lines.push(`| HEAD | \`${env.headShort}\`（相对 origin/main ahead ${env.ahead}） |`);
  lines.push(`| 工作区 | ${env.clean ? '干净' : '有未提交改动'} |`);
  lines.push(`| 全量测试 | \`node --test\` ${env.tests.full} |`);
  lines.push(`| 核心测试 | \`npm test\` ${env.tests.core} |`);
  lines.push(`| sales_crm.js | ${env.salesLines} 行 |`);
  lines.push(`| lib/domains | ${aStats.total} 个文件，生产接线 ${aStats.wiredCount} 个 |`);
  lines.push(`| 最近会话 | \`${env.latestSession}\` |`);
  lines.push('');
  lines.push('## 提交分布（origin/main..HEAD）');
  lines.push('');
  lines.push('| 类别 | 数量 |');
  lines.push('|---|---|');
  lines.push(`| refactor(state) 状态写收敛 | ${countType(env.commits, 'refactor\\(state\\)')} |`);
  lines.push(`| refactor(domains) 域接线 | ${countType(env.commits, 'refactor\\(domains\\)')} |`);
  lines.push(`| refactor(其他/通用) | ${env.commits.filter(c => /^refactor\((?!state|domains)/.test(c.subject)).length} |`);
  lines.push(`| feat(...) | ${countType(env.commits, 'feat')} |`);
  lines.push(`| docs(governance) | ${countType(env.commits, 'docs\\(governance\\)')} |`);
  lines.push(`| 其他 | ${env.commits.filter(c => !/^(refactor|feat|docs)\(/.test(c.subject)).length} |`);
  lines.push('');
  for (const phase of phases) {
    lines.push(`## ${phase.title}`);
    lines.push('');
    const statusBadge = phase.status === 'done' ? '**已完成**'
      : phase.status === 'wip' ? '**进行中**' : '**待办**';
    lines.push(`> ${statusBadge} — ${phase.summary}`);
    lines.push('');
    if (phase.moduleTable && phase.id === 'A') {
      lines.push('### 域模块接线状态（自动扫描）');
      lines.push('');
      lines.push('| 模块 | 状态 | 接线提交 |');
      lines.push('|---|---|---|');
      for (const item of aStats.wired) {
        lines.push(`| \`lib/domains/${item.module}.js\` | [x] 已接线 | ${item.commit || '历史抽取'} |`);
      }
      for (const module of aStats.unwired) {
        const state = KEPT_UNWIRED.has(module)
          ? '按裁定保持内联（不接线）'
          : '未接线（被 WIP 回退，待恢复）';
        lines.push(`| \`lib/domains/${module}.js\` | [ ] ${state} | — |`);
      }
      lines.push('');
    }
    if (phase.sliceTable === 'B') {
      const slices = env.phaseB;
      lines.push('### 已落地切片');
      lines.push('');
      lines.push('| 切片 | 提交 | 日期 |');
      lines.push('|---|---|---|');
      for (const slice of slices) {
        lines.push(`| ${slice.title} | \`${slice.commit}\` | ${slice.date} |`);
      }
      lines.push('');
      lines.push('### 待办');
      lines.push('');
      for (const [id, title, _commit] of phase.pending) {
        lines.push(`- [ ] **${id}** ${title}`);
      }
      lines.push('');
      continue;
    }
    if (phase.done.length) {
      lines.push('### 已完成');
      lines.push('');
      for (const [_tag, title, commit, date] of phase.done) {
        lines.push(`- [x] ${title}${commit ? `（\`${commit}\`${date ? `，${date}` : ''}）` : ''}`);
      }
      lines.push('');
    }
    if (phase.pending.length) {
      lines.push('### 待办');
      lines.push('');
      for (const [id, title, _commit, _date] of phase.pending) {
        lines.push(`- [ ] **${id || '待办'}** ${title}`);
      }
      lines.push('');
    }
  }
  lines.push('## 阶段门禁');
  lines.push('');
  lines.push('- `git diff --check` 通过；全量与专项测试绿灯；权限/状态/筛选回归通过。');
  lines.push('- 工作区干净；治理文档（CURRENT_STATE + session + 看板）随业务独立提交。');
  lines.push('');
  lines.push('## 红线');
  lines.push('');
  lines.push('- 不修改 `lib/ai_stations/**`、`crm_ai_*`、`CRM_AI_*` 及既有 AI 触发点。');
  lines.push('- 不 push、不 merge、不部署、不改生产数据；只在 `after/` 内工作。');
  return `${lines.join('\n')}\n`;
}

function renderHtml(env, phases, aStats) {
  const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const badge = status => status === 'done'
    ? '<span class="badge done">已完成</span>'
    : status === 'wip' ? '<span class="badge wip">进行中</span>' : '<span class="badge todo">待办</span>';
  const phaseCards = phases.map(phase => {
    let body = '';
    if (phase.moduleTable && phase.id === 'A') {
      body += '<div class="module-table">';
      for (const item of aStats.wired) {
        body += `<div class="row"><span class="ok">[x]</span><code>${esc(item.module)}</code><span class="commit">${esc(item.commit || '历史抽取')}</span></div>`;
      }
      for (const module of aStats.unwired) {
        const state = KEPT_UNWIRED.has(module)
          ? `<span class="commit muted">按裁定内联</span>`
          : `<span class="commit muted">待恢复</span>`;
        body += `<div class="row"><span class="no">[ ]</span><code>${esc(module)}</code>${state}</div>`;
      }
      body += '</div>';
    }
    if (phase.sliceTable === 'B') {
      body += '<div class="module-table">';
      for (const slice of env.phaseB) {
        body += `<div class="row"><span class="ok">[x]</span><span class="title">${esc(slice.title)}</span><span class="commit">${esc(slice.commit)}</span></div>`;
      }
      body += '</div><div class="pending">';
      for (const [id, title] of phase.pending) {
        body += `<div class="row"><span class="no">[ ]</span><span class="title"><b>${esc(id)}</b> ${esc(title)}</span></div>`;
      }
      body += '</div>';
    }
    if (phase.done && phase.done.length) {
      body += '<div class="done-list">';
      for (const [_tag, title, commit] of phase.done) {
        body += `<div class="row"><span class="ok">[x]</span><span class="title">${esc(title)}</span><span class="commit">${esc(commit)}</span></div>`;
      }
      body += '</div>';
    }
    if (phase.pending && phase.pending.length && phase.sliceTable !== 'B') {
      body += '<div class="pending">';
      for (const [id, title] of phase.pending) {
        body += `<div class="row"><span class="no">[ ]</span><span class="title"><b>${esc(id || '待办')}</b> ${esc(title)}</span></div>`;
      }
      body += '</div>';
    }
    return `<section class="phase"><header>${badge(phase.status)}<h2>${esc(phase.title)}</h2></header><p class="summary">${esc(phase.summary)}</p>${body}</section>`;
  }).join('');

  const commitRows = env.commits.slice(0, 40).map(commit =>
    `<tr><td class="mono">${esc(commit.hash)}</td><td>${esc(commit.subject)}</td><td>${esc(commit.date)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TradePulse 重构进度看板</title>
<style>
  :root { --bg:#0f1520; --panel:#161f2e; --panel2:#1c2738; --text:#e6edf6; --muted:#8fa1b8;
    --ok:#3fb68b; --wip:#e8a33d; --todo:#5b6b82; --line:#243248; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1180px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:20px; }
  .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:22px; }
  .metric { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .metric .k { color:var(--muted); font-size:11px; }
  .metric .v { font-size:16px; font-weight:600; margin-top:2px; }
  .phase { background:var(--panel); border:1px solid var(--line); border-radius:12px; margin-bottom:16px; padding:16px 18px; }
  .phase header { display:flex; align-items:center; gap:10px; }
  .phase h2 { font-size:16px; margin:0; }
  .summary { color:var(--muted); font-size:12px; margin:8px 0 12px; }
  .badge { font-size:11px; padding:2px 8px; border-radius:20px; font-weight:600; white-space:nowrap; }
  .badge.done { background:rgba(63,182,139,.16); color:var(--ok); }
  .badge.wip { background:rgba(232,163,61,.16); color:var(--wip); }
  .badge.todo { background:rgba(91,107,130,.2); color:var(--muted); }
  .row { display:flex; align-items:baseline; gap:8px; padding:4px 0; border-bottom:1px dashed var(--line); }
  .row:last-child { border-bottom:none; }
  .row code, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:#c7d6ea; }
  .ok { color:var(--ok); font-family:ui-monospace,Menlo,monospace; }
  .no { color:var(--todo); font-family:ui-monospace,Menlo,monospace; }
  .commit { margin-left:auto; color:var(--muted); font-size:11px; }
  .muted { color:var(--todo); }
  .title { font-size:13px; }
  .pending { margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:5px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; }
  .commits { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .commits h2 { font-size:16px; margin:0 0 10px; }
  @media (max-width:640px){ .row { flex-wrap:wrap; } .commit { margin-left:0; } }
</style>
</head>
<body><div class="wrap">
  <h1>TradePulse 重构进度看板</h1>
  <div class="meta">自动生成于 ${esc(env.stamp)} · 运行 <code>npm run board</code> 重新生成 · 每个切片收尾自动更新 · 数据源：git + lib/ 扫描 + CURRENT_STATE.md + sessions/</div>
  <div class="metrics">
    <div class="metric"><div class="k">分支</div><div class="v">${esc(env.branch)}</div></div>
    <div class="metric"><div class="k">HEAD</div><div class="v mono">${esc(env.headShort)}</div></div>
    <div class="metric"><div class="k">ahead origin/main</div><div class="v">${env.ahead}</div></div>
    <div class="metric"><div class="k">工作区</div><div class="v">${env.clean ? '干净' : '有改动'}</div></div>
    <div class="metric"><div class="k">全量测试</div><div class="v">${esc(env.tests.full)}</div></div>
    <div class="metric"><div class="k">核心测试</div><div class="v">${esc(env.tests.core)}</div></div>
    <div class="metric"><div class="k">sales_crm.js</div><div class="v">${env.salesLines} 行</div></div>
    <div class="metric"><div class="k">lib/domains</div><div class="v">${aStats.wiredCount}/${aStats.total} 已接线</div></div>
  </div>
  ${phaseCards}
  <div class="commits">
    <h2>最近提交（origin/main..HEAD，前 40 条）</h2>
    <table><thead><tr><th>提交</th><th>说明</th><th>日期</th></tr></thead>
    <tbody>${commitRows}</tbody></table>
  </div>
</div></body></html>
`;
}

function main() {
  const watch = process.argv.includes('--watch');
  const generate = () => {
    const env = {
      stamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      ...collectGitState(),
      tests: parseTestCounts(),
      latestSession: latestSession(),
      salesLines: Number(sh('wc -l lib/sales_crm.js').split(/\s+/)[0] || 0),
    };
    env.phaseB = phaseBSlices(env.commits);
    const aStats = phaseAStats(domainFileList(), wiredDomainModules());
    const phases = buildPhases(env);

    fs.writeFileSync(BOARD_MD, renderMarkdown(env, phases, aStats));
    fs.writeFileSync(BOARD_HTML, renderHtml(env, phases, aStats));
    const stamp = env.stamp;
    console.log(`[progress-board] ${stamp} 已生成 PROGRESS_BOARD.md 与 progress-board.html`);
    console.log(`[progress-board] HEAD=${env.headShort} ahead=${env.ahead} 测试=${env.tests.full} sales_crm=${env.salesLines} 行 domains=${aStats.wiredCount}/${aStats.total}`);
  };
  generate();
  if (!watch) return;

  const watched = [
    path.join(GOV_DIR, 'CURRENT_STATE.md'),
    path.join(GOV_DIR, 'sessions'),
    path.join(ROOT, 'lib', 'sales_crm.js'),
  ];
  console.log('[progress-board] watch 模式：监听 sessions/、CURRENT_STATE.md、sales_crm.js 变化，Ctrl+C 退出');
  for (const target of watched) {
    fs.watch(target, { recursive: target.endsWith('sessions') }, (_event, name) => {
      if (!name || String(name).endsWith('.swp') || String(name).startsWith('.')) return;
      try { generate(); } catch (error) { console.error('[progress-board] 重新生成失败：', error.message); }
    });
  }
}

main();

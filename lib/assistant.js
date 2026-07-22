const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { vectorSearch } = require('./assistant_index');
const { callHermes } = require('./hermes_assistant');
const { callKimi } = require('./kimi_assistant');
const { getAssistantRouter } = require('./assistant_router');
const { assertExternalCustomerAccess, forbidden, redactContactFields } = require('./access_control');

const assistantAccess = new AsyncLocalStorage();

function databasePath() {
  return path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db'));
}
const DEFAULT_MAX_ROWS = 12;
const DEFAULT_LIST_ROWS = 50;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 3000;
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_WEB_RESULTS = 5;
const DEFAULT_WEB_FETCH_PAGES = 3;

const STOP_WORDS = new Set([
  '什么', '哪些', '哪个', '一下', '帮我', '客户', '公司', '数据库', '里面', '这个', '那个',
  '有没有', '是否', '需要', '找出', '查询', '回答', '情况', '信息', '以及', '或者',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'which', 'show', 'find',
]);

const DOMAIN_KEYWORDS = [
  'MCU', 'PLC', 'VFD', 'FPGA', 'DSP', 'PCB', 'SMT', 'RF', 'IGBT', 'MOSFET',
  '传感器', '连接器', '电源', '电源管理', '功率器件', '被动元件', '通信模块', '无线模块',
  '汽车电子', '工业控制', '工业自动化', '医疗设备', '无人机', '机床', 'CNC', '机器人',
  '采购', '联系人', '邮箱', '电话', 'WhatsApp', 'Telegram', 'INN', '制裁', '风险',
  '跟进', '报价', '询价', '有兴趣', '暂无回复', '今日', '逾期', '高评级',
];

const THIRD_PARTY_HOSTS = [
  'indeed.', 'linkedin.', 'facebook.', 'vk.com', 'instagram.', 'twitter.', 'x.com',
  'crunchbase.', 'zoominfo.', 'apollo.', 'rocketreach.', 'dnb.', 'glassdoor.',
  'wikipedia.', 'bloomberg.', 'kompass.', 'yellowpages.', '2gis.', 'yelp.',
  'made-in-china.', 'alibaba.', 'indiamart.', 'tradeindia.', 'exportersindia.',
];

const GENERIC_TITLE_WORDS = new Set([
  'how', 'to', 'create', 'company', 'profile', 'steps', 'with', 'example', 'indeed',
  'official', 'website', 'home', 'homepage', 'about', 'contact', 'contacts', 'profile',
]);

const USER_BUSINESS_PROFILE = [
  '用户画像：用户是中国电子元器件/工业电子供应链销售与业务开发方，不是泛泛做公司名录。',
  '核心目的：用自动化搜索、Recon、官网证据和 CRM 数据，把海外市场中可能真实采购电子元器件、工控备件、存储/内存器件的公司筛成可联系、可判断、可开发的销售线索。',
  '三条增长线：1) 俄罗斯工业电子主线：终端制造商、维修服务商、系统集成商、工业渠道商；2) 巴西市场扩展线：用葡语市场渠道寻找工业自动化、CNC、电机/驱动、控制柜、电子元器件分销客户；3) 俄罗斯存储/内存专项线：围绕 DRAM、DDR4/DDR5、SSD、NAND、主控、服务器/工控机 BOM、EMS/SMT/组装厂和存储渠道商。',
  '可提供/可切入产品：MCU/DSP/FPGA、功率器件(IGBT/MOSFET/二极管/晶闸管)、传感器、连接器、继电器、电容/被动件、电源模块、PLC/VFD/伺服/CNC 相关器件、电机/编码器/工控备件，以及裸 DRAM、白板 DDR4/DDR5、白板 SSD、NAND、主控、PCB/BOM 配套。',
  '价值判断标准：客户是否真实消耗上述物料；是否有明确产品/设备/服务场景；是否有采购入口或可核验官网证据；是否存在国产替代、现货/难找料、供应链替代、BOM 配套或维修备件机会；是否属于三条增长线之一。',
  '回答要求：每次判断客户时都要站在用户的供应链销售视角，明确“属于哪条增长线/不属于哪条线、能卖什么、为什么可能买、证据是什么、缺什么、下一步怎么查或怎么联系”。',
].join('\n');

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?").get(table));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function installScopedView(db, table, { empty = false, redact = [] } = {}) {
  if (!tableExists(db, table)) return;
  const columns = db.prepare(`PRAGMA main.table_info(${quoteIdentifier(table)})`).all();
  const redacted = new Set(redact);
  const select = columns.map(column => redacted.has(column.name)
    ? `'' AS ${quoteIdentifier(column.name)}`
    : `source.${quoteIdentifier(column.name)}`).join(', ');
  const where = empty ? '0' : 'source.customer_id IN (SELECT customer_id FROM assistant_allowed_customers)';
  db.exec(`CREATE TEMP VIEW ${quoteIdentifier(table)} AS SELECT ${select} FROM main.${quoteIdentifier(table)} source WHERE ${where}`);
}

function applyAssistantScope(db, accessContext) {
  if (!accessContext) return;
  db.exec('CREATE TEMP TABLE assistant_allowed_customers(customer_id TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT INTO assistant_allowed_customers(customer_id) VALUES (?)');
  for (const customerId of accessContext.externalCustomerIds || []) insert.run(String(customerId));
  const canViewContacts = Boolean(accessContext.permissions?.view_contacts);
  const canViewRecon = Boolean(accessContext.permissions?.view_recon);
  const contactColumns = canViewContacts ? [] : [
    'email', 'phone', 'contact', 'contact_name', 'contact_title', 'contacts_summary',
    'contact_summary', 'person_summary', 'methods_summary', 'result_json', 'report_path',
    'notes', 'feedback', 'reason', 'next_action', 'outreach_angle', 'opportunity_summary',
    'description', 'products', 'product_focus', 'recommended_products', 'deep_report',
    'source_file', 'evidence_url', 'artifacts_json', 'business_summary',
  ];
  installScopedView(db, 'customers', { redact: contactColumns });
  installScopedView(db, 'customer_pool', { redact: contactColumns });
  installScopedView(db, 'customer_tags');
  installScopedView(db, 'recon_jobs', { empty: !canViewRecon, redact: contactColumns });
  installScopedView(db, 'recon_results', { empty: !canViewRecon, redact: contactColumns });
  installScopedView(db, 'recon_evidence', { empty: !canViewRecon || !canViewContacts });
  installScopedView(db, 'contact_recon_jobs', { empty: !canViewContacts, redact: contactColumns });
}

function getDb() {
  const db = new Database(databasePath(), { readonly: true });
  applyAssistantScope(db, assistantAccess.getStore());
  return db;
}

function maxRows() {
  const n = Number(process.env.ASSISTANT_MAX_ROWS || DEFAULT_MAX_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : DEFAULT_MAX_ROWS;
}

function listRows() {
  const n = Number(process.env.ASSISTANT_LIST_ROWS || DEFAULT_LIST_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : DEFAULT_LIST_ROWS;
}

function pageSize() {
  const n = Number(process.env.ASSISTANT_PAGE_SIZE || DEFAULT_PAGE_SIZE);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : DEFAULT_PAGE_SIZE;
}

function timeoutMs() {
  const n = Number(process.env.ASSISTANT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : DEFAULT_TIMEOUT_MS;
}

function boundedAssistantTimeout(value, fallback = timeoutMs()) {
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) ? parsed : Number(fallback);
  const safeFallback = Number.isFinite(selected) ? selected : DEFAULT_TIMEOUT_MS;
  return Math.max(1000, Math.min(Math.floor(safeFallback), 180000));
}

function maxTokens() {
  const n = Number(process.env.ASSISTANT_MAX_TOKENS || DEFAULT_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8000) : DEFAULT_MAX_TOKENS;
}

function webResultsLimit() {
  const n = Number(process.env.ASSISTANT_WEB_RESULTS || DEFAULT_WEB_RESULTS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10) : DEFAULT_WEB_RESULTS;
}

function webFetchPagesLimit() {
  const n = Number(process.env.ASSISTANT_WEB_FETCH_PAGES || DEFAULT_WEB_FETCH_PAGES);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5) : DEFAULT_WEB_FETCH_PAGES;
}

function webSearchMode() {
  return String(process.env.ASSISTANT_WEB_SEARCH || 'auto').trim().toLowerCase();
}

function webSearchAvailable() {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY) && webSearchMode() !== 'off' && webSearchMode() !== 'false';
}

function todayKey() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortText(value, limit = 260) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToReadableText(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeReadLocalReport(reportPath, reportRoot) {
  const value = cleanText(reportPath);
  if (!value) return '';
  try {
    const root = path.resolve(reportRoot);
    const resolved = path.resolve(value);
    if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved) || !/\.(html?|md|txt)$/i.test(resolved)) return '';
    const raw = fs.readFileSync(resolved, 'utf8').slice(0, 250000);
    const text = /\.html?$/i.test(resolved) ? htmlToReadableText(raw) : cleanText(raw);
    return shortText(text, 14000);
  } catch (_e) {
    return '';
  }
}

function safeReadReconReport(reportPath) {
  return safeReadLocalReport(
    reportPath,
    process.env.RECON_OUTPUT_DIR || path.join(__dirname, '..', 'recon-runs'),
  );
}

function safeReadContactReport(reportPath) {
  return safeReadLocalReport(reportPath, path.join(__dirname, '..', 'contact-recon-reports'));
}

function extractHtmlTitle(html) {
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return cleanText(decodeHtmlEntities(title));
}

function isNoisyOpportunitySummary(value) {
  const text = cleanText(value);
  if (!text) return true;
  return /now i have|let me compile|compile (the )?(final|complete) report|已有足够数据|开始编译|开始整理完整报告|尽调报告$/i.test(text)
    || /^[^|]{1,80}\s*\|\s*(https?:\/\/|[\w.-]+\.[a-z]{2,})\s*\|\s*评分/i.test(text);
}

function normalizedOpportunity(row = {}) {
  const candidates = [
    row.outreach_angle,
    row.next_action,
    isNoisyOpportunitySummary(row.opportunity_summary) ? '' : row.opportunity_summary,
    row.recommended_products ? `可切入产品：${row.recommended_products}` : '',
  ];
  return cleanText(candidates.find(item => cleanText(item)) || '');
}

function hasAny(text, terms) {
  const haystack = String(text || '').toLowerCase();
  return terms.some(term => haystack.includes(term.toLowerCase()));
}

function wantsList(message) {
  return hasAny(message, ['哪些', '有哪些', '列出', '所有', '清单', '名单', 'list', 'show all', 'which']);
}

function wantsContinue(message) {
  return /^(继续|下一页|更多|next|more)$/i.test(cleanText(message));
}

function wantsSemantic(message) {
  return hasAny(message, [
    '类似', '相似', '像', '画像接近', '潜在', '可能需要', '可能会需要',
    '报告里', '正文', '线索', '采购部', '采购邮箱', '语义', 'semantic',
  ]);
}

function wantsTemplate(message) {
  return hasAny(message, [
    '写开发信', '邮件', 'whatsapp', '话术', '客户画像', '合规摘要', '下一步', '怎么跟进', '优先级',
    '值得开发', '是否值得', '开发等级', '需求匹配', '匹配度', '采购入口', '外联策略', '销售判断',
  ]);
}

function wantsExternalSearch(message) {
  return hasAny(message, [
    '外查', '网上', '官网', '最新', '公开信息', '再去查', '补充查', '查一下',
    '采购入口', '采购负责人', '采购经理', '联系人', '邮箱', '电话', '决策人',
    '开发信', '画像', '怎么跟进', '相似客户', '供应链', '询价线索',
    '值得开发', '是否值得', '客户业务', '做什么', '需求匹配', '匹配度', '外联策略', '开发判断',
  ]);
}

function forbidsExternalSearch(message) {
  return hasAny(cleanText(message), [
    '不要外查', '禁止外查', '不要联网', '不用联网', '不联网', '仅数据库', '只查数据库',
    '只看数据库', '仅看报告', '只看报告', '只用已有', '不要公开搜索', '无需外查',
  ]);
}

function wantsOfficialSite(message) {
  return hasAny(message, ['官网', '官方网站', 'official site', 'official website', 'homepage', '是不是官网吗', '官网吗']);
}

function salesWorkflowInstruction(message) {
  const text = cleanText(message);
  if (hasAny(text, ['值得开发', '是否值得', '开发等级', '优先级', '今天开发', '销售判断'])) {
    return [
      '销售任务：判断客户是否值得投入。',
      '回答结构：结论先行；先判断属于哪条增长线（俄罗斯工业电子/巴西工业电子/俄罗斯存储内存/不匹配）；开发等级 A/B/C/暂缓；值得/不值得的依据；最大机会点；最大不确定性；下一步最小动作。',
      '不要只列字段，要说清楚“为什么销售应该/不应该花时间”。',
    ].join('\n');
  }
  if (hasAny(text, ['到底做什么', '做什么的', '主营', '应用场景', '客户画像', '画像'])) {
    return [
      '销售任务：解释客户到底做什么。',
      '回答结构：一句话解释；产品/服务；客户群或应用场景；可能使用的电子元器件；我们可能卖什么；仍需确认的事实。',
      '不要照抄行业字段，要翻译成销售能理解的业务语言。',
    ].join('\n');
  }
  if (hasAny(text, ['需求匹配', '匹配度', '可能需要', 'mcu', 'igbt', 'mosfet', '传感器', '连接器', '电源', '被动元件'])) {
    return [
      '销售任务：判断产品需求匹配度。',
      '回答结构：先给总体匹配度；再按产品线评估功率器件、MCU/控制器、传感器、连接器、被动元件、电源模块；每项说明匹配依据、可信度、推荐切入话题。',
      '不能把所有产品都一股脑推荐；证据不足的产品要降级为待确认。',
    ].join('\n');
  }
  if (hasAny(text, ['采购入口', '采购邮箱', '采购部', '联系人', '供应链', '询价线索', '电话', '邮箱'])) {
    return [
      '销售任务：寻找采购入口与联系人。',
      '回答结构：按“已验证联系人 / 入口邮箱电话 / 官网联系入口 / 疑似采购线索 / 未找到”分类；每条给来源、可信度、下一步核验动作。',
      '不要把第三方目录、招聘网站、泛公司介绍页当成官网或已验证联系人。',
    ].join('\n');
  }
  if (hasAny(text, ['合规', '风险', '制裁', '军工', '敏感'])) {
    return [
      '销售任务：合规与风险判断。',
      '回答结构：制裁事实；军工/敏感行业信号；普通商业风险；信息不足；人工复核点；业务含义。',
      '不要把制裁简单等同于不能开发；只陈述事实和复核要求。',
    ].join('\n');
  }
  if (hasAny(text, ['外联策略', '开发信', '邮件', '话术', '怎么开口', '首封'])) {
    return [
      '销售任务：设计第一轮外联策略。',
      '回答结构：联系对象；渠道；开场角度；首封邮件主题；中文策略；英文/俄文草稿；必须确认的问题；不要提的内容。',
      '外联内容要贴客户业务场景，避免泛泛介绍元器件供应商。',
    ].join('\n');
  }
  return [
    '销售任务：综合判断。',
    '默认思考顺序：这个客户属于哪条增长线；它是谁；靠什么赚钱；为什么可能买我们的东西；证据够不够；找谁联系；怎么开口；风险在哪里；下一步最小动作是什么。',
    '回答时输出结论、依据、缺口和下一步，而不是字段复述。',
  ].join('\n');
}

function extractTerms(message) {
  const text = cleanText(message);
  const rawTerms = [];
  rawTerms.push(...(text.match(/[A-Z]{2}-\d{3,}/gi) || []));
  rawTerms.push(...(text.match(/RR-\d{8,}[-A-Z0-9]*/gi) || []));
  rawTerms.push(...(text.match(/[a-z0-9.-]+\.[a-z]{2,}/gi) || []));
  rawTerms.push(...(text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []));
  rawTerms.push(...(text.match(/\b\d{10,12}\b/g) || []));
  rawTerms.push(...(text.match(/[A-Za-z][A-Za-z0-9+.-]{1,}/g) || []));
  rawTerms.push(...(text.match(/[А-Яа-яЁё][А-Яа-яЁё0-9-]{1,}/g) || []));
  rawTerms.push(...(text.match(/[\u4e00-\u9fff]{2,}/g) || []));
  DOMAIN_KEYWORDS.forEach(term => {
    if (text.toLowerCase().includes(term.toLowerCase())) rawTerms.push(term);
  });
  return Array.from(new Set(rawTerms
    .map(term => cleanText(term).replace(/^https?:\/\//i, '').replace(/^www\./i, ''))
    .filter(term => term.length >= 2 && !STOP_WORDS.has(term.toLowerCase()))
  )).slice(0, 18);
}

function likePattern(term) {
  return `%${String(term).replace(/[%_]/g, '\\$&')}%`;
}

function buildLikeWhere(columns, terms) {
  const safeTerms = terms.slice(0, 8);
  if (!safeTerms.length) return { where: '1 = 0', params: [] };
  const clauses = [];
  const params = [];
  safeTerms.forEach(term => {
    const clause = columns.map(col => `${col} LIKE ? ESCAPE '\\'`).join(' OR ');
    clauses.push(`(${clause})`);
    columns.forEach(() => params.push(likePattern(term)));
  });
  return { where: clauses.join(' OR '), params };
}

function allSafe(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (_e) {
    return [];
  }
}

function oneSafe(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (_e) {
    return null;
  }
}

function countSafe(db, sql, params = []) {
  const row = oneSafe(db, sql, params);
  return Number(row?.total || row?.count || 0) || 0;
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  try {
    return JSON.parse(Buffer.from(clean, 'base64url').toString('utf8'));
  } catch (_e) {
    return null;
  }
}

function resultSet(rows, total, limit, label) {
  const returned = rows.length;
  return {
    label,
    total,
    returned,
    limit,
    omitted: Math.max(0, total - returned),
    truncated: total > returned,
    rows,
  };
}

function selectSet(db, label, selectSql, countSql, params, limit) {
  const total = countSafe(db, countSql, params);
  const rows = allSafe(db, selectSql, [...params, limit]);
  return resultSet(rows, total, limit, label);
}

function getStats(db) {
  const rows = allSafe(db, `
    SELECT 'customers' AS name, COUNT(*) AS count FROM customers
    UNION ALL SELECT 'customer_pool', COUNT(*) FROM customer_pool
    UNION ALL SELECT 'recon_results', COUNT(*) FROM recon_results
    UNION ALL SELECT 'recon_results_with_report_path', COUNT(*) FROM recon_results WHERE report_path != ''
    UNION ALL SELECT 'recon_results_sanctioned', COUNT(*) FROM recon_results WHERE sanctioned = 'true' OR compliance_status LIKE '%sanction%'
    UNION ALL SELECT 'recon_evidence', COUNT(*) FROM recon_evidence
  `);
  return Object.fromEntries(rows.map(row => [row.name, row.count]));
}

function searchCustomers(db, terms, limit) {
  const customerWhere = buildLikeWhere([
    'follow_id', 'customer_id', 'company_name', 'website', 'customer_type', 'industry',
    'rating', 'products', 'reason', 'email', 'phone', 'contact', 'owner', 'status',
    'feedback', 'next_action', 'invalid_reason', 'notes',
  ], terms);
  const poolWhere = buildLikeWhere([
    'customer_id', 'domain', 'company_name', 'russian_name', 'english_name', 'country',
    'city', 'website', 'industry', 'customer_type', 'description', 'products', 'rating',
    'current_pool', 'phone', 'email', 'inn', 'risk_status', 'website_verification',
    'deep_report', 'source_file', 'verified', 'notes',
  ], terms);
  return {
    followed: selectSet(db, 'followed_customers', `
      SELECT * FROM customers WHERE ${customerWhere.where} ORDER BY follow_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customers WHERE ${customerWhere.where}`, customerWhere.params, limit),
    pool: selectSet(db, 'customer_pool', `
      SELECT * FROM customer_pool WHERE ${poolWhere.where} ORDER BY customer_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customer_pool WHERE ${poolWhere.where}`, poolWhere.params, limit),
  };
}

function searchRecon(db, terms, limit) {
  const resultWhere = buildLikeWhere([
    'job_id', 'customer_id', 'company_name', 'website', 'customer_type', 'score',
    'priority', 'compliance_status', 'sanction_source', 'sanction_program', 'evidence_url',
    'opportunity_summary', 'contacts_summary', 'recommended_products', 'outreach_angle',
    'next_action', 'report_path',
  ], terms);
  const evidenceWhere = buildLikeWhere([
    'job_id', 'customer_id', 'field_name', 'value', 'source_url', 'source_title',
    'confidence', 'extractor',
  ], terms);
  return {
    results: selectSet(db, 'matching_recon_results', `
      SELECT * FROM recon_results WHERE ${resultWhere.where} ORDER BY updated_at DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_results WHERE ${resultWhere.where}`, resultWhere.params, limit),
    evidence: selectSet(db, 'matching_recon_evidence', `
      SELECT * FROM recon_evidence WHERE ${evidenceWhere.where} ORDER BY id DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_evidence WHERE ${evidenceWhere.where}`, evidenceWhere.params, limit),
  };
}

function getIntentLists(db, message, limit) {
  const text = String(message || '').toLowerCase();
  const lists = {};
  const today = todayKey();
  if (hasAny(text, ['今日', '今天', 'today', '跟进'])) {
    const where = 'next_follow_date LIKE ?';
    const params = [`${today}%`];
    lists.dueToday = selectSet(db, 'due_today_customers', `
      SELECT follow_id, customer_id, company_name, website, status, owner, next_follow_date, next_action, email, phone
      FROM customers WHERE ${where} ORDER BY next_follow_date, follow_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customers WHERE ${where}`, params, limit);
  }
  if (hasAny(text, ['逾期', 'overdue'])) {
    const where = "next_follow_date != '' AND substr(next_follow_date, 1, 10) < ?";
    const params = [today];
    lists.overdue = selectSet(db, 'overdue_customers', `
      SELECT follow_id, customer_id, company_name, website, status, owner, next_follow_date, next_action, email, phone
      FROM customers WHERE ${where} ORDER BY next_follow_date, follow_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customers WHERE ${where}`, params, limit);
  }
  if (hasAny(text, ['风险', '制裁', 'sanction', '合规', '军工'])) {
    const riskWhere = `
      risk_status != ''
      OR industry LIKE '%军工%'
      OR industry LIKE '%国防%'
      OR industry LIKE '%航空航天%'
      OR notes LIKE '%制裁%'
      OR notes LIKE '%风险%'
    `;
    lists.risk = selectSet(db, 'risk_pool_customers', `
      SELECT customer_id, company_name, website, industry, customer_type, rating, risk_status, products, notes
      FROM customer_pool WHERE ${riskWhere} ORDER BY customer_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customer_pool WHERE ${riskWhere}`, [], limit);
    const sanctionWhere = `
      sanctioned = 'true'
      OR sanction_source != ''
      OR compliance_status LIKE '%制裁%'
      OR compliance_status LIKE '%风险%'
      OR compliance_status LIKE '%sanction%'
    `;
    lists.sanctioned = selectSet(db, 'sanctioned_recon_results', `
      SELECT job_id, customer_id, company_name, website, compliance_status, sanctioned,
             sanction_source, sanction_program, evidence_url, updated_at
      FROM recon_results WHERE ${sanctionWhere} ORDER BY updated_at DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_results WHERE ${sanctionWhere}`, [], limit);
  }
  if (hasAny(text, ['邮箱', 'email', '电话', 'phone', '联系人', '联系', 'contact', '采购'])) {
    const contactWhere = "email != '' OR phone != '' OR contact_count != '0' OR notes LIKE '%采购%'";
    lists.contacts = selectSet(db, 'pool_customers_with_contacts', `
      SELECT customer_id, company_name, website, email, phone, contact_count, products, notes
      FROM customer_pool WHERE ${contactWhere}
      ORDER BY CASE WHEN email != '' THEN 0 ELSE 1 END, CASE WHEN phone != '' THEN 0 ELSE 1 END, customer_id
      LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customer_pool WHERE ${contactWhere}`, [], limit);
    const reconContactWhere = "contacts_summary != ''";
    lists.reconContacts = selectSet(db, 'recon_results_with_contacts', `
      SELECT job_id, customer_id, company_name, contacts_summary, outreach_angle, next_action, evidence_url, updated_at
      FROM recon_results WHERE ${reconContactWhere} ORDER BY updated_at DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_results WHERE ${reconContactWhere}`, [], limit);
  }
  if (hasAny(text, ['a级', '高评级', '重点', '优先', 'priority', 'rating', '评分'])) {
    const priorityWhere = "current_pool IN ('A', 'A级', 'A池') OR rating LIKE '%⭐⭐⭐%' OR rating LIKE '%⭐⭐⭐⭐%'";
    lists.highPriority = selectSet(db, 'high_priority_pool_customers', `
      SELECT customer_id, company_name, website, industry, customer_type, rating, current_pool, products, email, phone
      FROM customer_pool WHERE ${priorityWhere} ORDER BY current_pool, rating DESC, customer_id LIMIT ?
    `, `SELECT COUNT(*) AS total FROM customer_pool WHERE ${priorityWhere}`, [], limit);
    const scoreWhere = "score != '' OR priority != ''";
    lists.reconScores = selectSet(db, 'recon_results_with_scores', `
      SELECT job_id, customer_id, company_name, score, priority, opportunity_summary, recommended_products, updated_at
      FROM recon_results WHERE ${scoreWhere} ORDER BY CAST(score AS INTEGER) DESC, updated_at DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_results WHERE ${scoreWhere}`, [], limit);
  }
  if (hasAny(text, ['recon', '报告', '尽调', '证据', 'evidence'])) {
    const reportWhere = "report_path != ''";
    lists.latestRecon = selectSet(db, 'recon_results_with_reports', `
      SELECT job_id, customer_id, company_name, score, compliance_status, sanctioned,
             opportunity_summary, contacts_summary, recommended_products, report_path, updated_at
      FROM recon_results WHERE ${reportWhere} ORDER BY updated_at DESC LIMIT ?
    `, `SELECT COUNT(*) AS total FROM recon_results WHERE ${reportWhere}`, [], limit);
  }
  return lists;
}

function setMeta(name, set) {
  return {
    name,
    label: set.label || name,
    total: set.total || 0,
    returned: set.returned || 0,
    omitted: set.omitted || 0,
    limit: set.limit || 0,
    truncated: Boolean(set.truncated),
  };
}

function mapCustomer(row, source) {
  return {
    source,
    id: row.customer_id || row.follow_id || '',
    follow_id: row.follow_id || '',
    company_name: row.company_name || row.russian_name || row.english_name || '',
    website: row.website || row.domain || '',
    industry: row.industry || '',
    customer_type: row.customer_type || '',
    rating: row.rating || '',
    pool_or_status: row.current_pool || row.status || '',
    products: shortText(row.products, 220),
    contact: shortText([row.contact, row.email, row.phone].filter(Boolean).join(' / '), 180),
    next_action: shortText(row.next_action || row.reason || row.description || row.notes, 240),
  };
}

function mapRecon(row, source) {
  return {
    source,
    job_id: row.job_id || '',
    customer_id: row.customer_id || '',
    company_name: row.company_name || '',
    score: row.score || '',
    compliance_status: row.compliance_status || '',
    sanctioned: row.sanctioned || '',
    sanction_source: row.sanction_source || '',
    opportunity_summary: shortText(normalizedOpportunity(row), 260),
    contacts_summary: shortText(row.contacts_summary, 260),
    recommended_products: shortText(row.recommended_products, 220),
    next_action: shortText(row.next_action || row.outreach_angle, 220),
    evidence_url: row.evidence_url || '',
    updated_at: row.updated_at || '',
  };
}

function mapEvidence(row) {
  return {
    source: 'recon_evidence',
    id: row.id,
    job_id: row.job_id || '',
    customer_id: row.customer_id || '',
    field_name: row.field_name || '',
    value: shortText(row.value, 240),
    source_url: row.source_url || '',
    source_title: row.source_title || '',
    confidence: row.confidence || '',
    checked_at: row.checked_at || '',
  };
}

function normalizeContext(raw) {
  const customers = [
    ...raw.customers.followed.rows.map(row => mapCustomer(row, 'customers')),
    ...raw.customers.pool.rows.map(row => mapCustomer(row, 'customer_pool')),
  ];
  const recon = raw.recon.results.rows.map(row => mapRecon(row, 'recon_results'));
  const evidence = raw.recon.evidence.rows.map(mapEvidence);
  const intentLists = {};
  const resultSets = [
    setMeta('customers.followed', raw.customers.followed),
    setMeta('customers.pool', raw.customers.pool),
    setMeta('recon.results', raw.recon.results),
    setMeta('recon.evidence', raw.recon.evidence),
  ];
  Object.entries(raw.intentLists).forEach(([key, set]) => {
    resultSets.push(setMeta(`intent.${key}`, set));
    intentLists[key] = set.rows.map(row => {
      if ('field_name' in row && 'source_url' in row) return mapEvidence(row);
      if ('opportunity_summary' in row || 'contacts_summary' in row || 'sanctioned' in row) return mapRecon(row, key);
      return mapCustomer(row, key);
    });
  });
  return {
    terms: raw.terms,
    stats: raw.stats,
    limits: raw.limits,
    resultSets,
    customers,
    recon,
    evidence,
    intentLists,
  };
}

function searchCrmContext(message, accessContext = assistantAccess.getStore()) {
  if (accessContext && assistantAccess.getStore() !== accessContext) {
    return assistantAccess.run(accessContext, () => searchCrmContext(message));
  }
  const defaultLimit = maxRows();
  const listRequest = wantsList(message);
  const intentLimit = listRequest ? Math.max(defaultLimit, listRows()) : defaultLimit;
  const genericLimit = listRequest ? intentLimit : defaultLimit;
  const terms = extractTerms(message);
  const db = getDb();
  try {
    const raw = {
      terms,
      limits: { defaultLimit, genericLimit, intentLimit, listRequest },
      stats: getStats(db),
      customers: searchCustomers(db, terms, genericLimit),
      recon: searchRecon(db, terms, genericLimit),
      intentLists: getIntentLists(db, message, intentLimit),
    };
    return normalizeContext(raw);
  } finally {
    db.close();
  }
}

function compactHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter(item => ['user', 'assistant'].includes(item?.role) && cleanText(item.content))
    .slice(-6)
    .map(item => ({ role: item.role, content: shortText(item.content, 900) }));
}

function conversationFocus(history = []) {
  const text = compactHistory(history).map(item => item.content).join('\n');
  const urls = Array.from(new Set((text.match(/https?:\/\/[^\s)）"'<>]+/gi) || []).map(url => url.replace(/[.,;，。]+$/, '')))).slice(-4);
  const domains = Array.from(new Set([
    ...urls.map(url => {
      try { return new URL(url).hostname.replace(/^www\./i, ''); } catch (_e) { return ''; }
    }),
    ...((text.match(/[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map(v => v.replace(/^www\./i, ''))),
  ].filter(Boolean))).slice(-6);
  const ids = Array.from(new Set(text.match(/[A-Z]{2}-\d{3,}/gi) || [])).slice(-6);
  const companyCandidates = Array.from(new Set((text.match(/\b[A-Z][A-Za-z0-9&().-]*(?:\s+[A-Z][A-Za-z0-9&().-]*){0,3}\b/g) || [])
    .map(cleanText)
    .filter(name => name.length >= 3 && !GENERIC_TITLE_WORDS.has(name.toLowerCase()) && !/^(CRM|AI|Recon|DeepSeek|SQLite)$/i.test(name))))
    .slice(-8);
  return { urls, domains, ids, companies: companyCandidates };
}

function enrichMessageWithHistoryFocus(message, history = []) {
  const focus = conversationFocus(history);
  if (focus.urls.length || focus.domains.length || focus.ids.length || focus.companies.length) {
    return [
      message,
      '',
      '最近对话焦点：',
      focus.ids.length ? `客户ID：${focus.ids.join(', ')}` : '',
      focus.companies.length ? `公司/名称：${focus.companies.join(', ')}` : '',
      focus.domains.length ? `域名：${focus.domains.join(', ')}` : '',
      focus.urls.length ? `URL：${focus.urls.join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }
  return message;
}

function hasUsefulDbContext(context = {}) {
  const directRows = (context.customers?.length || 0) + (context.recon?.length || 0) + (context.evidence?.length || 0);
  const intentRows = Object.values(context.intentLists || {}).reduce((sum, rows) => sum + (rows?.length || 0), 0);
  const vectorRows = context.vectorResults?.length || 0;
  return directRows + intentRows + vectorRows > 0;
}

function shouldUseWebSearch(message, context = {}, contextPayload = {}) {
  if (assistantAccess.getStore()?.permissions?.view_contacts === false) return false;
  if (forbidsExternalSearch(message)) return false;
  if (!webSearchAvailable()) return false;
  if (webSearchMode() === 'on' || webSearchMode() === 'true') return true;
  const text = cleanText(message);
  if (!text) return false;
  const hasTarget = Boolean(contextPayload.customerId || contextPayload.followId || contextPayload.jobId)
    || /[A-Z]{2}-\d{3,}/i.test(text)
    || /[a-z0-9.-]+\.[a-z]{2,}/i.test(text)
    || (context.terms || []).some(term => /[А-Яа-яЁё]{3,}|[A-Za-z][A-Za-z0-9.-]{3,}/.test(term));
  if (wantsExternalSearch(text) && hasTarget) return true;
  if (!hasUsefulDbContext(context) && hasTarget) return true;
  return false;
}

function webSearchQuery(message, context = {}, contextPayload = {}) {
  const terms = [];
  const currentId = cleanText(contextPayload.customerId || contextPayload.followId || contextPayload.jobId);
  if (currentId) terms.push(currentId);
  [...(context.customers || []), ...(context.recon || [])].slice(0, 3).forEach(row => {
    terms.push(row.company_name, row.website, row.id || row.customer_id);
  });
  (context.terms || []).slice(0, 8).forEach(term => terms.push(term));
  const uniqueTerms = Array.from(new Set(terms.map(cleanText).filter(Boolean)))
    .filter(term => !STOP_WORDS.has(term.toLowerCase()))
    .slice(0, 8);
  const taskTerms = wantsOfficialSite(message)
    ? 'official website официальный сайт homepage'
    : wantsExternalSearch(message)
    ? 'contacts procurement email purchasing sales инженер снабжение контакты'
    : 'company profile products official site';
  return cleanText(`${uniqueTerms.join(' ')} ${taskTerms}`);
}

function webHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_e) {
    return '';
  }
}

function extractUrls(text) {
  return Array.from(new Set((String(text || '').match(/https?:\/\/[^\s)）"'<>]+/gi) || [])
    .map(url => url.replace(/[.,;，。]+$/, ''))));
}

function classifyWebResult(row, message) {
  const host = webHost(row.url);
  const thirdParty = THIRD_PARTY_HOSTS.some(part => host.includes(part));
  const title = cleanText(row.title).toLowerCase();
  const officialHint = wantsOfficialSite(message) && !thirdParty && /(official|официальн|官网|home|about|contact)/i.test(`${row.title} ${row.description || ''}`);
  if (thirdParty) return { source_type: 'third_party', trust: 'low', note: '第三方网站/目录/招聘或社媒来源，不能当成官网。' };
  if (officialHint) return { source_type: 'official_candidate', trust: 'medium', note: '疑似官网候选，需要打开核验页面内容。' };
  if (wantsOfficialSite(message) && title && Array.from(GENERIC_TITLE_WORDS).some(word => title.includes(word))) {
    return { source_type: 'irrelevant_or_generic', trust: 'low', note: '标题偏泛化，可能不是目标公司官网。' };
  }
  return { source_type: 'public_web', trust: thirdParty ? 'low' : 'medium', note: '公开网页线索，需核验。' };
}

async function searchWebContext(message, context = {}, contextPayload = {}) {
  if (!shouldUseWebSearch(message, context, contextPayload)) {
    return { ok: false, skipped: true, reason: webSearchAvailable() ? 'not_needed' : 'not_configured', results: [] };
  }
  const query = webSearchQuery(message, context, contextPayload);
  if (!query) return { ok: false, skipped: true, reason: 'empty_query', results: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs(), 12000));
  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(webResultsLimit()));
    url.searchParams.set('country', 'ru');
    url.searchParams.set('search_lang', 'ru');
    url.searchParams.set('safesearch', 'off');
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_e) {
      return { ok: false, skipped: false, reason: `web_search_non_json:${text.slice(0, 120)}`, query, results: [] };
    }
    if (!response.ok) {
      return { ok: false, skipped: false, reason: data?.error?.detail || data?.message || `web_search_${response.status}`, query, results: [] };
    }
    const results = (data?.web?.results || []).slice(0, webResultsLimit()).map((row, idx) => {
      const base = {
        source: 'web_search',
        rank: idx + 1,
        title: cleanText(row.title),
        url: row.url || '',
        host: webHost(row.url || ''),
        description: shortText(row.description || row.extra_snippets?.join(' ') || '', 420),
        age: row.age || '',
      };
      return { ...base, ...classifyWebResult(base, message) };
    }).filter(row => row.title || row.url || row.description);
    return { ok: true, skipped: false, query, results };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, skipped: false, reason: 'web_search_timeout', query, results: [] };
    return { ok: false, skipped: false, reason: e.message || String(e), query, results: [] };
  } finally {
    clearTimeout(timer);
  }
}

function webFetchCandidates(message, context = {}, webContext = null) {
  const candidates = [];
  const add = item => {
    const url = cleanText(typeof item === 'string' ? item : item?.url);
    if (!/^https?:\/\//i.test(url)) return;
    if (candidates.some(existing => existing.url === url)) return;
    const base = typeof item === 'string' ? { url } : item;
    candidates.push({
      source: base.source || 'web_page',
      title: base.title || '',
      url,
      host: base.host || webHost(url),
      source_type: base.source_type || classifyWebResult({ ...base, url }, message).source_type,
      trust: base.trust || classifyWebResult({ ...base, url }, message).trust,
      note: base.note || classifyWebResult({ ...base, url }, message).note,
    });
  };
  extractUrls(message).forEach(add);
  [...(context.customers || []), ...(context.recon || [])].forEach(row => {
    if (row.website) add({ url: /^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`, title: row.company_name || row.title || '', source_type: 'crm_website', trust: 'medium', note: 'CRM 中记录的网站，需打开核验。' });
  });
  const ranked = [...(webContext?.results || [])].sort((a, b) => {
    const score = item => item.source_type === 'official_candidate' ? 0 : item.source_type === 'public_web' ? 1 : item.source_type === 'third_party' ? 3 : 2;
    return score(a) - score(b);
  });
  ranked.forEach(add);
  return candidates.slice(0, webFetchPagesLimit());
}

async function fetchWebPage(candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs(), 12000));
  try {
    const response = await fetch(candidate.url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
        'User-Agent': 'Mozilla/5.0 (compatible; RussiaCRM-Assistant/1.0; +local)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    const title = extractHtmlTitle(raw) || candidate.title || response.url || candidate.url;
    const text = contentType.includes('html') || /<html|<body|<title/i.test(raw)
      ? htmlToReadableText(raw)
      : cleanText(raw);
    return {
      ...candidate,
      source: 'web_page',
      final_url: response.url || candidate.url,
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      title,
      text: shortText(text, 2600),
      fetched_at: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ...candidate,
      source: 'web_page',
      ok: false,
      status: 0,
      error: e.name === 'AbortError' ? 'web_page_timeout' : (e.message || String(e)),
      text: '',
      fetched_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWebPagesContext(message, context = {}, webContext = null, accessContext = assistantAccess.getStore()) {
  if (accessContext?.permissions?.view_contacts === false) {
    return { ok: false, skipped: true, reason: 'contact_permission', pages: [] };
  }
  if (forbidsExternalSearch(message)) {
    return { ok: false, skipped: true, reason: 'user_forbids_external_search', pages: [] };
  }
  const needsFetch = wantsExternalSearch(message)
    || wantsOfficialSite(message)
    || extractUrls(message).length > 0
    || (webContext?.results || []).some(row => row.source_type === 'official_candidate');
  if (!needsFetch) return { ok: false, skipped: true, reason: 'not_needed', pages: [] };
  const candidates = webFetchCandidates(message, context, webContext);
  if (!candidates.length) return { ok: false, skipped: true, reason: 'no_candidate_url', pages: [] };
  const pages = await Promise.all(candidates.map(fetchWebPage));
  return { ok: true, skipped: false, pages };
}

function buildAssistantPrompt(message, context, history = []) {
  const focus = conversationFocus(history);
  const system = [
    '你是 Russia CRM 的专业销售情报与 OSINT 分析助手，风格要像有经验的外贸/电子元器件业务顾问。',
    USER_BUSINESS_PROFILE,
    '先在内部按销售判断工作流理解问题：这个客户是谁、靠什么赚钱、为什么可能买、证据够不够、找谁联系、怎么开口、风险在哪里、下一步最小动作是什么。',
    '再选择最合适的回答结构；不要机械套固定 1-6 模板，不要复读字段。',
    '确定性 SQL 已经负责总数、分页和事实清单；你负责解释、判断、排序、补充外联建议和指出信息缺口。',
    '回答时区分三类内容：数据库/检索事实、基于事实的业务推断、仍需确认的信息。可以做谨慎推断，但必须标明依据和不确定性。',
    '不要编造联系人、邮箱、电话、制裁结论、报告内容、采购意向或已验证关系；外部搜索摘要也只能作为公开线索，不能当成 CRM 已核实事实。',
    '官网相关问题必须判断来源类型：official_candidate 只能说“疑似官网候选”，third_party/irrelevant_or_generic 必须说明不是官网或不能证明官网。',
    'webPages 是后端实际打开网页后抽取的正文；回答官网、产品、采购入口、联系人时优先依据 webPages，而不是只看搜索摘要。',
    '如果 webPages 打开失败，要说明失败 URL 和失败原因，再给下一步核验建议。',
    '信息不足时不能只说不足：必须列出需要补充的内容、已经尝试的检索/证据、可立即使用的公开线索、下一步应查的来源。所有补充信息必须带 URL/来源/可信度；没有依据就标为待核验。',
    'resultSets.total 是数据库匹配总数，returned 是本次提供行数，严禁把 returned 当成 total。',
    '如果 resultSets.truncated=true，必须说明“这里只展示前 returned 条，共 total 条”。',
    '如果数据库上下文不足，但提供了 webResults，请基于 webResults 给“公开信息线索”和“下一步核验动作”；如果两者都不足，直接说明缺口并给出应该外查的关键词/渠道。',
    '输出要结论先行、紧凑可执行。优先中文；涉及邮件时可给英文/俄文草稿。你不能承诺已经修改 CRM。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    ...compactHistory(history),
    {
      role: 'user',
      content: [
        `用户问题：${message}`,
        '',
        salesWorkflowInstruction(message),
        '',
        focus.urls.length || focus.domains.length || focus.ids.length || focus.companies.length
          ? `最近对话焦点（用于理解“这个/它/官网吗”等追问）：${JSON.stringify(focus)}`
          : '',
        '',
        '检索上下文如下。请优先使用 SQLite/向量上下文和 webPages；webResults 只是搜索摘要，需标注“公开搜索线索/待核验”：',
        JSON.stringify(context, null, 2),
      ].join('\n'),
    },
  ];
}

async function callDeepSeek(messages, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const err = new Error('未配置 DEEPSEEK_API_KEY，请在 .env 中添加 DeepSeek API Key 后重启服务。');
    err.statusCode = 503;
    throw err;
  }
  const controller = new AbortController();
  const effectiveTimeout = boundedAssistantTimeout(options.timeoutMs, timeoutMs());
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens(),
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_e) {
      throw new Error(`DeepSeek 返回了非 JSON 响应：${text.slice(0, 180)}`);
    }
    if (!response.ok) {
      const msg = data?.error?.message || data?.message || `DeepSeek 请求失败：${response.status}`;
      const err = new Error(msg);
      err.statusCode = response.status;
      throw err;
    }
    return {
      answer: data?.choices?.[0]?.message?.content || '',
      usage: data?.usage || null,
      model: data?.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error(`DeepSeek 请求超过 ${Math.round(effectiveTimeout / 1000)} 秒，已停止。`);
      err.code = 'DEEPSEEK_TIMEOUT';
      err.statusCode = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function assistantAdapters() {
  return {
    'kimi-cli': callKimi,
    hermes: callHermes,
    deepseek: callDeepSeek,
  };
}

async function callAssistantModel(messages, options = {}) {
  const { router = getAssistantRouter(), adapters = assistantAdapters(), ...requestOptions } = options;
  return router.route(messages, requestOptions, adapters);
}

function assistantRuntimeState(options = {}) {
  const { router = getAssistantRouter(), ...stateOptions } = options;
  return router.getRuntimeState(stateOptions);
}

function setAssistantRuntimeMode(mode, actor, options = {}) {
  const router = options.router || getAssistantRouter();
  return router.setMode(mode, actor);
}

function recheckAssistantEngines(options = {}) {
  const { router = getAssistantRouter(), adapters = assistantAdapters(), ...refreshOptions } = options;
  return router.refreshHealth(adapters, { ...refreshOptions, force: true });
}

function selectedSessionId(result, sessionId, sessionEngine) {
  return result.sessionId || (result.sessionEngine === sessionEngine ? sessionId : '');
}

function deterministicKind(message, context = {}) {
  const text = cleanText(message).toLowerCase();
  if (wantsContinue(message)) return '';
  if (context.customerId || context.followId || context.jobId) {
    if (context.scope === 'customer') return 'current_customer';
    if (hasAny(text, ['当前客户', '这个客户', '此客户', '该客户', '怎么跟进', '下一步', '画像', '开发信', '合规摘要', '确认点', '值得开发', '开发等级', '需求匹配', '采购入口', '外联策略', '客户业务', '风险复核'])) return 'current_customer';
  }
  if (wantsSemantic(message)) return '';
  if (hasAny(text, ['recon', '报告', '尽调'])) return 'recon_reports';
  if (hasAny(text, ['制裁', 'sanction', '风险', '合规'])) return 'sanctions';
  if (hasAny(text, ['今日', '今天', '跟进', '逾期'])) return hasAny(text, ['逾期']) ? 'overdue' : 'due_today';
  if (hasAny(text, ['a级', '高评级', '重点', '优先'])) return 'high_priority';
  if (hasAny(text, ['邮箱', '电话', '联系人', '采购'])) return 'contacts';
  return '';
}

function deterministicQuery(kind) {
  const today = todayKey();
  const queries = {
    recon_reports: {
      label: 'recon_results_with_reports',
      count: "SELECT COUNT(*) AS total FROM recon_results WHERE report_path != ''",
      select: `
        SELECT job_id, customer_id, company_name, score, compliance_status, sanctioned,
               recommended_products, contacts_summary, next_action, report_path, updated_at
        FROM recon_results
        WHERE report_path != ''
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      params: [],
      columns: ['客户ID', '公司', '评分', '合规', '推荐产品/线索'],
      row: row => [row.customer_id, row.company_name, row.score || '-', row.compliance_status || (row.sanctioned === 'true' ? 'sanctioned' : '-'), shortText(row.recommended_products || row.contacts_summary || row.next_action, 80)],
    },
    sanctions: {
      label: 'sanctioned_or_risk_recon_results',
      count: `
        SELECT COUNT(*) AS total FROM recon_results
        WHERE sanctioned = 'true' OR sanction_source != '' OR compliance_status LIKE '%制裁%' OR compliance_status LIKE '%风险%' OR compliance_status LIKE '%sanction%'
      `,
      select: `
        SELECT job_id, customer_id, company_name, score, compliance_status, sanctioned,
               sanction_source, sanction_program, evidence_url, updated_at
        FROM recon_results
        WHERE sanctioned = 'true' OR sanction_source != '' OR compliance_status LIKE '%制裁%' OR compliance_status LIKE '%风险%' OR compliance_status LIKE '%sanction%'
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      params: [],
      columns: ['客户ID', '公司', '评分', '合规/制裁', '来源'],
      row: row => [row.customer_id, row.company_name, row.score || '-', row.compliance_status || row.sanctioned, shortText([row.sanction_source, row.sanction_program].filter(Boolean).join(' / '), 80)],
    },
    due_today: {
      label: 'due_today_customers',
      count: 'SELECT COUNT(*) AS total FROM customers WHERE next_follow_date LIKE ?',
      select: `
        SELECT follow_id, customer_id, company_name, website, status, owner, next_follow_date, next_action, email, phone
        FROM customers
        WHERE next_follow_date LIKE ?
        ORDER BY next_follow_date, follow_id
        LIMIT ? OFFSET ?
      `,
      params: [`${today}%`],
      columns: ['跟进ID', '客户ID', '公司', '负责人/状态', '下一步'],
      row: row => [row.follow_id, row.customer_id, row.company_name, [row.owner, row.status].filter(Boolean).join(' / '), shortText(row.next_action, 80)],
    },
    overdue: {
      label: 'overdue_customers',
      count: "SELECT COUNT(*) AS total FROM customers WHERE next_follow_date != '' AND substr(next_follow_date, 1, 10) < ?",
      select: `
        SELECT follow_id, customer_id, company_name, website, status, owner, next_follow_date, next_action, email, phone
        FROM customers
        WHERE next_follow_date != '' AND substr(next_follow_date, 1, 10) < ?
        ORDER BY next_follow_date, follow_id
        LIMIT ? OFFSET ?
      `,
      params: [today],
      columns: ['跟进ID', '客户ID', '公司', '下次跟进', '下一步'],
      row: row => [row.follow_id, row.customer_id, row.company_name, row.next_follow_date, shortText(row.next_action, 80)],
    },
    high_priority: {
      label: 'high_priority_pool_customers',
      count: "SELECT COUNT(*) AS total FROM customer_pool WHERE current_pool IN ('A', 'A级', 'A池') OR rating LIKE '%⭐⭐⭐%' OR rating LIKE '%⭐⭐⭐⭐%'",
      select: `
        SELECT customer_id, company_name, website, industry, customer_type, rating, current_pool, products, email, phone
        FROM customer_pool
        WHERE current_pool IN ('A', 'A级', 'A池') OR rating LIKE '%⭐⭐⭐%' OR rating LIKE '%⭐⭐⭐⭐%'
        ORDER BY current_pool, rating DESC, customer_id
        LIMIT ? OFFSET ?
      `,
      params: [],
      columns: ['客户ID', '公司', '池子/评级', '行业/类型', '产品'],
      row: row => [row.customer_id, row.company_name, [row.current_pool, row.rating].filter(Boolean).join(' / '), [row.industry, row.customer_type].filter(Boolean).join(' / '), shortText(row.products, 80)],
    },
    contacts: {
      label: 'pool_customers_with_contacts',
      count: "SELECT COUNT(*) AS total FROM customer_pool WHERE email != '' OR phone != '' OR contact_count != '0' OR notes LIKE '%采购%'",
      select: `
        SELECT customer_id, company_name, website, email, phone, contact_count, products, notes
        FROM customer_pool
        WHERE email != '' OR phone != '' OR contact_count != '0' OR notes LIKE '%采购%'
        ORDER BY CASE WHEN email != '' THEN 0 ELSE 1 END, CASE WHEN phone != '' THEN 0 ELSE 1 END, customer_id
        LIMIT ? OFFSET ?
      `,
      params: [],
      columns: ['客户ID', '公司', '邮箱', '电话', '产品/备注'],
      row: row => [row.customer_id, row.company_name, row.email || '-', row.phone || '-', shortText(row.products || row.notes, 80)],
    },
  };
  return queries[kind] || null;
}

function sourceForRow(row, type) {
  const source = {
    type,
    customer_id: row.customer_id || '',
    follow_id: row.follow_id || '',
    job_id: row.job_id || '',
    title: row.company_name || row.field_name || row.customer_id || row.job_id || '',
    url: '',
    action: '',
  };
  if (row.job_id) {
    source.url = `/api/report?job_id=${encodeURIComponent(row.job_id)}`;
    source.action = 'open_report';
  } else if (row.customer_id || row.follow_id) {
    source.action = 'open_customer';
  }
  return source;
}

function markdownTable(columns, rows, mapper) {
  if (!rows.length) return '';
  const head = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${mapper(row).map(cell => cleanText(cell).replace(/\|/g, '/')).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function deterministicAnswer(kind, message, cursorValue, contextPayload) {
  let cursor = decodeCursor(cursorValue);
  if (!cursor && wantsContinue(message)) cursor = decodeCursor(contextPayload.lastCursor || '');
  const resolvedKind = cursor?.kind || kind;
  if (resolvedKind === 'current_customer') return currentCustomerAnswer(contextPayload, message);
  const query = deterministicQuery(resolvedKind);
  if (!query) return null;
  const db = getDb();
  try {
    const size = Math.max(1, Math.min(Number(cursor?.pageSize || pageSize()), 50));
    const page = Math.max(1, Number(cursor?.page || 1));
    const offset = (page - 1) * size;
    const total = countSafe(db, query.count, query.params);
    const rows = allSafe(db, query.select, [...query.params, size, offset]);
    const totalPages = Math.max(1, Math.ceil(total / size));
    const nextCursor = page < totalPages ? encodeCursor({ kind: resolvedKind, page: page + 1, pageSize: size }) : '';
    const title = deterministicTitle(resolvedKind);
    const table = markdownTable(query.columns, rows, query.row);
    const answer = [
      `${title}：共 ${total} 条，当前第 ${page}/${totalPages} 页，展示 ${rows.length} 条。`,
      table,
      nextCursor ? '还有更多结果，可以点“继续查看更多”或回复“继续”。' : '',
    ].filter(Boolean).join('\n\n');
    return {
      ok: true,
      answer,
      sources: rows.map(row => sourceForRow(row, resolvedKind)),
      resultSets: [{
        name: `deterministic.${resolvedKind}`,
        label: query.label,
        total,
        returned: rows.length,
        limit: size,
        omitted: Math.max(0, total - offset - rows.length),
        truncated: Boolean(nextCursor),
        page,
        totalPages,
      }],
      nextCursor,
      actions: nextCursor ? [{ type: 'continue', label: '继续查看更多', cursor: nextCursor }] : [],
      matchedCustomers: rows.filter(row => row.customer_id || row.follow_id).map(row => ({
        customer_id: row.customer_id || '',
        follow_id: row.follow_id || '',
        company_name: row.company_name || '',
        website: row.website || '',
        source: resolvedKind,
      })),
      retrievalMode: 'deterministic',
    };
  } finally {
    db.close();
  }
}

function currentCustomerTaskHint(message) {
  const text = cleanText(message);
  if (hasAny(text, ['值得开发', '是否值得', '开发等级', '优先级', '销售判断'])) {
    return '任务类型：客户开发判断。请先给结论和开发等级 A/B/C/暂缓，再说明值得/不值得的依据、最大机会点、最大不确定性、下一步最小动作。';
  }
  if (hasAny(text, ['到底做什么', '做什么的', '主营', '应用场景', '客户画像', '画像'])) {
    return '任务类型：客户业务理解。请用销售能理解的话解释客户做什么、卖给谁、产品/场景可能用到哪些电子元器件、我们可能卖什么、还缺什么证据。';
  }
  if (hasAny(text, ['需求匹配', '匹配度', '可能需要', '产品线'])) {
    return '任务类型：需求匹配度。请按功率器件、MCU/控制器、传感器、连接器、被动元件、电源模块分别评估匹配依据、可信度和切入话题。';
  }
  if (hasAny(text, ['开发信', '邮件', '俄文邮件', '英文邮件'])) {
    return '任务类型：开发信。请先判断是否适合开发和主切入点，再给中文策略说明、英文邮件、俄文邮件。不要编造联系人或邮箱；缺联系人时用占位符，并说明需先核验采购入口。';
  }
  if (hasAny(text, ['相似', '类似', '像'])) {
    return '任务类型：相似客户。请先说明相似维度；若事实快照/向量/公开搜索没有提供候选，不要把当前客户画像重复一遍，要说明缺候选并建议检索维度。';
  }
  if (hasAny(text, ['采购邮箱', '采购部', '采购', '联系人', '供应链', '询价线索', '线索'])) {
    return '任务类型：采购/联系人线索。请区分“CRM已记录”“Recon证据”“公开搜索线索/待核验”；没有直接采购入口时，给出下一步核验路径，不要假装找到了。';
  }
  if (hasAny(text, ['跟进', '下一步', '话术要点', '渠道'])) {
    return '任务类型：跟进计划。请先给一句策略结论，再输出联系目标、推荐渠道、首轮话术要点、必须确认的问题、是否需要人工/合规复核。';
  }
  if (hasAny(text, ['合规', '风险', '制裁'])) {
    return '任务类型：合规摘要。请输出合规结论、证据依据、风险等级、建议动作。不能夸大或编造制裁结论。';
  }
  return '任务类型：客户画像。请先给一句业务判断，再输出客户类型、主营/应用场景、可能需求、推荐产品、确认点、开发优先级；每一点要有依据或标注待确认。';
}

function compactCustomerEvidence(value, limit = 900) {
  const withoutRediscoveryNoise = String(value || '')
    .replace(/\[\d{4}-\d{2}-\d{2}\]\s+[^\n]*再次发现:\s*/g, '')
    .replace(/(?:\s*\n){3,}/g, '\n\n');
  return shortText(withoutRediscoveryNoise, limit);
}

function compactWebPagesForPrompt(pages = []) {
  return pages.slice(0, 2).map(page => ({
    title: page.title || '',
    url: page.final_url || page.url || '',
    source_type: page.source_type || '',
    trust: page.trust || '',
    status: page.status || 0,
    ok: Boolean(page.ok),
    text: compactCustomerEvidence(page.text, 1600),
    error: page.error || '',
  }));
}

function buildCurrentCustomerAnalysisPrompt(message, snapshot, webContext = null) {
  const system = [
    '你是 Russia CRM 的当前客户销售情报助手，风格像有经验的外贸/电子元器件业务顾问。',
    USER_BUSINESS_PROFILE,
    '只分析事实快照中的当前客户，不得切换到其他客户或全库统计。',
    '先给销售结论，再说明依据、可卖产品、风险/缺口和下一步；优先中文，保持紧凑。',
    'Recon 未完成就明确说暂无结论。不得编造联系人、采购意向、制裁结论、报告或来源。',
    '公开网页只能作为待核验线索；谨慎推断必须标明依据，不能写成已验证事实。',
  ].join('\n');
  const compactSearchResults = (webContext?.results || []).slice(0, 3).map(row => ({
    title: row.title || '',
    url: row.url || '',
    source_type: row.source_type || '',
    trust: row.trust || '',
    description: compactCustomerEvidence(row.description, 320),
  }));
  const compactReportSnippets = (snapshot.reportSnippets || []).slice(0, 2).map(row => ({
    customer_id: row.customer_id,
    job_id: row.job_id,
    title: row.title,
    content: compactCustomerEvidence(row.content, 700),
    score: row.score,
    url: row.url,
  }));
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `用户问题：${message}`,
        currentCustomerTaskHint(message),
        '',
        '当前客户事实快照：',
        compactCustomerEvidence(snapshot.answer, 2600),
        snapshot.reportExcerpt ? '' : '',
        snapshot.reportExcerpt ? '当前客户已有 Recon 报告正文摘录（服务端安全只读读取）：' : '',
        compactCustomerEvidence(snapshot.reportExcerpt, 3000),
        snapshot.contactReportExcerpt ? '' : '',
        snapshot.contactReportExcerpt ? '当前客户已有负责人/联系人报告正文摘录（服务端安全只读读取）：' : '',
        compactCustomerEvidence(snapshot.contactReportExcerpt, 2200),
        compactReportSnippets.length ? '' : '',
        compactReportSnippets.length ? '当前客户已有 Recon 报告语义片段（来自本地只读索引）：' : '',
        compactReportSnippets.length ? JSON.stringify(compactReportSnippets) : '',
        '',
        compactSearchResults.length ? '公开搜索线索（待核验，不等同于 CRM 已验证事实）：' : '',
        compactSearchResults.length ? JSON.stringify({ query: webContext.query, results: compactSearchResults }) : '',
        webContext?.pages?.length ? '已打开网页正文（后端实际 fetch，仍需看来源类型和可信度）：' : '',
        webContext?.pages?.length ? JSON.stringify(compactWebPagesForPrompt(webContext.pages)) : '',
        '',
        '请基于以上事实快照和可用公开线索输出分析。不要引用无关客户或全库统计。',
      ].join('\n'),
    },
  ];
}

async function currentCustomerAssistantAnswer(
  message,
  contextPayload = {},
  history = [],
  sessionId = '',
  sessionEngine = '',
  modelCall = callAssistantModel,
) {
  const snapshot = currentCustomerAnswer(contextPayload, message);
  if (!snapshot) return null;
  const webContext = await searchWebContext(message, {
    customers: snapshot.matchedCustomers || [],
    recon: [],
    evidence: [],
    intentLists: {},
    resultSets: snapshot.resultSets || [],
    terms: extractTerms(`${message} ${snapshot.answer}`),
  }, contextPayload);
  const webPages = await fetchWebPagesContext(message, {
    customers: snapshot.matchedCustomers || [],
    recon: [],
    evidence: [],
    intentLists: {},
    resultSets: snapshot.resultSets || [],
    terms: extractTerms(`${message} ${snapshot.answer}`),
  }, webContext);
  if (webPages?.pages?.length) webContext.pages = webPages.pages;
  const reportVector = await semanticContext(
    `${message}\n只检索当前客户已有 CRM 和 Recon 报告证据`,
    contextPayload,
    true,
  );
  if (reportVector?.results?.length) {
    snapshot.reportSnippets = reportVector.results.map(row => ({
      doc_type: row.doc_type,
      customer_id: row.customer_id,
      job_id: row.job_id,
      title: row.title,
      content: shortText(row.content, 1600),
      score: row.score,
      url: row.url,
    }));
  }
  const result = await modelCall(
    buildCurrentCustomerAnalysisPrompt(message, snapshot, webContext),
    {
      scope: contextPayload.scope || 'customer',
      externalAllowed: !forbidsExternalSearch(message),
      sessionId,
      sessionEngine,
    },
  );
  if (!cleanText(result.answer)) {
    const err = new Error('DeepSeek 没有返回有效内容，请稍后重试。');
    err.statusCode = 502;
    throw err;
  }
  const sources = [
    ...(snapshot.sources || []),
    ...vectorSources(reportVector?.results || []),
  ];
  if (webContext?.results?.length) sources.push(...webContext.results.map(row => ({
    type: 'web_search',
    title: row.title,
    url: row.url,
    action: '',
  })));
  if (webContext?.pages?.length) sources.push(...webContext.pages.map(row => ({
    type: 'web_page',
    title: row.title || row.url,
    url: row.final_url || row.url,
    action: '',
  })));
  return {
    ...snapshot,
    answer: result.answer,
    sources,
    resultSets: [
      ...(snapshot.resultSets || []),
      ...(webContext?.results?.length ? [{
        name: 'web.brave',
        label: 'brave_web_search',
        total: webContext.results.length,
        returned: webContext.results.length,
        limit: webResultsLimit(),
        omitted: 0,
        truncated: false,
      }] : []),
      ...(webContext?.pages?.length ? [{
        name: 'web.pages',
        label: 'opened_web_pages',
        total: webContext.pages.length,
        returned: webContext.pages.length,
        limit: webFetchPagesLimit(),
        omitted: 0,
        truncated: false,
      }] : []),
    ],
    retrievalMode: webContext?.pages?.length ? 'current_customer_web_page' : (webContext?.results?.length ? 'current_customer_web' : 'current_customer'),
    usage: result.usage,
    model: result.model,
    engine: result.engine,
    guardrails: result.guardrails,
    fallbackReason: result.fallbackReason,
    sessionId: selectedSessionId(result, sessionId, sessionEngine),
    sessionEngine: result.sessionEngine || sessionEngine,
  };
}

function deterministicTitle(kind) {
  return {
    recon_reports: '有 Recon 报告的客户',
    sanctions: '制裁/风险客户',
    due_today: '今日待跟进客户',
    overdue: '逾期未跟进客户',
    high_priority: '高优先级客户',
    contacts: '有联系方式/采购线索的客户',
  }[kind] || '查询结果';
}

function currentCustomerAnswer(contextPayload = {}, message = '') {
  const id = cleanText(contextPayload.customerId || contextPayload.followId || contextPayload.jobId);
  if (!id) return null;
  const db = getDb();
  try {
    const pool = oneSafe(db, `
      SELECT 'pool' AS source, customer_id, '' AS follow_id, company_name, russian_name, english_name,
             website, domain, city, industry, customer_type, description, rating, current_pool,
             products, email, phone, inn, risk_status, notes
      FROM customer_pool
      WHERE customer_id = ? OR company_name = ? OR domain = ? OR website = ?
      LIMIT 1
    `, [id, id, id, id]);
    const followed = oneSafe(db, `
      SELECT 'followup' AS source, customer_id, follow_id, company_name, website, industry, customer_type,
             rating, products, email, phone, contact, owner, status, feedback, next_action, next_follow_date, notes
      FROM customers
      WHERE customer_id = ? OR follow_id = ? OR company_name = ? OR website = ?
      LIMIT 1
    `, [id, id, id, id]);
    const customerId = cleanText(contextPayload.customerId || pool?.customer_id || followed?.customer_id || '');
    const job = cleanText(contextPayload.jobId)
      ? oneSafe(db, 'SELECT * FROM recon_jobs WHERE job_id = ? LIMIT 1', [contextPayload.jobId])
      : oneSafe(db, 'SELECT * FROM recon_jobs WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1', [customerId || id]);
    const result = cleanText(contextPayload.jobId)
      ? oneSafe(db, 'SELECT * FROM recon_results WHERE job_id = ? LIMIT 1', [contextPayload.jobId])
      : oneSafe(db, 'SELECT * FROM recon_results WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 1', [customerId || id]);
    const contactJob = oneSafe(db, `
      SELECT job_id, customer_id, company_name, website, status, stage, person_count, l2_count, l3_count,
             result_json, report_path, updated_at
      FROM contact_recon_jobs
      WHERE customer_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `, [customerId || id]);
    if (!pool && !followed && !job && !result && !contactJob) return null;
    const tags = customerId ? allSafe(db, `
      SELECT t.category, t.name
      FROM customer_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.customer_id = ?
      ORDER BY t.category, t.name
    `, [customerId]) : [];
    const base = {
      source: pool ? 'pool' : (followed ? 'followup' : 'contact_recon'),
      customer_id: customerId || followed?.customer_id || result?.customer_id || job?.customer_id || contactJob?.customer_id || '',
      follow_id: followed?.follow_id || '',
      company_name: pool?.company_name || followed?.company_name || result?.company_name || job?.company_name || contactJob?.company_name || '',
      website: pool?.website || pool?.domain || followed?.website || result?.website || job?.website || contactJob?.website || '',
      customer_type: pool?.customer_type || followed?.customer_type || result?.customer_type || '',
      industry: pool?.industry || followed?.industry || '',
      rating: pool?.rating || followed?.rating || '',
      status: [pool?.current_pool, followed?.status].filter(Boolean).join(' / '),
      products: pool?.products || followed?.products || result?.recommended_products || '',
      email: pool?.email || followed?.email || '',
      phone: pool?.phone || followed?.phone || '',
      notes: compactCustomerEvidence(pool?.notes || followed?.notes || '', 900),
      next_action: compactCustomerEvidence(
        followed?.next_action || result?.next_action || result?.outreach_angle || pool?.notes || '',
        700,
      ),
    };
    const tagText = tags.map(t => `${t.category}:${t.name}`).join('；');
    const reconLine = result
      ? `Recon：评分 ${result.score || '-'}；合规 ${result.compliance_status || '-'}；制裁 ${result.sanctioned || 'false'}；证据 ${result.evidence_count || '0'} 条`
      : (job ? `Recon：任务 ${job.status || '-'}，尚未回填结果` : 'Recon：当前客户暂无 Recon 结果');
    const contactReconLine = contactJob
      ? `负责人报告：${contactJob.status || '-'}；人物 ${contactJob.person_count || 0}；L2 ${contactJob.l2_count || 0}；L3 ${contactJob.l3_count || 0}`
      : '负责人报告：暂无';
    const contact = [base.email, base.phone, followed?.contact].filter(Boolean).join(' / ') || '-';
    const needs = base.products || pool?.description || followed?.reason || '-';
    const action = compactCustomerEvidence(
      base.next_action || (result ? normalizedOpportunity(result) : ''),
      700,
    ) || '先确认采购入口、常用品牌/型号和是否接受国产替代，再决定外联节奏。';
    const answer = hasAny(message, ['画像', '当前客户'])
      ? [
        `当前客户：${base.customer_id || base.follow_id || id} | ${base.company_name || '-'}`,
        `1. 客户类型：${base.customer_type || '-'}${base.industry ? ` / ${base.industry}` : ''}`,
        `2. 主营/应用场景：${pool?.description || followed?.reason || base.industry || '-'}`,
        `3. 可能需求：${needs}`,
        `4. 推荐产品：${result?.recommended_products || base.products || '-'}`,
        `5. 确认点：${contact === '-' ? '缺少明确联系人/采购入口；' : `联系方式 ${contact}；`} ${reconLine}；${contactReconLine}；${tagText ? `标签 ${tagText}` : '暂无标签'}`,
        `6. 开发优先级：${[base.status, base.rating].filter(Boolean).join(' / ') || '-'}。建议下一步：${action}`,
      ].join('\n')
      : [
        `当前客户：${base.customer_id || base.follow_id || id} | ${base.company_name || '-'}`,
        `类型/行业：${[base.customer_type, base.industry].filter(Boolean).join(' / ') || '-'}`,
        `状态/评级：${[base.status, base.rating].filter(Boolean).join(' / ') || '-'}`,
        `产品/需求：${needs}`,
        `联系方式：${contact}`,
        reconLine,
        contactReconLine,
        `建议下一步：${action}`,
      ].join('\n');
    const sources = [sourceForRow(base, 'current_customer')];
    if (result?.job_id) sources.push(sourceForRow(result, 'current_recon_result'));
    else if (job?.job_id) sources.push({ ...sourceForRow(job, 'current_recon_job'), url: '', action: '' });
    if (contactJob?.job_id) {
      sources.push({
        type: 'current_contact_recon_report',
        customer_id: contactJob.customer_id || base.customer_id,
        follow_id: base.follow_id,
        job_id: contactJob.job_id,
        title: `${contactJob.company_name || base.company_name} · 负责人报告`,
        url: '',
        action: '',
      });
    }
    return {
      ok: true,
      answer,
      reportExcerpt: safeReadReconReport(result?.report_path),
      contactReportExcerpt: safeReadContactReport(contactJob?.report_path),
      sources,
      resultSets: [{ name: 'deterministic.current_customer', label: 'current_customer', total: 1, returned: 1, limit: 1, omitted: 0, truncated: false }],
      actions: [],
      nextCursor: '',
      matchedCustomers: [{ customer_id: base.customer_id, follow_id: base.follow_id, company_name: base.company_name, website: base.website, source: base.source }],
      retrievalMode: 'deterministic',
    };
  } finally {
    db.close();
  }
}

function vectorSources(results) {
  return results.map(row => ({
    type: row.doc_type || 'vector',
    customer_id: row.customer_id || '',
    follow_id: row.follow_id || '',
    job_id: row.job_id || '',
    title: `${row.title || row.doc_type || '语义结果'} (${Number(row.score || 0).toFixed(2)})`,
    url: row.url || '',
    action: row.job_id ? 'open_report' : (row.customer_id || row.follow_id ? 'open_customer' : ''),
  }));
}

function customerProfileText(id) {
  const cleanId = cleanText(id);
  if (!cleanId) return '';
  const db = getDb();
  try {
    const pool = allSafe(db, `
      SELECT customer_id, company_name, russian_name, english_name, city, website, industry,
             customer_type, description, products, rating, current_pool, email, phone, inn,
             risk_status, notes
      FROM customer_pool
      WHERE customer_id = ? OR company_name = ? OR domain = ? OR website = ?
      LIMIT 2
    `, [cleanId, cleanId, cleanId, cleanId]);
    const followed = allSafe(db, `
      SELECT follow_id, customer_id, company_name, website, industry, customer_type, rating,
             products, reason, status, owner, feedback, next_action, notes
      FROM customers
      WHERE customer_id = ? OR follow_id = ? OR company_name = ? OR website = ?
      LIMIT 2
    `, [cleanId, cleanId, cleanId, cleanId]);
    const recon = allSafe(db, `
      SELECT job_id, customer_id, company_name, score, compliance_status, sanctioned,
             opportunity_summary, contacts_summary, recommended_products, outreach_angle, next_action
      FROM recon_results
      WHERE customer_id = ? OR job_id = ? OR company_name = ?
      ORDER BY updated_at DESC
      LIMIT 3
    `, [cleanId, cleanId, cleanId]);
    return cleanText(JSON.stringify({ pool, followed, recon }));
  } finally {
    db.close();
  }
}

async function semanticContext(message, contextPayload, force = false) {
  if (!force && !wantsSemantic(message) && !wantsTemplate(message)) return null;
  let query = cleanText(message);
  const currentId = cleanText(contextPayload.customerId || contextPayload.followId || contextPayload.jobId);
  if (currentId && hasAny(query, ['这个客户', '此客户', '怎么跟进', '画像', '开发信', '相似'])) {
    query = `${query}\n当前客户: ${currentId}`;
  }
  const explicitCustomerId = (query.match(/[A-Z]{2}-\d{3,}/i) || [])[0] || '';
  const targetId = explicitCustomerId || currentId;
  const wantsSimilarity = hasAny(query, ['类似', '相似', '像', '画像接近']);
  if (targetId && wantsSimilarity) {
    const profile = customerProfileText(targetId);
    if (profile) query = `${query}\n目标客户画像：${profile}`;
  }
  try {
    const result = await vectorSearch(query, {
      limit: 10,
      customerId: contextPayload.customerId || contextPayload.followId || '',
      followId: contextPayload.followId,
      jobId: contextPayload.jobId,
      allowedCustomerIds: [...(assistantAccess.getStore()?.externalCustomerIds || [])],
      canViewContacts: assistantAccess.getStore()?.permissions?.view_contacts !== false,
      canViewRecon: assistantAccess.getStore()?.permissions?.view_recon !== false,
    });
    if (result?.results?.length && wantsSimilarity && targetId) {
      result.results = result.results.filter(row => row.customer_id !== targetId && row.follow_id !== targetId);
    }
    return result;
  } catch (e) {
    return { ok: false, reason: e.message || String(e), results: [] };
  }
}

function collectSources(context) {
  const sources = [];
  const add = item => {
    const key = [item.source || item.type || '', item.id || item.customer_id || '', item.follow_id || item.job_id || item.field_name || '', item.source_url || item.url || ''].join('|');
    if (sources.some(src => src.key === key)) return;
    sources.push({
      key,
      type: item.source || item.type || 'crm',
      customer_id: item.id || item.customer_id || '',
      follow_id: item.follow_id || '',
      job_id: item.job_id || '',
      title: item.company_name || item.title || item.field_name || item.source_title || '',
      url: item.source_url || item.evidence_url || item.url || item.website || '',
      action: item.job_id ? 'open_report' : (item.id || item.customer_id || item.follow_id ? 'open_customer' : ''),
    });
  };
  Object.values(context.intentLists || {}).flat().forEach(add);
  (context.vectorResults || []).forEach(add);
  context.recon.forEach(add);
  context.evidence.forEach(add);
  context.customers.forEach(add);
  (context.webResults || []).forEach(add);
  (context.webPages || []).forEach(add);
  return sources.map(({ key, ...source }) => source);
}

function formatSources(context) {
  return collectSources(context).slice(0, Math.max(maxRows() * 2, pageSize()));
}

function answerReferenceSet(answer) {
  const text = cleanText(answer);
  const refs = [
    ...(text.match(/[A-Z]{2}-\d{3,}/gi) || []),
    ...(text.match(/FU-\d{3,}/gi) || []),
    ...(text.match(/RR-\d{8,}[-A-Z0-9]*/gi) || []),
  ];
  return new Set(refs.map(ref => ref.toUpperCase()));
}

function sourceMatchesReference(source, refs) {
  if (String(source.type || '').toLowerCase().includes('web')) return true;
  const fields = [source.customer_id, source.follow_id, source.job_id, source.title, source.url]
    .filter(Boolean)
    .map(value => String(value).toUpperCase());
  return fields.some(value => Array.from(refs).some(ref => value.includes(ref)));
}

function matchedCustomerMatchesReference(customer, refs) {
  const fields = [customer.customer_id, customer.follow_id, customer.company_name, customer.website]
    .filter(Boolean)
    .map(value => String(value).toUpperCase());
  return fields.some(value => Array.from(refs).some(ref => value.includes(ref)));
}

function bindReferencesToAnswer(answer, sources, matched) {
  const refs = answerReferenceSet(answer);
  if (!refs.size) return { sources, matchedCustomers: matched };
  const boundSources = sources.filter(source => sourceMatchesReference(source, refs));
  const boundMatched = matched.filter(customer => matchedCustomerMatchesReference(customer, refs));
  return {
    sources: boundSources.length ? boundSources : sources,
    matchedCustomers: boundMatched.length ? boundMatched : matched,
  };
}

function matchedCustomers(context) {
  const rows = [
    ...context.customers,
    ...Object.values(context.intentLists || {}).flat().filter(item => item.company_name),
    ...(context.vectorResults || []).filter(item => item.customer_id || item.follow_id),
  ];
  const seen = new Set();
  return rows
    .map(item => ({
      customer_id: item.id || item.customer_id || '',
      follow_id: item.follow_id || '',
      company_name: item.company_name || item.title || '',
      website: item.website || '',
      source: item.source || item.doc_type || '',
    }))
    .filter(item => {
      const key = `${item.customer_id}|${item.follow_id}|${item.company_name}`;
      if (!cleanText(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxRows());
}

function metadataNote(context) {
  const notable = (context.resultSets || [])
    .filter(set => set.total > 0 && (set.truncated || set.name.startsWith('intent.')))
    .map(set => `${set.name}: total=${set.total}, returned=${set.returned}${set.truncated ? `, omitted=${set.omitted}` : ''}`);
  if (!notable.length) return '';
  return `\n\n数据口径：${notable.slice(0, 6).join('；')}。total 是数据库匹配总数，returned 是本次展示给模型的行数。`;
}

function resolveAssistantTargetCustomerId(value) {
  const target = cleanText(value);
  if (!target) return '';
  const db = new Database(databasePath(), { readonly: true });
  try {
    const row = oneSafe(db, `
      SELECT customer_id FROM customers WHERE customer_id=? OR follow_id=?
      UNION ALL SELECT customer_id FROM customer_pool WHERE customer_id=?
      UNION ALL SELECT customer_id FROM recon_jobs WHERE job_id=?
      UNION ALL SELECT customer_id FROM recon_results WHERE job_id=?
      UNION ALL SELECT customer_id FROM contact_recon_jobs WHERE job_id=?
      LIMIT 1
    `, [target, target, target, target, target, target]);
    return cleanText(row?.customer_id);
  } finally {
    db.close();
  }
}

function assertAssistantTargetAccess(payload, accessContext) {
  if (!accessContext) return;
  const contextPayload = payload?.context || {};
  const conversationText = [payload?.message, ...(Array.isArray(payload?.history)
    ? payload.history.map(item => item?.content)
    : [])].map(cleanText).join('\n');
  const mentionedCustomerIds = conversationText.match(/[A-Z]{2}-\d{3,}/gi) || [];
  const targets = Array.from(new Set([
    contextPayload.customerId,
    contextPayload.followId,
    contextPayload.jobId,
    ...mentionedCustomerIds,
  ].map(cleanText).filter(Boolean)));
  for (const target of targets) {
    const customerId = accessContext.externalCustomerIds.has(target)
      ? target
      : resolveAssistantTargetCustomerId(target);
    if (!customerId) throw forbidden('无权访问该客户');
    assertExternalCustomerAccess(accessContext, customerId);
  }
}

async function answerAssistantQuestionScoped(payload = {}, modelCall = callAssistantModel) {
  const message = cleanText(payload.message);
  if (!message) {
    const err = new Error('请输入问题。');
    err.statusCode = 400;
    throw err;
  }
  if (message.length > 2000) {
    const err = new Error('问题太长，请控制在 2000 字以内。');
    err.statusCode = 400;
    throw err;
  }

  const contextPayload = payload.context || {};
  const history = payload.history || [];
  const sessionId = cleanText(payload.sessionId);
  const sessionEngine = cleanText(payload.sessionEngine);
  const retrievalMessage = enrichMessageWithHistoryFocus(message, history);
  const cursorValue = payload.cursor || (wantsContinue(message) ? contextPayload.lastCursor : '');
  const kind = deterministicKind(message, contextPayload);
  if (kind === 'current_customer') {
    const current = await currentCustomerAssistantAnswer(
      retrievalMessage,
      contextPayload,
      history,
      sessionId,
      sessionEngine,
      modelCall,
    );
    if (current) return current;
  }
  const deterministic = deterministicAnswer(kind, message, cursorValue, contextPayload);
  if (deterministic) return deterministic;

  const sqlContext = searchCrmContext(retrievalMessage);
  const vector = await semanticContext(retrievalMessage, contextPayload);
  if (vector?.results?.length) {
    sqlContext.vectorResults = vector.results;
    sqlContext.resultSets.push({
      name: 'vector.qwen',
      label: 'qwen_vector_results',
      total: vector.results.length,
      returned: vector.results.length,
      omitted: 0,
      limit: vector.results.length,
      truncated: false,
    });
  }
  const webContext = await searchWebContext(retrievalMessage, sqlContext, contextPayload);
  if (webContext?.results?.length) {
    sqlContext.webResults = webContext.results;
    sqlContext.resultSets.push({
      name: 'web.brave',
      label: 'brave_web_search',
      total: webContext.results.length,
      returned: webContext.results.length,
      omitted: 0,
      limit: webResultsLimit(),
      truncated: false,
    });
  } else if (webContext && !webContext.skipped && webContext.reason) {
    sqlContext.webSearch = { ok: false, reason: webContext.reason, query: webContext.query || '' };
  }
  const webPages = await fetchWebPagesContext(retrievalMessage, sqlContext, webContext);
  if (webPages?.pages?.length) {
    sqlContext.webPages = webPages.pages;
    sqlContext.resultSets.push({
      name: 'web.pages',
      label: 'opened_web_pages',
      total: webPages.pages.length,
      returned: webPages.pages.length,
      omitted: 0,
      limit: webFetchPagesLimit(),
      truncated: false,
    });
  } else if (webPages && !webPages.skipped && webPages.reason) {
    sqlContext.webPagesStatus = { ok: false, reason: webPages.reason };
  }

  const result = await modelCall(
    buildAssistantPrompt(message, sqlContext, history),
    {
      scope: contextPayload.scope || 'view',
      externalAllowed: !forbidsExternalSearch(message),
      sessionId,
      sessionEngine,
    },
  );
  if (!cleanText(result.answer)) {
    const err = new Error('DeepSeek 没有返回有效内容，请稍后重试。');
    err.statusCode = 502;
    throw err;
  }

  const answer = `${result.answer}${metadataNote(sqlContext)}`;
  const baseSources = [...collectSources(sqlContext), ...vectorSources(vector?.results || [])];
  const baseMatchedCustomers = matchedCustomers(sqlContext);
  const boundReferences = bindReferencesToAnswer(answer, baseSources, baseMatchedCustomers);

  return {
    ok: true,
    answer,
    sources: boundReferences.sources.slice(0, 30),
    matchedCustomers: boundReferences.matchedCustomers.slice(0, 30),
    resultSets: sqlContext.resultSets,
    actions: [],
    nextCursor: '',
    retrievalMode: webPages?.pages?.length ? (vector?.results?.length ? 'hybrid_web_page' : 'web_page') : (webContext?.results?.length ? (vector?.results?.length ? 'hybrid_web' : 'web_augmented') : (vector?.results?.length ? 'hybrid' : 'deterministic')),
    usage: result.usage,
    model: result.model,
    engine: result.engine,
    guardrails: result.guardrails,
    fallbackReason: result.fallbackReason,
    sessionId: selectedSessionId(result, sessionId, sessionEngine),
    sessionEngine: result.sessionEngine || sessionEngine,
  };
}

async function answerAssistantQuestion(payload = {}, accessContext = null, options = {}) {
  assertAssistantTargetAccess(payload, accessContext);
  const modelCall = typeof options.callAssistantModel === 'function'
    ? options.callAssistantModel
    : callAssistantModel;
  const result = await assistantAccess.run(accessContext, () => answerAssistantQuestionScoped(payload, modelCall));
  if (accessContext && !accessContext.permissions?.view_contacts) return redactContactFields(result);
  return result;
}

module.exports = {
  searchCrmContext,
  buildAssistantPrompt,
  callAssistantModel,
  callDeepSeek,
  assistantRuntimeState,
  setAssistantRuntimeMode,
  recheckAssistantEngines,
  deterministicKind,
  formatSources,
  answerAssistantQuestion,
  deterministicAnswer,
  fetchWebPagesContext,
};

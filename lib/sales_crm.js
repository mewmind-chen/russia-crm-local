const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const { analyzeManagerEvaluation } = require('./sales_evaluation_ai');
const {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  normalizePermissions,
  permissionsFor,
  hasPermission,
  assertPermission,
  buildAccessContext,
} = require('./access_control');

function databasePath() {
  return path.resolve(process.env.CRM_DB_PATH || path.join(__dirname, '..', 'data', 'crm.db'));
}

const STAGES = [
  ['new', '客户入库'],
  ['qualified', '确认对口'],
  ['contacted', '首次触达'],
  ['replied', '获得回复'],
  ['connected', '建立联系'],
  ['meeting', '深度沟通'],
  ['manager', '管理者介入'],
  ['rfq', '收到询价'],
  ['quoted', '已报价'],
  ['negotiating', '商务谈判'],
  ['won', '首次下单'],
  ['repeat', '复购客户'],
  ['lost', '暂停/流失'],
];

const STAGE_INDEX = Object.fromEntries(STAGES.map(([key], index) => [key, index]));
const STAGE_LABELS = Object.fromEntries(STAGES);

const ACTIVITY_STAGE = {
  email: 'contacted',
  call: 'contacted',
  social: 'connected',
  reply: 'replied',
  meeting: 'meeting',
  manager_join: 'manager',
  rfq: 'rfq',
  quote: 'quoted',
  negotiation: 'negotiating',
  order: 'won',
  repeat_order: 'repeat',
  lost: 'lost',
};

function db() {
  const dbPath = databasePath();
  require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
  const value = new Database(dbPath);
  value.pragma('journal_mode = WAL');
  value.pragma('foreign_keys = ON');
  return value;
}

function nowText(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOffset(days, hours = 0) {
  return nowText(new Date(Date.now() + days * 86400000 + hours * 3600000));
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function redactAuditPayload(value) {
  if (Array.isArray(value)) return value.map(redactAuditPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /password|token|secret|credential|authorization|cookie/i.test(key) ? '[REDACTED]' : redactAuditPayload(item),
  ]));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    languages: json(row.languages_json),
    countries: json(row.countries_json),
    channels: json(row.channels_json),
    permissions: permissionsFor(row),
    createdAt: row.created_at,
  };
}

function installSalesCrm() {
  const value = db();
  try {
    value.exec(`
      CREATE TABLE IF NOT EXISTS sales_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin','manager','sales')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        languages_json TEXT NOT NULL DEFAULT '[]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        channels_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sales_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES sales_users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_accounts (
        id TEXT PRIMARY KEY,
        external_customer_id TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        customer_type TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        product_focus TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'B',
        potential_value REAL NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT 'new',
        owner_id TEXT NOT NULL,
        manager_id TEXT NOT NULL DEFAULT '',
        manager_required INTEGER NOT NULL DEFAULT 0,
        manager_status TEXT NOT NULL DEFAULT '',
        last_activity_at TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        next_action_at TEXT NOT NULL DEFAULT '',
        loss_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(owner_id) REFERENCES sales_users(id)
      );
      CREATE INDEX IF NOT EXISTS crm_accounts_owner_idx ON crm_accounts(owner_id);
      CREATE INDEX IF NOT EXISTS crm_accounts_stage_idx ON crm_accounts(stage);
      CREATE INDEX IF NOT EXISTS crm_accounts_country_idx ON crm_accounts(country);
      CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_external_unique_idx
        ON crm_accounts(external_customer_id) WHERE external_customer_id!='';
      CREATE TABLE IF NOT EXISTS crm_activities (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        next_action TEXT NOT NULL DEFAULT '',
        next_action_at TEXT NOT NULL DEFAULT '',
        stage_after TEXT NOT NULL DEFAULT '',
        manager_required INTEGER NOT NULL DEFAULT 0,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES sales_users(id)
      );
      CREATE INDEX IF NOT EXISTS crm_activities_customer_idx ON crm_activities(customer_id,occurred_at DESC);
      CREATE TABLE IF NOT EXISTS crm_rfqs (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reference TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        bom_lines INTEGER NOT NULL DEFAULT 0,
        expected_value REAL NOT NULL DEFAULT 0,
        product_category TEXT NOT NULL DEFAULT '',
        completeness INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL,
        quoted_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_quotes (
        id TEXT PRIMARY KEY,
        rfq_id TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        gross_margin REAL NOT NULL DEFAULT 0,
        loss_leader INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'sent',
        sent_at TEXT NOT NULL,
        next_follow_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        quote_id TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        gross_margin REAL NOT NULL DEFAULT 0,
        is_repeat INTEGER NOT NULL DEFAULT 0,
        ordered_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS crm_intake_settings (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        approval_mode TEXT NOT NULL DEFAULT 'automatic',
        daily_per_sales INTEGER NOT NULL DEFAULT 5,
        claim_sla_hours INTEGER NOT NULL DEFAULT 24,
        contact_sla_hours INTEGER NOT NULL DEFAULT 48,
        match_groups_json TEXT NOT NULL DEFAULT '["A","B"]',
        countries_json TEXT NOT NULL DEFAULT '[]',
        updated_by TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_intake_batches (
        id TEXT PRIMARY KEY,
        batch_date TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'screened-customer-pool',
        status TEXT NOT NULL DEFAULT 'scanned',
        candidate_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        assigned_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS crm_intake_batches_date_idx ON crm_intake_batches(batch_date,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_intake_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        external_customer_id TEXT NOT NULL UNIQUE,
        crm_customer_id TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        website TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        customer_type TEXT NOT NULL DEFAULT '',
        product_focus TEXT NOT NULL DEFAULT '',
        match_score INTEGER NOT NULL DEFAULT 0,
        match_group TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '',
        contact_title TEXT NOT NULL DEFAULT '',
        contact_methods TEXT NOT NULL DEFAULT '',
        contact_level TEXT NOT NULL DEFAULT 'L3',
        evidence_urls TEXT NOT NULL DEFAULT '',
        report_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        suggested_owner_id TEXT NOT NULL DEFAULT '',
        assigned_owner_id TEXT NOT NULL DEFAULT '',
        decision_reason TEXT NOT NULL DEFAULT '',
        return_reason TEXT NOT NULL DEFAULT '',
        assigned_at TEXT NOT NULL DEFAULT '',
        claim_due_at TEXT NOT NULL DEFAULT '',
        claimed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(batch_id) REFERENCES crm_intake_batches(id)
      );
      CREATE INDEX IF NOT EXISTS crm_intake_items_status_idx ON crm_intake_items(status,assigned_owner_id);
      CREATE TABLE IF NOT EXISTS crm_account_contacts (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        social TEXT NOT NULL DEFAULT '',
        source_contact_id TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS crm_account_contacts_customer_idx ON crm_account_contacts(customer_id);
      CREATE TABLE IF NOT EXISTS crm_manager_evaluations (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK(subject_type IN ('company','contact')),
        subject_id TEXT NOT NULL DEFAULT '',
        subject_name TEXT NOT NULL DEFAULT '',
        subject_title TEXT NOT NULL DEFAULT '',
        evaluation_text TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        ai_status TEXT NOT NULL DEFAULT 'pending',
        ai_summary TEXT NOT NULL DEFAULT '',
        ai_labels_json TEXT NOT NULL DEFAULT '[]',
        ai_order_keys_json TEXT NOT NULL DEFAULT '[]',
        ai_risks_json TEXT NOT NULL DEFAULT '[]',
        ai_strategy TEXT NOT NULL DEFAULT '',
        ai_model TEXT NOT NULL DEFAULT '',
        ai_error TEXT NOT NULL DEFAULT '',
        ai_generated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES crm_accounts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS crm_manager_evaluations_customer_idx ON crm_manager_evaluations(customer_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_audit_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS crm_audit_log_created_idx ON crm_audit_log(created_at DESC);
      CREATE TABLE IF NOT EXISTS crm_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unread',
        dedupe_key TEXT NOT NULL UNIQUE,
        wecom_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        read_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS crm_notifications_user_idx ON crm_notifications(user_id,status,created_at DESC);
    `);
    ensureAccountIntakeColumns(value);
    ensureIntakeItemColumns(value);
    ensureUserPermissionColumns(value);
    value.prepare(`INSERT OR IGNORE INTO crm_intake_settings
      (id,enabled,approval_mode,daily_per_sales,claim_sla_hours,contact_sla_hours,match_groups_json,countries_json,updated_by,updated_at)
      VALUES ('default',1,'automatic',5,24,48,'["A","B","C","D"]','[]','system',?)`).run(nowText());
    value.prepare(`UPDATE crm_intake_settings SET claim_sla_hours=24,contact_sla_hours=48,updated_at=?
      WHERE id='default' AND updated_by='system' AND claim_sla_hours=12 AND contact_sla_hours=24`).run(nowText());
    seedUsers(value);
    if (String(process.env.CRM_SEED_DEMO_DATA || '').toLowerCase() === 'true') seedAccounts(value);
  } finally {
    value.close();
  }
}

function ensureAccountIntakeColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  const additions = {
    intake_item_id: "TEXT NOT NULL DEFAULT ''",
    assignment_status: "TEXT NOT NULL DEFAULT 'claimed'",
    assigned_at: "TEXT NOT NULL DEFAULT ''",
    claim_due_at: "TEXT NOT NULL DEFAULT ''",
    claimed_at: "TEXT NOT NULL DEFAULT ''",
    return_reason: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) value.exec(`ALTER TABLE crm_accounts ADD COLUMN ${name} ${definition}`);
  }
}

function ensureIntakeItemColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name));
  if (!columns.has('evidence_urls')) value.exec("ALTER TABLE crm_intake_items ADD COLUMN evidence_urls TEXT NOT NULL DEFAULT ''");
}

function ensureUserPermissionColumns(value) {
  const columns = new Set(value.prepare('PRAGMA table_info(sales_users)').all().map(row => row.name));
  if (!columns.has('permissions_json')) value.exec("ALTER TABLE sales_users ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
}

function seedUsers(value) {
  if (value.prepare('SELECT COUNT(*) n FROM sales_users').get().n) return;
  const users = [
    ['USR-ADMIN', process.env.CRM_ADMIN_EMAIL || 'admin@crm.local', '系统管理员', 'admin', process.env.CRM_ADMIN_PASSWORD || 'ChangeMe123!', ['中文', '英文'], ['全球'], ['管理介入']],
    ['USR-MGR', 'manager@crm.local', '林总', 'manager', 'Manager123!', ['中文', '英文', '俄语'], ['俄罗斯', '巴西'], ['视频会议', '商务谈判']],
    ['USR-S01', 'anna@crm.local', 'Anna 陈', 'sales', 'Sales123!', ['中文', '英文', '葡萄牙语'], ['巴西', '葡萄牙'], ['邮件', 'WhatsApp', '视频会议']],
    ['USR-S02', 'ivan@crm.local', 'Ivan 李', 'sales', 'Sales123!', ['中文', '英文', '俄语'], ['俄罗斯', '哈萨克斯坦'], ['电话', 'Telegram', '展会']],
    ['USR-S03', 'mia@crm.local', 'Mia 周', 'sales', 'Sales123!', ['中文', '英文'], ['美国', '德国'], ['邮件', 'LinkedIn']],
    ['USR-S04', 'leo@crm.local', 'Leo 王', 'sales', 'Sales123!', ['中文', '英文', '西班牙语'], ['墨西哥', '智利'], ['电话', 'WhatsApp']],
  ];
  const insert = value.prepare(`INSERT INTO sales_users
    (id,email,name,role,password_hash,password_salt,active,must_change_password,languages_json,countries_json,channels_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)`);
  const now = nowText();
  for (const [userId, email, name, role, password, languages, countries, channels] of users) {
    const pw = hashPassword(password);
    insert.run(userId, email.toLowerCase(), name, role, pw.hash, pw.salt, role === 'admin' ? 1 : 0, JSON.stringify(languages), JSON.stringify(countries), JSON.stringify(channels), now, now);
  }
}

function seedAccounts(value) {
  if (value.prepare('SELECT COUNT(*) n FROM crm_accounts').get().n) return;
  const pool = value.prepare(`SELECT customer_id,company_name,country,city,website,industry,customer_type,products
    FROM customer_pool WHERE trim(company_name) != '' ORDER BY
    CASE WHEN trim(country) != '' THEN 0 ELSE 1 END, customer_id DESC LIMIT 24`).all();
  const fallbacks = [
    ['DEMO-BR-01', 'Aurea Automação', '巴西', '圣保罗', '工业自动化', '终端制造商', 'MCU / 连接器'],
    ['DEMO-US-01', 'Northstar Controls', '美国', '芝加哥', '工业控制', '终端制造商', '传感器 / FPGA'],
    ['DEMO-RU-01', 'Volga Instrument', '俄罗斯', '喀山', '仪器仪表', '终端制造商', '模拟IC / 电源模块'],
  ];
  while (pool.length < 18) {
    const item = fallbacks[pool.length % fallbacks.length];
    pool.push({ customer_id: `${item[0]}-${pool.length}`, company_name: `${item[1]} ${pool.length + 1}`, country: item[2], city: item[3], website: '', industry: item[4], customer_type: item[5], products: item[6] });
  }
  const stages = ['qualified', 'contacted', 'replied', 'connected', 'meeting', 'manager', 'rfq', 'quoted', 'negotiating', 'won', 'repeat', 'meeting', 'quoted', 'contacted', 'manager', 'rfq', 'qualified', 'lost'];
  const countries = ['俄罗斯', '巴西', '美国', '德国', '墨西哥', '哈萨克斯坦'];
  const owners = ['USR-S01', 'USR-S02', 'USR-S03', 'USR-S04'];
  const sources = ['公司指派', '邮件搜索', 'LinkedIn', '展会', '海关数据'];
  const insertAccount = value.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertActivity = value.prepare(`INSERT INTO crm_activities
    (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertRfq = value.prepare(`INSERT INTO crm_rfqs
    (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertQuote = value.prepare(`INSERT INTO crm_quotes
    (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertOrder = value.prepare(`INSERT INTO crm_orders
    (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  pool.slice(0, 18).forEach((row, index) => {
    const customerId = `CRM-${String(index + 1).padStart(4, '0')}`;
    const owner = owners[index % owners.length];
    const stage = stages[index];
    const stageIndex = STAGE_INDEX[stage];
    const created = dateOffset(-42 + index);
    const lastDays = [1, 2, 0, 5, 9, 8, 2, 4, 1, 3, 1, 12, 5, 16, 10, 1, 20, 14][index];
    const last = dateOffset(-lastDays);
    const country = row.country || countries[index % countries.length];
    const needsManager = ['meeting', 'manager', 'rfq', 'quoted', 'negotiating'].includes(stage) && index % 3 === 0;
    insertAccount.run(
      customerId, row.customer_id || '', row.company_name, country, row.city || '', row.website || '',
      row.industry || ['工业控制', '汽车电子', '医疗设备'][index % 3], row.customer_type || '终端制造商',
      sources[index % sources.length], row.products || 'IC / 连接器', ['A', 'B', 'B', 'C'][index % 4],
      12000 + index * 3700, stage, owner, 'USR-MGR', needsManager ? 1 : 0,
      needsManager ? '待介入' : '', last,
      stage === 'lost' ? '' : ['确认采购周期', '安排电话会议', '追踪BOM', '报价后回访'][index % 4],
      stage === 'lost' ? '' : dateOffset(index % 4 - 1), stage === 'lost' ? '项目暂停' : '', created, last,
    );
    const timeline = [
      ['qualified', 'note', 'qualification', '客户匹配', '已确认行业、产品及采购入口'],
      ['contacted', 'email', 'email', '已送达', '发送首封个性化开发邮件'],
      ['replied', 'reply', 'email', '有兴趣', '客户回复并希望了解供货品牌'],
      ['connected', 'social', index % 2 ? 'Telegram' : 'WhatsApp', '已添加', '建立社交媒体联系'],
      ['meeting', 'meeting', 'video', '已完成', '完成需求沟通会议'],
      ['manager', 'manager_join', 'video', '已介入', '管理者参加重点客户会议'],
      ['rfq', 'rfq', 'email', '收到BOM', '收到正式询价清单'],
      ['quoted', 'quote', 'email', '已发送', '报价已发送客户'],
      ['negotiating', 'negotiation', 'call', '谈判中', '沟通价格、交期与付款条件'],
      ['won', 'order', 'email', '首单', '客户确认首次订单'],
      ['repeat', 'repeat_order', 'email', '复购', '客户完成第二次采购'],
    ];
    timeline.filter(item => STAGE_INDEX[item[0]] <= stageIndex && item[0] !== 'lost').forEach((item, eventIndex, all) => {
      const occurred = eventIndex === all.length - 1 ? last : dateOffset(-40 + index + eventIndex * 3);
      insertActivity.run(
        `${customerId}-A${eventIndex + 1}`, customerId, owner, item[1], item[2], item[3], item[4],
        eventIndex === all.length - 1 ? ['确认采购周期', '安排下一次电话', '追踪BOM'][index % 3] : '',
        eventIndex === all.length - 1 ? dateOffset(index % 4 - 1) : '', item[0],
        item[0] === 'meeting' && needsManager ? 1 : 0, occurred, occurred,
      );
    });
    if (stageIndex >= STAGE_INDEX.rfq && stage !== 'lost') {
      const rfqId = `${customerId}-RFQ1`, received = dateOffset(-Math.max(1, lastDays + 4));
      const quotedAt = stageIndex >= STAGE_INDEX.quoted ? dateOffset(-Math.max(1, lastDays + 2)) : '';
      insertRfq.run(rfqId, customerId, owner, `RFQ-${20260700 + index}`, stageIndex >= STAGE_INDEX.quoted ? 'quoted' : 'open', 4 + index * 2, 8000 + index * 2100, ['MCU', '连接器', '传感器'][index % 3], 72 + index % 4 * 7, received, quotedAt, received);
      if (quotedAt) {
        const quoteId = `${customerId}-Q1`;
        insertQuote.run(quoteId, rfqId, customerId, owner, 7600 + index * 1900, 'USD', index % 4 === 0 ? -2.5 : 8 + index % 5, index % 4 === 0 ? 1 : 0, stageIndex >= STAGE_INDEX.won ? 'won' : 'sent', quotedAt, dateOffset(-Math.max(0, lastDays - 1)), quotedAt);
        if (stageIndex >= STAGE_INDEX.won) {
          insertOrder.run(`${customerId}-O1`, customerId, quoteId, owner, 7200 + index * 1800, 'USD', 2 + index % 5, 0, dateOffset(-Math.max(1, lastDays)), dateOffset(-Math.max(1, lastDays)));
          if (stage === 'repeat') insertOrder.run(`${customerId}-O2`, customerId, quoteId, owner, 16800, 'USD', 12, 1, last, last);
        }
      }
    }
  });
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

function sessionUser(req) {
  const token = parseCookies(req.headers.cookie || '').sales_session || '';
  if (!token) return null;
  const value = db();
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return value.prepare(`SELECT u.* FROM sales_sessions s JOIN sales_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash, nowText()) || null;
  } finally { value.close(); }
}

function canAccess(user, account) {
  return user.role !== 'sales' || account.owner_id === user.id;
}

function requireSalesUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录', code: 'AUTH_REQUIRED' });
  if (user.must_change_password && req.path !== '/bootstrap' && req.path !== '/password') {
    return res.status(403).json({ ok: false, error: '首次登录必须先修改初始密码' });
  }
  req.salesUser = user;
  const value = db();
  try { req.accessContext = buildAccessContext(value, user); }
  finally { value.close(); }
  next();
}

function requireUnifiedUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ ok: false, error: '请先登录' });
  req.salesUser = user;
  const value = db();
  try { req.accessContext = buildAccessContext(value, user); }
  finally { value.close(); }
  next();
}

function rate(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
}

function accountScope(user) {
  return hasPermission(user, 'view_all_customers')
    ? { sql: '', params: [] }
    : { sql: "WHERE a.owner_id=? AND COALESCE(a.assignment_status,'claimed')!='returned'", params: [user.id] };
}

function buildAlerts(accounts, activities, rfqs, quotes) {
  const latestByCustomer = new Map();
  activities.forEach(activity => {
    if (!latestByCustomer.has(activity.customer_id)) latestByCustomer.set(activity.customer_id, activity);
  });
  const rfqByCustomer = new Map(rfqs.map(row => [row.customer_id, row]));
  const quoteByCustomer = new Map(quotes.map(row => [row.customer_id, row]));
  const now = Date.now();
  const hours = value => value ? (now - new Date(String(value).replace(' ', 'T') + 'Z').getTime()) / 3600000 : Infinity;
  const alerts = [];
  const add = (account, severity, code, title, detail, action) => alerts.push({
    id: `${code}-${account.id}`, severity, code, title, detail, action,
    customerId: account.id, companyName: account.company_name, ownerId: account.owner_id,
    dueAt: account.next_action_at || '', stage: account.stage,
  });
  for (const account of accounts) {
    const last = latestByCustomer.get(account.id);
    const age = hours(account.last_activity_at || account.created_at);
    const nextAt = account.next_action_at ? new Date(String(account.next_action_at).replace(' ', 'T') + 'Z').getTime() : 0;
    const claimDue = account.claim_due_at ? new Date(String(account.claim_due_at).replace(' ', 'T') + 'Z').getTime() : 0;
    if (account.assignment_status === 'assigned' && claimDue && claimDue < now) add(account, 'critical', 'UNCLAIMED', '每日客户未按时领取', '系统推送的客户已超过领取时限', '立即领取或重新分配');
    if (account.intake_item_id && account.assignment_status === 'claimed' && account.stage === 'qualified' && hours(account.claimed_at || account.assigned_at) > 48) {
      add(account, 'critical', 'INTAKE_IDLE', '领取后48小时未首次触达', '销售已领取每日客户，但尚未完成邮件、电话或社媒触达', '立即完成首次触达');
    }
    if (!['won', 'repeat', 'lost'].includes(account.stage) && !account.next_action) add(account, 'critical', 'NO_NEXT', '缺少下一步计划', '活跃客户没有明确的下一步动作与日期', '立即补充计划');
    if (nextAt && nextAt < now && !['won', 'repeat', 'lost'].includes(account.stage)) add(account, 'critical', 'OVERDUE', '跟进任务已超期', `${account.next_action} 已超过计划时间`, '今天完成跟进');
    if (account.stage === 'replied' && age > 24) add(account, 'critical', 'REPLY_IDLE', '客户回复后未及时推进', `客户回复后已停滞 ${Math.floor(age)} 小时`, '立即响应客户');
    if (['meeting', 'manager'].includes(account.stage) && age > 168) add(account, 'critical', 'MEETING_NO_RFQ', '会议后7天未收到询价', '需要确认采购时间、BOM准备状态或会议质量', '销售复盘并追踪BOM');
    if (account.manager_required && account.manager_status !== '已完成') add(account, 'warning', 'MANAGER_NEEDED', '需要管理者介入', account.manager_status || '销售已发起管理者协助', '安排管理者参与');
    const rfq = rfqByCustomer.get(account.id);
    if (rfq && !rfq.quoted_at && hours(rfq.received_at) > 24) add(account, 'critical', 'RFQ_UNQUOTED', '询价超过24小时未报价', `${rfq.bom_lines} 行BOM仍未完成报价`, '立即协调采购报价');
    const quote = quoteByCustomer.get(account.id);
    if (quote && !['won', 'lost'].includes(quote.status) && hours(account.last_activity_at) > 72) add(account, 'warning', 'QUOTE_IDLE', '报价后3天未跟进', '报价已发送但没有新的有效动作', '确认客户反馈');
    if (age > 336 && !['won', 'repeat', 'lost'].includes(account.stage)) add(account, 'warning', 'STALE', '客户超过14天未推进', `当前停留在“${STAGE_LABELS[account.stage] || account.stage}”`, '决定继续、转交或关闭');
    if (last && last.manager_required && age > 72 && account.manager_status === '已介入') add(account, 'critical', 'POST_MANAGER_IDLE', '管理者介入后销售未承接', '管理者参与后超过3天没有销售跟进行动', '销售立即承接');
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => priority[a.severity] - priority[b.severity] || a.companyName.localeCompare(b.companyName));
}

function buildIntakeAlerts(value, user) {
  const scope = user.role === 'sales' ? 'AND i.assigned_owner_id=?' : '';
  return value.prepare(`SELECT i.*,u.name owner_name FROM crm_intake_items i
    LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
    WHERE i.status='assigned' AND i.claim_due_at!='' AND i.claim_due_at<? ${scope}
    ORDER BY i.claim_due_at`).all(nowText(), ...(user.role === 'sales' ? [user.id] : [])).map(item => ({
      id: `UNCLAIMED-LEAD-${item.id}`,
      severity: 'critical',
      code: 'UNCLAIMED_LEAD',
      title: '未开发线索超过24小时未领取',
      detail: `已分配给 ${item.owner_name || '销售'}，仍未确认领取`,
      action: '进入分配中心处理',
      customerId: '',
      companyName: item.company_name,
      ownerId: item.assigned_owner_id,
      dueAt: item.claim_due_at,
      stage: 'lead-assigned',
      intakeItemId: item.id,
      externalCustomerId: item.external_customer_id,
    }));
}

function buildCountryReport(accounts, activities, orders) {
  const report = {};
  const hasActivity = (customerId, types) => activities.some(row => row.customer_id === customerId && types.includes(row.activity_type));
  for (const account of accounts) {
    const key = account.country || '未标注';
    const item = report[key] ||= { country: key, accounts: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, orders: 0, repeatOrders: 0, revenue: 0, grossProfit: 0 };
    item.accounts += 1;
    if (hasActivity(account.id, ['email', 'call', 'social'])) item.contacted += 1;
    if (hasActivity(account.id, ['reply'])) item.replied += 1;
    if (hasActivity(account.id, ['meeting', 'manager_join'])) item.meetings += 1;
    if (hasActivity(account.id, ['rfq'])) item.rfqs += 1;
    const customerOrders = orders.filter(order => order.customer_id === account.id);
    if (customerOrders.length) item.orders += 1;
    if (customerOrders.some(order => order.is_repeat)) item.repeatOrders += 1;
    item.revenue += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
    item.grossProfit += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0) * Number(order.gross_margin || 0) / 100, 0);
  }
  return Object.values(report).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.accounts),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.replied),
    rfqRate: rate(item.rfqs, item.meetings || item.contacted),
    orderRate: rate(item.orders, item.rfqs),
    repeatRate: rate(item.repeatOrders, item.orders),
    valuePerAccount: Math.round(item.grossProfit / Math.max(1, item.accounts)),
    sampleStatus: item.accounts < 10 ? '样本不足' : '可参考',
  })).sort((a, b) => b.valuePerAccount - a.valuePerAccount || b.orderRate - a.orderRate);
}

function buildCohortReport(accounts, activities, orders) {
  const groups = {};
  const order = STAGE_INDEX;
  for (const account of accounts) {
    const date = String(account.assigned_at || account.created_at || '').slice(0, 7) || '未标注';
    const item = groups[date] ||= { cohort: date, assigned: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, ordered: 0, revenue: 0 };
    item.assigned += 1;
    if (account.stage !== 'lost' && order[account.stage] >= order.contacted) item.contacted += 1;
    if (account.stage !== 'lost' && order[account.stage] >= order.replied) item.replied += 1;
    if (account.stage !== 'lost' && order[account.stage] >= order.meeting) item.meetings += 1;
    if (activities.some(row => row.customer_id === account.id && row.activity_type === 'rfq')) item.rfqs += 1;
    const customerOrders = orders.filter(row => row.customer_id === account.id);
    if (customerOrders.length) item.ordered += 1;
    item.revenue += customerOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }
  return Object.values(groups).sort((a, b) => b.cohort.localeCompare(a.cohort)).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.assigned),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.contacted),
    rfqRate: rate(item.rfqs, item.meetings),
    orderRate: rate(item.ordered, item.rfqs),
  }));
}

function buildTeamReport(users, accounts, activities, rfqs, quotes, orders) {
  return users.filter(user => user.role === 'sales').map(user => {
    const owned = accounts.filter(row => row.owner_id === user.id);
    const customerIds = new Set(owned.map(row => row.id));
    const acts = activities.filter(row => customerIds.has(row.customer_id));
    const userRfqs = rfqs.filter(row => customerIds.has(row.customer_id));
    const userQuotes = quotes.filter(row => customerIds.has(row.customer_id));
    const userOrders = orders.filter(row => customerIds.has(row.customer_id));
    const unique = type => new Set(acts.filter(row => type.includes(row.activity_type)).map(row => row.customer_id)).size;
    const contacted = unique(['email', 'call', 'social']);
    const replied = unique(['reply']);
    const connected = unique(['social']);
    const meetings = unique(['meeting', 'manager_join']);
    const rfqCount = new Set(userRfqs.map(row => row.customer_id)).size;
    const won = new Set(userOrders.map(row => row.customer_id)).size;
    const repeated = new Set(userOrders.filter(row => row.is_repeat).map(row => row.customer_id)).size;
    const overdue = owned.filter(row => row.next_action_at && new Date(String(row.next_action_at).replace(' ', 'T') + 'Z').getTime() < Date.now() && !['won', 'repeat', 'lost'].includes(row.stage)).length;
    const planned = owned.filter(row => row.next_action && row.next_action_at).length;
    const managerCases = owned.filter(row => row.manager_required).length;
    const managerFollowed = owned.filter(row => row.manager_required && ['rfq', 'quoted', 'negotiating', 'won', 'repeat'].includes(row.stage)).length;
    const rfqComplete = userRfqs.length ? userRfqs.reduce((sum, row) => sum + Number(row.completeness || 0), 0) / userRfqs.length : 0;
    const quoteCoverage = rate(userQuotes.length, userRfqs.length);
    const scores = {
      activation: Math.round(Math.min(100, rate(contacted, owned.length))),
      outreach: Math.round(Math.min(100, (rate(replied, contacted) * 1.7))),
      relationship: Math.round(Math.min(100, (rate(meetings, Math.max(replied, 1)) * 1.2))),
      discovery: Math.round(Math.min(100, (rate(rfqCount, Math.max(meetings, 1)) * 1.2))),
      professional: Math.round(Math.min(100, rfqComplete * 0.7 + quoteCoverage * 0.3)),
      conversion: Math.round(Math.min(100, rate(won, Math.max(rfqCount, 1)) * 1.6)),
      retention: Math.round(Math.min(100, rate(repeated, Math.max(won, 1)) * 2)),
      execution: Math.round(Math.max(0, Math.min(100, rate(planned, Math.max(owned.length, 1)) - rate(overdue, Math.max(owned.length, 1)) * 0.6))),
      collaboration: Math.round(Math.min(100, rate(managerFollowed, Math.max(managerCases, 1)) * 1.2)),
    };
    const overall = Math.round(Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length);
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const countryPerformance = buildCountryReport(owned, acts, userOrders).slice(0, 2);
    const channelCounts = {};
    acts.forEach(activity => { if (activity.channel) channelCounts[activity.channel] = (channelCounts[activity.channel] || 0) + 1; });
    const channelPerformance = Object.entries(channelCounts).map(([channel, actions]) => {
      const touchedIds = new Set(acts.filter(activity => activity.channel === channel).map(activity => activity.customer_id));
      const channelReplies = new Set(acts.filter(activity => touchedIds.has(activity.customer_id) && activity.activity_type === 'reply').map(activity => activity.customer_id)).size;
      const channelRfqs = new Set(userRfqs.filter(rfq => touchedIds.has(rfq.customer_id)).map(rfq => rfq.customer_id)).size;
      return { channel, actions, customers: touchedIds.size, replyRate: rate(channelReplies, touchedIds.size), rfqRate: rate(channelRfqs, touchedIds.size) };
    }).sort((a, b) => b.rfqRate - a.rfqRate || b.replyRate - a.replyRate || b.actions - a.actions);
    const bestChannels = channelPerformance.slice(0, 2).map(item => item.channel);
    return {
      user: safeUser(user), sampleSize: owned.length, sampleStatus: owned.length < 10 ? '样本不足' : '可评估',
      overall, scores, strongest: sorted.slice(0, 2).map(([key]) => key), weakest: sorted.slice(-2).map(([key]) => key),
      metrics: { assigned: owned.length, contacted, replied, connected, meetings, rfqs: rfqCount, quotes: userQuotes.length, orders: won, repeats: repeated, overdue, planned },
      rates: { activation: rate(contacted, owned.length), reply: rate(replied, contacted), meeting: rate(meetings, replied), rfq: rate(rfqCount, meetings), order: rate(won, rfqCount), repeat: rate(repeated, won) },
      bestCountries: countryPerformance.map(row => row.country), bestChannels, channelPerformance,
      revenue: userOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(userOrders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
    };
  }).sort((a, b) => b.overall - a.overall);
}

function normalizeCountry(value) {
  const text = String(value || '').trim().toLowerCase();
  const map = { ru: '俄罗斯', russia: '俄罗斯', br: '巴西', brazil: '巴西', us: '美国', usa: '美国', de: '德国', germany: '德国', kz: '哈萨克斯坦', kazakhstan: '哈萨克斯坦' };
  return map[text] || String(value || '').trim();
}

function chooseIntakeOwner(candidate, users, loadByOwner = {}, dailyByOwner = {}, quota = 5) {
  const country = normalizeCountry(candidate.country);
  const methods = String(candidate.contact_methods || '').toLowerCase();
  const eligible = users.filter(user => user.role === 'sales' && user.active && Number(dailyByOwner[user.id] || 0) < quota);
  const scored = eligible.map(user => {
    const countries = json(user.countries_json).map(normalizeCountry);
    const languages = json(user.languages_json);
    const channels = json(user.channels_json).map(item => String(item).toLowerCase());
    let score = 30 - Math.min(25, Number(loadByOwner[user.id] || 0) * 2);
    const reasons = [];
    if (countries.includes(country)) { score += 45; reasons.push(`国家经验：${country}`); }
    if (country === '俄罗斯' && languages.some(item => String(item).includes('俄'))) { score += 20; reasons.push('俄语能力'); }
    if (country === '巴西' && languages.some(item => String(item).includes('葡'))) { score += 20; reasons.push('葡萄牙语能力'); }
    if (country === '墨西哥' && languages.some(item => String(item).includes('西'))) { score += 20; reasons.push('西班牙语能力'); }
    const matchedChannels = channels.filter(channel => channel && methods.includes(channel.toLowerCase()));
    if (matchedChannels.length) { score += 12; reasons.push(`渠道匹配：${matchedChannels[0]}`); }
    score += Math.max(0, 10 - Number(dailyByOwner[user.id] || 0) * 2);
    return { userId: user.id, score, reason: reasons.join('；') || '按当前负荷均衡分配' };
  }).sort((a, b) => b.score - a.score || Number(loadByOwner[a.userId] || 0) - Number(loadByOwner[b.userId] || 0) || a.userId.localeCompare(b.userId));
  return scored[0] || null;
}

function activeWorkloadByOwner(value) {
  const result = {};
  const accountRows = value.prepare(`SELECT owner_id,COUNT(*) n FROM crm_accounts
    WHERE stage NOT IN ('won','repeat','lost') AND COALESCE(assignment_status,'claimed')!='returned'
    GROUP BY owner_id`).all();
  const assignedLeadRows = value.prepare(`SELECT assigned_owner_id owner_id,COUNT(*) n FROM crm_intake_items
    WHERE status='assigned' AND assigned_owner_id!='' GROUP BY assigned_owner_id`).all();
  for (const row of [...accountRows, ...assignedLeadRows]) {
    result[row.owner_id] = Number(result[row.owner_id] || 0) + Number(row.n || 0);
  }
  return result;
}

function loadIntakeState(value, user) {
  const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
  const settings = {
    enabled: Boolean(settingsRow.enabled),
    approvalMode: settingsRow.approval_mode,
    dailyPerSales: settingsRow.daily_per_sales,
    claimSlaHours: settingsRow.claim_sla_hours,
    contactSlaHours: settingsRow.contact_sla_hours,
    matchGroups: json(settingsRow.match_groups_json),
    countries: json(settingsRow.countries_json),
    updatedAt: settingsRow.updated_at,
  };
  const where = user.role === 'sales' ? 'WHERE i.assigned_owner_id=?' : '';
  const params = user.role === 'sales' ? [user.id] : [];
  const items = value.prepare(`SELECT i.*,u.name suggested_owner_name,a.name assigned_owner_name
    FROM crm_intake_items i
    LEFT JOIN sales_users u ON u.id=i.suggested_owner_id
    LEFT JOIN sales_users a ON a.id=i.assigned_owner_id
    ${where} ORDER BY CASE i.status
      WHEN 'assigned' THEN 0 WHEN 'claimed' THEN 1 WHEN 'returned' THEN 2
      WHEN 'pending' THEN 3 WHEN 'approved' THEN 4 ELSE 5 END,
      i.created_at DESC,i.match_score DESC LIMIT 500`).all(...params);
  const batches = user.role === 'sales' ? [] : value.prepare('SELECT * FROM crm_intake_batches ORDER BY created_at DESC LIMIT 30').all();
  const today = nowText().slice(0, 10);
  const countWhere = user.role === 'sales' ? 'WHERE assigned_owner_id=?' : '';
  const countParams = user.role === 'sales' ? [user.id] : [];
  const statusRows = value.prepare(`SELECT status,COUNT(*) n FROM crm_intake_items ${countWhere} GROUP BY status`).all(...countParams);
  const statusCounts = Object.fromEntries(statusRows.map(row => [row.status, row.n]));
  const todayImported = value.prepare(`SELECT COUNT(*) n FROM crm_intake_items ${countWhere ? `${countWhere} AND` : 'WHERE'} created_at>=?`)
    .get(...countParams, `${today} 00:00:00`).n;
  const overdueClaim = value.prepare(`SELECT COUNT(*) n FROM crm_intake_items ${countWhere ? `${countWhere} AND` : 'WHERE'} status='assigned' AND claim_due_at!='' AND claim_due_at<?`)
    .get(...countParams, nowText()).n;
  const contactedWhere = user.role === 'sales' ? 'AND a.owner_id=?' : '';
  const contacted = value.prepare(`SELECT COUNT(*) n FROM crm_accounts a WHERE a.intake_item_id!=''
    AND a.stage IN ('contacted','replied','connected','meeting','manager','rfq','quoted','negotiating','won','repeat') ${contactedWhere}`)
    .get(...(user.role === 'sales' ? [user.id] : [])).n;
  const counts = status => Number(statusCounts[status] || 0);
  return {
    settings, items, batches,
    stats: {
      todayImported,
      pending: counts('pending'),
      approved: counts('approved'),
      assigned: counts('assigned'),
      claimed: counts('claimed'),
      contacted,
      idle: counts('pending') + counts('approved') + counts('returned'),
      returned: counts('returned'),
      rejected: counts('rejected'),
      overdueClaim,
    },
  };
}

function normalizeEvaluation(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    subjectTitle: row.subject_title,
    evaluationText: row.evaluation_text,
    authorId: row.author_id,
    authorName: row.author_name,
    aiStatus: row.ai_status,
    aiSummary: row.ai_summary,
    aiLabels: json(row.ai_labels_json),
    aiOrderKeys: json(row.ai_order_keys_json),
    aiRisks: json(row.ai_risks_json),
    aiStrategy: row.ai_strategy,
    aiModel: row.ai_model,
    aiError: row.ai_error,
    aiGeneratedAt: row.ai_generated_at,
    createdAt: row.created_at,
  };
}

function loadInsights(value, accounts) {
  if (!accounts.length) return { contacts: [], evaluations: [] };
  const accountIds = accounts.map(row => row.id);
  const placeholders = accountIds.map(() => '?').join(',');
  const localContacts = value.prepare(`SELECT * FROM crm_account_contacts WHERE customer_id IN (${placeholders}) ORDER BY name`).all(...accountIds)
    .map(row => ({
      id: `local:${row.id}`, rawId: row.id, customerId: row.customer_id, name: row.name, title: row.title,
      department: row.department, phone: row.phone, email: row.email, social: row.social,
      contactLevel: '人工录入', source: 'manager',
    }));
  const accountByExternal = new Map(accounts.filter(row => row.external_customer_id).map(row => [row.external_customer_id, row.id]));
  const externalIds = [...accountByExternal.keys()];
  let externalContacts = [];
  if (externalIds.length) {
    const externalPlaceholders = externalIds.map(() => '?').join(',');
    externalContacts = value.prepare(`SELECT p.*,
      (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=p.person_id) methods
      FROM person_candidates p WHERE p.customer_id IN (${externalPlaceholders})
      ORDER BY CASE p.contact_level WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,p.updated_at DESC`).all(...externalIds)
      .filter(row => row.full_name)
      .map(row => ({
        id: `person:${row.person_id}`, rawId: row.person_id, customerId: accountByExternal.get(row.customer_id),
        name: row.full_name_local || row.full_name, title: row.title || '', department: row.department || '',
        phone: '', email: '', social: row.methods || '', contactLevel: row.contact_level || 'L0', source: 'recon',
      }));
  }
  const evaluations = value.prepare(`SELECT * FROM crm_manager_evaluations WHERE customer_id IN (${placeholders}) ORDER BY created_at DESC`).all(...accountIds).map(normalizeEvaluation);
  return { contacts: [...localContacts, ...externalContacts], evaluations };
}

function createAccountContact(user, payload) {
  assertPermission(user, 'edit_customer');
  if (user.role === 'sales') { const error = new Error('只有管理层可以维护联系人评价对象'); error.statusCode = 403; throw error; }
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('请输入联系人姓名');
    const contactId = id('P');
    const now = nowText();
    value.prepare(`INSERT INTO crm_account_contacts
      (id,customer_id,name,title,department,phone,email,social,source_contact_id,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      contactId, account.id, name, String(payload.title || ''), String(payload.department || ''),
      String(payload.phone || ''), String(payload.email || ''), String(payload.social || ''), '', user.id, now, now,
    );
    return { contactId: `local:${contactId}` };
  } finally { value.close(); }
}

async function createManagerEvaluation(user, payload) {
  assertPermission(user, 'manage_evaluations');
  if (user.role === 'sales') { const error = new Error('只有销售经理或管理员可以提交经理评价'); error.statusCode = 403; throw error; }
  const value = db();
  let evaluationId = '';
  let evaluationInput = null;
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const subjectType = payload.subjectType === 'contact' ? 'contact' : 'company';
    const text = String(payload.evaluationText || '').trim();
    if (text.length < 8) throw new Error('评价内容至少8个字');
    evaluationId = id('EV');
    const subjectName = subjectType === 'company' ? account.company_name : String(payload.subjectName || '').trim();
    const subjectTitle = subjectType === 'company' ? '' : String(payload.subjectTitle || '').trim();
    if (subjectType === 'contact' && !subjectName) throw new Error('请选择评价联系人');
    const now = nowText();
    value.prepare(`INSERT INTO crm_manager_evaluations
      (id,customer_id,subject_type,subject_id,subject_name,subject_title,evaluation_text,author_id,author_name,ai_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(
      evaluationId, account.id, subjectType, String(payload.subjectId || ''), subjectName, subjectTitle,
      text, user.id, user.name, now, now,
    );
    evaluationInput = { subjectType, subjectName, subjectTitle, evaluation: text };
  } finally { value.close(); }
  try {
    const analysis = await analyzeManagerEvaluation(evaluationInput);
    const writeDb = db();
    try {
      writeDb.prepare(`UPDATE crm_manager_evaluations SET ai_status='completed',ai_summary=?,ai_labels_json=?,
        ai_order_keys_json=?,ai_risks_json=?,ai_strategy=?,ai_model=?,ai_error='',ai_generated_at=?,updated_at=? WHERE id=?`).run(
        analysis.summary, JSON.stringify(analysis.labels), JSON.stringify(analysis.orderKeys), JSON.stringify(analysis.risks),
        analysis.strategy, analysis.model, nowText(), nowText(), evaluationId,
      );
      return { evaluation: normalizeEvaluation(writeDb.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId)) };
    } finally { writeDb.close(); }
  } catch (error) {
    const writeDb = db();
    try {
      writeDb.prepare("UPDATE crm_manager_evaluations SET ai_status='failed',ai_error=?,updated_at=? WHERE id=?")
        .run(String(error.message || error).slice(0, 500), nowText(), evaluationId);
      return { evaluation: normalizeEvaluation(writeDb.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId)), aiWarning: error.message };
    } finally { writeDb.close(); }
  }
}

async function retryManagerEvaluation(user, evaluationId) {
  assertPermission(user, 'manage_evaluations');
  if (user.role === 'sales') { const error = new Error('只有管理层可以重新生成AI标注'); error.statusCode = 403; throw error; }
  const value = db();
  let row;
  try {
    row = value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(evaluationId);
    if (!row) throw new Error('评价不存在');
    getAccountForUser(value, user, row.customer_id);
    value.prepare("UPDATE crm_manager_evaluations SET ai_status='pending',ai_error='',updated_at=? WHERE id=?").run(nowText(), row.id);
  } finally { value.close(); }
  return createAiResultForExisting(row);
}

async function createAiResultForExisting(row) {
  try {
    const analysis = await analyzeManagerEvaluation({
      subjectType: row.subject_type, subjectName: row.subject_name, subjectTitle: row.subject_title, evaluation: row.evaluation_text,
    });
    const value = db();
    try {
      value.prepare(`UPDATE crm_manager_evaluations SET ai_status='completed',ai_summary=?,ai_labels_json=?,
        ai_order_keys_json=?,ai_risks_json=?,ai_strategy=?,ai_model=?,ai_error='',ai_generated_at=?,updated_at=? WHERE id=?`).run(
        analysis.summary, JSON.stringify(analysis.labels), JSON.stringify(analysis.orderKeys), JSON.stringify(analysis.risks),
        analysis.strategy, analysis.model, nowText(), nowText(), row.id,
      );
      return { evaluation: normalizeEvaluation(value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(row.id)) };
    } finally { value.close(); }
  } catch (error) {
    const value = db();
    try {
      value.prepare("UPDATE crm_manager_evaluations SET ai_status='failed',ai_error=?,updated_at=? WHERE id=?")
        .run(String(error.message || error).slice(0, 500), nowText(), row.id);
      return { evaluation: normalizeEvaluation(value.prepare('SELECT * FROM crm_manager_evaluations WHERE id=?').get(row.id)), aiWarning: error.message };
    } finally { value.close(); }
  }
}

function eligibleIntakeCandidates(value, settings) {
  const groups = settings.matchGroups.length ? settings.matchGroups : ['A', 'B'];
  const countries = settings.countries.map(normalizeCountry);
  const rows = value.prepare(`SELECT
      c.customer_id,p.full_name,p.full_name_local,p.title,
      COALESCE(NULLIF(p.contact_level,''),NULLIF(c.best_contact_level,''),'L0') contact_level,
      COALESCE(p.procurement_relevance,'P0') procurement_relevance,p.updated_at person_updated_at,
      c.company_name,c.country,c.website,c.industry,c.customer_type,c.products,
      s.business_summary,s.company_type,s.likely_component_needs_json,s.match_score,s.match_group,s.risk_level,s.source_urls_json evidence_urls,
      (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=p.person_id) contact_methods,
      (SELECT rr.job_id FROM recon_results rr WHERE rr.customer_id=c.customer_id ORDER BY rr.updated_at DESC LIMIT 1) recon_job_id
    FROM customer_pool c
    LEFT JOIN company_screening s ON s.customer_id=c.customer_id
    LEFT JOIN person_candidates p ON p.person_id=(
      SELECT p2.person_id FROM person_candidates p2 WHERE p2.customer_id=c.customer_id
      ORDER BY CASE p2.contact_level WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,
        p2.sales_ready DESC,p2.updated_at DESC LIMIT 1
    )
    WHERE NOT EXISTS (SELECT 1 FROM crm_intake_items i WHERE i.external_customer_id=c.customer_id)
      AND NOT EXISTS (SELECT 1 FROM crm_accounts a WHERE a.external_customer_id=c.customer_id)
    ORDER BY CASE COALESCE(p.contact_level,c.best_contact_level,'L0') WHEN 'L3' THEN 0 WHEN 'L2' THEN 1 WHEN 'L1' THEN 2 ELSE 3 END,
      COALESCE(s.match_score,0) DESC,p.updated_at DESC`).all();
  const seen = new Set();
  return rows.filter(row => {
    if (seen.has(row.customer_id)) return false;
    seen.add(row.customer_id);
    if (!groups.includes(row.match_group || '')) return false;
    if (countries.length && !countries.includes(normalizeCountry(row.country))) return false;
    return true;
  });
}

function assignIntakeItem(value, item, ownerId, settings, reason = '') {
  if (!['pending', 'approved', 'returned'].includes(item.status)) return { assigned: false, reason: '状态不可分配' };
  const owner = value.prepare("SELECT * FROM sales_users WHERE id=? AND role='sales' AND active=1").get(ownerId);
  if (!owner) return { assigned: false, reason: '销售负责人无效' };
  const existing = value.prepare('SELECT id FROM crm_accounts WHERE external_customer_id=?').get(item.external_customer_id);
  if (existing) {
    value.prepare("UPDATE crm_intake_items SET status='duplicate',crm_customer_id=?,decision_reason='客户已在CRM',updated_at=? WHERE id=?")
      .run(existing.id, nowText(), item.id);
    return { assigned: false, reason: '客户已在CRM' };
  }
  const assignedAt = nowText();
  const claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
  value.prepare(`UPDATE crm_intake_items SET status='assigned',crm_customer_id='',assigned_owner_id=?,
    decision_reason=?,assigned_at=?,claim_due_at=?,updated_at=? WHERE id=?`)
    .run(ownerId, reason, assignedAt, claimDue, assignedAt, item.id);
  return { assigned: true, accountId: '', ownerId };
}

function createClaimedAccount(value, item, claimedAt, contactDue) {
  const existing = value.prepare('SELECT id FROM crm_accounts WHERE external_customer_id=?').get(item.external_customer_id);
  if (existing) return existing.id;
  const accountId = id('CRM');
  value.prepare(`INSERT INTO crm_accounts
    (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at,intake_item_id,assignment_status,assigned_at,claim_due_at,claimed_at,return_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    accountId, item.external_customer_id, item.company_name, normalizeCountry(item.country), '', item.website, item.industry,
    item.customer_type, '每日未开发线索分配', item.product_focus, Number(item.match_score || 0) >= 90 ? 'A' : 'B',
    0, 'qualified', item.assigned_owner_id, 'USR-MGR', 0, '', '', '完成首次触达',
    contactDue, '', claimedAt, claimedAt, item.id, 'claimed', item.assigned_at || claimedAt, item.claim_due_at || '', claimedAt, '',
  );
  return accountId;
}

function scanDailyIntake(actor = { id: 'system', role: 'admin' }, options = {}) {
  if (actor.id !== 'system') assertPermission(actor, 'manage_intake');
  const value = db();
  try {
    const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
    const settings = {
      enabled: Boolean(settingsRow.enabled), approvalMode: settingsRow.approval_mode,
      dailyPerSales: settingsRow.daily_per_sales, claimSlaHours: settingsRow.claim_sla_hours,
      matchGroups: json(settingsRow.match_groups_json), countries: json(settingsRow.countries_json),
    };
    if (!settings.enabled && !options.force) throw new Error('每日自动入库已停用');
    const candidates = eligibleIntakeCandidates(value, settings);
    const batchId = id('BATCH'), batchDate = nowText().slice(0, 10), createdAt = nowText();
    value.prepare(`INSERT INTO crm_intake_batches
      (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,created_by,created_at,finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(batchId, batchDate, 'screened-customer-pool', 'running', candidates.length, 0, 0, 0, actor.id || 'system', createdAt, '');
    const users = value.prepare('SELECT * FROM sales_users WHERE role=\'sales\' AND active=1 ORDER BY name').all();
    const load = activeWorkloadByOwner(value);
    const dailyRows = value.prepare(`SELECT assigned_owner_id,COUNT(*) n FROM crm_intake_items WHERE assigned_at>=? GROUP BY assigned_owner_id`).all(`${batchDate} 00:00:00`);
    const daily = Object.fromEntries(dailyRows.map(row => [row.assigned_owner_id, row.n]));
    const insert = value.prepare(`INSERT INTO crm_intake_items
      (id,batch_id,external_customer_id,crm_customer_id,company_name,country,website,industry,customer_type,product_focus,match_score,match_group,contact_name,contact_title,contact_methods,contact_level,evidence_urls,report_url,status,suggested_owner_id,assigned_owner_id,decision_reason,return_reason,assigned_at,claim_due_at,claimed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let imported = 0, assigned = 0, skipped = 0;
    const transaction = value.transaction(() => {
      if (settings.approvalMode === 'automatic') {
        const backlog = value.prepare("SELECT * FROM crm_intake_items WHERE status='approved' AND assigned_owner_id='' ORDER BY match_score DESC,created_at LIMIT 500").all();
        for (const item of backlog) {
          const match = chooseIntakeOwner(item, users, load, daily, Number(settings.dailyPerSales || 5));
          if (!match) break;
          value.prepare('UPDATE crm_intake_items SET suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?')
            .run(match.userId, match.reason, nowText(), item.id);
          const result = assignIntakeItem(value, { ...item, suggested_owner_id: match.userId, decision_reason: match.reason }, match.userId, settings, match.reason);
          if (result.assigned) {
            assigned += 1;
            load[match.userId] = Number(load[match.userId] || 0) + 1;
            daily[match.userId] = Number(daily[match.userId] || 0) + 1;
          }
        }
      }
      for (const candidate of candidates) {
        const match = chooseIntakeOwner(candidate, users, load, daily, Number(settings.dailyPerSales || 5));
        const riskBlocked = String(candidate.risk_level || '').toLowerCase().includes('blocked');
        const itemId = id('IN');
        const reportUrl = candidate.recon_job_id ? `/api/report?job_id=${encodeURIComponent(candidate.recon_job_id)}` : '';
        try {
          insert.run(
            itemId, batchId, candidate.customer_id, '', candidate.company_name, normalizeCountry(candidate.country), candidate.website || '',
            candidate.industry || candidate.business_summary || '', candidate.customer_type || candidate.company_type || '',
            candidate.likely_component_needs_json || candidate.products || '', Number(candidate.match_score || 0), candidate.match_group || '',
            candidate.full_name_local || candidate.full_name || '', candidate.title || '', candidate.contact_methods || '', candidate.contact_level || 'L0',
            candidate.evidence_urls || '', reportUrl, settings.approvalMode === 'automatic' && !riskBlocked ? 'approved' : 'pending',
            match?.userId || '', '', riskBlocked ? '风险拦截：需管理员审核后分配' : (match?.reason || '暂无可用销售配额'),
            '', '', '', '', createdAt, createdAt,
          );
          imported += 1;
          if (settings.approvalMode === 'automatic' && match && !riskBlocked) {
            const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(itemId);
            const result = assignIntakeItem(value, item, match.userId, settings, match.reason);
            if (result.assigned) {
              assigned += 1;
              load[match.userId] = Number(load[match.userId] || 0) + 1;
              daily[match.userId] = Number(daily[match.userId] || 0) + 1;
            } else skipped += 1;
          }
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) skipped += 1;
          else throw error;
        }
      }
      value.prepare(`UPDATE crm_intake_batches SET status='done',imported_count=?,assigned_count=?,skipped_count=?,finished_at=? WHERE id=?`)
        .run(imported, assigned, skipped, nowText(), batchId);
    });
    transaction();
    return { batchId, candidates: candidates.length, imported, assigned, skipped };
  } finally { value.close(); }
}

function manageIntake(user, payload) {
  if (!['claim', 'return', 'reject'].includes(String(payload.action || ''))) assertPermission(user, 'manage_intake');
  const action = String(payload.action || '');
  const value = db();
  try {
    if (action === 'bulk_assign') {
      if (user.role === 'sales') { const error = new Error('只有管理层可以批量分配'); error.statusCode = 403; throw error; }
      const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
      const settings = { dailyPerSales: settingsRow.daily_per_sales, claimSlaHours: settingsRow.claim_sla_hours, contactSlaHours: settingsRow.contact_sla_hours };
      const users = value.prepare("SELECT * FROM sales_users WHERE role='sales' AND active=1 ORDER BY name").all();
      const batchDate = nowText().slice(0, 10);
      const load = activeWorkloadByOwner(value);
      const daily = Object.fromEntries(value.prepare('SELECT assigned_owner_id,COUNT(*) n FROM crm_intake_items WHERE assigned_at>=? GROUP BY assigned_owner_id').all(`${batchDate} 00:00:00`).map(row => [row.assigned_owner_id, row.n]));
      const requested = Array.isArray(payload.itemIds) ? payload.itemIds.filter(Boolean) : [];
      const limit = Math.max(1, Math.min(500, Number(payload.limit || users.length * settings.dailyPerSales)));
      const items = requested.length
        ? value.prepare(`SELECT * FROM crm_intake_items WHERE id IN (${requested.map(() => '?').join(',')}) AND status IN ('pending','approved','returned') ORDER BY match_score DESC`).all(...requested)
        : value.prepare("SELECT * FROM crm_intake_items WHERE status IN ('pending','approved','returned') ORDER BY match_score DESC,created_at LIMIT ?").all(limit);
      let assignedCount = 0;
      const transaction = value.transaction(() => {
        for (const candidate of items) {
          const match = chooseIntakeOwner(candidate, users, load, daily, settings.dailyPerSales);
          if (!match) break;
          value.prepare("UPDATE crm_intake_items SET status='approved',suggested_owner_id=?,decision_reason=?,updated_at=? WHERE id=?")
            .run(match.userId, match.reason, nowText(), candidate.id);
          const result = assignIntakeItem(value, { ...candidate, status: 'approved' }, match.userId, settings, match.reason);
          if (result.assigned) {
            assignedCount += 1;
            load[match.userId] = Number(load[match.userId] || 0) + 1;
            daily[match.userId] = Number(daily[match.userId] || 0) + 1;
          }
        }
      });
      transaction();
      return { action, assigned: assignedCount, considered: items.length };
    }
    const item = value.prepare('SELECT * FROM crm_intake_items WHERE id=?').get(String(payload.itemId || ''));
    if (!item) throw new Error('入库任务不存在');
    if (user.role === 'sales' && item.assigned_owner_id !== user.id) {
      const error = new Error('无权处理该入库任务'); error.statusCode = 403; throw error;
    }
    if (action === 'claim') {
      if (item.status !== 'assigned') throw new Error('该客户当前不可领取');
      const claimedAt = nowText();
      const settings = value.prepare("SELECT contact_sla_hours FROM crm_intake_settings WHERE id='default'").get();
      const contactDue = nowText(new Date(Date.now() + Number(settings.contact_sla_hours || 48) * 3600000));
      let accountId = '';
      value.transaction(() => {
        accountId = item.crm_customer_id || createClaimedAccount(value, item, claimedAt, contactDue);
        value.prepare("UPDATE crm_intake_items SET status='claimed',crm_customer_id=?,claimed_at=?,updated_at=? WHERE id=?")
          .run(accountId, claimedAt, claimedAt, item.id);
        value.prepare("UPDATE crm_accounts SET assignment_status='claimed',claimed_at=?,next_action='完成首次触达',next_action_at=?,updated_at=? WHERE id=?")
          .run(claimedAt, contactDue, claimedAt, accountId);
      })();
      return { action, itemId: item.id, customerId: accountId };
    }
    if (action === 'return') {
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('退回客户必须填写原因');
      value.prepare("UPDATE crm_intake_items SET status='returned',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.id);
      value.prepare("UPDATE crm_accounts SET assignment_status='returned',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.crm_customer_id);
      return { action, itemId: item.id };
    }
    if (action === 'reject') {
      const reason = String(payload.reason || '').trim();
      if (!reason) throw new Error('标记不对口必须填写原因');
      value.prepare("UPDATE crm_intake_items SET status='rejected',return_reason=?,updated_at=? WHERE id=?").run(reason, nowText(), item.id);
      value.prepare("UPDATE crm_accounts SET assignment_status='returned',stage='lost',loss_reason=?,return_reason=?,updated_at=? WHERE id=?").run(reason, reason, nowText(), item.crm_customer_id);
      return { action, itemId: item.id };
    }
    if (['assign', 'reassign'].includes(action)) {
      if (user.role === 'sales') { const error = new Error('只有管理层可以分配客户'); error.statusCode = 403; throw error; }
      const ownerId = String(payload.ownerId || item.suggested_owner_id || '');
      const settingsRow = value.prepare("SELECT * FROM crm_intake_settings WHERE id='default'").get();
      const settings = { claimSlaHours: settingsRow.claim_sla_hours, contactSlaHours: settingsRow.contact_sla_hours };
      if (item.crm_customer_id) {
        const assignedAt = nowText(), claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
        value.prepare(`UPDATE crm_accounts SET owner_id=?,assignment_status='assigned',assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',stage=CASE WHEN stage='lost' THEN 'qualified' ELSE stage END,loss_reason='',updated_at=? WHERE id=?`)
          .run(ownerId, assignedAt, claimDue, assignedAt, item.crm_customer_id);
        value.prepare(`UPDATE crm_intake_items SET status='assigned',assigned_owner_id=?,assigned_at=?,claim_due_at=?,claimed_at='',return_reason='',updated_at=? WHERE id=?`)
          .run(ownerId, assignedAt, claimDue, assignedAt, item.id);
        return { action, itemId: item.id, ownerId };
      }
      if (item.status === 'assigned') {
        const assignedAt = nowText(), claimDue = nowText(new Date(Date.now() + Number(settings.claimSlaHours || 24) * 3600000));
        value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,suggested_owner_id=?,assigned_at=?,
          claim_due_at=?,claimed_at='',return_reason='',decision_reason=?,updated_at=? WHERE id=?`)
          .run(ownerId, ownerId, assignedAt, claimDue, String(payload.reason || item.decision_reason || '管理者重新分配'), assignedAt, item.id);
        return { action, itemId: item.id, ownerId };
      }
      const result = assignIntakeItem(value, item, ownerId, settings, String(payload.reason || item.decision_reason || '管理者分配'));
      if (!result.assigned) throw new Error(result.reason);
      return { action, itemId: item.id, ownerId };
    }
    throw new Error('未知入库操作');
  } finally { value.close(); }
}

function updateIntakeSettings(user, payload) {
  assertPermission(user, 'manage_intake');
  if (user.role === 'sales') { const error = new Error('只有管理层可以修改入库规则'); error.statusCode = 403; throw error; }
  const mode = payload.approvalMode === 'manual' ? 'manual' : 'automatic';
  const value = db();
  try {
    value.prepare(`UPDATE crm_intake_settings SET enabled=?,approval_mode=?,daily_per_sales=?,claim_sla_hours=?,
      contact_sla_hours=?,match_groups_json=?,countries_json=?,updated_by=?,updated_at=? WHERE id='default'`).run(
      payload.enabled === false ? 0 : 1, mode, Math.max(1, Math.min(50, Number(payload.dailyPerSales || 5))),
      Math.max(1, Math.min(72, Number(payload.claimSlaHours || 12))), Math.max(1, Math.min(168, Number(payload.contactSlaHours || 24))),
      JSON.stringify(payload.matchGroups || ['A', 'B']), JSON.stringify(payload.countries || []), user.id, nowText(),
    );
    return { updated: true };
  } finally { value.close(); }
}

function normalizeListQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.max(20, Math.min(200, Number.parseInt(query.pageSize || query.page_size, 10) || 100));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search: String(query.search || '').trim().slice(0, 120),
  };
}

function researchOwnerCondition(user, alias, params) {
  if (user.role !== 'sales') return '';
  params.push(user.id);
  return `EXISTS(SELECT 1 FROM crm_accounts scoped_account
    WHERE scoped_account.external_customer_id=${alias}.customer_id
      AND scoped_account.owner_id=?
      AND COALESCE(scoped_account.assignment_status,'claimed')!='returned')`;
}

function researchTotals(value, user, permissions) {
  const count = (from, alias, permission, extra = '') => {
    if (!permission) return 0;
    const params = [];
    const ownerCondition = researchOwnerCondition(user, alias, params);
    const where = [ownerCondition, extra].filter(Boolean).join(' AND ');
    return Number(value.prepare(`SELECT COUNT(*) total FROM ${from} ${alias}${where ? ` WHERE ${where}` : ''}`).get(...params).total || 0);
  };
  const canSeePool = permissions.view_development || permissions.view_pool;
  const canSeePeople = permissions.view_development || permissions.view_contacts;
  const canSeeRecon = permissions.view_development || permissions.view_recon;
  return {
    pool: count('customer_pool', 'p', canSeePool),
    poolAvailable: count('customer_pool', 'p', canSeePool, 'NOT EXISTS(SELECT 1 FROM crm_accounts linked_account WHERE linked_account.external_customer_id=p.customer_id)'),
    people: count('person_candidates', 'pc', canSeePeople),
    recon: count('recon_results', 'r', canSeeRecon),
  };
}

function loadResearchPage(user, kind, query = {}) {
  const permissions = permissionsFor(user);
  const requiredPermission = {
    pool: permissions.view_development || permissions.view_pool,
    people: permissions.view_development || permissions.view_contacts,
    recon: permissions.view_development || permissions.view_recon,
  }[kind];
  if (!requiredPermission) {
    const error = new Error('当前账号没有该数据模块权限');
    error.statusCode = 403;
    throw error;
  }

  const value = db();
  try {
    const { page, pageSize, offset, search } = normalizeListQuery(query);
    const params = [];
    const conditions = [];
    const addLike = columns => {
      if (!search) return;
      const like = `%${search}%`;
      conditions.push(`(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`);
      columns.forEach(() => params.push(like));
    };

    let from;
    let select;
    let orderBy;
    let alias;
    if (kind === 'pool') {
      alias = 'p';
      from = 'customer_pool p';
      select = `p.*,
        EXISTS(SELECT 1 FROM crm_accounts a WHERE a.external_customer_id=p.customer_id) in_crm,
        (SELECT a.id FROM crm_accounts a WHERE a.external_customer_id=p.customer_id LIMIT 1) crm_account_id,
        (SELECT u.name FROM crm_accounts a LEFT JOIN sales_users u ON u.id=a.owner_id WHERE a.external_customer_id=p.customer_id LIMIT 1) owner_name,
        (SELECT i.status FROM crm_intake_items i WHERE i.external_customer_id=p.customer_id LIMIT 1) intake_status,
        (SELECT u.name FROM crm_intake_items i LEFT JOIN sales_users u ON u.id=i.assigned_owner_id
          WHERE i.external_customer_id=p.customer_id LIMIT 1) lead_owner_name,
        (SELECT s.risk_level FROM company_screening s WHERE s.customer_id=p.customer_id LIMIT 1) screening_risk_level`;
      orderBy = 'p.last_found DESC,p.customer_id DESC';
      addLike(['p.customer_id','p.company_name','p.country','p.city','p.website','p.industry','p.customer_type','p.products']);
      if (query.group) { conditions.push("COALESCE(NULLIF(p.current_pool,''),'未分池')=?"); params.push(String(query.group)); }
      if (query.crm === 'crm') conditions.push('EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
      if (query.crm === 'available') conditions.push('NOT EXISTS(SELECT 1 FROM crm_accounts linked WHERE linked.external_customer_id=p.customer_id)');
    } else if (kind === 'people') {
      alias = 'pc';
      from = 'person_candidates pc';
      select = `pc.*,
        (SELECT p.company_name FROM customer_pool p WHERE p.customer_id=pc.customer_id LIMIT 1) company_name,
        (SELECT group_concat(cm.method_type || ':' || cm.value,' / ') FROM contact_methods cm WHERE cm.person_id=pc.person_id) methods_summary`;
      orderBy = 'pc.sales_ready DESC,pc.contact_level DESC,pc.updated_at DESC';
      if (search) {
        const like = `%${search}%`;
        conditions.push(`(pc.customer_id LIKE ? OR pc.full_name LIKE ? OR pc.full_name_local LIKE ? OR pc.title LIKE ? OR pc.department LIKE ?
          OR EXISTS(SELECT 1 FROM customer_pool searched_pool WHERE searched_pool.customer_id=pc.customer_id AND searched_pool.company_name LIKE ?)
          OR EXISTS(SELECT 1 FROM contact_methods searched_method WHERE searched_method.person_id=pc.person_id AND searched_method.value LIKE ?))`);
        params.push(like, like, like, like, like, like, like);
      }
      if (query.level) { conditions.push('pc.contact_level=?'); params.push(String(query.level)); }
    } else if (kind === 'recon') {
      alias = 'r';
      from = 'recon_results r';
      select = 'r.*';
      orderBy = 'r.updated_at DESC';
      addLike(['r.customer_id','r.company_name','r.industry','r.customer_type','r.opportunity_summary','r.contacts_summary']);
    } else {
      const error = new Error('未知数据列表');
      error.statusCode = 404;
      throw error;
    }

    const ownerCondition = researchOwnerCondition(user, alias, params);
    if (ownerCondition) conditions.push(ownerCondition);
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(value.prepare(`SELECT COUNT(*) total FROM ${from}${where}`).get(...params).total || 0);
    const rows = value.prepare(`SELECT ${select} FROM ${from}${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);
    return { rows, page, pageSize, total, hasMore: offset + rows.length < total };
  } finally { value.close(); }
}

function loadPayload(user) {
  const value = db();
  try {
    const scope = accountScope(user);
    const accounts = value.prepare(`SELECT a.*,u.name owner_name,m.name manager_name,
      COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
      COALESCE(NULLIF(p.country,''),a.country) country,
      COALESCE(NULLIF(p.city,''),a.city) city,
      COALESCE(NULLIF(p.website,''),a.website) website,
      COALESCE(NULLIF(p.industry,''),a.industry) industry,
      COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
      COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
      p.description master_description,p.current_pool,p.rating,p.best_contact_level,p.contact_recon_status,
      p.deep_report,p.source_file
      FROM crm_accounts a
      LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
      LEFT JOIN sales_users u ON u.id=a.owner_id LEFT JOIN sales_users m ON m.id=a.manager_id ${scope.sql}
      ORDER BY CASE a.priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,a.updated_at DESC`).all(...scope.params);
    const customerIds = accounts.map(row => row.id);
    const placeholders = customerIds.length ? customerIds.map(() => '?').join(',') : "''";
    const activities = value.prepare(`SELECT x.*,u.name user_name FROM crm_activities x LEFT JOIN sales_users u ON u.id=x.user_id
      WHERE x.customer_id IN (${placeholders}) ORDER BY x.occurred_at DESC`).all(...customerIds);
    const rfqs = value.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY received_at DESC`).all(...customerIds);
    const quotes = value.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY sent_at DESC`).all(...customerIds);
    const orders = value.prepare(`SELECT * FROM crm_orders WHERE customer_id IN (${placeholders}) ORDER BY ordered_at DESC`).all(...customerIds);
    const allUsers = value.prepare('SELECT * FROM sales_users ORDER BY role,name').all();
    const alerts = [...buildIntakeAlerts(value, user), ...buildAlerts(accounts, activities, rfqs, quotes)];
    const countryReport = buildCountryReport(accounts, activities, orders);
    const cohortReport = buildCohortReport(accounts, activities, orders);
    const teamReport = buildTeamReport(allUsers, accounts, activities, rfqs, quotes, orders);
    const insights = loadInsights(value, accounts);
    const auditLog = user.role === 'admin'
      ? value.prepare('SELECT l.*,u.name user_name FROM crm_audit_log l LEFT JOIN sales_users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200').all()
      : [];
    const migrationReview = user.role === 'admin'
      ? value.prepare("SELECT * FROM crm_migration_review WHERE resolved_at='' ORDER BY created_at,source_id LIMIT 200").all()
      : [];
    const notifications = value.prepare(`SELECT * FROM crm_notifications
      WHERE user_id=? OR (?!='sales' AND user_id!='')
      ORDER BY CASE status WHEN 'unread' THEN 0 ELSE 1 END,created_at DESC LIMIT 100`).all(user.id, user.role);
    const atLeast = stage => accounts.filter(row => row.stage !== 'lost' && STAGE_INDEX[row.stage] >= STAGE_INDEX[stage]).length;
    const funnel = STAGES.filter(([key]) => !['new', 'lost'].includes(key)).map(([key, label]) => ({ key, label, count: atLeast(key) }));
    const wonAccounts = atLeast('won');
    const summary = {
      accounts: accounts.length,
      active: accounts.filter(row => !['won', 'repeat', 'lost'].includes(row.stage)).length,
      contacted: atLeast('contacted'),
      replies: atLeast('replied'),
      meetings: atLeast('meeting'),
      rfqs: rfqs.length,
      quotes: quotes.length,
      orders: orders.length,
      overdue: alerts.filter(row => row.code === 'OVERDUE').length,
      managerNeeded: alerts.filter(row => row.code === 'MANAGER_NEEDED').length,
      revenue: orders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(orders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
      orderRate: rate(wonAccounts, Math.max(1, rfqs.length)),
    };
    const permissions = permissionsFor(user);
    const canSeeAccounts = ['view_dashboard','view_customers','view_development','view_pipeline','view_alerts','view_insights','view_team','view_markets']
      .some(key => permissions[key]);
    return {
      user: safeUser(user),
      users: permissions.view_users || permissions.view_all_customers ? allUsers.map(safeUser) : [safeUser(user)],
      accounts: canSeeAccounts ? accounts : [],
      activities: canSeeAccounts ? activities : [],
      rfqs: canSeeAccounts ? rfqs : [],
      quotes: canSeeAccounts ? quotes : [],
      orders: canSeeAccounts ? orders : [],
      alerts: permissions.view_alerts || permissions.view_dashboard ? alerts : [],
      countryReport: permissions.view_markets || permissions.view_dashboard ? countryReport : [],
      cohortReport: permissions.view_markets ? cohortReport : [],
      teamReport: permissions.view_team ? teamReport : [],
      funnel: canSeeAccounts ? funnel : [],
      summary: canSeeAccounts ? summary : {},
      intake: permissions.view_intake || permissions.view_development ? loadIntakeState(value, user) : { settings: {}, stats: {}, items: [], batches: [] },
      insights: permissions.view_insights ? insights : { contacts: [], evaluations: [] },
      customerPool: [],
      people: [],
      reconResults: [],
      researchTotals: researchTotals(value, user, permissions),
      auditLog: permissions.view_users ? auditLog : [],
      migrationReview: permissions.view_users ? migrationReview : [],
      notifications,
      permissionDefinitions: PERMISSION_DEFINITIONS,
      rolePermissions: ROLE_PERMISSIONS,
      stages: STAGES.map(([key, label]) => ({ key, label })),
      generatedAt: nowText(),
    };
  } finally { value.close(); }
}

function getAccountForUser(value, user, customerId) {
  const account = value.prepare('SELECT * FROM crm_accounts WHERE id=?').get(customerId);
  if (!account) throw new Error('客户不存在');
  if (!canAccess(user, account)) {
    const error = new Error('无权访问该客户');
    error.statusCode = 403;
    throw error;
  }
  return account;
}

function advanceStage(current, proposed) {
  if (!proposed) return current;
  if (proposed === 'lost') return proposed;
  if (current === 'lost') return proposed;
  return (STAGE_INDEX[proposed] ?? -1) > (STAGE_INDEX[current] ?? -1) ? proposed : current;
}

function addActivity(user, payload) {
  assertPermission(user, 'record_activity');
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const activityType = String(payload.activityType || '').trim();
    if (!activityType) throw new Error('请选择本次动作');
    const occurredAt = String(payload.occurredAt || nowText());
    const proposed = String(payload.stageAfter || ACTIVITY_STAGE[activityType] || '');
    const nextStage = advanceStage(account.stage, proposed);
    const activityId = id('ACT');
    const managerRequired = Boolean(payload.managerRequired);
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        activityId, account.id, user.id, activityType, String(payload.channel || ''), String(payload.outcome || ''),
        String(payload.summary || ''), String(payload.nextAction || ''), String(payload.nextActionAt || ''),
        nextStage, managerRequired ? 1 : 0, occurredAt, nowText(),
      );
      value.prepare(`UPDATE crm_accounts SET stage=?,last_activity_at=?,next_action=?,next_action_at=?,
        manager_required=CASE WHEN ?=1 THEN 1 ELSE manager_required END,
        manager_status=CASE WHEN ?=1 THEN '待介入' ELSE manager_status END,updated_at=? WHERE id=?`)
        .run(nextStage, occurredAt, String(payload.nextAction || ''), String(payload.nextActionAt || ''), managerRequired ? 1 : 0, managerRequired ? 1 : 0, nowText(), account.id);
      if (activityType === 'rfq') {
        value.prepare(`INSERT INTO crm_rfqs
          (id,customer_id,user_id,reference,status,bom_lines,expected_value,product_category,completeness,received_at,quoted_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id('RFQ'), account.id, user.id, String(payload.reference || ''), 'open', Number(payload.bomLines || 0),
          Number(payload.expectedValue || 0), String(payload.productCategory || ''), Number(payload.completeness || 0),
          occurredAt, '', nowText(),
        );
      }
      if (activityType === 'manager_join') {
        value.prepare(`UPDATE crm_accounts SET manager_required=0,manager_status='已介入',manager_id=?,updated_at=? WHERE id=?`)
          .run(user.role === 'sales' ? account.manager_id : user.id, nowText(), account.id);
      }
      if (activityType === 'lost') value.prepare('UPDATE crm_accounts SET loss_reason=?,next_action=\'\',next_action_at=\'\' WHERE id=?').run(String(payload.outcome || payload.summary || '未说明'), account.id);
    });
    transaction();
    return { activityId };
  } finally { value.close(); }
}

function addQuote(user, payload) {
  assertPermission(user, 'record_quote');
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const sentAt = String(payload.sentAt || nowText());
    const rfq = payload.rfqId ? value.prepare('SELECT * FROM crm_rfqs WHERE id=? AND customer_id=?').get(payload.rfqId, account.id)
      : value.prepare('SELECT * FROM crm_rfqs WHERE customer_id=? ORDER BY received_at DESC LIMIT 1').get(account.id);
    if (!rfq) throw new Error('请先记录客户询价');
    const quoteId = id('Q');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_quotes
        (id,rfq_id,customer_id,user_id,amount,currency,gross_margin,loss_leader,status,sent_at,next_follow_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        quoteId, rfq.id, account.id, user.id, Number(payload.amount || 0), String(payload.currency || 'USD'),
        Number(payload.grossMargin || 0), payload.lossLeader ? 1 : 0, 'sent', sentAt, String(payload.nextFollowAt || ''), nowText(),
      );
      value.prepare('UPDATE crm_rfqs SET status=\'quoted\',quoted_at=? WHERE id=?').run(sentAt, rfq.id);
      value.prepare(`UPDATE crm_accounts SET stage='quoted',last_activity_at=?,next_action='报价后跟进',
        next_action_at=?,updated_at=? WHERE id=?`).run(sentAt, String(payload.nextFollowAt || ''), nowText(), account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id('ACT'), account.id, user.id, 'quote', 'email', '已发送',
        `报价 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}${payload.lossLeader ? ' · 首单引流价' : ''}`,
        '报价后跟进', String(payload.nextFollowAt || ''), 'quoted', 0, sentAt, nowText(),
      );
    });
    transaction();
    return { quoteId };
  } finally { value.close(); }
}

function addOrder(user, payload) {
  assertPermission(user, 'record_order');
  const value = db();
  try {
    const account = getAccountForUser(value, user, String(payload.customerId || ''));
    const orderedAt = String(payload.orderedAt || nowText());
    const repeat = Boolean(payload.isRepeat);
    const orderId = id('ORD');
    const transaction = value.transaction(() => {
      value.prepare(`INSERT INTO crm_orders
        (id,customer_id,quote_id,user_id,amount,currency,gross_margin,is_repeat,ordered_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(orderId, account.id, String(payload.quoteId || ''), user.id, Number(payload.amount || 0), String(payload.currency || 'USD'), Number(payload.grossMargin || 0), repeat ? 1 : 0, orderedAt, nowText());
      value.prepare('UPDATE crm_accounts SET stage=?,last_activity_at=?,next_action=?,next_action_at=?,updated_at=? WHERE id=?')
        .run(repeat ? 'repeat' : 'won', orderedAt, repeat ? '维护复购关系' : '首单交付与复购培育', String(payload.nextActionAt || ''), nowText(), account.id);
      value.prepare(`INSERT INTO crm_activities
        (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,manager_required,occurred_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id('ACT'), account.id, user.id, repeat ? 'repeat_order' : 'order', 'business', repeat ? '复购' : '首单',
        `订单 ${Number(payload.amount || 0).toLocaleString()} ${String(payload.currency || 'USD')}`,
        repeat ? '维护复购关系' : '首单交付与复购培育', String(payload.nextActionAt || ''), repeat ? 'repeat' : 'won', 0, orderedAt, nowText(),
      );
    });
    transaction();
    return { orderId };
  } finally { value.close(); }
}

function addAccount(user, payload) {
  assertPermission(user, 'create_customer');
  const value = db();
  try {
    const ownerId = user.role === 'sales' ? user.id : String(payload.ownerId || '');
    if (!ownerId || !value.prepare("SELECT 1 FROM sales_users WHERE id=? AND role='sales' AND active=1").get(ownerId)) throw new Error('请选择有效的销售负责人');
    if (!String(payload.companyName || '').trim()) throw new Error('请输入公司名称');
    const customerId = id('CRM');
    const now = nowText();
    let externalId = String(payload.externalCustomerId || '').trim();
    if (externalId && !value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(externalId)) throw new Error('选择的客户主档不存在');
    if (!externalId) {
      const website = String(payload.website || '').trim();
      const duplicate = value.prepare(`SELECT customer_id,company_name FROM customer_pool
        WHERE lower(trim(company_name))=lower(trim(?)) OR (?!='' AND lower(trim(website))=lower(trim(?))) LIMIT 1`)
        .get(String(payload.companyName).trim(), website, website);
      if (duplicate) throw new Error(`客户主档已存在：${duplicate.company_name}（${duplicate.customer_id}）`);
      externalId = `CUS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      value.prepare(`INSERT INTO customer_pool
        (customer_id,company_name,country,city,website,industry,customer_type,products,current_pool,source_file,first_found,last_found)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        externalId, String(payload.companyName).trim(), String(payload.country || ''), String(payload.city || ''),
        website, String(payload.industry || ''), String(payload.customerType || ''), String(payload.productFocus || ''),
        '未分池', 'CRM手工新增', now.slice(0, 10), now.slice(0, 10),
      );
    }
    value.prepare(`INSERT INTO crm_accounts
      (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,priority,potential_value,stage,owner_id,manager_id,manager_required,manager_status,last_activity_at,next_action,next_action_at,loss_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      customerId, externalId, String(payload.companyName).trim(), String(payload.country || ''),
      String(payload.city || ''), String(payload.website || ''), String(payload.industry || ''), String(payload.customerType || ''),
      String(payload.source || ''), String(payload.productFocus || ''), String(payload.priority || 'B'), Number(payload.potentialValue || 0),
      String(payload.stage || 'qualified'), ownerId, String(payload.managerId || 'USR-MGR'), 0, '', '', String(payload.nextAction || '完成首次触达'),
      String(payload.nextActionAt || dateOffset(1)), '', now, now,
    );
    return { customerId };
  } finally { value.close(); }
}

function updateAccount(user, customerId, payload) {
  assertPermission(user, 'edit_customer');
  const value = db();
  try {
    const account = getAccountForUser(value, user, customerId);
    const fields = [];
    const params = [];
    const allowed = {
      source: 'source', priority: 'priority', potentialValue: 'potential_value',
      nextAction: 'next_action', nextActionAt: 'next_action_at', managerRequired: 'manager_required',
      managerStatus: 'manager_status', lossReason: 'loss_reason',
    };
    for (const [key, column] of Object.entries(allowed)) {
      if (payload[key] === undefined) continue;
      fields.push(`${column}=?`);
      params.push(key === 'managerRequired' ? (payload[key] ? 1 : 0) : payload[key]);
    }
    if (payload.ownerId !== undefined && user.role !== 'sales') {
      fields.push('owner_id=?');
      params.push(payload.ownerId);
    }
    if (payload.stage !== undefined && user.role !== 'sales') {
      fields.push('stage=?');
      params.push(payload.stage);
    }
    const masterAllowed = { country: 'country', city: 'city', website: 'website', industry: 'industry', customerType: 'customer_type', productFocus: 'products' };
    const masterFields = [], masterParams = [];
    for (const [key, column] of Object.entries(masterAllowed)) {
      if (payload[key] === undefined) continue;
      masterFields.push(`${column}=?`); masterParams.push(payload[key]);
    }
    if (!fields.length && !masterFields.length) return { customerId: account.id };
    const transaction = value.transaction(() => {
      if (fields.length) {
        fields.push('updated_at=?'); params.push(nowText(), account.id);
        value.prepare(`UPDATE crm_accounts SET ${fields.join(',')} WHERE id=?`).run(...params);
      }
      if (masterFields.length && account.external_customer_id) {
        masterParams.push(account.external_customer_id);
        value.prepare(`UPDATE customer_pool SET ${masterFields.join(',')} WHERE customer_id=?`).run(...masterParams);
      }
    });
    transaction();
    return { customerId: account.id };
  } finally { value.close(); }
}

function createUser(actor, payload) {
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') {
    const error = new Error('只有管理员可以新增用户');
    error.statusCode = 403;
    throw error;
  }
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!email.includes('@')) throw new Error('请输入有效邮箱');
  if (password.length < 8) throw new Error('初始密码至少8位');
  const role = ['admin', 'manager', 'sales'].includes(payload.role) ? payload.role : 'sales';
  const pw = hashPassword(password);
  const value = db();
  try {
    const userId = id('USR');
    const now = nowText();
    value.prepare(`INSERT INTO sales_users
      (id,email,name,role,password_hash,password_salt,active,must_change_password,languages_json,countries_json,channels_json,permissions_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,1,?,?,?,?,?,?)`).run(
      userId, email, String(payload.name || email), role, pw.hash, pw.salt,
      JSON.stringify(payload.languages || []), JSON.stringify(payload.countries || []), JSON.stringify(payload.channels || []),
      JSON.stringify(normalizePermissions(payload.permissions)), now, now,
    );
    return { userId };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('该邮箱已经存在');
    throw error;
  } finally { value.close(); }
}

function updateUser(actor, userId, payload) {
  assertPermission(actor, 'manage_users');
  if (actor.role !== 'admin') {
    const error = new Error('只有管理员可以管理用户');
    error.statusCode = 403;
    throw error;
  }
  const value = db();
  try {
    if (actor.id === userId && payload.permissions !== undefined) {
      const next = { ...permissionsFor(actor), ...normalizePermissions(payload.permissions) };
      if (!next.manage_users || !next.view_users) throw new Error('不能移除当前管理员自己的账号与权限管理能力');
    }
    const fields = [], params = [];
    for (const [key, column] of Object.entries({ name: 'name', role: 'role', active: 'active' })) {
      if (payload[key] === undefined) continue;
      fields.push(`${column}=?`);
      params.push(key === 'active' ? (payload[key] ? 1 : 0) : payload[key]);
    }
    for (const [key, column] of Object.entries({ languages: 'languages_json', countries: 'countries_json', channels: 'channels_json' })) {
      if (payload[key] === undefined) continue;
      fields.push(`${column}=?`);
      params.push(JSON.stringify(payload[key] || []));
    }
    if (payload.permissions !== undefined) {
      fields.push('permissions_json=?');
      params.push(JSON.stringify(normalizePermissions(payload.permissions)));
    }
    if (payload.password) {
      if (String(payload.password).length < 8) throw new Error('密码至少8位');
      const pw = hashPassword(payload.password);
      fields.push('password_hash=?', 'password_salt=?', 'must_change_password=1');
      params.push(pw.hash, pw.salt);
    }
    if (!fields.length) return { userId };
    fields.push('updated_at=?');
    params.push(nowText(), userId);
    value.prepare(`UPDATE sales_users SET ${fields.join(',')} WHERE id=?`).run(...params);
    return { userId };
  } finally { value.close(); }
}

function changePassword(user, payload) {
  const oldPassword = String(payload.oldPassword || '');
  const newPassword = String(payload.newPassword || '');
  if (newPassword.length < 8) throw new Error('新密码至少8位');
  const value = db();
  try {
    const row = value.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(user.id);
    const candidate = hashPassword(oldPassword, row.password_salt).hash;
    const a = Buffer.from(candidate, 'hex'), b = Buffer.from(row.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('当前密码不正确');
    const pw = hashPassword(newPassword);
    value.prepare('UPDATE sales_users SET password_hash=?,password_salt=?,must_change_password=0,updated_at=? WHERE id=?')
      .run(pw.hash, pw.salt, nowText(), user.id);
    value.prepare('DELETE FROM sales_sessions WHERE user_id=?').run(user.id);
    return { changed: true };
  } finally { value.close(); }
}

function logRequestTiming(name, req, res, startedAt, detail = () => ({})) {
  res.on('finish', () => {
    const bytes = Number(res.getHeader('Content-Length') || 0);
    console.info(JSON.stringify({
      event: 'crm_request_timing',
      route: name,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 10) / 10,
      responseBytes: bytes,
      ...detail(),
    }));
  });
}

function registerSalesCrm(app) {
  installSalesCrm();
  const loginAttempts = new Map();

  app.get('/sales', (_req, res) => res.redirect(302, '/'));
  app.use('/sales-assets', require('express').static(path.join(__dirname, '..', 'sales-assets')));

  app.post('/api/sales-auth/login', (req, res) => {
    const startedAt = process.hrtime.bigint();
    logRequestTiming('sales-auth/login', req, res, startedAt, () => ({ authenticated: res.statusCode < 400 }));
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const attemptKey = `${req.socket.remoteAddress || ''}:${email}`;
    const attempt = loginAttempts.get(attemptKey) || { count: 0, resetAt: 0 };
    if (attempt.resetAt > Date.now() && attempt.count >= 8) return res.status(429).json({ ok: false, error: '登录尝试过多，请15分钟后再试' });
    if (attempt.resetAt <= Date.now()) { attempt.count = 0; attempt.resetAt = Date.now() + 15 * 60000; }
    const value = db();
    try {
      const user = value.prepare('SELECT * FROM sales_users WHERE email=? AND active=1').get(email);
      if (!user) { attempt.count += 1; loginAttempts.set(attemptKey, attempt); return res.status(401).json({ ok: false, error: '邮箱或密码错误' }); }
      const candidate = hashPassword(password, user.password_salt).hash;
      const a = Buffer.from(candidate, 'hex'), b = Buffer.from(user.password_hash, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        attempt.count += 1; loginAttempts.set(attemptKey, attempt);
        return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
      }
      loginAttempts.delete(attemptKey);
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expires = nowText(new Date(Date.now() + 7 * 86400000));
      value.prepare('DELETE FROM sales_sessions WHERE expires_at<=?').run(nowText());
      value.prepare('INSERT INTO sales_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenHash, user.id, expires, nowText());
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `sales_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
      res.json({ ok: true, user: safeUser(user) });
    } finally { value.close(); }
  });

  app.post('/api/sales-auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie || '').sales_session || '';
    if (token) {
      const value = db();
      try { value.prepare('DELETE FROM sales_sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex')); } finally { value.close(); }
    }
    res.setHeader('Set-Cookie', 'sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api/sales-crm', requireSalesUser);
  app.use('/api/sales-crm', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const value = db();
      try {
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?)`).run(
          id('AUD'), req.salesUser.id, `${req.method} ${req.path}`,
          req.path.split('/').filter(Boolean)[1] || 'crm', req.params.customerId || req.params.userId || req.body?.customerId || req.body?.itemId || '',
          JSON.stringify(redactAuditPayload({ params: req.params, body: req.body || {} })), nowText(),
        );
      } finally { value.close(); }
    });
    next();
  });

  app.get('/api/sales-crm/bootstrap', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/bootstrap', req, res, startedAt, () => counts);
    try {
      const payload = loadPayload(req.salesUser);
      counts = {
        accounts: payload.accounts.length,
        activities: payload.activities.length,
        intakeItems: payload.intake?.items?.length || 0,
        customerPool: payload.customerPool.length,
        people: payload.people.length,
        reconResults: payload.reconResults.length,
      };
      res.json({ ok: true, ...payload });
    }
    catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });

  app.get('/api/sales-crm/research/:kind', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/research/${req.params.kind}`, req, res, startedAt, () => counts);
    try {
      const result = loadResearchPage(req.salesUser, req.params.kind, req.query || {});
      counts = { page: result.page, rows: result.rows.length, total: result.total };
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/sales-crm/accounts', (req, res) => {
    try { res.json({ ok: true, ...addAccount(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/accounts/:customerId', (req, res) => {
    try { res.json({ ok: true, ...updateAccount(req.salesUser, req.params.customerId, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/activities', (req, res) => {
    try { res.json({ ok: true, ...addActivity(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/quotes', (req, res) => {
    try { res.json({ ok: true, ...addQuote(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/orders', (req, res) => {
    try { res.json({ ok: true, ...addOrder(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/users', (req, res) => {
    try { res.json({ ok: true, ...createUser(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/users/:userId', (req, res) => {
    try { res.json({ ok: true, ...updateUser(req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/migration-review/:reviewId', (req, res) => {
    if (req.salesUser.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可处理迁移复核' });
    const value = db();
    try {
      const review = value.prepare("SELECT * FROM crm_migration_review WHERE id=? AND resolved_at=''").get(req.params.reviewId);
      if (!review) return res.status(404).json({ ok: false, error: '复核记录不存在或已处理' });
      const ownerId = String(req.body.ownerId || '');
      if (!value.prepare("SELECT 1 FROM sales_users WHERE id=? AND role='sales' AND active=1").get(ownerId)) return res.status(400).json({ ok: false, error: '请选择有效销售' });
      const row = JSON.parse(review.payload_json || '{}');
      if (!row.customer_id || !value.prepare('SELECT 1 FROM customer_pool WHERE customer_id=?').get(row.customer_id)) return res.status(400).json({ ok: false, error: '旧记录缺少有效客户主档' });
      const now = nowText();
      let account = value.prepare('SELECT * FROM crm_accounts WHERE external_customer_id=?').get(row.customer_id);
      const transaction = value.transaction(() => {
        if (!account) {
          const accountId = id('CRM');
          value.prepare(`INSERT INTO crm_accounts
            (id,external_customer_id,company_name,country,city,website,industry,customer_type,source,product_focus,
             priority,potential_value,stage,owner_id,next_action,next_action_at,created_at,updated_at)
            SELECT ?,customer_id,company_name,country,city,website,industry,customer_type,'旧跟进复核迁移',products,
              'B',0,'qualified',?,?,?, ?,? FROM customer_pool WHERE customer_id=?`).run(
            accountId, ownerId, row.next_action || '复核并继续跟进',
            row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '', now, now, row.customer_id,
          );
          account = { id: accountId };
        }
        value.prepare(`INSERT OR IGNORE INTO crm_activities
          (id,customer_id,user_id,activity_type,channel,outcome,summary,next_action,next_action_at,stage_after,occurred_at,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          `MIG-${row.follow_id}`, account.id, ownerId, 'note', row.channel || '', row.status || '',
          [row.feedback,row.notes,row.invalid_reason].filter(Boolean).join('；') || '旧跟进记录经管理员确认迁移',
          row.next_action || '', row.next_follow_date ? `${row.next_follow_date} 09:00:00` : '', '',
          row.last_follow_date ? `${row.last_follow_date} 12:00:00` : now, now,
        );
        value.prepare('UPDATE crm_migration_review SET resolved_at=? WHERE id=?').run(now, review.id);
      });
      transaction();
      res.json({ ok: true, customerId: account.id });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    } finally { value.close(); }
  });

  app.post('/api/sales-crm/password', (req, res) => {
    try {
      const result = changePassword(req.salesUser, req.body || {});
      res.setHeader('Set-Cookie', 'sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.json({ ok: true, ...result });
    } catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/intake/scan', (req, res) => {
    if (req.salesUser.role === 'sales') return res.status(403).json({ ok: false, error: '只有管理层可以执行入库同步' });
    try { res.json({ ok: true, ...scanDailyIntake(req.salesUser, { force: Boolean(req.body.force) }) }); }
    catch (error) { res.status(400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/intake/action', (req, res) => {
    try { res.json({ ok: true, ...manageIntake(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/intake/settings', (req, res) => {
    try { res.json({ ok: true, ...updateIntakeSettings(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/contacts', (req, res) => {
    try { res.json({ ok: true, ...createAccountContact(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/evaluations', async (req, res) => {
    try { res.json({ ok: true, ...await createManagerEvaluation(req.salesUser, req.body || {}) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.post('/api/sales-crm/evaluations/:evaluationId/retry', async (req, res) => {
    try { res.json({ ok: true, ...await retryManagerEvaluation(req.salesUser, req.params.evaluationId) }); }
    catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });
}

module.exports = {
  PERMISSION_DEFINITIONS,
  ROLE_PERMISSIONS,
  STAGES,
  STAGE_INDEX,
  ACTIVITY_STAGE,
  hashPassword,
  installSalesCrm,
  buildAlerts,
  buildCountryReport,
  buildCohortReport,
  buildTeamReport,
  chooseIntakeOwner,
  normalizeListQuery,
  scanDailyIntake,
  permissionsFor,
  hasPermission,
  safeUser,
  registerSalesCrm,
  requireUnifiedUser,
};

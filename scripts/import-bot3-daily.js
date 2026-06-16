#!/usr/bin/env node
/**
 * 从 bot3 workspace 导入每日新客户到 CRM customer_pool 表。
 * 支持多文件源合并导入（正文 + 专项任务产出）。
 * 用法:
 *   node scripts/import-bot3-daily.js [date]
 *   node scripts/import-bot3-daily.js --skip-translate --input /path/to/new-customers.translated.json [date]
 *   node scripts/import-bot3-daily.js --extra /path/to/extra1.json --extra /path/to/extra2.json [date]
 *   date: 可选，格式 YYYY-MM-DD，默认今天
 *
 * 逻辑：
 * 1. 读取主输入文件 (默认 new-customers-today.json)
 * 2. 自动探测 bot3 workspace 下的额外客户文件并合并
 * 3. 去重（按 domain 检查 customer_pool 是否已存在）
 * 4. 用 Google Translate 实时翻译俄语→中文
 * 5. 插入新客户，自动生成 customer_id (RU-XXXX)
 *
 * 自动探测的额外源文件（bot3 workspace 下）：
 *   - new-russia-storage-customers-today.json
 *   - new-brazil-customers-today.json
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { translateText } = require('../lib/translate');
const { normalizeCustomerType, normalizeIndustry } = require('../lib/taxonomy');
const { allocateCustomerId, installCustomerIdTriggers, normalizeCountryPrefix } = require('../lib/customer_ids');

const BOT3_WORKSPACE = '/Users/ylf/ai-bots/bot3/workspace';
const CRM_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(CRM_ROOT, 'data', 'crm.db');

// 每日 JSON 文件名（主输入 + 自动探测的额外源）
const TODAY_JSON = path.join(BOT3_WORKSPACE, 'new-customers-today.json');
const AUTO_EXTRA_SOURCES = [
  'new-russia-storage-customers-today.json',
  'new-brazil-customers-today.json',
];
const TRANSLATE_TIMEOUT_MS = Math.max(1000, Number(process.env.TRANSLATE_TIMEOUT_MS || 3000));
const TRANSLATE_RETRIES = Math.max(0, Math.min(Number(process.env.TRANSLATE_RETRIES || 1), 3));
const args = parseArgs(process.argv.slice(2));
const SKIP_TRANSLATE = args.skipTranslate;
const TRANSLATE_ENABLED = !SKIP_TRANSLATE && !['0', 'false', 'no'].includes(String(process.env.IMPORT_TRANSLATE || '1').toLowerCase());
const CITY_ZH = new Map([
  ['Екатеринбург', '叶卡捷琳堡'],
  ['Москва', '莫斯科'],
  ['Москва (предп.)', '莫斯科'],
  ['Нижний Новгород', '下诺夫哥罗德'],
  ['Псков', '普斯科夫'],
  ['Пермь', '彼尔姆'],
  ['Москва / Ярославская обл.', '莫斯科 / 雅罗斯拉夫尔州'],
  ['Санкт-Петербург', '圣彼得堡'],
]);
const PLACEHOLDER_VALUES = new Set([
  '', '-', '—', 'n/a', 'na', 'none', 'null', 'unknown',
  '未找到', '未获取', '未知', '未查到', '未提供', '待确认', '未验证',
  'н/д', 'н.д.', 'не указан', 'не указано', 'нет данных', 'не найдено',
  'не найден на сайте', 'не найдена на сайте', 'not found on site',
]);

function cleanValue(value) {
  const text = String(value || '').trim();
  return PLACEHOLDER_VALUES.has(text.toLowerCase()) ? '' : text;
}

function pickFirst(...values) {
  for (const value of values) {
    const clean = cleanValue(value);
    if (clean) return clean;
  }
  return '';
}

function countryName(customer) {
  const raw = pickFirst(customer.country, customer.country_zh, customer.market, customer.region);
  const domain = getDomain(customer);
  if (/\.br$/i.test(domain) || /brazil|brasil|巴西/i.test(raw)) return '巴西';
  if (/\.de$/i.test(domain) || /germany|deutschland|德国/i.test(raw)) return '德国';
  if (/\.com$/i.test(domain) && /usa|united states|美国/i.test(raw)) return '美国';
  return '俄罗斯';
}

function parseArgs(argv) {
  const parsed = {
    input: TODAY_JSON,
    date: '',
    skipTranslate: false,
    extraSources: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-translate') {
      parsed.skipTranslate = true;
      continue;
    }
    if (arg === '--input') {
      const value = argv[++i];
      if (!value) throw new Error('缺少 --input 文件路径');
      parsed.input = path.resolve(value);
      continue;
    }
    if (arg.startsWith('--input=')) {
      parsed.input = path.resolve(arg.slice('--input='.length));
      continue;
    }
    if (arg === '--extra') {
      const value = argv[++i];
      if (!value) throw new Error('缺少 --extra 文件路径');
      parsed.extraSources.push(path.resolve(value));
      continue;
    }
    if (arg.startsWith('--extra=')) {
      parsed.extraSources.push(path.resolve(arg.slice('--extra='.length)));
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    if (!parsed.date) {
      parsed.date = arg;
      continue;
    }
    throw new Error(`多余参数：${arg}`);
  }
  return parsed;
}

/**
 * 收集所有输入源文件（主文件 + 自动探测 + --extra 指定）
 * 返回 [{path, sourceTag}] 数组
 */
function collectSourceFiles(args) {
  const sources = [];
  
  // 主输入文件
  sources.push({
    path: args.input,
    sourceTag: `bot3-daily`,
  });
  
  // 自动探测 bot3 workspace 下的额外客户文件
  for (const name of AUTO_EXTRA_SOURCES) {
    const extraPath = path.join(BOT3_WORKSPACE, name);
    // 排除主输入文件本身（避免重复）
    if (extraPath === args.input) continue;
    if (fs.existsSync(extraPath)) {
      // 从文件名提取干净的 source tag，如 new-russia-storage → bot3-russia-storage
      const tagBase = name
        .replace(/^new-/, 'bot3-')
        .replace(/-customers-today\.json$/i, '')
        .replace(/-today\.json$/i, '');
      sources.push({ path: extraPath, sourceTag: tagBase });
    }
  }
  
  // --extra 手动指定的文件
  for (const extraPath of args.extraSources) {
    // 避免重复
    if (sources.some(s => s.path === extraPath)) continue;
    const basename = path.basename(extraPath, '.json');
    const tagBase = basename
      .replace(/^new-/, 'bot3-')
      .replace(/-customers-today$/i, '')
      .replace(/-today$/i, '');
    sources.push({ path: extraPath, sourceTag: tagBase });
  }
  
  return sources;
}

/**
 * 从 storage 格式的 type 字段提取标签
 * 例如 "[SSD][MEM][PC]" → "SSD, MEM, PC"
 */
function extractTypeTags(rawType) {
  if (!rawType || typeof rawType !== 'string') return '';
  const matches = rawType.match(/\[([^\]]+)\]/g);
  if (!matches || matches.length === 0) return rawType.trim();
  return matches.map(m => m.slice(1, -1)).join(', ');
}

/**
 * 合并所有来源文件 → 统一 customers 数组
 * 返回 [{customer, sourceTag}] 带来源标记
 */
function loadAllSources(sourceFiles) {
  const all = [];
  for (const { path: srcPath, sourceTag } of sourceFiles) {
    if (!fs.existsSync(srcPath)) continue;
    const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
    let customers;
    if (Array.isArray(data)) {
      customers = data;
    } else if (Array.isArray(data.customers)) {
      customers = data.customers;
    } else if (data.customers && typeof data.customers === 'object') {
      customers = Object.values(data.customers).flat();
    } else {
      customers = [];
    }
    for (const c of customers) {
      all.push({ customer: c, sourceTag });
    }
  }
  return all;
}

function getCompanyName(c) {
  return pickFirst(c.company_name, c.company, c.name, c.russian_name, c.english_name);
}

function getPhone(c) {
  return cleanValue((pickFirst(c.phone, c.contact_phone) || '').replace(/—.*$/,'').replace(/（.*$/,'').replace(/\(требуется.*$/,''));
}

function getEmail(c) {
  return cleanValue((pickFirst(c.email, c.contact_email) || '').replace(/—.*$/,'').replace(/（.*$/,'').replace(/\(требуется.*$/,''));
}

function getDomain(c) {
  // 优先 domain 字段，否则从 website 提取纯域名
  let d = cleanValue(c.domain);
  if (d) return d.toLowerCase();
  const website = String(c.website || '').trim();
  if (!website) return '';
  // https://www.example.com/path → example.com
  d = website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  return cleanValue(d);
}

function getOriginalProducts(c) {
  return pickFirst(c.products, c.product_type, c.products_zh, c.product_type_zh);
}

function getSourceProducts(c) {
  return pickFirst(c.products_zh, c.products, c.product_type_zh, c.product_type);
}

function getSourceDescription(c) {
  return pickFirst(
    c.description_zh,
    c.description,
    c.product_description_zh,
    c.product_description,
    c.productDescription,
    c.mtronics_match_zh,
    c.mtronics_match,
    c.relevance_zh,
    c.relevance,
    c.notes_zh,
    c.notes,
    c.product_type_zh,
    c.product_type,
    c.products_zh,
    c.products
  );
}

function nowText() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Google Translate 俄→中，带重试和缓存
 */
const _tCache = {};
async function t(text) {
  const key = cleanValue(text);
  if (!key) return '';
  if (CITY_ZH.has(key)) return CITY_ZH.get(key);
  if (_tCache[key]) return _tCache[key];
  if (!TRANSLATE_ENABLED) return key;
  for (let i = 0; i <= TRANSLATE_RETRIES; i++) {
    try {
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`translate timeout ${TRANSLATE_TIMEOUT_MS}ms`)), TRANSLATE_TIMEOUT_MS);
      });
      const r = await Promise.race([
        translateText(key, { from: 'ru', to: 'zh-CN', timeoutMs: TRANSLATE_TIMEOUT_MS }),
        timeout,
      ]);
      _tCache[key] = r.text;
      return r.text;
    } catch (e) {
      if (i === TRANSLATE_RETRIES) {
        console.log(`    ⚠️ 翻译失败(${i + 1}/${TRANSLATE_RETRIES + 1}): ${key} → 保留原文`);
        return key;
      }
      await new Promise(ok => setTimeout(ok, 500 * (i + 1)));
    }
  }
  return key;
}

/**
 * 批量翻译：把所有待翻译文本收集起来，逐条调用（避免并发被限流）
 * 返回 { city, products, description } 的中文翻译
 */
async function translateFields(city, products, desc) {
  const [cityZh, productsZh, descZh] = await Promise.all([
    t(city),
    t(products),
    t(desc),
  ]);
  return { cityZh, productsZh, descZh };
}

async function main() {
  const targetDate = args.date || nowText();

  // ── 收集所有输入源 ──
  const sourceFiles = collectSourceFiles(args);
  const allRows = loadAllSources(sourceFiles);

  console.log(`\n📦 Bot3 → CRM 导入 [${targetDate}]`);
  console.log('─'.repeat(50));
  
  // 打印各源文件统计
  const sourceStats = {};
  for (const { sourceTag } of allRows) {
    sourceStats[sourceTag] = (sourceStats[sourceTag] || 0) + 1;
  }
  for (const [tag, count] of Object.entries(sourceStats)) {
    console.log(`📄 ${tag}: ${count} 条`);
  }
  if (SKIP_TRANSLATE) console.log('⚡ 翻译模式: 跳过实时翻译，使用 *_zh 预翻译字段或保留原文');

  if (!allRows.length) {
    console.log('⚠️ 没有客户数据可导入');
    return;
  }

  console.log(`📋 总计 ${allRows.length} 条客户数据 (${Object.keys(sourceStats).length} 个来源)`);

  // 连接数据库
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');

  // 获取当前最大 customer_id
  const existingIds = new Set(db.prepare("SELECT customer_id FROM customer_pool").all().map(row => row.customer_id));
  const idCounters = {};
  installCustomerIdTriggers(db);

  // 检查现有的 domain 列表
  const existingDomains = new Set(
    db.prepare("SELECT domain FROM customer_pool WHERE domain != ''").all().map(r => r.domain.toLowerCase().trim())
  );

  // 准备插入语句
  const insertStmt = db.prepare(`
    INSERT INTO customer_pool (
      customer_id, domain, company_name, russian_name, english_name,
      country, city, website, industry, customer_type,
      description, products, rating, current_pool,
      phone, email, inn, risk_status, website_verification,
      contact_count, deep_report, source_file,
      first_found, last_found, search_count, verified, notes
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE customer_pool SET
      last_found = ?,
      search_count = CAST(search_count AS INTEGER) + 1,
      notes = CASE WHEN notes = '' THEN ? ELSE notes || '\n' || ? END
    WHERE domain = ?
  `);

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  // ── 去重阶段 ──
  const toInsert = [];
  for (const { customer: c, sourceTag } of allRows) {
    const domain = getDomain(c);
    if (!domain) {
      console.log(`  ⏭️ 跳过（无域名）: ${getCompanyName(c) || '未知'}`);
      skipped++;
      continue;
    }
    if (existingDomains.has(domain)) {
      const noteText = `[${targetDate}] ${sourceTag} 再次发现: ${c.category || ''}`;
      updateStmt.run(targetDate, noteText, noteText, domain);
      console.log(`  🔄 已存在，更新: ${domain} (${getCompanyName(c)})`);
      updated++;
      continue;
    }
    // 保存 sourceTag 到 customer 上方便后续使用
    c._sourceTag = sourceTag;
    toInsert.push(c);
  }

  // ── 翻译阶段 ──
  if (toInsert.length > 0) {
    if (SKIP_TRANSLATE) {
      // --skip-translate: 使用预翻译字段或保留原文
      console.log(`\n⚡ 跳过翻译，使用预翻译字段 (${toInsert.length} 条)...`);
      for (const c of toInsert) {
        const sourceProducts = getSourceProducts(c);
        const sourceDescription = getSourceDescription(c);
        c._cityZh = c.city_zh || CITY_ZH.get((c.city || '').trim()) || c.city || '';
        c._productsZh = c.products_zh || sourceProducts;
        c._descZh = c.description_zh || sourceDescription;
        console.log(`    ✅ [${c._sourceTag}] ${getCompanyName(c)} → ${c._cityZh} | ${c._productsZh}`);
      }
    } else {
      // Google Translate 翻译
      console.log(`\n🌐 开始翻译 ${toInsert.length} 条客户数据 (Google Translate)...`);
      for (const c of toInsert) {
        const sourceProducts = getSourceProducts(c);
        const sourceDescription = getSourceDescription(c);
        const { cityZh, productsZh, descZh } = await translateFields(
          c.city || '',
          sourceProducts,
          sourceDescription,
        );
        c._cityZh = cityZh;
        c._productsZh = productsZh;
        c._descZh = descZh;
        console.log(`    ✅ [${c._sourceTag}] ${getCompanyName(c)} → ${cityZh} | ${productsZh}`);
      }
    }
    console.log('');
  }

  // ── 插入阶段（事务） ──
  const insertAll = db.transaction(() => {
    for (const c of toInsert) {
      const domain = getDomain(c);
      const companyName = getCompanyName(c);
      const productsSource = getOriginalProducts(c);
      const signalText = [
        c.confidence,
        c.relevance,
        c.description,
        c.notes,
        productsSource,
      ].map(v => String(v || '').toLowerCase()).join(' ');

      // 解析联系方式
      const email = getEmail(c);
      const phone = getPhone(c);
      const hasContact = (email || phone) ? '1' : '0';

      // 提取 type 标签 (storage 格式: [SSD][MEM])，合并到 notes
      const typeTags = extractTypeTags(c.type);
      const enhancedNotes = [c.notes, typeTags ? `产品标签: ${typeTags}` : ''].filter(Boolean).join('\n');

      const taxonomyContext = [
        signalText,
        productsSource,
        c._productsZh,
        c._descZh,
        c.category,
        c.customer_type,
        c.type,
        c.industry,
        typeTags,
      ].join(' ');
      const customerType = normalizeCustomerType(pickFirst(c.customer_type, c.type), taxonomyContext);
      const industry = normalizeIndustry(pickFirst(c.industry, c.industry_zh, c.category), taxonomyContext);

      const rating = '';

      // 网站验证状态
      let websiteVerification = '未验证';
      if (c.website_status && typeof c.website_status === 'string') {
        if (c.website_status.includes('200 OK')) websiteVerification = '✅ 正常';
        else if (c.website_status.includes('403')) websiteVerification = '⚠️ 403';
        else websiteVerification = '❓ ' + c.website_status;
      }

      const country = countryName(c);
      const customerId = allocateCustomerId(existingIds, normalizeCountryPrefix(country), idCounters);

      // source_file: 用来源标记+日期
      const sourceTag = c._sourceTag || 'bot3-daily';
      const sourceFile = `${sourceTag}-${targetDate}`;

      insertStmt.run(
        customerId,
        domain,
        companyName,
        companyName,            // russian_name (保留俄语原文)
        '',                     // english_name (暂空)
        country,
        c._cityZh,              // city (Google翻译)
        `https://${domain}`,
        industry,
        customerType,
        c._descZh,              // description (Google翻译)
        c._productsZh,          // products (Google翻译)
        rating,
        '未分池',
        phone,
        email,
        '',                     // INN
        '',                     // risk_status
        websiteVerification,
        hasContact,
        '',                     // deep_report
        sourceFile,
        targetDate,            // first_found
        targetDate,            // last_found
        '1',                   // search_count
        '',                     // verified
        enhancedNotes
      );

      existingDomains.add(domain);
      console.log(`  ✅ 新增: ${customerId} | ${domain} | ${companyName} | ${rating} | 来源:${sourceTag}`);
      inserted++;
    }
  });

  insertAll();

  // 汇总
  const totalPool = db.prepare('SELECT COUNT(*) as c FROM customer_pool').get().c;
  db.close();

  console.log('─'.repeat(50));
  console.log(`📊 导入结果:`);
  console.log(`   新增: ${inserted}`);
  console.log(`   更新(已存在): ${updated}`);
  console.log(`   跳过: ${skipped}`);
  console.log(`   总客户池: ${totalPool}`);
  console.log(`✅ 完成\n`);
}

main().catch(e => {
  console.error('❌ 导入失败:', e);
  process.exit(1);
});

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');

const PLACEHOLDERS = new Set(['', '-', '—', 'n/a', 'na', 'none', 'null', 'unknown', '未找到', '未获取', '未知', '未查到', '未提供', '待确认', '未验证']);
const VALID_SANCTIONS = new Set(['CLEAR', 'PARTIAL_CLEAR', 'UNKNOWN', 'HIT']);
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function parseArgs() {
  const out = { apply: false, json: false, jobId: '', limit: 0 };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') out.apply = true;
    else if (args[i] === '--json') out.json = true;
    else if (args[i] === '--job-id') out.jobId = args[++i] || '';
    else if (args[i] === '--limit') out.limit = Number(args[++i] || 0);
  }
  return out;
}

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  let text = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value);
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? '' : text;
}

function normalizeText(value) {
  return clean(value)
    .replace(/贵公司/g, '该公司')
    .replace(/贵司/g, '该公司')
    .replace(/华强北可供应/g, '可提供')
    .replace(/华强北可提供/g, '可提供')
    .replace(/华强北/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function concise(value, max = 120) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const idx = Math.max(slice.lastIndexOf('，'), slice.lastIndexOf('；'), slice.lastIndexOf(','), slice.lastIndexOf(';'));
  return `${(idx > 24 ? slice.slice(0, idx) : slice).trim()}...`;
}

function firstClean(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function parseArtifacts(value) {
  try {
    return JSON.parse(value || '{}') || {};
  } catch {
    return {};
  }
}

function parseJsonSummary(markdown) {
  const match = String(markdown || '').match(/```(?:json|JSON)\s*([\s\S]*?)```/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRealUrl(value) {
  const text = clean(value).replace(/[.,;，。；]+$/g, '');
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return Boolean(url.hostname && !['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function hostLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function extractUrls(markdown) {
  const seen = new Set();
  const urls = [];
  for (const raw of String(markdown || '').match(URL_RE) || []) {
    const url = raw.replace(/[.,;，。；]+$/g, '');
    if (!isRealUrl(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function inferEvidenceType(url, text = '') {
  const haystack = `${url} ${text}`.toLowerCase();
  if (/opensanctions|ofac|treasury|fsd|ofsistorage|sanction|санкц/.test(haystack)) return 'sanctions';
  if (/egrul|nalog|rusprofile|zachestnyibiznes|saby|list-org|spark/.test(haystack)) return 'identity';
  if (/zakup|procurement|tender|тендер|закуп/.test(haystack)) return 'procurement';
  if (/contact|contacts|контакт|vk\.com|linkedin|telegram|hh\.ru|2gis/.test(haystack)) return 'contacts';
  if (/product|hardware|catalog|pdf|продукц|издел|server|контроллер|plc|датчик/.test(haystack)) return 'products';
  return 'report_source';
}

function locateReportMarkdown(row) {
  const artifacts = parseArtifacts(row.artifacts_json);
  const candidates = [];
  if (clean(artifacts.report_md)) candidates.push(clean(artifacts.report_md));
  if (clean(artifacts.previous_report_path)) candidates.push(clean(artifacts.previous_report_path).replace(/\.html?$/i, '.md'));
  if (clean(row.report_path) && !/^https?:\/\//i.test(row.report_path)) candidates.push(clean(row.report_path).replace(/\.html?$/i, '.md'));
  if (clean(artifacts.report_html)) candidates.push(path.join(path.dirname(clean(artifacts.report_html)), 'report.md'));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const canonicalReport = path.join(path.dirname(resolved), 'report.md');
    if (path.basename(resolved).toLowerCase() !== 'report.md' && fs.existsSync(canonicalReport)) return canonicalReport;
    if (fs.existsSync(resolved)) return resolved;
  }

  const outputDir = clean(row.output_dir);
  if (outputDir) return path.join(path.resolve(outputDir), 'report.md');
  if (clean(row.report_path) && !/^https?:\/\//i.test(row.report_path)) return path.join(path.dirname(path.resolve(row.report_path)), 'report.md');
  return path.join(ROOT, 'recon-runs', `repaired-${row.job_id}`, 'report.md');
}

function stripGeneratedSections(markdown) {
  let text = String(markdown || '').replace(/```(?:json|JSON)\s*[\s\S]*?```\s*/m, '');
  text = text.replace(/^\s*所有关键数据已收集完毕。现在编译完整报告：\s*/m, '');
  const v2 = text.indexOf('## V2 销售决策卡');
  if (v2 >= 0) {
    const next = text.indexOf('\n## ', v2 + '## V2 销售决策卡'.length);
    text = next >= 0 ? `${text.slice(0, v2)}${text.slice(next + 1)}` : text.slice(0, v2);
  }
  const summary = text.search(/\n##\s*客户数据摘要\s*/);
  if (summary >= 0) text = text.slice(0, summary);
  return text.trim();
}

function normalizeScore(value) {
  const match = clean(value).match(/\d+(\.\d+)?/);
  if (!match) return '';
  return String(Math.max(0, Math.min(100, Math.round(Number(match[0])))));
}

function normalizeSanctionStatus(row, json) {
  const raw = firstClean(json.sanction_status, row.sanction_status, row.compliance_status);
  const upper = raw.toUpperCase();
  for (const status of VALID_SANCTIONS) {
    if (upper.includes(status)) return status;
  }
  if (/true|命中|ofac|opensanctions|sdn|hit/i.test(`${row.sanctioned} ${row.sanction_source}`)) return 'HIT';
  return 'UNKNOWN';
}

function normalizeRating(score, quality) {
  const n = Number(score || 0);
  if (quality === '需复核') return n >= 50 ? '⭐⭐' : (n >= 30 ? '⭐⭐' : '⭐');
  if (n >= 70) return '⭐⭐⭐';
  if (n >= 30) return '⭐⭐';
  return '⭐';
}

function groupEvidence(rows) {
  const grouped = {};
  const seen = new Set();
  for (const row of rows) {
    const url = clean(row.source_url).replace(/[.,;，。；]+$/g, '');
    if (!isRealUrl(url)) continue;
    const field = clean(row.field_name) || inferEvidenceType(url, `${row.value} ${row.source_title}`);
    const key = `${field}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!grouped[field]) grouped[field] = [];
    grouped[field].push({
      field,
      value: concise(row.value || row.source_title || hostLabel(url), 180),
      title: concise(row.source_title || row.value || hostLabel(url), 120),
      url,
      confidence: clean(row.confidence) || 'medium',
    });
  }
  return grouped;
}

function flattenEvidence(grouped, max = 22) {
  const priority = ['identity', 'registry', 'products', 'procurement', 'contacts', 'sanctions', 'sanctioned', 'finance', 'report_source'];
  const fields = [...priority, ...Object.keys(grouped).filter(field => !priority.includes(field)).sort()];
  const out = [];
  for (const field of fields) {
    for (const item of grouped[field] || []) {
      out.push(item);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function hasEvidence(grouped, fields, patterns = []) {
  for (const field of fields) {
    if ((grouped[field] || []).length) return true;
  }
  const text = Object.values(grouped).flat().map(item => `${item.url} ${item.title} ${item.value}`).join(' ');
  return patterns.some(pattern => pattern.test(text));
}

function supportProfile(grouped) {
  return {
    identity: hasEvidence(grouped, ['identity', 'registry'], [/egrul|nalog|rusprofile|zachestnyibiznes|saby|list-org/i]),
    product: hasEvidence(grouped, ['products', 'product'], [/product|hardware|catalog|pdf|продукц|издел|server|контроллер|plc/i]),
    contact: hasEvidence(grouped, ['contacts', 'contact'], [/contact|contacts|контакт|vk\.com|linkedin|telegram|hh\.ru|2gis/i]),
    sanction: hasEvidence(grouped, ['sanctions', 'sanctioned'], [/opensanctions|ofac|treasury|fsd|ofsi|sanction/i]),
    procurement: hasEvidence(grouped, ['procurement'], [/zakup|procurement|tender|тендер|закуп/i]),
  };
}

function evidenceCell(items) {
  if (!items.length) return '待确认';
  return items.slice(0, 3).map(item => `${item.title}：${item.url}`).join('<br>');
}

function inferDo(row, json, supported) {
  const text = firstClean(json.opportunity_do, row.opportunity_do, json.description, row.description, row.industry, row.customer_type);
  if (!text) return '主营业务待确认';
  return supported.identity || supported.product ? concise(text, 80) : `${concise(text, 70)}（待补证）`;
}

function inferNeed(row, json, supported) {
  const text = firstClean(json.opportunity_need, row.opportunity_need, json.products, row.recommended_products, row.opportunity_summary);
  if (!text) return '元器件需求待确认';
  const cleaned = text
    .replace(/可提供[\s\S]*$/i, '')
    .replace(/建议[\s\S]*$/i, '')
    .replace(/[，,；;:\s]+$/g, '');
  return supported.product || supported.procurement ? concise(cleaned, 100) : `${concise(cleaned, 80)}（推断，待补证）`;
}

function inferSell(row, json, supported) {
  const text = firstClean(json.opportunity_sell, row.opportunity_sell, json.products, row.recommended_products);
  if (!text) return '可供产品待需求确认';
  const cleaned = text
    .replace(/^我们(?:能|可以)?(?:提供|供应|卖)[：:，,\s]*/i, '')
    .replace(/^可(?:以)?(?:提供|供应)[：:，,\s]*/i, '');
  return supported.product ? concise(cleaned, 100) : `${concise(cleaned, 80)}（需先确认需求）`;
}

function classifyQuality(row, json, supported, evidenceCount) {
  const missing = [];
  if (!firstClean(json.inn, row.inn)) missing.push('INN缺失');
  if (!supported.identity) missing.push('身份缺少可追溯证据');
  if (!supported.product) missing.push('产品/需求缺少可追溯证据');
  if (!supported.contact) missing.push('联系人缺少可追溯证据');
  if (normalizeSanctionStatus(row, json) === 'UNKNOWN') missing.push('制裁未完整确认');
  if (evidenceCount < 4) missing.push('证据URL少于4条');
  if (/未执行|应启未启/i.test(`${row.step5_status} ${row.step5_plus_status} ${json.step5_status} ${json.step5_plus_status}`)) missing.push('Step 5/5+不完整');
  const sanctionHit = normalizeSanctionStatus(row, json) === 'HIT';
  if (sanctionHit) missing.push('制裁命中需人工合规复核');
  if (missing.length) return { quality: '需复核', missing };
  if (evidenceCount >= 8 && supported.identity && supported.product && supported.contact && supported.sanction) return { quality: '完整', missing: [] };
  return { quality: '部分', missing: [] };
}

function buildDecision(fields, supported, sanctionStatus) {
  const score = Number(fields.score || 0);
  if (sanctionStatus === 'HIT') return `评分${score || '待确认'}分，制裁命中，建议先合规复核再试探`;
  if (!supported.product) return `评分${score || '待确认'}分，需求缺证，建议先补证`;
  if (!supported.contact) return `评分${score || '待确认'}分，入口缺证，建议先找联系人`;
  if (score >= 70) return `评分${score}分，证据较强，建议优先开发`;
  if (score >= 50) return `评分${score}分，有需求证据，建议正常开发`;
  if (score >= 30) return `评分${score}分，有入口线索，建议试探接触`;
  return `评分${score || '待确认'}分，暂不优先，先补证观察`;
}

function markdownTable(rows) {
  return rows.join('\n');
}

function buildJsonSummary(row, json, fields, quality, missing, sanctionStatus) {
  return {
    customer_id: firstClean(json.customer_id, row.customer_id),
    company_name: firstClean(json.company_name, row.company_name),
    website: firstClean(json.website, row.website),
    industry: firstClean(json.industry, row.industry),
    customer_type: firstClean(json.customer_type, row.customer_type, '待确认'),
    city: firstClean(json.city, row.city),
    employees: firstClean(json.employees, row.employees),
    phone: firstClean(json.phone, row.phone),
    email: firstClean(json.email, row.email),
    inn: firstClean(json.inn, row.inn),
    rating: fields.rating,
    score: fields.score,
    products: fields.opportunity_sell,
    description: concise(firstClean(json.description, row.description, fields.opportunity_do), 90),
    opportunity_summary: concise(`${fields.opportunity_do}；${fields.opportunity_need}；${fields.opportunity_decision}`, 180),
    sanctioned: sanctionStatus === 'HIT',
    sanction_status: sanctionStatus,
    sanction_source: firstClean(json.sanction_source, row.sanction_source),
    sanction_program: firstClean(json.sanction_program, row.sanction_program),
    sanction_checked_at: firstClean(json.sanction_checked_at, row.sanction_checked_at),
    evidence_url: firstClean(json.evidence_url, row.evidence_url),
    quality_status: quality,
    missing_steps: missing,
    step5_status: firstClean(json.step5_status, row.step5_status, '未执行'),
    step5_plus_status: firstClean(json.step5_plus_status, row.step5_plus_status, '应启未启'),
    contact_classification: firstClean(json.contact_classification, row.contact_classification, '未找到'),
    contact_name: firstClean(json.contact_name, row.contact_name),
    contact_title: firstClean(json.contact_title, row.contact_title),
    contacts_summary: concise(firstClean(json.contacts_summary, row.contacts_summary, [row.email, row.phone].filter(Boolean).join(' / ')), 180),
    outreach_angle: concise(firstClean(json.outreach_angle, row.outreach_angle, fields.opportunity_decision), 180),
    next_action: fields.opportunity_decision,
    notes: concise(firstClean(json.notes, row.notes), 180),
    opportunity_do: fields.opportunity_do,
    opportunity_need: fields.opportunity_need,
    opportunity_sell: fields.opportunity_sell,
    opportunity_decision: fields.opportunity_decision,
    execution_log: {
      version: 'recon-execution-log-v1',
      records: [],
    },
  };
}

function buildMarkdown(row, json, fields, quality, missing, grouped, flat, supported, legacy) {
  const name = firstClean(json.company_name, row.company_name, row.website, row.job_id);
  const website = firstClean(json.website, row.website);
  const contact = firstClean(json.contacts_summary, row.contacts_summary, [row.email, row.phone].filter(Boolean).join(' / '), '未找到');
  const sanctionStatus = fields.sanction_status;
  const summary = buildJsonSummary(row, json, fields, quality, missing, sanctionStatus);
  const identityEvidence = [...(grouped.identity || []), ...(grouped.registry || [])];
  const productEvidence = [...(grouped.products || []), ...(grouped.product || [])];
  const contactEvidence = [...(grouped.contacts || []), ...(grouped.contact || [])];
  const sanctionEvidence = [...(grouped.sanctions || []), ...(grouped.sanctioned || [])];
  const procurementEvidence = grouped.procurement || [];

  const risk = missing.length ? missing.join('；') : '暂无核心缺口，仍需人工复核关键交易条件';
  const developWhy = [
    supported.product ? '有产品/需求证据' : '需求证据不足',
    supported.contact ? '有联系入口' : '联系入口待补证',
    sanctionStatus === 'HIT' ? '制裁命中需合规复核' : `制裁状态${sanctionStatus}`,
  ].join('；');

  const stepRows = [
    ['Step 0 客户类型', firstClean(row.customer_type, json.customer_type, '待确认'), supported.identity || supported.product ? '身份/产品证据' : '待补证', supported.identity || supported.product ? '已执行/有证据' : '需复核'],
    ['Step 1 身份锚定', firstClean(json.inn, row.inn) ? `INN ${firstClean(json.inn, row.inn)}` : 'INN待确认', evidenceCell(identityEvidence), supported.identity ? '已执行/有证据' : '需补证'],
    ['Step 2 政府/采购', supported.procurement ? '发现采购/招标/供应链线索' : '未形成采购实证', evidenceCell(procurementEvidence), supported.procurement ? '已执行/有证据' : '无结果或待补证'],
    ['Step 3 制裁', sanctionStatus, evidenceCell(sanctionEvidence), supported.sanction ? '已执行/有证据' : '需复核'],
    ['Step 4 数字足迹/需求', fields.opportunity_need, evidenceCell(productEvidence), supported.product ? '已执行/有证据' : '推断，待补证'],
    ['Step 5 社交/联系人', contact, evidenceCell(contactEvidence), supported.contact ? '已执行/有证据' : '需补证'],
    ['Step 5+ 深层侦察', firstClean(json.step5_plus_status, row.step5_plus_status, '待确认'), '见原始执行流水/证据链接', /已执行/.test(firstClean(json.step5_plus_status, row.step5_plus_status)) ? '已执行' : '需复核'],
    ['Step 6 存活性验证', supported.contact ? '入口来自公开证据' : '未验证', evidenceCell(contactEvidence), supported.contact ? '部分执行' : '需补证'],
    ['Step 7 品牌/采购证据', supported.product ? fields.opportunity_need : '缺少品牌/型号证据', evidenceCell(productEvidence), supported.product ? '部分执行' : '需补证'],
    ['Step 8 综合评分', `${fields.score || '待确认'}/100`, '按证据支撑情况保留/降级质检', '已重算口径'],
    ['Step 9 话术生成', fields.opportunity_decision, '基于V2证据链', '已生成'],
  ];

  const evidenceLines = flat.length
    ? flat.map(item => `- ${item.field}: ${item.title} — ${item.url}`)
    : ['- 暂无可用URL；该报告必须重新执行 recon 或人工补证'];

  const gapRows = missing.length
    ? missing.map(item => `| ${item} | 影响评分/质检/外联准确性 | 用官网、工商、制裁库、采购页、2GIS/hh/VK 或电话人工确认 |`)
    : ['| 暂无核心缺口 | 仍需交易前复核 | 交易前复核制裁、收款主体、最终用户和最新联系方式 |'];

  const summaryYaml = [
    `industry: ${summary.industry}`,
    `customer_type: ${summary.customer_type}`,
    `city: ${summary.city}`,
    `employees: ${summary.employees}`,
    `phone: ${summary.phone}`,
    `email: ${summary.email}`,
    `inn: ${summary.inn}`,
    `rating: ${summary.rating}`,
    `products: ${summary.products}`,
    `description: ${summary.description}`,
    `opportunity_summary: ${summary.opportunity_summary}`,
    `sanctioned: ${summary.sanctioned}`,
    `sanction_status: ${summary.sanction_status}`,
    `sanction_source: ${summary.sanction_source}`,
    `sanction_program: ${summary.sanction_program}`,
    `quality_status: ${summary.quality_status}`,
    `missing_steps: ${summary.missing_steps.join('; ')}`,
    `step5_status: ${summary.step5_status}`,
    `step5_plus_status: ${summary.step5_plus_status}`,
    `contact_classification: ${summary.contact_classification}`,
    `outreach_angle: ${summary.outreach_angle}`,
    `contact_name: ${summary.contact_name}`,
    `contact_title: ${summary.contact_title}`,
    `notes: ${summary.notes}`,
    `opportunity_do: ${summary.opportunity_do}`,
    `opportunity_need: ${summary.opportunity_need}`,
    `opportunity_sell: ${summary.opportunity_sell}`,
    `opportunity_decision: ${summary.opportunity_decision}`,
  ];

  return [
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    '## V2 销售决策卡',
    '',
    '### 一句话结论',
    '',
    `${name}：${fields.opportunity_decision}。${developWhy}。最大风险：${risk}。`,
    '',
    '### 我们想要什么',
    '',
    markdownTable([
      '| 问题 | 结论 |',
      '|------|------|',
      `| 这家公司做什么 | ${fields.opportunity_do} |`,
      `| 它可能需要什么 | ${fields.opportunity_need} |`,
      `| 我们能卖什么 | ${fields.opportunity_sell} |`,
      `| 应该找谁 | ${contact} |`,
      `| 为什么现在可开发 | ${developWhy} |`,
      `| 先做什么 | ${fields.opportunity_decision} |`,
      `| 风险 | ${risk} |`,
    ]),
    '',
    '### 证据链快速表',
    '',
    markdownTable([
      '| 结论 | 已有证据 | 证据强度 | 仍缺什么 |',
      '|------|----------|----------|----------|',
      `| 身份/工商 | ${evidenceCell(identityEvidence)} | ${supported.identity ? '高/中' : '待确认'} | ${supported.identity ? '交易前复核最新登记' : 'INN/法人/地址公开源'} |`,
      `| 产品/需求 | ${evidenceCell(productEvidence)} | ${supported.product ? '中/高' : '待确认'} | ${supported.product ? '具体型号/BOM/年用量' : '官网产品页/规格书/目录'} |`,
      `| 联系入口 | ${evidenceCell(contactEvidence)} | ${supported.contact ? '中/高' : '待确认'} | ${supported.contact ? '采购负责人个人通道' : '官网联系页/2GIS/电话验证'} |`,
      `| 制裁状态 | ${evidenceCell(sanctionEvidence)} | ${supported.sanction ? '中/高' : '待确认'} | ${supported.sanction ? '交易前复核' : 'OpenSanctions/OFAC/EU/UK'} |`,
      `| 采购实证 | ${evidenceCell(procurementEvidence)} | ${supported.procurement ? '中/高' : '低/待确认'} | 海关/招标/供应商记录 |`,
    ]),
    '',
    '### Step 0-9 输出一览',
    '',
    markdownTable([
      '| Step | 能得出的结果/结论 | 当前证据 | 可执行性 |',
      '|------|------------------|----------|----------|',
      ...stepRows.map(rowValues => `| ${rowValues.join(' | ')} |`),
    ]),
    '',
    '### 信息缺口转执行任务',
    '',
    markdownTable([
      '| 缺口 | 为什么重要 | 下一步怎么找 |',
      '|------|------------|--------------|',
      ...gapRows,
    ]),
    '',
    `## ${name} | ${website || '官网待确认'} | 评分: ${fields.score || '待确认'}/100 ${fields.rating}`,
    '',
    `**制裁**: ${sanctionStatus} | **质检**: ${quality} | **类型**: ${firstClean(json.customer_type, row.customer_type, '待确认')} | **城市**: ${firstClean(json.city, row.city, '待确认')}`,
    '',
    '## 目标',
    '',
    `把 ${name} 转成可执行销售线索：确认身份、需求、联系人、制裁状态、证据缺口和下一步动作。`,
    '',
    '## 机会判断',
    '',
    `⚡ ${name} | ${firstClean(json.industry, row.industry, '行业待确认')} | ${firstClean(json.city, row.city, '城市待确认')} | ${firstClean(json.employees, row.employees, '员工待确认')}`,
    `    机会逻辑: ${fields.opportunity_do} → ${fields.opportunity_need} → ${fields.opportunity_sell}`,
    `📞 入口: ${firstClean(json.contact_classification, row.contact_classification, '未找到')} | ${contact}`,
    `🚩 ${sanctionStatus} | ${fields.score || '待确认'}/100 ${fields.rating} | ${fields.opportunity_decision}`,
    '',
    '## 数据质量声明',
    '',
    `- 证据URL数量：${flat.length}`,
    `- 质检状态：${quality}`,
    `- 缺口：${missing.length ? missing.join('；') : '暂无核心缺口'}`,
    '- 规则：没有可追溯URL支撑的关键结论，已在V2层降级为待确认/需复核。',
    '',
    '## 证据链接',
    '',
    ...evidenceLines,
    '',
    '## 原始执行流水',
    '',
    legacy || '原始报告缺失；本报告由数据库结构化字段和证据表重建。',
    '',
    '## 客户数据摘要',
    ...summaryYaml,
    '',
  ].join('\n');
}

function buildHtml(markdown, title) {
  const html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body{margin:0;background:#f5f7fb;color:#172033;font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1180px;margin:0 auto;padding:28px 18px 56px}
    h1,h2,h3{line-height:1.25} h2{margin-top:30px;border-top:1px solid #d8dee9;padding-top:20px}
    p{background:#fff;border:1px solid #e1e7f0;border-radius:10px;padding:14px;overflow:auto}
    table{border-collapse:collapse;width:100%;background:#fff;margin:12px 0}
    th,td{border:1px solid #d8dee9;padding:8px;text-align:left;vertical-align:top}
    th{background:#eef3fb}
    code{background:#eef3fb;padding:2px 4px;border-radius:4px}
    a{color:#155eef}
  </style>
</head>
<body><main><p>${html}</p></main></body></html>`;
}

function main() {
  const args = parseArgs();
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 10000');

  let sql = `
    SELECT rr.*, rj.output_dir
    FROM recon_results rr
    LEFT JOIN recon_jobs rj ON rj.job_id = rr.job_id
  `;
  const params = [];
  if (args.jobId) {
    sql += ' WHERE rr.job_id = ?';
    params.push(args.jobId);
  }
  sql += ' ORDER BY rr.updated_at DESC';
  if (args.limit > 0) sql += ` LIMIT ${Number(args.limit)}`;

  const rows = db.prepare(sql).all(...params);
  const evidenceStmt = db.prepare('SELECT * FROM recon_evidence WHERE job_id = ? ORDER BY id');
  const existingEvidenceStmt = db.prepare('SELECT id FROM recon_evidence WHERE job_id = ? AND source_url = ? AND field_name = ? LIMIT 1');
  const insertEvidenceStmt = db.prepare(`
    INSERT INTO recon_evidence (job_id, customer_id, field_name, value, source_url, source_title, checked_at, confidence, extractor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE recon_results
    SET score = ?,
        rating = ?,
        opportunity_do = ?,
        opportunity_need = ?,
        opportunity_sell = ?,
        opportunity_decision = ?,
        opportunity_summary = ?,
        recommended_products = ?,
        sanction_status = ?,
        quality_status = ?,
        missing_steps = ?,
        evidence_count = ?,
        report_path = ?,
        artifacts_json = ?,
        updated_at = ?
    WHERE job_id = ?
  `);

  const prepared = [];
  for (const row of rows) {
    const mdPath = locateReportMarkdown(row);
    const htmlPath = mdPath.replace(/\.md$/i, '.html');
    const original = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
    const json = { ...parseJsonSummary(original) };
    const reportUrls = extractUrls(original);
    const dbEvidence = evidenceStmt.all(row.job_id);
    const extraEvidence = reportUrls.map(url => ({
      job_id: row.job_id,
      customer_id: row.customer_id,
      field_name: inferEvidenceType(url),
      value: hostLabel(url),
      source_url: url,
      source_title: hostLabel(url),
      confidence: 'medium',
      extractor: 'legacy_report_url',
    }));
    const grouped = groupEvidence([...dbEvidence, ...extraEvidence]);
    const flat = flattenEvidence(grouped);
    const supported = supportProfile(grouped);
    const sanctionStatus = normalizeSanctionStatus(row, json);
    const score = normalizeScore(firstClean(json.score, row.score));
    const qualityCheck = classifyQuality(row, json, supported, flat.length);
    const fields = {
      score,
      sanction_status: sanctionStatus,
      opportunity_do: inferDo(row, json, supported),
      opportunity_need: inferNeed(row, json, supported),
      opportunity_sell: inferSell(row, json, supported),
      rating: normalizeRating(score, qualityCheck.quality),
    };
    fields.opportunity_decision = buildDecision(fields, supported, sanctionStatus);
    fields.opportunity_summary = concise(`${fields.opportunity_do}；${fields.opportunity_need}；${fields.opportunity_decision}`, 220);

    const legacy = stripGeneratedSections(original);
    const markdown = buildMarkdown(row, json, fields, qualityCheck.quality, qualityCheck.missing, grouped, flat, supported, legacy);
    const title = `${firstClean(json.company_name, row.company_name, row.job_id)} — Recon V2`;
    const html = buildHtml(markdown, title);
    const artifacts = parseArtifacts(row.artifacts_json);
    const nextArtifacts = {
      ...artifacts,
      report_md: mdPath,
      report_html: htmlPath,
      previous_report_path: artifacts.previous_report_path || row.report_path || '',
      evidence_repair: {
        updated_at: new Date().toISOString(),
        source: 'scripts/regenerate-recon-v2-from-evidence.js',
        mode: 'rewrite_existing_report',
      },
    };

    prepared.push({
      row,
      mdPath,
      htmlPath,
      markdown,
      html,
      fields,
      quality: qualityCheck.quality,
      missing: qualityCheck.missing,
      flat,
      extraEvidence,
      artifacts_json: JSON.stringify(nextArtifacts, null, 2),
    });
  }

  let backupPath = '';
  if (args.apply && prepared.length) {
    backupPath = path.join(path.dirname(DB_PATH), `crm.db.bak-${stamp()}-before-recon-v2-rewrite`);
    db.prepare('VACUUM INTO ?').run(backupPath);
    const tx = db.transaction(() => {
      for (const item of prepared) {
        fs.mkdirSync(path.dirname(item.mdPath), { recursive: true });
        if (fs.existsSync(item.mdPath) && !fs.existsSync(`${item.mdPath}.bak-before-v2`)) {
          fs.copyFileSync(item.mdPath, `${item.mdPath}.bak-before-v2`);
        }
        if (fs.existsSync(item.htmlPath) && !fs.existsSync(`${item.htmlPath}.bak-before-v2`)) {
          fs.copyFileSync(item.htmlPath, `${item.htmlPath}.bak-before-v2`);
        }
        for (const evidence of item.extraEvidence) {
          if (existingEvidenceStmt.get(item.row.job_id, evidence.source_url, evidence.field_name)) continue;
          insertEvidenceStmt.run(
            item.row.job_id,
            item.row.customer_id,
            evidence.field_name,
            evidence.value,
            evidence.source_url,
            evidence.source_title,
            new Date().toISOString(),
            evidence.confidence,
            evidence.extractor,
          );
        }
        fs.writeFileSync(item.mdPath, item.markdown, 'utf8');
        fs.writeFileSync(item.htmlPath, item.html, 'utf8');
        updateStmt.run(
          item.fields.score,
          item.fields.rating,
          item.fields.opportunity_do,
          item.fields.opportunity_need,
          item.fields.opportunity_sell,
          item.fields.opportunity_decision,
          item.fields.opportunity_summary,
          item.fields.opportunity_sell,
          item.fields.sanction_status,
          item.quality,
          item.missing.join('; '),
          String(item.flat.length),
          item.htmlPath,
          item.artifacts_json,
          new Date().toISOString(),
          item.row.job_id,
        );
      }
    });
    tx();
  }

  const result = {
    ok: true,
    mode: args.apply ? 'apply' : 'dry-run',
    total: prepared.length,
    backupPath,
    reports: prepared.map(item => ({
      job_id: item.row.job_id,
      company_name: item.row.company_name,
      report_md: item.mdPath,
      report_html: item.htmlPath,
      evidence_urls: item.flat.length,
      quality_status: item.quality,
      missing: item.missing,
      decision: item.fields.opportunity_decision,
    })).slice(0, args.json ? prepared.length : 12),
    quality: prepared.reduce((acc, item) => {
      acc[item.quality] = (acc[item.quality] || 0) + 1;
      return acc;
    }, {}),
    missing_top: prepared
      .flatMap(item => item.missing)
      .reduce((acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
      }, {}),
  };
  console.log(JSON.stringify(result, null, 2));
  db.close();
}

main();

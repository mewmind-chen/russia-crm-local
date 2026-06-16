const VERSION = 'recon-grading-v1';

const POOL_BY_SCORE = [
  [90, 'S', '⭐⭐⭐⭐⭐'],
  [75, 'A', '⭐⭐⭐⭐'],
  [60, 'B', '⭐⭐⭐'],
  [40, 'C', '⭐⭐'],
  [0, 'D', '⭐'],
];

const TYPE_SCORES = {
  '终端制造商': 20,
  '混合型': 18,
  'EMS/方案商': 17,
  '系统集成商': 16,
  '贴片厂/PCBA': 15,
  '终端客户': 13,
  '贸易公司': 9,
  '原厂': 8,
  '平台型': 7,
  '待确认': 6,
  '服务商/非目标': 0,
};

function clean(value) {
  return String(value || '').trim();
}

function lowerJoin(...values) {
  return values.map(clean).filter(Boolean).join(' ').toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some(keyword => text.includes(String(keyword).toLowerCase()));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreToPoolRating(score) {
  const numeric = clamp(Math.round(toNumber(score)), 0, 100);
  const row = POOL_BY_SCORE.find(([min]) => numeric >= min) || POOL_BY_SCORE[POOL_BY_SCORE.length - 1];
  return { score: String(numeric), current_pool: row[1], rating: row[2] };
}

function evidenceFieldSet(evidence = []) {
  return new Set(
    evidence
      .map(item => clean(item && item.field_name).toLowerCase())
      .filter(Boolean)
  );
}

function scoreCustomerType(result = {}) {
  return TYPE_SCORES[clean(result.customer_type)] ?? 6;
}

function scoreProductFit(result = {}) {
  const text = lowerJoin(
    result.products,
    result.recommended_products,
    result.opportunity_need,
    result.opportunity_sell,
    result.opportunity_summary,
    result.description,
    result.industry,
    result.customer_type
  );
  if (!text) return 4;
  if (clean(result.customer_type) === '服务商/非目标' || clean(result.industry) === '非目标/其他') return 0;

  const componentGroups = [
    ['mcu', '微控制器', 'stm32', 'gd32', 'avr', 'pic', 'microcontroller'],
    ['igbt', 'mosfet', 'sic', 'gan', '功率器件', '功率半导体', '晶闸管', '可控硅'],
    ['传感器', 'sensor', '编码器', '压力', '温度'],
    ['plc', '控制器', '变频器', '伺服', 'hmi', 'scada'],
    ['rs-485', 'can', '以太网', '通信模块', '收发器', 'modbus'],
    ['连接器', '继电器', '电源模块', '电源管理', '电容', '电阻', '被动元件'],
    ['fpga', 'dsp', 'adc', 'dac', '处理器', '存储', '内存'],
  ];
  const matchedGroups = componentGroups.filter(group => hasAny(text, group)).length;
  const hasExactModel = /\b[a-z]{1,5}\d{2,}[a-z0-9-]*\b/i.test(text);
  const strongBusiness = hasAny(text, ['电子', '工业控制', '自动化', '电力电子', '通信', '医疗电子', '汽车电子', '导航', 'pcb', 'smt']);
  const industrialBusiness = hasAny(text, ['工业', '设备', '制造', '机床', 'cnc', '机器人', '仪器', '电气']);

  if (matchedGroups >= 3 || (matchedGroups >= 2 && hasExactModel)) return 30;
  if (matchedGroups >= 2) return 26;
  if (matchedGroups === 1 && strongBusiness) return 23;
  if (matchedGroups === 1) return 19;
  if (strongBusiness) return 16;
  if (industrialBusiness) return 10;
  return 5;
}

function scoreEvidenceQuality(result = {}, evidence = []) {
  const fields = evidenceFieldSet(evidence);
  const count = Math.max(toNumber(result.evidence_count), evidence.length);
  let score = 0;
  if (count >= 10) score += 8;
  else if (count >= 5) score += 6;
  else if (count >= 2) score += 4;
  else if (count >= 1) score += 2;

  if (clean(result.website)) score += 2;
  if (clean(result.inn)) score += 4;
  if (fields.has('identity') || fields.has('registry')) score += 3;
  if (fields.has('products') || fields.has('procurement')) score += 2;
  if (fields.has('sanctions') || clean(result.sanction_status)) score += 1;

  return clamp(score, 0, 20);
}

function scoreContactability(result = {}) {
  const text = lowerJoin(result.email, result.phone, result.contact_name, result.contact_title, result.contacts_summary);
  let score = 0;
  const classification = clean(result.contact_classification);
  if (classification === '已验证联系人') score += 10;
  else if (classification === '入口联系人') score += 6;
  else if (classification === '未找到') score += 0;

  if (clean(result.contact_name)) score += 5;
  if (clean(result.contact_title)) score += 2;
  if (clean(result.email)) score += hasAny(text, ['procurement', 'purchase', 'zakup', 'zakupki', 'снаб', 'закуп']) ? 6 : 4;
  if (clean(result.phone)) score += 3;

  return clamp(score, 0, 20);
}

function scoreExecutionQuality(result = {}) {
  let score = 0;
  if (clean(result.step5_status) === '已执行') score += 4;
  const step5Plus = clean(result.step5_plus_status);
  if (step5Plus === '已执行' || step5Plus === '未触发') score += 3;
  if (clean(result.quality_status) === '完整') score += 3;
  else if (clean(result.quality_status) === '部分') score += 1;
  return clamp(score, 0, 10);
}

function parseMissingSteps(result = {}) {
  const raw = result.missing_steps;
  if (Array.isArray(raw)) return raw.map(clean).filter(Boolean);
  return clean(raw)
    .split(/[;；,，、\n]/)
    .map(clean)
    .filter(Boolean);
}

function applyCaps(score, result = {}, evidence = []) {
  let capped = score;
  const caps = [];
  const missing = parseMissingSteps(result).join(' ');

  if (!evidence.length && !toNumber(result.evidence_count)) {
    capped = Math.min(capped, 39);
    caps.push('无证据上限39');
  }
  if (clean(result.customer_type) === '服务商/非目标' || clean(result.industry) === '非目标/其他') {
    capped = Math.min(capped, 39);
    caps.push('非目标上限39');
  }
  if (!clean(result.inn) || /INN未获取|法人\/负责人姓名未获取/.test(missing)) {
    capped = Math.min(capped, 59);
    caps.push('身份不完整上限59');
  }
  if (clean(result.step5_status) && clean(result.step5_status) !== '已执行') {
    capped = Math.min(capped, 49);
    caps.push('Step5未完成上限49');
  }
  if (clean(result.step5_plus_status) === '应启未启') {
    capped = Math.min(capped, 49);
    caps.push('Step5+应启未启上限49');
  }

  return { score: capped, caps };
}

function gradeReconResult(result = {}, evidence = []) {
  const dimensions = {
    customer_type: scoreCustomerType(result),
    product_fit: scoreProductFit(result),
    evidence_quality: scoreEvidenceQuality(result, evidence),
    contactability: scoreContactability(result),
    execution_quality: scoreExecutionQuality(result),
  };
  const rawScore = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const capped = applyCaps(rawScore, result, evidence);
  const mapped = scoreToPoolRating(capped.score);
  const detail = [
    `类型=${dimensions.customer_type}/20`,
    `产品匹配=${dimensions.product_fit}/30`,
    `证据=${dimensions.evidence_quality}/20`,
    `触达=${dimensions.contactability}/20`,
    `执行=${dimensions.execution_quality}/10`,
  ].join('，');
  const capText = capped.caps.length ? `；上限=${capped.caps.join('/')}` : '';
  return {
    ...mapped,
    priority: mapped.current_pool === 'D' ? 'low' : 'review',
    grading_version: VERSION,
    grading_note: `[统一评级 ${VERSION}] 总分=${mapped.score}；${detail}${capText}`,
    grading_breakdown: dimensions,
  };
}

module.exports = {
  VERSION,
  gradeReconResult,
  scoreToPoolRating,
};

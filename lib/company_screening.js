const HIGH_FIT_TYPES = ['终端制造商', '贴片厂/PCBA', 'EMS/方案商', '原厂'];
const MEDIUM_FIT_TYPES = ['系统集成商', '终端客户', '混合型'];
const TARGET_TERMS = /电子|半导体|微电子|工业控制|工业自动化|电力电子|汽车电子|通信|仪器|仪表|机床|铁路|计算机|控制器|传感|pcb|pcba|ems|automation|electronics|semiconductor/i;
const MANUFACTURING_TERMS = /制造|生产|研发|工厂|厂|plant|manufactur|production|разработ|производ/i;
const HIGH_RISK_TERMS = /制裁|sanction|军工|军事|国防|航空电子|导弹|weapon|military|defen[cs]e/i;
const NON_TARGET_TERMS = /非目标|餐饮|酒店|媒体|教育|法律|咨询|房地产/i;

function unique(values) { return [...new Set(values.filter(Boolean))]; }

function classifyCompany(row = {}) {
  const text = [row.company_name, row.industry, row.customer_type, row.description, row.products, row.notes].join(' ');
  const reasons = [], risks = [], needs = [], products = [];
  let score = 20;
  if (HIGH_FIT_TYPES.includes(row.customer_type)) { score += 35; reasons.push(`客户类型：${row.customer_type}`); }
  else if (MEDIUM_FIT_TYPES.includes(row.customer_type)) { score += 20; reasons.push(`潜在客户类型：${row.customer_type}`); }
  else if (/贸易|平台|服务商/.test(row.customer_type || '')) { score -= 15; reasons.push('贸易/平台类优先级较低'); }
  if (TARGET_TERMS.test(text)) { score += 25; reasons.push('主营方向与电子元器件应用相关'); }
  if (MANUFACTURING_TERMS.test(text)) { score += 10; reasons.push('存在研发或制造信号'); }
  if (row.website) { score += 5; reasons.push('已有企业官网'); }
  if (row.verified || /有效|verified|正常/i.test(row.website_verification || '')) score += 5;
  if (/⭐⭐⭐/.test(row.rating || '')) score += 10;
  else if (/⭐⭐/.test(row.rating || '')) score += 5;
  if (NON_TARGET_TERMS.test(text)) { score -= 45; risks.push('历史信息显示非目标行业'); }
  const riskText = String(row.risk_status || '');
  const explicitClear = /\bclear\b|未发现.{0,8}制裁|制裁.{0,8}未命中|未命中/i.test(riskText);
  const militarySignal = /军工|军事|国防|导弹|weapon|military|defen[cs]e/i.test(text);
  const sanctionSignal = !explicitClear && /制裁|高风险|禁止|sanction/i.test(riskText);
  if (militarySignal || sanctionSignal) risks.push('存在军工/制裁相关信号，禁止自动外联');
  const industry = String(row.industry || '');
  if (/工业控制|自动化|仪器|仪表|机床/.test(text)) needs.push('MCU', '存储器', '电源管理', '隔离器件', '传感器');
  if (/电力电子|变频|电机|驱动/.test(text)) needs.push('MOSFET/IGBT', '栅极驱动', '电源模块', 'MCU');
  if (/通信|计算机|服务器/.test(text)) needs.push('存储器', '处理器', '网络芯片', '电源管理');
  if (/汽车|铁路/.test(text)) needs.push('车规MCU', '存储器', '功率器件', '连接器');
  if (/半导体|微电子|电子设备|PCB|PCBA|EMS/i.test(text)) needs.push('芯片', '被动元件', '连接器', '存储器');
  if (row.products) products.push(...String(row.products).split(/[;,，、|]/).map(x => x.trim()).filter(Boolean).slice(0, 12));
  score = Math.max(0, Math.min(100, score));
  const blocked = risks.some(x => x.includes('禁止'));
  const group = blocked ? 'D' : score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 30 ? 'C' : 'D';
  const type = row.customer_type || (MANUFACTURING_TERMS.test(text) ? '制造型企业' : '待确认');
  return {
    business_summary: [industry, row.description || '', row.products ? `产品：${row.products}` : ''].filter(Boolean).join('；').slice(0, 1200),
    company_type: type, product_categories: unique(products), likely_component_needs: unique(needs),
    match_score: score, match_group: group, match_reasons: unique(reasons),
    risk_level: blocked ? 'blocked' : risks.length ? 'review' : 'preliminary_clear', risk_reasons: unique(risks),
    classification_confidence: Math.min(95, 35 + (row.website ? 15 : 0) + (row.industry ? 15 : 0) + (row.customer_type ? 15 : 0) + (row.products ? 15 : 0)),
    source_urls: row.website ? [String(row.website).startsWith('http') ? row.website : `https://${row.website}`] : [],
  };
}

module.exports = { classifyCompany };

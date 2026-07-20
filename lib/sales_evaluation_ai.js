const { callHermes } = require('./hermes_assistant');
const { callKimi } = require('./kimi_assistant');

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('AI未返回结构化标注');
  return JSON.parse(candidate);
}

function normalizeList(value, limit = 10) {
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (typeof item === 'string') return { name: item, confidence: 70, rationale: '' };
      const rawConfidence = Number(item?.confidence);
      return {
          name: String(item?.name || item?.label || '').trim(),
          category: String(item?.category || '').trim(),
          confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, rawConfidence)) : 70,
          rationale: String(item?.rationale || item?.reason || '').trim(),
        };
    })
    .filter(item => item.name)
    .slice(0, limit);
}

async function analyzeManagerEvaluation(input = {}) {
  const subjectType = input.subjectType === 'contact' ? '联系人' : '企业';
  const evaluation = String(input.evaluation || '').trim();
  if (!evaluation) throw new Error('评价内容为空');
  const messages = [
    {
      role: 'system',
      content: [
        '你是电子元器件外贸CRM中的经理评价结构化助手。',
        '只分析经理输入的评价原文，不外查、不补充不存在的事实。',
        '经理判断不是客观事实，输出时必须保留“来源：经理评价”的语义。',
        '只返回一个JSON对象，不要Markdown，不要解释。',
        'JSON字段：summary字符串；labels数组（name,category,confidence,rationale）；order_keys数组；risks数组；strategy字符串。',
        'labels最多8个，category仅可为：价格敏感度、流程规范、质量要求、决策权、沟通风格、关系状态、技术能力、采购特征、机会、风险。',
        'order_keys和risks均为短语数组，最多5个。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `评价对象类型：${subjectType}`,
        `对象名称：${String(input.subjectName || '')}`,
        `职位：${String(input.subjectTitle || '')}`,
        `经理评价原文：${evaluation}`,
      ].join('\n'),
    },
  ];
  let result;
  try {
    result = await callHermes(messages, { scope: `manager_evaluation:${subjectType}`, externalAllowed: false });
  } catch (hermesError) {
    try {
      result = await callKimi(messages, { scope: `manager_evaluation:${subjectType}`, externalAllowed: false });
    } catch (kimiError) {
      const error = new Error(`AI标注暂时不可用：${hermesError.message}；备用引擎：${kimiError.message}`);
      error.cause = kimiError;
      throw error;
    }
  }
  const parsed = extractJson(result.answer);
  return {
    summary: String(parsed.summary || '').trim(),
    labels: normalizeList(parsed.labels, 8),
    orderKeys: normalizeList(parsed.order_keys, 5).map(item => item.name),
    risks: normalizeList(parsed.risks, 5).map(item => item.name),
    strategy: String(parsed.strategy || '').trim(),
    model: result.model || 'Hermes',
  };
}

module.exports = { extractJson, analyzeManagerEvaluation };

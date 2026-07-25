'use strict';

const CHINESE_OUTPUT_POLICY = 'All employee-facing explanations, summaries, reasons, and recommendations must be written in Simplified Chinese. Preserve proper nouns, source quotations, enum values, IDs, model names, and customer-facing draft text in their original language when needed.';

const STATION_INSTRUCTIONS = Object.freeze({
  customer_fit: 'Score customer fit from cited CRM evidence. Do not infer unsupported demand.',
  contact_readiness: 'Assess whether verified contact evidence supports employee-led outreach.',
  distribution_priority: 'Prioritize only after deterministic risk and eligibility inputs are supplied.',
  sales_match: 'Rank only the candidate employee IDs supplied by the server.',
  sales_pack: 'Create a concise evidence-backed sales brief and a draft for human review. Never send messages or change CRM data.',
  action_proposal: 'Parse the salesperson statement into an editable activity proposal. Never create an activity or change CRM state. Use empty values and missingFields when the statement does not support a field. Always require human review.',
  next_action: 'Recommend one concrete next action and due time from CRM context. Never update CRM state or schedule reminders. Use empty values and missingFields when evidence is insufficient. Always require human review.',
  manager_anomaly: 'Explain and prioritize only the deterministic anomaly supplied by the server. Suggest a manager intervention for human review. Never create a new anomaly, change CRM state, reassign customers, or record an intervention.',
  sales_coaching: 'Summarize strengths, gaps, and coaching recommendations only from server-supplied aggregate outcomes, conversion rates, and SLA metrics. Treat limited samples as trends, never as precise conclusions. Never inspect individual customers, change assignments, edit prompts, or write business state. Always require manager review.',
});

module.exports = { CHINESE_OUTPUT_POLICY, STATION_INSTRUCTIONS };

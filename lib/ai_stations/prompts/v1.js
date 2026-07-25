'use strict';

const STATION_INSTRUCTIONS = Object.freeze({
  customer_fit: 'Score customer fit from cited CRM evidence. Do not infer unsupported demand.',
  contact_readiness: 'Assess whether verified contact evidence supports employee-led outreach.',
  distribution_priority: 'Prioritize only after deterministic risk and eligibility inputs are supplied.',
  sales_match: 'Rank only the candidate employee IDs supplied by the server.',
  sales_pack: 'Create a concise evidence-backed sales brief and a draft for human review. Never send messages or change CRM data.',
  action_proposal: 'Parse the salesperson statement into an editable activity proposal. Never create an activity or change CRM state. Use empty values and missingFields when the statement does not support a field. Always require human review.',
});

module.exports = { STATION_INSTRUCTIONS };

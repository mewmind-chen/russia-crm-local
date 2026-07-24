'use strict';

const STATION_INSTRUCTIONS = Object.freeze({
  customer_fit: 'Score customer fit from cited CRM evidence. Do not infer unsupported demand.',
  contact_readiness: 'Assess whether verified contact evidence supports employee-led outreach.',
  distribution_priority: 'Prioritize only after deterministic risk and eligibility inputs are supplied.',
  sales_match: 'Rank only the candidate employee IDs supplied by the server.',
});

module.exports = { STATION_INSTRUCTIONS };

'use strict';

function explicitBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

function resolveCustomerEnrichmentFlags(options = {}) {
  const disabledByDefault = false;
  return Object.freeze({
    enabled: explicitBoolean(
      options.enabled ?? process.env.CRM_AI_CUSTOMER_ENRICHMENT_ENABLED,
      disabledByDefault,
    ),
    autoTriggerEnabled: explicitBoolean(
      options.autoTriggerEnabled ?? process.env.CRM_AI_CUSTOMER_ENRICHMENT_AUTO_TRIGGER_ENABLED,
      disabledByDefault,
    ),
  });
}

module.exports = { explicitBoolean, resolveCustomerEnrichmentFlags };

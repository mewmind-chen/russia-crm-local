'use strict';

const FLASH_STATIONS = new Set([
  'customer_fit',
  'contact_readiness',
  'distribution_priority',
  'manager_anomaly',
]);

const PLUS_STATIONS = new Set([
  'sales_match',
  'sales_pack',
  'action_proposal',
  'next_action',
  'sales_coaching',
]);

const DEFAULT_MODELS = Object.freeze({
  chat: 'qwen3.7-plus',
  flash: 'qwen3.7-flash',
  plus: 'qwen3.7-plus',
  fallback: 'deepseek-v4-pro',
});

function configuredMap(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    throw Object.assign(new Error('CRM_AI_STATION_MODEL_MAP_JSON must be a JSON object'), {
      code: 'AI_MODEL_POLICY_INVALID',
      statusCode: 500,
    });
  }
}

function stationModel(station, options = {}, env = process.env) {
  const name = String(station || '').trim();
  const mapping = configuredMap(options.mapping ?? env.CRM_AI_STATION_MODEL_MAP_JSON);
  const explicit = String(mapping[name] || '').trim();
  if (explicit) return explicit;
  if (FLASH_STATIONS.has(name)) return String(options.flash || env.QWEN_FLASH_MODEL || DEFAULT_MODELS.flash);
  if (PLUS_STATIONS.has(name)) return String(options.plus || env.QWEN_PLUS_MODEL || DEFAULT_MODELS.plus);
  return String(options.plus || env.QWEN_PLUS_MODEL || DEFAULT_MODELS.plus);
}

function onlineModelPolicy(station, options = {}, env = process.env) {
  return Object.freeze({
    qwen: station
      ? stationModel(station, options, env)
      : String(options.chat || env.QWEN_MODEL || DEFAULT_MODELS.chat),
    deepseek: String(options.fallback || env.DEEPSEEK_FALLBACK_MODEL || DEFAULT_MODELS.fallback),
  });
}

module.exports = {
  DEFAULT_MODELS,
  FLASH_STATIONS,
  PLUS_STATIONS,
  onlineModelPolicy,
  stationModel,
};

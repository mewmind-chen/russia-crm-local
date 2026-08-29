'use strict';

// Notification feature gating. Codes tied to disabled stations are suppressed
// so users never see notifications for features they cannot act on.

const AI_NOTIFICATION_CODES = new Set([
  'SALES_PACK_READY', 'SALES_PACK_FAILED', 'MANAGER_ANOMALY_READY',
  'SALES_COACHING_READY', 'AI_TASK_READY', 'AI_TASK_FAILED',
]);
const SALES_PACK_NOTIFICATION_CODES = new Set(['SALES_PACK_READY', 'SALES_PACK_FAILED']);

function notificationVisibleForFeatures(code, features) {
  const value = String(code || '');
  if (!features.ai_stations.effectiveEnabled) return !AI_NOTIFICATION_CODES.has(value);
  if (!features.sales_pack.effectiveEnabled) return !SALES_PACK_NOTIFICATION_CODES.has(value);
  return true;
}

module.exports = Object.freeze({
  notificationVisibleForFeatures,
  AI_NOTIFICATION_CODES,
  SALES_PACK_NOTIFICATION_CODES,
});
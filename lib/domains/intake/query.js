'use strict';

// Intake-query parameter normalization helpers.

function intakeQueryValues(value, limit = 50) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map(item => String(item || '').trim()).filter(Boolean))].slice(0, limit);
}

function intakeQueryBoolean(value) {
  const selected = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(selected)) return true;
  if (['0', 'false', 'no', 'off'].includes(selected)) return false;
  return null;
}

function intakeQueryDate(value, endOfDay = false) {
  const selected = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) return '';
  return `${selected} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

module.exports = Object.freeze({
  intakeQueryValues,
  intakeQueryBoolean,
  intakeQueryDate,
});
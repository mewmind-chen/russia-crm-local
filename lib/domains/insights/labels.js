'use strict';

// Insights display sanitizers: evaluation labels and subject names are
// trimmed, collapsed, and stripped of contact-shaped values before rendering.

function safeEvaluationLabel(value) {
  const label = String(typeof value === 'string' ? value : value?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!label || /@|https?:\/\/|www\./i.test(label)) return '';
  if ((label.match(/\d/g) || []).length >= 7) return '';
  return label;
}

module.exports = Object.freeze({
  safeEvaluationLabel,
});
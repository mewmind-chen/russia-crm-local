import { classNames, escapeHtml } from './html.js';

const STATUS_LABELS = Object.freeze({
  idle: '待处理',
  pending: '处理中',
  running: '进行中',
  success: '已完成',
  succeeded: '已完成',
  warning: '需关注',
  error: '失败',
  failed: '失败',
});

const STATUS_TONES = Object.freeze({
  idle: 'neutral',
  pending: 'info',
  running: 'info',
  success: 'success',
  succeeded: 'success',
  warning: 'warning',
  error: 'danger',
  failed: 'danger',
});

export function renderStatus(status, options = {}) {
  const normalized = typeof options === 'string' ? { label: options } : options;
  const key = String(status || 'idle').toLowerCase();
  const label = normalized.label || STATUS_LABELS[key] || status || STATUS_LABELS.idle;
  const tone = normalized.tone || STATUS_TONES[key] || 'neutral';
  return `<span class="${classNames('status-badge', `status-${tone}`, normalized.className)}" data-status="${escapeHtml(key)}">${escapeHtml(label)}</span>`;
}

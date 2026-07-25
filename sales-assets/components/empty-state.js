import { escapeAttribute, escapeHtml } from './html.js';

export function renderEmptyState(options = {}) {
  const normalized = typeof options === 'string' ? { title: options } : options;
  const {
    title = '暂无数据',
    description = '',
    icon = '',
    actionLabel = '',
    actionId = '',
  } = normalized;
  return `<div class="empty-state" role="status">
    ${icon ? `<span class="empty-state-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : ''}
    <strong>${escapeHtml(title)}</strong>
    ${description ? `<p>${escapeHtml(description)}</p>` : ''}
    ${actionLabel ? `<button class="button secondary" type="button"${actionId ? ` data-action="${escapeAttribute(actionId)}"` : ''}>${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
}

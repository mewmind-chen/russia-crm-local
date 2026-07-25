const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

export const escapeAttribute = escapeHtml;

export function classNames(...values) {
  return values.flatMap(value => {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') {
      return Object.entries(value).filter(([, enabled]) => enabled).map(([name]) => name);
    }
    return [];
  }).filter(Boolean).join(' ');
}

export function text(value) {
  return escapeHtml(value);
}

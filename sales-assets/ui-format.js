(function initTradePulseUIFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TradePulseUIFormat = api;
    const mount = () => api.mountIcons(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createUIFormat() {
  'use strict';

  const paths = Object.freeze({
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    inbox: '<path d="M4 4h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    building: '<path d="M3 21h18M6 21V3h12v18M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    archive: '<path d="M3 6h18M5 6v15h14V6M9 10h6"/><path d="M4 3h16v3H4z"/>',
    pipeline: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-8"/>',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3zM5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15zM19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13z"/>',
    note: '<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h6v18h-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    external: '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v7H3V3h7"/>',
    alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
    empty: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
  });

  function escapeAttribute(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    })[character]);
  }

  function icon(name, label = '') {
    const title = label ? `<title>${escapeAttribute(label)}</title>` : '';
    const accessibility = label ? ` role="img" aria-label="${escapeAttribute(label)}"` : ' aria-hidden="true"';
    return `<svg class="tp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${accessibility}>${title}${paths[name] || paths.empty}</svg>`;
  }

  function mountIcons(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    scope.querySelectorAll('[data-tp-icon]').forEach(node => {
      node.innerHTML = icon(node.dataset.tpIcon);
    });
  }

  function website(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(href);
      return { href, label: url.hostname.replace(/^www\./i, '') };
    } catch (_error) {
      return null;
    }
  }

  function products(value, limit = 3) {
    let source = value;
    if (typeof source === 'string' && /^\s*\[/.test(source)) {
      try { source = JSON.parse(source); } catch (_error) {}
    }
    const values = (Array.isArray(source) ? source : String(source || '').split(/[,;；、|]/))
      .map(item => String(item || '').trim())
      .filter((item, index, list) => item && list.indexOf(item) === index);
    return { items: values.slice(0, limit), overflow: Math.max(0, values.length - limit) };
  }

  function status(value, labels = {}) {
    const key = String(value || '').trim();
    const toneMap = {
      failed: 'danger', rejected: 'danger', returned: 'danger', overdue: 'danger',
      lost: 'danger', disqualified: 'danger',
      assigned: 'warning', pending: 'warning', manager: 'warning', negotiating: 'warning',
      approved: 'info', qualified: 'info', contacted: 'info', rfq: 'info', quoted: 'info',
      claimed: 'success', completed: 'success', active: 'success', replied: 'success',
      connected: 'success', meeting: 'success', won: 'success', repeat: 'success',
    };
    return { label: labels[key] || key || '未标注', tone: toneMap[key] || 'neutral' };
  }

  return Object.freeze({ icon, mountIcons, website, products, status });
}));

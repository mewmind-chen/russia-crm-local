import { escapeHtml } from './html.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function insertContent(target, content) {
  if (content && typeof content === 'object' && typeof content.nodeType === 'number') {
    target.replaceChildren(content);
  } else {
    target.textContent = String(content ?? '');
  }
}

export function createDrawer({
  document: ownerDocument = globalThis.document,
  portal,
  title = '',
  content = '',
  side = 'right',
  closeLabel = '关闭',
  onClose = () => {},
} = {}) {
  if (!ownerDocument?.createElement) throw new TypeError('createDrawer requires a document');
  const host = portal || ownerDocument.getElementById('drawerPortal') || ownerDocument.body;
  const previousFocus = ownerDocument.activeElement;
  const overlay = ownerDocument.createElement('div');
  overlay.className = 'overlay drawer-overlay';
  overlay.innerHTML = `<aside class="modular-drawer drawer-${side === 'left' ? 'left' : 'right'}" role="dialog" aria-modal="true" tabindex="-1" aria-label="${escapeHtml(title || '抽屉')}">
    <header><h2></h2><button class="icon-button" type="button" data-close aria-label="${escapeHtml(closeLabel)}">&times;</button></header>
    <div class="modular-drawer-body"></div>
  </aside>`;
  overlay.querySelector('h2').textContent = title;
  insertContent(overlay.querySelector('.modular-drawer-body'), content);
  let open = true;

  function close(reason = 'dismiss') {
    if (!open) return;
    open = false;
    ownerDocument.removeEventListener('keydown', onKeydown);
    overlay.remove();
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    onClose(reason);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  overlay.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) close('button');
    else if (event.target === overlay) close('backdrop');
  });
  ownerDocument.addEventListener('keydown', onKeydown);
  host.append(overlay);
  queueMicrotask(() => {
    if (!open) return;
    (overlay.querySelector(FOCUSABLE) || overlay.querySelector('.modular-drawer'))?.focus();
  });

  return {
    element: overlay,
    close,
    destroy: close,
    get isOpen() { return open; },
  };
}

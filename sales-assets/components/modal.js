import { escapeHtml } from './html.js';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function setContent(target, content) {
  if (content && typeof content === 'object' && typeof content.nodeType === 'number') {
    target.replaceChildren(content);
  } else {
    target.textContent = String(content ?? '');
  }
}

export function createModal({
  document: ownerDocument = globalThis.document,
  portal,
  title = '',
  content = '',
  closeLabel = '关闭',
  closeOnBackdrop = true,
  onClose = () => {},
} = {}) {
  if (!ownerDocument?.createElement) throw new TypeError('createModal requires a document');
  const host = portal || ownerDocument.getElementById('modalPortal') || ownerDocument.body;
  const previousFocus = ownerDocument.activeElement;
  const overlay = ownerDocument.createElement('div');
  overlay.className = 'overlay modal-overlay';
  overlay.innerHTML = `<section class="modular-dialog" role="dialog" aria-modal="true" tabindex="-1" aria-label="${escapeHtml(title || '对话框')}">
    <header><h2></h2><button class="icon-button" type="button" data-close aria-label="${escapeHtml(closeLabel)}">&times;</button></header>
    <div class="modular-dialog-body"></div>
  </section>`;
  overlay.querySelector('h2').textContent = title;
  setContent(overlay.querySelector('.modular-dialog-body'), content);
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
    const focusable = [...overlay.querySelectorAll(FOCUSABLE)];
    if (!focusable.length) {
      event.preventDefault();
      overlay.querySelector('.modular-dialog').focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
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
    else if (closeOnBackdrop && event.target === overlay) close('backdrop');
  });
  ownerDocument.addEventListener('keydown', onKeydown);
  host.append(overlay);
  queueMicrotask(() => {
    if (!open) return;
    (overlay.querySelector(FOCUSABLE) || overlay.querySelector('.modular-dialog'))?.focus();
  });

  return {
    element: overlay,
    close,
    destroy: close,
    get isOpen() { return open; },
  };
}

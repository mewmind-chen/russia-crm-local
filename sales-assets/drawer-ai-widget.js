(function initTradePulseDrawerAiWidget(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseDrawerAiWidget = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character]);
  }

  function renderCustomerAiSectionHtml(context = {}) {
    if (!context.enabled || !context.canUseAi) return '';
    return `<section class="customer-ai">
      <div class="insight-head"><div><p class="eyebrow">CUSTOMER AI</p><h3>AI 问答</h3></div><span class="ai-badge">当前客户 · ${escapeHtml(context.companyName || '未命名客户')}</span></div>
      <div class="customer-ai-body">
        <div id="drawerAiAnswer" class="customer-ai-answer">可以直接询问客户价值、风险、联系人、开发切入点和下一步动作。</div>
        <form id="drawerAiForm" class="customer-ai-form">
          <textarea name="message" rows="2" placeholder="围绕这个客户提问，例如：下一步最值得做什么？" required></textarea>
          <button class="button primary" type="submit">发送</button>
        </form>
      </div>
    </section>`;
  }

  function render(container, context = {}) {
    if (!container) return '';
    const html = renderCustomerAiSectionHtml(context);
    container.innerHTML = html;
    return html;
  }

  return Object.freeze({
    escapeHtml,
    renderCustomerAiSectionHtml,
    render,
  });
}));

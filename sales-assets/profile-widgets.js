(function initProfileWidgets(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TradePulseProfileWidgets = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败：${response.status}`);
    return payload;
  }

  function profileEndpoint(customerId, intakeItemId) {
    return intakeItemId
      ? `/api/sales-crm/intake/${encodeURIComponent(intakeItemId)}/profile`
      : `/api/sales-crm/profile/${encodeURIComponent(customerId)}`;
  }

  function contactCard(contact, canMaintain) {
    const methods = [contact.phone, contact.email, contact.social].filter(Boolean);
    const editable = canMaintain && contact.source === 'manual';
    const flags = [contact.matchStatusLabel, contact.procurementRoleLabel].filter(Boolean);
    return `<article class="profile-widget-contact-card">
      <div class="profile-widget-contact-head">
        <div><strong>${escapeHtml(contact.name || '未命名联系人')}</strong>
          <span class="profile-widget-contact-meta">${escapeHtml([contact.title, contact.department].filter(Boolean).join(' · ') || '职位未标注')}</span>
        </div>
        <span class="profile-widget-pill">${escapeHtml(contact.sourceLabel || (contact.source === 'recon' ? '联系人研究' : '人工录入'))}</span>
      </div>
      <div class="profile-widget-contact-methods">${methods.length
        ? methods.map(value => `<span>${escapeHtml(value)}</span>`).join('<span>·</span>')
        : '<span class="profile-widget-muted">暂无联系方式</span>'}</div>
      ${flags.length || contact.workContent ? `<div class="profile-widget-contact-flags">${flags.map(flag => `<span class="profile-widget-pill ${contact.matchStatus === 'mismatch' || contact.procurementRole === 'no' ? 'muted' : ''}">${escapeHtml(flag)}</span>`).join('')}${contact.workContent ? `<span class="profile-widget-muted">${escapeHtml(contact.workContent)}</span>` : ''}</div>` : ''}
      ${editable ? `<div class="profile-widget-contact-actions"><button class="button secondary tiny" type="button" data-profile-widget-contact-edit="${escapeHtml(contact.id)}">编辑</button><button class="button danger tiny" type="button" data-profile-widget-contact-archive="${escapeHtml(contact.id)}">归档</button></div>` : ''}
    </article>`;
  }

  function renderContacts({ root, profile, customerId, editingId = '' }) {
    if (!root) return;
    const contacts = Array.isArray(profile.accountContacts) ? profile.accountContacts : [];
    const master = profile.customerPool?.[0] || {};
    const canMaintain = Boolean(profile.contactAccess?.canMaintain);
    const masterMethods = [master.email, master.phone].filter(Boolean);
    const editing = contacts.find(item => item.id === editingId);
    const formHtml = editingId
      ? `<form class="profile-widget-contact-form" data-profile-widget-contact-form>
          <input type="hidden" name="contactId" value="${escapeHtml(editing?.id || '')}">
          <div class="profile-widget-form-grid">
            <label>姓名<input name="name" value="${escapeHtml(editing?.name || '')}" required maxlength="160"></label>
            <label>职位<input name="title" value="${escapeHtml(editing?.title || '')}" maxlength="160"></label>
            <label>电话<input name="phone" value="${escapeHtml(editing?.phone || '')}" maxlength="200"></label>
            <label>邮箱<input name="email" type="email" value="${escapeHtml(editing?.email || '')}" maxlength="320"></label>
            <label class="span-2">WhatsApp / Telegram / LinkedIn<input name="social" value="${escapeHtml(editing?.social || '')}" maxlength="1000"></label>
          </div>
          <div class="profile-widget-form-actions">
            <span class="profile-widget-form-status" data-profile-widget-form-status aria-live="polite"></span>
            <button class="button secondary tiny" type="button" data-profile-widget-contact-cancel>取消</button>
            <button class="button primary tiny" type="submit">保存联系人</button>
          </div>
        </form>`
      : '';
    root.className = 'profile-widget profile-widget-contacts';
    root.innerHTML = `
      <div class="profile-widget-head">
        <div><p class="eyebrow">CONTACT ASSETS</p><h3>联系人资产</h3></div>
        ${canMaintain ? '<button class="button secondary tiny" type="button" data-profile-widget-contact-add>新增联系人</button>' : ''}
      </div>
      <div class="profile-widget-body">
        <div class="profile-widget-master-channels"><strong>客户主档联系渠道</strong><span>${masterMethods.length ? escapeHtml(masterMethods.join(' · ')) : '主档暂无邮箱或电话'}</span></div>
        ${formHtml}
        <div class="profile-widget-contact-list">${contacts.length
          ? contacts.map(item => contactCard(item, canMaintain)).join('')
          : '<div class="profile-widget-empty">暂无联系人记录</div>'}</div>
      </div>`;
  }

  async function loadProfile(customerId, intakeItemId) {
    return request(profileEndpoint(customerId, intakeItemId));
  }

  function mountContacts(container, options = {}) {
    if (!container) return;
    const state = { customerId: options.customerId || '', intakeItemId: options.intakeItemId || '', profile: null, editingId: '' };
    const root = container;
    root.innerHTML = '<div class="profile-widget-empty">正在加载联系人…</div>';
    loadProfile(state.customerId, state.intakeItemId)
      .then(profile => {
        state.profile = profile;
        if (!profile.contactAccess?.canView) {
          root.className = 'profile-widget';
          root.innerHTML = '<div class="profile-widget-empty">当前账号无权查看联系人</div>';
          return;
        }
        renderContacts({ root, profile, customerId: state.customerId, editingId: state.editingId });
      })
      .catch(error => {
        root.className = 'profile-widget';
        root.innerHTML = `<div class="profile-widget-empty">${escapeHtml(error.message || '联系人加载失败')}</div>`;
      });

    root.addEventListener('click', async event => {
      const add = event.target.closest('[data-profile-widget-contact-add]');
      if (add) {
        state.editingId = '__new__';
        renderContacts({ root, profile: state.profile, customerId: state.customerId, editingId: state.editingId });
        root.querySelector('[data-profile-widget-contact-form] input[name="name"]')?.focus();
        return;
      }
      const cancel = event.target.closest('[data-profile-widget-contact-cancel]');
      if (cancel) {
        state.editingId = '';
        renderContacts({ root, profile: state.profile, customerId: state.customerId });
        return;
      }
      const edit = event.target.closest('[data-profile-widget-contact-edit]');
      if (edit) {
        state.editingId = edit.dataset.profileWidgetContactEdit;
        renderContacts({ root, profile: state.profile, customerId: state.customerId, editingId: state.editingId });
        root.querySelector('[data-profile-widget-contact-form] input[name="name"]')?.focus();
        return;
      }
      const archive = event.target.closest('[data-profile-widget-contact-archive]');
      if (archive) {
        if (!confirm('归档后默认不再展示，历史和审计记录仍会保留。确认归档？')) return;
        const button = archive;
        button.disabled = true;
        try {
          await request(`/api/sales-crm/contacts/${encodeURIComponent(archive.dataset.profileWidgetContactArchive)}/archive`, {
            method: 'POST', body: '{}',
          });
          state.profile = await loadProfile(state.customerId, state.intakeItemId);
          renderContacts({ root, profile: state.profile, customerId: state.customerId });
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
        return;
      }
    });

    root.addEventListener('submit', async event => {
      const form = event.target.closest('[data-profile-widget-contact-form]');
      if (!form) return;
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const contactId = String(values.contactId || '');
      delete values.contactId;
      values.customerId = state.profile?.profileAccess?.accountId || '';
      values.externalCustomerId = state.customerId;
      const button = form.querySelector('[type="submit"]');
      const status = form.querySelector('[data-profile-widget-form-status]');
      button.disabled = true;
      if (status) status.textContent = '保存中…';
      try {
        await request(contactId
          ? `/api/sales-crm/contacts/${encodeURIComponent(contactId)}`
          : '/api/sales-crm/contacts', {
          method: contactId ? 'PATCH' : 'POST',
          body: JSON.stringify(values),
        });
        state.editingId = '';
        state.profile = await loadProfile(state.customerId, state.intakeItemId);
        renderContacts({ root, profile: state.profile, customerId: state.customerId });
      } catch (error) {
        if (status) status.textContent = error.message || '保存失败';
        button.disabled = false;
      }
    });
  }

  return Object.freeze({
    mountContacts,
    loadProfile,
    renderContacts,
    profileEndpoint,
  });
}));

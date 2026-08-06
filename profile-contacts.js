(() => {
  'use strict';

  if (!document.body.classList.contains('profile-mode')) return;

  const params = new URLSearchParams(location.search);
  const customerId = String(params.get('customer') || '').trim();
  const intakeItemId = String(params.get('intake') || '').trim();
  if (!customerId && !intakeItemId) return;

  let profile = null;
  let editingId = '';

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `请求失败：${response.status}`);
    return payload;
  }

  function endpoint() {
    return intakeItemId
      ? `/api/sales-crm/intake/${encodeURIComponent(intakeItemId)}/profile`
      : `/api/sales-crm/profile/${encodeURIComponent(customerId)}`;
  }

  function installTab() {
    const tabs = document.querySelector('#detailTabs');
    const overview = document.querySelector('#detailPaneOverview');
    if (!tabs || !overview || document.querySelector('[data-detail-tab="contacts"]')) return;
    const tab = document.createElement('button');
    tab.className = 'modal-tab';
    tab.type = 'button';
    tab.dataset.detailTab = 'contacts';
    tab.textContent = '联系人';
    tabs.querySelector('[data-detail-tab="overview"]')?.after(tab);
    const pane = document.createElement('section');
    pane.className = 'detail-pane';
    pane.id = 'detailPaneContacts';
    pane.innerHTML = '<div id="profileContactsPanel" class="empty">正在加载联系人...</div>';
    overview.after(pane);
    pane.addEventListener('click', handleClick);
    pane.addEventListener('submit', handleSubmit);
  }

  function contactForm(contact = {}) {
    return `<form id="profileContactForm" class="contact-editor edit-grid">
      <input type="hidden" name="contactId" value="${escapeHtml(contact.id || '')}">
      <div class="field"><label>姓名</label><input class="input" name="name" value="${escapeHtml(contact.name || '')}" required maxlength="160"></div>
      <div class="field"><label>职位</label><input class="input" name="title" value="${escapeHtml(contact.title || '')}" maxlength="160"></div>
      <div class="field"><label>部门</label><input class="input" name="department" value="${escapeHtml(contact.department || '')}" maxlength="160"></div>
      <div class="field"><label>电话</label><input class="input" name="phone" value="${escapeHtml(contact.phone || '')}" maxlength="200"></div>
      <div class="field"><label>邮箱</label><input class="input" name="email" type="email" value="${escapeHtml(contact.email || '')}" maxlength="320"></div>
      <div class="field"><label>WhatsApp / Telegram / LinkedIn</label><input class="input" name="social" value="${escapeHtml(contact.social || '')}" maxlength="1000"></div>
      <div class="field"><label>对口情况</label><select class="input" name="matchStatus"><option value="pending" ${(contact.matchStatus || 'pending') === 'pending' ? 'selected' : ''}>待确认</option><option value="match" ${contact.matchStatus === 'match' ? 'selected' : ''}>对口</option><option value="mismatch" ${contact.matchStatus === 'mismatch' ? 'selected' : ''}>不对口</option></select></div>
      <div class="field"><label>采购职责</label><select class="input" name="procurementRole"><option value="pending" ${(contact.procurementRole || 'pending') === 'pending' ? 'selected' : ''}>待确认</option><option value="yes" ${contact.procurementRole === 'yes' ? 'selected' : ''}>负责采购</option><option value="no" ${contact.procurementRole === 'no' ? 'selected' : ''}>不负责采购</option></select></div>
      <div class="field wide"><label>工作内容</label><input class="input" name="workContent" maxlength="240" placeholder="老板，负责采购与供应商审批" value="${escapeHtml(contact.workContent || '')}"></div>
      <div class="tag-editor-actions wide"><button class="btn ghost" type="button" data-contact-cancel>取消</button><button class="btn" type="submit">保存联系人</button></div>
    </form>`;
  }

  function contactCard(contact, canMaintain) {
    const methods = [contact.phone, contact.email, contact.social].filter(Boolean);
    const editable = canMaintain && contact.source === 'manual';
    return `<article class="contact-asset-card">
      <div class="contact-asset-head"><div><h3>${escapeHtml(contact.name || '未命名联系人')}</h3><p class="muted">${escapeHtml([contact.title, contact.department].filter(Boolean).join(' · ') || '职位未标注')}</p></div><span class="tag">${escapeHtml(contact.sourceLabel || (contact.source === 'recon' ? '联系人研究' : '人工录入'))}</span></div>
      <div class="contact-asset-methods">${methods.length ? methods.map(value => `<span>${escapeHtml(value)}</span>`).join('<span>·</span>') : '<span class="muted">暂无联系方式</span>'}</div>
      ${contact.matchStatusLabel || contact.procurementRoleLabel || contact.workContent ? `<div class="contact-asset-flags"><span class="tag ${contact.matchStatus === 'mismatch' ? 'gray' : ''}">${escapeHtml(contact.matchStatusLabel || '待确认')}</span><span class="tag ${contact.procurementRole === 'no' ? 'gray' : ''}">${escapeHtml(contact.procurementRoleLabel || '待确认')}</span>${contact.workContent ? `<span class="muted">${escapeHtml(contact.workContent)}</span>` : ''}</div>` : ''}
      <div class="contact-asset-meta"><span class="muted">联系人编号 ${escapeHtml(contact.id)}</span>${contact.updatedAt ? `<span class="muted">更新 ${escapeHtml(contact.updatedAt)}</span>` : ''}</div>
      ${editable ? `<div class="contact-asset-actions"><button class="btn secondary small" type="button" data-contact-edit="${escapeHtml(contact.id)}">编辑</button><button class="btn ghost small" type="button" data-contact-archive="${escapeHtml(contact.id)}">归档</button></div>` : ''}
    </article>`;
  }

  function render() {
    const root = document.querySelector('#profileContactsPanel');
    if (!root || !profile) return;
    const contacts = profile.accountContacts || [];
    const master = profile.customerPool?.[0] || {};
    const canMaintain = Boolean(profile.contactAccess?.canMaintain);
    const masterMethods = [master.email, master.phone].filter(Boolean);
    const editing = contacts.find(item => item.id === editingId);
    root.className = '';
    root.innerHTML = `<section class="detail-section">
      <h3>联系人资产</h3>
      <div style="padding:14px;display:grid;gap:12px">
        <div class="contact-asset-head"><div><strong>客户主档联系渠道</strong><p class="muted">${masterMethods.length ? escapeHtml(masterMethods.join(' · ')) : '主档暂无邮箱或电话'}</p></div>${canMaintain ? '<button class="btn small" type="button" data-contact-add>新增联系人</button>' : ''}</div>
        ${editingId ? contactForm(editing || {}) : ''}
        <div class="contact-asset-list">${contacts.length ? contacts.map(item => contactCard(item, canMaintain)).join('') : '<div class="empty">暂无联系人记录</div>'}</div>
      </div>
    </section>`;
    const channelHeading = [...document.querySelectorAll('#detailPaneOverview h3')]
      .find(node => node.textContent.trim() === '联系渠道');
    if (channelHeading && !channelHeading.querySelector('[data-open-contact-assets]')) {
      channelHeading.insertAdjacentHTML('beforeend', ' <button class="btn ghost small" type="button" data-open-contact-assets>查看联系人</button>');
      channelHeading.querySelector('[data-open-contact-assets]').addEventListener('click', () => {
        document.querySelector('[data-detail-tab="contacts"]')?.click();
      });
    }
  }

  async function load() {
    profile = await request(endpoint());
    if (!profile.contactAccess?.canView) {
      document.querySelector('[data-detail-tab="contacts"]')?.remove();
      document.querySelector('#detailPaneContacts')?.remove();
      return;
    }
    render();
  }

  async function handleSubmit(event) {
    if (event.target.id !== 'profileContactForm') return;
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form).entries());
    const contactId = String(values.contactId || '');
    delete values.contactId;
    const accountId = profile?.profileAccess?.accountId || '';
    values.customerId = accountId;
    values.externalCustomerId = customerId;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = '保存中...';
    try {
      await request(contactId
        ? `/api/sales-crm/contacts/${encodeURIComponent(contactId)}`
        : '/api/sales-crm/contacts', {
        method: contactId ? 'PATCH' : 'POST',
        body: JSON.stringify(values),
      });
      editingId = '';
      await load();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = '保存联系人';
    }
  }

  async function handleClick(event) {
    if (event.target.closest('[data-contact-add]')) {
      editingId = '__new__';
      render();
      document.querySelector('#profileContactForm input[name="name"]')?.focus();
      return;
    }
    if (event.target.closest('[data-contact-cancel]')) {
      editingId = '';
      render();
      return;
    }
    const edit = event.target.closest('[data-contact-edit]');
    if (edit) {
      editingId = edit.dataset.contactEdit;
      render();
      document.querySelector('#profileContactForm input[name="name"]')?.focus();
      return;
    }
    const archive = event.target.closest('[data-contact-archive]');
    if (!archive || !confirm('归档后默认不再展示，历史和审计记录仍会保留。确认归档？')) return;
    try {
      await request(`/api/sales-crm/contacts/${encodeURIComponent(archive.dataset.contactArchive)}/archive`, {
        method: 'POST', body: '{}',
      });
      editingId = '';
      await load();
    } catch (error) { alert(error.message); }
  }

  installTab();
  load().catch(error => {
    const root = document.querySelector('#profileContactsPanel');
    if (root) root.innerHTML = `<div class="empty">${escapeHtml(error.message || '联系人加载失败')}</div>`;
  });
})();

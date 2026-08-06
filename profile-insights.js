(() => {
  'use strict';

  if (!document.body.classList.contains('profile-mode')) return;

  const params = new URLSearchParams(location.search);
  const customerId = String(params.get('customer') || '').trim();
  const intakeItemId = String(params.get('intake') || '').trim();
  if (!customerId && !intakeItemId) return;

  let profile = null;
  let formMode = '';

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;').replace(/'/g, '&#039;');

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
    if (!tabs || !overview || document.querySelector('[data-detail-tab="insights"]')) return;
    const tab = document.createElement('button');
    tab.className = 'modal-tab';
    tab.type = 'button';
    tab.dataset.detailTab = 'insights';
    tab.textContent = '经理评价';
    (tabs.querySelector('[data-detail-tab="contacts"]') || tabs.querySelector('[data-detail-tab="overview"]'))
      ?.after(tab);
    const pane = document.createElement('section');
    pane.className = 'detail-pane';
    pane.id = 'detailPaneInsights';
    pane.innerHTML = '<div id="profileInsightsPanel" class="empty">正在加载经理评价...</div>';
    (document.querySelector('#detailPaneContacts') || overview).after(pane);
    pane.addEventListener('click', handleClick);
    pane.addEventListener('submit', handleSubmit);
  }

  function evaluationCard(item) {
    const target = item.subjectType === 'company'
      ? '企业评价'
      : `${item.subjectName || '联系人'}${item.subjectTitle ? ` · ${item.subjectTitle}` : ''}`;
    return `<article class="profile-insight-card">
      <div class="profile-insight-meta"><strong>${escapeHtml(target)}</strong><span>${escapeHtml(item.authorName || '经理')} · ${escapeHtml(item.createdAt || '')}</span></div>
      <p class="profile-insight-text">${escapeHtml(item.evaluationText || '—')}</p>
    </article>`;
  }

  function contactLabel(contact) {
    return `${contact.name || '未命名联系人'}${contact.title ? ` · ${contact.title}` : ''}${contact.sourceLabel ? ` · ${contact.sourceLabel}` : ''}`;
  }

  function renderForm(mode, contacts, canManage) {
    if (!canManage || formMode !== mode) return '';
    const contactRequired = mode === 'contact';
    return `<form id="profileEvaluationForm" class="profile-insight-form" data-mode="${mode}">
      ${contactRequired ? `<label>关联联系人<select name="subjectId" required><option value="">请选择联系人</option>${contacts.map(contact => `<option value="${escapeHtml(contact.id)}">${escapeHtml(contactLabel(contact))}</option>`).join('')}</select></label>` : '<p class="muted">评价对象：当前企业</p>'}
      <label>经理评价<textarea name="evaluationText" required minlength="8" placeholder="记录采购权、决策角色、合作判断和后续策略"></textarea></label>
      <div class="profile-insight-form-actions"><button class="btn ghost" type="button" data-evaluation-cancel>取消</button><button class="btn" type="submit">保存评价</button></div>
      <p class="profile-insight-status" data-profile-insight-status aria-live="polite"></p>
    </form>`;
  }

  function render() {
    const root = document.querySelector('#profileInsightsPanel');
    if (!root || !profile) return;
    const access = profile.insightAccess || {};
    const insights = profile.insights || { contacts: [], evaluations: [] };
    const contacts = Array.isArray(insights.contacts) ? insights.contacts : [];
    const evaluations = Array.isArray(insights.evaluations) ? insights.evaluations : [];
    const canManage = Boolean(access.canManage);
    const companyEvaluations = evaluations.filter(item => item.subjectType === 'company');
    const contactMap = new Map(contacts.map(contact => [String(contact.id), contact]));
    const contactGroups = new Map();
    evaluations.filter(item => item.subjectType === 'contact').forEach(item => {
      const key = String(item.subjectId || `missing:${item.id}`);
      const group = contactGroups.get(key) || { contact: contactMap.get(key) || item, items: [] };
      group.items.push(item);
      contactGroups.set(key, group);
    });
    const companySection = `<section class="detail-section profile-insight-section">
      <div class="profile-insight-heading"><h3>企业评价</h3>${canManage ? '<button class="btn small" type="button" data-evaluation-new="company">新增企业评价</button>' : ''}</div>
      <div class="profile-insight-body">${companyEvaluations.length ? companyEvaluations.map(evaluationCard).join('') : '<div class="empty">暂无企业评价</div>'}</div>
      ${renderForm('company', contacts, canManage)}
    </section>`;
    const contactSection = `<section class="detail-section profile-insight-section">
      <div class="profile-insight-heading"><div><h3>联系人评价</h3><p class="muted">评价采购、采购主管、老板等具体对接人</p></div>${canManage && contacts.length ? '<button class="btn small" type="button" data-evaluation-new="contact">新增联系人评价</button>' : ''}</div>
      <div class="profile-insight-body">${contactGroups.size ? [...contactGroups.values()].map(group => `<div class="profile-insight-contact-group"><div class="profile-insight-contact-heading"><strong>${escapeHtml(group.contact.name || '历史联系人')}</strong><span>${escapeHtml([group.contact.title, group.contact.sourceLabel].filter(Boolean).join(' · ') || '联系人')}</span></div>${group.items.map(evaluationCard).join('')}</div>`).join('') : '<div class="empty">暂无联系人评价</div>'}</div>
      ${!contacts.length ? '<p class="muted profile-insight-hint">暂无可关联联系人，请先到“联系人”页签新增联系人或补充联系人研究。</p>' : ''}
      ${renderForm('contact', contacts, canManage)}
    </section>`;
    root.className = '';
    root.innerHTML = `${companySection}${contactSection}`;
  }

  async function load() {
    profile = await request(endpoint());
    if (!profile.insightAccess?.canView) {
      document.querySelector('[data-detail-tab="insights"]')?.remove();
      document.querySelector('#detailPaneInsights')?.remove();
      return;
    }
    render();
  }

  function setStatus(form, message) {
    const status = form.querySelector('[data-profile-insight-status]');
    if (status) status.textContent = message;
  }

  async function handleSubmit(event) {
    if (event.target.id !== 'profileEvaluationForm') return;
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form).entries());
    const mode = form.dataset.mode;
    const contact = mode === 'contact'
      ? (profile.insights?.contacts || []).find(item => item.id === values.subjectId)
      : null;
    if (mode === 'contact' && !contact) return setStatus(form, '请选择当前客户下的有效联系人');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setStatus(form, '保存中...');
    try {
      await request('/api/sales-crm/evaluations', {
        method: 'POST',
        body: JSON.stringify({
          customerId: profile.profileAccess?.accountId || '',
          subjectType: mode,
          subjectId: contact?.id || '',
          subjectName: contact?.name || '',
          subjectTitle: contact?.title || '',
          evaluationText: values.evaluationText,
        }),
      });
      formMode = '';
      await load();
    } catch (error) {
      setStatus(form, error.message || '评价保存失败');
      button.disabled = false;
    }
  }

  function handleClick(event) {
    const newButton = event.target.closest('[data-evaluation-new]');
    if (newButton) {
      formMode = newButton.dataset.evaluationNew;
      render();
      document.querySelector('#profileEvaluationForm textarea')?.focus();
      return;
    }
    if (event.target.closest('[data-evaluation-cancel]')) {
      formMode = '';
      render();
    }
  }

  installTab();
  load().catch(error => {
    const root = document.querySelector('#profileInsightsPanel');
    if (root) root.innerHTML = `<div class="empty">${escapeHtml(error.message || '经理评价加载失败')}</div>`;
  });
})();

(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const state = {
    data: null,
    view: 'dashboard',
    selectedCustomerId: '',
    alertSeverity: '',
    intakeStatus: '',
    teamUserId: '',
    activityType: 'email',
  };

  const viewMeta = {
    dashboard: ['MANAGEMENT OVERVIEW', '经营驾驶舱'],
    intake: ['DAILY LEAD DELIVERY', '未开发线索分配'],
    customers: ['CRM CUSTOMER PORTFOLIO', 'CRM客户全景'],
    development: ['CUSTOMER DEVELOPMENT', '客户开发工作台'],
    pool: ['UNDEVELOPED LEAD POOL', '未开发线索池'],
    contacts: ['CONTACT EVIDENCE', '负责人线索'],
    recon: ['RECON INTELLIGENCE', 'Recon 情报'],
    pipeline: ['PIPELINE CONTROL', '推进管道'],
    alerts: ['EXCEPTION MANAGEMENT', '异常与介入'],
    insights: ['MANAGER INTELLIGENCE', '经理评价'],
    team: ['CAPABILITY REVIEW', '销售能力'],
    markets: ['MARKET INTELLIGENCE', '市场策略'],
    users: ['ACCESS CONTROL', '用户与权限'],
  };
  const activityMeta = {
    note: ['记录', '记'], qualification: ['资格判断', '筛'], email: ['发送邮件', '邮'], call: ['电话开发', '电'],
    social: ['社媒联系', '社'], reply: ['客户回复', '回'], meeting: ['视频/电话会议', '会'],
    manager_join: ['管理者介入', '管'], rfq: ['收到询价', '询'], quote: ['发送报价', '报'],
    negotiation: ['商务谈判', '谈'], order: ['首次下单', '单'], repeat_order: ['复购', '复'], lost: ['暂停/流失', '停'],
  };
  const capabilityLabels = {
    activation: '资源激活', outreach: '开发破冰', relationship: '关系建立', discovery: '需求挖掘',
    professional: '专业能力', conversion: '商务转化', retention: '客户经营', execution: '执行纪律', collaboration: '协作承接',
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function jsonList(value) {
    try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (_e) { return []; }
  }
  function money(value, currency = 'USD') {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
  }
  function shortDate(value, withTime = false) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', withTime ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'numeric', day: 'numeric' }).format(date);
  }
  function relative(value) {
    if (!value) return '暂无记录';
    const time = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).getTime();
    const hours = Math.max(0, Math.round((Date.now() - time) / 3600000));
    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }
  function dateInput(days = 1) {
    const d = new Date(Date.now() + days * 86400000);
    return d.toISOString().slice(0, 16);
  }
  function apiTime(value) {
    return value ? String(value).replace('T', ' ') + (String(value).length === 16 ? ':00' : '') : '';
  }
  function stageLabel(key) {
    return state.data?.stages.find(item => item.key === key)?.label || key || '—';
  }
  function userById(id) {
    return state.data?.users.find(user => user.id === id);
  }
  function can(permission) {
    return Boolean(state.data?.user?.permissions?.[permission]);
  }
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2300);
  }
  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.error || '请求失败');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function load() {
    try {
      state.data = await api('/api/sales-crm/bootstrap');
      $('#loginScreen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      applyUser();
      populateFilters();
      renderAll();
      const requestedView = location.hash.replace(/^#/, '');
      const firstAllowedView = Object.keys(viewMeta).find(view => can(`view_${view}`)) || 'dashboard';
      switchView(viewMeta[requestedView] && can(`view_${requestedView}`) ? requestedView : firstAllowedView, false);
      if (state.data.user.mustChangePassword) setTimeout(openPasswordModal, 80);
    } catch (error) {
      if (error.status === 401) {
        $('#app').classList.add('hidden');
        $('#loginScreen').classList.remove('hidden');
      } else {
        toast(error.message);
      }
    }
  }

  function applyUser() {
    const user = state.data.user;
    $('#userName').textContent = user.name;
    $('#userRole').textContent = ({ admin: '系统管理员', manager: '销售经理', sales: '销售代表' })[user.role];
    $('#userAvatar').textContent = user.name.slice(0, 1);
    $$('[data-permission]').forEach(el => el.classList.toggle('hidden', !can(el.dataset.permission)));
    $$('#nav .nav-group').forEach(group => {
      const buttons = $$('button[data-view]').filter(button => group.contains(button));
      group.classList.toggle('hidden', buttons.length > 0 && buttons.every(button => button.classList.contains('hidden')));
    });
    $('#ownerFilter').classList.toggle('hidden', !can('view_all_customers'));
  }

  function populateFilters() {
    const country = $('#countryFilter').value;
    const owner = $('#ownerFilter').value;
    const countries = [...new Set(state.data.accounts.map(item => item.country).filter(Boolean))].sort();
    $('#countryFilter').innerHTML = '<option value="">全部国家</option>' + countries.map(item => `<option>${esc(item)}</option>`).join('');
    $('#countryFilter').value = country;
    $('#ownerFilter').innerHTML = '<option value="">全部销售</option>' + state.data.users.filter(user => user.role === 'sales').map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
    $('#ownerFilter').value = owner;
    $('#stageFilter').innerHTML = '<option value="">全部阶段</option>' + state.data.stages.map(stage => `<option value="${stage.key}">${esc(stage.label)}</option>`).join('');
  }

  function scopedAccounts() {
    const country = $('#countryFilter')?.value || '';
    const owner = $('#ownerFilter')?.value || '';
    return state.data.accounts.filter(account => (!country || account.country === country) && (!owner || account.owner_id === owner));
  }
  function alertFor(customerId) {
    return state.data.alerts.find(alert => alert.customerId === customerId);
  }
  function filteredActivities(accounts = scopedAccounts()) {
    const ids = new Set(accounts.map(item => item.id));
    const days = Number($('#periodFilter')?.value || 90);
    const cutoff = Date.now() - days * 86400000;
    return state.data.activities.filter(item => ids.has(item.customer_id) && new Date(String(item.occurred_at).replace(' ', 'T') + 'Z').getTime() >= cutoff);
  }

  function renderAll() {
    $('#navCustomerCount').textContent = state.data.accounts.length;
    $('#navAlertCount').textContent = state.data.alerts.filter(item => item.severity === 'critical').length;
    $('#navIntakeCount').textContent = (state.data.intake?.stats.assigned || 0) + (state.data.intake?.stats.pending || 0) + (state.data.intake?.stats.approved || 0);
    $('#navInsightCount').textContent = state.data.insights?.evaluations.length || 0;
    $('#navPoolCount').textContent = state.data.customerPool?.length || 0;
    $('#navPeopleCount').textContent = state.data.people?.length || 0;
    $('#lastRefresh').textContent = `更新于 ${shortDate(state.data.generatedAt, true)}`;
    renderDashboard();
    renderIntake();
    renderCustomers();
    renderDevelopment();
    renderUnifiedPool();
    renderUnifiedPeople();
    renderUnifiedRecon();
    renderPipeline();
    renderAlerts();
    renderInsightsHub();
    renderTeam();
    renderMarkets();
    renderUsers();
    if (state.selectedCustomerId && state.data.accounts.some(item => item.id === state.selectedCustomerId)) renderDrawer();
  }

  function computeSummary(accounts) {
    const ids = new Set(accounts.map(item => item.id));
    const atLeast = stage => {
      const order = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
      return accounts.filter(item => item.stage !== 'lost' && order[item.stage] >= order[stage]).length;
    };
    const rfqs = state.data.rfqs.filter(item => ids.has(item.customer_id));
    const quotes = state.data.quotes.filter(item => ids.has(item.customer_id));
    const orders = state.data.orders.filter(item => ids.has(item.customer_id));
    const alerts = state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId));
    return {
      accounts: accounts.length, contacted: atLeast('contacted'), replies: atLeast('replied'), meetings: atLeast('meeting'),
      rfqs: rfqs.length, quotes: quotes.length, orders: orders.length,
      overdue: alerts.filter(item => item.code === 'OVERDUE').length,
      managerNeeded: alerts.filter(item => item.code === 'MANAGER_NEEDED').length,
      revenue: orders.reduce((sum, item) => sum + Number(item.amount), 0),
    };
  }

  function renderDashboard() {
    const accounts = scopedAccounts();
    const summary = computeSummary(accounts);
    const cards = [
      ['未开发线索', state.data.customerPool?.filter(item => !item.in_crm).length || 0, '等待每日分配', ''],
      ['CRM客户', summary.accounts, '已领取并开始开发', ''],
      ['获得回复', summary.replies, `触达后 ${percent(summary.replies, summary.contacted)}`, ''],
      ['深度会议', summary.meetings, `回复后 ${percent(summary.meetings, summary.replies)}`, ''],
      ['正式询价', summary.rfqs, `会议后 ${percent(summary.rfqs, summary.meetings)}`, ''],
      ['成交订单', summary.orders, money(summary.revenue), ''],
      ['超期 / 待介入', `${summary.overdue} / ${summary.managerNeeded}`, '优先处理', summary.overdue ? 'alert' : 'warn'],
    ];
    $('#summaryCards').innerHTML = cards.map(([label, value, note, cls]) => `<article class="metric ${cls}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    const stageOrder = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
    const funnelStages = state.data.stages.filter(item => !['new', 'lost'].includes(item.key));
    const funnel = funnelStages.map(stage => ({
      ...stage, count: accounts.filter(account => account.stage !== 'lost' && stageOrder[account.stage] >= stageOrder[stage.key]).length,
    }));
    const max = Math.max(1, funnel[0]?.count || 1);
    $('#funnelChart').innerHTML = funnel.map((item, index) => {
      const previous = index ? funnel[index - 1].count : accounts.length;
      return `<div class="funnel-row" data-stage-jump="${item.key}">
        <span class="funnel-label">${esc(item.label)}</span><div class="funnel-track"><div class="funnel-bar" style="width:${item.count / max * 100}%"></div></div>
        <span class="funnel-count">${item.count}</span><span class="funnel-rate">${percent(item.count, previous)}</span>
      </div>`;
    }).join('');
    const ids = new Set(accounts.map(item => item.id));
    const attention = state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId)).slice(0, 5);
    $('#attentionList').innerHTML = attention.length ? attention.map(item => `<div class="attention-item" ${item.intakeItemId ? 'data-go="intake"' : `data-open-customer="${item.customerId}"`}>
      <i class="severity-dot ${item.severity}"></i><div><strong>${esc(item.companyName)}</strong><span>${esc(item.title)} · ${esc(item.detail)}</span></div><b>${item.severity === 'critical' ? '立即' : '关注'}</b>
    </div>`).join('') : '<div class="empty">当前没有需要处理的异常</div>';
    renderCountrySnapshot(accounts);
    const activities = filteredActivities(accounts).slice(0, 8);
    $('#activityFeed').innerHTML = activities.length ? activities.map(activity => {
      const account = state.data.accounts.find(item => item.id === activity.customer_id);
      const meta = activityMeta[activity.activity_type] || [activity.activity_type, '记'];
      return `<div class="feed-item" data-open-customer="${activity.customer_id}"><span class="feed-icon">${meta[1]}</span><div><strong>${esc(account?.company_name || '')} · ${esc(meta[0])}</strong><span>${esc(activity.user_name || '')} · ${esc(activity.summary || activity.outcome || '')} · ${relative(activity.occurred_at)}</span></div></div>`;
    }).join('') : '<div class="empty">当前周期没有有效动作</div>';
  }
  function percent(numerator, denominator) {
    return denominator ? `${Math.round(numerator / denominator * 1000) / 10}%` : '—';
  }
  function countryReportFor(accounts) {
    const names = new Set(accounts.map(item => item.country || '未标注'));
    return state.data.countryReport.filter(item => names.has(item.country));
  }
  function renderCountrySnapshot(accounts) {
    const rows = countryReportFor(accounts).slice(0, 5);
    $('#countrySnapshot').innerHTML = table(
      ['国家', '客户', '回复率', '询价率', '首单率', '单客毛利'],
      rows.map(row => [
        `<strong>${esc(row.country)}</strong>`, row.accounts, ratePill(row.replyRate), ratePill(row.rfqRate), ratePill(row.orderRate), money(row.valuePerAccount),
      ]),
    );
  }
  function ratePill(value) {
    return `<span class="pill ${value < 10 ? 'gray' : value > 35 ? '' : 'amber'}">${Number(value || 0).toFixed(1)}%</span>`;
  }
  function table(headers, rows, attrs = '') {
    if (!rows.length) return '<div class="empty">暂无符合条件的数据</div>';
    return `<table ${attrs}><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function renderUnifiedPool() {
    const root = $('#unifiedPoolTable');
    if (!root) return;
    const query = ($('#poolSearch')?.value || '').trim().toLowerCase();
    const group = $('#poolGroupFilter')?.value || '';
    const crm = $('#poolCrmFilter')?.value || '';
    const rows = (state.data.customerPool || []).filter(item => {
      const haystack = [item.customer_id,item.company_name,item.country,item.city,item.website,item.industry,item.customer_type,item.products].join(' ').toLowerCase();
      return (!query || haystack.includes(query))
        && (!group || (item.current_pool || '未分池') === group)
        && (!crm || (crm === 'crm' ? item.in_crm : !item.in_crm));
    });
    $('#poolResultCount').textContent = `${rows.length} 条未开发线索`;
    root.innerHTML = table(['线索企业','国家/行业','分组','联系人质量','线索状态','分配销售','资料'], rows.slice(0,500).map(item => [
      `<div class="company-cell"><strong>${esc(item.company_name || '未命名客户')}</strong><span>${esc(item.customer_id)} · ${esc(item.website || '无官网')}</span></div>`,
      `${esc(item.country || '未标注')}<br><span class="subtle">${esc(item.industry || '未标注')}</span>`,
      `<span class="pill ${item.current_pool === 'A' ? '' : 'gray'}">${esc(item.current_pool || '未分池')}</span>`,
      `<span class="pill ${item.best_contact_level === 'L3' ? '' : 'gray'}">${esc(item.best_contact_level || 'L0')}</span>`,
      item.in_crm
        ? `<button class="text-button" data-open-customer="${esc(item.crm_account_id)}">已进入CRM</button>`
        : `<span class="pill ${item.screening_risk_level === 'blocked' ? 'red' : 'gray'}">${esc(item.screening_risk_level === 'blocked' ? '风险冻结' : (({ pending: '待审核', approved: '待分配', assigned: '已分配待领取', returned: '已退回', rejected: '不对口' })[item.intake_status] || '待同步'))}</span>`,
      esc(item.owner_name || item.lead_owner_name || '未分配'),
      `<button class="text-button" data-open-master="${esc(item.customer_id)}">完整资料 →</button>`,
    ]));
  }

  function renderUnifiedPeople() {
    const root = $('#unifiedPeopleTable');
    if (!root) return;
    const query = ($('#peopleSearch')?.value || '').trim().toLowerCase();
    const level = $('#peopleLevelFilter')?.value || '';
    const companyMap = Object.fromEntries((state.data.customerPool || []).map(item => [item.customer_id, item.company_name]));
    const rows = (state.data.people || []).filter(item => {
      const haystack = [companyMap[item.customer_id],item.customer_id,item.name,item.title,item.department,item.methods_summary].join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (!level || item.contact_level === level);
    });
    $('#peopleResultCount').textContent = `${rows.length} 条线索`;
    root.innerHTML = table(['客户','联系人','职位/部门','等级','直接联系方式','证据状态'], rows.slice(0,500).map(item => [
      `<div class="company-cell"><strong>${esc(companyMap[item.customer_id] || item.customer_id)}</strong><span>${esc(item.customer_id)}</span></div>`,
      `<strong>${esc(item.name || '未识别')}</strong>`,
      `${esc(item.title || '未标注')}<br><span class="subtle">${esc(item.department || '')}</span>`,
      `<span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span>`,
      esc(item.methods_summary || '未找到直接联系方式'),
      item.sales_ready ? '<span class="good-text">可交付销售</span>' : '<span class="subtle">仍需验证</span>',
    ]));
  }

  function renderUnifiedRecon() {
    const root = $('#unifiedReconTable');
    if (!root) return;
    const query = ($('#reconSearch')?.value || '').trim().toLowerCase();
    const rows = (state.data.reconResults || []).filter(item =>
      !query || [item.company_name,item.customer_id,item.industry,item.customer_type,item.opportunity_summary,item.contacts_summary].join(' ').toLowerCase().includes(query));
    $('#reconResultCount').textContent = `${rows.length} 份结果`;
    root.innerHTML = table(['客户','评分/分组','客户画像','需求与机会','联系人','报告'], rows.slice(0,500).map(item => [
      `<div class="company-cell"><strong>${esc(item.company_name || item.customer_id)}</strong><span>${esc(item.customer_id)}</span></div>`,
      `<span class="pill">${esc(item.score || '—')} · ${esc(item.current_pool || '未分池')}</span>`,
      `<span>${esc(item.customer_type || item.industry || '待确认')}</span>`,
      `<span>${esc(item.opportunity_summary || item.next_action || '待确认')}</span>`,
      `<span>${esc(item.contacts_summary || item.contact_name || '未找到')}</span>`,
      item.job_id && state.data.user.role !== 'sales' ? `<a class="text-button" href="/api/report?job_id=${encodeURIComponent(item.job_id)}" target="_blank">查看报告</a>` : '<span class="subtle">已关联档案</span>',
    ]));
  }

  function intakeStatusLabel(status) {
    return ({ pending: '待审核', approved: '待分配', assigned: '待领取', claimed: '已领取', returned: '已退回', rejected: '不对口', duplicate: '重复客户' })[status] || status;
  }

  function renderIntake() {
    const intake = state.data.intake;
    if (!intake) return;
    const salesView = !can('manage_intake');
    $('#intakeHeading').textContent = salesView ? '我的每日未开发线索' : '未开发线索每日分配中心';
    $('#intakeSubheading').textContent = salesView ? '这里都是公司分配的未开发线索；领取后才进入你的CRM客户，并开始计算首次触达时限。' : '线索池与CRM严格分开；全部1901条线索进入分配管理，风险项待审核，其余按配额自动推送；销售领取后才创建CRM客户。';
    $('#intakeManagerActions').classList.toggle('hidden', salesView);
    $('#intakeBatchPanel').classList.toggle('hidden', salesView);
    $('#intakeModeLabel').innerHTML = `<span class="intake-mode">${intake.settings.enabled ? '自动入库已启用' : '自动入库已停用'} · ${intake.settings.approvalMode === 'automatic' ? '自动分配' : '管理者审核'} · 每人每天 ${intake.settings.dailyPerSales} 个</span>`;
    const stats = intake.stats;
    const summary = salesView ? [
      ['今日收到线索', stats.todayImported, '尚未计入CRM'],
      ['待领取', stats.assigned, `领取时限 ${intake.settings.claimSlaHours} 小时`],
      ['已领取', stats.claimed, '已转入个人CRM'],
      ['已完成触达', stats.contacted, '邮件、电话或社媒'],
      ['已退回', stats.returned, '必须说明原因'],
      ['领取超期', stats.overdueClaim, '管理者将收到预警'],
    ] : [
      ['今日同步线索', stats.todayImported, '仍属于未开发线索池'],
      ['待审核 / 分配', stats.pending + stats.approved, '管理者确认或等待配额'],
      ['待销售领取', stats.assigned, `时限 ${intake.settings.claimSlaHours} 小时`],
      ['销售已领取 / CRM', stats.claimed, `领取后进入CRM，首次触达 ${intake.settings.contactSlaHours} 小时`],
      ['已完成触达', stats.contacted, '已进入开发漏斗'],
      ['闲置资源', stats.idle, '待审核、待配额或退回'],
      ['退回待处理', stats.returned, '需要重新分配'],
      ['领取超期', stats.overdueClaim, '系统异常预警'],
    ];
    $('#intakeSummary').innerHTML = summary.map(([label, value, note]) => `<article class="metric ${label.includes('超期') && value ? 'alert' : ''}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    const items = intake.items.filter(item => !state.intakeStatus || item.status === state.intakeStatus);
    $('#intakeTable').innerHTML = table(
      ['未开发线索', '匹配', '联系质量 / 联系人', '建议负责人', '状态 / 时限', '操作'],
      items.map(item => {
        let actions = '';
        if (salesView && item.status === 'assigned') actions = `<div class="assignment-actions"><button class="button primary tiny" data-intake-action="claim" data-item-id="${item.id}">领取客户</button><button class="button secondary tiny" data-intake-action="return" data-item-id="${item.id}">退回</button><button class="text-button" data-intake-action="reject" data-item-id="${item.id}">不对口</button></div>`;
        else if (salesView && item.status === 'claimed') actions = item.crm_customer_id ? `<button class="text-button" data-open-customer="${item.crm_customer_id}">开始跟进 →</button>` : '—';
        else if (!salesView && ['pending', 'approved', 'returned'].includes(item.status)) actions = `<div class="assignment-actions"><button class="button primary tiny" data-intake-action="assign" data-item-id="${item.id}" data-owner-id="${item.suggested_owner_id}">按建议分配</button><button class="button secondary tiny" data-intake-assign="${item.id}">指定销售</button></div>`;
        else if (!salesView && ['assigned', 'claimed'].includes(item.status)) actions = `<button class="text-button" data-intake-assign="${item.id}">重新分配</button>`;
        else actions = '—';
        const statusClass = item.status === 'returned' || item.status === 'rejected' ? 'red' : item.status === 'assigned' ? 'amber' : item.status === 'claimed' ? '' : 'gray';
        const evidence = jsonList(item.evidence_urls).filter(url => /^https?:\/\//i.test(url));
        const sources = [
          item.report_url ? `<a class="text-button" href="${esc(item.report_url)}" target="_blank" rel="noopener">背调报告</a>` : '',
          evidence[0] ? `<a class="text-button" href="${esc(evidence[0])}" target="_blank" rel="noopener">筛选证据</a>` : '',
        ].filter(Boolean).join(' · ');
        return [
          `<div class="company-cell"><strong>${esc(item.company_name)}</strong><span>${esc(item.external_customer_id)} · ${esc(item.country || '—')} · ${esc(item.customer_type || item.industry || '—')}</span><span>${sources}</span></div>`,
          `<div style="display:flex;gap:8px;align-items:center"><span class="score-badge">${item.match_score}</span><div class="company-cell"><strong>${esc(item.match_group || '—')}组</strong><span>${esc(item.product_focus || '未标注需求')}</span></div></div>`,
          `<div class="intake-contact"><strong><span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span> ${esc(item.contact_name || '暂无具名联系人')}</strong><span>${esc(item.contact_title || '')}</span><span>${esc(item.contact_methods || '需要继续寻找联系方式')}</span></div>`,
          `<div class="assignment-cell"><strong>${esc(item.assigned_owner_name || item.suggested_owner_name || '暂无可用配额')}</strong><span class="subtle">${esc(item.decision_reason || '')}</span></div>`,
          `<div class="assignment-cell"><span class="pill ${statusClass}">${intakeStatusLabel(item.status)}</span><span class="${item.status === 'assigned' && item.claim_due_at < state.data.generatedAt ? 'overdue-text' : 'subtle'}">${item.claim_due_at ? `领取截止 ${shortDate(item.claim_due_at, true)}` : esc(item.return_reason || '')}</span></div>`,
          actions,
        ];
      }),
    );
    $('#intakeBatchTable').innerHTML = table(
      ['日期', '来源', '候选', '入库', '已分配', '跳过', '状态'],
      intake.batches.map(batch => [
        esc(batch.batch_date), esc(batch.source), batch.candidate_count, batch.imported_count, batch.assigned_count, batch.skipped_count,
        `<span class="pill ${batch.status === 'done' ? '' : 'amber'}">${batch.status === 'done' ? '完成' : batch.status}</span>`,
      ]),
    );
  }

  function renderDevelopment() {
    const frame = $('#developmentWorkbenchFrame');
    if (!frame || frame.dataset.ready === '1') return;
    const assistant = can('use_ai_assistant') ? '1' : '0';
    const prospect = can('use_prospect_agent') ? '1' : '0';
    frame.src = `/development-workbench?embedded=1&assistant=${assistant}&prospect=${prospect}#dashboard`;
    frame.addEventListener('load', () => {
      frame.dataset.ready = '1';
      $('#developmentWorkbenchLoading')?.classList.add('hidden');
    }, { once: true });
  }

  function renderCustomers() {
    const search = ($('#customerSearch')?.value || '').trim().toLowerCase();
    const stage = $('#stageFilter')?.value || '';
    const priority = $('#priorityFilter')?.value || '';
    const onlyOverdue = $('#onlyOverdue')?.checked;
    let accounts = scopedAccounts().filter(account => {
      const text = [account.company_name, account.country, account.industry, account.product_focus, account.customer_type].join(' ').toLowerCase();
      return (!search || text.includes(search)) && (!stage || account.stage === stage) && (!priority || account.priority === priority) && (!onlyOverdue || state.data.alerts.some(alert => alert.customerId === account.id && alert.code === 'OVERDUE'));
    });
    $('#customerResultCount').textContent = `${accounts.length} 个客户`;
    $('#customerTable').innerHTML = table(
      ['客户', '国家 / 行业', '阶段', '负责人', '最近动作', '下一步', '潜力', '状态'],
      accounts.map(account => {
        const alert = alertFor(account.id);
        return [
          `<div class="company-cell"><strong>${esc(account.company_name)}</strong><span>${esc(account.customer_type || account.source || '—')}</span></div>`,
          `<div class="company-cell"><strong>${esc(account.country || '—')}</strong><span>${esc(account.industry || '—')}</span></div>`,
          `<span class="status-pill">${esc(stageLabel(account.stage))}</span>`,
          esc(account.owner_name || '未分配'),
          `<span>${relative(account.last_activity_at)}</span>`,
          `<div class="company-cell"><strong class="${alert?.code === 'OVERDUE' ? 'overdue-text' : ''}">${esc(account.next_action || '未填写')}</strong><span>${shortDate(account.next_action_at, true)}</span></div>`,
          `<span class="priority ${esc(account.priority)}">${esc(account.priority)}</span> · ${money(account.potential_value)}`,
          alert ? `<span class="pill ${alert.severity === 'critical' ? 'red' : 'amber'}">${esc(alert.title)}</span>` : '<span class="good-text">正常推进</span>',
        ];
      }).map((row, index) => {
        row._id = accounts[index].id;
        return row;
      }),
    ).replace(/<tr>/g, (match => {
      let index = -1;
      return () => {
        index += 1;
        return index === 0 ? '<tr>' : `<tr data-customer="${esc(accounts[index - 1]?.id || '')}">`;
      };
    })());
  }

  function renderPipeline() {
    const accounts = scopedAccounts();
    const stages = state.data.stages.filter(item => !['new'].includes(item.key));
    $('#pipelineBoard').innerHTML = stages.map(stage => {
      const rows = accounts.filter(account => account.stage === stage.key);
      return `<div class="lane"><div class="lane-head"><h3>${esc(stage.label)}</h3><span>${rows.length}</span></div><div class="lane-body">${rows.map(account => {
        const alert = alertFor(account.id);
        const cls = alert?.severity === 'critical' ? 'alert' : account.manager_required ? 'warning' : '';
        return `<article class="pipeline-card ${cls}" data-open-customer="${account.id}">
          <div><span class="priority ${account.priority}">${account.priority}</span><h4>${esc(account.company_name)}</h4></div>
          <p>${esc(account.country)} · ${esc(account.industry || account.product_focus || '未标注')}</p>
          <p>${esc(account.next_action || '未填写下一步')}</p>
          <div class="pipeline-card-foot"><span>${esc(account.owner_name)}</span><span>${relative(account.last_activity_at)}</span></div>
        </article>`;
      }).join('') || '<div class="empty">暂无</div>'}</div></div>`;
    }).join('');
  }

  function renderAlerts() {
    const ids = new Set(scopedAccounts().map(item => item.id));
    const all = state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId));
    const counts = {
      critical: all.filter(item => item.severity === 'critical').length,
      manager: all.filter(item => item.code === 'MANAGER_NEEDED').length,
      overdue: all.filter(item => item.code === 'OVERDUE').length,
      stalled: all.filter(item => ['MEETING_NO_RFQ', 'QUOTE_IDLE', 'STALE'].includes(item.code)).length,
    };
    $('#alertSummary').innerHTML = [
      ['立即处理', counts.critical, '影响客户转化的严重异常'],
      ['等待介入', counts.manager, '需要管理者参与的重点客户'],
      ['任务超期', counts.overdue, '销售未按计划完成下一步'],
      ['阶段停滞', counts.stalled, '会议、询价或报价后未推进'],
    ].map(([label, value, text]) => `<article class="alert-kpi"><span>${label}</span><strong>${value}</strong><small class="subtle">${text}</small></article>`).join('');
    const rows = all.filter(item => !state.alertSeverity || item.severity === state.alertSeverity);
    $('#alertTable').innerHTML = table(
      ['等级', '客户', '异常类型', '系统判断', '负责人', '建议动作'],
      rows.map(item => {
        const account = state.data.accounts.find(row => row.id === item.customerId);
        return [
          `<span class="pill ${item.severity === 'critical' ? 'red' : 'amber'}">${item.severity === 'critical' ? '立即' : '关注'}</span>`,
          `<div class="company-cell"><strong>${esc(item.companyName)}</strong><span>${item.intakeItemId ? '未开发线索 · 待领取' : `${esc(account?.country || '')} · ${esc(stageLabel(item.stage))}`}</span></div>`,
          `<strong>${esc(item.title)}</strong>`, esc(item.detail), esc(account?.owner_name || userById(item.ownerId)?.name || ''), item.intakeItemId
            ? `<button class="text-button" data-go="intake">${esc(item.action)} →</button>`
            : `<button class="text-button" data-open-customer="${item.customerId}">${esc(item.action)} →</button>`,
        ];
      }),
    );
  }

  function renderInsightsHub() {
    if (state.data.user.role === 'sales') return;
    const insightData = state.data.insights || { contacts: [], evaluations: [] };
    const companyEvaluated = new Set(insightData.evaluations.filter(item => item.subjectType === 'company').map(item => item.customerId));
    const contactEvaluated = new Set(insightData.evaluations.filter(item => item.subjectType === 'contact').map(item => item.customerId));
    const aiCompleted = insightData.evaluations.filter(item => item.aiStatus === 'completed').length;
    const accounts = scopedAccounts().filter(item => item.stage !== 'lost');
    $('#insightSummary').innerHTML = [
      ['活跃客户', accounts.length, '当前管理范围'],
      ['已有企业评价', companyEvaluated.size, `${percent(companyEvaluated.size, accounts.length)} 覆盖率`],
      ['已有联系人评价', contactEvaluated.size, '逐人记录判断'],
      ['AI标注完成', aiCompleted, '人工原文与AI分离'],
      ['待评价企业', Math.max(0, accounts.length - companyEvaluated.size), '建议优先覆盖A类客户'],
    ].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    const search = ($('#insightSearch')?.value || '').trim().toLowerCase();
    const coverage = $('#insightCoverageFilter')?.value || '';
    const rows = accounts.filter(account => {
      const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
      const labels = evaluations.flatMap(item => item.aiLabels.map(label => label.name));
      const text = [account.company_name, account.country, account.owner_name, ...labels].join(' ').toLowerCase();
      const covered = !coverage || (coverage === 'none' && !evaluations.length) || (coverage === 'company' && companyEvaluated.has(account.id)) || (coverage === 'contact' && contactEvaluated.has(account.id));
      return (!search || text.includes(search)) && covered;
    });
    $('#insightResultCount').textContent = `${rows.length} 家企业`;
    $('#insightCompanyList').innerHTML = rows.length ? rows.map(account => {
      const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
      const companyEval = evaluations.find(item => item.subjectType === 'company');
      const contactCount = insightData.contacts.filter(item => item.customerId === account.id).length;
      const contactEvalCount = evaluations.filter(item => item.subjectType === 'contact').length;
      const labels = evaluations.flatMap(item => item.aiLabels).slice(0, 5);
      return `<article class="insight-hub-card">
        <div><span class="status-pill">${esc(stageLabel(account.stage))}</span><h3>${esc(account.company_name)}</h3><p>${esc(account.country)} · ${esc(account.owner_name)}</p></div>
        <div class="insight-preview ${companyEval ? '' : 'empty-preview'}">${companyEval ? `<strong>经理评价：</strong>${esc(companyEval.evaluationText)}` : '尚未填写企业经营评价'}</div>
        <div><div class="ai-tag-row">${labels.length ? labels.map(label => `<span class="ai-tag">AI · ${esc(label.name)}</span>`).join('') : '<span class="subtle">暂无AI标签</span>'}</div><p style="margin-top:6px">${contactCount} 位对接人 · ${contactEvalCount} 条联系人评价</p></div>
        <div class="insight-hub-actions"><button class="button secondary tiny" data-open-customer="${account.id}">查看详情</button><button class="button primary tiny" data-evaluate-company-id="${account.id}">${companyEval ? '追加评价' : '写企业评价'}</button></div>
      </article>`;
    }).join('') : '<div class="empty">没有符合条件的客户</div>';
  }

  function renderTeam() {
    if (state.data.user.role === 'sales') return;
    const rows = state.data.teamReport.filter(item => !$('#ownerFilter').value || item.user.id === $('#ownerFilter').value);
    $('#teamCards').innerHTML = rows.map(item => {
      const topScores = Object.entries(item.scores).sort((a, b) => b[1] - a[1]).slice(0, 4);
      return `<article class="team-card ${state.teamUserId === item.user.id ? 'selected' : ''}" data-team-user="${item.user.id}">
        <div class="team-card-top"><div class="person"><span class="avatar">${esc(item.user.name.slice(0, 1))}</span><div><strong>${esc(item.user.name)}</strong><small>${esc(item.bestCountries.join(' / ') || '待积累数据')}</small></div></div><div class="score-ring" style="--score:${item.overall}%"><strong>${item.overall}</strong></div></div>
        <div class="capability-bars">${topScores.map(([key, value]) => `<div class="cap-row"><span>${capabilityLabels[key]}</span><div class="cap-track"><i style="width:${value}%"></i></div><b>${value}</b></div>`).join('')}</div>
        <div class="team-tags">${item.bestChannels.map(channel => `<span class="pill">${esc(channel)}</span>`).join('')}<span class="pill gray">${item.sampleStatus}</span></div>
      </article>`;
    }).join('');
    if (state.teamUserId) renderTeamDetail(state.teamUserId);
  }
  function renderTeamDetail(userId) {
    const item = state.data.teamReport.find(row => row.user.id === userId);
    if (!item) return;
    const strongest = item.strongest.map(key => capabilityLabels[key]).join('、');
    const weakest = item.weakest.map(key => capabilityLabels[key]).join('、');
    const countries = item.bestCountries.join('、') || '尚未形成明显国家优势';
    $('#teamDetail').classList.remove('hidden');
    $('#teamDetail').innerHTML = `<div class="team-detail-grid">
      <div class="detail-block"><p class="eyebrow">CAPABILITY MAP</p><h3>${esc(item.user.name)} · 完整能力画像</h3>
        ${Object.entries(item.scores).map(([key, value]) => `<div class="rate-row"><span>${capabilityLabels[key]}</span><div class="cap-track"><i style="width:${value}%"></i></div><b>${value}</b></div>`).join('')}
      </div>
      <div class="detail-block"><p class="eyebrow">PERSONAL FUNNEL</p><h3>个人漏斗与团队检视</h3>
        ${Object.entries({ '资源激活率': item.rates.activation, '有效回复率': item.rates.reply, '回复→会议': item.rates.meeting, '会议→询价': item.rates.rfq, '询价→首单': item.rates.order, '首单→复购': item.rates.repeat }).map(([label, value]) => `<div class="rate-row"><span>${label}</span><div class="cap-track"><i style="width:${Math.min(100, value)}%"></i></div><b>${value.toFixed(1)}%</b></div>`).join('')}
        <div class="team-tags"><span class="pill">样本 ${item.sampleSize}</span><span class="pill gray">${item.sampleStatus}</span><span class="pill">毛利 ${money(item.grossProfit)}</span></div>
      </div>
      <div class="detail-block"><p class="eyebrow">MANAGER REVIEW</p><h3>客户分配与辅导建议</h3>
        <div class="recommendation"><strong>能力结论</strong><br>优势集中在${strongest}；当前短板为${weakest}。</div>
        <div class="recommendation"><strong>分配建议</strong><br>优先分配${countries}的客户；适合渠道：${esc(item.bestChannels.join('、') || '继续观察')}。</div>
        <div class="recommendation"><strong>渠道证据</strong><br>${item.channelPerformance.slice(0, 3).map(row => `${esc(row.channel)}：${row.customers}客，询价率${row.rfqRate.toFixed(1)}%`).join('<br>') || '尚未积累足够渠道数据'}</div>
        <div class="recommendation"><strong>下期行动</strong><br>${item.rates.rfq < 30 ? '陪同复盘3场视频会议，强化需求挖掘与BOM引导。' : item.rates.order < 25 ? '重点训练报价跟进和商务谈判。' : '可逐步增加高价值客户并减少早期管理介入。'}</div>
      </div>
    </div>`;
  }

  function renderMarkets() {
    if (state.data.user.role === 'sales') return;
    const rows = countryReportFor(scopedAccounts());
    const bestValue = rows[0];
    const bestReply = rows.slice().sort((a, b) => b.replyRate - a.replyRate)[0];
    const bestOrder = rows.slice().sort((a, b) => b.orderRate - a.orderRate)[0];
    $('#marketCards').innerHTML = [
      ['最高单客价值', bestValue?.country || '—', bestValue ? `${money(bestValue.valuePerAccount)} / 客户` : '暂无数据'],
      ['最高有效回复', bestReply?.country || '—', bestReply ? `${bestReply.replyRate.toFixed(1)}% 回复率` : '暂无数据'],
      ['最高询价成交', bestOrder?.country || '—', bestOrder ? `${bestOrder.orderRate.toFixed(1)}% 询价转首单` : '暂无数据'],
    ].map(([label, value, note]) => `<article class="market-card"><small>${label}</small><strong>${esc(value)}</strong><p>${esc(note)}</p></article>`).join('');
    $('#marketTable').innerHTML = table(
      ['国家', '样本', '触达率', '回复率', '会议率', '询价率', '首单率', '复购率', '收入', '单客毛利', '策略判断'],
      rows.map(row => {
        const judgement = row.sampleStatus === '样本不足' ? '继续积累样本' : row.valuePerAccount > 300 ? '优先增加资源' : row.replyRate < 5 ? '减少冷开发投入' : '保持并优化';
        return [
          `<strong>${esc(row.country)}</strong>`, `${row.accounts} · ${row.sampleStatus}`, `${row.contactRate.toFixed(1)}%`, `${row.replyRate.toFixed(1)}%`,
          `${row.meetingRate.toFixed(1)}%`, `${row.rfqRate.toFixed(1)}%`, `${row.orderRate.toFixed(1)}%`, `${row.repeatRate.toFixed(1)}%`,
          money(row.revenue), money(row.valuePerAccount), `<span class="pill ${judgement.includes('减少') ? 'red' : judgement.includes('积累') ? 'gray' : ''}">${judgement}</span>`,
        ];
      }),
    );
    $('#cohortTable').innerHTML = table(
      ['分配月份','客户数','触达率','回复率','会议率','会议→询价','询价→首单','收入'],
      (state.data.cohortReport || []).map(row => [
        `<strong>${esc(row.cohort)}</strong>`, row.assigned, `${row.contactRate.toFixed(1)}%`,
        `${row.replyRate.toFixed(1)}%`, `${row.meetingRate.toFixed(1)}%`, `${row.rfqRate.toFixed(1)}%`,
        `${row.orderRate.toFixed(1)}%`, money(row.revenue),
      ]),
    );
    renderSegments(scopedAccounts());
  }

  function segmentReport(accounts, field) {
    const order = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
    const ids = new Set(accounts.map(item => item.id));
    const orders = state.data.orders.filter(item => ids.has(item.customer_id));
    const groups = {};
    accounts.forEach(account => {
      const key = account[field] || '未标注';
      const item = groups[key] ||= { name: key, accounts: 0, contacted: 0, replied: 0, rfq: 0, won: 0, revenue: 0 };
      item.accounts += 1;
      if (account.stage !== 'lost' && order[account.stage] >= order.contacted) item.contacted += 1;
      if (account.stage !== 'lost' && order[account.stage] >= order.replied) item.replied += 1;
      if (account.stage !== 'lost' && order[account.stage] >= order.rfq) item.rfq += 1;
      if (account.stage !== 'lost' && order[account.stage] >= order.won) item.won += 1;
      item.revenue += orders.filter(row => row.customer_id === account.id).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    });
    return Object.values(groups).map(item => ({
      ...item,
      replyRate: item.contacted ? item.replied / item.contacted * 100 : 0,
      rfqRate: item.contacted ? item.rfq / item.contacted * 100 : 0,
      orderRate: item.rfq ? item.won / item.rfq * 100 : 0,
    })).sort((a, b) => b.orderRate - a.orderRate || b.rfqRate - a.rfqRate || b.accounts - a.accounts);
  }

  function renderSegments(accounts) {
    const configs = [
      ['客户来源', 'source'], ['应用行业', 'industry'], ['客户类型', 'customer_type'], ['产品需求', 'product_focus'],
    ];
    $('#segmentGrid').innerHTML = configs.map(([title, field]) => {
      const rows = segmentReport(accounts, field).slice(0, 6);
      return `<article class="segment-panel"><div class="panel-head"><div><p class="eyebrow">SEGMENT VIEW</p><h3>${title}转化</h3></div><span class="panel-note">回复 → 询价 → 首单</span></div>
        <div class="data-table compact">${table(['细分', '客户', '回复率', '询价率', '首单率'], rows.map(row => [
          `<strong>${esc(row.name)}</strong>`, row.accounts, `${row.replyRate.toFixed(1)}%`, `${row.rfqRate.toFixed(1)}%`, ratePill(row.orderRate),
        ]))}</div></article>`;
    }).join('');
  }

  function renderUsers() {
    if (!can('view_users')) return;
    $('#userTable').innerHTML = table(
      ['用户', '角色', '可见范围', '优势国家', '主要渠道', '状态', '操作'],
      state.data.users.map(user => [
        `<div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>`,
        `<span class="pill">${({ admin: '管理员', manager: '经理', sales: '销售' })[user.role]}</span>`,
        `<span class="subtle">${Object.entries(user.permissions || {}).filter(([key,value]) => value && key.startsWith('view_') && key !== 'view_all_customers').length} 个模块 · ${user.permissions?.view_all_customers ? '团队全盘' : '仅本人客户'}</span>`,
        esc(user.countries.join('、') || '—'), esc(user.channels.join('、') || '—'),
        `<span class="pill ${user.active ? '' : 'gray'}">${user.active ? '启用' : '停用'}</span>`,
        `<div class="assignment-actions"><button class="text-button" data-edit-permissions="${user.id}">配置权限</button>${user.id === state.data.user.id ? '<span class="subtle">当前账号</span>' : `<button class="text-button" data-toggle-user="${user.id}" data-active="${user.active ? '1' : '0'}">${user.active ? '停用' : '启用'}</button>`}</div>`,
      ]),
    );
    $('#auditTable').innerHTML = table(
      ['时间','操作人','动作','对象','详情'],
      (state.data.auditLog || []).map(row => [
        esc(shortDate(row.created_at, true)), esc(row.user_name || row.user_id || '系统'),
        `<strong>${esc(row.action)}</strong>`, `${esc(row.entity_type)} · ${esc(row.entity_id || '—')}`,
        `<span class="subtle">${esc(String(row.detail_json || '').slice(0, 140))}</span>`,
      ]),
    );
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active);
    $('#migrationReviewCount').textContent = `${state.data.migrationReview?.length || 0} 条待确认`;
    $('#migrationReviewTable').innerHTML = table(
      ['旧记录','原负责人','原因','分配销售','操作'],
      (state.data.migrationReview || []).map(review => {
        let payload = {}; try { payload = JSON.parse(review.payload_json || '{}'); } catch (_error) {}
        return [
          `<div class="company-cell"><strong>${esc(payload.company_name || review.source_id)}</strong><span>${esc(payload.customer_id || '')} · ${esc(review.source_id)}</span></div>`,
          esc(payload.owner || '未分配'), esc(review.reason),
          `<select data-review-owner="${esc(review.id)}">${sales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}</select>`,
          `<button class="text-button" data-resolve-review="${esc(review.id)}">确认迁移</button>`,
        ];
      }),
    );
  }

  function openCustomer(customerId) {
    state.selectedCustomerId = customerId;
    renderDrawer();
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    $('#customerDrawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'true');
  }

  function evaluationCard(item) {
    const ai = item.aiStatus === 'completed' ? `
      <div class="ai-analysis">
        <div class="ai-analysis-head"><span class="ai-badge">AI 标注</span><span>${esc(item.aiModel || 'AI')} · 基于经理评价自动提取 · 非人工结论</span></div>
        ${item.aiSummary ? `<div class="evaluation-text">${esc(item.aiSummary)}</div>` : ''}
        <div class="ai-tag-row">${item.aiLabels.map(label => `<span class="ai-tag" title="${esc(label.rationale || '')}">AI · ${esc(label.name)}</span>`).join('')}</div>
        ${item.aiOrderKeys.length ? `<div class="ai-strategy"><strong>AI提取的赢单关键：</strong>${esc(item.aiOrderKeys.join('、'))}</div>` : ''}
        ${item.aiRisks.length ? `<div class="ai-strategy"><strong>AI提取的风险：</strong>${esc(item.aiRisks.join('、'))}</div>` : ''}
        ${item.aiStrategy ? `<div class="ai-strategy"><strong>AI建议：</strong>${esc(item.aiStrategy)}</div>` : ''}
      </div>` : item.aiStatus === 'failed' ? `<div class="ai-analysis"><div class="ai-analysis-head"><span class="ai-badge">AI 标注失败</span><button class="text-button" data-retry-evaluation="${item.id}">重新生成</button></div><span class="subtle">${esc(item.aiError || 'AI服务暂时不可用')}</span></div>`
        : '<div class="ai-analysis"><div class="ai-analysis-head"><span class="ai-badge">AI 分析中</span></div></div>';
    return `<article class="evaluation-card manager-note">
      <div class="evaluation-meta"><span>经理评价 · ${esc(item.authorName)}</span><time>${shortDate(item.createdAt, true)}</time></div>
      <div class="evaluation-text">${esc(item.evaluationText)}</div>${ai}
    </article>`;
  }

  function renderDrawer() {
    const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
    if (!account) return;
    $('#drawerStage').textContent = stageLabel(account.stage);
    $('#drawerCompany').textContent = account.company_name;
    $('#drawerMeta').textContent = [account.country, account.city, account.industry, account.customer_type].filter(Boolean).join(' · ');
    const activities = state.data.activities.filter(item => item.customer_id === account.id);
    const rfqs = state.data.rfqs.filter(item => item.customer_id === account.id);
    const quotes = state.data.quotes.filter(item => item.customer_id === account.id);
    const orders = state.data.orders.filter(item => item.customer_id === account.id);
    const insightData = state.data.insights || { contacts: [], evaluations: [] };
    const contacts = insightData.contacts.filter(item => item.customerId === account.id);
    const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
    const companyEvaluations = evaluations.filter(item => item.subjectType === 'company');
    const canEvaluate = can('manage_evaluations');
    const alert = alertFor(account.id);
    $('#drawerContent').innerHTML = `
      ${alert ? `<div class="next-step" style="border-color:${alert.severity === 'critical' ? '#e0a09c' : '#e5c27c'}"><div><strong>${esc(alert.title)}</strong><p>${esc(alert.detail)}</p></div><span class="pill ${alert.severity === 'critical' ? 'red' : 'amber'}">${esc(alert.action)}</span></div>` : ''}
      <div class="next-step"><div><span class="eyebrow">NEXT ACTION</span><p>${esc(account.next_action || '尚未填写下一步')}</p></div><time>${shortDate(account.next_action_at, true)}</time></div>
      <div class="account-facts">
        ${[['负责人', account.owner_name], ['优先级', `${account.priority} · ${money(account.potential_value)}`], ['客户来源', account.source], ['产品重点', account.product_focus], ['最近动作', relative(account.last_activity_at)], ['管理介入', account.manager_status || (account.manager_required ? '待介入' : '暂不需要')], ['官网', account.website], ['客户编号', account.external_customer_id], ['客户分组', account.current_pool], ['联系人质量', account.best_contact_level]].map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${esc(value || '—')}</strong></div>`).join('')}
      </div>
      <section class="master-profile">
        <div class="insight-head"><div><p class="eyebrow">CUSTOMER MASTER DATA</p><h3>企业背景与开发依据</h3></div><button class="text-button" data-open-master="${esc(account.external_customer_id || '')}">查看完整客户资料 →</button></div>
        <div class="master-profile-grid">
          <div><span>企业简介</span><p>${esc(account.master_description || '暂无企业简介')}</p></div>
          <div><span>行业与客户类型</span><p>${esc([account.industry, account.customer_type].filter(Boolean).join(' · ') || '未标注')}</p></div>
          <div><span>产品与潜在需求</span><p>${esc(account.product_focus || '未标注')}</p></div>
          <div><span>背调与来源</span><p>${esc([account.deep_report, account.source_file].filter(Boolean).join(' · ') || '暂无关联资料')}</p></div>
        </div>
      </section>
      <div class="commerce-strip">
        <div class="commerce-card"><span>询价</span><strong>${rfqs.length}</strong></div>
        <div class="commerce-card"><span>累计报价</span><strong>${money(quotes.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
        <div class="commerce-card"><span>累计订单</span><strong>${money(orders.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${rfqs.length && can('record_quote') ? '<button class="button secondary" data-add-quote>＋ 记录报价</button>' : ''}
        ${quotes.length && can('record_order') ? '<button class="button secondary" data-add-order>＋ 记录订单</button>' : ''}
        ${can('edit_customer') ? '<button class="button secondary" data-edit-account>调整客户信息</button>' : ''}
      </div>
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">MANAGER INSIGHT</p><h3>企业经营评价</h3></div>${canEvaluate ? '<button class="button secondary tiny" data-evaluate-company>＋ 写企业评价</button>' : ''}</div>
        <div class="insight-body">${companyEvaluations.length ? companyEvaluations.map(evaluationCard).join('') : '<div class="empty">暂无经理评价</div>'}</div>
      </section>
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">CONTACT INTELLIGENCE</p><h3>对接人评价</h3></div>${canEvaluate ? '<button class="button secondary tiny" data-add-contact>＋ 新增对接人</button>' : ''}</div>
        <div class="insight-body">${contacts.length ? contacts.map(contact => {
          const contactEvaluations = evaluations.filter(item => item.subjectType === 'contact' && item.subjectId === contact.id);
          return `<article class="contact-insight"><div class="contact-insight-head"><div><strong>${esc(contact.name)}</strong><span>${esc(contact.title || '职位未标注')} · ${esc(contact.department || contact.contactLevel || '')}</span></div>${canEvaluate ? `<button class="text-button" data-evaluate-contact="${esc(contact.id)}">评价此人</button>` : ''}</div>
            ${contactEvaluations.length ? contactEvaluations.map(evaluationCard).join('') : '<span class="subtle">暂无针对这个对接人的经理评价</span>'}</article>`;
        }).join('') : '<div class="empty">暂无对接人，可由管理者新增</div>'}</div>
      </section>
      <div><div class="panel-head" style="padding-left:0;padding-right:0"><div><p class="eyebrow">FULL TIMELINE</p><h2>完整客户时间线</h2></div><span class="panel-note">${activities.length} 条记录</span></div>
      <div class="timeline">${activities.map(activity => {
        const meta = activityMeta[activity.activity_type] || [activity.activity_type, '记'];
        return `<div class="timeline-item"><h4>${esc(meta[0])} · ${esc(activity.outcome || '')}</h4><p>${esc(activity.summary || '无补充说明')}${activity.next_action ? `<br><strong>下一步：</strong>${esc(activity.next_action)}` : ''}</p><time>${esc(activity.user_name || '')} · ${shortDate(activity.occurred_at, true)}</time></div>`;
      }).join('') || '<div class="empty">暂无跟进记录</div>'}</div></div>`;
  }

  function openModal(title, eyebrow, html) {
    $('#modalTitle').textContent = title;
    $('#modalEyebrow').textContent = eyebrow;
    $('#modalBody').innerHTML = `<div class="modal-body">${html}</div>`;
    $('#modal').classList.add('open');
    $('#modal').setAttribute('aria-hidden', 'false');
  }
  function closeModal() {
    $('#modal').classList.remove('open');
    $('#modal').setAttribute('aria-hidden', 'true');
  }
  function customerOptions(selected = '') {
    return scopedAccounts().filter(item => !['lost'].includes(item.stage)).map(item => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.company_name)} · ${esc(item.owner_name)}</option>`).join('');
  }
  function openActivityModal(customerId = '') {
    state.activityType = 'email';
    openModal('记录客户动作', 'QUICK UPDATE · 30秒完成', `
      <form id="activityForm" class="form-grid two">
        <label class="span-2">客户<select name="customerId" required><option value="">请选择客户</option>${customerOptions(customerId)}</select></label>
        <div class="span-2"><label>本次动作</label><div id="activityTypes" class="activity-types">${[
          ['email', '发送邮件'], ['call', '电话开发'], ['social', '社媒联系'], ['reply', '客户回复'],
          ['meeting', '视频会议'], ['manager_join', '管理者介入'], ['rfq', '收到询价'], ['negotiation', '商务谈判'], ['lost', '暂停/流失'],
        ].map(([key, label], index) => `<button type="button" class="activity-type ${index === 0 ? 'active' : ''}" data-activity="${key}">${label}</button>`).join('')}</div></div>
        <input type="hidden" name="activityType" value="email">
        <label>渠道<select name="channel"><option>email</option><option>call</option><option>WhatsApp</option><option>Telegram</option><option>LinkedIn</option><option>video</option><option>展会</option><option>business</option></select></label>
        <label>结果<select name="outcome"><option>已完成</option><option>有兴趣</option><option>需要跟进</option><option>未接通</option><option>暂无回复</option><option>明确拒绝</option></select></label>
        <label class="span-2">简短记录<textarea name="summary" placeholder="记录客户反馈、需求或当前障碍"></textarea></label>
        <div id="rfqFields" class="span-2 form-grid two hidden">
          <label>询价编号<input name="reference" placeholder="如 RFQ-2026-0719"></label>
          <label>BOM 行数<input name="bomLines" type="number" min="0"></label>
          <label>预估金额（USD）<input name="expectedValue" type="number" min="0"></label>
          <label>资料完整度<input name="completeness" type="number" min="0" max="100" value="80"></label>
          <label class="span-2">产品类别<input name="productCategory" placeholder="MCU、连接器、传感器等"></label>
        </div>
        <label>下一步动作<input name="nextAction" placeholder="例如：追踪客户BOM"></label>
        <label>计划时间<input name="nextActionAt" type="datetime-local" value="${dateInput(2)}"></label>
        <label class="span-2 check"><input name="managerRequired" type="checkbox"> 这是重点节点，需要管理者介入</label>
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存并更新阶段</button></div>
      </form>`);
  }

  function openNewCustomerModal() {
    const sales = state.data.users.filter(user => user.role === 'sales');
    openModal('新增对口客户', 'CUSTOMER INTAKE', `<form id="customerForm" class="form-grid two">
      <label class="span-2">公司名称<input name="companyName" required></label>
      <label>国家<input name="country" required></label><label>城市<input name="city"></label>
      <label>行业<input name="industry" placeholder="工业控制、汽车电子等"></label><label>客户类型<select name="customerType"><option>终端制造商</option><option>EMS/代工厂</option><option>贸易商</option><option>维修企业</option><option>方案公司</option></select></label>
      <label>客户来源<select name="source"><option>公司指派</option><option>销售自行搜索</option><option>展会</option><option>LinkedIn</option><option>海关数据</option><option>老客户介绍</option></select></label>
      <label>负责人<select name="ownerId" required>${sales.map(user => `<option value="${user.id}">${esc(user.name)}</option>`).join('')}</select></label>
      <label>重点产品<input name="productFocus" placeholder="IC、连接器、传感器等"></label><label>潜在金额（USD）<input name="potentialValue" type="number" min="0"></label>
      <label>优先级<select name="priority"><option>A</option><option selected>B</option><option>C</option></select></label><label>首次行动时间<input name="nextActionAt" type="datetime-local" value="${dateInput(1)}"></label>
      <label class="span-2">下一步<input name="nextAction" value="完成首次触达"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">创建并分配</button></div>
    </form>`);
  }

  function openQuoteModal(customerId) {
    openModal('记录报价', 'QUOTATION', `<form id="quoteForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <label>报价金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>预计毛利率 %<input name="grossMargin" type="number" step=".1" value="8"></label><label>报价后跟进时间<input name="nextFollowAt" type="datetime-local" value="${dateInput(3)}"></label>
      <label class="span-2 check"><input name="lossLeader" type="checkbox"> 首单低价/亏本引流报价</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存报价</button></div>
    </form>`);
  }
  function openOrderModal(customerId) {
    openModal('记录客户订单', 'ORDER WON', `<form id="orderForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <label>订单金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>实际毛利率 %<input name="grossMargin" type="number" step=".1" value="5"></label><label>下一次经营动作<input name="nextActionAt" type="datetime-local" value="${dateInput(14)}"></label>
      <label class="span-2 check"><input name="isRepeat" type="checkbox"> 这是复购订单</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认订单</button></div>
    </form>`);
  }
  function openUserModal() {
    const defaults = state.data.rolePermissions?.sales || {};
    openModal('新增团队用户', 'USER & ROLE', `<form id="userForm" class="form-grid two">
      <label>姓名<input name="name" required></label><label>工作邮箱<input name="email" type="email" required></label>
      <label>角色<select name="role"><option value="sales">销售代表</option><option value="manager">销售经理</option><option value="admin">系统管理员</option></select></label><label>初始密码<input name="password" value="Sales123!" minlength="8" required></label>
      <label class="span-2">语言（用逗号分隔）<input name="languages" placeholder="英文, 俄语"></label>
      <label>优势国家<input name="countries" placeholder="俄罗斯, 哈萨克斯坦"></label><label>优势渠道<input name="channels" placeholder="电话, Telegram"></label>
      <div class="span-2 permission-editor">${permissionFields(defaults)}</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">创建用户</button></div>
    </form>`);
  }

  function permissionFields(permissions = {}) {
    const definitions = state.data.permissionDefinitions || {};
    const groups = [
      ['可查看模块', Object.keys(definitions).filter(key => key.startsWith('view_') && key !== 'view_all_customers')],
      ['数据范围与操作', Object.keys(definitions).filter(key => !key.startsWith('view_') || key === 'view_all_customers')],
    ];
    return groups.map(([title,keys]) => `<fieldset><legend>${title}</legend><div class="permission-grid">${keys.map(key =>
      `<label class="permission-check"><input type="checkbox" name="permission__${esc(key)}" ${permissions[key] ? 'checked' : ''}><span>${esc(definitions[key])}</span></label>`).join('')}</div></fieldset>`).join('');
  }

  function openPermissionModal(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    openModal(`配置权限 · ${user.name}`, 'ACCESS MATRIX', `<form id="permissionForm" class="form-grid">
      <input type="hidden" name="userId" value="${esc(user.id)}">
      <div class="recommendation"><strong>${esc(user.email)}</strong><br>角色模板提供默认权限；这里的勾选结果会作为该账号的实际权限，前端菜单和后端接口同时生效。</div>
      <div class="permission-editor">${permissionFields(user.permissions || {})}</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存权限</button></div>
    </form>`);
  }
  function openEditAccountModal(customerId) {
    const account = state.data.accounts.find(item => item.id === customerId);
    const sales = state.data.users.filter(user => user.role === 'sales');
    openModal('调整客户信息', 'ACCOUNT CONTROL', `<form id="editAccountForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <label>阶段<select name="stage" ${can('edit_customer') ? '' : 'disabled'}>${state.data.stages.map(item => `<option value="${item.key}" ${item.key === account.stage ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
      <label>负责人<select name="ownerId" ${can('edit_customer') ? '' : 'disabled'}>${sales.map(user => `<option value="${user.id}" ${user.id === account.owner_id ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select></label>
      <label>优先级<select name="priority">${['A', 'B', 'C'].map(item => `<option ${item === account.priority ? 'selected' : ''}>${item}</option>`).join('')}</select></label>
      <label>潜力金额<input name="potentialValue" type="number" value="${Number(account.potential_value || 0)}"></label>
      <label class="span-2">下一步动作<input name="nextAction" value="${esc(account.next_action)}"></label>
      <label class="span-2">计划时间<input name="nextActionAt" type="datetime-local" value="${esc(String(account.next_action_at || '').replace(' ', 'T').slice(0, 16))}"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存调整</button></div>
    </form>`);
  }

  function openPasswordModal() {
    openModal('修改登录密码', 'ACCOUNT SECURITY', `<form id="passwordForm" class="form-grid">
      <label>当前密码<input name="oldPassword" type="password" autocomplete="current-password" required></label>
      <label>新密码<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>确认新密码<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">修改密码并重新登录</button></div>
    </form>`);
  }

  function openIntakeSettingsModal() {
    const value = state.data.intake.settings;
    openModal('每日入库与分配规则', 'AUTOMATION SETTINGS', `<form id="intakeSettingsForm" class="form-grid two">
      <label>运行状态<select name="enabled"><option value="true" ${value.enabled ? 'selected' : ''}>启用每日自动入库</option><option value="false" ${!value.enabled ? 'selected' : ''}>暂停自动入库</option></select></label>
      <label>推送模式<select name="approvalMode"><option value="automatic" ${value.approvalMode === 'automatic' ? 'selected' : ''}>全自动匹配并推送</option><option value="manual" ${value.approvalMode === 'manual' ? 'selected' : ''}>管理员审核后分配</option></select></label>
      <label>每名销售每日数量<input name="dailyPerSales" type="number" min="1" max="50" value="${value.dailyPerSales}"></label>
      <label>领取时限（小时）<input name="claimSlaHours" type="number" min="1" max="72" value="${value.claimSlaHours}"></label>
      <label>首次触达时限（小时）<input name="contactSlaHours" type="number" min="1" max="168" value="${value.contactSlaHours}"></label>
      <label>允许匹配组别<input name="matchGroups" value="${esc(value.matchGroups.join(','))}" placeholder="A,B,C,D"></label>
      <label class="span-2">限定国家（留空表示全部）<input name="countries" value="${esc(value.countries.join(','))}" placeholder="俄罗斯,巴西"></label>
      <div class="span-2 recommendation"><strong>分配顺序</strong><br>先匹配国家经验和语言，再匹配可用联系渠道，最后按当前活跃客户量和当日配额进行负荷均衡。L0-L3均可分配；风险拦截线索保留在池中但不自动推送。</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存规则</button></div>
    </form>`);
  }

  function openIntakeAssignModal(itemId) {
    const item = state.data.intake.items.find(row => row.id === itemId);
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active);
    openModal(item.crm_customer_id ? '重新分配客户' : '指定销售负责人', 'CUSTOMER ASSIGNMENT', `<form id="intakeAssignForm" class="form-grid">
      <input type="hidden" name="itemId" value="${esc(itemId)}">
      <div class="recommendation"><strong>${esc(item.company_name)}</strong><br>${esc(item.country)} · ${esc(item.contact_level)} · 建议：${esc(item.suggested_owner_name || '暂无')}</div>
      <label>销售负责人<select name="ownerId">${sales.map(user => `<option value="${user.id}" ${user.id === (item.assigned_owner_id || item.suggested_owner_id) ? 'selected' : ''}>${esc(user.name)} · ${esc(user.countries.join('/'))}</option>`).join('')}</select></label>
      <label>分配说明<input name="reason" value="${esc(item.decision_reason || '管理者指定分配')}"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认分配</button></div>
    </form>`);
  }

  function openIntakeReasonModal(itemId, action) {
    const title = action === 'reject' ? '标记客户不对口' : '退回客户';
    openModal(title, 'REASON REQUIRED', `<form id="intakeReasonForm" class="form-grid">
      <input type="hidden" name="itemId" value="${esc(itemId)}"><input type="hidden" name="action" value="${esc(action)}">
      <label>原因<textarea name="reason" required placeholder="${action === 'reject' ? '说明行业、产品、地区或客户类型为何不匹配' : '说明无法继续跟进或需要重新分配的原因'}"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认提交</button></div>
    </form>`);
  }

  function openEvaluationModal(subjectType, contactId = '') {
    const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
    const contact = contactId ? state.data.insights.contacts.find(item => item.id === contactId) : null;
    const subjectName = subjectType === 'contact' ? contact?.name : account.company_name;
    const subjectTitle = subjectType === 'contact' ? contact?.title : '';
    openModal(subjectType === 'contact' ? `评价对接人：${subjectName}` : `评价企业：${account.company_name}`, 'MANAGER EVALUATION + AI LABELS', `<form id="evaluationForm" class="form-grid">
      <input type="hidden" name="customerId" value="${esc(account.id)}"><input type="hidden" name="subjectType" value="${esc(subjectType)}">
      <input type="hidden" name="subjectId" value="${esc(contactId)}"><input type="hidden" name="subjectName" value="${esc(subjectName || '')}">
      <input type="hidden" name="subjectTitle" value="${esc(subjectTitle || '')}">
      <div class="recommendation"><strong>${esc(subjectName || '')}</strong>${subjectTitle ? `<br>${esc(subjectTitle)}` : ''}</div>
      <label>销售经理评价<textarea name="evaluationText" required minlength="8" placeholder="${subjectType === 'company' ? '例如：公司规模很大但采购流程不规范，因此决策快、价格敏感度较低；质检实验室完整，赢单关键是提供可追溯质检服务。' : '例如：采购主管拥有供应商初筛权，重视响应速度和资料完整度；沟通直接，但最终价格需要老板确认。'}"></textarea></label>
      <div class="recommendation"><strong>AI如何处理</strong><br>系统会基于这段经理原文提取标签、风险、赢单关键和建议。所有生成内容均明确显示“AI标注”，不会覆盖经理原文。</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存并生成AI标注</button></div>
    </form>`);
  }

  function openContactModal() {
    const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
    openModal(`新增对接人 · ${account.company_name}`, 'CONTACT PROFILE', `<form id="contactForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(account.id)}">
      <label>姓名<input name="name" required></label><label>职位抬头<input name="title" placeholder="老板、采购主管、采购经理"></label>
      <label>部门<input name="department" placeholder="采购部、供应链、研发"></label><label>电话<input name="phone"></label>
      <label>邮箱<input name="email" type="email"></label><label>社媒账号<input name="social" placeholder="WhatsApp / Telegram / LinkedIn"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存对接人</button></div>
    </form>`);
  }

  async function refresh(message = '') {
    state.data = await api('/api/sales-crm/bootstrap');
    populateFilters();
    renderAll();
    closeModal();
    if (message) toast(message);
  }
  function formPayload(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll('input[type=checkbox]').forEach(input => { data[input.name] = input.checked; });
    return data;
  }
  function splitTags(value) {
    return String(value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean);
  }
  function permissionsFromPayload(payload) {
    const permissions = {};
    Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
      permissions[key] = Boolean(payload[`permission__${key}`]);
      delete payload[`permission__${key}`];
    });
    return permissions;
  }

  document.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    try {
      if (form.id === 'loginForm') {
        $('#loginError').textContent = '';
        await api('/api/sales-auth/login', { method: 'POST', body: JSON.stringify(formPayload(form)) });
        await load();
      } else if (form.id === 'activityForm') {
        const payload = formPayload(form);
        payload.nextActionAt = apiTime(payload.nextActionAt);
        payload.bomLines = Number(payload.bomLines || 0);
        payload.expectedValue = Number(payload.expectedValue || 0);
        payload.completeness = Number(payload.completeness || 0);
        await api('/api/sales-crm/activities', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('客户动作已记录，阶段和预警已同步');
      } else if (form.id === 'customerForm') {
        const payload = formPayload(form);
        payload.nextActionAt = apiTime(payload.nextActionAt);
        await api('/api/sales-crm/accounts', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('客户已创建并分配');
      } else if (form.id === 'quoteForm') {
        const payload = formPayload(form);
        payload.nextFollowAt = apiTime(payload.nextFollowAt);
        await api('/api/sales-crm/quotes', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('报价已记录，客户进入已报价阶段');
      } else if (form.id === 'orderForm') {
        const payload = formPayload(form);
        payload.nextActionAt = apiTime(payload.nextActionAt);
        await api('/api/sales-crm/orders', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('订单已记录，客户价值指标已更新');
      } else if (form.id === 'userForm') {
        const payload = formPayload(form);
        payload.languages = splitTags(payload.languages);
        payload.countries = splitTags(payload.countries);
        payload.channels = splitTags(payload.channels);
        payload.permissions = permissionsFromPayload(payload);
        await api('/api/sales-crm/users', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('新用户已创建');
      } else if (form.id === 'permissionForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        delete payload.userId;
        payload.permissions = permissionsFromPayload(payload);
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await refresh('账号权限已更新');
      } else if (form.id === 'editAccountForm') {
        const payload = formPayload(form);
        const customerId = payload.customerId;
        delete payload.customerId;
        payload.nextActionAt = apiTime(payload.nextActionAt);
        await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await refresh('客户信息已调整');
      } else if (form.id === 'passwordForm') {
        const payload = formPayload(form);
        if (payload.newPassword !== payload.confirmPassword) throw new Error('两次输入的新密码不一致');
        await api('/api/sales-crm/password', { method: 'POST', body: JSON.stringify(payload) });
        toast('密码修改成功，请重新登录');
        setTimeout(() => location.reload(), 700);
      } else if (form.id === 'intakeSettingsForm') {
        const payload = formPayload(form);
        payload.enabled = payload.enabled === 'true';
        payload.matchGroups = splitTags(payload.matchGroups);
        payload.countries = splitTags(payload.countries);
        await api('/api/sales-crm/intake/settings', { method: 'PATCH', body: JSON.stringify(payload) });
        await refresh('每日入库规则已更新');
      } else if (form.id === 'intakeAssignForm') {
        const payload = formPayload(form);
        payload.action = 'assign';
        await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify(payload) });
        await refresh('客户已分配并生成领取任务');
      } else if (form.id === 'intakeReasonForm') {
        const payload = formPayload(form);
        await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify(payload) });
        await refresh(payload.action === 'reject' ? '客户已标记为不对口' : '客户已退回管理者队列');
      } else if (form.id === 'contactForm') {
        await api('/api/sales-crm/contacts', { method: 'POST', body: JSON.stringify(formPayload(form)) });
        await refresh('对接人已保存，可以分别添加经理评价');
      } else if (form.id === 'evaluationForm') {
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        button.textContent = 'AI分析中…';
        const result = await api('/api/sales-crm/evaluations', { method: 'POST', body: JSON.stringify(formPayload(form)) });
        await refresh(result.aiWarning ? '经理评价已保存；AI标注暂时失败，可稍后重试' : '经理评价和AI标注已生成');
      }
    } catch (error) {
      if (form.id === 'loginForm') $('#loginError').textContent = error.message;
      else toast(error.message);
    }
  });

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]');
    if (nav) switchView(nav.dataset.view);
    const go = event.target.closest('[data-go]');
    if (go) switchView(go.dataset.go);
    const customer = event.target.closest('[data-open-customer],[data-customer]');
    if (customer) openCustomer(customer.dataset.openCustomer || customer.dataset.customer);
    const master = event.target.closest('[data-open-master]');
    if (master) {
      const customerId = master.dataset.openMaster;
      switchView('pool');
      const search = $('#poolSearch');
      if (search) search.value = customerId;
      renderUnifiedPool();
    }
    const stageJump = event.target.closest('[data-stage-jump]');
    if (stageJump) {
      switchView('customers');
      $('#stageFilter').value = stageJump.dataset.stageJump;
      renderCustomers();
    }
    if (event.target.closest('[data-close-drawer]')) closeDrawer();
    if (event.target.closest('[data-close-modal]')) closeModal();
    const activity = event.target.closest('[data-activity]');
    if (activity) {
      state.activityType = activity.dataset.activity;
      $$('.activity-type').forEach(item => item.classList.toggle('active', item === activity));
      $('#activityForm [name=activityType]').value = state.activityType;
      $('#rfqFields').classList.toggle('hidden', state.activityType !== 'rfq');
    }
    if (event.target.closest('#quickUpdateBtn')) openActivityModal();
    if (event.target.closest('#newCustomerBtn')) openNewCustomerModal();
    if (event.target.closest('#drawerUpdateBtn')) openActivityModal(state.selectedCustomerId);
    if (event.target.closest('[data-add-quote]')) openQuoteModal(state.selectedCustomerId);
    if (event.target.closest('[data-add-order]')) openOrderModal(state.selectedCustomerId);
    if (event.target.closest('[data-edit-account]')) openEditAccountModal(state.selectedCustomerId);
    const evaluateCompanyId = event.target.closest('[data-evaluate-company-id]');
    if (evaluateCompanyId) {
      state.selectedCustomerId = evaluateCompanyId.dataset.evaluateCompanyId;
      openEvaluationModal('company');
    }
    if (event.target.closest('[data-evaluate-company]')) openEvaluationModal('company');
    const evaluateContact = event.target.closest('[data-evaluate-contact]');
    if (evaluateContact) openEvaluationModal('contact', evaluateContact.dataset.evaluateContact);
    if (event.target.closest('[data-add-contact]')) openContactModal();
    const retryEvaluation = event.target.closest('[data-retry-evaluation]');
    if (retryEvaluation) {
      try {
        toast('正在重新生成AI标注…');
        const result = await api(`/api/sales-crm/evaluations/${encodeURIComponent(retryEvaluation.dataset.retryEvaluation)}/retry`, { method: 'POST', body: '{}' });
        await refresh(result.aiWarning ? 'AI标注仍未成功，请稍后再试' : 'AI标注已重新生成');
      } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#newUserBtn')) openUserModal();
    if (event.target.closest('#changePasswordBtn')) openPasswordModal();
    if (event.target.closest('#intakeSettingsBtn')) openIntakeSettingsModal();
    if (event.target.closest('#bulkAssignIntakeBtn')) {
      try {
        const result = await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify({ action: 'bulk_assign' }) });
        await refresh(`批量分配完成：已分配 ${result.assigned} 个客户`);
      } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#scanIntakeBtn')) {
      try {
        const result = await api('/api/sales-crm/intake/scan', { method: 'POST', body: '{}' });
        await refresh(`同步完成：入库 ${result.imported}，分配 ${result.assigned}，跳过 ${result.skipped}`);
      } catch (error) { toast(error.message); }
    }
    const intakeTab = event.target.closest('[data-intake-status]');
    if (intakeTab) {
      state.intakeStatus = intakeTab.dataset.intakeStatus;
      $$('#intakeTabs button').forEach(item => item.classList.toggle('active', item === intakeTab));
      renderIntake();
    }
    const assignIntake = event.target.closest('[data-intake-assign]');
    if (assignIntake) openIntakeAssignModal(assignIntake.dataset.intakeAssign);
    const intakeAction = event.target.closest('[data-intake-action]');
    if (intakeAction) {
      const action = intakeAction.dataset.intakeAction;
      const itemId = intakeAction.dataset.itemId;
      if (['return', 'reject'].includes(action)) openIntakeReasonModal(itemId, action);
      else {
        try {
          await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify({ action, itemId, ownerId: intakeAction.dataset.ownerId || '' }) });
          await refresh(action === 'claim' ? '客户已领取，请在规定时间内完成首次触达' : '客户已分配');
        } catch (error) { toast(error.message); }
      }
    }
    const team = event.target.closest('[data-team-user]');
    if (team) {
      state.teamUserId = team.dataset.teamUser;
      renderTeam();
      $('#teamDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const alertTab = event.target.closest('[data-severity]');
    if (alertTab) {
      state.alertSeverity = alertTab.dataset.severity;
      $$('#alertTabs button').forEach(item => item.classList.toggle('active', item === alertTab));
      renderAlerts();
    }
    const toggleUser = event.target.closest('[data-toggle-user]');
    if (toggleUser) {
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(toggleUser.dataset.toggleUser)}`, { method: 'PATCH', body: JSON.stringify({ active: toggleUser.dataset.active !== '1' }) });
        await refresh('用户状态已更新');
      } catch (error) { toast(error.message); }
    }
    const editPermissions = event.target.closest('[data-edit-permissions]');
    if (editPermissions) openPermissionModal(editPermissions.dataset.editPermissions);
    const resolveReview = event.target.closest('[data-resolve-review]');
    if (resolveReview) {
      const reviewId = resolveReview.dataset.resolveReview;
      const ownerId = document.querySelector(`[data-review-owner="${CSS.escape(reviewId)}"]`)?.value || '';
      try {
        await api(`/api/sales-crm/migration-review/${encodeURIComponent(reviewId)}`, { method: 'POST', body: JSON.stringify({ ownerId }) });
        await refresh('旧跟进已迁移到统一客户档案');
      } catch (error) { toast(error.message); }
    }
  });

  function switchView(view) {
    if (!viewMeta[view]) return;
    const permission = `view_${view}`;
    if (!can(permission)) return toast('当前账号没有该模块权限');
    state.view = view;
    $$('.view').forEach(item => item.classList.toggle('active', item.id === `${view}View`));
    $$('#nav [data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    $('#viewEyebrow').textContent = viewMeta[view][0];
    $('#viewTitle').textContent = viewMeta[view][1];
    document.body.classList.toggle('development-active', view === 'development');
    if (view === 'development') renderDevelopment();
    closeDrawer();
    document.body.classList.remove('sidebar-open');
    if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  }

  ['countryFilter', 'ownerFilter', 'periodFilter'].forEach(id => document.addEventListener('change', event => {
    if (event.target.id === id) renderAll();
  }));
  ['customerSearch', 'stageFilter', 'priorityFilter', 'onlyOverdue'].forEach(id => document.addEventListener(id === 'customerSearch' ? 'input' : 'change', event => {
    if (event.target.id === id) renderCustomers();
  }));
  document.addEventListener('input', event => {
    if (event.target.id === 'insightSearch') renderInsightsHub();
    if (event.target.id === 'poolSearch') renderUnifiedPool();
    if (event.target.id === 'peopleSearch') renderUnifiedPeople();
    if (event.target.id === 'reconSearch') renderUnifiedRecon();
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'insightCoverageFilter') renderInsightsHub();
    if (['poolGroupFilter','poolCrmFilter'].includes(event.target.id)) renderUnifiedPool();
    if (event.target.id === 'peopleLevelFilter') renderUnifiedPeople();
    if (event.target.matches('#userForm select[name="role"]')) {
      const defaults = state.data.rolePermissions?.[event.target.value] || {};
      Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
        const input = document.querySelector(`#userForm [name="permission__${CSS.escape(key)}"]`);
        if (input) input.checked = Boolean(defaults[key]);
      });
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/sales-auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    location.reload();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeModal(); closeDrawer(); document.body.classList.remove('sidebar-open'); }
  });
  $('#salesMenuBtn').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#salesSidebarMask').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  window.addEventListener('hashchange', () => {
    const view = location.hash.replace(/^#/, '');
    if (viewMeta[view] && state.data) switchView(view);
  });

  load();
})();

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
    intakePage: 1,
    intakePageSize: 100,
    intakeTotal: 0,
    intakeHasMore: false,
    intakeLoading: false,
    intakeSearchTimer: null,
    stageReached: '',
    teamUserId: '',
    activityType: 'email',
    drawerAiContext: null,
    customerProfileReturnView: 'customers',
    customerProfileExternalId: '',
    customerAi: null,
    customerAiError: '',
    customerAiLoading: false,
    customerAiPending: false,
    customerAiTimer: null,
    customerAiPollCount: 0,
    selectedCustomerIds: new Set(),
    recycleKind: 'sales_return',
    recycleBin: { rows: [], page: 1, pageSize: 100, total: 0, hasMore: false, loading: false },
    customerEnrichment: null,
    customerEnrichmentLastSuccess: null,
    customerEnrichmentError: '',
    customerEnrichmentPending: false,
    aiTasks: {
      items: [], page: 1, pageSize: 20, total: 0, overview: null,
      loaded: false, loading: false, error: '',
    },
    loginPending: false,
    impersonationTimer: null,
    impersonationRecovery: false,
    maintenancePreview: null,
    maintenanceRuns: [],
    assistantRuntime: null,
    assistantRuntimeError: '',
    assistantRuntimePending: false,
    aiFeatures: null,
    aiFeaturesError: '',
    aiFeaturePending: '',
    research: {
      pool: { page: 0, total: 0, hasMore: false, loading: false, loaded: false, reloadPending: false },
      people: { page: 0, total: 0, hasMore: false, loading: false, loaded: false, reloadPending: false },
      recon: { page: 0, total: 0, hasMore: false, loading: false, loaded: false, reloadPending: false },
    },
  };

  const viewMeta = {
    dashboard: ['MANAGEMENT OVERVIEW', '经营驾驶舱'],
    intake: ['DAILY LEAD DELIVERY', '未开发线索分配'],
    pending: ['CUSTOMER INTAKE', '待领取'],
    claimed: ['CUSTOMER INTAKE', '已领取'],
    customers: ['CRM CUSTOMER PORTFOLIO', 'CRM客户全景'],
    recycleBin: ['CUSTOMER RECYCLE BIN', '客户回收站'],
    customerProfile: ['CUSTOMER PROFILE', '客户资料'],
    pool: ['UNDEVELOPED LEAD POOL', '未开发线索池'],
    contacts: ['CONTACT EVIDENCE', '负责人线索'],
    recon: ['RECON INTELLIGENCE', 'Recon 情报'],
    pipeline: ['PIPELINE CONTROL', '推进管道'],
    alerts: ['TODAY TASKS', '今日待办'],
    aiTasks: ['AI CONTROL PLANE', 'AI任务中心'],
    insights: ['MANAGER INTELLIGENCE', '经理评价'],
    team: ['CAPABILITY REVIEW', '销售能力'],
    markets: ['MARKET INTELLIGENCE', '市场策略'],
    users: ['ACCESS CONTROL', '用户与权限'],
    maintenance: ['DATA MAINTENANCE', '数据维护'],
  };
  const viewPermissions = {
    pending: 'view_intake', claimed: 'view_intake', customerProfile: 'view_customers',
    recycleBin: 'manage_customer_recycle',
    aiTasks: 'view_customers', maintenance: 'manage_data_maintenance',
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
  function customerAIEnabled() {
    return Boolean(state.data?.features?.aiStations);
  }
  function salesPackEnabled() {
    return Boolean(state.data?.features?.salesPack);
  }
  function roleLabel(role) {
    return ({ admin: '系统管理员', manager: '销售经理', sales: '销售代表' })[role] || role || '—';
  }
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2300);
  }
  function clearForbiddenState() {
    if (!state.data) return;
    Object.assign(state.data, {
      accounts: [], activities: [], rfqs: [], quotes: [], orders: [], alerts: [],
      countryReport: [], cohortReport: [], teamReport: [], funnel: [], summary: {},
      intake: { settings: {}, stats: {}, items: [], batches: [] },
      insights: { contacts: [], evaluations: [] }, customerEvaluationTags: [], customerPool: [], people: [], reconResults: [],
      researchTotals: { pool: 0, poolAvailable: 0, people: 0, recon: 0 },
    });
    state.selectedCustomerId = '';
    resetResearchState();
    setTimeout(() => load(), 0);
  }

  function handleImpersonationEnded() {
    if (state.impersonationRecovery) return;
    state.impersonationRecovery = true;
    clearInterval(state.impersonationTimer);
    state.impersonationTimer = null;
    if (state.data) {
      Object.assign(state.data, {
        accounts: [], activities: [], rfqs: [], quotes: [], orders: [], alerts: [],
        countryReport: [], cohortReport: [], teamReport: [], funnel: [], summary: {},
        intake: { settings: {}, stats: {}, items: [], batches: [] },
        insights: { contacts: [], evaluations: [] }, customerEvaluationTags: [], customerPool: [], people: [], reconResults: [],
        users: state.data.user ? [state.data.user] : [], auditLog: [], migrationReview: [],
        researchTotals: { pool: 0, poolAvailable: 0, people: 0, recon: 0 }, impersonation: null,
      });
    }
    state.selectedCustomerId = '';
    resetResearchState();
    closeModal();
    toast('身份检查已结束，正在恢复管理员账号');
    setTimeout(() => { state.impersonationRecovery = false; void load(); }, 800);
  }

  function renderImpersonationBanner() {
    clearInterval(state.impersonationTimer);
    state.impersonationTimer = null;
    const banner = $('#impersonationBanner');
    if (!banner) return;
    const context = state.data?.impersonation;
    banner.classList.toggle('hidden', !context);
    if (!context) return;
    $('#impersonationTitle').textContent = `正在以 ${state.data.user.name}（${roleLabel(state.data.user.role)}）身份检查`;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((new Date(context.expiresAt.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000));
      $('#impersonationRemaining').textContent = `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      if (!seconds) load();
    };
    tick();
    state.impersonationTimer = setInterval(tick, 1000);
  }

  async function startIdentityInspection(userId) {
    await api('/api/sales-crm/impersonation/start', { method: 'POST', body: JSON.stringify({ targetUserId: userId }) });
    closeModal();
    await load();
    toast('已进入身份检查，所有操作将以该账号权限执行');
  }

  async function stopIdentityInspection() {
    await api('/api/sales-crm/impersonation/stop', { method: 'POST', body: '{}' });
    clearInterval(state.impersonationTimer);
    state.impersonationTimer = null;
    await load();
    toast('已返回管理员账号');
  }
  async function api(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs || 0);
    const controller = timeoutMs ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        signal: controller?.signal || options.signal,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const error = new Error(result.error || '请求失败');
        error.status = response.status;
        error.code = result.code || '';
        error.details = result;
        if (error.code === 'IMPERSONATION_ENDED') handleImpersonationEnded();
        else if (error.status === 403 && error.code !== 'IMPERSONATION_ACTION_BLOCKED') clearForbiddenState();
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，请检查网络后重试');
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function setLoginState(stage = '') {
    const form = $('#loginForm');
    const button = form?.querySelector('button[type=submit]');
    const status = $('#loginStatus');
    const labels = { login: '正在登录…', workspace: '正在加载工作台…' };
    if (button) {
      button.disabled = Boolean(stage);
      button.textContent = labels[stage] || '进入系统';
    }
    if (form) form.setAttribute('aria-busy', stage ? 'true' : 'false');
    if (status) status.textContent = stage === 'login' ? '正在验证账号，请稍候。' : stage === 'workspace' ? '账号已验证，正在载入首页数据。' : '';
  }

  function resetResearchState() {
    for (const [kind, meta] of Object.entries(state.research)) {
      Object.assign(meta, { page: 0, total: Number(state.data?.researchTotals?.[kind] || 0), hasMore: false, loading: false, loaded: false, reloadPending: false });
    }
  }

  async function load({ fromLogin = false } = {}) {
    try {
      state.data = await api('/api/sales-crm/bootstrap', { timeoutMs: 15000 });
      state.assistantRuntime = null;
      state.assistantRuntimeError = '';
      state.assistantRuntimePending = false;
      state.aiFeatures = null;
      state.aiFeaturesError = '';
      state.aiFeaturePending = '';
      resetResearchState();
      $('#loginScreen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      applyUser();
      populateFilters();
      renderAll();
      renderImpersonationBanner();
      if (can('manage_users') && !state.data.impersonation) {
        void loadAssistantRuntime();
        void loadAIFeatures();
      }
      const requestedView = location.hash.replace(/^#/, '');
      const requestedCustomerId = new URLSearchParams(location.search).get('customer') || '';
      const requestedPermission = viewPermissions[requestedView] || `view_${requestedView}`;
      const firstAllowedView = Object.keys(viewMeta).find(view => can(viewPermissions[view] || `view_${view}`)) || 'dashboard';
      const salesLanding = !requestedView && !can('manage_intake') && Number(state.data.intake?.stats?.assigned || 0) > 0
        ? 'pending'
        : firstAllowedView;
      switchView(viewMeta[requestedView] && can(requestedPermission) ? requestedView : salesLanding, false);
      if (requestedView === 'customerProfile') {
        if (requestedCustomerId) openCustomerProfile(requestedCustomerId);
        else switchView('customers');
      }
      return true;
    } catch (error) {
      if (error.status === 401) {
        $('#app').classList.add('hidden');
        $('#loginScreen').classList.remove('hidden');
        return false;
      } else {
        if (fromLogin) throw error;
        toast(error.message);
        return false;
      }
    }
  }

  function applyUser() {
    const user = state.data.user;
    $('#userName').textContent = user.name;
    $('#userRole').textContent = ({ admin: '系统管理员', manager: '销售经理', sales: '销售代表' })[user.role];
    $('#userAvatar').textContent = user.name.slice(0, 1);
    $$('[data-permission]').forEach(el => el.classList.toggle('hidden', !can(el.dataset.permission)));
    if ($('#navIntakeLabel')) $('#navIntakeLabel').textContent = can('manage_intake') ? '线索分配' : '我的线索';
    $('#nav [data-view="aiTasks"]')?.classList.toggle('hidden', !customerAIEnabled() || !can('view_customers'));
    if (state.data.impersonation) {
      $$('#nav [data-view="users"], #nav [data-view="maintenance"], #newUserBtn, #newPermissionGroupBtn, #changePasswordBtn').forEach(el => el.classList.add('hidden'));
    }
    $$('#nav .nav-group').forEach(group => {
      const buttons = $$('button[data-view]').filter(button => group.contains(button));
      group.classList.toggle('hidden', buttons.length > 0 && buttons.every(button => button.classList.contains('hidden')));
    });
    $('#ownerFilter').classList.toggle('hidden', !can('view_all_customers'));
    $('#bulkReturnCustomers')?.classList.toggle('hidden', !can('manage_customer_recycle') || Boolean(state.data.impersonation));
  }

  function populateFilters() {
    const country = $('#countryFilter').value;
    const owner = $('#ownerFilter').value;
    const countries = [...new Set(state.data.accounts.map(item => item.country).filter(Boolean))].sort();
    $('#countryFilter').innerHTML = '<option value="">全部国家</option>' + countries.map(item => `<option>${esc(item)}</option>`).join('');
    $('#countryFilter').value = country;
    const activeSales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    $('#ownerFilter').innerHTML = '<option value="">全部负责人</option><option value="__unassigned__">不分配</option>' + activeSales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
    $('#ownerFilter').value = [...$('#ownerFilter').options].some(option => option.value === owner) ? owner : '';
    const bulkOwner = $('#bulkCustomerOwner');
    if (bulkOwner) {
      const selected = bulkOwner.value;
      bulkOwner.innerHTML = '<option value="">请选择销售</option>' + activeSales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
      bulkOwner.value = [...bulkOwner.options].some(option => option.value === selected) ? selected : '';
    }
    $('#stageFilter').innerHTML = '<option value="">全部阶段</option>' + state.data.stages.map(stage => `<option value="${stage.key}">${esc(stage.label)}</option>`).join('');
    const tags = [...new Set((state.data.customerEvaluationTags || []).flatMap(item => item.labels || []))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
    const tagFilter = $('#evaluationTagFilter');
    tagFilter.innerHTML = tags.length
      ? '<option value="">全部评价标签</option>' + tags.map(label => `<option value="${esc(label)}">${esc(label)}</option>`).join('')
      : '<option value="">暂无评价标签</option>';
    tagFilter.disabled = !tags.length;
  }

  function scopedAccounts() {
    const country = $('#countryFilter')?.value || '';
    const owner = $('#ownerFilter')?.value || '';
    return state.data.accounts.filter(account =>
      (!country || account.country === country)
      && (!owner || (owner === '__unassigned__' ? !account.owner_id : account.owner_id === owner)));
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
    if ($('#navCustomerCount')) $('#navCustomerCount').textContent = state.data.accounts.length;
    if ($('#navAlertCount')) $('#navAlertCount').textContent = state.data.alerts.filter(item => item.severity === 'critical').length;
    if ($('#navIntakeCount')) $('#navIntakeCount').textContent = (state.data.intake?.stats.assigned || 0) + (state.data.intake?.stats.pending || 0) + (state.data.intake?.stats.approved || 0);
    if ($('#navPendingCount')) $('#navPendingCount').textContent = state.data.intake?.stats.assigned || 0;
    if ($('#navClaimedCount')) $('#navClaimedCount').textContent = state.data.intake?.stats.claimed || 0;
    if ($('#navInsightCount')) $('#navInsightCount').textContent = state.data.insights?.evaluations.length || 0;
    if ($('#navPoolCount')) $('#navPoolCount').textContent = state.data.researchTotals?.pool || 0;
    if ($('#navPeopleCount')) $('#navPeopleCount').textContent = state.data.researchTotals?.people || 0;
    if ($('#navRecycleCount')) $('#navRecycleCount').textContent = state.recycleBin.total || 0;
    if ($('#lastRefresh')) $('#lastRefresh').textContent = `更新于 ${shortDate(state.data.generatedAt, true)}`;
    renderDashboard();
    renderIntake();
    renderCustomers();
    if (state.view === 'recycleBin') void loadRecycleBin();
    renderUnifiedPool();
    renderUnifiedPeople();
    renderUnifiedRecon();
    renderPipeline();
    renderAlerts();
    renderInsightsHub();
    renderTeam();
    renderMarkets();
    renderUsers();
    renderMaintenance();
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
      ['未开发线索', state.data.researchTotals?.poolAvailable || 0, '等待每日分配', ''],
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
      return `<div class="funnel-row" data-stage-jump="${item.key}" title="到达过该阶段的客户数，点击查看累计口径列表">
        <span class="funnel-label">${esc(item.label)}</span><div class="funnel-track"><div class="funnel-bar" style="width:${item.count / max * 100}%"></div></div>
        <span class="funnel-count">${item.count}</span><span class="funnel-rate">${percent(item.count, previous)}</span>
      </div>`;
    }).join('');
    const ids = new Set(accounts.map(item => item.id));
    const attention = state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId)).slice(0, 5);
    $('#attentionList').innerHTML = attention.length ? attention.map(item => `<div class="attention-item" ${item.intakeItemId ? `data-intake-profile="${esc(item.intakeItemId)}"` : `data-open-customer="${esc(item.customerId)}"`}>
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
    return `<table ${attrs}><thead><tr>${headers.map(item => `<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr${row._attrs ? ` ${row._attrs}` : ''}>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  const researchConfig = {
    pool: { dataKey: 'customerPool', render: renderUnifiedPool, button: '#poolLoadMore' },
    people: { dataKey: 'people', render: renderUnifiedPeople, button: '#peopleLoadMore' },
    recon: { dataKey: 'reconResults', render: renderUnifiedRecon, button: '#reconLoadMore' },
  };

  function researchQuery(kind) {
    if (kind === 'pool') return {
      search: $('#poolSearch')?.value || '',
      group: $('#poolGroupFilter')?.value || '',
      crm: $('#poolCrmFilter')?.value || '',
    };
    if (kind === 'people') return { search: $('#peopleSearch')?.value || '', level: $('#peopleLevelFilter')?.value || '' };
    return { search: $('#reconSearch')?.value || '' };
  }

  function updateResearchButton(kind) {
    const meta = state.research[kind];
    const button = $(researchConfig[kind].button);
    if (!button) return;
    button.classList.toggle('hidden', !meta.loaded || !meta.hasMore);
    button.disabled = meta.loading;
    button.textContent = meta.loading ? '正在加载…' : `继续加载（已显示 ${state.data[researchConfig[kind].dataKey].length} / ${meta.total}）`;
  }

  async function loadResearch(kind, { reset = false } = {}) {
    const config = researchConfig[kind];
    const meta = state.research[kind];
    if (!config) return;
    if (meta.loading) {
      if (reset) meta.reloadPending = true;
      return;
    }
    if (reset) {
      state.data[config.dataKey] = [];
      Object.assign(meta, { page: 0, total: 0, hasMore: false, loaded: false });
    }
    meta.loading = true;
    config.render();
    updateResearchButton(kind);
    try {
      const params = new URLSearchParams({ page: String(meta.page + 1), pageSize: '100' });
      Object.entries(researchQuery(kind)).forEach(([key, value]) => { if (value) params.set(key, value); });
      const result = await api(`/api/sales-crm/research/${kind}?${params}`, { timeoutMs: 12000 });
      state.data[config.dataKey] = reset ? result.rows : [...state.data[config.dataKey], ...result.rows];
      Object.assign(meta, { page: result.page, total: result.total, hasMore: result.hasMore, loaded: true });
    } catch (error) {
      toast(error.message);
    } finally {
      meta.loading = false;
      config.render();
      updateResearchButton(kind);
      if (meta.reloadPending) {
        meta.reloadPending = false;
        void loadResearch(kind, { reset: true });
      }
    }
  }

  function researchLoading(kind) {
    const meta = state.research[kind];
    if (meta.loading && !meta.loaded) return '<div class="empty">正在加载数据…</div>';
    if (!meta.loaded) return '<div class="empty">进入本模块后加载数据</div>';
    return '';
  }

  function scheduleResearchReload(kind) {
    clearTimeout(scheduleResearchReload.timers?.[kind]);
    scheduleResearchReload.timers ||= {};
    scheduleResearchReload.timers[kind] = setTimeout(() => loadResearch(kind, { reset: true }), 300);
  }

  function renderUnifiedPool() {
    const root = $('#unifiedPoolTable');
    if (!root) return;
    const loading = researchLoading('pool');
    if (loading) { root.innerHTML = loading; $('#poolResultCount').textContent = ''; return; }
    const rows = state.data.customerPool || [];
    $('#poolResultCount').textContent = `已显示 ${rows.length} / ${state.research.pool.total} 条未开发线索`;
    root.innerHTML = table(['线索企业','国家/行业','分组','联系人质量','线索状态','分配销售','资料'], rows.map(item => [
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
    const loading = researchLoading('people');
    if (loading) { root.innerHTML = loading; $('#peopleResultCount').textContent = ''; return; }
    const rows = state.data.people || [];
    $('#peopleResultCount').textContent = `已显示 ${rows.length} / ${state.research.people.total} 条线索`;
    root.innerHTML = table(['客户','联系人','职位/部门','等级','直接联系方式','证据状态'], rows.map(item => [
      `<div class="company-cell"><strong>${esc(item.company_name || item.customer_id)}</strong><span>${esc(item.customer_id)}</span></div>`,
      `<strong>${esc(item.name || item.full_name || item.full_name_local || '未识别')}</strong>`,
      `${esc(item.title || '未标注')}<br><span class="subtle">${esc(item.department || '')}</span>`,
      `<span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span>`,
      esc(item.methods_summary || '未找到直接联系方式'),
      item.sales_ready ? '<span class="good-text">可交付销售</span>' : '<span class="subtle">仍需验证</span>',
    ]));
  }

  function renderUnifiedRecon() {
    const root = $('#unifiedReconTable');
    if (!root) return;
    const loading = researchLoading('recon');
    if (loading) { root.innerHTML = loading; $('#reconResultCount').textContent = ''; return; }
    const rows = state.data.reconResults || [];
    $('#reconResultCount').textContent = `已显示 ${rows.length} / ${state.research.recon.total} 份结果`;
    root.innerHTML = table(['客户','评分/分组','客户画像','需求与机会','联系人','报告'], rows.map(item => [
      `<div class="company-cell"><strong>${esc(item.company_name || item.customer_id)}</strong><span>${esc(item.customer_id)}</span></div>`,
      `<span class="pill">${esc(item.score || '—')} · ${esc(item.current_pool || '未分池')}</span>`,
      `<span>${esc(item.customer_type || item.industry || '待确认')}</span>`,
      `<span>${esc(item.opportunity_summary || item.next_action || '待确认')}</span>`,
      `<span>${esc(item.contacts_summary || item.contact_name || '未找到')}</span>`,
      item.job_id && can('view_recon') && can('view_contacts') ? `<a class="text-button" href="/api/report?job_id=${encodeURIComponent(item.job_id)}" target="_blank">查看报告</a>` : '<span class="subtle">已关联档案</span>',
    ]));
  }

  function intakeStatusLabel(status) {
    return ({ pending: '待审核', approved: '待分配', assigned: '待领取', claimed: '已领取', returned: '已退回', rejected: '不对口', duplicate: '重复客户' })[status] || status;
  }

  function intakeSignals(item) {
    const signals = item.signals || {};
    const fit = signals.fit || {};
    const readiness = signals.readiness || {};
    return {
      fitScore: fit.fitScore ?? item.match_score ?? '—',
      fitGrade: fit.grade || item.match_group || '—',
      fitConfidence: fit.confidence == null ? null : Number(fit.confidence),
      readiness: readiness.readiness || '未评估',
      priority: signals.priority || item.match_group || '—',
      riskStatus: signals.riskStatus || '',
    };
  }

  function intakeDecisionLayers(item) {
    const arbitration = item.arbitration || {};
    const ai = arbitration.aiRecommendation || {};
    const rule = arbitration.ruleDecision || {};
    const manual = arbitration.manualDecision || null;
    const ranked = Array.isArray(ai.rankedCandidates) ? ai.rankedCandidates : [];
    const ranking = ranked.length
      ? ranked.slice(0, 3).map((candidate, index) =>
        `<span class="ranked-candidate"><b>${index + 1}</b>${esc(candidate.name || candidate.userId)}<small>${Number(candidate.score || 0)}分</small></span>`).join('')
      : `<span class="subtle">${esc(ai.available === false ? `AI未提供排名${ai.reasonCode ? ` · ${ai.reasonCode}` : ''}` : '暂无候选排名')}</span>`;
    return {
      ai: `<div class="decision-layer"><span>AI 推荐</span><strong>${ranking}</strong><small>${ai.confidence == null ? '—' : `置信度 ${(Number(ai.confidence) * 100).toFixed(0)}%`}${ai.reviewRequired ? ' · 建议复核' : ''}</small></div>`,
      rule: `<div class="decision-layer"><span>规则裁决</span><strong>${esc(rule.disposition === 'manager_review' ? '经理审批' : rule.disposition === 'blocked' ? '规则阻止' : rule.disposition === 'assign' ? '可分配' : '待裁决')}</strong><small>${esc(rule.reason || item.decision_reason || '暂无')}</small></div>`,
      manual: `<div class="decision-layer"><span>人工最终决定</span><strong>${manual ? esc(manual.ownerId || (manual.status === 'rejected' ? '不对口' : manual.status === 'returned' ? '退回' : manual.status)) : '尚未操作'}</strong><small>${esc(manual?.reason || (manual ? manual.action : '等待经理处理'))}</small></div>`,
    };
  }

  function intakeAuditMarkup(item) {
    const history = Array.isArray(item.assignmentAudit) ? item.assignmentAudit : [];
    if (!history.length) return '<span class="subtle">暂无裁决审计记录</span>';
    return history.slice(0, 8).map(entry => {
      const label = entry.type === 'arbitration' ? '规则裁决' : entry.type === 'manual' ? '人工操作' : entry.type;
      const detail = entry.type === 'manual'
        ? entry.manualDecision?.reason || entry.manualDecision?.action || ''
        : entry.ruleDecision?.reason || '';
      return `<div class="audit-line"><strong>${esc(label)}</strong><span>${esc(detail)} · ${esc(entry.actorName || entry.actorId || '系统')}</span><time>${esc(shortDate(entry.createdAt, true))}</time></div>`;
    }).join('');
  }

  async function loadIntakePage({ reset = false } = {}) {
    if (state.intakeLoading) return;
    if (reset) {
      state.intakePage = 1;
      state.intakeTotal = 0;
      state.intakeHasMore = false;
    }
    state.intakeLoading = true;
    renderIntake();
    try {
      const nextPage = reset ? 1 : state.intakePage + 1;
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(state.intakePageSize),
      });
      const search = ($('#intakeSearch')?.value || '').trim();
      const country = $('#countryFilter')?.value || '';
      const owner = $('#ownerFilter')?.value || '';
      if (search) params.set('search', search);
      if (country) params.set('country', country);
      if (owner) params.set('owner', owner);
      if (state.intakeStatus) params.set('status', state.intakeStatus);
      const result = await api(`/api/sales-crm/intake?${params}`, { timeoutMs: 12000 });
      const previousItems = reset ? [] : (state.data.intake?.items || []);
      state.data.intake = { ...result, items: [...previousItems, ...(result.items || [])] };
      state.intakePage = result.page;
      state.intakeTotal = result.total;
      state.intakeHasMore = result.hasMore;
    } catch (error) {
      toast(error.message);
    } finally {
      state.intakeLoading = false;
      renderIntake();
    }
  }

  function renderIntake() {
    const intake = state.data.intake;
    if (!intake) return;
    $$('#intakeTabs button').forEach(item => item.classList.toggle('active', item.dataset.intakeStatus === state.intakeStatus));
    const salesView = !can('manage_intake');
    $('#intakeHeading').textContent = salesView ? '我的每日未开发线索' : '未开发线索每日分配中心';
    $('#intakeSubheading').textContent = salesView
      ? '这里都是公司分配给你的未开发线索；领取后才进入你的 CRM 客户，并开始计算首次触达时限。'
      : `线索池与 CRM 严格分开；当前筛选共 ${intake.total ?? intake.items.length} 条线索，风险项待审核，其余按配额自动推送；销售领取后才创建 CRM 客户。`;
    $('#intakeManagerActions').classList.toggle('hidden', salesView || Boolean(state.data.impersonation));
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
    const items = intake.items || [];
    $('#intakeTable').innerHTML = table(
      ['未开发线索', 'Fit / readiness / 优先级', '候选销售排名', '联系质量 / 联系人', '规则裁决 / 阻断原因', '状态 / 时限', '操作'],
      items.map(item => {
        let actions = '';
        if (salesView && item.status === 'assigned') actions = `<div class="assignment-actions"><button class="button primary tiny" data-intake-action="claim" data-item-id="${item.id}" data-idempotency-key="${esc(proposalRequestId())}">领取客户</button><button class="button secondary tiny" data-intake-action="return" data-item-id="${item.id}">退回</button><button class="text-button" data-intake-action="reject" data-item-id="${item.id}">不对口</button></div>`;
        else if (salesView && item.status === 'claimed') actions = item.crm_customer_id ? `<button class="text-button" data-open-customer="${item.crm_customer_id}">开始跟进 →</button>` : '—';
        else if (!salesView && ['pending', 'approved', 'returned'].includes(item.status)) {
          const suggested = item.suggested_owner_id && item.suggested_owner_name
            ? `<button class="button primary tiny" data-intake-action="assign" data-item-id="${item.id}" data-owner-id="${item.suggested_owner_id}">按建议分配</button>`
            : '';
          actions = `<div class="assignment-actions">${suggested}<button class="button secondary tiny" data-intake-assign="${item.id}">指定销售</button></div>`;
        }
        else if (!salesView && ['assigned', 'claimed'].includes(item.status)) actions = `<button class="text-button" data-intake-assign="${item.id}">重新分配</button>`;
        else actions = '—';
        const statusClass = item.status === 'returned' || item.status === 'rejected' ? 'red' : item.status === 'assigned' ? 'amber' : item.status === 'claimed' ? '' : 'gray';
        const signals = intakeSignals(item);
        const layers = intakeDecisionLayers(item);
        const evidence = jsonList(item.evidence_urls).filter(url => /^https?:\/\//i.test(url));
        const sources = [
          item.report_url ? `<a class="text-button" href="${esc(item.report_url)}" target="_blank" rel="noopener">背调报告</a>` : '',
          ...evidence.map((url, index) => `<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener">证据${index + 1}</a>`),
        ].filter(Boolean).join(' · ');
        const row = [
          `<div class="company-cell"><strong>${esc(item.company_name)}</strong><span>${esc(item.external_customer_id)} · ${esc(item.country || '—')} · ${esc(item.customer_type || item.industry || '—')}</span><span>${sources}</span></div>`,
          `<div class="intake-signal-cell"><div><span class="score-badge">${esc(signals.fitScore)}</span><span class="pill">${esc(signals.fitGrade)}</span></div><span>${esc(signals.readiness)} · 优先级 ${esc(signals.priority)}</span>${signals.fitConfidence == null ? '' : `<small>Fit置信度 ${(signals.fitConfidence * 100).toFixed(0)}%</small>`}</div>`,
          `<div class="ranked-candidates">${layers.ai}</div>`,
          `<div class="intake-contact"><strong><span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span> ${esc(item.contact_name || '暂无具名联系人')}</strong><span>${esc(item.contact_title || '')}</span><span>${esc(item.contact_methods || '需要继续寻找联系方式')}</span></div>`,
          `<div class="decision-stack"><strong>${esc(item.assigned_owner_name || item.suggested_owner_name || '暂无可用配额')}</strong>${layers.rule}<span class="decision-block">${esc(item.decision_reason || signals.riskStatus || '')}</span></div>`,
          `<div class="assignment-cell"><span class="pill ${statusClass}">${intakeStatusLabel(item.status)}</span><span class="${item.status === 'assigned' && item.claim_due_at < state.data.generatedAt ? 'overdue-text' : 'subtle'}">${item.claim_due_at ? `领取截止 ${shortDate(item.claim_due_at, true)}` : esc(item.return_reason || '')}</span></div>`,
          actions,
        ];
        row._attrs = item.crm_customer_id
          ? `data-customer="${esc(item.crm_customer_id)}"`
          : `data-intake-profile="${esc(item.id)}"`;
        return row;
      }),
    );
    $('#intakeBatchTable').innerHTML = table(
      ['日期', '来源', '候选', '入库', '已分配', '跳过', '状态'],
      intake.batches.map(batch => [
        esc(batch.batch_date), esc(batch.source), batch.candidate_count, batch.imported_count, batch.assigned_count, batch.skipped_count,
        `<span class="pill ${batch.status === 'done' ? '' : 'amber'}">${batch.status === 'done' ? '完成' : batch.status}</span>`,
      ]),
    );
    const pager = $('#intakePagination');
    if (pager) {
      pager.classList.toggle('hidden', !state.intakeHasMore && !state.intakeLoading);
      pager.innerHTML = state.intakeLoading
        ? '<span class="subtle">正在加载线索…</span>'
        : `<button class="button secondary tiny" type="button" id="intakeLoadMore" ${state.intakeHasMore ? '' : 'disabled'}>继续加载（已显示 ${items.length} / ${intake.total ?? items.length}）</button>`;
    }
  }

  function openCustomerProfile(externalCustomerId) {
    if (!externalCustomerId) return toast('缺少客户编码，无法打开完整资料');
    const account = state.data.accounts.find(item => item.external_customer_id === externalCustomerId);
    if (!account) return toast('未找到对应客户资料');
    if (state.view !== 'customerProfile') state.customerProfileReturnView = state.view;
    state.customerProfileExternalId = externalCustomerId;
    state.selectedCustomerId = account.id;
    state.customerAiPollCount = 0;
    state.customerEnrichment = null;
    state.customerEnrichmentLastSuccess = null;
    state.customerEnrichmentError = '';
    closeDrawer();
    switchView('customerProfile');
    $('#customerProfileTitle').textContent = account?.company_name || '客户资料';
    $('#customerProfileEdit').classList.toggle('hidden', !can('edit_customer'));
    const frame = $('#customerProfileFrame');
    frame.src = `/development-workbench?embedded=1&profile=1&assistant=0&prospect=0&customer=${encodeURIComponent(externalCustomerId)}`;
    const url = new URL(location.href);
    url.searchParams.set('customer', externalCustomerId);
    url.hash = 'customerProfile';
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    const station = $('#customerAiStation');
    station?.classList.toggle('hidden', !customerAIEnabled());
    if (customerAIEnabled()) void loadCustomerAI(externalCustomerId);
  }

  function returnFromCustomerProfile() {
    clearTimeout(state.customerAiTimer);
    state.customerAiTimer = null;
    state.customerAi = null;
    state.customerAiError = '';
    state.customerAiPollCount = 0;
    state.customerEnrichment = null;
    state.customerEnrichmentLastSuccess = null;
    state.customerEnrichmentError = '';
    state.customerProfileExternalId = '';
    const url = new URL(location.href);
    url.searchParams.delete('customer');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    switchView(state.customerProfileReturnView || 'customers');
  }

  const aiReasonLabels = {
    PRODUCT_MATCH: '产品匹配', INDUSTRY_MATCH: '行业匹配', REGION_MATCH: '区域匹配',
    BUYER_SIGNAL: '采购信号', RECON_STRENGTH: '情报充分', CONTACT_READY: '联系人完备',
    RISK_SIGNAL: '风险信号', DATA_GAP: '数据不足', OTHER: '其他',
  };

  const aiJobLabels = {
    pending_dispatch: ['等待调度', 'amber'], dispatching: ['调度中', 'amber'],
    queued: ['排队中', 'amber'], running: ['分析中', 'amber'], retry_wait: ['等待重试', 'amber'],
    needs_review: ['需要复核', 'amber'], succeeded: ['已完成', ''], failed: ['执行失败', 'red'], dead_letter: ['生成失败', 'red'],
    blocked: ['等待处理', 'amber'], cancel_requested: ['正在取消', 'amber'], cancelled: ['已取消', 'gray'],
    skipped: ['已跳过', 'gray'],
  };
  const CUSTOMER_AI_MAX_POLLS = 48;
  const ENRICHMENT_TERMINAL_STATES = new Set([
    'succeeded', 'needs_review', 'cancelled', 'skipped', 'failed', 'dead_letter',
  ]);
  const enrichmentNodeLabels = {
    recon_dispatch: '企业背调',
    recon_collect: '企业资料归集',
    contact_dispatch: '联系人搜索',
    contact_collect: '联系人归集',
    customer_fit: '客户匹配评分',
    enrichment_finalize: '补全与路由',
  };
  const enrichmentRouteLabels = {
    missing_info: '资料仍不完整',
    needs_review: '等待人工复核',
    pending_assignment: '可进入分配',
  };
  const enrichmentFieldLabels = {
    website: '官网', country: '国家', industry: '行业', customer_type: '客户类型',
    products: '产品与需求', description: '企业简介', rating: '优先级', current_pool: '客户分组',
  };

  function aiReasonLabel(code) {
    return aiReasonLabels[code] || String(code || '').toLowerCase().replaceAll('_', ' ');
  }

  function proposalValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value ?? '');
  }

  function renderCustomerEnrichment() {
    const payload = state.customerEnrichment || state.customerEnrichmentLastSuccess;
    if (!payload?.run) {
      return `<section class="customer-enrichment"><div class="customer-enrichment-empty">
        <span class="pill gray">未启动</span><span>暂无客户资料补全任务</span>
      </div></section>`;
    }
    const run = payload.run;
    const status = aiJobLabels[run.state] || [run.state || '状态未知', 'gray'];
    const nodes = (payload.nodes || []).map(node => {
      const nodeStatus = aiJobLabels[node.state] || [node.state || '等待中', 'gray'];
      return `<li><span>${esc(enrichmentNodeLabels[node.nodeKey] || node.nodeKey)}</span>
        <span class="pill ${nodeStatus[1]}">${esc(nodeStatus[0])}</span>
        ${node.legacyTask?.taskId ? `<button class="text-button" data-open-ai-task="${esc(node.aiJobId || node.legacyTask.taskId)}" type="button">关联任务</button>` : ''}
      </li>`;
    }).join('');
    const visibleEvidence = (payload.evidence || [])
      .filter(item => !(payload.restricted?.contacts && item.contactSensitive));
    const evidence = visibleEvidence.map(item => {
      const sourceUrl = /^https?:\/\//i.test(String(item.sourceUrl || '')) ? item.sourceUrl : '';
      return `<li><div><strong>${esc(item.sourceType || item.nodeKey)}</strong>
        <small>${esc(item.collector || '')} · ${esc(shortDate(item.collectedAt, true))}</small></div>
        <p>${esc(item.summary || '')}</p>
        ${sourceUrl ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noreferrer">查看来源</a>` : ''}</li>`;
    }).join('');
    const canReview = can('edit_customer') && !state.data?.impersonation;
    const proposals = (payload.proposals || []).map(proposal => {
      const review = proposal.state === 'needs_review';
      const provisional = proposal.state === 'auto_applied';
      return `<article class="enrichment-proposal ${review ? 'enrichment-conflict' : ''}">
        <header><strong>${esc(enrichmentFieldLabels[proposal.fieldName] || proposal.fieldName)}</strong>
          ${provisional ? '<span class="pill ai-provisional">AI 暂定</span>' : `<span class="pill ${review ? 'amber' : ''}">${esc(proposal.state)}</span>`}</header>
        <div class="enrichment-before-after"><div><span>当前值</span><p>${esc(proposalValue(proposal.currentValue) || '—')}</p></div>
          <div><span>建议值</span><p>${esc(proposalValue(proposal.proposedValue) || '—')}</p></div></div>
        <small>置信度 ${esc(`${Math.round(Number(proposal.confidence || 0) * 100)}%`)} · ${esc(proposal.reasonCode || 'evidence_backed')}</small>
        ${review && canReview ? `<footer>
          <button class="button primary tiny" type="button" data-review-enrichment-proposal="accepted" data-proposal-id="${esc(proposal.id)}">接受</button>
          <button class="button secondary tiny" type="button" data-review-enrichment-proposal="rejected" data-proposal-id="${esc(proposal.id)}">拒绝</button>
        </footer>` : ''}
      </article>`;
    }).join('');
    const tags = (run.tags || []).map(tag => `<span>${esc(tag)}</span>`).join('');
    const missing = (run.missingItems || []).map(item => esc(enrichmentFieldLabels[item] || item)).join('、');
    return `<section class="customer-enrichment">
      ${state.customerEnrichmentError ? `<div class="ai-task-degraded">补全服务暂不可用，保留上次成功加载的补全结果。${esc(state.customerEnrichmentError)}</div>` : ''}
      <div class="customer-enrichment-summary"><div><span class="pill ${status[1]}">${esc(status[0])}</span>
        <strong>${esc(enrichmentRouteLabels[run.routeState] || run.routeState || '处理中')}</strong></div>
        <div class="enrichment-progress"><span style="width:${Math.max(0, Math.min(100, Number(run.completeness || 0)))}%"></span></div>
        <small>资料完整度 ${esc(run.completeness)}%${missing ? ` · 缺少：${missing}` : ''}</small>
        ${tags ? `<div class="customer-ai-reasons">${tags}</div>` : ''}
      </div>
      ${nodes ? `<ol class="enrichment-nodes">${nodes}</ol>` : ''}
      ${proposals ? `<div class="enrichment-proposals">${proposals}</div>` : ''}
      ${payload.restricted?.contacts ? '<p class="subtle">联系人证据因当前权限已隐藏。</p>' : ''}
      ${evidence ? `<details class="customer-ai-evidence"><summary>补全证据 · ${visibleEvidence.length}</summary><ul>${evidence}</ul></details>` : ''}
    </section>`;
  }

  function renderCustomerFit(payload) {
    const job = payload?.job;
    const result = payload?.result;
    if (state.customerAiError) {
      return `<div class="customer-ai-error"><strong>AI 评分暂不可用</strong><span>${esc(state.customerAiError)}</span></div>`;
    }
    if (!job && !result) {
      return '<div class="customer-ai-empty"><span class="pill gray">未生成</span><span>暂无客户匹配评分</span></div>';
    }
    const status = payload?.stale ? ['资料已变化', 'amber'] : (aiJobLabels[job?.state] || ['状态未知', 'gray']);
    if (!result) {
      return `<div class="customer-ai-empty"><span class="pill ${status[1]}">${status[0]}</span><span>${job?.errorSummary ? esc(job.errorSummary) : '等待评分结果'}</span></div>`;
    }
    const value = result.value || {};
    const confidence = `${Math.round(Number(result.confidence || value.confidence || 0) * 100)}%`;
    const reasons = (value.reasonCodes || []).map(code => `<span>${esc(aiReasonLabel(code))}</span>`).join('');
    const evidence = (payload.evidence || []).map(item => {
      const sourceUrl = /^https?:\/\//i.test(String(item.sourceUrl || '')) ? item.sourceUrl : '';
      return `<li><div><strong>${esc(item.sourceTitle || item.field || item.sourceTable)}</strong>
        <small>${esc(item.sourceTable)}${item.checkedAt ? ` · ${esc(shortDate(item.checkedAt, true))}` : ''}</small></div>
        <p>${esc(item.value)}</p>${sourceUrl ? `<a href="${esc(sourceUrl)}" target="_blank" rel="noreferrer">查看来源</a>` : ''}</li>`;
    }).join('');
    return `<div class="customer-ai-result">
      <div class="customer-ai-score"><strong>${Number(value.fitScore ?? 0)}</strong><span>匹配分</span></div>
      <div class="customer-ai-grade"><strong>${esc(value.grade || '—')}</strong><span>等级</span></div>
      <div class="customer-ai-confidence"><strong>${confidence}</strong><span>置信度</span></div>
      <div class="customer-ai-summary"><div><span class="pill ${status[1]}">${status[0]}</span><div class="customer-ai-reasons">${reasons}</div></div>
        <small>${esc(result.engine)} / ${esc(result.model)} · Prompt ${esc(result.promptVersion)} · Schema ${esc(result.schemaVersion)} · ${esc(shortDate(result.generatedAt, true))}</small></div>
    </div>${evidence ? `<details class="customer-ai-evidence"><summary>评分证据 · ${payload.evidence.length}</summary><ul>${evidence}</ul></details>` : ''}`;
  }

  function renderSalesPack(payload) {
    if (!salesPackEnabled() && !payload?.result && !payload?.job) return '';
    const job = payload?.job;
    const result = payload?.result;
    const status = payload?.stale ? ['资料已变化', 'amber'] : (aiJobLabels[job?.state] || ['未生成', 'gray']);
    if (!result) {
      return `<section class="sales-pack"><div class="sales-pack-title"><strong>销售资料包</strong><span class="pill ${status[1]}">${esc(status[0])}</span></div>
        <p class="subtle">${esc(job?.errorSummary || '领取客户后会自动生成，也可手动发起。')}</p></section>`;
    }
    const value = result.value || {};
    const entries = (value.entryPoints || []).map(item => `<li>${esc(item)}</li>`).join('');
    const risks = (value.risks || []).map(item => `<li>${esc(item)}</li>`).join('');
    const evidence = (payload.evidence || []).map(item => `<li><strong>${esc(item.sourceTitle || item.field || item.sourceTable)}</strong><p>${esc(item.value)}</p></li>`).join('');
    return `<section class="sales-pack">
      <div class="sales-pack-title"><strong>销售资料包</strong><span class="pill ${status[1]}">${esc(status[0])}</span><small>置信度 ${Math.round(Number(value.confidence || 0) * 100)}%</small></div>
      <p class="sales-pack-summary">${esc(value.summary || '')}</p>
      <div class="sales-pack-grid">
        <div><strong>建议切入点</strong><ul>${entries || '<li>暂无</li>'}</ul></div>
        <div><strong>风险与注意项</strong><ul>${risks || '<li>暂无</li>'}</ul></div>
      </div>
      <div class="sales-pack-draft"><div><strong>触达草稿</strong><span>${esc(value.draft?.channel || 'other')} · 仅供人工审核，不会自动发送</span></div>
        ${value.draft?.subject ? `<label>主题<input readonly value="${esc(value.draft.subject)}"></label>` : ''}
        <label>正文<textarea readonly rows="6">${esc(value.draft?.body || '')}</textarea></label>
      </div>
      ${evidence ? `<details class="customer-ai-evidence"><summary>资料包证据 · ${payload.evidence.length}</summary><ul>${evidence}</ul></details>` : ''}
    </section>`;
  }

  function renderNextActionSuggestion(payload) {
    const job = payload?.job;
    const result = payload?.result;
    if (!job && !result) return '';
    const status = aiJobLabels[job?.state] || ['未生成', 'gray'];
    if (!result) {
      return `<section class="next-action-suggestion"><div class="sales-pack-title"><strong>下一步建议</strong><span class="pill ${status[1]}">${esc(status[0])}</span></div>
        <p class="subtle">${esc(job?.errorSummary || '正在根据最新业务动作生成建议。规则提醒仍会独立运行。')}</p></section>`;
    }
    const value = result.value || {};
    const editable = job?.state === 'needs_review' && can('record_activity') && can('use_ai_assistant')
      && !state.data?.impersonation;
    return `<section class="next-action-suggestion">
      <div class="sales-pack-title"><strong>下一步建议</strong><span class="pill ${status[1]}">${esc(status[0])}</span><small>置信度 ${Math.round(Number(value.confidence || 0) * 100)}%</small></div>
      <p>${esc(value.reason || '')}</p>
      <div class="next-action-suggestion-fields">
        <label>下一步动作<input id="nextActionSuggestion" value="${esc(value.nextAction || '')}" ${editable ? '' : 'readonly'}></label>
        <label>计划时间<input id="nextActionSuggestionAt" type="datetime-local" value="${esc(String(value.nextActionAt || '').replace(' ', 'T').slice(0, 16))}" ${editable ? '' : 'readonly'}></label>
        <label class="check"><input id="nextActionSuggestionManager" type="checkbox" ${value.managerRequired ? 'checked' : ''} ${editable ? '' : 'disabled'}> 需要经理介入</label>
      </div>
      ${editable ? `<div class="next-action-suggestion-actions"><button class="button primary tiny" type="button" data-adopt-next-action="${esc(job.id)}">采纳下一步建议</button><span>采纳前可编辑；不会自动修改客户。</span></div>` : ''}
    </section>`;
  }

  function renderCustomerAI() {
    if (!customerAIEnabled()) return;
    const body = $('#customerAiStationBody');
    const actions = $('#customerAiStationActions');
    if (!body || !actions) return;
    const payload = state.customerAi;
    const job = payload?.job;
    const salesPack = payload?.salesPack;
    const salesPackJob = salesPack?.job;
    const nextAction = payload?.nextAction;
    const nextActionJob = nextAction?.job;
    const enrichment = state.customerEnrichment || state.customerEnrichmentLastSuccess;
    actions.innerHTML = [
      nextActionJob ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(nextActionJob.id)}">下一步任务</button>` : '',
      salesPackJob ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(salesPackJob.id)}">资料包任务</button>` : '',
      job ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(job.id)}">评分任务</button>` : '',
    ].join('');
    if (state.customerAiLoading && !payload && !enrichment) {
      body.innerHTML = '<span class="subtle">正在读取评分与资料补全状态…</span>';
      return;
    }
    const result = payload?.result;
    const canRun = can('use_ai_assistant') && !state.data?.impersonation;
    const canRunSalesPack = canRun && salesPackEnabled() && ['view_contacts', 'view_recon'].every(can);
    const canStartEnrichment = canRun && ['run_recon', 'view_recon', 'view_contacts'].every(can);
    const run = enrichment?.run;
    if (canStartEnrichment && (!run || ENRICHMENT_TERMINAL_STATES.has(run.state))) {
      actions.insertAdjacentHTML('afterbegin', `<button class="button secondary tiny" type="button" data-retry-enrichment ${state.customerEnrichmentPending ? 'disabled' : ''}>${run ? '重新补全' : '开始补全'}</button>`);
    }
    if (run && !ENRICHMENT_TERMINAL_STATES.has(run.state) && can('cancel_ai_tasks') && !state.data?.impersonation) {
      actions.insertAdjacentHTML('afterbegin', `<button class="button secondary tiny" type="button" data-cancel-enrichment="${esc(run.id)}" ${state.customerEnrichmentPending ? 'disabled' : ''}>取消补全</button>`);
    }
    const retryable = ['retry_wait', 'dead_letter', 'blocked', 'cancelled'].includes(job?.state);
    if (canRun && (retryable || !result || payload?.stale)) {
      const label = state.customerAiPending
        ? '处理中…'
        : retryable
          ? '重试'
          : result
            ? '重新评分'
            : '生成评分';
      actions.insertAdjacentHTML('afterbegin', `<button class="button ${retryable ? 'secondary' : 'primary'} tiny" type="button" ${state.customerAiPending ? 'disabled' : ''} ${retryable ? `data-retry-ai-job="${esc(job.id)}"` : 'data-run-customer-fit'}>${label}</button>`);
    }
    const packRetryable = ['retry_wait', 'dead_letter', 'blocked', 'cancelled'].includes(salesPackJob?.state);
    if (canRunSalesPack && (packRetryable || !salesPack?.result || salesPack?.stale)) {
      const label = state.customerAiPending ? '处理中…' : packRetryable ? '重试资料包' : salesPack?.result ? '重新生成资料包' : '生成销售资料包';
      actions.insertAdjacentHTML('afterbegin', `<button class="button ${packRetryable ? 'secondary' : 'primary'} tiny" type="button" ${state.customerAiPending ? 'disabled' : ''} ${packRetryable ? `data-retry-ai-job="${esc(salesPackJob.id)}"` : 'data-run-sales-pack'}>${label}</button>`);
    }
    body.innerHTML = `${renderNextActionSuggestion(nextAction)}${renderSalesPack(salesPack)}${renderCustomerFit(payload)}${renderCustomerEnrichment()}`;
  }

  function scheduleCustomerAIPoll() {
    clearTimeout(state.customerAiTimer);
    state.customerAiTimer = null;
    const fitPending = ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.job?.state);
    const salesPackPending = ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.salesPack?.job?.state);
    const nextActionPending = ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.nextAction?.job?.state);
    const enrichmentState = (state.customerEnrichment || state.customerEnrichmentLastSuccess)?.run?.state;
    const enrichmentPending = enrichmentState && !ENRICHMENT_TERMINAL_STATES.has(enrichmentState);
    if ((!fitPending && !salesPackPending && !nextActionPending && !enrichmentPending) || !state.customerProfileExternalId
        || state.customerAiPollCount >= CUSTOMER_AI_MAX_POLLS) return;
    state.customerAiPollCount += 1;
    state.customerAiTimer = setTimeout(() => void loadCustomerAI(state.customerProfileExternalId, { quiet: true }), 2500);
  }

  async function loadCustomerAI(customerId, { quiet = false } = {}) {
    if (!customerAIEnabled()) return;
    clearTimeout(state.customerAiTimer);
    state.customerAiTimer = null;
    if (!quiet) state.customerAiLoading = true;
    state.customerAiError = '';
    state.customerEnrichmentError = '';
    renderCustomerAI();
    try {
      const [fit, enrichment] = await Promise.allSettled([
        api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/results`),
        api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/enrichment`),
      ]);
      if (state.customerProfileExternalId !== customerId) return;
      if (fit.status === 'fulfilled') state.customerAi = fit.value;
      else state.customerAiError = fit.reason?.message || '评分读取失败';
      if (enrichment.status === 'fulfilled') {
        state.customerEnrichment = enrichment.value;
        state.customerEnrichmentLastSuccess = enrichment.value;
      } else {
        state.customerEnrichmentError = enrichment.reason?.message || '资料补全读取失败';
        state.customerEnrichment = state.customerEnrichmentLastSuccess;
      }
    } finally {
      if (state.customerProfileExternalId === customerId) {
        state.customerAiLoading = false;
        renderCustomerAI();
        scheduleCustomerAIPoll();
      }
    }
  }

  async function retryCustomerEnrichment() {
    const customerId = state.customerProfileExternalId;
    if (!customerAIEnabled() || !customerId || state.customerEnrichmentPending) return;
    state.customerEnrichmentPending = true;
    state.customerAiPollCount = 0;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/enrichment/run`, {
        method: 'POST', body: '{}',
      });
      await loadCustomerAI(customerId, { quiet: true });
    } catch (error) {
      state.customerEnrichmentError = error.message;
    } finally {
      state.customerEnrichmentPending = false;
      renderCustomerAI();
    }
  }

  async function cancelCustomerEnrichment(runId) {
    if (!runId || state.customerEnrichmentPending) return;
    state.customerEnrichmentPending = true;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/enrichment/${encodeURIComponent(runId)}/cancel`, {
        method: 'POST', body: '{}',
      });
      await loadCustomerAI(state.customerProfileExternalId, { quiet: true });
    } catch (error) {
      state.customerEnrichmentError = error.message;
    } finally {
      state.customerEnrichmentPending = false;
      renderCustomerAI();
    }
  }

  async function reviewCustomerEnrichmentProposal(proposalId, decision) {
    if (!proposalId || !['accepted', 'rejected'].includes(decision) || state.customerEnrichmentPending) return;
    state.customerEnrichmentPending = true;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/proposals/${encodeURIComponent(proposalId)}/review`, {
        method: 'POST', body: JSON.stringify({ decision }),
      });
      await loadCustomerAI(state.customerProfileExternalId, { quiet: true });
    } catch (error) {
      state.customerEnrichmentError = error.message;
    } finally {
      state.customerEnrichmentPending = false;
      renderCustomerAI();
    }
  }

  async function runCustomerFit() {
    const customerId = state.customerProfileExternalId;
    if (!customerAIEnabled() || !customerId || state.customerAiPending) return;
    state.customerAiPending = true;
    state.customerAiPollCount = 0;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/stations/customer_fit/run`, { method: 'POST', body: '{}' });
      await loadCustomerAI(customerId, { quiet: true });
    } catch (error) {
      state.customerAiError = error.message;
      renderCustomerAI();
    } finally {
      state.customerAiPending = false;
      renderCustomerAI();
    }
  }

  async function runSalesPack() {
    const customerId = state.customerProfileExternalId;
    if (!salesPackEnabled() || !customerId || state.customerAiPending) return;
    state.customerAiPending = true;
    state.customerAiPollCount = 0;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/stations/sales_pack/run`, { method: 'POST', body: '{}' });
      await loadCustomerAI(customerId, { quiet: true });
    } catch (error) {
      state.customerAiError = error.message;
      renderCustomerAI();
    } finally {
      state.customerAiPending = false;
      renderCustomerAI();
    }
  }

  async function retryCustomerFit(jobId) {
    if (!customerAIEnabled() || !jobId || state.customerAiPending) return;
    state.customerAiPending = true;
    state.customerAiPollCount = 0;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST', body: '{}' });
      await loadCustomerAI(state.customerProfileExternalId, { quiet: true });
    } catch (error) {
      state.customerAiError = error.message;
      renderCustomerAI();
    } finally {
      state.customerAiPending = false;
      renderCustomerAI();
    }
  }

  async function adoptNextAction(jobId) {
    if (!jobId || state.customerAiPending) return;
    const nextAction = $('#nextActionSuggestion')?.value.trim() || '';
    const nextActionAt = apiTime($('#nextActionSuggestionAt')?.value || '');
    if (!nextAction || !nextActionAt) return toast('请填写下一步动作和计划时间');
    state.customerAiPending = true;
    renderCustomerAI();
    try {
      await api(`/api/sales-crm/ai/jobs/${encodeURIComponent(jobId)}/next-action/adopt`, {
        method: 'POST',
        body: JSON.stringify({
          nextAction,
          nextActionAt,
          managerRequired: Boolean($('#nextActionSuggestionManager')?.checked),
        }),
      });
      await load();
      await loadCustomerAI(state.customerProfileExternalId, { quiet: true });
      toast('下一步建议已采纳，今日待办和提醒已更新');
    } catch (error) {
      state.customerAiError = error.message;
      toast(error.message);
    } finally {
      state.customerAiPending = false;
      renderCustomerAI();
    }
  }

  const aiTaskTypeLabels = {
    customer_fit: '客户匹配', company_recon: '公司 Recon', contact_recon: '联系人 Recon',
    sales_pack: '销售资料包', action_proposal: '活动提案', next_action: '下一步建议', prospect_discovery: 'Prospect',
    manager_evaluation: '经理评价', assistant_chat: '对话 AI',
  };

  function aiTaskFilters() {
    return {
      state: $('#aiTaskStateFilter')?.value || '',
      type: $('#aiTaskTypeFilter')?.value || '',
      customer: $('#aiTaskCustomerFilter')?.value.trim() || '',
      owner: $('#aiTaskOwnerFilter')?.value.trim() || '',
      model: $('#aiTaskModelFilter')?.value.trim() || '',
      from: $('#aiTaskFromFilter')?.value || '',
      to: $('#aiTaskToFilter')?.value || '',
    };
  }

  function renderAiTasks() {
    const tasks = state.aiTasks;
    const overview = $('#aiTaskOverview');
    const degraded = $('#aiTaskDegraded');
    degraded?.classList.toggle('hidden', !tasks.error);
    if (degraded) degraded.textContent = tasks.error
      ? `实时控制面暂不可用，保留上次成功加载的历史任务。${tasks.error}`
      : '';
    if (tasks.overview) {
      const queue = tasks.overview.queue || {};
      overview.classList.remove('hidden');
      overview.innerHTML = [
        ['排队任务', Number(queue.queued || 0) + Number(queue.retry_wait || 0), '等待调度'],
        ['执行任务', Number(queue.running || 0), '跨进程槽位保护'],
        ['24h 失败率', `${Math.round(Number(tasks.overview.failureRate24h || 0) * 100)}%`, '模型尝试'],
        ['预算 / 成本', `$${Number(tasks.overview.dailyCost || 0).toFixed(4)}`, `${tasks.overview.budget?.policies?.length || 0} 条策略 · ${tasks.overview.budget?.alertCount || 0} 条告警`],
      ].map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    } else overview.classList.add('hidden');
    if (tasks.loading && !tasks.loaded) {
      $('#aiTaskTable').innerHTML = '<div class="empty">正在加载 AI 任务…</div>';
      return;
    }
    const rows = tasks.items.map(item => {
      const stateMeta = aiJobLabels[item.state] || [item.state || '未知', 'gray'];
      const row = [
        `<div class="company-cell"><strong>${esc(item.taskId)}</strong><span>${esc(item.source)}</span></div>`,
        esc(aiTaskTypeLabels[item.taskType] || item.taskType),
        item.customerId ? `<button class="text-button" data-open-master="${esc(item.customerId)}">${esc(item.customerName || item.customerId)}</button>` : '工作区',
        esc(item.actorId || '系统'),
        `<span class="pill ${stateMeta[1]}">${esc(stateMeta[0])}</span>`,
        `<div class="company-cell"><strong>${esc(item.model || item.engine || '—')}</strong><span>${item.cost ? `$${Number(item.cost).toFixed(4)}` : '无计费'}</span></div>`,
        `<div class="company-cell"><strong>${shortDate(item.createdAt, true)}</strong><span>${item.durationMs == null ? '—' : `${item.durationMs} ms`}</span></div>`,
        '<button class="button secondary tiny" type="button" data-open-ai-task="' + esc(item.taskId) + '">详情</button>',
      ];
      row._attrs = `data-ai-task-row="${esc(item.taskId)}"`;
      return row;
    });
    $('#aiTaskTable').innerHTML = table(['任务', '类型', '客户', '发起人', '状态', '模型 / 成本', '创建 / 耗时', ''], rows);
    const pages = Math.max(1, Math.ceil(tasks.total / tasks.pageSize));
    $('#aiTaskPageInfo').textContent = `第 ${tasks.page} / ${pages} 页 · 共 ${tasks.total} 项`;
    $('#aiTaskPrev').disabled = tasks.page <= 1;
    $('#aiTaskNext').disabled = tasks.page >= pages;
  }

  async function loadAiTasks({ reset = false } = {}) {
    if (!customerAIEnabled() || state.aiTasks.loading) return;
    if (reset) state.aiTasks.page = 1;
    state.aiTasks.loading = true;
    renderAiTasks();
    try {
      const params = new URLSearchParams({
        page: state.aiTasks.page,
        pageSize: state.aiTasks.pageSize,
        ...aiTaskFilters(),
      });
      const payload = await api(`/api/sales-crm/ai/tasks?${params}`);
      Object.assign(state.aiTasks, payload, { loaded: true, error: '' });
    } catch (error) {
      state.aiTasks.error = error.message;
      toast(error.message);
    } finally {
      state.aiTasks.loading = false;
      renderAiTasks();
    }
  }

  function renderAiTaskDetail(task) {
    const attempts = (task.attempts || []).map(item => `<li><strong>第 ${item.attempt || '—'} 次 · ${esc(item.engine || '—')} / ${esc(item.model || '—')}</strong><span>${esc(item.status ?? (item.ok ? 'succeeded' : 'failed'))} · ${Number(item.durationMs || 0)} ms · $${Number(item.cost || 0).toFixed(4)}</span>${item.errorSummary || item.error ? `<small>${esc(item.errorSummary || item.error)}</small>` : ''}</li>`).join('');
    const timeline = (task.timeline || []).map(item => `<li><strong>${esc(item.kind)}</strong><span>${esc(item.state || '')}</span><time>${shortDate(item.at, true)}</time></li>`).join('');
    const actions = [
      task.canRetry && can('use_ai_assistant') ? `<button class="button secondary" data-ai-task-action="retry" data-job-id="${esc(task.taskId)}">重试</button>` : '',
      task.canCancel && can('cancel_ai_tasks') ? `<button class="button secondary" data-ai-task-action="cancel" data-job-id="${esc(task.taskId)}">取消</button>` : '',
      task.canReview && can('review_ai_tasks') ? `<textarea id="aiTaskReviewSummary" placeholder="复核说明（最多 500 字）"></textarea><button class="button primary" data-ai-task-action="approved" data-job-id="${esc(task.taskId)}">通过复核</button><button class="button danger" data-ai-task-action="rejected" data-job-id="${esc(task.taskId)}">退回</button>` : '',
    ].join('');
    openModal('AI 任务详情', 'AI CONTROL PLANE', `<div class="ai-task-detail">
      <div class="ai-task-detail-grid"><div><span>任务 ID</span><strong>${esc(task.taskId)}</strong></div><div><span>类型</span><strong>${esc(aiTaskTypeLabels[task.taskType] || task.taskType)}</strong></div><div><span>客户</span><strong>${esc(task.customerId || '工作区')}</strong></div><div><span>状态</span><strong>${esc(task.state)}</strong></div></div>
      ${task.errorSummary ? `<div class="customer-ai-error"><strong>错误</strong><span>${esc(task.errorSummary)}</span></div>` : ''}
      <section><h3>模型尝试</h3><ul class="ai-task-events">${attempts || '<li>无模型尝试记录</li>'}</ul></section>
      <section><h3>时间线</h3><ul class="ai-task-events">${timeline || '<li>无时间线记录</li>'}</ul></section>
      ${task.result ? `<section><h3>结构化结果</h3><pre>${esc(JSON.stringify(task.result.value || {}, null, 2))}</pre></section>` : ''}
      ${actions ? `<div class="ai-task-detail-actions">${actions}</div>` : ''}
    </div>`);
  }

  async function openAiTask(taskId) {
    try {
      const payload = await api(`/api/sales-crm/ai/tasks/${encodeURIComponent(taskId)}`);
      renderAiTaskDetail(payload.task);
    } catch (error) { toast(error.message); }
  }

  async function actOnAiTask(action, jobId) {
    try {
      if (['approved', 'rejected'].includes(action)) {
        await api(`/api/sales-crm/ai/jobs/${encodeURIComponent(jobId)}/review`, {
          method: 'POST',
          body: JSON.stringify({ decision: action, summary: $('#aiTaskReviewSummary')?.value || '' }),
        });
      } else {
        await api(`/api/sales-crm/ai/jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST', body: '{}' });
      }
      closeModal();
      await loadAiTasks();
      toast(action === 'cancel' ? '已提交取消请求' : action === 'retry' ? '任务已重新入队' : '复核已提交');
    } catch (error) { toast(error.message); }
  }

  function filteredCustomerAccounts() {
    const search = ($('#customerSearch')?.value || '').trim().toLowerCase();
    const stage = $('#stageFilter')?.value || '';
    const priority = $('#priorityFilter')?.value || '';
    const evaluationTag = $('#evaluationTagFilter')?.value || '';
    const onlyOverdue = $('#onlyOverdue')?.checked;
    const stageOrder = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
    return scopedAccounts().filter(account => {
      const labels = labelsForAccount(account.id);
      const text = [account.company_name, account.country, account.industry, account.product_focus, account.customer_type, ...labels].join(' ').toLowerCase();
      const reached = !state.stageReached || (account.stage !== 'lost' && stageOrder[account.stage] >= stageOrder[state.stageReached]);
      return (!search || text.includes(search)) && (!stage || account.stage === stage) && reached
        && (!priority || account.priority === priority) && (!evaluationTag || labels.includes(evaluationTag))
        && (!onlyOverdue || state.data.alerts.some(alert => alert.customerId === account.id && alert.code === 'OVERDUE'));
    });
  }

  function renderCustomers() {
    const accounts = filteredCustomerAccounts();
    const visibleIds = new Set(accounts.map(account => account.id));
    state.selectedCustomerIds = new Set([...state.selectedCustomerIds].filter(customerId => visibleIds.has(customerId)));
    const canBulkAssign = can('view_all_customers') && can('manage_intake') && can('edit_customer') && !state.data.impersonation;
    $('#customerBulkBar')?.classList.toggle('hidden', !canBulkAssign);
    if ($('#customerSelectionCount')) $('#customerSelectionCount').textContent = `已选择 ${state.selectedCustomerIds.size} 个客户`;
    if ($('#bulkAssignCustomers')) $('#bulkAssignCustomers').disabled = !state.selectedCustomerIds.size;
    if ($('#bulkReturnCustomers')) $('#bulkReturnCustomers').disabled = !state.selectedCustomerIds.size;
    const reachedNote = state.stageReached ? ` · 漏斗累计达到“${stageLabel(state.stageReached)}”` : '';
    $('#customerResultCount').textContent = `${accounts.length} 个客户${reachedNote}`;
    $('#customerTable').innerHTML = table(
      [canBulkAssign ? '<span class="sr-only">选择</span>' : '', '客户', '国家 / 行业', '阶段', '负责人', '最近动作', '下一步', '潜力', '状态'],
      accounts.map(account => {
        const alert = alertFor(account.id);
        const canReturn = !state.data.impersonation && (
          (state.data.user.role === 'sales' && account.owner_id === state.data.user.id)
          || can('manage_customer_recycle')
        );
        const canTrash = !state.data.impersonation && can('manage_manual_customer_deletion')
          && !account.intake_item_id && account.source_file === 'CRM手工新增';
        const lifecycleActions = [
          canReturn ? `<button class="text-button danger-text" data-return-customer="${esc(account.id)}">退回线索池</button>` : '',
          canTrash ? `<button class="text-button danger-text" data-trash-customer="${esc(account.id)}">删除到回收站</button>` : '',
        ].filter(Boolean).join('');
        return [
          canBulkAssign ? `<input type="checkbox" data-select-customer="${esc(account.id)}" ${state.selectedCustomerIds.has(account.id) ? 'checked' : ''} aria-label="选择 ${esc(account.company_name)}">` : '',
          `<div class="company-cell"><strong>${esc(account.company_name)}</strong><span>${esc(account.customer_type || account.source || '—')} · 创建人：${esc(account.creator_name || '历史数据')}</span>${labelsForAccount(account.id).length ? `<div class="tag-row">${labelsForAccount(account.id).map(label => `<span class="ai-tag">AI · ${esc(label)}</span>`).join('')}</div>` : ''}</div>`,
          `<div class="company-cell"><strong>${esc(account.country || '—')}</strong><span>${esc(account.industry || '—')}</span></div>`,
          `<span class="status-pill">${esc(stageLabel(account.stage))}</span>`,
          esc(account.owner_name || '未分配'),
          `<span>${relative(account.last_activity_at)}</span>`,
          `<div class="company-cell"><strong class="${alert?.code === 'OVERDUE' ? 'overdue-text' : ''}">${esc(account.next_action || '未填写')}</strong><span>${shortDate(account.next_action_at, true)}</span></div>`,
          `<span class="priority ${esc(account.priority)}">${esc(account.priority)}</span> · ${money(account.potential_value)}`,
          `${alert ? `<span class="pill ${alert.severity === 'critical' ? 'red' : 'amber'}">${esc(alert.title)}</span>` : '<span class="good-text">正常推进</span>'}${lifecycleActions ? `<div class="assignment-actions">${lifecycleActions}</div>` : ''}`,
        ];
      }).map((row, index) => {
        row._id = accounts[index].id;
        row._attrs = `data-customer="${esc(accounts[index].id)}"`;
        return row;
      }),
    );
  }

  async function loadRecycleBin() {
    if (!can('manage_customer_recycle') || state.recycleBin.loading) return;
    state.recycleBin.loading = true;
    try {
      const search = ($('#recycleSearch')?.value || '').trim();
      const payload = await api(`/api/sales-crm/accounts/recycle-bin?kind=${encodeURIComponent(state.recycleKind)}&page=1&pageSize=100&search=${encodeURIComponent(search)}`);
      state.recycleBin = { ...state.recycleBin, ...payload, loading: false };
      renderRecycleBin();
    } catch (error) {
      state.recycleBin.loading = false;
      toast(error.message);
    }
  }

  function renderRecycleBin() {
    const root = $('#recycleTable');
    if (!root) return;
    const rows = state.recycleBin.rows || [];
    $$('#recycleTabs button').forEach(button => button.classList.toggle('active', button.dataset.recycleKind === state.recycleKind));
    if (!rows.length) {
      root.innerHTML = '<div class="empty">回收站暂无客户</div>';
      return;
    }
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    root.innerHTML = table(
      ['客户', '原负责人', '原因', '回收时间', '操作'],
      rows.map(row => [
        `<div class="company-cell"><strong>${esc(row.companyName)}</strong><span>${esc(row.externalCustomerId)} · ${esc(row.country || '—')}</span></div>`,
        esc(row.previousOwnerName || '未分配'),
        esc(row.reason || '—'),
        shortDate(row.recycledAt, true),
        row.recycleKind === 'sales_return'
          ? `<select data-recycle-owner="${esc(row.customerId)}">${sales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}</select><button class="button primary tiny" data-reassign-customer="${esc(row.customerId)}">重新分配</button>`
          : can('manage_manual_customer_deletion') && !state.data.impersonation
            ? `<button class="button secondary tiny" data-restore-customer="${esc(row.customerId)}">恢复客户</button>`
            : '<span class="subtle">仅真实管理员可恢复</span>',
      ]),
    );
  }

  function labelsForAccount(customerId) {
    return [...new Set((state.data.customerEvaluationTags || []).filter(item => item.customerId === customerId).flatMap(item => item.labels || []).filter(Boolean))];
  }

  function renderPipeline() {
    const accounts = scopedAccounts();
    const stages = state.data.stages.filter(item => !['new'].includes(item.key));
    $('#pipelineBoard').innerHTML = stages.map(stage => {
      const rows = accounts.filter(account => account.stage === stage.key);
      return `<div class="lane"><div class="lane-head"><h3>${esc(stage.label)} <small class="subtle">（当前）</small></h3><span>${rows.length}</span></div><div class="lane-body">${rows.map(account => {
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
        const row = [
          `<span class="pill ${item.severity === 'critical' ? 'red' : 'amber'}">${item.severity === 'critical' ? '立即' : '关注'}</span>`,
          `<div class="company-cell"><strong>${esc(item.companyName)}</strong><span>${item.intakeItemId ? '未开发线索 · 待领取' : `${esc(account?.country || '')} · ${esc(stageLabel(item.stage))}`}</span></div>`,
          `<strong>${esc(item.title)}</strong>`, esc(item.detail), esc(account?.owner_name || userById(item.ownerId)?.name || ''), item.intakeItemId
            ? `<button class="text-button" data-intake-profile="${esc(item.intakeItemId)}">${esc(item.action)} →</button>`
            : `<button class="text-button" data-open-customer="${item.customerId}">${esc(item.action)} →</button>`,
        ];
        row._attrs = item.intakeItemId
          ? `data-intake-profile="${esc(item.intakeItemId)}"`
          : `data-customer="${esc(item.customerId)}"`;
        return row;
      }),
    );
  }

  function renderInsightsHub() {
    if (!can('view_insights')) return;
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
    if (!can('view_team')) return;
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
    if (!can('view_markets')) return;
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
    const canMutate = can('manage_users') && !state.data.impersonation;
    $('#userTable').innerHTML = table(
      ['用户', '角色', '权限组', '覆盖数', '状态', '操作'],
      state.data.users.map(user => [
        `<div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>`,
        `<span class="pill">${roleLabel(user.role)}</span>`,
        esc(user.permissionGroupName || '—'),
        user.permissionOverrideCount ? `<span class="pill amber">${user.permissionOverrideCount} 项覆盖</span>` : '<span class="subtle">继承组默认</span>',
        `<span class="pill ${user.active ? '' : 'gray'}">${user.active ? '启用' : '停用'}</span>`,
        canMutate
          ? `<div class="assignment-actions"><button class="text-button" data-edit-user="${user.id}">编辑账号</button><button class="text-button" data-edit-overrides="${user.id}">个人权限</button>${user.id === state.data.user.id ? '<span class="subtle">当前账号</span>' : `<button class="text-button" data-reset-password="${user.id}">修改密码</button>${['manager', 'sales'].includes(user.role) && user.active ? `<button class="text-button" data-start-impersonation="${user.id}">身份检查</button>` : ''}<button class="text-button danger-text" data-archive-user="${user.id}">归档</button>`}</div>`
          : '<span class="subtle">无变更权限</span>',
      ]),
    );
    $('#archivedUserTable').innerHTML = table(
      ['用户', '角色', '归档时间', '操作'],
      (state.data.archivedUsers || []).map(user => [
        `<div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>`,
        `<span class="pill gray">${roleLabel(user.role)}</span>`,
        shortDate(user.archivedAt, true),
        canMutate
          ? `<div class="assignment-actions"><button class="text-button" data-restore-user="${user.id}">恢复</button><button class="text-button danger-text" data-delete-user="${user.id}">永久删除</button></div>`
          : '<span class="subtle">无变更权限</span>',
      ]),
    );
    renderPermissionGroups(canMutate);
    renderAssistantRuntime();
    $('#auditTable').innerHTML = table(
      ['时间','操作人','动作','对象','详情'],
      (state.data.auditLog || []).map(row => [
        esc(shortDate(row.created_at, true)), esc(auditOperator(row)),
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

  const assistantEngineLabels = {
    'kimi-cli': 'Kimi', hermes: 'Hermes', deepseek: 'DeepSeek', auto: '自动',
  };

  function assistantRuntimeError(value) {
    return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  function renderAssistantRuntime() {
    const panel = $('#assistantRuntimePanel');
    if (!panel) return;
    const allowed = can('manage_users') && !state.data?.impersonation;
    panel.classList.toggle('hidden', !allowed);
    if (!allowed) return;
    const runtime = state.assistantRuntime;
    const mode = $('#assistantRuntimeMode');
    const recheck = $('#assistantRuntimeRecheck');
    const status = $('#assistantRuntimeStatus');
    const rows = $('#assistantRuntimeRows');
    const pending = state.assistantRuntimePending;
    mode.disabled = pending || !runtime;
    recheck.disabled = pending || !runtime;
    recheck.textContent = pending ? '检测中…' : '重新检测';
    if (!runtime) {
      status.textContent = state.assistantRuntimeError || '正在加载运行状态…';
      rows.innerHTML = ['kimi-cli', 'hermes', 'deepseek'].map(engine => `<div class="assistant-runtime-row"><strong>${assistantEngineLabels[engine]}</strong><span>等待状态</span><span>—</span><span>—</span><span>—</span></div>`).join('');
      return;
    }
    mode.value = runtime.mode || 'auto';
    const active = runtime.activeEngine ? `当前优先使用 ${assistantEngineLabels[runtime.activeEngine] || runtime.activeEngine}` : '当前没有健康引擎';
    status.textContent = state.assistantRuntimeError || `${assistantEngineLabels[runtime.mode] || runtime.mode}模式 · ${active}`;
    rows.innerHTML = ['kimi-cli', 'hermes', 'deepseek'].map(engine => {
      const health = runtime.engines?.[engine] || {};
      const error = assistantRuntimeError(health.errorMessage || health.errorCode);
      return `<div class="assistant-runtime-row">
        <strong>${assistantEngineLabels[engine]}</strong>
        <span class="assistant-runtime-state ${esc(health.status || 'unknown')}">${esc(health.status || 'unknown')}</span>
        <span>${health.latencyMs ? `${Number(health.latencyMs)} ms` : '—'}</span>
        <span>${esc(shortDate(health.lastCheckedAt, true))}</span>
        <span title="${esc(error)}">${esc(error || '—')}</span>
      </div>`;
    }).join('');
  }

  const aiFeatureLabels = {
    ai_stations: 'AI 工作站',
    customer_enrichment: '客户资料补全',
    customer_enrichment_auto_trigger: '客户补全自动触发',
    sales_pack: '销售资料包',
  };

  function syncBootstrapFeatures(features) {
    if (!state.data?.features || !features) return;
    state.data.features.aiStations = Boolean(features.ai_stations?.effectiveEnabled);
    state.data.features.customerEnrichment = Boolean(features.customer_enrichment?.effectiveEnabled);
    state.data.features.customerEnrichmentAutoTrigger = Boolean(features.customer_enrichment_auto_trigger?.effectiveEnabled);
    state.data.features.salesPack = Boolean(features.sales_pack?.effectiveEnabled);
    $('#customerAiStation')?.classList.toggle('hidden', !customerAIEnabled());
  }

  function renderAIFeatures() {
    const rows = $('#aiFeatureRows');
    const status = $('#aiFeatureStatus');
    if (!rows || !status) return;
    const features = state.aiFeatures;
    status.textContent = state.aiFeaturesError || (!features ? '正在加载功能开关…' : '开关变更会立即影响新任务的入队和领取。');
    if (!features) {
      rows.innerHTML = '';
      return;
    }
    rows.innerHTML = Object.keys(aiFeatureLabels).map(key => {
      const feature = features[key] || {};
      const pending = state.aiFeaturePending === key;
      const disabled = pending || !feature.hardEnabled;
      return `<label class="ai-feature-row">
        <span><strong>${esc(aiFeatureLabels[key])}</strong><small>${feature.hardEnabled ? (feature.effectiveEnabled ? '运行中' : '已暂停') : `${esc(feature.environmentVariable)} 未开启`}</small></span>
        <input type="checkbox" data-ai-feature="${esc(key)}" ${feature.runtimeEnabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${esc(aiFeatureLabels[key])}">
      </label>`;
    }).join('');
  }

  async function loadAssistantRuntime() {
    if (!can('manage_users') || state.data?.impersonation) return;
    state.assistantRuntimeError = '';
    try {
      state.assistantRuntime = await api('/api/assistant/runtime');
    } catch (error) {
      state.assistantRuntime = null;
      state.assistantRuntimeError = assistantRuntimeError(error.message || '无法加载 AI 引擎状态');
    }
    renderAssistantRuntime();
  }

  async function loadAIFeatures() {
    if (!can('manage_users') || state.data?.impersonation) return;
    state.aiFeaturesError = '';
    try {
      const response = await api('/api/sales-crm/ai/features');
      state.aiFeatures = response.features || {};
      syncBootstrapFeatures(state.aiFeatures);
    } catch (error) {
      state.aiFeatures = null;
      state.aiFeaturesError = assistantRuntimeError(error.message || '无法加载 AI 功能开关');
    }
    renderAIFeatures();
  }

  async function setAIFeature(key, enabled) {
    if (state.aiFeaturePending || !can('manage_users')) return;
    state.aiFeaturePending = key;
    state.aiFeaturesError = '';
    renderAIFeatures();
    try {
      const response = await api(`/api/sales-crm/ai/features/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      state.aiFeatures = response.features || state.aiFeatures;
      syncBootstrapFeatures(state.aiFeatures);
      toast(`${aiFeatureLabels[key] || key}已${enabled ? '开启' : '关闭'}`);
    } catch (error) {
      state.aiFeaturesError = assistantRuntimeError(error.message || '无法更新 AI 功能开关');
      await loadAIFeatures();
    } finally {
      state.aiFeaturePending = '';
      renderAIFeatures();
    }
  }

  async function setAssistantRuntimeMode(mode) {
    if (state.assistantRuntimePending || !can('manage_users')) return;
    state.assistantRuntimePending = true;
    state.assistantRuntimeError = '';
    renderAssistantRuntime();
    try {
      state.assistantRuntime = await api('/api/assistant/runtime', { method: 'PATCH', body: JSON.stringify({ mode }) });
      toast('AI 引擎模式已更新');
    } catch (error) {
      state.assistantRuntimeError = assistantRuntimeError(error.message || '无法更新 AI 引擎模式');
    } finally {
      state.assistantRuntimePending = false;
      renderAssistantRuntime();
    }
  }

  async function recheckAssistantRuntime() {
    if (state.assistantRuntimePending || !can('manage_users')) return;
    state.assistantRuntimePending = true;
    state.assistantRuntimeError = '';
    renderAssistantRuntime();
    try {
      state.assistantRuntime = await api('/api/assistant/runtime/recheck', { method: 'POST', body: '{}' });
      toast('AI 引擎状态已重新检测');
    } catch (error) {
      state.assistantRuntimeError = assistantRuntimeError(error.message || 'AI 引擎检测失败');
    } finally {
      state.assistantRuntimePending = false;
      renderAssistantRuntime();
    }
  }

  function auditOperator(row) {
    if (row.real_user_id && row.effective_user_id && row.real_user_id !== row.effective_user_id) {
      return `${row.real_user_name || row.real_user_id} → ${row.effective_user_name || row.effective_user_id}`;
    }
    return row.user_name || row.real_user_name || row.user_id || '系统';
  }

  function maintenanceList(value) {
    return String(value || '').split(/[\s,，]+/).map(item => item.trim()).filter(Boolean);
  }

  function renderMaintenance() {
    if (!can('manage_data_maintenance')) return;
    const batch = $('#maintenanceBatch');
    const owner = $('#maintenanceOwner');
    if (batch) {
      const current = batch.value;
      batch.innerHTML = '<option value="">全部批次</option>' + (state.data.intake?.batches || []).map(item =>
        `<option value="${esc(item.id)}">${esc(item.batch_date || item.id)} · ${esc(item.id)}</option>`).join('');
      batch.value = current;
    }
    if (owner) {
      const current = owner.value;
      owner.innerHTML = '<option value="">全部负责人</option>' + state.data.users.filter(user => user.role === 'sales').map(user =>
        `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
      owner.value = current;
    }
    renderMaintenancePreview();
    renderMaintenanceRuns();
  }

  function renderMaintenancePreview() {
    const panel = $('#maintenancePreviewPanel');
    if (!panel) return;
    const preview = state.maintenancePreview;
    panel.classList.toggle('hidden', !preview);
    if (!preview) return;
    const counts = preview.counts || {};
    const metrics = [
      ['线索', counts.intakeItems], ['CRM客户', counts.accounts], ['跟进', counts.activities],
      ['询价', counts.rfqs], ['报价', counts.quotes], ['订单', counts.orders],
      ['CRM联系人', counts.contacts], ['经理评价', counts.evaluations], ['通知', counts.notifications],
    ];
    const blocked = Number(counts.conflicts || 0) > 0;
    panel.innerHTML = `<div class="panel-head"><div><p class="eyebrow red">IMPACT PREVIEW</p><h2>影响范围预览</h2></div><span class="panel-note">预览有效至 ${esc(shortDate(preview.expiresAt, true))}</span></div>
      <div class="maintenance-impact">${metrics.map(([label, value]) => `<div><span>${label}</span><strong>${Number(value || 0)}</strong></div>`).join('')}</div>
      ${blocked ? `<div class="maintenance-conflict">检测到 ${counts.conflicts} 个数据关系冲突，已禁止执行。请先检查关联数据。</div>` : ''}
      ${counts.skippedByStatus ? `<div class="maintenance-note">${counts.skippedByStatus} 条指定线索因状态不适用而跳过。</div>` : ''}
      <div class="maintenance-confirm">
        <label>输入确认文字 <strong>${esc(preview.confirmationText)}</strong><input id="maintenanceConfirmation" autocomplete="off" placeholder="完整输入上方文字"></label>
        <button id="maintenanceExecuteBtn" class="button danger" type="button" ${blocked || !counts.intakeItems ? 'disabled' : ''}>备份并执行重置</button>
      </div>`;
  }

  function renderMaintenanceRuns() {
    const root = $('#maintenanceRunsTable');
    if (!root || !can('manage_data_maintenance')) return;
    root.innerHTML = table(['时间', '操作人', '状态', '目标', '备份'], (state.maintenanceRuns || []).map(run => [
      esc(shortDate(run.createdAt, true)), esc(userById(run.realUserId)?.name || run.realUserId || '系统'),
      `<span class="pill ${run.status === 'completed' ? '' : run.status === 'failed' ? 'red' : 'amber'}">${esc(run.status)}</span>`,
      `${Number(run.resultCounts?.resetIntakeItems ?? run.previewCounts?.intakeItems ?? 0)} 条分配`,
      run.backupFile ? `<span class="subtle">${esc(run.backupFile)}</span>` : '<span class="subtle">—</span>',
    ]));
  }

  async function loadMaintenanceRuns() {
    if (!can('manage_data_maintenance') || state.data.impersonation) return;
    const result = await api('/api/sales-crm/data-maintenance/runs?limit=20');
    state.maintenanceRuns = result.runs || [];
    renderMaintenanceRuns();
  }

  async function previewMaintenance() {
    const batchId = $('#maintenanceBatch').value;
    const ownerId = $('#maintenanceOwner').value;
    const itemIds = maintenanceList($('#maintenanceItemIds').value);
    const allAssigned = $('#maintenanceAllAssigned').checked;
    const filters = {
      batchIds: batchId ? [batchId] : [], ownerIds: ownerId ? [ownerId] : [], intakeItemIds: itemIds, allAssigned,
    };
    const result = await api('/api/sales-crm/data-maintenance/preview', {
      method: 'POST', body: JSON.stringify({ operation: 'reset_assignments', filters }),
    });
    state.maintenancePreview = result;
    renderMaintenancePreview();
    $('#maintenancePreviewPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function executeMaintenance() {
    const preview = state.maintenancePreview;
    if (!preview) throw new Error('请先预览影响范围');
    const confirmationText = String($('#maintenanceConfirmation')?.value || '');
    const button = $('#maintenanceExecuteBtn');
    button.disabled = true;
    button.textContent = '正在备份并重置…';
    try {
      const result = await api('/api/sales-crm/data-maintenance/execute', {
        method: 'POST', body: JSON.stringify({ previewId: preview.previewId, confirmationText }), timeoutMs: 120000,
      });
      state.maintenancePreview = null;
      await load();
      switchView('maintenance');
      await loadMaintenanceRuns();
      toast(`已重置 ${result.counts.resetIntakeItems} 条分配，备份已生成`);
    } finally {
      if (button) { button.disabled = false; button.textContent = '备份并执行重置'; }
    }
  }

  function renderPermissionGroups(canMutate = can('manage_users') && !state.data.impersonation) {
    const root = $('#permissionGroupTable');
    if (!root) return;
    root.innerHTML = table(
      ['权限组', '角色', '权限', '成员', '操作'],
      (state.data.permissionGroups || []).map(group => [
        `<div class="company-cell"><strong>${esc(group.name)}</strong><span>${esc(group.description || '—')}</span></div>`,
        `<span class="pill">${roleLabel(group.role)}</span>`,
        `<span class="subtle">${Object.values(group.permissions || {}).filter(Boolean).length} 项允许</span>`,
        `${group.memberCount} 人`,
        canMutate ? `<button class="text-button" data-edit-group="${esc(group.id)}">编辑</button>` : '<span class="subtle">—</span>',
      ]),
    );
  }

  function openCustomer(customerId) {
    state.selectedCustomerId = customerId;
    state.drawerAiContext = null;
    renderDrawer();
    $('#drawerUpdateBtn').classList.toggle('hidden', !can('record_activity'));
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
  }

  function customerAiSection(context) {
    if (!can('use_ai_assistant')) return '';
    return `<section class="customer-ai">
      <div class="insight-head"><div><p class="eyebrow">CUSTOMER AI</p><h3>AI 问答</h3></div><span class="ai-badge">当前客户 · ${esc(context.companyName || '未命名客户')}</span></div>
      <div class="customer-ai-body">
        <div id="drawerAiAnswer" class="customer-ai-answer">可以直接询问客户价值、风险、联系人、开发切入点和下一步动作。</div>
        <form id="drawerAiForm" class="customer-ai-form">
          <textarea name="message" rows="2" placeholder="围绕这个客户提问，例如：下一步最值得做什么？" required></textarea>
          <button class="button primary" type="submit">发送</button>
        </form>
      </div>
    </section>`;
  }

  function openIntakeProfile(itemId) {
    const item = state.data.intake?.items?.find(row => row.id === itemId);
    if (!item) return;
    const signals = intakeSignals(item);
    const layers = intakeDecisionLayers(item);
    state.selectedCustomerId = '';
    state.drawerAiContext = {
      companyName: item.company_name || '',
      intakeItemId: item.id,
      profileSummary: [
        `客户：${item.company_name || '未命名客户'}`,
        `地区：${item.country || '未标注'}`,
        `行业/类型：${[item.industry, item.customer_type].filter(Boolean).join(' · ') || '未标注'}`,
        `产品重点：${item.product_focus || '未标注'}`,
        `Fit：${signals.fitScore} / ${signals.fitGrade}；readiness：${signals.readiness}；优先级：${signals.priority}`,
        `联系人等级：${item.contact_level || 'L0'}；分配状态：${intakeStatusLabel(item.status)}`,
        `分配依据：${item.decision_reason || '暂无'}`,
      ].join('\n'),
      view: state.view,
    };
    $('#drawerStage').textContent = intakeStatusLabel(item.status);
    $('#drawerCompany').textContent = item.company_name || '未命名客户';
    $('#drawerMeta').textContent = [item.external_customer_id, item.country, item.customer_type || item.industry].filter(Boolean).join(' · ');
    $('#drawerUpdateBtn').classList.add('hidden');
    const evidence = jsonList(item.evidence_urls).filter(url => /^https?:\/\//i.test(url));
    $('#drawerContent').innerHTML = `
      <div class="next-step"><div><span class="eyebrow">ASSIGNMENT STATUS</span><p>${esc(item.status === 'assigned' ? '公司已分配，领取后进入 CRM 并开始跟进。' : '查看客户资料与匹配依据。')}</p></div><span class="pill amber">${esc(intakeStatusLabel(item.status))}</span></div>
      <div class="account-facts">
        ${[['建议负责人', item.assigned_owner_name || item.suggested_owner_name], ['Fit评分 / 等级', `${signals.fitScore} / ${signals.fitGrade}`], ['readiness', signals.readiness], ['优先级', signals.priority], ['联系人等级', item.contact_level], ['领取截止', shortDate(item.claim_due_at, true)]].map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${esc(value || '—')}</strong></div>`).join('')}
      </div>
      <section class="decision-review">
        <div class="insight-head"><div><p class="eyebrow">ASSIGNMENT ARBITRATION</p><h3>分配三层裁决</h3></div><span class="pill ${item.arbitration?.candidateSnapshotId ? '' : 'gray'}">${item.arbitration?.candidateSnapshotId ? '已绑定候选快照' : '无可用快照'}</span></div>
        <div class="decision-review-grid">${layers.ai}${layers.rule}${layers.manual}</div>
        <div class="decision-audit"><span class="eyebrow">AUDIT TRAIL</span>${intakeAuditMarkup(item)}</div>
      </section>
      <section class="master-profile">
        <div class="insight-head"><div><p class="eyebrow">CUSTOMER PROFILE</p><h3>客户资料</h3></div>${item.report_url ? `<a class="text-button" href="${esc(item.report_url)}" target="_blank" rel="noopener">查看背调报告</a>` : ''}</div>
        <div class="master-profile-grid">
          <div><span>企业与地区</span><p>${esc([item.company_name, item.country].filter(Boolean).join(' · ') || '未标注')}</p></div>
          <div><span>行业与类型</span><p>${esc([item.industry, item.customer_type].filter(Boolean).join(' · ') || '未标注')}</p></div>
          <div><span>联系人</span><p>${esc([item.contact_name, item.contact_title, item.contact_methods].filter(Boolean).join(' · ') || '暂无具名联系人')}</p></div>
          <div><span>分配依据 / 阻断原因</span><p>${esc(item.decision_reason || item.arbitration?.ruleDecision?.reason || '暂无')}</p></div>
          <div><span>筛选证据</span><p>${evidence.length ? evidence.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`).join('<br>') : '暂无关联证据'}</p></div>
        </div>
      </section>
      ${customerAiSection(state.drawerAiContext)}
    `;
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
    const timeline = (state.data.timeline || []).filter(item => item.customer_id === account.id);
    const insightData = state.data.insights || { contacts: [], evaluations: [] };
    const contacts = insightData.contacts.filter(item => item.customerId === account.id);
    const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
    const companyEvaluations = evaluations.filter(item => item.subjectType === 'company');
    const canEvaluate = can('manage_evaluations');
    const alert = alertFor(account.id);
    state.drawerAiContext = { customerId: account.external_customer_id || account.id, crmCustomerId: account.id, companyName: account.company_name, view: state.view };
    $('#drawerContent').innerHTML = `
      ${alert ? `<div class="next-step" style="border-color:${alert.severity === 'critical' ? '#e0a09c' : '#e5c27c'}"><div><strong>${esc(alert.title)}</strong><p>${esc(alert.detail)}</p></div><span class="pill ${alert.severity === 'critical' ? 'red' : 'amber'}">${esc(alert.action)}</span></div>` : ''}
      <div class="next-step"><div><span class="eyebrow">NEXT ACTION</span><p>${esc(account.next_action || '尚未填写下一步')}</p></div><time>${shortDate(account.next_action_at, true)}</time></div>
      <div class="account-facts">
        ${[['负责人', account.owner_name || '不分配'], ['创建人', account.creator_name || '历史数据'], ['优先级', `${account.priority} · ${money(account.potential_value)}`], ['客户来源', account.source], ['产品重点', account.product_focus], ['评价标签', labelsForAccount(account.id).join('、') || '暂无AI标签'], ['最近动作', relative(account.last_activity_at)], ['管理介入', account.manager_status || (account.manager_required ? '待介入' : '暂不需要')], ['官网', account.website], ['客户编号', account.external_customer_id], ['客户分组', account.current_pool], ['联系人质量', account.best_contact_level]].map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${esc(value || '—')}</strong></div>`).join('')}
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
      ${customerAiSection(state.drawerAiContext)}
      <div class="commerce-strip">
        <div class="commerce-card"><span>询价</span><strong>${rfqs.length}</strong></div>
        <div class="commerce-card"><span>累计报价</span><strong>${money(quotes.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
        <div class="commerce-card"><span>累计订单</span><strong>${money(orders.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${rfqs.length && can('record_quote') ? '<button class="button secondary" data-add-quote>＋ 记录报价</button>' : ''}
        ${quotes.length && can('record_order') ? '<button class="button secondary" data-add-order>＋ 记录订单</button>' : ''}
        ${can('edit_customer') ? '<button class="button secondary" data-edit-account>调整客户信息</button>' : ''}
        ${!state.data.impersonation && ((state.data.user.role === 'sales' && account.owner_id === state.data.user.id) || can('manage_customer_recycle'))
          ? '<button class="button danger" data-return-customer="' + esc(account.id) + '">退回线索池</button>' : ''}
        ${!state.data.impersonation && can('manage_manual_customer_deletion') && !account.intake_item_id && account.source_file === 'CRM手工新增'
          ? '<button class="button danger" data-trash-customer="' + esc(account.id) + '">删除到回收站</button>' : ''}
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
      <div><div class="panel-head" style="padding-left:0;padding-right:0"><div><p class="eyebrow">FULL TIMELINE</p><h2>完整客户时间线</h2></div><span class="panel-note">${timeline.length} 条记录</span></div>
      <div class="timeline">${timeline.map(event => {
        const meta = activityMeta[event.event_type] || [event.title || event.kind || '客户事件', '记'];
        return `<div class="timeline-item" data-timeline-kind="${esc(event.kind || 'activity')}"><h4>${esc(event.title || meta[0])}</h4><p>${esc(event.summary || '无补充说明')}${event.next_action && event.next_action !== event.summary ? `<br><strong>下一步：</strong>${esc(event.next_action)}` : ''}</p><time>${esc(event.actor_name || '')}${event.actor_name ? ' · ' : ''}${shortDate(event.occurred_at, true)}</time></div>`;
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

  function setActivityType(activityType) {
    state.activityType = activityType || '';
    $$('.activity-type').forEach(item =>
      item.classList.toggle('active', item.dataset.activity === state.activityType));
    const form = $('#activityForm');
    if (!form) return;
    form.elements.activityType.value = state.activityType;
    $('#rfqFields')?.classList.toggle('hidden', state.activityType !== 'rfq');
  }

  function setActivityField(form, name, value) {
    const field = form?.elements?.[name];
    if (field) field.value = String(value || '');
  }

  function proposalRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function applyActionProposal(task) {
    const form = $('#activityForm');
    const value = task?.result?.value;
    if (!form || !value) throw new Error('活动提案没有可用结果');
    setActivityType(value.activityType);
    setActivityField(form, 'channel', value.channel);
    setActivityField(form, 'outcome', value.outcome);
    setActivityField(form, 'summary', value.summary);
    setActivityField(form, 'nextAction', value.nextAction);
    setActivityField(form, 'nextActionAt', String(value.nextActionAt || '').replace(' ', 'T').slice(0, 16));
    setActivityField(form, 'proposalJobId', task.taskId);
    const missingLabels = {
      activityType: '本次动作', channel: '渠道', outcome: '结果',
      summary: '简短记录', nextAction: '下一步动作', nextActionAt: '计划时间',
    };
    const missing = (value.missingFields || []).map(field => missingLabels[field] || field);
    const confidence = Math.round(Number(value.confidence || 0) * 100);
    const status = $('#actionProposalStatus');
    status.className = `action-proposal-status ${confidence < 70 || missing.length ? 'warning' : 'ready'}`;
    status.textContent = missing.length
      ? `AI 草稿置信度 ${confidence}%。确认前请补充：${missing.join('、')}。`
      : `AI 草稿置信度 ${confidence}%。请核对并修改，确认后才会写入客户时间线。`;
    $('#activitySubmit').textContent = '确认并记录';
  }

  async function loadActionProposal(jobId) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const payload = await api(`/api/sales-crm/ai/tasks/${encodeURIComponent(jobId)}`);
      const task = payload.task;
      if (task?.result && ['needs_review', 'succeeded'].includes(task.state)) return task;
      if (['dead_letter', 'failed', 'blocked', 'cancelled'].includes(task?.state)) {
        throw new Error(task.errorSummary || '活动提案生成失败');
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('活动提案仍在处理中，请稍后重试');
  }

  async function generateActionProposal() {
    const form = $('#activityForm');
    const button = $('#actionProposalGenerate');
    const status = $('#actionProposalStatus');
    const input = $('#actionProposalInput')?.value.trim() || '';
    const account = scopedAccounts().find(item => item.id === form?.elements?.customerId?.value);
    if (!account) return toast('请先选择客户');
    if (input.length < 3) return toast('请描述本次触达结果');
    button.disabled = true;
    status.className = 'action-proposal-status';
    status.textContent = '正在整理活动字段…';
    try {
      const created = await api(`/api/sales-crm/ai/customers/${encodeURIComponent(account.external_customer_id)}/action-proposals`, {
        method: 'POST',
        body: JSON.stringify({ input, clientRequestId: proposalRequestId() }),
      });
      const task = await loadActionProposal(created.job.id);
      applyActionProposal(task);
    } catch (error) {
      status.className = 'action-proposal-status error';
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function openActivityModal(customerId = '') {
    state.activityType = 'email';
    openModal('记录客户动作', 'QUICK UPDATE · 30秒完成', `
      <form id="activityForm" class="form-grid two">
        <label class="span-2">客户<select name="customerId" required><option value="">请选择客户</option>${customerOptions(customerId)}</select></label>
        ${customerAIEnabled() && can('use_ai_assistant') ? `<section class="action-proposal-compose span-2">
          <div><strong>AI 整理触达结果</strong><span>输入事实描述，AI 只填写草稿，不会直接写入 CRM。</span></div>
          <textarea id="actionProposalInput" maxlength="4000" placeholder="例如：客户通过邮件回复，对STM32有兴趣，本周五整理BOM发给我，下周一上午跟进。"></textarea>
          <button id="actionProposalGenerate" class="button secondary" type="button">整理为活动草稿</button>
          <p id="actionProposalStatus" class="action-proposal-status" role="status" aria-live="polite"></p>
        </section>` : ''}
        <input type="hidden" name="proposalJobId" value="">
        <div class="span-2"><label>本次动作</label><div id="activityTypes" class="activity-types">${[
          ['email', '发送邮件'], ['call', '电话开发'], ['social', '社媒联系'], ['reply', '客户回复'],
          ['meeting', '视频会议'], ['manager_join', '管理者介入'], ['rfq', '收到询价'], ['negotiation', '商务谈判'], ['lost', '暂停/流失'],
        ].map(([key, label], index) => `<button type="button" class="activity-type ${index === 0 ? 'active' : ''}" data-activity="${key}">${label}</button>`).join('')}</div></div>
        <input type="hidden" name="activityType" value="email">
        <label>渠道<select name="channel"><option value="">请选择</option><option>email</option><option>call</option><option>WhatsApp</option><option>Telegram</option><option>LinkedIn</option><option>video</option><option>展会</option><option>business</option><option>other</option></select></label>
        <label>结果<select name="outcome"><option value="">请选择</option><option>已完成</option><option>有兴趣</option><option>需要跟进</option><option>未接通</option><option>暂无回复</option><option>明确拒绝</option></select></label>
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
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button id="activitySubmit" class="button primary">保存并更新阶段</button></div>
      </form>`);
  }

  function openNewCustomerModal() {
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    const canLeaveUnassigned = can('view_all_customers') && can('manage_intake');
    openModal('新增对口客户', 'CUSTOMER INTAKE', `<form id="customerForm" class="form-grid two">
      <label>公司名称<input name="companyName" placeholder="公司名称或官网至少填写一项"></label>
      <label>官网<input name="website" type="url" placeholder="https://example.com"></label>
      <label>国家（可选）<input name="country"></label><label>城市<input name="city"></label>
      <label>行业<input name="industry" placeholder="工业控制、汽车电子等"></label><label>客户类型<select name="customerType"><option>终端制造商</option><option>EMS/代工厂</option><option>贸易商</option><option>维修企业</option><option>方案公司</option></select></label>
      <label>客户来源<select name="source"><option>公司指派</option><option>销售自行搜索</option><option>展会</option><option>LinkedIn</option><option>海关数据</option><option>老客户介绍</option></select></label>
      <label>负责人<select name="ownerId" id="newCustomerOwner">${canLeaveUnassigned ? '<option value="">不分配</option>' : ''}${sales.map(user => `<option value="${user.id}" ${user.id === state.data.user.id ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select></label>
      <label>重点产品<input name="productFocus" placeholder="IC、连接器、传感器等"></label><label>潜在金额（USD）<input name="potentialValue" type="number" min="0"></label>
      <label>优先级<select name="priority"><option>A</option><option selected>B</option><option>C</option></select></label><label>首次行动时间<input name="nextActionAt" type="datetime-local" value="${dateInput(1)}"></label>
      <label class="span-2">下一步<input name="nextAction" value="完成首次触达"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" id="newCustomerSubmit">创建客户</button></div>
    </form>`);
  }

  function openQuoteModal(customerId) {
    openModal('记录报价', 'QUOTATION', `<form id="quoteForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <label>报价金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>预计毛利率 %<input name="grossMargin" type="number" step=".1" value="8"></label><label>报价后跟进时间<input name="nextFollowAt" type="datetime-local" value="${dateInput(3)}"></label>
      <label class="span-2 check"><input name="lossLeader" type="checkbox"> 首单低价/亏本引流报价</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存报价</button></div>
    </form>`);
  }
  function openOrderModal(customerId) {
    const quotes = state.data.quotes.filter(item => item.customer_id === customerId)
      .slice().sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')));
    openModal('记录客户订单', 'ORDER WON', `<form id="orderForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <label class="span-2">关联报价<select name="quoteId" required>${quotes.map(quote => `<option value="${esc(quote.id)}">${esc(quote.id)} · ${money(quote.amount)} ${esc(quote.currency || 'USD')} · ${esc(quote.status || 'sent')}</option>`).join('')}</select></label>
      <label>订单金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>实际毛利率 %<input name="grossMargin" type="number" step=".1" value="5"></label><label>下一次经营动作<input name="nextActionAt" type="datetime-local" value="${dateInput(14)}"></label>
      <label class="span-2 check"><input name="isRepeat" type="checkbox"> 这是复购订单</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认订单</button></div>
    </form>`);
  }
  function groupOptions(role, selected = '') {
    return (state.data.permissionGroups || []).filter(group => group.role === role)
      .map(group => `<option value="${esc(group.id)}" ${group.id === selected ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
  }

  function openUserModal() {
    openModal('新增团队用户', 'USER & ROLE', `<form id="userForm" class="form-grid two">
      <label>姓名<input name="name" required></label><label>工作邮箱<input name="email" type="email" required></label>
      <label>角色<select name="role" data-role-source><option value="sales">销售代表</option><option value="manager">销售经理</option><option value="admin">系统管理员</option></select></label>
      <label>权限组<select name="permissionGroupId" data-role-group required>${groupOptions('sales')}</select></label>
      <label>初始密码<input name="password" type="password" placeholder="留空则由系统随机生成" minlength="8" autocomplete="new-password"></label>
      <label class="span-2">语言（用逗号分隔）<input name="languages" placeholder="英文, 俄语"></label>
      <label>优势国家<input name="countries" placeholder="俄罗斯, 哈萨克斯坦"></label><label>优势渠道<input name="channels" placeholder="电话, Telegram"></label>
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

  function openEditUserModal(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    openModal(`编辑账号 · ${user.name}`, 'ACCOUNT & GROUP', `<form id="editUserForm" class="form-grid two">
      <input type="hidden" name="userId" value="${esc(user.id)}">
      <label>姓名<input name="name" value="${esc(user.name)}" required></label>
      <label>角色<select name="role" data-role-source>${['sales', 'manager', 'admin'].map(role => `<option value="${role}" ${role === user.role ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}</select></label>
      <label>权限组<select name="permissionGroupId" data-role-group required>${groupOptions(user.role, user.permissionGroupId)}</select></label>
      <label>状态<select name="active"><option value="true" ${user.active ? 'selected' : ''}>启用</option><option value="false" ${user.active ? '' : 'selected'}>停用</option></select></label>
      <label class="span-2">语言（用逗号分隔）<input name="languages" value="${esc(user.languages.join(', '))}"></label>
      <label>优势国家<input name="countries" value="${esc(user.countries.join(', '))}"></label>
      <label>优势渠道<input name="channels" value="${esc(user.channels.join(', '))}"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存账号</button></div>
    </form>`);
  }

  function openPermissionGroupModal(groupId = '') {
    const group = groupId ? (state.data.permissionGroups || []).find(item => item.id === groupId) : null;
    if (groupId && !group) return;
    const permissions = group?.permissions || state.data.rolePermissions?.sales || {};
    openModal(group ? `编辑权限组 · ${group.name}` : '新建权限组', 'PERMISSION GROUP', `<form id="permissionGroupForm" class="form-grid">
      <input type="hidden" name="groupId" value="${esc(group?.id || '')}">
      <div class="form-grid two">
        <label>名称<input name="name" value="${esc(group?.name || '')}" required></label>
        <label>角色<select name="role" ${group ? 'disabled' : ''}>${['sales', 'manager', 'admin'].map(role => `<option value="${role}" ${role === (group?.role || 'sales') ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}</select></label>
      </div>
      <label>描述<input name="description" value="${esc(group?.description || '')}" placeholder="该组的适用团队与用途"></label>
      <div class="recommendation"><strong>组默认权限</strong><br>成员默认继承这里的布尔权限；个人差异通过用户行的“个人权限”做继承/允许/拒绝三态覆盖。${group ? '' : '切换角色会套用该角色的默认模板。'}</div>
      <div class="permission-editor">${permissionFields(permissions)}</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">${group ? '保存权限组' : '创建权限组'}</button></div>
    </form>`);
  }

  function permissionOverrideFields(user) {
    return Object.entries(state.data.permissionDefinitions || {}).map(([key, label]) => {
      const inherited = Boolean(state.data.permissionGroups.find(group => group.id === user.permissionGroupId)?.permissions[key]);
      const selected = user.permissionOverrides?.[key] || 'inherit';
      return `<div class="permission-override-row">
        <div><strong>${esc(label)}</strong><small>组默认：${inherited ? '允许' : '拒绝'} · 当前：${user.permissions[key] ? '允许' : '拒绝'}</small></div>
        <select name="override__${esc(key)}">
          <option value="inherit" ${selected === 'inherit' ? 'selected' : ''}>继承</option>
          <option value="allow" ${selected === 'allow' ? 'selected' : ''}>允许</option>
          <option value="deny" ${selected === 'deny' ? 'selected' : ''}>拒绝</option>
        </select>
      </div>`;
    }).join('');
  }

  function openOverridesModal(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    openModal(`个人权限 · ${user.name}`, 'GROUP DEFAULTS + OVERRIDES', `<form id="permissionOverrideForm" class="form-grid">
      <input type="hidden" name="userId" value="${esc(user.id)}">
      <div class="recommendation"><strong>${esc(user.email)}</strong><br>权限组：${esc(user.permissionGroupName || '未分配')}。“继承”跟随组默认并随组调整自动更新；“允许 / 拒绝”只影响该账号。</div>
      <div class="permission-override-list">${permissionOverrideFields(user)}</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存个人权限</button></div>
    </form>`);
  }

  function openAdminPasswordResetModal(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    openModal(`重置密码 · ${user.name}`, 'ADMIN PASSWORD RESET', `<form id="adminPasswordResetForm" class="form-grid">
      <input type="hidden" name="userId" value="${esc(user.id)}">
      <div class="recommendation"><strong>${esc(user.email)}</strong><br>重置为永久密码，无需首次登录修改；该账号的全部现有登录态会立即失效。</div>
      <label>新密码<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>确认新密码<input name="passwordConfirm" type="password" minlength="8" autocomplete="new-password" required></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">重置密码</button></div>
    </form>`);
  }
  function openEditAccountModal(customerId) {
    const account = state.data.accounts.find(item => item.id === customerId);
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    const canAssign = can('edit_customer') && can('view_all_customers') && can('manage_intake');
    openModal('调整客户信息', 'ACCOUNT CONTROL', `<form id="editAccountForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <label>阶段<select name="stage" ${can('edit_customer') ? '' : 'disabled'}>${state.data.stages.map(item => `<option value="${item.key}" ${item.key === account.stage ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
      <label>负责人<select name="ownerId" ${canAssign ? '' : 'disabled'}><option value="" ${account.owner_id ? '' : 'selected'}>不分配</option>${sales.map(user => `<option value="${user.id}" ${user.id === account.owner_id ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select></label>
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
      <input type="hidden" name="itemId" value="${esc(itemId)}"><input type="hidden" name="action" value="${esc(action)}"><input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <label>原因<textarea name="reason" required placeholder="${action === 'reject' ? '说明行业、产品、地区或客户类型为何不匹配' : '说明无法继续跟进或需要重新分配的原因'}"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认提交</button></div>
    </form>`);
  }

  function openRecycleReasonModal(customerId, action) {
    const labels = {
      return: ['退回客户到线索池', '说明退回原因，客户历史记录会保留。'],
      trash: ['删除客户到回收站', '仅手工创建客户可执行，操作不会删除客户主档或经营历史。'],
      bulk: ['批量退回客户', '选中的客户会一次性退回，任一客户校验失败则全部不变。'],
    };
    const [title, note] = labels[action] || labels.return;
    openModal(title, 'CUSTOMER RECYCLE BIN', `<form id="recycleReasonForm" class="form-grid">
      <input type="hidden" name="customerId" value="${esc(customerId || '')}">
      <input type="hidden" name="action" value="${esc(action)}">
      <div class="recommendation">${esc(note)}</div>
      <label>原因<textarea name="reason" minlength="2" maxlength="500" required placeholder="请输入2至500个字符的原因"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button danger">确认操作</button></div>
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
    const previous = state.data;
    const next = await api('/api/sales-crm/bootstrap', { timeoutMs: 15000 });
    for (const config of Object.values(researchConfig)) {
      if (previous?.[config.dataKey]?.length) next[config.dataKey] = previous[config.dataKey];
    }
    state.data = next;
    populateFilters();
    renderAll();
    renderImpersonationBanner();
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
        if (state.loginPending) return;
        state.loginPending = true;
        $('#loginError').textContent = '';
        setLoginState('login');
        await api('/api/sales-auth/login', { method: 'POST', body: JSON.stringify(formPayload(form)), timeoutMs: 10000 });
        setLoginState('workspace');
        await load({ fromLogin: true });
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
        payload.companyName = String(payload.companyName || '').trim();
        payload.website = String(payload.website || '').trim();
        if (!payload.companyName && !payload.website) throw new Error('公司名称或官网至少填写一项');
        payload.nextActionAt = apiTime(payload.nextActionAt);
        const result = await api('/api/sales-crm/accounts', { method: 'POST', body: JSON.stringify(payload) });
        const enrichmentState = result.enrichment?.state === 'pending_dispatch'
          ? '资料补全已排队'
          : result.enrichment?.reasonCode
            ? `资料补全未启动：${result.enrichment.reasonCode}`
            : '资料补全状态已记录';
        await refresh(`客户已创建并分配 · ${result.externalCustomerId} · ${enrichmentState}`);
        openCustomerProfile(result.externalCustomerId);
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
        const result = await api('/api/sales-crm/users', { method: 'POST', body: JSON.stringify(payload) });
        await refresh(result.temporaryPassword ? `新用户已创建，临时密码：${result.temporaryPassword}` : '新用户已创建');
      } else if (form.id === 'editUserForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({
          name: String(payload.name || '').trim(),
          role: payload.role,
          active: payload.active === 'true',
          permissionGroupId: payload.permissionGroupId,
          languages: splitTags(payload.languages),
          countries: splitTags(payload.countries),
          channels: splitTags(payload.channels),
        }) });
        await refresh('账号已更新');
      } else if (form.id === 'permissionGroupForm') {
        const payload = formPayload(form);
        const groupId = payload.groupId;
        const body = {
          name: String(payload.name || '').trim(),
          description: String(payload.description || ''),
          permissions: permissionsFromPayload(payload),
        };
        if (groupId) {
          await api(`/api/sales-crm/permission-groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: JSON.stringify(body) });
          await refresh('权限组已更新');
        } else {
          await api('/api/sales-crm/permission-groups', { method: 'POST', body: JSON.stringify({ ...body, role: payload.role }) });
          await refresh('权限组已创建');
        }
      } else if (form.id === 'permissionOverrideForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        const overrides = {};
        Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
          overrides[key] = ['inherit', 'allow', 'deny'].includes(payload[`override__${key}`]) ? payload[`override__${key}`] : 'inherit';
        });
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/permission-overrides`, { method: 'PUT', body: JSON.stringify(overrides) });
        await refresh('个人权限已更新');
      } else if (form.id === 'adminPasswordResetForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        if (payload.password !== payload.passwordConfirm) throw new Error('两次输入的新密码不一致');
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/password-reset`, {
          method: 'POST', body: JSON.stringify({ password: payload.password, passwordConfirm: payload.passwordConfirm }),
        });
        form.reset();
        await refresh('密码已重置，该账号的现有登录态已失效');
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
      } else if (form.id === 'recycleReasonForm') {
        const payload = formPayload(form);
        const action = payload.action;
        const route = action === 'trash'
          ? `/api/sales-crm/accounts/${encodeURIComponent(payload.customerId)}/trash`
          : action === 'bulk'
            ? '/api/sales-crm/accounts/bulk-return'
            : `/api/sales-crm/accounts/${encodeURIComponent(payload.customerId)}/return`;
        const body = action === 'bulk'
          ? { customerIds: [...state.selectedCustomerIds], reason: payload.reason }
          : { reason: payload.reason };
        await api(route, { method: 'POST', body: JSON.stringify(body) });
        state.selectedCustomerIds.clear();
        await refresh(action === 'trash' ? '客户已移入回收站' : '客户已退回线索池');
        if (action === 'bulk') switchView('recycleBin');
      } else if (form.id === 'contactForm') {
        await api('/api/sales-crm/contacts', { method: 'POST', body: JSON.stringify(formPayload(form)) });
        await refresh('对接人已保存，可以分别添加经理评价');
      } else if (form.id === 'evaluationForm') {
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        button.textContent = 'AI分析中…';
        const result = await api('/api/sales-crm/evaluations', { method: 'POST', body: JSON.stringify(formPayload(form)) });
        await refresh(result.aiWarning ? '经理评价已保存；AI标注暂时失败，可稍后重试' : '经理评价和AI标注已生成');
      } else if (form.id === 'drawerAiForm') {
        const message = String(new FormData(form).get('message') || '').trim();
        if (!message) return;
        const context = state.drawerAiContext || {};
        const scopedMessage = context.profileSummary ? `${context.profileSummary}\n\n用户问题：${message}` : message;
        const button = form.querySelector('button[type=submit]');
        const answer = $('#drawerAiAnswer');
        button.disabled = true;
        button.textContent = '分析中…';
        answer.textContent = '正在结合当前客户资料分析…';
        const result = await api('/api/assistant/chat', {
          method: 'POST',
          body: JSON.stringify({ message: scopedMessage, history: [], context }),
        });
        answer.textContent = result.answer || 'AI 暂未返回有效内容，请稍后重试。';
        button.disabled = false;
        button.textContent = '发送';
      }
    } catch (error) {
      if (form.id === 'loginForm') $('#loginError').textContent = error.message;
      else {
        toast(error.message);
        if (form.id === 'drawerAiForm') {
          const button = form.querySelector('button[type=submit]');
          if (button) { button.disabled = false; button.textContent = '发送'; }
          if ($('#drawerAiAnswer')) $('#drawerAiAnswer').textContent = `AI 问答失败：${error.message}`;
        }
      }
    } finally {
      if (form.id === 'loginForm') {
        state.loginPending = false;
        setLoginState('');
      }
    }
  });

  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-view]');
    if (nav) switchView(nav.dataset.view);
    const go = event.target.closest('[data-go]');
    if (go) switchView(go.dataset.go);
    const customer = event.target.closest('[data-open-customer],[data-customer]');
    if (customer && (!event.target.closest('button,a,input,select,textarea') || customer.matches('button[data-open-customer]'))) openCustomer(customer.dataset.openCustomer || customer.dataset.customer);
    const intakeProfile = event.target.closest('[data-intake-profile]');
    if (intakeProfile && (!event.target.closest('button,a,input,select,textarea') || intakeProfile.matches('button[data-intake-profile]'))) openIntakeProfile(intakeProfile.dataset.intakeProfile);
    const master = event.target.closest('[data-open-master]');
    if (master && (!event.target.closest('button,a,input,select,textarea') || master.matches('button[data-open-master]'))) {
      openCustomerProfile(master.dataset.openMaster);
    }
    const stageJump = event.target.closest('[data-stage-jump]');
    if (stageJump) {
      switchView('customers');
      state.stageReached = stageJump.dataset.stageJump;
      $('#stageFilter').value = '';
      renderCustomers();
    }
    if (event.target.closest('[data-close-drawer]')) closeDrawer();
    if (event.target.closest('[data-close-modal]')) closeModal();
    if (event.target.closest('#customerProfileBack')) returnFromCustomerProfile();
    if (event.target.closest('#customerProfileActivity')) openActivityModal(state.selectedCustomerId);
    if (event.target.closest('#customerProfileEdit')) openEditAccountModal(state.selectedCustomerId);
    if (event.target.closest('[data-run-customer-fit]')) void runCustomerFit();
    if (event.target.closest('[data-retry-enrichment]')) void retryCustomerEnrichment();
    const cancelEnrichment = event.target.closest('[data-cancel-enrichment]');
    if (cancelEnrichment) void cancelCustomerEnrichment(cancelEnrichment.dataset.cancelEnrichment);
    const reviewEnrichment = event.target.closest('[data-review-enrichment-proposal]');
    if (reviewEnrichment) {
      void reviewCustomerEnrichmentProposal(
        reviewEnrichment.dataset.proposalId,
        reviewEnrichment.dataset.reviewEnrichmentProposal,
      );
    }
    const openAITask = event.target.closest('[data-open-ai-task]');
    if (openAITask) {
      if (state.view !== 'aiTasks') switchView('aiTasks');
      void openAiTask(openAITask.dataset.openAiTask);
    }
    const aiTaskAction = event.target.closest('[data-ai-task-action]');
    if (aiTaskAction) void actOnAiTask(aiTaskAction.dataset.aiTaskAction, aiTaskAction.dataset.jobId);
    if (event.target.closest('#aiTaskRefresh')) void loadAiTasks();
    if (event.target.closest('#aiTaskPrev') && state.aiTasks.page > 1) {
      state.aiTasks.page -= 1;
      void loadAiTasks();
    }
    if (event.target.closest('#aiTaskNext') && state.aiTasks.page * state.aiTasks.pageSize < state.aiTasks.total) {
      state.aiTasks.page += 1;
      void loadAiTasks();
    }
    const retryAIJob = event.target.closest('[data-retry-ai-job]');
    if (retryAIJob) void retryCustomerFit(retryAIJob.dataset.retryAiJob);
    const adoptNextActionButton = event.target.closest('[data-adopt-next-action]');
    if (adoptNextActionButton) void adoptNextAction(adoptNextActionButton.dataset.adoptNextAction);
    if (event.target.closest('#actionProposalGenerate')) void generateActionProposal();
    const activity = event.target.closest('[data-activity]');
    if (activity) setActivityType(activity.dataset.activity);
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
    if (event.target.closest('#customerExportBtn')) {
      const link = document.createElement('a');
      const params = new URLSearchParams({
        format: 'csv',
        search: $('#customerSearch')?.value || '',
        stage: $('#stageFilter')?.value || '',
        priority: $('#priorityFilter')?.value || '',
        evaluationTag: $('#evaluationTagFilter')?.value || '',
        onlyOverdue: $('#onlyOverdue')?.checked ? '1' : '',
      });
      link.href = `/api/sales-crm/export?${params}`;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    if (event.target.closest('#selectFilteredCustomers')) {
      state.selectedCustomerIds = new Set(filteredCustomerAccounts().map(account => account.id));
      renderCustomers();
    }
    if (event.target.closest('#clearCustomerSelection')) {
      state.selectedCustomerIds.clear();
      renderCustomers();
    }
    if (event.target.closest('#bulkAssignCustomers')) {
      try {
        const ownerId = $('#bulkCustomerOwner')?.value || '';
        if (!ownerId) throw new Error('请选择有效的销售负责人；退回客户请使用批量退回');
        if (!state.selectedCustomerIds.size) throw new Error('请先选择客户');
        const owner = userById(ownerId);
        if (!window.confirm(`将设置 ${state.selectedCustomerIds.size} 个客户的负责人为 ${owner?.name || ownerId}。确认继续？`)) return;
        const result = await api('/api/sales-crm/accounts/bulk-assign', {
          method: 'POST',
          body: JSON.stringify({ customerIds: [...state.selectedCustomerIds], ownerId }),
        });
        state.selectedCustomerIds.clear();
        await refresh(`已批量分配 ${result.updated} 个客户`);
      } catch (error) { toast(error.message); }
    }
    const returnCustomer = event.target.closest('[data-return-customer]');
    if (returnCustomer) openRecycleReasonModal(returnCustomer.dataset.returnCustomer, 'return');
    const trashCustomer = event.target.closest('[data-trash-customer]');
    if (trashCustomer) openRecycleReasonModal(trashCustomer.dataset.trashCustomer, 'trash');
    if (event.target.closest('#bulkReturnCustomers')) {
      if (!state.selectedCustomerIds.size) return toast('请先选择客户');
      openRecycleReasonModal('', 'bulk');
    }
    const recycleTab = event.target.closest('[data-recycle-kind]');
    if (recycleTab) {
      state.recycleKind = recycleTab.dataset.recycleKind;
      void loadRecycleBin();
    }
    if (event.target.closest('#recycleRefresh')) void loadRecycleBin();
    const restoreCustomer = event.target.closest('[data-restore-customer]');
    if (restoreCustomer) {
      try {
        await api(`/api/sales-crm/accounts/${encodeURIComponent(restoreCustomer.dataset.restoreCustomer)}/restore`, { method: 'POST', body: '{}' });
        await loadRecycleBin();
        await refresh('手工客户已恢复');
      } catch (error) { toast(error.message); }
    }
    const reassignCustomer = event.target.closest('[data-reassign-customer]');
    if (reassignCustomer) {
      const ownerId = document.querySelector(`[data-recycle-owner="${CSS.escape(reassignCustomer.dataset.reassignCustomer)}"]`)?.value || '';
      if (!ownerId) return toast('请选择目标销售');
      const reason = window.prompt('请输入重新分配原因', '按区域和语言能力重新分配') || '';
      if (!reason.trim()) return;
      try {
        await api(`/api/sales-crm/accounts/${encodeURIComponent(reassignCustomer.dataset.reassignCustomer)}/reassign`, {
          method: 'POST', body: JSON.stringify({ ownerId, reason }),
        });
        await loadRecycleBin();
        await refresh('客户已重新分配');
      } catch (error) { toast(error.message); }
    }
    const loadMore = event.target.closest('[data-load-research]');
    if (loadMore) await loadResearch(loadMore.dataset.loadResearch);
    if (event.target.closest('#intakeLoadMore')) await loadIntakePage();
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
      void loadIntakePage({ reset: true });
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
          await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify({ action, itemId, ownerId: intakeAction.dataset.ownerId || '', idempotencyKey: intakeAction.dataset.idempotencyKey || proposalRequestId() }) });
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
    const archiveUserButton = event.target.closest('[data-archive-user]');
    if (archiveUserButton && window.confirm('归档后该用户将立即退出且不能再登录，历史业务记录会保留。确认归档？')) {
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(archiveUserButton.dataset.archiveUser)}/archive`, { method: 'POST', body: '{}' });
        await refresh('用户已归档');
      } catch (error) { toast(error.message); }
    }
    const restoreUserButton = event.target.closest('[data-restore-user]');
    if (restoreUserButton) {
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(restoreUserButton.dataset.restoreUser)}/restore`, { method: 'POST', body: '{}' });
        await refresh('用户已恢复为在职状态');
      } catch (error) { toast(error.message); }
    }
    const deleteUserButton = event.target.closest('[data-delete-user]');
    if (deleteUserButton && window.confirm('永久删除仅适用于没有任何业务引用的归档用户，删除后不可恢复。确认继续？')) {
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(deleteUserButton.dataset.deleteUser)}`, { method: 'DELETE' });
        await refresh('归档用户已永久删除');
      } catch (error) {
        const references = (error.details?.references || []).map(item => `${item.label} ${item.count} 条`).join('、');
        toast(references ? `${error.message}：${references}` : error.message);
      }
    }
    const editUser = event.target.closest('[data-edit-user]');
    if (editUser) openEditUserModal(editUser.dataset.editUser);
    const editOverrides = event.target.closest('[data-edit-overrides]');
    if (editOverrides) openOverridesModal(editOverrides.dataset.editOverrides);
    const resetPassword = event.target.closest('[data-reset-password]');
    if (resetPassword) openAdminPasswordResetModal(resetPassword.dataset.resetPassword);
    const editGroup = event.target.closest('[data-edit-group]');
    if (editGroup) openPermissionGroupModal(editGroup.dataset.editGroup);
    if (event.target.closest('#newPermissionGroupBtn')) openPermissionGroupModal();
    if (event.target.closest('#assistantRuntimeRecheck')) {
      await recheckAssistantRuntime();
    }
    if (event.target.closest('[data-run-sales-pack]')) await runSalesPack();
    if (event.target.closest('#maintenancePreviewBtn')) {
      try { await previewMaintenance(); } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#maintenanceExecuteBtn')) {
      try { await executeMaintenance(); } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#maintenanceRefreshRuns')) {
      try { await loadMaintenanceRuns(); } catch (error) { toast(error.message); }
    }
    const startInspection = event.target.closest('[data-start-impersonation]');
    if (startInspection) {
      try { await startIdentityInspection(startInspection.dataset.startImpersonation); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#stopImpersonationBtn')) {
      try { await stopIdentityInspection(); }
      catch (error) { toast(error.message); }
    }
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

  document.addEventListener('change', event => {
    if (event.target.matches('#assistantRuntimeMode')) void setAssistantRuntimeMode(event.target.value);
    if (event.target.matches('[data-ai-feature]')) void setAIFeature(event.target.dataset.aiFeature, event.target.checked);
    if (event.target.matches('#aiTaskStateFilter,#aiTaskTypeFilter,#aiTaskFromFilter,#aiTaskToFilter')) void loadAiTasks({ reset: true });
    if (event.target.matches('[data-select-customer]')) {
      const customerId = event.target.dataset.selectCustomer;
      if (event.target.checked) state.selectedCustomerIds.add(customerId);
      else state.selectedCustomerIds.delete(customerId);
      renderCustomers();
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'recycleSearch') {
      clearTimeout(loadRecycleBin.timer);
      loadRecycleBin.timer = setTimeout(() => void loadRecycleBin(), 250);
    }
  });

  function switchView(view, pushHistory = true) {
    if (!viewMeta[view]) return;
    if (view === 'aiTasks' && !customerAIEnabled()) return toast('AI 控制平面尚未启用');
    const permission = viewPermissions[view] || `view_${view}`;
    if (!can(permission)) return toast('当前账号没有该模块权限');
    state.view = view;
    const sectionView = ['pending', 'claimed'].includes(view) ? 'intake' : view;
    state.intakeStatus = view === 'pending'
      ? 'assigned'
      : view === 'claimed'
        ? 'claimed'
        : view === 'intake'
          ? (can('manage_intake') ? '' : 'assigned')
          : state.intakeStatus;
    $$('.view').forEach(item => item.classList.toggle('active', item.id === `${sectionView}View`));
    $$('#nav [data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    $('#viewEyebrow').textContent = viewMeta[view][0];
    $('#viewTitle').textContent = viewMeta[view][1];
    document.body.classList.toggle('customer-profile-active', view === 'customerProfile');
    if (sectionView === 'intake') renderIntake();
    if (sectionView === 'intake' && (state.view === 'intake' || state.view === 'pending' || state.view === 'claimed')) {
      void loadIntakePage({ reset: true });
    }
    if (researchConfig[view] && !state.research[view].loaded) void loadResearch(view);
    if (view === 'aiTasks' && !state.aiTasks.loaded) void loadAiTasks();
    if (view === 'recycleBin') void loadRecycleBin();
    if (view === 'maintenance') void loadMaintenanceRuns().catch(error => toast(error.message));
    closeDrawer();
    document.body.classList.remove('sidebar-open');
    window.scrollTo?.(0, 0);
    if (location.hash !== `#${view}`) {
      if (pushHistory) history.pushState(null, '', `#${view}`);
      else history.replaceState(null, '', `#${view}`);
    }
  }

  ['countryFilter', 'ownerFilter', 'periodFilter'].forEach(id => document.addEventListener('change', event => {
    if (event.target.id === id) {
      renderAll();
      if (['countryFilter', 'ownerFilter'].includes(event.target.id) && ['intake', 'pending', 'claimed'].includes(state.view)) {
        void loadIntakePage({ reset: true });
      }
    }
  }));
  ['customerSearch', 'stageFilter', 'priorityFilter', 'evaluationTagFilter', 'onlyOverdue'].forEach(id => document.addEventListener(id === 'customerSearch' ? 'input' : 'change', event => {
    if (event.target.id === id) {
      if (event.target.id === 'stageFilter') state.stageReached = '';
      renderCustomers();
    }
  }));
  document.addEventListener('input', event => {
    if (event.target.id === 'insightSearch') renderInsightsHub();
    if (event.target.id === 'poolSearch') scheduleResearchReload('pool');
    if (event.target.id === 'peopleSearch') scheduleResearchReload('people');
    if (event.target.id === 'reconSearch') scheduleResearchReload('recon');
    if (event.target.id === 'intakeSearch') {
      clearTimeout(state.intakeSearchTimer);
      state.intakeSearchTimer = setTimeout(() => {
        if (state.view === 'intake' || ['pending', 'claimed'].includes(state.view)) void loadIntakePage({ reset: true });
      }, 300);
    }
    if (['aiTaskCustomerFilter', 'aiTaskOwnerFilter', 'aiTaskModelFilter'].includes(event.target.id)) {
      clearTimeout(loadAiTasks.timer);
      loadAiTasks.timer = setTimeout(() => void loadAiTasks({ reset: true }), 250);
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'insightCoverageFilter') renderInsightsHub();
    if (['poolGroupFilter','poolCrmFilter'].includes(event.target.id)) void loadResearch('pool', { reset: true });
    if (event.target.id === 'peopleLevelFilter') void loadResearch('people', { reset: true });
    if (event.target.matches('select[data-role-source]')) {
      const groupSelect = event.target.closest('form')?.querySelector('select[data-role-group]');
      if (groupSelect) groupSelect.innerHTML = groupOptions(event.target.value);
    }
    if (event.target.matches('#newCustomerOwner')) {
      const submit = $('#newCustomerSubmit');
      if (submit) submit.textContent = event.target.value ? '创建并分配' : '创建客户';
    }
    if (event.target.matches('#permissionGroupForm select[name="role"]')) {
      const defaults = state.data.rolePermissions?.[event.target.value] || {};
      Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
        const input = document.querySelector(`#permissionGroupForm [name="permission__${CSS.escape(key)}"]`);
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
    if (viewMeta[view] && state.data) switchView(view, false);
  });
  window.addEventListener('popstate', () => {
    const view = location.hash.replace(/^#/, '');
    if (viewMeta[view] && state.data) switchView(view, false);
  });

  load();
})();

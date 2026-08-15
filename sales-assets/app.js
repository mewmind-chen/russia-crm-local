(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const uiFormat = window.TradePulseUIFormat;
  const nextActionTime = window.TradePulseNextActionTime;
  const dataTableOverflowState = new WeakMap();
  const dataTablesNeedingHintReset = new Set();
  let dataTableOverflowFrame = 0;
  let dataTableResizeObserver = null;
  const PAGE_SIZE_OPTIONS = Object.freeze([50, 100]);
  const paginationRegistry = new Map();
  const paginationFilterStorage = Object.freeze({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  function paginationTokens(page, totalPages) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);
    const selected = [...pages].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b);
    const tokens = [];
    selected.forEach(value => {
      if (tokens.length && value - tokens[tokens.length - 1] > 1) tokens.push('ellipsis');
      tokens.push(value);
    });
    return tokens;
  }
  function renderPagination(selector, key, input = {}, onChange) {
    const root = typeof selector === 'string' ? $(selector) : selector;
    if (!root) return;
    const total = Math.max(0, Number(input.total || 0));
    const pageSize = PAGE_SIZE_OPTIONS.includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
    const totalPages = Math.ceil(total / pageSize);
    const navigationPages = Math.max(1, totalPages);
    const page = Math.max(1, Math.min(Number(input.page || 1), navigationPages));
    input.totalPages = totalPages;
    paginationRegistry.set(key, onChange);
    root.className = `shared-pagination${input.loading ? ' is-loading' : ''}`;
    root.dataset.pagination = key;
    root.dataset.page = String(page);
    root.dataset.totalPages = String(totalPages);
    const count = `<span class="shared-pagination-info">共 ${total} 条 · 第 ${total ? page : 0} / ${totalPages} 页</span>`;
    if (totalPages <= 1) {
      root.innerHTML = count;
      return;
    }
    const info = `<span class="shared-pagination-info">共 ${total} 条 · 第 ${page} / ${totalPages} 页</span>`;
    const pages = paginationTokens(page, totalPages).map(token => token === 'ellipsis'
      ? '<span class="shared-pagination-ellipsis" aria-hidden="true">…</span>'
      : `<button class="button secondary tiny${token === page ? ' active' : ''}" type="button" data-pagination-action="page" data-page="${token}" ${token === page || input.loading ? 'disabled' : ''} aria-label="第 ${token} 页" aria-current="${token === page ? 'page' : 'false'}">${token}</button>`).join('');
    root.innerHTML = `${info}<div class="shared-pagination-controls">
      <button class="button secondary tiny" type="button" data-pagination-action="first" ${page <= 1 || input.loading ? 'disabled' : ''}>首页</button>
      <button class="button secondary tiny" type="button" data-pagination-action="prev" ${page <= 1 || input.loading ? 'disabled' : ''}>上一页</button>
      <span class="shared-pagination-pages">${pages}</span>
      <button class="button secondary tiny" type="button" data-pagination-action="next" ${page >= totalPages || input.loading ? 'disabled' : ''}>下一页</button>
      <button class="button secondary tiny" type="button" data-pagination-action="last" ${page >= totalPages || input.loading ? 'disabled' : ''}>末页</button>
      <label class="shared-pagination-size">每页<select data-pagination-size ${input.loading ? 'disabled' : ''}>${PAGE_SIZE_OPTIONS.map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size} 条</option>`).join('')}</select></label>
    </div>`;
  }
  const emptyAuthorizedListState = (pageSize = 50) => ({
    rows: [], page: 0, pageSize, total: 0, totalPages: 0, authorizedTotal: 0,
    hasMore: false, loading: false, loaded: false, error: '', summary: null,
    requestEpoch: 0, initializeEpoch: 0, filterMount: null, filterController: null,
  });
  const state = {
    data: null,
    view: 'dashboard',
    selectedCustomerId: '',
    timelineModalEvents: [],
    alertSeverity: '',
    intakeStatus: '',
    intakePage: 1,
    intakePageSize: 50,
    intakeTotal: 0,
    intakeTotalPages: 0,
    intakeHasMore: false,
    intakeLoading: false,
    selectedIntakeIds: new Set(),
    intakeSelectAllScope: null,
    pendingIntakeStat: '',
    pendingCustomerIntakeFlow: '',
    leadWorkflowApplying: false,
    intakeAssignmentPreview: null,
    intakeAssignmentSubmitting: false,
    intakeSearchTimer: null,
    intakeFilters: {
      customerTag: '', country: '', industry: '', customerType: '', contactLevel: '',
      owner: '', sourceBatch: '', updatedFrom: '', updatedTo: '',
      hasWebsite: '', hasNamedContact: '', unassignedOnly: false,
    },
    customerSearchTimer: null,
    customerRequestEpoch: 0,
    customerInitializeEpoch: 0,
    customerList: {
      rows: [], page: 1, pageSize: 50, total: 0, totalPages: 0, authorizedTotal: 0,
      hasMore: false, loading: false, loaded: false,
    },
    customerFilterMount: null,
    customerFilterController: null,
    filterPermissionAdmin: null,
    accessSection: 'accounts',
    customerFilters: {
      search: '', quickView: 'all', sort: 'pending_priority',
      countries: [], owners: [], stages: [], priorities: [], customerTypes: [],
      industries: [], sources: [], creators: [], evaluationTags: [],
      lastActionBuckets: [], nextStepBuckets: [], createdFrom: '', createdTo: '',
    },
    stageReached: '',
    teamUserId: '',
    teamStatus: {
      section: 'progress', range: '30d', data: null,
      loading: false, loaded: false, error: '', requestEpoch: 0,
      progressController: null, progressMount: null,
      collaborationController: null, collaborationMount: null,
      collaborationRows: [], collaborationPage: 1, collaborationPageSize: 50, collaborationTotal: 0,
      collaborationTotalPages: 0,
      collaborationHasMore: false, writeEnabled: false, submitting: false,
      drilldown: 'customer', progressPage: 1, progressPageSize: 50, progressTotalPages: 0,
    },
    activityType: 'email',
    activityProgressType: 'email',
    activitySelectedCustomer: null,
    activityCustomerResults: [],
    activityCustomerSearchTimer: null,
    activityCustomerRequestEpoch: 0,
    activityCustomerActiveIndex: -1,
    activityReactions: [],
    activityReactionsLoaded: false,
    activityReactionAdminRows: [],
    activityDraftBeforeReactionAdmin: null,
    activitySubmitting: false,
    activityCorrection: {
      draft: null, step: 1, originalActivityId: '', sourceCustomerId: '',
      targetCustomerId: '', reason: '', idempotencyKey: '', returnFocus: null,
      requestFingerprint: '',
      targets: [], targetRows: [], targetPage: 1, targetPageSize: 50, targetTotal: 0, targetTotalPages: 0,
      targetAuthorizedTotal: 0,
      targetHasMore: false, targetLoading: false, targetRequestEpoch: 0,
      targetController: null, targetMount: null,
      proposalRows: [], proposalPage: 1, proposalPageSize: 50, proposalTotal: 0, proposalTotalPages: 0,
      proposalAuthorizedTotal: 0,
      proposalHasMore: false, proposalLoading: false, proposalRequestEpoch: 0,
      proposalController: null, proposalMount: null, proposalCustomerId: '',
      historyRows: [], historyPage: 1, historyPageSize: 50, historyTotal: 0, historyTotalPages: 0,
      historyAuthorizedTotal: 0, historyHasMore: false, historyLoading: false,
      historyRequestEpoch: 0, historyController: null, historyMount: null,
      writeEnabled: null, statusRequestEpoch: 0,
      reviewSubmitting: '', reviewKeys: new Map(), reviewDrafts: new Map(),
    },
    modalReturnFocus: null,
    drawerOwner: '',
    drawerRequestEpoch: 0,
    drawerNextActionTimer: null,
    drawerAiContext: null,
    drawerNicknameTarget: null,
    customerProfileReturnView: 'customers',
    customerProfileExternalId: '',
    customerProfileIntakeItemId: '',
    customerProfileReadOnly: false,
    customerProfileLead: null,
    customerProfileMaster: null,
    customerAi: null,
    customerAiError: '',
    customerAiLoading: false,
    customerAiPending: false,
    customerAiTimer: null,
    customerAiPollCount: 0,
    selectedCustomerIds: new Set(),
    customerSelectionMode: 'explicit',
    customerSelectionFilterScope: null,
    notificationStatus: '',
    recycleBin: { rows: [], page: 1, pageSize: 50, total: 0, totalPages: 0, hasMore: false, loading: false },
    recycleCustomerDetail: null,
    mismatchRecordDetail: null,
    mismatchRecordRequestEpoch: 0,
    mismatchRecordExpanded: false,
    authorizedBusinessLists: Object.fromEntries([
      'intake', 'pipeline', 'alerts', 'insights', 'recycle_bin',
      'manager_tasks', 'manager_risks', 'manager_metrics', 'notifications',
    ].map(pageKey => [pageKey, emptyAuthorizedListState(50)])),
    managerTaskPage: 1,
    managerTaskPageSize: 50,
    managerMetricRange: 30,
    customerEnrichment: null,
    customerEnrichmentLastSuccess: null,
    customerEnrichmentError: '',
    customerEnrichmentPending: false,
    aiTasks: {
      items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, overview: null,
      loaded: false, loading: false, error: '',
    },
    aiGovernance: {
      metrics: [], strategies: [], feedbackLabels: {},
      loaded: false, loading: false, error: '',
    },
    managerAnomalies: {
      items: [], loaded: false, loading: false, pending: false, error: '', pollCount: 0, timer: null,
    },
    salesCoaching: {
      items: [], loaded: false, loading: false, pendingUserId: '', error: '', pollCount: 0, timer: null,
    },
    loginPending: false,
    impersonationTimer: null,
    impersonationRecovery: false,
    maintenancePreview: null,
    maintenanceRuns: [],
    protectedCustomers: {
      items: [], total: 0, query: '', status: 'all', loaded: false, loading: false,
      page: 1, pageSize: 50, totalPages: 0, hasMore: false,
      error: '', writeEnabled: null, batch: null, pendingAction: '', searchTimer: null,
      conflicts: [], conflictStatus: 'unresolved', conflictTotal: 0, unresolved: 0,
      leadWarnings: 0, blockingUnresolved: 0, canEnter172B: false,
      conflictPage: 1, conflictPageSize: 50, conflictTotalPages: 0, conflictHasMore: false,
      conflictsLoading: false, conflictsError: '', conflictPendingId: '', expandedConflictId: '',
      conflictsLoaded: false,
    },
    pendingCenter: {
      activeTab: 'conflicts', selectedKey: '', query: '', mobileDetailOpen: false,
      deepLinkUnavailable: false,
    },
    protectionWorkspace: { activeView: 'verification' },
    duplicateReviews: {
      items: [], total: 0, page: 1, pageSize: 50, totalPages: 0,
      loaded: false, loading: false, error: '', pendingAction: '',
      requestEpoch: 0,
      selectedIds: new Set(), searchOpenId: '', expandedId: '', searchResults: {},
      searchQueries: {}, searchActiveIndexes: {}, searchTimers: {}, requestEpochs: {},
    },
    assistantRuntime: null,
    assistantRuntimeError: '',
    assistantRuntimePending: false,
    aiFeatures: null,
    aiFeaturesError: '',
    aiFeaturePending: '',
    research: {
      contacts: {
        page: 1, pageSize: 50, total: 0, hasMore: false, loading: false, loaded: false,
        error: '', initializing: false, requestEpoch: 0, initializeEpoch: 0,
        filterMount: null, filterController: null,
      },
      recon: {
        page: 1, pageSize: 50, total: 0, hasMore: false, loading: false, loaded: false,
        error: '', initializing: false, requestEpoch: 0, initializeEpoch: 0,
        filterMount: null, filterController: null,
      },
    },
  };

  const viewMeta = {
    dashboard: ['经营概览', '经营驾驶舱'],
    intake: ['线索池', '线索池'],
    pending: ['客户录入', '待领取'],
    claimed: ['客户录入', '已领取'],
    customers: ['CRM 客户全景', 'CRM客户全景'],
    recycleBin: ['不对口记录', '不对口记录'],
    customerProfile: ['客户资料', '客户资料'],
    pool: ['线索池', '线索池'],
    contacts: ['联系人凭证', '客户联系人线索'],
    recon: ['Recon 情报', 'Recon 情报'],
    pipeline: ['推进管道', '推进管道'],
    alerts: ['今日待办', '今日待办'],
    managerTasks: ['主管协助事项', '主管协助事项'],
    managerMetrics: ['计划跟进与协助统计', '计划跟进与协助统计'],
    notifications: ['通知中心', '通知中心'],
    activityCorrections: ['跟进更正', '跟进更正'],
    aiTasks: ['AI 任务中心', 'AI任务中心'],
    insights: ['客户经营复盘', '客户经营复盘'],
    team: ['团队状态', '团队状态'],
    markets: ['市场策略', '市场策略'],
    users: ['用户与权限', '用户与权限'],
    protectedCustomers: ['客户保护与查重', '客户保护与查重处理'],
    maintenance: ['数据维护', '数据维护'],
  };
  const viewPermissions = {
    intake: 'view_intake', pool: 'view_intake', pending: 'view_intake', claimed: 'view_intake', customerProfile: 'view_customers',
    recycleBin: 'view_own_mismatch_history',
    managerTasks: 'resolve_manager_tasks', managerMetrics: 'resolve_manager_tasks',
    notifications: 'view_notifications',
    activityCorrections: 'manage_activity_corrections',
    team: 'view_team',
    aiTasks: 'view_customers', maintenance: 'manage_data_maintenance',
  };
  const activityMeta = {
    note: ['记录', '记'], qualification: ['资格判断', '筛'], email: ['发送邮件', '邮'], call: ['电话开发', '电'],
    social: ['社媒联系', '社'], reply: ['客户回复', '回'], meeting: ['视频/电话会议', '会'],
    manager_join: ['管理者介入', '管'], rfq: ['收到询价', '询'], quote: ['发送报价', '报'],
    negotiation: ['商务谈判', '谈'], order: ['首次下单', '单'], repeat_order: ['复购', '复'], lost: ['暂停/流失', '停'],
  };
  const RECYCLE_KIND_LABELS = Object.freeze({
    sales_return: '销售退回',
    mismatch: '不对口',
    manual_delete: '手动删除',
  });
  const EVENT_LABELS = Object.freeze({
    claim: { title: '领取客户', summary: actor => (actor ? `${actor}领取该线索并进入 CRM` : '领取该线索并进入 CRM') },
    assign: { title: '分配线索', summary: (actor, event) => `${actor}将线索分配给 ${event.ownerName || '销售'}` },
    reassign: { title: '重新分配', summary: (actor, event) => `${actor}将客户重新分配给 ${event.ownerName || '销售'}` },
    unassign: { title: '取消分配', summary: actor => `${actor}取消分配，线索恢复为待分配` },
    return: { title: '退回线索池', summary: actor => `${actor}将客户退回线索池` },
    sales_return: { title: '退回线索池', summary: actor => `${actor}将客户退回线索池` },
    reject: { title: '标记不对口', summary: actor => `${actor}将客户标记为不对口` },
    manual_delete: { title: '移入客户回收站', summary: actor => `${actor}将客户移入回收站` },
    restore: { title: '恢复客户', summary: actor => `${actor}恢复该客户` },
    nickname_update: { title: '修改客户昵称', summary: actor => `${actor}修改了客户昵称` },
  });

  function timelineEventTitle(event) {
    const kind = String(event?.kind || event?.event_type || '');
    const mapped = EVENT_LABELS[kind];
    if (event?.kind === 'activity') {
      if (Number(event.no_plan || 0) === 1) return '暂无计划';
      if (String(event.event_type || '') === 'manager_join' && String(event.outcome || '') === '已回复') {
        return '主管回复';
      }
      if (Number(event.manager_required || 0) === 1) return '请求主管协助';
    }
    const title = mapped?.title
      || (event?.kind === 'activity' ? activityMeta[event?.event_type]?.[0] : '')
      || event?.title
      || '';
    if (!title) {
      console.warn('UNMAPPED_TIMELINE_EVENT', kind);
      return '系统记录';
    }
    return title;
  }

  function timelineEventSummary(event) {
    const raw = String(event?.summary || '').trim();
    if (raw && raw !== '无补充说明') return raw;
    const mapped = EVENT_LABELS[String(event?.kind || event?.event_type || '')];
    return mapped?.summary ? String(mapped.summary(event?.actor_name || '', event) || '').trim() : '';
  }
  const activityProgressOptions = [
    { key: 'email', label: '发送邮件', activityType: 'email', channel: 'email' },
    { key: 'call', label: '电话开发', activityType: 'call', channel: 'call' },
    { key: 'whatsapp', label: 'WhatsApp 联系', activityType: 'social', channel: 'WhatsApp' },
    { key: 'telegram', label: 'Telegram 联系', activityType: 'social', channel: 'Telegram' },
    { key: 'linkedin', label: 'LinkedIn / 社媒联系', activityType: 'social', channel: 'LinkedIn' },
    { key: 'reply', label: '客户回复', activityType: 'reply', channel: 'other' },
    { key: 'meeting', label: '视频会议', activityType: 'meeting', channel: 'video' },
    { key: 'rfq', label: '收到询价', activityType: 'rfq', channel: 'business' },
    { key: 'negotiation', label: '商务谈判', activityType: 'negotiation', channel: 'business' },
    { key: 'lost', label: '暂停 / 流失', activityType: 'lost', channel: 'other' },
  ];
  const capabilityLabels = {
    activation: '资源激活', outreach: '开发破冰', relationship: '关系建立', discovery: '需求挖掘',
    professional: '专业能力', conversion: '商务转化', retention: '客户经营', execution: '执行纪律', collaboration: '协作承接',
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function websiteMarkup(value) {
    const site = uiFormat.website(value);
    return site
      ? `<a class="tp-website" href="${esc(site.href)}" target="_blank" rel="noopener">${esc(site.label)}${uiFormat.icon('external')}</a>`
      : '<span class="tp-empty-value">暂无官网</span>';
  }
  function drawerFactMarkup([label, value, kind = 'text']) {
    const content = kind === 'website'
      ? websiteMarkup(value)
      : `<strong>${esc(value || '—')}</strong>`;
    return `<div class="fact"><span>${esc(label)}</span>${content}</div>`;
  }
  function productChipMarkup(value) {
    const result = uiFormat.products(value);
    if (!result.items.length) return '<span class="tp-empty-value">暂无产品信息</span>';
    return `<span class="tp-product-list">${result.items.map(item => `<span>${esc(item)}</span>`).join('')}${result.overflow ? `<b>+${result.overflow}</b>` : ''}</span>`;
  }
  function statusMarkup(value, labels) {
    const display = uiFormat.status(value, labels);
    return `<span class="tp-status ${display.tone}"><i class="tp-status-dot" aria-hidden="true"></i>${esc(display.label)}</span>`;
  }
  function accountDisplayName(account) {
    return String(account?.nickname || account?.company_name || account?.companyName
      || account?.external_customer_id || account?.externalCustomerId || account?.customerId || '').trim();
  }
  function accountIdentity(account) {
    const officialName = String(account?.company_name || account?.companyName || '').trim();
    const customerCode = sharedCustomerId(account);
    return account?.nickname
      ? [officialName, customerCode].filter(Boolean).join(' · ')
      : customerCode;
  }
  function sharedCustomerId(customer) {
    return String(customer?.external_customer_id || customer?.externalCustomerId || customer?.customerId || '').trim();
  }
  function sharedCustomerOfficialName(customer) {
    return String(customer?.company_name || customer?.companyName || '').trim();
  }
  function normalizeActivityCustomer(customer) {
    if (!customer) return null;
    return {
      ...customer,
      id: String(customer.id || customer.customerId || customer.customer_id || ''),
      externalCustomerId: String(customer.externalCustomerId || customer.external_customer_id || ''),
      nickname: String(customer.nickname || ''),
      companyName: String(customer.companyName || customer.company_name || ''),
      ownerId: String(customer.ownerId || customer.owner_id || ''),
      ownerName: String(customer.ownerName || customer.owner_name || ''),
      stage: String(customer.stage || ''),
    };
  }
  function normalizeActivityReactions(rows) {
    return (Array.isArray(rows) ? rows : []).map((item, index) => ({
      id: String(item.id || ''),
      name: String(item.name || '').trim(),
      sortOrder: Number(item.sortOrder ?? item.sort_order ?? index),
      active: item.active !== false && Number(item.active ?? 1) !== 0,
    })).filter(item => item.id && item.name)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'));
  }
  function bootstrapActivityReactions(data = state.data) {
    return data?.activityReactions || data?.activityReactionOptions || data?.reactionOptions;
  }
  function isRealAdmin() {
    return state.data?.user?.role === 'admin' && !state.data?.impersonation;
  }
  function canManageProtectedCustomers() {
    return isRealAdmin() && can('manage_protected_customers');
  }
  function canReviewDuplicateCustomers() {
    return !state.data?.impersonation && can('view_all_customers') && can('manage_intake');
  }
  function canAccessProtectionAndDedupe() {
    return canManageProtectedCustomers() || canReviewDuplicateCustomers();
  }
  function normalizeTagText(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('zh-CN');
  }
  function uniqueSourceTags(tags) {
    const seen = new Set();
    return tags.filter(tag => {
      const key = normalizeTagText(tag.name);
      if (!tag.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function accountSourceTags(account) {
    const customerTags = Array.isArray(account?.customerTags) ? account.customerTags : [];
    return uniqueSourceTags(customerTags
      .filter(tag => customerAIEnabled() || !tag.readOnly)
      .map(tag => ({
        source: tag.readOnly ? 'ai' : 'manual',
        name: tag.name,
        category: tag.category,
      })));
  }
  function sourceTagMarkup(account, limit = 5) {
    const tags = accountSourceTags(account);
    const shown = tags.slice(0, limit);
    return shown.length
      ? `<div class="source-tag-row">${shown.map(tag => `<span class="source-tag ${esc(tag.source)}" title="${esc(tag.category || '客户标签')}">${esc(tag.name)}</span>`).join('')}${tags.length > shown.length ? `<span class="source-tag manual">+${tags.length - shown.length}</span>` : ''}</div>`
      : '';
  }
  function jsonList(value) {
    try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (_e) { return []; }
  }
  function money(value, currency = 'USD') {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
  }
  function businessTimezone() {
    const configured = String(state.data?.businessTimezone || 'Asia/Shanghai').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: configured }).format(0);
      return configured;
    } catch (_error) {
      return 'Asia/Shanghai';
    }
  }
  function instantDate(value) {
    const text = String(value || '').trim().replace(' ', 'T');
    if (!text) return new Date(NaN);
    const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    return new Date(explicitOffset ? text : `${text}Z`);
  }
  function shortDate(value, withTime = false, timezone = businessTimezone()) {
    if (!value) return '—';
    const date = instantDate(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', withTime
      ? { timeZone: timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
      : { timeZone: timezone, month: 'numeric', day: 'numeric' }).format(date);
  }
  function relative(value) {
    if (!value) return '暂无记录';
    const time = instantDate(value).getTime();
    const hours = Math.max(0, Math.round((Date.now() - time) / 3600000));
    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }
  function dateInput(days = 1) {
    return businessDateInput(new Date(Date.now() + days * 86400000));
  }
  function yearOptions(selectedYear = '') {
    const currentYear = new Date().getFullYear();
    const selected = String(selectedYear || '');
    return ['<option value="">未填写</option>', ...Array.from({ length: currentYear - 999 }, (_, index) => {
      const year = String(currentYear - index);
      return `<option value="${year}"${year === selected ? ' selected' : ''}>${year}</option>`;
    })].join('');
  }
  function businessDateInput(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: businessTimezone(),
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  }
  function setFutureDateTimeConstraint(input, now = new Date()) {
    if (!input) return null;
    const reference = now instanceof Date ? now : new Date(now);
    const validReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
    input.min = businessDateInput(new Date(validReference.getTime() + 60000));
    input.dataset.futureDatetime = 'true';
    if (input.dataset.futureValidationBound !== 'true') {
      const validate = () => validateFutureDateTime(input);
      input.addEventListener('input', validate);
      input.addEventListener('change', validate);
      input.dataset.futureValidationBound = 'true';
    }
    validateFutureDateTime(input, validReference);
    return input;
  }
  function validateFutureDateTime(input, now = new Date()) {
    if (!input) return false;
    const reference = now instanceof Date ? now : new Date(now);
    const validReference = Number.isNaN(reference.getTime()) ? new Date() : reference;
    const value = String(input.value || '').trim();
    const valid = !value || value > businessDateInput(validReference);
    input.setCustomValidity(valid ? '' : '下一步时间必须晚于当前时间');
    input.setAttribute('aria-invalid', String(!valid));
    return valid;
  }
  function constrainFutureDateTimes(root = document) {
    return Array.from(root?.querySelectorAll?.('input[type="datetime-local"][data-future-datetime]') || [])
      .map(input => setFutureDateTimeConstraint(input));
  }
  function storedPlanDateInput(value) {
    return storedPlanDateInputWithBasis(value, 'utc');
  }
  function storedPlanDateInputWithBasis(value, basis) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (basis !== 'utc') return text.replace(' ', 'T').slice(0, 16);
    return businessDateInput(instantDate(text));
  }
  function suggestedPlanDateInput(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return businessDateInput(instantDate(text));
    const local = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
    return local ? `${local[1]}T${local[2]}` : '';
  }
  function storedPlanDateLabel(value, basis) {
    return basis === 'utc'
      ? shortDate(value, true)
      : shortDate(value, true, 'UTC');
  }
  function legacyPlanTimeNote(basis) {
    return basis === 'utc' ? '' : '<small class="subtle">历史时间待确认</small>';
  }
  function nextActionTimeMarkup(account, nowMs = Date.now()) {
    const accurate = storedPlanDateLabel(account.next_action_at, account.next_action_time_basis);
    if (!account.next_action_at) {
      return '<span class="next-action-time unavailable">尚未安排时间</span>';
    }
    const description = nextActionTime?.describeNextActionTime(
      account.next_action_at,
      account.next_action_time_basis,
      nowMs,
    ) || { state: 'unavailable', label: '', ariaLabel: '' };
    const relativeMarkup = description.label
      ? `<strong class="next-action-relative ${esc(description.state)}" aria-label="${esc(description.ariaLabel)}">${esc(description.label)}</strong>`
      : legacyPlanTimeNote(account.next_action_time_basis);
    return `<span class="next-action-time" data-next-action-time data-plan-at="${esc(account.next_action_at)}" data-time-basis="${esc(account.next_action_time_basis || '')}">${relativeMarkup}<time>${esc(accurate)}</time></span>`;
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
  function defaultCustomerFilters() {
    return {
      search: '', quickView: 'all', sort: 'pending_priority',
      countries: [], owners: [], stages: [], priorities: [], customerTypes: [],
      industries: [], sources: [], creators: [], evaluationTags: [],
      lastActionBuckets: [], nextStepBuckets: [], createdFrom: '', createdTo: '',
    };
  }
  function customerFilterStorageKey() {
    return `tradepulse.customerFilters.${state.data?.user?.id || 'anonymous'}`;
  }
  function restoreCustomerFilters() {
    state.customerFilters = defaultCustomerFilters();
  }
  function saveCustomerFilters() {}
  function selectedValues(select) {
    return select ? [...select.selectedOptions].map(option => option.value).filter(Boolean) : [];
  }
  function setSelectedValues(select, values) {
    if (!select) return;
    const selected = new Set(values || []);
    [...select.options].forEach(option => { option.selected = selected.has(option.value); });
  }
  function customerFilterValues(rows, key) {
    return [...new Set(rows.map(row => row[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
  }
  function multiOptions(values, labels = {}) {
    return values.map(value => `<option value="${esc(value)}">${esc(labels[value] || value)}</option>`).join('');
  }
  function selectedOptions(values, currentValue, emptyLabel = '') {
    const current = String(currentValue || '');
    const options = [...new Set([...(values || []), ...(current ? [current] : [])])];
    return `${emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : ''}${options.map(value =>
      `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(value)}</option>`).join('')}`;
  }
  function syncCustomerFilterControls() {
    const filters = state.customerFilters;
    if ($('#customerSearch')) $('#customerSearch').value = filters.search;
    $('#customerSearchClear')?.classList.toggle('hidden', !filters.search);
    if ($('#customerSort')) $('#customerSort').value = filters.sort;
    if ($('#customerCreatedFrom')) $('#customerCreatedFrom').value = filters.createdFrom;
    if ($('#customerCreatedTo')) $('#customerCreatedTo').value = filters.createdTo;
    const mappings = {
      customerCountryFilter: 'countries', customerOwnerFilter: 'owners', stageFilter: 'stages',
      priorityFilter: 'priorities', customerTypeFilter: 'customerTypes',
      customerIndustryFilter: 'industries', customerSourceFilter: 'sources',
      customerCreatorFilter: 'creators', evaluationTagFilter: 'evaluationTags',
      customerLastActionFilter: 'lastActionBuckets', customerNextStepFilter: 'nextStepBuckets',
    };
    for (const [id, key] of Object.entries(mappings)) setSelectedValues($(`#${id}`), filters[key]);
    $$('#customerQuickViews [data-customer-quick]').forEach(button =>
      button.classList.toggle('active', button.dataset.customerQuick === filters.quickView));
  }
  function readCustomerFilterControls() {
    const filters = state.customerFilters;
    filters.search = ($('#customerSearch')?.value || '').trim();
    filters.sort = $('#customerSort')?.value || 'pending_priority';
    filters.createdFrom = $('#customerCreatedFrom')?.value || '';
    filters.createdTo = $('#customerCreatedTo')?.value || '';
    Object.assign(filters, {
      countries: selectedValues($('#customerCountryFilter')),
      owners: selectedValues($('#customerOwnerFilter')),
      stages: selectedValues($('#stageFilter')),
      priorities: selectedValues($('#priorityFilter')),
      customerTypes: selectedValues($('#customerTypeFilter')),
      industries: selectedValues($('#customerIndustryFilter')),
      sources: selectedValues($('#customerSourceFilter')),
      creators: selectedValues($('#customerCreatorFilter')),
      evaluationTags: selectedValues($('#evaluationTagFilter')),
      lastActionBuckets: selectedValues($('#customerLastActionFilter')),
      nextStepBuckets: selectedValues($('#customerNextStepFilter')),
    });
  }
  function applyCustomerFilters({ close = false } = {}) {
    readCustomerFilterControls();
    saveCustomerFilters();
    syncCustomerFilterControls();
    renderCustomers();
    if (close) closeCustomerFilterPanel();
  }
  function openCustomerFilterPanel() {
    $('#customerFilterPanel')?.classList.remove('hidden');
    $('#customerFilterBackdrop')?.classList.remove('hidden');
    $('#customerFilterToggle')?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('customer-filters-open');
  }
  function closeCustomerFilterPanel() {
    $('#customerFilterPanel')?.classList.add('hidden');
    $('#customerFilterBackdrop')?.classList.add('hidden');
    $('#customerFilterToggle')?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('customer-filters-open');
  }
  function customerAIEnabled() {
    return Boolean(state.data?.features?.aiStations);
  }
  function customerEnrichmentEnabled() {
    return customerAIEnabled() && Boolean(state.data?.features?.customerEnrichment);
  }
  function customerEnrichmentAutoTriggerEnabled() {
    return customerEnrichmentEnabled()
      && Boolean(state.data?.features?.customerEnrichmentAutoTrigger);
  }
  function salesPackEnabled() {
    return customerAIEnabled() && Boolean(state.data?.features?.salesPack);
  }
  function canViewAssignmentDecisions() {
    return state.data?.user?.role !== 'sales' && can('manage_intake');
  }
  const aiPermissionKeys = new Set([
    'use_ai_assistant', 'cancel_ai_tasks', 'bulk_manage_ai_tasks',
    'manage_ai_budgets', 'review_ai_tasks',
  ]);
  const aiNotificationCodes = new Set([
    'SALES_PACK_READY', 'SALES_PACK_FAILED', 'MANAGER_ANOMALY_READY',
    'SALES_COACHING_READY', 'AI_TASK_READY', 'AI_TASK_FAILED',
  ]);
  const salesPackNotificationCodes = new Set(['SALES_PACK_READY', 'SALES_PACK_FAILED']);
  function notificationRowsAllowedByAIGate(rows) {
    const values = Array.isArray(rows) ? rows : [];
    const aiEnabled = customerAIEnabled();
    const packEnabled = salesPackEnabled();
    if (aiEnabled && packEnabled) return values;
    return values.filter(item => {
      const code = String(item.code || '').toUpperCase();
      if (!aiEnabled) return !aiNotificationCodes.has(code);
      return !salesPackNotificationCodes.has(code);
    });
  }
  function stripDisabledAINotificationState() {
    if (customerAIEnabled() && salesPackEnabled()) return;
    const meta = state.authorizedBusinessLists.notifications;
    meta.rows = notificationRowsAllowedByAIGate(meta.rows);
    if (state.data?.notifications) {
      state.data.notifications = notificationRowsAllowedByAIGate(state.data.notifications);
    }
    if (meta.loaded) {
      const unread = meta.rows.filter(item => item.status === 'unread').length;
      const failed = meta.rows.filter(item =>
        item.wecomDeliveryStatus === 'failed' || item.wecomStatus === 'failed').length;
      meta.total = meta.rows.length;
      meta.authorizedTotal = meta.rows.length;
      meta.hasMore = false;
      meta.summary = { total: meta.rows.length, unread, failed };
    }
    const controller = meta.filterController;
    if (!controller) return;
    const schema = controller.getSchema();
    const codeField = schema.fields.find(field => field.key === 'notification_code');
    if (!codeField) return;
    codeField.options = (codeField.options || []).filter(option =>
      notificationRowsAllowedByAIGate([{ code: option.value }]).length > 0);
    if (meta.filterMount) meta.filterMount.updateSchema(schema);
    else controller.updateSchema(schema);
  }
  function visiblePermissionDefinitions() {
    const definitions = state.data?.permissionDefinitions || {};
    const aiEnabled = customerAIEnabled();
    const visible = Object.fromEntries(
      Object.entries(definitions)
        .filter(([key]) => !retiredPermissionKeys.has(key) && (aiEnabled || !aiPermissionKeys.has(key)))
        .map(([key, label]) => [key, permissionPresentation[key]?.label || label]),
    );
    return visible;
  }
  const retiredPermissionKeys = new Set(['view_development', 'view_pool']);
  const permissionPresentation = Object.freeze({
    view_dashboard: Object.freeze({ label: '经营驾驶舱' }),
    view_alerts: Object.freeze({ label: '今日待办' }),
    view_notifications: Object.freeze({ label: '通知中心' }),
    view_intake: Object.freeze({
      label: '查看线索池',
      description: '可查看允许分配或领取的线索；敏感候选仍按后端范围过滤。',
    }),
    view_contacts: Object.freeze({
      label: '查看客户联系人线索',
      description: '可维护授权范围内的联系人线索，不自动扩大客户资料范围。',
    }),
    view_recon: Object.freeze({ label: 'Recon 情报' }),
    view_customers: Object.freeze({
      label: '查看本人负责客户',
      description: '可查看自己名下客户、联系人、跟进记录和下一步计划。',
    }),
    view_all_customers: Object.freeze({
      label: '查看团队与全公司客户',
      description: '可跨团队查看客户资料，仅限老板、管理员或明确授权人员。',
    }),
    view_own_mismatch_history: Object.freeze({
      label: '查看不对口记录',
      description: '可查看本人或授权范围内的不对口记录，支持后续纠正。',
    }),
    view_pipeline: Object.freeze({ label: '推进管道' }),
    resolve_manager_tasks: Object.freeze({
      label: '主管协助事项',
      description: '查看并处理主管协助事项及相关统计。',
    }),
    view_team: Object.freeze({
      label: '查看团队状态',
      description: '可查看被授权团队的推进、延期和主管处理结果。',
    }),
    manage_evaluations: Object.freeze({ label: '客户经营复盘' }),
    view_users: Object.freeze({ label: '用户与权限' }),
    manage_protected_customers: Object.freeze({
      label: '查看查重候选与保护名单',
      description: '会看到疑似重复客户依据和保护名单，默认只给管理员。',
    }),
    manage_data_maintenance: Object.freeze({ label: '数据维护' }),
    manage_customer_recycle: Object.freeze({
      label: '管理不对口记录',
      description: '恢复、重新分配或处理不对口记录。',
    }),
    manage_manual_customer_deletion: Object.freeze({
      label: '手工移除客户',
      description: '将确认需要移除的客户转入受控历史记录。',
    }),
  });
  function visibleCategoryPermissions(category, definitions) {
    return category.permissions.filter(key => Boolean(definitions[key]));
  }
  function permissionDescription(category, key, label, descriptions) {
    return permissionPresentation[key]?.description
      || descriptions[key]
      || (category.key === 'module' ? `允许进入“${label}”。` : `允许执行“${label}”。`);
  }
  function applyBusinessAIVisibility() {
    const enabled = customerAIEnabled();
    $$('[data-ai-business]').forEach(element => {
      element.classList.toggle('hidden', !enabled || (element.dataset.permission && !can(element.dataset.permission)));
    });
    $('#customerAiStation')?.classList.toggle('hidden', !enabled);
    if (!enabled) {
      clearTimeout(state.customerAiTimer);
      clearTimeout(state.managerAnomalies.timer);
      clearTimeout(state.salesCoaching.timer);
      state.customerAiTimer = null;
      state.managerAnomalies.timer = null;
      state.salesCoaching.timer = null;
    }
  }
  function roleLabel(role) {
    return ({ admin: '系统管理员', manager: '销售经理', sales: '销售代表' })[role] || role || '—';
  }
  function renderAppVersionBadge() {
    const badge = $('#appVersionBadge');
    if (!badge) return;
    const version = document.documentElement.dataset.appVersion || document.body.dataset.appVersion || '';
    if (version) badge.textContent = '界面版本 ' + version;
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
      notifications: [],
      countryReport: [], cohortReport: [], teamReport: [], funnel: [], summary: {},
      intake: { settings: {}, stats: {}, items: [], batches: [] },
      insights: { contacts: [], evaluations: [] }, customerEvaluationTags: [], customerPool: [], people: [], reconResults: [],
      researchTotals: { pool: 0, poolAvailable: 0, people: 0, recon: 0 },
    });
    state.selectedCustomerId = '';
    clearTimeout(state.managerAnomalies.timer);
    Object.assign(state.managerAnomalies, {
      items: [], loaded: false, loading: false, pending: false, error: '', pollCount: 0, timer: null,
    });
    clearTimeout(state.salesCoaching.timer);
    Object.assign(state.salesCoaching, {
      items: [], loaded: false, loading: false, pendingUserId: '', error: '', pollCount: 0, timer: null,
    });
    resetResearchState();
    resetActivityCorrectionState();
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
        notifications: [],
        countryReport: [], cohortReport: [], teamReport: [], funnel: [], summary: {},
        intake: { settings: {}, stats: {}, items: [], batches: [] },
        insights: { contacts: [], evaluations: [] }, customerEvaluationTags: [], customerPool: [], people: [], reconResults: [],
        users: state.data.user ? [state.data.user] : [], auditLog: [], migrationReview: [],
        researchTotals: { pool: 0, poolAvailable: 0, people: 0, recon: 0 }, impersonation: null,
      });
    }
    state.selectedCustomerId = '';
    clearTimeout(state.managerAnomalies.timer);
    Object.assign(state.managerAnomalies, {
      items: [], loaded: false, loading: false, pending: false, error: '', pollCount: 0, timer: null,
    });
    clearTimeout(state.salesCoaching.timer);
    Object.assign(state.salesCoaching, {
      items: [], loaded: false, loading: false, pendingUserId: '', error: '', pollCount: 0, timer: null,
    });
    resetResearchState();
    resetActivityCorrectionState();
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
      const requestUrl = String(url || '').startsWith('/api/')
        ? url
        : `/api/sales-crm${String(url || '').startsWith('/') ? url : `/${url}`}`;
      const response = await fetch(requestUrl, {
        credentials: 'same-origin',
        ...options,
        signal: controller?.signal || options.signal,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const error = new Error(result.code === 'IMPERSONATION_ACTION_BLOCKED'
          ? '身份检查期间禁止此安全操作'
          : result.error || '请求失败');
        error.status = response.status;
        error.code = result.code || '';
        error.details = result;
        if (error.code === 'IMPERSONATION_ENDED') handleImpersonationEnded();
        else if (error.status === 403
          && !options.preserveOnForbidden
          && !['IMPERSONATION_ACTION_BLOCKED', 'FILTER_NOT_AUTHORIZED'].includes(error.code)) {
          clearForbiddenState();
        }
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

  function componentPayloadToRaw(payload = {}) {
    const raw = {};
    (payload.filters || []).forEach(filter => {
      const key = String(filter.field || filter.key || '');
      if (!key) return;
      if (filter.operator === 'in') {
        raw[key] = {
          operator: 'in',
          values: Array.isArray(filter.value) ? filter.value : [],
        };
      } else if (filter.operator === 'between') {
        raw[key] = {
          operator: 'between',
          from: filter.value?.from,
          to: filter.value?.to,
        };
      } else {
        raw[key] = { operator: filter.operator, value: filter.value };
      }
    });
    return raw;
  }

  function customerFilterSchema(schema = {}) {
    return {
      ...schema,
      fields: (schema.fields || []).map(field => field.key === 'owner'
        ? { ...field, label: '负责人筛选' }
        : field),
    };
  }

  function resetCustomerSelection() {
    state.selectedCustomerIds.clear();
    state.customerSelectionMode = 'explicit';
    state.customerSelectionFilterScope = null;
  }

  function customerSelectionPayload() {
    if (state.customerSelectionMode === 'filtered' && state.customerSelectionFilterScope) {
      return { filterScope: state.customerSelectionFilterScope };
    }
    return { customerIds: [...state.selectedCustomerIds] };
  }

  function customerSelectionCount() {
    return state.customerSelectionMode === 'filtered'
      ? Number(state.customerList.total || 0)
      : state.selectedCustomerIds.size;
  }

  async function loadCustomerPage({ reset = true, force = false, page } = {}) {
    if (!state.customerFilterController) return;
    if (state.customerList.loading && !reset && !force) return;
    const requestEpoch = ++state.customerRequestEpoch;
    state.customerList.loading = true;
    state.customerFilterMount?.setResultMeta({
      loading: true,
      total: state.customerList.total,
      shown: state.customerList.rows.length,
    });
    renderCustomers();
    try {
      const payload = state.customerFilterController.serialize('applied');
      const params = new URLSearchParams({
        page: String(reset ? 1 : Math.max(1, Number(page || state.customerList.page || 1))),
        pageSize: String(state.customerList.pageSize),
        permissionVersion: String(payload.permissionVersion || ''),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
        sort: $('#customerSort')?.value || 'pending_priority',
      });
      const result = await api(`/accounts?${params}`);
      if (requestEpoch !== state.customerRequestEpoch) return;
      const rows = result.rows;
      state.customerList = {
        rows,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        authorizedTotal: result.authorizedTotal,
        hasMore: result.hasMore,
        loading: false,
        loaded: true,
      };
      if (result.schema
          && String(result.schema.permissionVersion) !== String(payload.permissionVersion)) {
        state.customerFilterController.updateSchema(customerFilterSchema(result.schema));
      }
      const accountMap = new Map((state.data.accounts || []).map(account => [account.id, account]));
      result.rows.forEach(account => accountMap.set(account.id, { ...accountMap.get(account.id), ...account }));
      state.data.accounts = [...accountMap.values()];
      state.customerFilterMount?.setResultMeta({
        total: result.total,
        shown: rows.length,
      });
      renderNavigationCounts();
      renderCustomers();
    } catch (error) {
      if (requestEpoch !== state.customerRequestEpoch) return;
      state.customerList.loading = false;
      state.customerFilterMount?.setResultMeta({
        total: state.customerList.total,
        shown: state.customerList.rows.length,
      });
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        await initializeCustomerFilters({ force: true });
        return;
      }
      toast(error.message);
      renderCustomers();
    }
  }

  async function initializeCustomerFilters({ force = false } = {}) {
    const root = $('#customerAuthorizedFilters');
    if (!root || !window.TradePulseFilterComponent) return;
    if (state.customerFilterMount && !force) return;
    const initializeEpoch = ++state.customerInitializeEpoch;
    state.customerFilterMount?.destroy();
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    try {
      const pageKey = 'customers';
      const result = await api(`/filter-schema/${pageKey}`);
      if (initializeEpoch !== state.customerInitializeEpoch) return;
      const controller = window.TradePulseFilterComponent.createFilterController({
        storage: paginationFilterStorage,
        pageKey,
        schema: customerFilterSchema(result.schema),
        onApply: () => {
          if (!state.leadWorkflowApplying) updateLeadWorkflowUrl('');
          resetCustomerSelection();
          void loadCustomerPage({ reset: true });
        },
        onPermissionChange: () => {
          resetCustomerSelection();
        },
      });
      state.customerFilterController = controller;
      if (state.pendingCustomerIntakeFlow) {
        const flow = state.pendingCustomerIntakeFlow;
        state.pendingCustomerIntakeFlow = '';
        state.leadWorkflowApplying = true;
        controller.clearAll({ apply: false });
        controller.setDraft('intake_flow', [flow]);
        controller.apply();
        state.leadWorkflowApplying = false;
      }
      state.customerFilterMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
        controller,
        resultMeta: {
          total: state.customerList.total,
          shown: state.customerList.rows.length,
        },
      });
      await loadCustomerPage({ reset: true });
    } catch (error) {
      if (initializeEpoch !== state.customerInitializeEpoch) return;
      root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({
        status: 'error',
        error: error.message,
      });
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
      const config = researchConfig[kind];
      meta.filterMount?.destroy();
      Object.assign(meta, {
        page: 1,
        pageSize: PAGE_SIZE_OPTIONS.includes(Number(meta.pageSize)) ? Number(meta.pageSize) : 50,
        total: Number(state.data?.researchTotals?.[config?.totalsKey || kind] || 0),
        hasMore: false,
        loading: false,
        loaded: false,
        error: '',
        initializing: false,
        requestEpoch: Number(meta.requestEpoch || 0) + 1,
        initializeEpoch: Number(meta.initializeEpoch || 0) + 1,
        filterMount: null,
        filterController: null,
      });
    }
  }

  const authorizedBusinessConfig = {
    intake: {
      root: '#intakeAuthorizedFilters', pagination: '#intakePagination',
      count: '#intakeAuthorizedResultCount', render: renderIntake,
    },
    pipeline: {
      root: '#pipelineAuthorizedFilters', pagination: '#pipelineAuthorizedPagination',
      count: '#pipelineAuthorizedResultCount', render: renderPipeline,
    },
    alerts: {
      root: '#alertsAuthorizedFilters', pagination: '#alertsAuthorizedPagination',
      count: '#alertsAuthorizedResultCount', render: renderAlerts,
    },
    insights: {
      root: '#insightsAuthorizedFilters', pagination: '#insightsAuthorizedPagination',
      count: '#insightsAuthorizedResultCount', render: renderInsightsHub,
    },
    recycle_bin: {
      root: '#recycleAuthorizedFilters', pagination: '#recycleAuthorizedPagination',
      count: '#recycleAuthorizedResultCount', render: renderRecycleBin,
    },
    manager_tasks: {
      root: '#managerTaskFilters', count: '#managerTaskResultCount',
      pagination: '#managerTaskPagination', endpoint: '/manager-tasks', pageSize: 50, render: renderManagerTasks,
    },
    manager_risks: {
      root: '#managerRiskFilters', pagination: '#managerRiskPagination', count: '#managerRiskResultCount',
      endpoint: '/manager-risks', render: renderManagerRisks,
    },
    manager_metrics: {
      root: '#managerMetricFilters', pagination: '#managerMetricPagination', count: '#managerMetricResultCount',
      endpoint: '/manager-metrics', render: renderManagerMetrics,
    },
    notifications: {
      root: '#notificationsAuthorizedFilters', pagination: '#notificationsAuthorizedPagination',
      count: '#notificationResultCount', render: renderNotifications,
    },
  };

  function resetAuthorizedBusinessLists() {
    for (const [pageKey, meta] of Object.entries(state.authorizedBusinessLists)) {
      meta.filterMount?.destroy();
      state.authorizedBusinessLists[pageKey] = {
        ...emptyAuthorizedListState(authorizedBusinessConfig[pageKey]?.pageSize || 50),
        requestEpoch: Number(meta.requestEpoch || 0) + 1,
        initializeEpoch: Number(meta.initializeEpoch || 0) + 1,
      };
    }
  }

  function applyAuthorizedBusinessRows(pageKey, meta) {
    if (pageKey === 'intake') {
      state.data.intake = {
        ...(state.data.intake || {}),
        items: meta.rows,
        page: meta.page,
        pageSize: meta.pageSize,
        total: meta.total,
        totalPages: meta.totalPages,
        hasMore: meta.hasMore,
      };
      state.intakePage = meta.page;
      state.intakeTotal = meta.total;
      state.intakeTotalPages = meta.totalPages;
      state.intakeHasMore = meta.hasMore;
    } else if (pageKey === 'recycle_bin') {
      state.recycleBin = {
        ...state.recycleBin,
        rows: meta.rows,
        page: meta.page,
        pageSize: meta.pageSize,
        total: meta.total,
        totalPages: meta.totalPages,
        hasMore: meta.hasMore,
        loading: meta.loading,
      };
    } else if (pageKey === 'notifications') {
      state.data.notifications = meta.rows;
    }
  }

  function updateAuthorizedBusinessMeta(pageKey) {
    const config = authorizedBusinessConfig[pageKey];
    const meta = state.authorizedBusinessLists[pageKey];
    const count = config ? $(config.count) : null;
    renderPagination(config?.pagination, pageKey, meta, change => {
      if (pageKey === 'intake') {
        state.selectedIntakeIds.clear();
        state.intakeSelectAllScope = null;
      }
      if (change.pageSize) meta.pageSize = change.pageSize;
      void loadAuthorizedBusinessPage(pageKey, { page: change.page || 1 });
    });
    if (count) {
      count.textContent = meta.loading && !meta.loaded
        ? '正在读取授权结果…'
        : `共 ${meta.total} 条 · 第 ${meta.total ? meta.page : 0} / ${meta.total ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 0} 页`;
    }
  }

  async function loadAuthorizedBusinessPage(pageKey, { reset = false, force = false, page } = {}) {
    const config = authorizedBusinessConfig[pageKey];
    const meta = state.authorizedBusinessLists[pageKey];
    if (!config || !meta?.filterController || (meta.loading && !reset && !force)) return;
    if (reset) {
      Object.assign(meta, {
        page: 1,
        pageSize: config.pageSize || meta.pageSize,
        total: 0,
        authorizedTotal: 0,
        hasMore: false,
        loaded: false,
        summary: null,
      });
    }
    const requestEpoch = ++meta.requestEpoch;
    meta.loading = true;
    meta.error = '';
    applyAuthorizedBusinessRows(pageKey, meta);
    meta.filterMount?.setResultMeta({ loading: true, total: meta.total, shown: meta.rows.length });
    config.render();
    updateAuthorizedBusinessMeta(pageKey);
    try {
      const payload = meta.filterController.serialize('applied');
      const params = new URLSearchParams({
        page: String(reset ? 1 : Math.max(1, Number(page || meta.page || 1))),
        pageSize: String(meta.pageSize),
        permissionVersion: String(payload.permissionVersion || ''),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
      });
      if (pageKey === 'alerts' && state.alertSeverity) {
        params.set('urgency', state.alertSeverity);
      }
      const endpoint = config.endpoint || `/lists/${pageKey}`;
      const result = await api(`${endpoint}?${params}`, { timeoutMs: 12000 });
      if (requestEpoch !== meta.requestEpoch) return;
      meta.rows = result.rows;
      Object.assign(meta, {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Number(result.totalPages ?? Math.ceil(Number(result.total || 0) / Number(result.pageSize || meta.pageSize || 50))),
        authorizedTotal: Number(result.authorizedTotal ?? result.total),
        hasMore: result.hasMore,
        loaded: true,
        error: '',
        summary: result.summary || result.meta?.summary || meta.summary || null,
      });
      if (result.schema) {
        meta.filterController.updateSchema(result.schema);
      }
    } catch (error) {
      if (requestEpoch !== meta.requestEpoch) return;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        meta.loading = false;
        await initializeAuthorizedBusinessFilters(pageKey, { force: true });
        return;
      }
      meta.error = error.message || '数据读取失败';
      toast(error.message);
    } finally {
      if (requestEpoch === meta.requestEpoch) {
        meta.loading = false;
        applyAuthorizedBusinessRows(pageKey, meta);
        meta.filterMount?.setResultMeta({ total: meta.total, shown: meta.rows.length });
        renderNavigationCounts();
        config.render();
        updateAuthorizedBusinessMeta(pageKey);
      }
    }
  }

  function notificationStatusFromApplied(payload) {
    const status = (payload?.filters || []).find(filter => filter.field === 'notification_status');
    const values = Array.isArray(status?.value) ? status.value.map(String) : [];
    return values.length === 1 && ['unread', 'read'].includes(values[0]) ? values[0] : '';
  }

  function syncNotificationStatusFromController(controller) {
    state.notificationStatus = notificationStatusFromApplied(controller?.serialize('applied'));
  }

  async function initializeAuthorizedBusinessFilters(pageKey, { force = false } = {}) {
    const config = authorizedBusinessConfig[pageKey];
    const meta = state.authorizedBusinessLists[pageKey];
    const root = config ? $(config.root) : null;
    if (!config || !meta || !root || !window.TradePulseFilterComponent) return;
    if (meta.filterMount && !force) return;
    const initializeEpoch = ++meta.initializeEpoch;
    meta.requestEpoch += 1;
    meta.filterMount?.destroy();
    meta.filterMount = null;
    meta.filterController = null;
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    try {
      const result = await api(`/filter-schema/${pageKey}`);
      if (initializeEpoch !== meta.initializeEpoch) return;
      invalidateStaleResearchFilterState(pageKey, result.schema);
      const controller = window.TradePulseFilterComponent.createFilterController({
        storage: paginationFilterStorage,
        pageKey,
        schema: result.schema,
        onApply: payload => {
          if (pageKey === 'intake') {
            if (!state.leadWorkflowApplying) updateLeadWorkflowUrl('');
            state.selectedIntakeIds.clear();
            state.intakeSelectAllScope = null;
          }
          if (pageKey === 'notifications') {
            state.notificationStatus = notificationStatusFromApplied(payload);
          }
          void loadAuthorizedBusinessPage(pageKey, { reset: true });
        },
      });
      meta.filterController = controller;
      if (pageKey === 'intake' && state.pendingIntakeStat) {
        const statKey = state.pendingIntakeStat;
        state.pendingIntakeStat = '';
        state.leadWorkflowApplying = true;
        controller.clearAll({ apply: false });
        for (const [field, value] of Object.entries(intakeStatDraft(statKey))) {
          controller.setDraft(field, value);
        }
        state.intakeStatus = intakeStatusFromStat(statKey);
        controller.apply();
        state.leadWorkflowApplying = false;
      }
      if (pageKey === 'notifications') {
        syncNotificationStatusFromController(controller);
      }
      meta.filterMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
        controller,
        resultMeta: { total: meta.total, shown: meta.rows.length },
      });
      await loadAuthorizedBusinessPage(pageKey, { reset: true });
    } catch (error) {
      if (initializeEpoch !== meta.initializeEpoch) return;
      meta.error = error.message || '筛选项读取失败';
      root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({
        status: 'error',
        error: error.message,
      });
    }
  }

  function identityInspectionAllowsView(view) {
    return !state.data?.impersonation
      || !['activityCorrections', 'users', 'maintenance', 'protectedCustomers'].includes(view);
  }

  function firstAllowedBusinessView() {
    return Object.keys(viewMeta).find(view =>
      !['aiTasks', 'customerProfile'].includes(view)
      && identityInspectionAllowsView(view)
      && (view !== 'protectedCustomers'
        ? can(viewPermissions[view] || `view_${view}`)
        : canAccessProtectionAndDedupe())) || 'dashboard';
  }

  async function load({ fromLogin = false } = {}) {
    resetActivityCorrectionState();
    try {
      state.data = await api('/api/sales-crm/bootstrap', { timeoutMs: 15000 });
      const bootstrapReactions = bootstrapActivityReactions(state.data);
      renderAppVersionBadge();
      state.activityReactions = normalizeActivityReactions(bootstrapReactions);
      state.activityReactionsLoaded = Array.isArray(bootstrapReactions);
      state.activitySelectedCustomer = null;
      state.activityCustomerResults = [];
      state.activityCustomerRequestEpoch += 1;
      state.customerRequestEpoch += 1;
      state.customerInitializeEpoch += 1;
      state.customerFilterMount?.destroy();
      state.customerFilterMount = null;
      state.customerFilterController = null;
      state.filterPermissionAdmin = null;
      state.customerList = {
        rows: [], page: 1, pageSize: 50, total: 0, authorizedTotal: 0,
        hasMore: false, loading: false, loaded: false,
      };
      restoreCustomerFilters();
      if (!customerAIEnabled()) state.customerFilters.evaluationTags = [];
      state.assistantRuntime = null;
      state.assistantRuntimeError = '';
      state.assistantRuntimePending = false;
      state.aiFeatures = null;
      state.aiFeaturesError = '';
      state.aiFeaturePending = '';
      Object.assign(state.protectedCustomers, {
        items: [], total: 0, loaded: false, loading: false, error: '', writeEnabled: null,
        batch: null, pendingAction: '', conflicts: [], conflictTotal: 0, unresolved: 0,
        leadWarnings: 0, blockingUnresolved: 0, canEnter172B: false,
          conflictPage: 1, conflictPageSize: 50, conflictTotalPages: 0, conflictHasMore: false,
        conflictsLoading: false, conflictsError: '', conflictPendingId: '', expandedConflictId: '',
        conflictsLoaded: false,
      });
      Object.assign(state.duplicateReviews, {
        items: [], total: 0, page: 1, totalPages: 0, loaded: false, loading: false,
        error: '', pendingAction: '', requestEpoch: 0, selectedIds: new Set(), searchOpenId: '', expandedId: '',
        searchResults: {}, searchQueries: {}, searchActiveIndexes: {}, searchTimers: {}, requestEpochs: {},
      });
      state.pendingCenter = {
        activeTab: 'conflicts', selectedKey: '', query: '', mobileDetailOpen: false,
        deepLinkUnavailable: false,
      };
      state.protectionWorkspace = { activeView: 'verification' };
      if (!canManageProtectedCustomers() && canReviewDuplicateCustomers()) {
        state.pendingCenter.activeTab = 'duplicates';
      }
      clearTimeout(state.managerAnomalies.timer);
      Object.assign(state.managerAnomalies, {
        items: [], loaded: false, loading: false, pending: false, error: '', pollCount: 0, timer: null,
      });
      resetResearchState();
      resetAuthorizedBusinessLists();
      state.selectedIntakeIds.clear();
      resetCustomerSelection();
      state.intakeAssignmentPreview = null;
      $('#loginScreen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      applyUser();
      populateFilters();
      renderAll();
      if (!state.data.impersonation
          && (can('correct_own_activity') || can('manage_activity_corrections'))) {
        void loadActivityCorrectionWriteStatus();
      }
      const requestedView = location.hash.replace(/^#/, '').split('?')[0];
      const requestedParams = new URLSearchParams(location.search);
      const requestedCustomerId = requestedParams.get('customer') || '';
      const requestedIntakeItemId = requestedParams.get('intake') || '';
      const requestedLeadView = String(requestedParams.get('leadView') || '');
      if (!restoreLeadWorkflowFromLocation(requestedView) && requestedLeadView) {
        updateLeadWorkflowUrl('');
      }
      if (can('view_customers')) void initializeCustomerFilters();
      renderImpersonationBanner();
      if (can('manage_users') && !state.data.impersonation) {
        void loadAssistantRuntime();
        void loadAIFeatures();
      }
      const requestedPermission = requestedView === 'customerProfile' && requestedIntakeItemId
        ? 'view_intake'
        : viewPermissions[requestedView] || `view_${requestedView}`;
      state.customerProfileReadOnly = requestedView === 'customerProfile' && Boolean(requestedIntakeItemId);
      const firstAllowedView = customerAIEnabled() && can('view_customers')
        ? Object.keys(viewMeta).find(view => identityInspectionAllowsView(view)
          && (view !== 'protectedCustomers'
            ? can(viewPermissions[view] || `view_${view}`)
            : canAccessProtectionAndDedupe())) || 'dashboard'
        : firstAllowedBusinessView();
      const requestedAllowed = viewMeta[requestedView]
        && identityInspectionAllowsView(requestedView)
        && (requestedView !== 'protectedCustomers'
          ? can(requestedPermission)
          : canAccessProtectionAndDedupe());
      switchView(requestedAllowed ? requestedView : firstAllowedView, false);
      if (requestedView === 'customerProfile') {
        if (requestedIntakeItemId) openIntakeMasterProfile(requestedIntakeItemId, requestedCustomerId);
        else if (requestedCustomerId) openCustomerProfile(requestedCustomerId);
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
    $('#nav [data-view="activityCorrections"]')?.classList.toggle('hidden',
      !can('manage_activity_corrections') || Boolean(state.data.impersonation));
    $('#nav [data-view="protectedCustomers"]')?.classList.toggle('hidden', !canAccessProtectionAndDedupe());
    if ($('#navIntakeLabel')) $('#navIntakeLabel').textContent = can('manage_intake') ? '线索池' : '我的线索';
    applyBusinessAIVisibility();
    $('#runManagerAnomaly')?.classList.toggle('hidden',
      !customerAIEnabled() || !['admin', 'manager'].includes(user.role) || !can('view_team')
        || Boolean(state.data.impersonation));
    if (state.data.impersonation) {
      $$('#nav [data-view="users"], #nav [data-view="protectedCustomers"], #nav [data-view="maintenance"], #newUserBtn, #newPermissionGroupBtn').forEach(el => el.classList.add('hidden'));
    }
    $$('#nav .nav-group').forEach(group => {
      const buttons = $$('button[data-view]').filter(button => group.contains(button));
      group.classList.toggle('hidden', buttons.length > 0 && buttons.every(button => button.classList.contains('hidden')));
    });
    $('#bulkReturnCustomers')?.classList.toggle('hidden', !can('manage_customer_recycle'));
    $('#intakeSettingsBtn')?.classList.toggle('hidden',
      !can('manage_intake') || Boolean(state.data.impersonation));
    $('#scanIntakeBtn')?.classList.toggle('hidden',
      !can('manage_intake') || Boolean(state.data.impersonation));
    $('#changePasswordBtn')?.classList.toggle('hidden', Boolean(state.data.impersonation));
    const sinceLastViewOption = $('#teamRange')?.querySelector('option[value="since-last-view"]');
    if (sinceLastViewOption) {
      sinceLastViewOption.hidden = Boolean(state.data.impersonation);
      sinceLastViewOption.disabled = Boolean(state.data.impersonation);
      if (state.data.impersonation && $('#teamRange').value === 'since-last-view') {
        $('#teamRange').value = '30d';
      }
    }
    $('#filterPermissionAdmin')?.classList.toggle('hidden', !can('manage_users') || Boolean(state.data.impersonation));
  }

  function populateFilters() {
    const countries = [...new Set(state.data.accounts.map(item => item.country).filter(Boolean))].sort();
    const activeSales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    if ($('#customerCountryFilter')) $('#customerCountryFilter').innerHTML = multiOptions(countries);
    if ($('#customerOwnerFilter')) {
      $('#customerOwnerFilter').innerHTML = '<option value="__unassigned__">未分配</option>'
        + activeSales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
    }
    if ($('#stageFilter')) $('#stageFilter').innerHTML = state.data.stages.map(stage => `<option value="${stage.key}">${esc(stage.label)}</option>`).join('');
    if ($('#customerTypeFilter')) $('#customerTypeFilter').innerHTML = multiOptions(customerFilterValues(state.data.accounts, 'customer_type'));
    if ($('#customerIndustryFilter')) $('#customerIndustryFilter').innerHTML = multiOptions(customerFilterValues(state.data.accounts, 'industry'));
    if ($('#customerSourceFilter')) $('#customerSourceFilter').innerHTML = multiOptions(customerFilterValues(state.data.accounts, 'source'));
    const creatorLabels = Object.fromEntries(state.data.users.map(user => [user.id, user.name]));
    const creators = customerFilterValues(state.data.accounts, 'created_by');
    if ($('#customerCreatorFilter')) $('#customerCreatorFilter').innerHTML = multiOptions(creators, creatorLabels);
    const tags = customerAIEnabled()
      ? [...new Set((state.data.customerEvaluationTags || []).flatMap(item => item.labels || []))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'))
      : [];
    const tagFilter = $('#evaluationTagFilter');
    if (tagFilter) {
      tagFilter.innerHTML = tags.map(label => `<option value="${esc(label)}">${esc(label)}</option>`).join('');
      tagFilter.disabled = !tags.length;
    }
    const intakeOwner = $('#intakeOwnerFilter');
    if (intakeOwner) {
      intakeOwner.innerHTML = '<option value="">全部销售</option><option value="__unassigned__">未分配</option>'
        + activeSales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('');
    }
    const intakeBatch = $('#intakeSourceBatchFilter');
    if (intakeBatch) {
      intakeBatch.innerHTML = '<option value="">全部批次</option>' + (state.data.intake?.batches || []).map(batch =>
        `<option value="${esc(batch.id)}">${esc(batch.batch_date || batch.id)} · ${esc(batch.source || batch.id)}</option>`).join('');
    }
    syncIntakeFilterControls();
    syncCustomerFilterControls();
  }

  function scopedAccounts() {
    return state.data.accounts;
  }
  function alertReasons(alert) {
    return Array.isArray(alert?.reasons) && alert.reasons.length ? alert.reasons : [alert];
  }
  function alertHasCode(alert, code) {
    return alertReasons(alert).some(reason => reason?.code === code);
  }
  function scopedAlerts() {
    const accounts = scopedAccounts();
    const ids = new Set(accounts.map(item => item.id));
    return state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId));
  }
  function alertFor(customerId) {
    return state.data.alerts.find(alert => alert.customerId === customerId);
  }
  function customerPrimaryStatus(alert) {
    if (!alert) return { label: '正常推进', tone: 'good' };
    const primary = alertReasons(alert)[0];
    const code = String(primary?.code || '');
    if (code === 'UNCLAIMED') return { label: '领取超期', tone: 'red' };
    if (code === 'OVERDUE') return { label: '跟进超期', tone: 'red' };
    if (code === 'MANAGER_NEEDED') return { label: '需要主管协助', tone: 'amber' };
    return { label: primary?.title || '需关注', tone: alert.severity === 'critical' ? 'red' : 'amber' };
  }
  function hasMeaningfulAlertCopy(alert) {
    return Boolean(alert && [alert.title, alert.detail, alert.action]
      .some(value => String(value || '').trim()));
  }
  function filteredActivities(accounts = scopedAccounts()) {
    const ids = new Set(accounts.map(item => item.id));
    return state.data.activities.filter(item => ids.has(item.customer_id));
  }

  function renderNavigationCounts() {
    const bootstrapCounts = state.data?.navigationCounts || {};
    const customerCount = state.customerList.loaded
      ? Number(state.customerList.authorizedTotal || 0)
      : Number(bootstrapCounts.customers ?? state.data?.accounts?.length ?? 0);
    if ($('#navCustomerCount')) $('#navCustomerCount').textContent = customerCount;
    const alertMeta = state.authorizedBusinessLists.alerts;
    const alertCount = alertMeta.loaded
      ? Number(alertMeta.authorizedTotal || 0)
      : Number(bootstrapCounts.alerts ?? state.data?.alerts?.length ?? 0);
    if ($('#navAlertCount')) $('#navAlertCount').textContent = alertCount;
    const notificationMeta = state.authorizedBusinessLists.notifications;
    const notificationRows = notificationMeta.loaded ? notificationMeta.rows : (state.data.notifications || []);
    const unreadNotifications = notificationMeta.loaded && notificationMeta.summary
      ? Number(notificationMeta.summary.unread || 0)
      : Number(bootstrapCounts.notificationsUnread
        ?? notificationRowsAllowedByAIGate(notificationRows)
          .filter(item => (item.recipientId || item.user_id) === state.data.user.id
            && item.status === 'unread').length);
    if ($('#navNotificationCount')) $('#navNotificationCount').textContent = unreadNotifications;
    if ($('#topNotificationCount')) {
      $('#topNotificationCount').textContent = unreadNotifications > 99 ? '99+' : unreadNotifications;
      $('#topNotificationCount').classList.toggle('hidden', unreadNotifications === 0);
    }
    const intakeStats = state.data.intake?.stats;
    if ($('#navIntakeCount')) {
      const intakeSalesView = !canViewAssignmentDecisions();
      $('#navIntakeCount').textContent = intakeSalesView
        ? Number(intakeStats?.assigned || 0)
        : Number(intakeStats?.pending || 0) + Number(intakeStats?.approved || 0)
          + Number(intakeStats?.assigned || 0) + Number(intakeStats?.returned || 0) || 0;
    }
    if ($('#navInsightCount')) {
      $('#navInsightCount').textContent = Number(
        bootstrapCounts.insights ?? state.data.insights?.evaluations?.length ?? 0,
      );
    }
    if ($('#navPeopleCount')) {
      $('#navPeopleCount').textContent = Number(
        bootstrapCounts.people ?? state.data.researchTotals?.people ?? 0,
      );
    }
    const recycleMeta = state.authorizedBusinessLists.recycle_bin;
    const recycleCount = recycleMeta.loaded
      ? Number(recycleMeta.authorizedTotal || 0)
      : Number(bootstrapCounts.recycleBin || 0);
    if ($('#navRecycleCount')) $('#navRecycleCount').textContent = recycleCount;
  }

  function renderAll() {
    renderNavigationCounts();
    if ($('#lastRefresh')) $('#lastRefresh').textContent = `更新于 ${shortDate(state.data.generatedAt, true)}`;
    renderDashboard();
    renderIntake();
    renderCustomers();
    renderUnifiedPeople();
    renderUnifiedRecon();
    renderPipeline();
    renderAlerts();
    renderManagerTasks();
    renderManagerMetrics();
    renderManagerTaskSettings();
    renderNotifications();
    renderInsightsHub();
    renderTeam();
    renderMarkets();
    renderUsers();
    renderProtectedWorkspace();
    renderMaintenance();
    renderAiGovernance();
    if (state.selectedCustomerId && state.data.accounts.some(item => item.id === state.selectedCustomerId)) renderDrawer();
    if (state.view === 'customerProfile') renderCustomerProfileHeader();
  }

  function computeSummary(accounts) {
    const ids = new Set(accounts.map(item => item.id));
    const atLeast = stage => {
      const order = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
      return accounts.filter(item => !['lost', 'disqualified'].includes(item.stage) && order[item.stage] >= order[stage]).length;
    };
    const rfqs = state.data.rfqs.filter(item => ids.has(item.customer_id));
    const quotes = state.data.quotes.filter(item => ids.has(item.customer_id));
    const orders = state.data.orders.filter(item => ids.has(item.customer_id));
    const alerts = state.data.alerts.filter(item => item.intakeItemId || ids.has(item.customerId));
    return {
      accounts: accounts.length, contacted: atLeast('contacted'), replies: atLeast('replied'), meetings: atLeast('meeting'),
      rfqs: rfqs.length, quotes: quotes.length, orders: orders.length,
      overdue: alerts.filter(item => alertHasCode(item, 'OVERDUE')).length,
      managerNeeded: alerts.filter(item => alertHasCode(item, 'MANAGER_NEEDED')).length,
      revenue: orders.reduce((sum, item) => sum + Number(item.amount), 0),
    };
  }

  function renderDashboard() {
    const accounts = scopedAccounts();
    const summary = computeSummary(accounts);
    const intakeStats = state.data.intake?.stats || {};
    const cards = [
      ['未开发线索', intakeStats.assigned || 0, '等待领取', ''],
      ['CRM客户', summary.accounts, '已领取并开始开发', ''],
      ['获得回复', summary.replies, `触达后 ${percent(summary.replies, summary.contacted)}`, ''],
      ['深度会议', summary.meetings, `回复后 ${percent(summary.meetings, summary.replies)}`, ''],
      ['正式询价', summary.rfqs, `会议后 ${percent(summary.rfqs, summary.meetings)}`, ''],
      ['成交订单', summary.orders, money(summary.revenue), ''],
    ];
    $('#summaryCards').innerHTML = cards.map(([label, value, note, cls]) => (
      `<article class="metric ${cls}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`
    )).join('');
    const attentionSummary = $('#attentionSummary');
    if (attentionSummary) {
      attentionSummary.textContent = summary.overdue || summary.managerNeeded
        ? `${summary.overdue} 个超期 · ${summary.managerNeeded} 个待介入`
        : '当前无待处理提醒';
      attentionSummary.classList.toggle('critical', Boolean(summary.overdue));
    }
    const stageOrder = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
    const funnelStages = state.data.stages.filter(item => !['new', 'lost', 'disqualified'].includes(item.key));
    const funnel = funnelStages.map(stage => ({
      ...stage, count: accounts.filter(account => !['lost', 'disqualified'].includes(account.stage) && stageOrder[account.stage] >= stageOrder[stage.key]).length,
    }));
    const max = Math.max(1, funnel[0]?.count || 1);
    $('#funnelChart').innerHTML = funnel.map((item, index) => {
      const previous = index ? funnel[index - 1].count : accounts.length;
      return `<div class="funnel-row" data-stage-jump="${item.key}" title="到达过该阶段的客户数，点击查看累计口径列表">
        <span class="funnel-label">${esc(item.label)}</span><div class="funnel-track"><div class="funnel-bar" style="width:${item.count / max * 100}%"></div></div>
        <span class="funnel-count">${item.count}</span><span class="funnel-rate">${percent(item.count, previous)}</span>
      </div>`;
    }).join('');
    const attention = scopedAlerts().slice(0, 5);
    $('#attentionList').innerHTML = attention.length ? attention.map(item => {
      const account = state.data.accounts.find(row => row.id === item.customerId);
      const displayCustomer = account || item;
      return `<div class="attention-item" ${item.intakeItemId ? `data-intake-profile="${esc(item.intakeItemId)}"` : `data-open-customer="${esc(item.customerId)}"`}>
        <i class="severity-dot ${item.urgency || item.severity}"></i><div><strong>${esc(accountDisplayName(displayCustomer))}</strong><span>${esc(accountIdentity(displayCustomer))}${accountIdentity(displayCustomer) ? ' · ' : ''}${esc(item.title)}${item.reasonCount > 1 ? ` · 另有 ${item.reasonCount - 1} 个原因` : ''}</span></div><b>${esc(item.urgencyLabel || (item.severity === 'critical' ? '立即处理' : '需要关注'))}</b>
      </div>`;
    }).join('') : '<div class="empty">当前没有需要处理的异常</div>';
    renderCountrySnapshot(accounts);
    const activities = filteredActivities(accounts).slice(0, 8);
    $('#activityFeed').innerHTML = activities.length ? activities.map(activity => {
      const account = state.data.accounts.find(item => item.id === activity.customer_id);
      const meta = activityMeta[activity.activity_type] || [activity.activity_type, '记'];
      return `<div class="feed-item" data-open-customer="${activity.customer_id}"><span class="feed-icon">${meta[1]}</span><div><strong>${esc(accountDisplayName(account))} · ${esc(meta[0])}</strong><span>${esc(accountIdentity(account))}${accountIdentity(account) ? ' · ' : ''}${esc(activity.user_name || '')} · ${esc(activity.summary || activity.outcome || '')} · ${relative(activity.occurred_at)}</span></div></div>`;
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

  function applyTableColumnClasses(container, columnClasses = []) {
    if (!container || !Array.isArray(columnClasses) || !columnClasses.length) return;
    container.querySelectorAll('thead th').forEach((cell, index) => {
      if (columnClasses[index]) cell.classList.add(columnClasses[index]);
    });
    container.querySelectorAll('tbody tr').forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (columnClasses[index]) cell.classList.add(columnClasses[index]);
      });
    });
  }

  function refreshDataTableOverflowHint(element, { resetHint = false } = {}) {
    if (!element?.classList) return;
    let meta = dataTableOverflowState.get(element);
    if (!meta) {
      meta = { dismissed: false, lastScrollLeft: Number(element.scrollLeft || 0) };
      dataTableOverflowState.set(element, meta);
      element.addEventListener('scroll', () => {
        const nextScrollLeft = Number(element.scrollLeft || 0);
        if (nextScrollLeft !== meta.lastScrollLeft) {
          meta.dismissed = true;
          element.classList.remove('show-horizontal-scroll-hint');
        }
        meta.lastScrollLeft = nextScrollLeft;
      }, { passive: true });
      dataTableResizeObserver?.observe(element);
    }
    if (resetHint) meta.dismissed = false;
    const overflowing = Number(element.scrollWidth || 0) > Number(element.clientWidth || 0) + 1;
    if (!overflowing) meta.dismissed = false;
    meta.lastScrollLeft = Number(element.scrollLeft || 0);
    element.classList.toggle('is-horizontally-overflowing', overflowing);
    element.classList.toggle(
      'show-horizontal-scroll-hint',
      overflowing && !meta.dismissed && meta.lastScrollLeft <= 1,
    );
  }

  function scheduleDataTableOverflowRefresh(resetTables = []) {
    resetTables.forEach(element => dataTablesNeedingHintReset.add(element));
    if (dataTableOverflowFrame) return;
    dataTableOverflowFrame = requestAnimationFrame(() => {
      dataTableOverflowFrame = 0;
      $$('.data-table').forEach(element => {
        refreshDataTableOverflowHint(element, {
          resetHint: dataTablesNeedingHintReset.has(element),
        });
      });
      dataTablesNeedingHintReset.clear();
    });
  }

  function initializeDataTableOverflowHints() {
    if (typeof ResizeObserver === 'function') {
      dataTableResizeObserver = new ResizeObserver(entries => {
        scheduleDataTableOverflowRefresh(entries.map(entry => entry.target));
      });
    }
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(records => {
        const affected = new Set();
        records.forEach(record => {
          const table = record.target.closest?.('.data-table');
          if (table) affected.add(table);
          record.addedNodes.forEach(node => {
            if (node.nodeType !== 1) return;
            if (node.matches?.('.data-table')) affected.add(node);
            node.querySelectorAll?.('.data-table').forEach(element => affected.add(element));
          });
        });
        scheduleDataTableOverflowRefresh([...affected]);
      });
      observer.observe($('#app') || document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', () => {
      scheduleDataTableOverflowRefresh($$('.data-table'));
    }, { passive: true });
    scheduleDataTableOverflowRefresh($$('.data-table'));
  }

  const researchConfig = {
    contacts: {
      pageKey: 'contacts',
      endpointKind: 'people',
      totalsKey: 'people',
      dataKey: 'people',
      root: '#peopleAuthorizedFilters',
      render: renderUnifiedPeople,
      pagination: '#peoplePagination',
    },
    recon: {
      pageKey: 'recon',
      endpointKind: 'recon',
      totalsKey: 'recon',
      dataKey: 'reconResults',
      root: '#reconAuthorizedFilters',
      render: renderUnifiedRecon,
      pagination: '#reconPagination',
    },
  };

  function updateResearchPagination(kind) {
    const meta = state.research[kind];
    renderPagination(researchConfig[kind].pagination, kind, meta, change => {
      if (change.pageSize) meta.pageSize = change.pageSize;
      void loadResearch(kind, { page: change.page || 1 });
    });
  }

  async function loadResearch(kind, { reset = false, page } = {}) {
    const config = researchConfig[kind];
    const meta = state.research[kind];
    if (!config || !meta?.filterController) return;
    if (meta.loading && !reset) return;
    if (reset) {
      state.data[config.dataKey] = [];
      Object.assign(meta, { page: 1, total: 0, hasMore: false, loaded: false });
    }
    const requestEpoch = ++meta.requestEpoch;
    meta.loading = true;
    meta.error = '';
    meta.filterMount?.setResultMeta({
      loading: true,
      total: meta.total,
      shown: state.data[config.dataKey].length,
    });
    config.render();
    updateResearchPagination(kind);
    try {
      const payload = meta.filterController.serialize('applied');
      const params = new URLSearchParams({
        page: String(reset ? 1 : Math.max(1, Number(page || meta.page || 1))),
        pageSize: String(meta.pageSize),
        permissionVersion: String(payload.permissionVersion || ''),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
      });
      const result = await api(
        `/api/sales-crm/research/${config.endpointKind}?${params}`,
        { timeoutMs: 12000 },
      );
      if (requestEpoch !== meta.requestEpoch) return;
      state.data[config.dataKey] = result.rows;
      Object.assign(meta, {
        page: result.page,
        pageSize: result.pageSize || meta.pageSize,
        total: result.total,
        totalPages: Number(result.totalPages ?? Math.ceil(Number(result.total || 0) / Number(result.pageSize || meta.pageSize || 50))),
        hasMore: result.hasMore,
        loaded: true,
        error: '',
      });
      if (result.schema
          && String(result.schema.permissionVersion) !== String(payload.permissionVersion)) {
        meta.filterController.updateSchema(result.schema);
      }
      meta.filterMount?.setResultMeta({
        total: result.total,
        shown: state.data[config.dataKey].length,
      });
    } catch (error) {
      if (requestEpoch !== meta.requestEpoch) return;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        meta.loading = false;
        await initializeResearchFilters(kind, { force: true });
        return;
      }
      meta.error = error.message || '数据读取失败';
      toast(error.message);
    } finally {
      if (requestEpoch === meta.requestEpoch) {
        meta.loading = false;
        meta.filterMount?.setResultMeta({
          total: meta.total,
          shown: state.data[config.dataKey].length,
        });
        config.render();
        updateResearchPagination(kind);
      }
    }
  }

  function invalidateStaleResearchFilterState(pageKey, schema = {}) {
    const storagePrefix = window.TradePulseFilterComponent?.STORAGE_PREFIX;
    if (!storagePrefix) return;
    const storageKey = `${storagePrefix}.${pageKey}`;
    try {
      const storage = window.localStorage;
      if (!storage) return;
      const saved = JSON.parse(storage.getItem(storageKey) || '{}');
      if (Object.keys(saved).length
          && String(saved.permissionVersion || '') !== String(schema.permissionVersion || '')) {
        storage.removeItem(storageKey);
      }
    } catch (_error) {
      try { window.localStorage?.removeItem(storageKey); } catch (_storageError) {}
    }
  }

  async function initializeResearchFilters(kind, { force = false } = {}) {
    const config = researchConfig[kind];
    const meta = state.research[kind];
    const root = config ? $(config.root) : null;
    if (!config || !meta || !root || !window.TradePulseFilterComponent) return;
    if (meta.filterMount && !force) return;
    if (meta.initializing && !force) return;
    const initializeEpoch = ++meta.initializeEpoch;
    meta.requestEpoch += 1;
    meta.loading = false;
    meta.error = '';
    meta.initializing = true;
    meta.filterMount?.destroy();
    meta.filterMount = null;
    meta.filterController = null;
    state.data[config.dataKey] = [];
    Object.assign(meta, { page: 0, total: 0, hasMore: false, loaded: false });
    config.render();
    updateResearchPagination(kind);
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    try {
      const result = await api(`/filter-schema/${config.pageKey}`);
      if (initializeEpoch !== meta.initializeEpoch) return;
      invalidateStaleResearchFilterState(config.pageKey, result.schema);
      const controller = window.TradePulseFilterComponent.createFilterController({
        pageKey: config.pageKey,
        storage: paginationFilterStorage,
        schema: result.schema,
        onApply: () => void loadResearch(kind, { reset: true }),
      });
      meta.filterController = controller;
      meta.filterMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
        controller,
        resultMeta: {
          total: meta.total,
          shown: state.data[config.dataKey].length,
        },
      });
      meta.initializing = false;
      await loadResearch(kind, { reset: true });
    } catch (error) {
      if (initializeEpoch !== meta.initializeEpoch) return;
      meta.error = error.message || '筛选项读取失败';
      root.innerHTML = `${window.TradePulseFilterComponent.renderFilterComponent({
        status: 'error',
        error: error.message,
      })}<div class="research-filter-retry"><button class="button secondary" type="button" data-retry-research-schema="${esc(kind)}">重新加载筛选项</button></div>`;
    } finally {
      if (initializeEpoch === meta.initializeEpoch) meta.initializing = false;
    }
  }

  function researchLoading(kind) {
    const meta = state.research[kind];
    if (meta.loading && !meta.loaded) return '<div class="empty">正在加载数据…</div>';
    if (meta.error && !meta.loaded) {
      return `<div class="empty research-error-state" role="alert"><p>数据读取失败，请重试</p><button class="button secondary" type="button" data-retry-research="${esc(kind)}">重新加载</button></div>`;
    }
    if (!meta.loaded) return '<div class="empty">进入本模块后加载数据</div>';
    return '';
  }

  function renderUnifiedPeople() {
    const root = $('#unifiedPeopleTable');
    if (!root) return;
    const loading = researchLoading('contacts');
    if (loading) { root.innerHTML = loading; $('#peopleResultCount').textContent = ''; return; }
    const rows = state.data.people || [];
    $('#peopleResultCount').textContent = `已显示 ${rows.length} / ${state.research.contacts.total} 条线索`;
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
    return ({ pending: '待分配', approved: '待分配', assigned: '待领取', claimed: '已领取', returned: '已退回', rejected: '不对口', duplicate: '已在 CRM' })[status] || status;
  }

  function intakeStatusDisplay(item = {}) {
    const status = String(item.status || '');
    if (status === 'duplicate') return { label: '已在 CRM（重复）', className: 'gray' };
    if (status === 'claimed') return { label: '已领取 · 已进入 CRM', className: '' };
    if (status === 'assigned') return { label: '待领取', className: 'amber' };
    if (status === 'returned') return { label: '已退回线索池', className: 'red' };
    if (status === 'rejected') return { label: '不对口', className: 'red' };
    if (status === 'approved') return { label: '待分配', className: 'gray' };
    if (status === 'pending') return { label: '待分配', className: 'gray' };
    return { label: intakeStatusLabel(status) || '状态未知', className: 'gray' };
  }

  function intakeItemAssignable(item) {
    if (typeof item?.assignable === 'boolean') return item.assignable;
    return ['pending', 'approved', 'returned'].includes(item?.status)
      && !Boolean(item?.in_crm)
      && !String(item?.crm_customer_id || '').trim();
  }

  function intakeNeedsIdentityReview(item = {}) {
    return Boolean(item.identityWarning?.active)
      || Boolean(item.claimBlocked)
      || String(item.duplicate_state || '') === 'review';
  }

  function intakeBlockStatusLabel(item = {}) {
    const state = String(item.duplicate_state || '');
    // Identity-conflict-linked items carry their own linked-master fields and
    // must win over any stale supplement/needs-review marker so a resolved link
    // never regresses to a needs-review block.
    const linkedName = String(item.linkedMasterName || item.linked_master_name || '').trim();
    const linkedExternalId = String(item.linkedMasterExternalId || '').trim();
    if (linkedName || linkedExternalId) {
      return `已关联主客户：${linkedName || linkedExternalId}`;
    }
    // Resolved states win over any stale supplement/needs-info marker so a
    // lead that was later linked or released never regresses to 资料不足.
    if (state === 'exact') {
      const master = String(
        item.linked_master_name || item.linkedMasterName || item.master_company_name || '',
      ).trim();
      return master ? `已关联主客户：${master}` : '已关联主客户';
    }
    if (state === 'cleared') return '已确认不是同一客户，可以分配';
    const supplement = String(item.supplement_requirement || item.supplementRequirement || '').trim();
    const needsInfo = Boolean(supplement)
      || String(item.decision_reason || '').includes('补充')
      || String(item.assignmentBlockReason || '').includes('补充');
    if (needsInfo) return supplement ? `资料不足，需要补充${supplement}` : '资料不足，需要补充资料';
    if (state === 'review') return '疑似重名，等待管理员确认';
    if (item.identityWarning?.active || Boolean(item.claimBlocked)) return '管理员确认后才能分配';
    return '';
  }

  function intakeReviewActionMarkup(item = {}) {
    const id = esc(item.id);
    if (canAccessProtectionAndDedupe()) {
      return `<button class="button secondary tiny" type="button" data-intake-review="${id}" title="前往客户保护与查重处理">去处理核验</button>`;
    }
    return `<button class="button secondary tiny" type="button" disabled title="管理员确认后才能分配">等待管理员核验</button>`;
  }

  function intakeReviewDeepLink(item = {}) {
    const conflictId = String(item.identityWarning?.conflictId || '').trim();
    if (conflictId) return `#protectedCustomers?conflict=${encodeURIComponent(conflictId)}`;
    const reviewId = String(item.duplicate_review_id || '').trim();
    if (reviewId) return `#protectedCustomers?review=${encodeURIComponent(reviewId)}`;
    const externalCustomerId = String(item.external_customer_id || '').trim();
    if (externalCustomerId) return `#protectedCustomers?customer=${encodeURIComponent(externalCustomerId)}`;
    return '#protectedCustomers';
  }

  function openIntakeReview(item = {}) {
    switchView('protectedCustomers');
    location.hash = intakeReviewDeepLink(item);
  }

  const intakeFilterControls = {
    customerTag: 'intakeCustomerTagFilter',
    country: 'intakeCountryFilter',
    industry: 'intakeIndustryFilter',
    customerType: 'intakeCustomerTypeFilter',
    contactLevel: 'intakeContactLevelFilter',
    owner: 'intakeOwnerFilter',
    sourceBatch: 'intakeSourceBatchFilter',
    updatedFrom: 'intakeUpdatedFromFilter',
    updatedTo: 'intakeUpdatedToFilter',
    hasWebsite: 'intakeHasWebsiteFilter',
    hasNamedContact: 'intakeHasNamedContactFilter',
    unassignedOnly: 'intakeUnassignedOnlyFilter',
  };

  const intakeFilterOptionControls = {
    customerTags: { id: 'intakeCustomerTagFilter', emptyLabel: '全部客户标签' },
    countries: { id: 'intakeCountryFilter', emptyLabel: '全部国家 / 地区' },
    industries: { id: 'intakeIndustryFilter', emptyLabel: '全部行业' },
    customerTypes: { id: 'intakeCustomerTypeFilter', emptyLabel: '全部客户类型' },
  };

  function populateIntakeFilterOptions(filterOptions = {}) {
    Object.entries(intakeFilterOptionControls).forEach(([key, config]) => {
      const select = $(`#${config.id}`);
      if (!select) return;
      const selected = select.value || state.intakeFilters[
        ({ customerTags: 'customerTag', countries: 'country', industries: 'industry', customerTypes: 'customerType' })[key]
      ] || '';
      const options = (filterOptions[key] || []).map(item => {
        const value = typeof item === 'object' ? item.id : item;
        const label = typeof item === 'object' ? item.name : item;
        return `<option value="${esc(value)}">${esc(label)}</option>`;
      }).join('');
      select.innerHTML = `<option value="">${esc(config.emptyLabel)}</option>${options}`;
      if (selected && ![...select.options].some(option => option.value === String(selected))) {
        select.insertAdjacentHTML('beforeend', `<option value="${esc(selected)}">${esc(selected)}</option>`);
      }
      select.value = selected;
    });
  }

  function syncIntakeFilterControls() {
    Object.entries(intakeFilterControls).forEach(([key, id]) => {
      const input = $(`#${id}`);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(state.intakeFilters[key]);
      else input.value = state.intakeFilters[key] ?? '';
    });
  }

  function readIntakeFilterControls() {
    Object.entries(intakeFilterControls).forEach(([key, id]) => {
      const input = $(`#${id}`);
      if (!input) return;
      state.intakeFilters[key] = input.type === 'checkbox' ? input.checked : input.value.trim();
    });
  }

  function activeIntakeFilterCount() {
    return Object.values(state.intakeFilters).filter(Boolean).length;
  }

  function renderIntakeActiveFilters() {
    const root = $('#intakeActiveFilters');
    if (!root) return;
    const labels = {
      customerTag: '客户标签', country: '国家 / 地区', industry: '行业', customerType: '客户类型',
      contactLevel: '联系人等级', owner: '分配销售', sourceBatch: '来源批次',
      updatedFrom: '更新从', updatedTo: '更新至', hasWebsite: '官网',
      hasNamedContact: '具名联系人', unassignedOnly: '仅看未分配',
    };
    const chips = Object.entries(state.intakeFilters).filter(([, value]) => Boolean(value)).map(([key, value]) => {
      let display = value;
      const control = $(`#${intakeFilterControls[key]}`);
      if (control?.tagName === 'SELECT') display = control.selectedOptions[0]?.textContent || value;
      if (value === true) display = '';
      return `<button type="button" data-remove-intake-filter="${esc(key)}">${esc(labels[key])}${display ? `：${esc(display)}` : ''} ×</button>`;
    });
    root.classList.toggle('hidden', !chips.length);
    root.innerHTML = chips.join('') + (chips.length ? '<button type="button" class="clear-all" id="intakeClearFilters">清空全部</button>' : '');
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
      rule: `<div class="decision-layer"><span>规则裁决</span><strong>${esc(rule.disposition === 'manager_review' ? '待分配' : rule.disposition === 'blocked' ? '规则阻止' : rule.disposition === 'assign' ? '可分配' : '待裁决')}</strong><small>${esc(rule.reason || item.decision_reason || '暂无')}</small></div>`,
      manual: `<div class="decision-layer"><span>人工最终决定</span><strong>${manual ? esc(manual.ownerId || (manual.status === 'rejected' ? '不对口' : manual.status === 'returned' ? '退回' : manual.status)) : '尚未操作'}</strong><small>${esc(manual?.reason || (manual ? manual.action : '等待主管回复'))}</small></div>`,
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

  async function loadIntakePage({ reset = true, page = 1 } = {}) {
    const pageKey = 'intake';
    const meta = state.authorizedBusinessLists[pageKey];
    if (!meta?.filterController) {
      await initializeAuthorizedBusinessFilters(pageKey, { force: true });
      return;
    }
    const controller = meta.filterController;
    const fields = new Map(controller.getSchema().fields.map(field => [field.key, field]));
    controller.clearAll({ apply: false });
    const values = {
      search: ($('#intakeSearch')?.value || '').trim(),
      status: state.intakeStatus === 'unassigned' ? ['pending', 'approved'] : state.intakeStatus,
      country: state.intakeFilters.country,
      industry: state.intakeFilters.industry,
      customer_type: state.intakeFilters.customerType,
      contact_level: state.intakeFilters.contactLevel,
      owner: state.intakeFilters.owner,
      source_batch: state.intakeFilters.sourceBatch,
      has_website: state.intakeFilters.hasWebsite,
      has_named_contact: state.intakeFilters.hasNamedContact,
      unassigned_only: state.intakeFilters.unassignedOnly ? '1' : '',
    };
    for (const [key, value] of Object.entries(values)) {
      const field = fields.get(key);
      if (!field || value === '' || value === false) continue;
      controller.setDraft(key, field.type === 'text' ? String(value) : [String(value)]);
    }
    if (fields.has('updated_at') && (state.intakeFilters.updatedFrom || state.intakeFilters.updatedTo)) {
      controller.setDraft('updated_at', {
        from: state.intakeFilters.updatedFrom || '', to: state.intakeFilters.updatedTo || '',
      });
    }
    controller.apply();
    if (!reset && Number(page) > 1) void loadAuthorizedBusinessPage(pageKey, { page });
  }

  function currentIntakeAssignmentScope() {
    if (!can('manage_intake')) {
      return null;
    }
    if (state.intakeSelectAllScope) {
      return {
        scopeType: 'all_filtered',
        filterScope: state.intakeSelectAllScope.filterScope,
        count: Number(state.intakeSelectAllScope.total || 0),
      };
    }
    const visibleItems = state.data?.intake?.items || [];
    const visibleOrder = visibleItems.map(item => item.id)
      .filter(itemId => state.selectedIntakeIds.has(itemId));
    const itemIds = visibleOrder;
    if (itemIds.length) {
      return { scopeType: 'selection', itemIds, count: itemIds.length };
    }
    return null;
  }

  function switchIntakeSelectionToCurrentPage() {
    if (!state.intakeSelectAllScope) return;
    state.intakeSelectAllScope = null;
    state.selectedIntakeIds = new Set(
      (state.data?.intake?.items || []).filter(intakeItemAssignable).map(item => item.id),
    );
  }

  function renderIntakeAssignmentBar() {
    const bar = $('#intakeBulkBar');
    const label = $('#intakeSelectionCount');
    const button = $('#manualAssignIntakeBtn');
    const clear = $('#clearIntakeSelection');
    const selectAll = $('#intakeSelectAllResults');
    if (!bar || !label || !button || !clear || !selectAll) return;
    const visible = can('manage_intake');
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;
    const scope = currentIntakeAssignmentScope();
    const assignableVisible = (state.data?.intake?.items || []).filter(intakeItemAssignable);
    const selectedVisible = state.intakeSelectAllScope
      ? assignableVisible.length
      : assignableVisible.filter(item => state.selectedIntakeIds.has(item.id)).length;
    const canOfferAll = !state.intakeSelectAllScope
      && state.selectedIntakeIds.size > 0
      && selectedVisible === assignableVisible.length
      && assignableVisible.length > 0
      && Number(state.data?.intake?.total || 0) > assignableVisible.length;
    selectAll.classList.toggle('hidden', !canOfferAll);
    selectAll.disabled = !canOfferAll;
    selectAll.title = canOfferAll
      ? `选择全部筛选结果 ${state.data?.intake?.total || 0} 条`
      : '仅当前页存在可分配线索时可用';
    clear.classList.toggle('hidden', !state.selectedIntakeIds.size && !state.intakeSelectAllScope);
    if (state.intakeSelectAllScope) {
      label.textContent = `已选择全部筛选结果 ${scope.count} 条`;
      button.textContent = `分配筛选结果 ${scope.count} 条`;
    } else if (state.selectedIntakeIds.size) {
      label.textContent = `已勾选 ${state.selectedIntakeIds.size} 条线索`;
      button.textContent = `分配已选 ${state.selectedIntakeIds.size} 条`;
    } else if (scope?.scopeType === 'filter') {
      label.textContent = `当前筛选结果 ${scope.count} 条`;
      button.textContent = `分配筛选结果 ${scope.count} 条`;
    } else {
      label.textContent = '勾选线索，或先设置筛选条件';
      button.textContent = '分配';
    }
    button.disabled = !scope || scope.count < 1 || state.intakeAssignmentSubmitting;
    const headerCheckbox = $('#selectVisibleIntake');
    if (headerCheckbox) {
      headerCheckbox.title = assignableVisible.length
        ? '选择当前页可分配线索'
        : '当前页没有可分配线索';
    }
  }

  function intakeAssignmentCandidates() {
    return (state.data?.todayTaskAssignmentCandidates || [])
      .filter(user => user?.id && user?.name);
  }

  function syncManualAssignmentAmount() {
    const form = $('#intakeManualAssignForm');
    const preview = state.intakeAssignmentPreview?.preview;
    if (!form || !preview) return;
    const ownerId = form.elements.ownerId?.value || '';
    const owner = preview.sales.find(item => item.id === ownerId);
    const max = owner ? Math.max(0, Number(preview.eligibleCount || 0)) : 0;
    const amount = form.elements.amount;
    amount.max = String(max);
    if (!Number(amount.value) || Number(amount.value) > max) amount.value = max ? String(max) : '';
    const note = $('#manualAssignmentCapacity');
    if (note) {
      note.textContent = owner
        ? `${owner.name} 将接收本次指定数量的线索`
        : '请选择销售人员';
    }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = max < 1 || state.intakeAssignmentSubmitting;
  }

  async function openManualIntakeAssignment() {
    const scope = currentIntakeAssignmentScope();
    if (!scope) throw new Error('请先勾选线索或设置至少一个筛选条件');
    state.intakeAssignmentSubmitting = true;
    renderIntakeAssignmentBar();
    try {
      const preview = await api('/api/sales-crm/intake/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'manual_assign_preview',
          itemIds: scope.itemIds,
          filterScope: scope.filterScope,
          allFiltered: scope.scopeType === 'all_filtered',
        }),
      });
      const defaultOwner = preview.sales?.[0];
      const defaultAmount = defaultOwner ? Number(preview.eligibleCount || 0) : 0;
      const blocked = Object.entries(preview.blockedReasons || {})
        .map(([reason, count]) => `${esc(reason)} ${esc(count)} 条`).join('；');
      const scopeLabel = scope.scopeType === 'selection'
        ? '已勾选'
        : scope.scopeType === 'all_filtered' ? '全部筛选结果' : '当前筛选';
      state.intakeAssignmentPreview = {
        scope,
        preview,
        idempotencyKey: proposalRequestId(),
      };
      openModal('分配线索', 'MANUAL ASSIGNMENT', `<form id="intakeManualAssignForm" class="form-grid">
        <div class="manual-assignment-summary">
          <div><span>分配范围</span><strong>${scopeLabel}</strong></div>
          <div><span>范围内线索</span><strong>${esc(preview.scopeTotal)}</strong></div>
          <div><span>当前可分配</span><strong>${esc(preview.eligibleCount)}</strong></div>
        </div>
        ${preview.blockedCount ? `<div class="manual-assignment-blocks">已阻断 ${esc(preview.blockedCount)} 条${blocked ? `：${blocked}` : ''}</div>` : ''}
        <label>分给谁<select name="ownerId" required>
          ${(preview.sales || []).map(owner => `<option value="${esc(owner.id)}" ${owner.id === defaultOwner?.id ? 'selected' : ''}>${esc(owner.name)}</option>`).join('')}
        </select></label>
        <label>分多少条<input name="amount" type="number" min="1" max="${esc(defaultAmount)}" value="${defaultAmount || ''}" required></label>
        <div id="manualAssignmentCapacity" class="recommendation"></div>
        ${scope.scopeType === 'all_filtered'
          ? `<label class="intake-all-confirm"><input type="checkbox" name="confirmAll" required> 我确认向所选销售分配全部筛选结果中的可分配线索（共 ${esc(preview.eligibleCount)} 条）</label>`
          : ''}
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit" ${defaultAmount ? '' : 'disabled'}>确认分配</button></div>
      </form>`);
      syncManualAssignmentAmount();
    } finally {
      state.intakeAssignmentSubmitting = false;
      renderIntakeAssignmentBar();
      syncManualAssignmentAmount();
    }
  }

  function intakeStatCards(salesView, stats, settings) {
    return salesView ? [
      ['today', '今日收到线索', stats.todayAssigned, '今日分配给你'],
      ['assigned', '待领取', stats.assigned, `领取时限 ${settings.claimSlaHours} 小时`],
      ['claimed', '已领取', stats.claimed, '已转入个人CRM'],
      ['crm', '已进入 CRM', stats.claimed, '点击进入 CRM 客户全景'],
      ['contacted', '当前触达', stats.contacted, '当前开发中已触达'],
      ['returned', '已退回', stats.returned, '必须说明原因'],
      ['overdue', '领取超期', stats.overdueClaim, '管理者将收到预警'],
    ] : [
      ['today', '今日同步线索', stats.todayImported, '仍属于线索池'],
      ['unassigned', '待分配', stats.pending + stats.approved, '勾选或筛选后手动指定销售'],
      ['assigned', '待销售领取', stats.assigned, `时限 ${settings.claimSlaHours} 小时`],
      ['crm', '已进入 CRM', stats.claimed, '已领取客户进入 CRM 全景'],
      ['contacted', '当前触达', stats.contacted, '当前开发漏斗中已触达'],
      ['idle', '闲置资源', stats.idle, '待分配或退回'],
      ['returned', '退回待处理', stats.returned, '需要重新分配'],
      ['overdue', '领取超期', stats.overdueClaim, '系统异常预警'],
    ];
  }

  function intakeAppliedFilters() {
    const controller = state.authorizedBusinessLists?.intake?.filterController;
    const payload = controller?.serialize('applied') || { filters: [] };
    const applied = {};
    (payload.filters || []).forEach(filter => { applied[filter.field] = filter.value; });
    return applied;
  }

  function intakeActiveStatCard() {
    const requestedLeadView = String(new URLSearchParams(location.search).get('leadView') || '');
    const poolLeadViews = ['today', 'unassigned', 'assigned', 'idle', 'returned', 'overdue'];
    if (state.view === 'pool' && poolLeadViews.includes(requestedLeadView)) return requestedLeadView;
    const applied = intakeAppliedFilters();
    const normalize = value => (Array.isArray(value) ? value : [value])
      .map(item => String(item)).sort();
    const appliedKeys = Object.keys(applied).sort();
    for (const key of poolLeadViews) {
      const draft = intakeStatDraft(key);
      const draftKeys = Object.keys(draft).sort();
      if (appliedKeys.length !== draftKeys.length
          || appliedKeys.some((field, index) => field !== draftKeys[index])) continue;
      const matches = draftKeys.every(field => {
        const actual = normalize(applied[field]);
        const expected = normalize(draft[field]);
        return actual.length === expected.length
          && actual.every((value, index) => value === expected[index]);
      });
      if (matches) return key;
    }
    return '';
  }

  function intakeStatDraft(key) {
    return {
      today: { created_today: true },
      unassigned: { status: ['pending', 'approved'] },
      assigned: { status: ['assigned'] },
      idle: { status: ['pending', 'approved', 'returned'] },
      returned: { status: ['returned'] },
      overdue: { status: ['assigned'], claim_overdue: true },
    }[key] || {};
  }

  function intakeStatusFromStat(key) {
    return ({
      unassigned: 'unassigned',
      assigned: 'assigned',
      overdue: 'assigned',
      returned: 'returned',
    })[key] || '';
  }

  function updateLeadWorkflowUrl(key, view = '') {
    const url = new URL(location.href);
    if (key) url.searchParams.set('leadView', key);
    else url.searchParams.delete('leadView');
    if (view) url.hash = view;
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function leadWorkflowMatchesView(view, key) {
    if (!key) return true;
    if (['pool', 'intake', 'pending'].includes(view)) {
      return ['today', 'unassigned', 'assigned', 'idle', 'returned', 'overdue'].includes(key);
    }
    return view === 'customers' && ['claimed', 'contacted'].includes(key);
  }

  function restoreLeadWorkflowFromLocation(view) {
    const key = String(new URLSearchParams(location.search).get('leadView') || '');
    state.pendingIntakeStat = '';
    state.pendingCustomerIntakeFlow = '';
    if (!leadWorkflowMatchesView(view, key)) return false;
    if (['pool', 'intake', 'pending'].includes(view) && key) state.pendingIntakeStat = key;
    if (view === 'customers' && key) state.pendingCustomerIntakeFlow = key;
    return true;
  }

  function leadWorkflowNavigationUrl(view) {
    const url = new URL(location.href);
    const key = String(url.searchParams.get('leadView') || '');
    if (!leadWorkflowMatchesView(view, key)) url.searchParams.delete('leadView');
    url.hash = view;
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function applyIntakeStatCard(key) {
    const controller = state.authorizedBusinessLists?.intake?.filterController;
    if (!controller) return;
    state.leadWorkflowApplying = true;
    controller.clearAll({ apply: false });
    const draft = intakeStatDraft(key);
    for (const [field, value] of Object.entries(draft)) {
      controller.setDraft(field, value);
    }
    state.intakeStatus = intakeStatusFromStat(key);
    controller.apply();
    state.leadWorkflowApplying = false;
    updateLeadWorkflowUrl(key, 'pool');
    $('#intakeTable')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function jumpIntakeStatToCrm(key) {
    const flow = (key === 'claimed' || key === 'crm') ? 'claimed' : 'contacted';
    state.pendingCustomerIntakeFlow = flow;
    updateLeadWorkflowUrl(flow, 'customers');
    switchView('customers');
  }

  function renderIntake() {
    const intake = state.data.intake;
    if (!intake) return;
    const salesView = !canViewAssignmentDecisions();
    const stats = intake.stats;
    const tabCounts = {
      '': salesView
        ? Number(stats.assigned || 0)
        : Number(stats.pending || 0) + Number(stats.approved || 0) + Number(stats.assigned || 0)
          + Number(stats.returned || 0),
      unassigned: Number(stats.pending || 0) + Number(stats.approved || 0),
      assigned: Number(stats.assigned || 0),
      returned: Number(stats.returned || 0),
    };
    const tabLabels = { '': '全部', unassigned: '待分配', assigned: '待领取', returned: '已退回' };
    $$('#intakeTabs button').forEach(item => {
      const status = item.dataset.intakeStatus;
      item.classList.toggle('active', status === state.intakeStatus);
      item.textContent = `${tabLabels[status]} ${tabCounts[status] || 0}`;
      item.classList.toggle('hidden', salesView && !['', 'assigned'].includes(status));
    });
    $('#intakeHeading').textContent = salesView ? '我的线索' : '线索池';
    $('#intakeSubheading').textContent = salesView
      ? `集中查看分配给你的线索；当前筛选共 ${intake.total ?? intake.items.length} 条，领取后进入 CRM 跟进。`
      : `当前筛选共 ${intake.total ?? intake.items.length} 条线索，可在同一页面查看资料并完成分配、领取、退回和重新分配。`;
    $('#intakeManagerActions').classList.toggle('hidden', salesView || !can('manage_intake'));
    $('#intakeBatchPanel').classList.toggle('hidden', salesView);
    const filterCount = activeIntakeFilterCount();
    $('#intakeFilterToggle').textContent = filterCount ? `详细筛选 ${filterCount}` : '详细筛选';
    $('#intakeModeLabel').classList.toggle('hidden', salesView);
    $('#intakeModeLabel').innerHTML = salesView
      ? ''
      : `<span class="intake-mode">${intake.settings.enabled ? '自动同步已启用' : '自动同步已停用'} · 手动分配不限条数</span>`;
    renderIntakeActiveFilters();
    const summary = intakeStatCards(salesView, stats, intake.settings);
    const activeStat = intakeActiveStatCard();
    $('#intakeSummary').innerHTML = summary.map(([key, label, value, note]) => `<button type="button" class="metric ${key === activeStat ? 'is-active' : ''} ${key === 'overdue' && value ? 'alert' : ''}" data-intake-stat="${key}" aria-pressed="${key === activeStat}" ${key === 'claimed' || key === 'contacted' || key === 'crm' ? 'data-intake-stat-crm="1"' : ''}><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`).join('');
    const items = intake.items || [];
    const canManualAssign = !salesView && can('manage_intake');
    const assignableItems = items.filter(intakeItemAssignable);
    const selectedVisibleCount = state.intakeSelectAllScope
      ? assignableItems.length
      : assignableItems.filter(item => state.selectedIntakeIds.has(item.id)).length;
    renderIntakeAssignmentBar();
    const showAI = customerAIEnabled();
    const showAssignmentAI = showAI && !salesView;
    const intakeHeaders = [
      '线索资料 / 客户标签',
      ...(showAI ? ['Fit / readiness / 优先级'] : []),
      ...(showAssignmentAI ? ['候选销售排名'] : []),
      '联系质量 / 联系人',
      salesView ? '负责人' : '负责人 / 阻断原因',
      '状态 / 时限',
      '操作',
    ];
    if (canManualAssign) {
      intakeHeaders.unshift('<span class="intake-select-cell"><input id="selectVisibleIntake" type="checkbox" aria-label="选择当前页可分配线索"></span>');
    }
    $('#intakeTable').innerHTML = table(
      intakeHeaders,
      items.map(item => {
        let actions = '';
        if (salesView && item.status === 'assigned' && !item.claimBlocked && !item.identityWarning) actions = `<div class="assignment-actions"><button class="button primary tiny" data-intake-action="claim" data-item-id="${item.id}" data-idempotency-key="${esc(proposalRequestId())}">领取客户</button><button class="button secondary tiny" data-intake-action="return" data-item-id="${item.id}">退回</button><button class="text-button" data-intake-action="reject" data-item-id="${item.id}">不对口</button></div>`;
        else if (salesView && item.status === 'assigned') actions = `<div class="assignment-actions"><span class="pill amber">管理员确认中</span><button class="button secondary tiny" data-intake-action="return" data-item-id="${item.id}">退回</button></div>`;
        else if (!salesView && intakeItemAssignable(item)) actions = '—';
        // Resolved link_existing identity conflicts keep assignable=false and a
        // linked master; surface the master entry before the identity-review
        // branch so a resolved link never shows a "needs review" action.
        else if (item.linkedMasterExternalId) actions =
          `<button class="text-button" data-open-customer="${item.linkedMasterExternalId}">查看已关联客户</button>`;
        // Identity-review branch: the backend marks these items with the boolean
        // assignable=false (plus identityWarning/claimBlocked), so this must run
        // after the assignable branch above and before the plain assigned row.
        else if (!salesView && intakeNeedsIdentityReview(item)) actions = `<div class="assignment-actions">${intakeReviewActionMarkup(item)}</div>`;
        else if (!salesView && item.status === 'assigned' && !item.claimBlocked && !item.identityWarning) actions = `<div class="assignment-actions"><button class="text-button" data-intake-assign="${item.id}">重新分配</button><button class="text-button danger-text" data-intake-unassign="${item.id}">取消分配</button></div>`;
        else if (!salesView && item.status === 'assigned') actions = '<span class="pill amber">管理员确认中</span>';
        else if (!salesView && item.status === 'claimed') actions = item.crm_customer_id
          ? `<button class="text-button" data-open-customer="${item.crm_customer_id}">查看 CRM 客户</button>`
          : '—';
        else if (item.duplicate_state === 'exact' && item.crm_customer_id) actions =
          `<button class="text-button" data-open-customer="${item.crm_customer_id}">查看已关联客户</button>`;
        else if (item.status === 'returned' && item.crm_customer_id) actions =
          `<button class="text-button" type="button" data-returned-history="${esc(item.crm_customer_id)}">查看开发历史</button>`;
        else actions = '—';
        const signals = intakeSignals(item);
        const layers = showAssignmentAI ? intakeDecisionLayers(item) : null;
        const evidence = jsonList(item.evidence_urls).filter(url => /^https?:\/\//i.test(url));
        const sources = [
          item.report_url ? `<a class="text-button" href="${esc(item.report_url)}" target="_blank" rel="noopener">背调报告</a>` : '',
          ...evidence.map((url, index) => `<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener">证据${index + 1}</a>`),
        ].filter(Boolean).join(' · ');
        const customerTags = (Array.isArray(item.customerTags) ? item.customerTags : [])
          .concat((Array.isArray(item.customer_tags) ? item.customer_tags
            : jsonList(item.customer_tags_json || item.customer_tags || item.tags_json || '[]'))
            .map(tag => typeof tag === 'object' ? tag : { name: tag, category: '客户标签', isPreset: false }));
        const website = websiteMarkup(item.website);
        const productSummary = productChipMarkup(item.product_focus || item.potential_demand);
        const contactCompleteness = item.contact_name && item.contact_methods
          ? '具名联系人与联系方式完备'
          : item.contact_name ? '已有具名联系人，联系方式待补齐' : '具名联系人与联系方式待补齐';
        const blockCopy = intakeBlockStatusLabel(item);
        const assignmentBlock = blockCopy
          || (item.assignable === false
            ? (item.assignmentBlockReason || item.decision_reason || (showAI ? signals.riskStatus : '') || '')
            : '');
        const businessColumns = [
          `<div class="company-cell"><strong class="tp-company-anchor">${esc(accountDisplayName(item))}</strong><span>${esc(accountIdentity(item))}${accountIdentity(item) ? ' · ' : ''}${esc([item.country, item.city].filter(Boolean).join(' / ') || '地区未标注')}</span>${item.identityWarning?.active ? `<span><span class="pill amber">${esc(item.identityWarning.label || '名称待核验')}</span> <span class="subtle">${esc(item.identityWarning.message || '疑似同名线索，进入 CRM 前需管理员核验')}</span></span>` : ''}<span>${website}</span><span>${esc([item.industry, item.customer_type].filter(Boolean).join(' · ') || '行业 / 类型未标注')}</span>${productSummary}${sourceTagMarkup({ customer_type: item.customer_type, industry: item.industry, customerTags }, 4)}<span>${sources || '暂无来源证据'} · 批次 ${esc(item.batch_id || '—')} · 更新 ${esc(shortDate(item.updated_at, true))}</span></div>`,
          `<div class="intake-contact"><strong><span class="pill ${item.contact_level === 'L3' ? '' : item.contact_level === 'L2' ? 'amber' : 'gray'}">${esc(item.contact_level || 'L0')}</span> ${esc(item.contact_name || '暂无具名联系人')}</strong><span>${esc(item.contact_title || '')}</span><span>${esc(item.contact_methods || '需要继续寻找联系方式')}</span><span>${esc(contactCompleteness)}</span></div>`,
          `<div class="decision-stack"><strong>${esc(item.assigned_owner_name || '待手动分配')}</strong>${salesView || !assignmentBlock ? '' : `<span class="decision-block">${esc(assignmentBlock)}</span>`}</div>`,
          `<div class="assignment-cell">${statusMarkup(item.status, { [item.status]: intakeStatusDisplay(item).label })}${item.reviewVagueHint ? `<span class="pill amber">${esc(item.reviewVagueHint)}</span>` : ''}${item.developmentHistory ? `<span class="pill amber">曾开发</span>` : ''}<span class="${item.status === 'assigned' && item.claim_due_at < state.data.generatedAt ? 'overdue-text' : 'subtle'}">${item.claim_due_at ? `领取截止 ${shortDate(item.claim_due_at, true)}` : esc(item.return_reason || '')}</span>${item.crm_assignment_status ? `<span class="subtle">CRM：${esc(item.crm_assignment_status === 'claimed' ? '已领取' : item.crm_assignment_status === 'assigned' ? '待领取' : item.crm_assignment_status === 'returned' ? '已退回' : item.crm_assignment_status)}</span>` : ''}</div>`,
          actions,
        ];
        const aiColumns = [
          `<div class="intake-signal-cell"><div><span class="score-badge">${esc(signals.fitScore)}</span><span class="pill">${esc(signals.fitGrade)}</span></div><span>${esc(signals.readiness)} · 优先级 ${esc(signals.priority)}</span>${signals.fitConfidence == null ? '' : `<small>Fit置信度 ${(signals.fitConfidence * 100).toFixed(0)}%</small>`}</div>`,
          ...(showAssignmentAI ? [`<div class="ranked-candidates">${layers.ai}</div>`] : []),
        ];
        const row = showAI
          ? [businessColumns[0], ...aiColumns, ...businessColumns.slice(1)]
          : businessColumns;
        if (canManualAssign) {
          row.unshift(intakeItemAssignable(item)
            ? `<span class="intake-select-cell"><input type="checkbox" data-select-intake="${esc(item.id)}" ${state.intakeSelectAllScope || state.selectedIntakeIds.has(item.id) ? 'checked' : ''} aria-label="选择 ${esc(accountDisplayName(item))}"></span>`
            : '');
        }
        row._attrs = `data-intake-profile="${esc(item.id)}"`;
        return row;
      }),
    );
    applyTableColumnClasses($('#intakeTable'), [
      canManualAssign ? 'col-check' : '',
      'col-company',
      ...(showAI ? ['col-fit'] : []),
      ...(showAssignmentAI ? ['col-candidates'] : []),
      'col-contact', 'col-owner', 'col-status', 'col-actions',
    ]);
    if (!items.length) $('#intakeTable').innerHTML = '<div class="empty">暂无符合条件的线索</div>';
    const selectVisible = $('#selectVisibleIntake');
    if (selectVisible) {
      selectVisible.checked = Boolean(assignableItems.length)
        && selectedVisibleCount === assignableItems.length;
      selectVisible.indeterminate = !state.intakeSelectAllScope && selectedVisibleCount > 0
        && selectedVisibleCount < assignableItems.length;
      selectVisible.disabled = !assignableItems.length;
      selectVisible.title = assignableItems.length
        ? '选择当前页可分配线索'
        : '当前页没有可分配线索';
    }
    $('#intakeBatchTable').innerHTML = table(
      ['日期', '来源', '候选', '入库', '已分配', '跳过', '状态'],
      intake.batches.map(batch => [
        esc(batch.batch_date), esc(batch.source), batch.candidate_count, batch.imported_count, batch.assigned_count, batch.skipped_count,
        `<span class="pill ${batch.status === 'done' ? '' : 'amber'}">${batch.status === 'done' ? '完成' : batch.status}</span>`,
      ]),
    );
  }

  function customerProfileFrameUrl(externalCustomerId, intakeItemId = '') {
    const intakeParam = intakeItemId ? `&intake=${encodeURIComponent(intakeItemId)}` : '';
    return `/development-workbench?embedded=1&profile=1&assistant=0&prospect=0&customer=${encodeURIComponent(externalCustomerId)}${intakeParam}`;
  }

  function reloadCustomerProfileFrame() {
    if (state.view !== 'customerProfile' || !state.customerProfileExternalId) return;
    $('#customerProfileFrame').src = customerProfileFrameUrl(
      state.customerProfileExternalId,
      state.customerProfileIntakeItemId,
    );
  }

  function openCustomerProfile(externalCustomerId) {
    if (!externalCustomerId) return toast('缺少客户编码，无法打开完整资料');
    const account = state.data.accounts.find(item => item.external_customer_id === externalCustomerId);
    if (!account) return toast('未找到对应客户资料');
    if (state.view !== 'customerProfile') state.customerProfileReturnView = state.view;
    state.customerProfileExternalId = externalCustomerId;
    state.customerProfileIntakeItemId = '';
    state.customerProfileReadOnly = false;
    state.customerProfileLead = null;
    state.selectedCustomerId = account.id;
    state.customerAiPollCount = 0;
    state.customerEnrichment = null;
    state.customerEnrichmentLastSuccess = null;
    state.customerEnrichmentError = '';
    closeDrawer();
    switchView('customerProfile');
    renderCustomerProfileHeader();
    const frame = $('#customerProfileFrame');
    frame.src = customerProfileFrameUrl(externalCustomerId);
    const url = new URL(location.href);
    url.searchParams.set('customer', externalCustomerId);
    url.searchParams.delete('intake');
    url.hash = 'customerProfile';
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    const station = $('#customerAiStation');
    station?.classList.toggle('hidden', !customerAIEnabled());
    if (customerAIEnabled()) void loadCustomerAI(externalCustomerId);
  }

  async function openIntakeMasterProfile(itemId, fallbackExternalId = '') {
    let item = state.data.intake?.items?.find(row => String(row.id) === String(itemId))
      || (fallbackExternalId ? {
        id: itemId,
        external_customer_id: fallbackExternalId,
        company_name: fallbackExternalId,
        customerTags: [],
      } : null);
    if (!item) {
      try {
        const profile = await api(`/api/sales-crm/intake/${encodeURIComponent(itemId)}/profile`);
        const pool = profile.customerPool?.[0];
        item = pool ? {
          id: itemId,
          external_customer_id: pool.customerId,
          company_name: pool.companyName,
          nickname: pool.nickname || '',
          customer_type: pool.customerType,
          industry: pool.industry,
          customerTags: pool.tags || [],
          identityWarning: profile.identityWarning || null,
          in_crm: Boolean(profile.profileAccess?.inCrm),
          can_edit_nickname: Boolean(profile.profileAccess?.canEditNickname),
          profileAccess: profile.profileAccess || null,
        } : null;
      } catch (error) {
        if (state.view === 'customerProfile' && !state.customerProfileExternalId) {
          switchView(firstAllowedBusinessView(), false);
        }
        return toast(error.message || '当前线索不在可见范围内，无法打开完整资料');
      }
    }
    if (!item) return toast('该线索未关联可用的客户主档');
    const externalCustomerId = String(item.external_customer_id || fallbackExternalId || '').trim();
    if (!externalCustomerId) return toast('该线索未关联客户主档，暂时无法查看完整资料');
    const account = state.data.accounts.find(row => row.external_customer_id === externalCustomerId);
    if (account) return openCustomerProfile(externalCustomerId);
    const adminMasterAccess = state.data.user?.role === 'admin' && !state.data.impersonation;
    let master = null;
    if (adminMasterAccess) {
      try {
        const profile = await api(`/api/sales-crm/intake/${encodeURIComponent(itemId)}/profile`);
        master = profile.customerPool?.[0] || null;
        if (master) {
          item = {
            ...item,
            company_name: master.companyName || item.company_name,
            nickname: master.nickname || item.nickname || '',
            customer_type: master.customerType,
            industry: master.industry,
            customerTags: master.tags || item.customerTags || [],
            identityWarning: profile.identityWarning || item.identityWarning || null,
            in_crm: Boolean(profile.profileAccess?.inCrm),
            can_edit_nickname: Boolean(profile.profileAccess?.canEditNickname),
            profileAccess: profile.profileAccess || null,
          };
        }
      } catch (error) {
        return toast(error.message || '客户主档读取失败');
      }
    }
    if (state.view !== 'customerProfile') state.customerProfileReturnView = state.view;
    state.customerProfileExternalId = externalCustomerId;
    state.customerProfileIntakeItemId = String(item.id || itemId);
    state.customerProfileReadOnly = !adminMasterAccess;
    state.customerProfileLead = item;
    state.customerProfileMaster = master;
    state.selectedCustomerId = '';
    state.customerAiPollCount = 0;
    state.customerAi = null;
    state.customerAiError = '';
    state.customerEnrichment = null;
    state.customerEnrichmentLastSuccess = null;
    state.customerEnrichmentError = '';
    closeDrawer();
    switchView('customerProfile');
    renderCustomerProfileHeader();
    $('#customerProfileFrame').src = customerProfileFrameUrl(externalCustomerId, state.customerProfileIntakeItemId);
    const url = new URL(location.href);
    url.searchParams.set('customer', externalCustomerId);
    url.searchParams.set('intake', state.customerProfileIntakeItemId);
    url.hash = 'customerProfile';
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    $('#customerAiStation')?.classList.add('hidden');
  }

  function renderCustomerProfileHeader() {
    const account = state.data?.accounts?.find(item => item.id === state.selectedCustomerId);
    const lead = state.customerProfileLead;
    if (!account && !lead) return;
    const adminMasterAccess = !account
      && state.data.user?.role === 'admin'
      && !state.data.impersonation;
    const readOnly = state.customerProfileReadOnly || (!account && !adminMasterAccess);
    const leadInCrm = Boolean(
      lead?.in_crm
      || lead?.crm_customer_id
      || lead?.profileAccess?.inCrm
    );
    const profileCustomer = account || lead;
    $('#customerProfileTitle').textContent = accountDisplayName(profileCustomer) || '客户资料';
    $('#customerProfileIdentity').textContent = account
      ? accountIdentity(account)
      : lead?.nickname
        ? `${accountIdentity(lead)} · ${adminMasterAccess ? '管理员主档全权限' : leadInCrm
          ? '已进入 CRM · 当前范围只读'
          : '尚未进入 CRM · 线索主档'}`
      : adminMasterAccess
        ? `${state.customerProfileExternalId} · 管理员主档全权限`
        : `${state.customerProfileExternalId} · ${leadInCrm
        ? '已进入 CRM · 当前范围只读'
        : '尚未进入 CRM · 线索主档只读'}`;
    $('#customerProfileTags').innerHTML = sourceTagMarkup(account || {
      customer_type: lead?.customer_type,
      industry: lead?.industry,
      customerTags: lead?.customerTags || [],
    });
    if (lead?.identityWarning?.active) {
      $('#customerProfileTags').insertAdjacentHTML(
        'beforeend',
        `<span class="pill amber">${esc(lead.identityWarning.label || '名称待核验')}</span>`,
      );
    }
    $('#customerProfileActivity').classList.toggle('hidden', readOnly || !account || !can('record_activity'));
    $('#customerProfileDataEdit').classList.toggle('hidden', readOnly || !can('edit_customer'));
    $('#customerAiStation')?.classList.toggle('hidden', readOnly || !account || !customerAIEnabled());
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
    state.customerProfileIntakeItemId = '';
    state.customerProfileReadOnly = false;
    state.customerProfileLead = null;
    state.customerProfileMaster = null;
    const url = new URL(location.href);
    url.searchParams.delete('customer');
    url.searchParams.delete('intake');
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
  const SALES_COACHING_MAX_POLLS = 72;
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
    if (!customerEnrichmentEnabled()) return '';
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
    if (!salesPackEnabled()) return '';
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
    const markup = `<section class="next-action-suggestion">
      <div class="sales-pack-title"><strong>下一步建议</strong><span class="pill ${status[1]}">${esc(status[0])}</span><small>置信度 ${Math.round(Number(value.confidence || 0) * 100)}%</small></div>
      <p>${esc(value.reason || '')}</p>
      <div class="next-action-suggestion-fields">
        <label>下一步动作<input id="nextActionSuggestion" value="${esc(value.nextAction || '')}" ${editable ? '' : 'readonly'}></label>
        <label>计划时间<input id="nextActionSuggestionAt" type="datetime-local" data-future-datetime value="${esc(suggestedPlanDateInput(value.nextActionAt))}" ${editable ? '' : 'readonly'}></label>
        <label class="check"><input id="nextActionSuggestionManager" type="checkbox" ${value.managerRequired ? 'checked' : ''} ${editable ? '' : 'disabled'}> 需要主管协助</label>
      </div>
      ${editable ? `<div class="next-action-suggestion-actions"><button class="button primary tiny" type="button" data-adopt-next-action="${esc(job.id)}">采纳下一步建议</button><span>采纳前可编辑；不会自动修改客户。</span></div>` : ''}
    </section>`;
    queueMicrotask(() => {
      const input = $('#nextActionSuggestionAt');
      setFutureDateTimeConstraint(input);
      if (input && !input.readOnly) validateFutureDateTime(input);
    });
    return markup;
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
    const enrichment = customerEnrichmentEnabled()
      ? state.customerEnrichment || state.customerEnrichmentLastSuccess
      : null;
    actions.innerHTML = [
      nextActionJob ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(nextActionJob.id)}">下一步任务</button>` : '',
      salesPackEnabled() && salesPackJob ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(salesPackJob.id)}">资料包任务</button>` : '',
      job ? `<button class="button secondary tiny" type="button" data-open-ai-task="${esc(job.id)}">评分任务</button>` : '',
    ].join('');
    if (state.customerAiLoading && !payload && !enrichment) {
      body.innerHTML = '<span class="subtle">正在读取评分与资料补全状态…</span>';
      return;
    }
    const result = payload?.result;
    const canRun = can('use_ai_assistant') && !state.data?.impersonation;
    const canRunSalesPack = canRun && salesPackEnabled() && ['view_contacts', 'view_recon'].every(can);
    const canStartEnrichment = canRun && customerEnrichmentEnabled()
      && ['run_recon', 'view_recon', 'view_contacts'].every(can);
    const run = enrichment?.run;
    if (canStartEnrichment && (!run || ENRICHMENT_TERMINAL_STATES.has(run.state))) {
      actions.insertAdjacentHTML('afterbegin', `<button class="button secondary tiny" type="button" data-retry-enrichment ${state.customerEnrichmentPending ? 'disabled' : ''}>${run ? '重新补全' : '开始补全'}</button>`);
    }
    if (customerEnrichmentEnabled() && run && !ENRICHMENT_TERMINAL_STATES.has(run.state)
        && can('cancel_ai_tasks') && !state.data?.impersonation) {
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
    constrainFutureDateTimes(body);
  }

  function scheduleCustomerAIPoll() {
    clearTimeout(state.customerAiTimer);
    state.customerAiTimer = null;
    const fitPending = ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.job?.state);
    const salesPackPending = salesPackEnabled()
      && ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.salesPack?.job?.state);
    const nextActionPending = ['queued', 'running', 'retry_wait', 'cancel_requested'].includes(state.customerAi?.nextAction?.job?.state);
    const enrichmentState = customerEnrichmentEnabled()
      ? (state.customerEnrichment || state.customerEnrichmentLastSuccess)?.run?.state
      : '';
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
        customerEnrichmentEnabled()
          ? api(`/api/sales-crm/ai/customers/${encodeURIComponent(customerId)}/enrichment`)
          : Promise.resolve(null),
      ]);
      if (state.customerProfileExternalId !== customerId) return;
      if (fit.status === 'fulfilled') state.customerAi = fit.value;
      else state.customerAiError = fit.reason?.message || '评分读取失败';
      if (!customerEnrichmentEnabled()) {
        state.customerEnrichment = null;
        state.customerEnrichmentLastSuccess = null;
      } else if (enrichment.status === 'fulfilled') {
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
    if (!customerEnrichmentEnabled() || !customerId || state.customerEnrichmentPending) return;
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
    if (!customerEnrichmentEnabled() || !runId || state.customerEnrichmentPending) return;
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
    if (!customerEnrichmentEnabled() || !proposalId
        || !['accepted', 'rejected'].includes(decision) || state.customerEnrichmentPending) return;
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
    if (!customerAIEnabled() || !jobId || state.customerAiPending) return;
    const nextActionAtInput = $('#nextActionSuggestionAt');
    const nextAction = $('#nextActionSuggestion')?.value.trim() || '';
    if (!validateFutureDateTime(nextActionAtInput)) {
      return toast('下一步时间必须晚于当前时间');
    }
    const nextActionAt = apiTime(nextActionAtInput?.value || '');
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
    manager_evaluation: '客户经营复盘', manager_anomaly: '需主管关注', sales_coaching: '销售辅导', assistant_chat: '对话 AI',
  };

  const aiTaskStateLabels = {
    queued: '排队中', running: '执行中', retry_wait: '等待重试', needs_review: '待复核',
    succeeded: '已完成', failed: '失败', cancelled: '已取消', dead_letter: '失败待处理',
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
    renderPagination('#aiTaskPagination', 'ai_tasks', tasks, ({ page, pageSize }) => {
      state.aiTasks.pageSize = pageSize || state.aiTasks.pageSize;
      void loadAiTasks({ page: page || 1 });
    });
  }

  async function loadAiTasks({ reset = false, page } = {}) {
    if (!customerAIEnabled() || state.aiTasks.loading) return;
    const targetPage = reset ? 1 : Math.max(1, Number(page || state.aiTasks.page || 1));
    state.aiTasks.loading = true;
    renderAiTasks();
    try {
      const params = new URLSearchParams({
        page: targetPage,
        pageSize: state.aiTasks.pageSize,
        ...aiTaskFilters(),
      });
      const payload = await api(`/api/sales-crm/ai/tasks?${params}`);
      Object.assign(state.aiTasks, payload, { page: Number(payload.page || targetPage), loaded: true, error: '' });
    } catch (error) {
      state.aiTasks.error = error.message;
      toast(error.message);
    } finally {
      state.aiTasks.loading = false;
      renderAiTasks();
    }
  }

  function canGovernAI() {
    return customerAIEnabled()
      && ['admin', 'manager'].includes(state.data?.user?.role)
      && can('view_team') && can('review_ai_tasks') && !state.data?.impersonation;
  }

  const strategyStatusLabels = {
    shadow: '影子运行',
    pending_approval: '待批准',
    published: '已发布',
    retired: '可回滚',
  };

  function renderAiGovernance() {
    const panel = $('#aiGovernancePanel');
    if (!panel) return;
    const allowed = canGovernAI();
    panel.classList.toggle('hidden', !allowed);
    if (!allowed) return;
    const governance = state.aiGovernance;
    const metrics = governance.metrics || [];
    $('#aiGovernanceMetrics').innerHTML = metrics.length ? table(
      ['工作站', '模型', 'Prompt / 规则', '样本', '成交', '回复', '人工驳回'],
      metrics.map(item => [
        esc(aiTaskTypeLabels[item.station] || item.station),
        esc(item.model),
        `<div class="company-cell"><strong>${esc(item.promptVersion)}</strong><span>${esc(item.ruleVersion)}</span></div>`,
        item.total,
        `${Math.round(Number(item.winRate || 0) * 100)}%`,
        `${Math.round(Number(item.replyRate || 0) * 100)}%`,
        `${Math.round(Number(item.rejectionRate || 0) * 100)}%`,
      ]),
    ) : `<div class="empty">${governance.loading ? '正在加载指标…' : '暂无反馈样本'}</div>`;
    const strategies = governance.strategies || [];
    $('#aiGovernanceStrategies').innerHTML = strategies.length ? table(
      ['策略 / 版本', '模型', 'Prompt / 规则', '状态', '影子样本', '操作'],
      strategies.map(item => {
        const actions = [
          item.status === 'shadow'
            ? `<button class="button secondary tiny" data-strategy-evaluate="${esc(item.id)}">记录影子结果</button>` : '',
          item.status === 'shadow' && item.evaluationCount > 0
            ? `<button class="button primary tiny" data-strategy-action="request-publish" data-strategy-id="${esc(item.id)}">申请发布</button>` : '',
          item.status === 'pending_approval'
            ? `<button class="button primary tiny" data-strategy-action="approve" data-strategy-id="${esc(item.id)}">批准发布</button>` : '',
          item.status === 'retired'
            ? `<button class="button secondary tiny" data-strategy-action="rollback" data-strategy-id="${esc(item.id)}">回滚到此版本</button>` : '',
        ].filter(Boolean).join('');
        return [
          `<div class="company-cell"><strong>${esc(item.strategyKey)}</strong><span>${esc(item.version)}</span></div>`,
          esc(item.model),
          `<div class="company-cell"><strong>${esc(item.promptVersion)}</strong><span>${esc(item.ruleVersion)}</span></div>`,
          `<span class="pill">${esc(strategyStatusLabels[item.status] || item.status)}</span>`,
          item.evaluationCount,
          `<div class="top-actions">${actions || '—'}</div>`,
        ];
      }),
    ) : `<div class="empty">${governance.loading ? '正在加载版本…' : '暂无策略版本'}</div>`;
  }

  async function loadAiGovernance() {
    if (!canGovernAI() || state.aiGovernance.loading) return;
    state.aiGovernance.loading = true;
    renderAiGovernance();
    try {
      const payload = await api('/api/sales-crm/ai/governance');
      Object.assign(state.aiGovernance, payload, { loaded: true, error: '' });
    } catch (error) {
      state.aiGovernance.error = error.message;
      toast(error.message);
    } finally {
      state.aiGovernance.loading = false;
      renderAiGovernance();
    }
  }

  function openStrategyModal() {
    openModal('新建影子版本', 'AI VERSION GOVERNANCE', `<form id="aiStrategyForm" class="form-grid two">
      <label>策略键<input name="strategyKey" required placeholder="customer-fit-default"></label>
      <label>版本<input name="version" required placeholder="2026.07.1"></label>
      <label>工作站<select name="station"><option value="customer_fit">客户匹配</option><option value="contact_readiness">联系人就绪</option><option value="distribution_priority">分配优先级</option><option value="manager_anomaly">需主管关注</option><option value="sales_coaching">销售辅导</option></select></label>
      <label>模型<input name="model" required value="qwen3.7-flash"></label>
      <label>Prompt 版本<input name="promptVersion" required value="v1"></label>
      <label>规则版本<input name="ruleVersion" required value="v1"></label>
      <label class="span-2">配置 JSON<textarea name="configJson">{}</textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">创建影子版本</button></div>
    </form>`);
  }

  function openShadowEvaluationModal(strategyId) {
    openModal('记录影子结果', 'SHADOW EVALUATION', `<form id="aiShadowEvaluationForm" class="form-grid">
      <input type="hidden" name="strategyId" value="${esc(strategyId)}">
      <label>对照结果<select name="outcome"><option value="better">更好</option><option value="same">相同</option><option value="worse">更差</option><option value="inconclusive">样本不足</option></select></label>
      <label>指标 JSON<textarea name="metricsJson">{}</textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存影子结果</button></div>
    </form>`);
  }

  async function recordAiFeedback(jobId) {
    const label = $('#aiFeedbackLabel')?.value || '';
    if (!label) return toast('请选择结果标签');
    await api(`/api/sales-crm/ai/jobs/${encodeURIComponent(jobId)}/feedback`, {
      method: 'POST',
      body: JSON.stringify({
        label,
        note: $('#aiFeedbackNote')?.value || '',
        idempotencyKey: `feedback:${jobId}:${label}:${crypto.randomUUID()}`,
      }),
    });
    closeModal();
    await loadAiGovernance();
    toast('结果标签已保存');
  }

  async function strategyAction(action, strategyId) {
    await api(`/api/sales-crm/ai/governance/strategies/${encodeURIComponent(strategyId)}/${action}`, {
      method: 'POST',
      body: '{}',
    });
    await loadAiGovernance();
    toast(action === 'approve' ? '版本已批准发布' : action === 'rollback' ? '旧版本已恢复' : '已提交发布审批');
  }

  function renderAiTaskDetail(task) {
    const attempts = (task.attempts || []).map(item => `<li><strong>第 ${item.attempt || '—'} 次 · ${esc(item.engine || '—')} / ${esc(item.model || '—')}</strong><span>${esc(item.status ?? (item.ok ? 'succeeded' : 'failed'))} · ${Number(item.durationMs || 0)} ms · $${Number(item.cost || 0).toFixed(4)}</span>${item.errorSummary || item.error ? `<small>${esc(item.errorSummary || item.error)}</small>` : ''}</li>`).join('');
    const timeline = (task.timeline || []).map(item => `<li><strong>${esc(item.kind)}</strong><span>${esc(item.state || '')}</span><time>${shortDate(item.at, true)}</time></li>`).join('');
    const canMutateAITasks = !state.data?.impersonation;
    const actions = [
      canMutateAITasks && task.canRetry && can('use_ai_assistant') ? `<button class="button secondary" data-ai-task-action="retry" data-job-id="${esc(task.taskId)}">重试</button>` : '',
      canMutateAITasks && task.canCancel && can('cancel_ai_tasks') ? `<button class="button secondary" data-ai-task-action="cancel" data-job-id="${esc(task.taskId)}">取消</button>` : '',
      canMutateAITasks && task.canReview && can('review_ai_tasks') ? `<textarea id="aiTaskReviewSummary" placeholder="复核说明（最多 500 字）"></textarea><button class="button primary" data-ai-task-action="approved" data-job-id="${esc(task.taskId)}">通过复核</button><button class="button danger" data-ai-task-action="rejected" data-job-id="${esc(task.taskId)}">退回</button>` : '',
    ].join('');
    const feedback = canGovernAI() && task.source === 'ai_station'
      ? `<section class="ai-feedback-form"><h3>结果标签</h3><div class="form-grid two">
        <label>标签<select id="aiFeedbackLabel"><option value="">请选择</option><option value="won">成交</option><option value="replied">回复</option><option value="returned">退回</option><option value="stalled">停滞</option><option value="human_rejected">人工驳回</option></select></label>
        <label>备注<input id="aiFeedbackNote" maxlength="500"></label>
        <div class="form-actions"><button class="button secondary" type="button" data-ai-feedback="${esc(task.taskId)}">保存标签</button></div>
      </div></section>` : '';
    const trace = task.decisionTrace;
    const decisionTrace = trace ? `<section><h3>决策版本与证据</h3>
      <div class="ai-task-detail-grid">
        <div><span>工作站版本</span><strong>${esc(trace.stationVersion || '—')}</strong></div>
        <div><span>模型</span><strong>${esc(trace.model || '—')}</strong></div>
        <div><span>Prompt 版本</span><strong>${esc(trace.promptVersion || '—')}</strong></div>
        <div><span>Schema 版本</span><strong>${esc(trace.schemaVersion || '—')}</strong></div>
        <div><span>规则版本</span><strong>${esc(trace.ruleVersion || '—')}</strong></div>
        <div><span>策略版本</span><strong>${esc(trace.strategyVersion || '未关联')}</strong></div>
        <div><span>生成时间</span><strong>${trace.generatedAt ? shortDate(trace.generatedAt, true) : '—'}</strong></div>
        <div><span>有效状态</span><strong>${trace.stale ? '已过期' : '有效'}</strong></div>
      </div>
      <div class="ai-task-trace-values"><span>上下文指纹</span><code>${esc(trace.contextHash || '—')}</code></div>
      <div class="ai-task-trace-values"><span>证据 ID</span><code>${esc((trace.evidenceIds || []).join('、') || '无')}</code></div>
      ${trace.stale ? `<div class="customer-ai-error"><strong>过期原因</strong><span>${esc(trace.staleReason || '上下文已变化')}</span></div>` : ''}
    </section>` : '';
    openModal('AI 任务详情', 'AI 任务中心', `<div class="ai-task-detail">
      <div class="ai-task-detail-grid"><div><span>任务 ID</span><strong>${esc(task.taskId)}</strong></div><div><span>类型</span><strong>${esc(aiTaskTypeLabels[task.taskType] || task.taskType)}</strong></div><div><span>客户</span><strong>${esc(task.customerId || '工作区')}</strong></div><div><span>状态</span><strong>${esc(aiTaskStateLabels[task.state] || task.state)}</strong></div></div>
      ${task.errorSummary ? `<div class="customer-ai-error"><strong>错误</strong><span>${esc(task.errorSummary)}</span></div>` : ''}
      <section><h3>模型尝试</h3><ul class="ai-task-events">${attempts || '<li>无模型尝试记录</li>'}</ul></section>
      ${decisionTrace}
      <section><h3>时间线</h3><ul class="ai-task-events">${timeline || '<li>无时间线记录</li>'}</ul></section>
      ${task.result ? `<section><h3>结构化结果</h3><pre>${esc(JSON.stringify(task.result.value || {}, null, 2))}</pre></section>` : ''}
      ${feedback}
      ${actions ? `<div class="ai-task-detail-actions">${actions}</div>` : ''}
    </div>`);
  }

  async function openAiTask(taskId) {
    if (!customerAIEnabled()) return;
    try {
      const payload = await api(`/api/sales-crm/ai/tasks/${encodeURIComponent(taskId)}`);
      renderAiTaskDetail(payload.task);
    } catch (error) { toast(error.message); }
  }

  async function actOnAiTask(action, jobId) {
    if (!customerAIEnabled()) return;
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

  function crmTime(value) {
    if (!value) return 0;
    const time = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z')).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  function creatorDisplayName(account) {
    if (String(account?.created_by || '') === 'system') return '系统导入';
    if (account?.creator_name) return account.creator_name;
    return '历史数据/未知';
  }
  function matchesTimeBuckets(value, buckets, kind) {
    if (!buckets.length) return true;
    const time = crmTime(value);
    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const tomorrow = start.getTime() + 86400000;
    return buckets.some(bucket => {
      if (bucket === 'none') return !time;
      if (!time) return false;
      if (kind === 'last') {
        if (bucket === 'today') return time >= start.getTime();
        if (bucket === '7d') return time >= now - 7 * 86400000;
        if (bucket === '30d') return time >= now - 30 * 86400000;
        if (bucket === 'older') return time < now - 30 * 86400000;
      } else {
        if (bucket === 'overdue') return time < now;
        if (bucket === 'today') return time >= start.getTime() && time < tomorrow;
        if (bucket === '7d') return time >= tomorrow && time < now + 7 * 86400000;
        if (bucket === 'later') return time >= now + 7 * 86400000;
      }
      return false;
    });
  }
  function customerSearchText(account) {
    const labels = customerAIEnabled() ? labelsForAccount(account.id) : [];
    const contactText = can('view_contacts')
      ? (state.data.insights?.contacts || [])
        .filter(contact => (contact.customerId || contact.customer_id) === account.id)
        .flatMap(contact => [contact.name, contact.title, contact.phone, contact.email, contact.social])
      : [];
    return [
      account.nickname, account.company_name, account.id, account.external_customer_id, account.country, account.city,
      account.industry, account.product_focus, account.customer_type, account.source, account.website,
      account.owner_name, account.creator_name, ...labels, ...contactText,
    ].join(' ').toLowerCase();
  }
  function filteredCustomerAccounts() {
    const filters = state.customerFilters;
    const keywords = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
    const stageOrder = Object.fromEntries(state.data.stages.map((item, index) => [item.key, index]));
    const terminalStages = new Set(['won', 'repeat', 'lost', 'disqualified']);
    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const tomorrow = start.getTime() + 86400000;
    const accounts = scopedAccounts().filter(account => {
      const labels = customerAIEnabled() ? labelsForAccount(account.id) : [];
      const text = customerSearchText(account);
      const reached = !state.stageReached
        || (!['lost', 'disqualified'].includes(account.stage) && stageOrder[account.stage] >= stageOrder[state.stageReached]);
      const nextAt = crmTime(account.next_action_at);
      const quickMatches = filters.quickView === 'all'
        || (filters.quickView === 'mine' && account.owner_id === state.data.user.id)
        || (filters.quickView === 'unassigned' && !account.owner_id)
        || (filters.quickView === 'today' && nextAt >= start.getTime() && nextAt < tomorrow)
        || (filters.quickView === 'overdue' && !terminalStages.has(account.stage) && nextAt && nextAt < now)
        || (filters.quickView === 'no_next' && !terminalStages.has(account.stage) && !account.next_action)
        || (filters.quickView === 'disqualified' && account.stage === 'disqualified');
      const created = String(account.created_at || '').slice(0, 10);
      return keywords.every(keyword => text.includes(keyword)) && reached && quickMatches
        && (!filters.countries.length || filters.countries.includes(account.country))
        && (!filters.owners.length || filters.owners.includes(account.owner_id || '__unassigned__'))
        && (!filters.stages.length || filters.stages.includes(account.stage))
        && (!filters.priorities.length || filters.priorities.includes(account.priority))
        && (!filters.customerTypes.length || filters.customerTypes.includes(account.customer_type))
        && (!filters.industries.length || filters.industries.includes(account.industry))
        && (!filters.sources.length || filters.sources.includes(account.source))
        && (!filters.creators.length || filters.creators.includes(account.created_by))
        && (!customerAIEnabled() || !filters.evaluationTags.length || filters.evaluationTags.some(tag => labels.includes(tag)))
        && matchesTimeBuckets(account.last_activity_at, filters.lastActionBuckets, 'last')
        && matchesTimeBuckets(account.next_action_at, filters.nextStepBuckets, 'next')
        && (!filters.createdFrom || created >= filters.createdFrom)
        && (!filters.createdTo || created <= filters.createdTo);
    });
    const compareText = (left, right) => String(left || '').localeCompare(String(right || ''), 'zh-CN');
    return accounts.sort((left, right) => {
      if (filters.sort === 'oldest_activity') return crmTime(left.last_activity_at) - crmTime(right.last_activity_at) || compareText(left.id, right.id);
      if (filters.sort === 'recent_progress') return crmTime(right.last_activity_at) - crmTime(left.last_activity_at) || compareText(left.id, right.id);
      if (filters.sort === 'newest') return crmTime(right.created_at) - crmTime(left.created_at) || compareText(left.id, right.id);
      if (filters.sort === 'company') return compareText(accountDisplayName(left), accountDisplayName(right)) || compareText(left.id, right.id);
      const leftNext = crmTime(left.next_action_at) || Number.MAX_SAFE_INTEGER;
      const rightNext = crmTime(right.next_action_at) || Number.MAX_SAFE_INTEGER;
      return leftNext - rightNext || compareText(left.id, right.id);
    });
  }

  function renderCustomerActiveFilters() {
    const root = $('#customerActiveFilters');
    if (!root) return;
    const filters = state.customerFilters;
    const stageLabels = Object.fromEntries(state.data.stages.map(item => [item.key, item.label]));
    const userLabels = Object.fromEntries(state.data.users.map(item => [item.id, item.name]));
    const quickLabels = { mine: '我负责的', unassigned: '未分配', today: '今天跟进', overdue: '已超期', no_next: '无下一步', disqualified: '确认不对口' };
    const chips = [];
    if (filters.search) chips.push(['search', '', `搜索：${filters.search}`]);
    if (filters.quickView !== 'all') chips.push(['quickView', '', quickLabels[filters.quickView] || filters.quickView]);
    const groups = {
      countries: ['国家', {}], owners: ['负责人', { __unassigned__: '未分配', ...userLabels }],
      stages: ['阶段', stageLabels], priorities: ['优先级', {}], customerTypes: ['客户类型', {}],
      industries: ['行业', {}], sources: ['来源', {}], creators: ['创建人', userLabels],
      ...(customerAIEnabled() ? { evaluationTags: ['评价标签', {}] } : {}),
      lastActionBuckets: ['最近动作', { today: '今天', '7d': '近7天', '30d': '近30天', older: '30天前', none: '无' }],
      nextStepBuckets: ['下一步', { overdue: '已超期', today: '今天', '7d': '未来7天', later: '7天以后', none: '未填写' }],
    };
    for (const [key, [label, labels]] of Object.entries(groups)) {
      filters[key].forEach(value => chips.push([key, value, `${label}：${labels[value] || value}`]));
    }
    if (filters.createdFrom) chips.push(['createdFrom', '', `创建自：${filters.createdFrom}`]);
    if (filters.createdTo) chips.push(['createdTo', '', `创建至：${filters.createdTo}`]);
    root.classList.toggle('hidden', !chips.length);
    root.innerHTML = chips.map(([key, value, label]) =>
      `<button type="button" data-remove-customer-filter="${esc(key)}" data-filter-value="${esc(value)}">${esc(label)} ×</button>`).join('')
      + (chips.length ? '<button type="button" class="clear-all" data-clear-customer-filters>清空全部</button>' : '');
  }
  function advancedCustomerFilterCount() {
    const filters = state.customerFilters;
    return [
      'countries', 'owners', 'stages', 'priorities', 'customerTypes', 'industries', 'sources',
      'creators', ...(customerAIEnabled() ? ['evaluationTags'] : []), 'lastActionBuckets', 'nextStepBuckets',
    ].reduce((count, key) => count + filters[key].length, 0)
      + (filters.createdFrom ? 1 : 0) + (filters.createdTo ? 1 : 0);
  }

  function canReturnCustomer(account) {
    if (!account || !can('manage_customer_recycle')) return false;
    if (String(account.lifecycle_status || 'active') !== 'active') return false;
    if (String(account.assignment_status || '') === 'returned') return false;
    return true;
  }

  function canRejectCustomer(account) {
    if (!account || (!can('manage_customer_recycle') && !can('reject_own_customer_mismatch'))) return false;
    if (String(account.lifecycle_status || 'active') !== 'active') return false;
    if (String(account.assignment_status || '') === 'returned') return false;
    return true;
  }

  function canBulkAssignCustomers() {
    return can('view_all_customers') && can('manage_intake') && can('edit_customer');
  }

  function canBulkReturnCustomers() {
    return can('manage_customer_recycle');
  }

  function canSelectCustomer(account) {
    return canBulkAssignCustomers() || (canBulkReturnCustomers() && canReturnCustomer(account));
  }

  function selectedVisibleCustomerIds(accounts = state.customerList.rows) {
    return accounts.filter(canSelectCustomer).map(account => account.id);
  }

  function selectedCustomersReturnEligible() {
    if (state.customerSelectionMode === 'filtered') {
      return customerSelectionCount() > 0 && canBulkReturnCustomers();
    }
    if (!state.selectedCustomerIds.size) return false;
    return [...state.selectedCustomerIds].every(customerId =>
      canReturnCustomer(state.data.accounts.find(account => account.id === customerId)));
  }

  function renderCustomers() {
    const accounts = state.customerList.loaded ? state.customerList.rows : [];
    renderPagination('#customerPagination', 'customers', state.customerList, change => {
      if (change.pageSize) state.customerList.pageSize = change.pageSize;
      void loadCustomerPage({ reset: false, page: change.page || 1 });
    });
    const visibleIds = new Set(accounts.map(account => account.id));
    if (state.customerSelectionMode !== 'filtered') {
      state.selectedCustomerIds = new Set([...state.selectedCustomerIds].filter(customerId => visibleIds.has(customerId)));
    }
    const canBulkAssign = canBulkAssignCustomers();
    const canBulkReturn = canBulkReturnCustomers();
    const canSelectCustomers = canBulkAssign || canBulkReturn;
    const selectionCount = customerSelectionCount();
    const selectableIds = selectedVisibleCustomerIds(accounts);
    const selectedVisibleCount = state.customerSelectionMode === 'filtered'
      ? selectableIds.length
      : selectableIds.filter(customerId => state.selectedCustomerIds.has(customerId)).length;
    $('#customerBulkBar')?.classList.toggle('hidden', !canSelectCustomers);
    $('#bulkAssignCustomers')?.classList.toggle('hidden', !canBulkAssign);
    $('#bulkReturnCustomers')?.classList.toggle('hidden', !canBulkReturn);
    if ($('#customerSelectionCount')) $('#customerSelectionCount').textContent = `已选择 ${selectionCount} 个客户`;
    const scopePrompt = $('#customerSelectionScopePrompt');
    if (scopePrompt) {
      const canOfferFiltered = state.customerSelectionMode === 'explicit'
        && selectableIds.length > 0
        && selectedVisibleCount === selectableIds.length
        && state.customerList.total > selectableIds.length;
      scopePrompt.classList.toggle('hidden', !canOfferFiltered && state.customerSelectionMode !== 'filtered');
      scopePrompt.innerHTML = state.customerSelectionMode === 'filtered'
        ? `已选择全部筛选结果 ${esc(selectionCount)} 条`
        : canOfferFiltered
          ? `已选择本页 ${esc(selectedVisibleCount)} 条，可选择全部筛选结果 ${esc(state.customerList.total)} 条 <button type="button" class="text-button" data-select-all-filtered-customers>选择全部</button>`
          : '';
    }
    if ($('#bulkAssignCustomers')) {
      $('#bulkAssignCustomers').disabled = !selectionCount;
      $('#bulkAssignCustomers').title = selectionCount ? '' : '请先勾选客户';
    }
    if ($('#bulkReturnCustomers')) {
      const returnEligible = selectedCustomersReturnEligible();
      $('#bulkReturnCustomers').disabled = !returnEligible;
      $('#bulkReturnCustomers').title = !selectionCount
        ? '请先勾选客户'
        : !returnEligible ? '仅当前仍在 CRM 且有退回权限的客户可退回' : '';
    }
    const reachedNote = state.stageReached ? ` · 漏斗累计达到“${stageLabel(state.stageReached)}”` : '';
    $('#customerResultCount').textContent = state.customerList.loading
      ? '正在读取授权结果…'
      : `当前 ${state.customerList.total} / 授权 ${state.customerList.authorizedTotal}${reachedNote}`;
    if ($('#customerExportBtn')) $('#customerExportBtn').disabled = accounts.length === 0;
    if (!state.customerList.loaded && state.customerList.loading) {
      $('#customerTable').innerHTML = '<div class="empty">正在加载客户结果…</div>';
      return;
    }
    $('#customerTable').innerHTML = table(
      [canSelectCustomers ? '<input id="selectCustomerPage" type="checkbox" aria-label="选择当前页客户">' : '', '客户', '国家 / 行业', '阶段', '负责人', '最近动作', '下一步', '优先级', '状态', '操作'],
      accounts.map(account => {
        const alert = alertFor(account.id);
        const canReturn = canReturnCustomer(account);
        const canReject = canRejectCustomer(account);
        const canTrash = !state.data.impersonation && can('manage_manual_customer_deletion')
          && !account.intake_item_id && account.source_file === 'CRM手工新增';
        const lifecycleActions = [
          canReturn ? `<button class="text-button danger-text" data-return-customer="${esc(account.id)}">退回线索池</button>` : '',
          canReject ? `<button class="text-button danger-text" data-reject-customer="${esc(account.id)}">标记不对口</button>` : '',
          canTrash ? `<button class="text-button danger-text" data-trash-customer="${esc(account.id)}">删除到回收站</button>` : '',
        ].filter(Boolean).join('');
        const primaryStatus = customerPrimaryStatus(alert);
        return [
          canSelectCustomers && canSelectCustomer(account) ? `<input type="checkbox" data-select-customer="${esc(account.id)}" ${state.customerSelectionMode === 'filtered' || state.selectedCustomerIds.has(account.id) ? 'checked' : ''} aria-label="选择 ${esc(accountDisplayName(account))}">` : '',
          `<div class="company-cell"><strong class="tp-company-anchor">${esc(accountDisplayName(account))}</strong><span>${esc(accountIdentity(account))}${accountIdentity(account) ? ' · ' : ''}${esc(account.customer_type || account.source || '—')} · 创建人：${esc(creatorDisplayName(account))}</span>${websiteMarkup(account.website || account.domain)}${sourceTagMarkup(account, 4)}</div>`,
          `<div class="company-cell"><strong>${esc(account.country || '—')}</strong><span>${esc(account.industry || '—')}</span></div>`,
          statusMarkup(account.stage, { [account.stage]: stageLabel(account.stage) }),
          esc(account.owner_name || '未分配'),
          `<span>${relative(account.last_activity_at)}</span>`,
          `<div class="company-cell"><strong class="${alertHasCode(alert, 'OVERDUE') ? 'overdue-text' : ''}">${esc(account.next_action || '未填写')}</strong><span>${storedPlanDateLabel(account.next_action_at, account.next_action_time_basis)}</span>${account.next_action_at ? legacyPlanTimeNote(account.next_action_time_basis) : ''}</div>`,
          `<span class="priority ${esc(account.priority)}">${esc(account.priority)}</span>`,
          `${primaryStatus.tone === 'good'
            ? `<span class="good-text">${esc(primaryStatus.label)}</span>`
            : `<span class="pill ${primaryStatus.tone}">${esc(primaryStatus.label)}</span>`}`,
          `${lifecycleActions ? `<div class="assignment-actions">${lifecycleActions}</div>` : ''}`,
        ];
      }).map((row, index) => {
        row._id = accounts[index].id;
        row._attrs = `data-customer="${esc(accounts[index].id)}"`;
        return row;
      }),
    );
    applyTableColumnClasses($('#customerTable'), [
      canSelectCustomers ? 'col-check' : '',
      'col-company', 'col-country', 'col-stage', 'col-owner', 'col-last', 'col-next',
      'col-priority', 'col-status', 'col-actions',
    ]);
    const pageCheckbox = $('#selectCustomerPage');
    if (pageCheckbox) {
      pageCheckbox.checked = Boolean(selectableIds.length && selectedVisibleCount === selectableIds.length);
      pageCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < selectableIds.length;
      pageCheckbox.disabled = !selectableIds.length;
    }
  }

  async function loadRecycleBin({ reset = false, page = null } = {}) {
    if (!can('view_own_mismatch_history') && !can('manage_customer_recycle')) return;
    const meta = state.authorizedBusinessLists.recycle_bin;
    if (!meta?.filterController) {
      await initializeAuthorizedBusinessFilters('recycle_bin', { force: true });
      return;
    }
    const controller = meta.filterController;
    const targetPage = reset ? 1 : Math.max(1, Number(page || meta.page || 1));
    if (reset) {
      controller.clearAll({ apply: false });
      const fields = new Set(controller.getSchema().fields.map(field => field.key));
      const search = ($('#recycleSearch')?.value || '').trim();
      if (search && fields.has('search')) controller.setDraft('search', search);
      controller.apply();
      return;
    }
    await loadAuthorizedBusinessPage('recycle_bin', {
      reset: false,
      force: true,
      page: targetPage,
    });
  }

  async function rejectCustomerAsMismatch(customerId, reason) {
    await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}/reject`, {
      method: 'POST', body: JSON.stringify({ reason }),
    });
    closeDrawer();
    await refresh();
    if (state.customerFilterController) {
      await loadCustomerPage({ reset: false, force: true, page: state.customerList.page });
    }
    const reloads = [];
    for (const pageKey of [
      'pipeline', 'alerts', 'insights', 'recycle_bin',
      'manager_tasks', 'manager_risks', 'manager_metrics', 'notifications',
    ]) {
      const meta = state.authorizedBusinessLists[pageKey];
      if (meta?.filterController) {
        reloads.push(loadAuthorizedBusinessPage(pageKey, {
          reset: false, force: true, page: meta.page,
        }));
      }
    }
    await Promise.all(reloads);
    toast('已移入不对口记录，可在“不对口记录”中查看');
  }

  async function refreshAfterMismatchAction(message) {
    closeDrawer();
    await refresh(message);
    await loadRecycleBin();
  }

  async function restoreMismatchRecord(recordKey, reason) {
    try {
      await api(`/api/sales-crm/mismatch-recycle/${encodeURIComponent(recordKey)}/restore`, {
        method: 'POST', body: JSON.stringify({ reason }),
      });
      await refreshAfterMismatchAction();
      toast('不对口记录已恢复到线索池');
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }

  async function reassignMismatchCustomer(button, reason) {
    const customerId = String(button?.dataset?.reassignCustomer || '').trim();
    const ownerId = String(button?.parentElement?.querySelector('select')?.value || '').trim();
    if (!customerId) return false;
    if (!ownerId) {
      toast('请选择目标销售');
      return false;
    }
    try {
      await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}/reassign`, {
        method: 'POST', body: JSON.stringify({ ownerId, reason }),
      });
      await refreshAfterMismatchAction('客户已重新分配');
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    }
  }

  function renderRecycleBin() {
    const root = $('#recycleTable');
    if (!root) return;
    const rows = state.recycleBin.rows || [];
    if (!rows.length) {
      root.innerHTML = '<div class="empty">回收站暂无客户</div>';
      return;
    }
    const sales = state.data.assignmentCandidates || [];
    root.innerHTML = table(
      ['客户', '原负责人', '原因', '回收时间', '操作'],
      rows.map(row => {
        const customerCell = `<button type="button" class="text-button tp-company-anchor" data-open-mismatch-record="${esc(row.recordKey)}">${esc(accountDisplayName(row))}</button>`;
        let actionCell = '<span class="subtle">仅查看记录</span>';
        if (row.actions?.includes('reassign')) {
          actionCell = `<div class="assignment-actions"><select data-recycle-owner="${esc(row.customerId)}">${sales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}</select><button class="button primary tiny" data-reassign-customer="${esc(row.customerId)}">重新分配</button></div>`;
        } else if (row.actions?.includes('restore') && row.sourceType === 'intake') {
          actionCell = `<button class="button secondary tiny" data-restore-mismatch="${esc(row.recordKey)}">恢复到线索池</button>`;
        } else if (row.actions?.includes('restore')
          && state.data.user?.role === 'admin'
          && can('manage_manual_customer_deletion')
          && !state.data.impersonation) {
          actionCell = `<button class="button secondary tiny" data-restore-customer="${esc(row.customerId)}">恢复客户</button>`;
        }
        const cells = [
          `<div class="company-cell">${customerCell}<span>${esc(accountIdentity(row))}${accountIdentity(row) ? ' · ' : ''}${esc(row.country || '—')}${row.sourceType === 'intake' ? ' · 领取前线索' : ''}</span></div>`,
          esc(row.previousOwnerName || '未分配'),
          esc(row.reason || '—'),
          shortDate(row.recycledAt, true),
          actionCell,
        ];
        row._attrs = `data-recycle-record="${esc(row.recordKey)}"`;
        cells._attrs = row._attrs;
        return cells;
      }),
      'class="mismatch-record-table"',
    );
  }

  function mismatchSafeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.prototype.toString.call(value) !== '[object Date]' ? value : {};
  }

  function mismatchSafeText(value, seen = new Set()) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Number.isNaN(value.getTime()) ? '' : value.toISOString();
    }
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map(item => mismatchSafeText(item, seen)).filter(Boolean).join(' · ');
    }
    const object = mismatchSafeObject(value);
    for (const key of ['label', 'name', 'title', 'summary', 'value']) {
      const text = mismatchSafeText(object[key], seen);
      if (text) return text;
    }
    return '';
  }

  function mismatchSafeJoin(values) {
    return (Array.isArray(values) ? values : [values])
      .map(value => mismatchSafeText(value)).filter(Boolean).join(' · ');
  }

  function mismatchWebsiteMarkup(value) {
    const text = mismatchSafeText(value);
    if (!text) return '<span class="tp-empty-value">暂无官网</span>';
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) return `<span>${esc(text)}</span>`;
      return `<a class="tp-website" href="${esc(url.href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
    } catch (_error) {
      return `<span>${esc(text)}</span>`;
    }
  }

  function renderMismatchRecordDrawer() {
    if (!state.mismatchRecordDetail) return;
    const detail = mismatchSafeObject(state.mismatchRecordDetail);
    const customer = mismatchSafeObject(detail.customer);
    const recycle = mismatchSafeObject(detail.recycle);
    const profile = mismatchSafeObject(detail.profile);
    const history = mismatchSafeObject(detail.history);
    const rows = value => Array.isArray(value) ? value : [];
    const sourceLabel = detail.sourceType === 'intake' ? '领取前线索' : 'CRM客户';
    const valueOrEmpty = (value, empty) => esc(mismatchSafeText(value) || empty);
    const firstText = (...values) => values.map(value => mismatchSafeText(value)).find(Boolean) || '';
    const dateText = value => {
      const text = mismatchSafeText(value);
      return text ? shortDate(text, true) : '';
    };
    const list = (items, empty, renderItem) => rows(items).length
      ? `<div class="mismatch-detail-list">${rows(items).map(renderItem).join('')}</div>`
      : `<div class="mismatch-detail-empty">${esc(empty)}</div>`;
    const compactItem = (title, summary, meta = '') => {
      const safeSummary = mismatchSafeText(summary);
      const safeMeta = mismatchSafeText(meta);
      return `<article class="mismatch-detail-item"><strong>${valueOrEmpty(title, '未命名记录')}</strong>${safeSummary ? `<p>${esc(safeSummary)}</p>` : ''}${safeMeta ? `<span>${esc(safeMeta)}</span>` : ''}</article>`;
    };
    const customerSnapshot = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.companyName, item.company_name, item.nickname, item.externalCustomerId, item.external_customer_id),
        mismatchSafeJoin([item.industry, firstText(item.customerType, item.customer_type), firstText(item.products, item.product_focus)]),
        mismatchSafeJoin([item.country, item.city, item.website]),
      );
    };
    const reconSnapshot = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.title, item.provider, item.jobType, item.job_type) || '客户背调',
        firstText(item.summary, item.resultSummary, item.result_summary, item.status),
        firstText(item.createdAt, item.created_at, item.updatedAt, item.updated_at),
      );
    };
    const contactItem = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.name, item.contactName, item.contact_name) || '未命名联系人',
        mismatchSafeJoin([item.title, item.department, firstText(item.contactLevel, item.contact_level)]),
        mismatchSafeJoin([item.email, item.phone, item.social, firstText(item.contactMethods, item.contact_methods)]),
      );
    };
    const activityItem = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.title, item.activityType, item.activity_type) || '跟进记录',
        firstText(item.summary, item.outcome, item.nextAction, item.next_action),
        dateText(firstText(item.occurredAt, item.occurred_at, item.createdAt, item.created_at)),
      );
    };
    const commerceItem = (value, fallback) => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.subject, item.quoteNo, item.quote_no, item.orderNo, item.order_no, item.id) || fallback,
        mismatchSafeJoin([item.status, item.summary, item.amount]),
        dateText(firstText(item.receivedAt, item.received_at, item.sentAt, item.sent_at, item.orderedAt, item.ordered_at, item.createdAt, item.created_at)),
      );
    };
    const timelineItem = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.title, item.eventType, item.event_type, item.action) || '时间线记录',
        firstText(item.summary, item.description, item.outcome),
        mismatchSafeJoin([firstText(item.actorName, item.actor_name), dateText(firstText(item.occurredAt, item.occurred_at, item.createdAt, item.created_at))]),
      );
    };
    const evaluationItem = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.subjectName, item.authorName, item.author_name) || '客户经营复盘',
        firstText(item.evaluationText, item.evaluation_text, item.summary),
        dateText(firstText(item.createdAt, item.created_at)),
      );
    };
    const auditItem = value => {
      const item = mismatchSafeObject(value);
      return compactItem(
        firstText(item.action) || '客户操作',
        firstText(item.detail, item.summary),
        mismatchSafeJoin([firstText(item.userName, item.actorName, item.actor_name, item.user_id), dateText(firstText(item.createdAt, item.created_at))]),
      );
    };
    const contacts = [...rows(profile.people), ...rows(profile.accountContacts)];
    const reconRows = [
      ...rows(profile.reconJobs), ...rows(profile.reconResults), ...rows(profile.contactReconJobs),
    ];
    const defaultHistory = rows(history.timeline).length
      ? rows(history.timeline)
      : rows(history.activities);
    const expandedMarkup = state.mismatchRecordExpanded ? `
      <section class="mismatch-detail-complete" aria-label="完整资料明细">
        <div class="mismatch-detail-section-head"><div><p class="eyebrow">AUTHORIZED READ-ONLY DATA</p><h3>完整资料明细</h3></div><span class="pill gray">本次授权数据</span></div>
        <div class="mismatch-detail-source-grid">
          <section><h4>客户主档来源</h4>${list([...rows(profile.customerPool), ...rows(profile.customers)], '暂无主档补充记录', customerSnapshot)}</section>
          <section><h4>Recon 摘要</h4>${list(reconRows, '暂无背调补充记录', reconSnapshot)}</section>
        </div>
        <section class="mismatch-detail-group"><h4>联系人</h4>${list(contacts, '暂无联系人记录', contactItem)}</section>
        <section class="mismatch-detail-group"><h4>活动</h4>${list(history.activities, '暂无跟进记录', activityItem)}</section>
        <section class="mismatch-detail-group"><h4>询价</h4>${list(history.rfqs, '暂无询价记录', item => commerceItem(item, '询价记录'))}</section>
        <section class="mismatch-detail-group"><h4>报价</h4>${list(history.quotes, '暂无报价记录', item => commerceItem(item, '报价记录'))}</section>
        <section class="mismatch-detail-group"><h4>订单</h4>${list(history.orders, '暂无订单记录', item => commerceItem(item, '订单记录'))}</section>
        <section class="mismatch-detail-group"><h4>时间线</h4>${list(history.timeline, '暂无时间线记录', timelineItem)}</section>
        <section class="mismatch-detail-group"><h4>评价</h4>${list(history.evaluations, '暂无评价记录', evaluationItem)}</section>
        <section class="mismatch-detail-group"><h4>审计</h4>${list(history.auditLog, '暂无审计记录', auditItem)}</section>
      </section>` : '';
    resetDrawerActions();
    $('#drawerUpdateBtn').classList.add('hidden');
    $('#drawerNicknameBtn').classList.add('hidden');
    $('#drawerStage').textContent = '不对口记录';
    $('#drawerCompany').textContent = detail.loading
      ? '正在读取客户资料…'
      : mismatchSafeText(customer.companyName) || '未命名客户';
    $('#drawerMeta').textContent = detail.loading
      ? detail.recordKey
      : mismatchSafeJoin([detail.recordKey, sourceLabel, customer.externalCustomerId, customer.country, customer.city]);
    $('#drawerContent').innerHTML = detail.loading
      ? '<div class="empty">正在读取不对口客户资料…</div>'
      : `<div class="mismatch-detail-drawer">
        <section class="mismatch-detail-summary">
          <div class="mismatch-detail-section-head"><div><p class="eyebrow">MISMATCH RECORD</p><h3>不对口客户资料</h3></div><div class="mismatch-detail-tags"><span class="pill amber">只读</span><span class="pill gray">${sourceLabel}</span></div></div>
          <div class="mismatch-detail-facts">
            <div><span>客户</span><strong>${valueOrEmpty(customer.companyName, '未命名客户')}</strong></div>
            <div><span>记录编号</span><strong>${valueOrEmpty(detail.recordKey, '暂无记录编号')}</strong></div>
            <div><span>原负责人</span><strong>${valueOrEmpty(recycle.previousOwnerName, '未分配')}</strong></div>
            <div><span>不对口原因</span><strong>${valueOrEmpty(recycle.reason, '未填写原因')}</strong></div>
            <div><span>处理人</span><strong>${valueOrEmpty(firstText(recycle.recycledByName, recycle.recycledBy), '未记录')}</strong></div>
            <div><span>处理时间</span><strong>${valueOrEmpty(dateText(recycle.recycledAt), '未记录')}</strong></div>
          </div>
        </section>
        <section class="mismatch-detail-master">
          <div class="mismatch-detail-section-head"><div><p class="eyebrow">CUSTOMER MASTER DATA</p><h3>主档摘要</h3></div></div>
          <div class="mismatch-detail-master-grid">
            <div><span>地区</span><p>${valueOrEmpty(mismatchSafeJoin([customer.country, customer.city]), '未标注地区')}</p></div>
            <div><span>官网</span><p>${mismatchWebsiteMarkup(customer.website)}</p></div>
            <div><span>行业</span><p>${valueOrEmpty(customer.industry, '未标注行业')}</p></div>
            <div><span>客户类型</span><p>${valueOrEmpty(customer.customerType, '未标注类型')}</p></div>
            <div><span>产品</span><p>${valueOrEmpty(customer.products, '暂无产品信息')}</p></div>
            <div class="wide"><span>企业简介</span><p>${valueOrEmpty(customer.description, '暂无企业简介')}</p></div>
          </div>
        </section>
        <section class="mismatch-detail-complete mismatch-detail-history" aria-label="开发历史">
          <div class="mismatch-detail-section-head"><div><p class="eyebrow">DEVELOPMENT HISTORY</p><h3>开发历史</h3></div><span class="pill gray">只读</span></div>
          ${list(defaultHistory, '暂无开发历史', timelineItem)}
        </section>
        <button class="text-button mismatch-detail-expand" type="button" data-expand-mismatch-profile aria-expanded="${state.mismatchRecordExpanded ? 'true' : 'false'}">${state.mismatchRecordExpanded ? '收起完整客户资料' : '查看完整客户资料 →'}</button>
        ${expandedMarkup}
      </div>`;
  }

  function toggleMismatchRecordExpanded() {
    if (!state.mismatchRecordDetail || state.mismatchRecordDetail.loading) return;
    state.mismatchRecordExpanded = !state.mismatchRecordExpanded;
    renderMismatchRecordDrawer();
  }

  function claimCustomerDrawer(owner) {
    stopDrawerNextActionTimer();
    owner = String(owner || '').trim();
    const request = { owner, epoch: ++state.drawerRequestEpoch };
    state.drawerOwner = owner;
    if (!owner.startsWith('mismatch:')) {
      state.mismatchRecordDetail = null;
      state.mismatchRecordExpanded = false;
    }
    if (!owner.startsWith('recycle:')) state.recycleCustomerDetail = null;
    return request;
  }

  function isCustomerDrawerRequestCurrent(request) {
    return Boolean(request
      && request.epoch === state.drawerRequestEpoch
      && request.owner === state.drawerOwner
      && $('#customerDrawer').classList.contains('open'));
  }

  async function openMismatchRecord(recordKey) {
    recordKey = String(recordKey || '').trim();
    if (!recordKey) return;
    const request = claimCustomerDrawer(`mismatch:${recordKey}`);
    state.mismatchRecordRequestEpoch += 1;
    state.mismatchRecordExpanded = false;
    state.mismatchRecordDetail = { recordKey, loading: true, error: '', profile: null };
    state.selectedCustomerId = '';
    state.drawerAiContext = null;
    renderMismatchRecordDrawer();
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
    try {
      const profile = await api(`/api/sales-crm/mismatch-recycle/${encodeURIComponent(recordKey)}/profile`);
      if (!isCustomerDrawerRequestCurrent(request)
        || state.mismatchRecordDetail?.recordKey !== recordKey) return;
      state.mismatchRecordDetail = { recordKey, loading: false,
        ...(profile && typeof profile === 'object' ? profile : {}),
        recordKey: profile?.recordKey || recordKey,
        loading: false,
        error: '',
      };
      renderMismatchRecordDrawer();
    } catch (error) {
      if (!isCustomerDrawerRequestCurrent(request)
        || state.mismatchRecordDetail?.recordKey !== recordKey) return;
      closeDrawer();
      toast(error.message);
    }
  }

  async function openRecycleCustomer(customerId) {
    if (!can('manage_customer_recycle')) return;
    customerId = String(customerId || '').trim();
    if (!customerId) return;
    const request = claimCustomerDrawer(`recycle:${customerId}`);
    state.selectedCustomerId = customerId;
    state.drawerAiContext = null;
    $('#drawerStage').textContent = '回收站客户';
    $('#drawerCompany').textContent = '正在读取客户资料…';
    $('#drawerMeta').textContent = customerId;
    resetDrawerActions();
    $('#drawerUpdateBtn').classList.add('hidden');
    $('#drawerNicknameBtn').classList.add('hidden');
    $('#drawerContent').innerHTML = '<div class="empty">正在读取完整历史资料…</div>';
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
    try {
      const detail = await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}/recycle-profile`);
      if (!isCustomerDrawerRequestCurrent(request) || state.selectedCustomerId !== customerId) return;
      state.recycleCustomerDetail = detail;
      renderDrawer();
    } catch (error) {
      if (!isCustomerDrawerRequestCurrent(request) || state.selectedCustomerId !== customerId) return;
      closeDrawer();
      toast(error.message);
    }
  }

  function labelsForAccount(customerId) {
    return [...new Set((state.data.customerEvaluationTags || []).filter(item => item.customerId === customerId).flatMap(item => item.labels || []).filter(Boolean))];
  }

  function renderPipeline() {
    const meta = state.authorizedBusinessLists.pipeline;
    const accounts = meta.loaded ? meta.rows : [];
    const stages = state.data.stages.filter(item => !['new'].includes(item.key));
    $('#pipelineBoard').innerHTML = stages.map(stage => {
      const rows = accounts.filter(account => account.stage === stage.key);
      return `<div class="lane"><div class="lane-head"><h3>${esc(stage.label)} <small class="subtle">（当前）</small></h3><span>${rows.length}</span></div><div class="lane-body">${rows.map(account => {
        const alert = alertFor(account.id);
        const cls = alert?.severity === 'critical' ? 'alert' : account.manager_required ? 'warning' : '';
        return `<article class="pipeline-card ${cls}" data-open-customer="${account.id}">
          <div><span class="priority ${account.priority}">${account.priority}</span><h4>${esc(accountDisplayName(account))}</h4></div>
          <p>${esc(accountIdentity(account))}</p>
          <p>${esc(account.country)} · ${esc(account.industry || account.product_focus || '未标注')}</p>
          <p>${esc(account.next_action || '未填写下一步')}</p>
          <div class="pipeline-card-foot"><span>${esc(account.owner_name)}</span><span>${relative(account.last_activity_at)}</span></div>
        </article>`;
      }).join('') || '<div class="empty">暂无</div>'}</div></div>`;
    }).join('');
  }

  function normalizeTodayTaskAction(value) {
    return String(value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s:/.-]+/g, '_')
      .toLowerCase();
  }

  function todayTaskAllowedActionTokens(value, result = new Set()) {
    if (typeof value === 'string') {
      result.add(normalizeTodayTaskAction(value));
    } else if (Array.isArray(value)) {
      value.forEach(item => todayTaskAllowedActionTokens(item, result));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => {
        if (item) result.add(normalizeTodayTaskAction(key));
        if (typeof item === 'string' || Array.isArray(item) || (item && typeof item === 'object')) {
          todayTaskAllowedActionTokens(item, result);
        }
      });
    }
    return result;
  }

  function todayTaskActionAllowed(item, accepted, fallback) {
    if (item?.allowedActions === undefined || item?.allowedActions === null) return Boolean(fallback);
    const tokens = todayTaskAllowedActionTokens(item.allowedActions);
    if (!normalizeTodayTaskAction(item.actionKind) && tokens.size === 0) return Boolean(fallback);
    return Boolean(fallback)
      && accepted.some(action => tokens.has(normalizeTodayTaskAction(action)));
  }

  function todayTaskActionKind(item) {
    const explicit = normalizeTodayTaskAction(item?.actionKind);
    const aliases = {
      resolve_overdue_lead: 'overdue-lead',
      overdue_lead: 'overdue-lead',
      add_next_plan: 'next-plan',
      next_plan: 'next-plan',
      complete_manager_assistance: 'manager-assistance',
      manager_assistance: 'manager-assistance',
      confirm_manager_assistance: 'manager-receipt',
      record_quote: 'quote',
      quote: 'quote',
      record_activity: 'activity',
      activity: 'activity',
    };
    if (aliases[explicit]) return aliases[explicit];
    const code = String(item?.code || '').toUpperCase();
    if (['UNCLAIMED', 'UNCLAIMED_LEAD'].includes(code)) return 'overdue-lead';
    if (code === 'NO_NEXT') return 'next-plan';
    if (code === 'NO_NEXT_DEFERRED') return 'deferred-plan';
    if (code === 'MANAGER_NEEDED') return 'manager-assistance';
    if (code === 'RFQ_UNQUOTED') return 'quote';
    if ([
      'INTAKE_IDLE', 'OVERDUE', 'REPLY_IDLE', 'POST_MANAGER_IDLE',
      'MEETING_NO_RFQ', 'QUOTE_IDLE', 'STALE',
    ].includes(code)) return 'activity';
    return '';
  }

  function todayTaskDueText(item) {
    return item.dueAt
      ? `${shortDate(item.dueAt, true)}${item.maxOverdueHours ? ` · 已超期 ${Math.floor(item.maxOverdueHours)} 小时` : ''}`
      : '未设置计划时间';
  }

  function todayTaskContext(item, account) {
    const identity = accountIdentity(account || item);
    return item.intakeItemId
      ? [identity, '未开发线索', '待领取'].filter(Boolean).join(' · ')
      : [identity, account?.country || '', stageLabel(item.stage)].filter(Boolean).join(' · ');
  }

  function renderTodayTaskMobileCard(item, account) {
    const pill = item.urgency === 'immediate' ? 'red' : item.urgency === 'today' ? 'blue' : 'amber';
    const otherReasons = item.otherReasons || [];
    const other = otherReasons.length
      ? otherReasons.map(reason => `<span class="pill alert-reason-pill">${esc(reason)}</span>`).join('')
      : '<span class="subtle">无</span>';
    const context = todayTaskContext(item, account);
    const target = item.intakeItemId
      ? `data-intake-profile="${esc(item.intakeItemId)}"`
      : `data-customer="${esc(item.customerId)}"`;
    return `<article class="today-task-mobile-card" ${target}>
      <div class="today-task-mobile-head">
        <span class="pill ${pill}">${esc(item.urgencyLabel || '需要关注')}</span>
        <span class="today-task-mobile-count">${Number(item.reasonCount || 1)} 个原因</span>
      </div>
      <div class="today-task-mobile-customer">
        <strong>${esc(accountDisplayName(account || item))}</strong>
        <span>${esc(context)}</span>
      </div>
      <dl class="today-task-mobile-facts">
        <div><dt>主要原因</dt><dd>${esc(item.title)}</dd></div>
        <div><dt>其他原因</dt><dd class="today-task-mobile-reasons">${other}</dd></div>
        <div><dt>计划时间</dt><dd>${esc(todayTaskDueText(item))}</dd></div>
        <div><dt>当前负责人</dt><dd>${esc(item.ownerName || account?.owner_name || userById(item.ownerId)?.name || '未分配')}</dd></div>
      </dl>
      <div class="today-task-mobile-action">${todayTaskActionMarkup(item)}</div>
    </article>`;
  }

  function todayTaskActionMarkup(item) {
    const kind = todayTaskActionKind(item);
    const role = state.data?.user?.role;
    const allowed = {
      'overdue-lead': todayTaskActionAllowed(
        item,
        ['resolve_overdue_lead', 'reassign', 'return_to_pool'],
        ['admin', 'manager'].includes(role) && can('manage_intake'),
      ),
      'next-plan': todayTaskActionAllowed(
        item,
        ['add_next_plan'],
        can('record_activity'),
      ),
      'manager-assistance': todayTaskActionAllowed(
        item,
        ['complete_manager_assistance'],
        ['admin', 'manager'].includes(role) && can('view_team'),
      ),
      'manager-receipt': todayTaskActionAllowed(
        item,
        ['confirm_manager_assistance', 'add_next_plan'],
        can('record_activity'),
      ),
      'deferred-plan': todayTaskActionAllowed(item, ['add_next_plan'], can('record_activity')),
      quote: todayTaskActionAllowed(item, ['record_quote', 'quote'], can('record_quote')),
      activity: todayTaskActionAllowed(item, ['record_activity', 'activity'], can('record_activity')),
    }[kind];
    if (!kind) {
      return item.action
        ? `<span class="pill amber">${esc(item.action)}</span>`
        : '<span class="subtle">暂无对应操作</span>';
    }
    if (!allowed) {
      return state.data.impersonation && todayTaskSecurityBlocked(kind)
        ? '<span class="subtle">身份检查期间禁止此安全操作</span>'
        : '<span class="subtle">当前账号无权处理</span>';
    }
    const labels = {
      'overdue-lead': '处理超时线索',
      'next-plan': '立即补计划',
      'manager-assistance': '处理协助请求',
      'manager-receipt': '确认并制定下一步计划',
      'deferred-plan': '设置复查时间',
    };
    return `<button class="text-button" type="button" data-today-task-action="${esc(kind)}" data-today-task-id="${esc(item.id)}">${esc(labels[kind] || item.action || '立即处理')} →</button>`;
  }

  function todayTaskSecurityBlocked(kind) {
    return ['password', 'user-management', 'data-maintenance'].includes(kind);
  }

  function renderAlerts() {
    const meta = state.authorizedBusinessLists.alerts;
    const all = meta.loaded ? meta.rows : [];
    const summary = meta.summary || {};
    const summarizedReasons = summary.reasons ?? summary.reasonCount ?? summary.totalReasons;
    const reasonCount = Number(
      summarizedReasons ?? all.reduce((sum, item) => sum + Number(item.reasonCount || 1), 0),
    );
    const reasonText = summarizedReasons === undefined && meta.hasMore
      ? `已加载 ${reasonCount} 个异常原因，列表已按客户或线索去重`
      : `${reasonCount} 个异常原因，已按客户或线索去重`;
    const counts = {
      immediate: Number(summary.immediate ?? summary.immediateCount
        ?? all.filter(item => item.urgency === 'immediate').length),
      today: Number(summary.today ?? summary.todayCount
        ?? all.filter(item => item.urgency === 'today').length),
      attention: Number(summary.attention ?? summary.attentionCount
        ?? all.filter(item => item.urgency === 'attention').length),
    };
    const objectCount = Number(summary.objects ?? summary.objectCount ?? summary.total ?? meta.total ?? all.length);
    $('#alertSummary').innerHTML = [
      ['待处理对象', objectCount, reasonText],
      ['立即处理', counts.immediate, '询价、主管协助或领取时限事项'],
      ['今天完成', counts.today, '超期、缺少下一步或未首次触达'],
      ['需要关注', counts.attention, '存在阶段停滞风险'],
    ].map(([label, value, text]) => `<article class="alert-kpi"><span>${label}</span><strong>${value}</strong><small class="subtle">${text}</small></article>`).join('');
    const rows = all.filter(item => !state.alertSeverity || item.urgency === state.alertSeverity);
    const desktopTable = table(
      ['等级', '客户', '主要原因 / 其他原因', '计划时间', '负责人', '唯一建议动作'],
      rows.map(item => {
        const account = state.data.accounts.find(row => row.id === item.customerId);
        const pill = item.urgency === 'immediate' ? 'red' : item.urgency === 'today' ? 'blue' : 'amber';
        const other = (item.otherReasons || []).map(reason => `<span class="pill alert-reason-pill">${esc(reason)}</span>`).join('');
        const row = [
          `<span class="pill ${pill}">${esc(item.urgencyLabel || '需要关注')}</span>`,
          `<div class="company-cell"><strong>${esc(accountDisplayName(account || item))}</strong><span>${esc(todayTaskContext(item, account))}</span></div>`,
          `<div class="alert-reasons"><strong>${esc(item.title)}</strong>${other ? `<div>${other}</div>` : ''}<small class="subtle">${item.reasonCount || 1} 个原因</small></div>`,
          esc(todayTaskDueText(item)),
          esc(item.ownerName || account?.owner_name || userById(item.ownerId)?.name || ''),
          todayTaskActionMarkup(item),
        ];
        row._attrs = item.intakeItemId
          ? `data-intake-profile="${esc(item.intakeItemId)}"`
          : `data-customer="${esc(item.customerId)}"`;
        return row;
      }),
    );
    const mobileCards = rows.length
      ? rows.map(item => renderTodayTaskMobileCard(
        item,
        state.data.accounts.find(account => account.id === item.customerId),
      )).join('')
      : '<div class="empty">暂无符合条件的数据</div>';
    $('#alertTable').innerHTML = `<div class="today-task-desktop-table"><div class="data-table">${desktopTable}</div></div>
      <div class="today-task-mobile-list">${mobileCards}</div>`;
    renderManagerAnomalies();
  }

  const managerTaskReasonLabels = {
    consecutive_deferred: '连续暂未确定',
    first_contact_silence: '首次触达后沉默',
    planned_action_overdue: '计划动作超时',
    manager_assistance: '销售请求主管协助',
  };
  const managerTaskStatusLabels = {
    open: '待处理', overdue: '已逾期', escalated: '已升级为经营决策事项', completed: '已完成',
  };

  function managerTaskRows(pageKey) {
    const meta = state.authorizedBusinessLists[pageKey];
    if (meta?.loaded) return meta.rows;
    return pageKey === 'manager_tasks' ? (state.data?.managerTasks || []) : [];
  }

  function managerTaskName(task) {
    return task.nickname || task.companyName
      || accountDisplayName(state.data?.accounts?.find(account =>
        account.id === task.accountId || account.external_customer_id === task.customerId))
      || task.customerId;
  }

  function managerTaskButton(task, label = '查看并处理') {
    return `<button class="text-button" type="button" data-manager-task-id="${esc(task.id)}">${esc(label)} →</button>`;
  }

  function renderManagerTasks() {
    const root = $('#managerTaskList');
    if (!root) return;
    if (!can('resolve_manager_tasks')) {
      root.innerHTML = '';
      return;
    }
    const meta = state.authorizedBusinessLists.manager_tasks;
    const rows = managerTaskRows('manager_tasks');
    const taskSummary = meta.loaded
      ? (meta.summary || { total: 0, open: 0, overdue: 0, escalated: 0, completed: 0 })
      : {
        total: rows.length,
        open: rows.filter(task => task.status === 'open').length,
        overdue: rows.filter(task => task.status === 'overdue').length,
        escalated: rows.filter(task => task.status === 'escalated').length,
        completed: rows.filter(task => task.status === 'completed').length,
      };
    const summary = $('#managerTaskSummary');
    if (summary) {
      const values = [
        ['待处理', Number(taskSummary.open || 0)],
        ['已逾期', Number(taskSummary.overdue || 0)],
        ['已升级为经营决策事项', Number(taskSummary.escalated || 0)],
        ['已完成', Number(taskSummary.completed || 0)],
        ['当前筛选任务', Number(taskSummary.total || 0)],
      ];
      summary.innerHTML = values.map(([label, value]) =>
        `<article><span>${esc(label)}</span><strong>${Number(value)}</strong></article>`).join('');
    }
    const visible = rows;
    root.innerHTML = meta.loading && !meta.loaded
      ? '<div class="empty">正在读取主管任务…</div>'
      : visible.length
        ? visible.map(task => `<article class="manager-task-card">
          <header class="manager-task-heading"><div><h3>${esc(managerTaskName(task))}</h3><p>${esc(task.customerId)}</p></div><span class="pill ${task.status === 'overdue' || task.status === 'escalated' ? 'red' : task.status === 'completed' ? 'gray' : 'amber'}">${esc(managerTaskStatusLabels[task.status] || task.status)}</span></header>
          <dl><div class="manager-task-fact"><dt>负责人</dt><dd>${esc(task.ownerName || userById(task.ownerId)?.name || task.ownerId || '未记录')}</dd></div>
          <div class="manager-task-fact"><dt>触发原因</dt><dd>${esc(managerTaskReasonLabels[task.reason] || task.reason)}</dd></div>
          <div class="manager-task-fact manager-task-dates"><dt>处理期限</dt><dd><strong>${esc(shortDate(task.dueAt, true))}</strong><small>${esc(shortDate(task.triggeredAt, true))} 触发</small></dd></div></dl>
          <footer class="manager-task-actions">${managerTaskButton(task)}</footer>
        </article>`).join('')
        : `<div class="empty">${esc(meta.error || '当前授权范围内没有主管任务')}</div>`;
  }

  function renderManagerRisks() {
    const root = $('#managerRiskList');
    if (!root) return;
    if (!can('resolve_manager_tasks')) {
      root.innerHTML = '';
      return;
    }
    const meta = state.authorizedBusinessLists.manager_risks;
    const rows = managerTaskRows('manager_risks');
    root.innerHTML = meta.loading && !meta.loaded
      ? '<div class="empty">正在读取客户风险…</div>'
      : rows.length
        ? rows.map(task => `<article class="manager-risk-card">
          <div><strong>${esc(managerTaskName(task))}</strong><span>${esc(managerTaskReasonLabels[task.reason] || task.reason)} · ${esc(managerTaskStatusLabels[task.status] || task.status)}</span></div>
          <div><span>负责人 ${esc(task.ownerName || task.ownerId || '未记录')}</span><span>期限 ${esc(shortDate(task.dueAt, true))}</span></div>
          ${managerTaskButton(task, '查看历史')}
        </article>`).join('')
        : `<div class="empty">${esc(meta.error || '当前没有待复盘客户')}</div>`;
  }

  function metricSummary(rows) {
    const counts = {
      activeCustomers: 0, deferredRecords: 0, thresholdCustomers: 0,
      deferredCustomers: 0,
      plannedAfterDeferredCustomers: 0, onTimeActionCustomers: 0,
      firstTouchSilentCustomers: 0, unimprovedAfterInterventionCustomers: 0,
    };
    rows.forEach(row => Object.keys(counts).forEach(key => {
      counts[key] += Number(row.counts?.[key] || 0);
    }));
    const rate = (value, total) => total ? Math.round(value / total * 10000) / 100 : 0;
    return {
      counts,
      sampleSize: counts.activeCustomers,
      planRate: rate(counts.plannedAfterDeferredCustomers, counts.deferredCustomers),
      onTimeRate: rate(counts.onTimeActionCustomers, counts.plannedAfterDeferredCustomers),
    };
  }

  async function drillDownManagerMetric(ownerId) {
    const metricController = state.authorizedBusinessLists.manager_metrics.filterController;
    if (!metricController || !ownerId) return;
    await initializeAuthorizedBusinessFilters('manager_risks');
    const riskController = state.authorizedBusinessLists.manager_risks.filterController;
    if (!riskController) return toast('客户风险筛选暂不可用');
    const riskFields = new Set(riskController.getSchema().fields.map(field => field.key));
    if (!riskFields.has('owner')) return toast('当前账号未获授权使用负责人下钻');
    const applied = metricController.serialize('applied');
    riskController.clearAll({ apply: false });
    for (const filter of applied.filters || []) {
      if (filter.field === 'metric_window' || filter.field === 'owner'
          || !riskFields.has(filter.field)) continue;
      riskController.setDraft(filter.field, filter.value);
    }
    riskController.setDraft('owner', [String(ownerId)]);
    riskController.apply();
    $('#managerRiskFilters')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderManagerMetrics() {
    const root = $('#managerMetricList');
    if (!root) return;
    if (!can('resolve_manager_tasks')) {
      root.innerHTML = '';
      return;
    }
    const meta = state.authorizedBusinessLists.manager_metrics;
    const rows = (meta.loaded ? meta.rows : (state.data?.managerMetrics?.sales || []).map(row => ({
      ...row, rangeDays: state.data?.managerMetrics?.rangeDays || 30,
    }))).filter(row => Number(row.rangeDays) === state.managerMetricRange);
    $$('[data-manager-range]').forEach(button => {
      const active = Number(button.dataset.managerRange) === state.managerMetricRange;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const serverSummary = meta.summary?.ranges?.[String(state.managerMetricRange)];
    const summary = meta.loaded
      ? {
        counts: serverSummary?.counts || metricSummary([]).counts,
        sampleSize: Number(serverSummary?.sampleSize || 0),
        planRate: Number(serverSummary?.ratios?.planFormationRate || 0),
        onTimeRate: Number(serverSummary?.ratios?.onTimeActionRate || 0),
      }
      : metricSummary(rows);
    if ($('#managerMetricSummary')) {
      $('#managerMetricSummary').innerHTML = [
        ['活跃客户样本', summary.sampleSize],
        ['延期记录', summary.counts.deferredRecords],
        ['达到客户阈值', summary.counts.thresholdCustomers],
        ['延期后形成计划率', `${summary.planRate}%`],
        ['计划后按时动作率', `${summary.onTimeRate}%`],
        ['首次触达后沉默', summary.counts.firstTouchSilentCustomers],
        ['介入后仍未改善', summary.counts.unimprovedAfterInterventionCustomers],
      ].map(([label, value]) => `<article><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`).join('');
    }
    root.innerHTML = meta.loading && !meta.loaded
      ? '<div class="empty">正在读取延期统计…</div>'
      : rows.length
        ? rows.map(row => `<article class="manager-metric-card">
          <header><div><strong>${esc(row.actorName || row.actorId)}</strong><span>近 ${Number(row.rangeDays)} 天 · 样本 ${Number(row.sampleSize || 0)}</span></div>${row.needsManagerReview ? '<span class="pill amber">需要主管复盘</span>' : '<span class="pill gray">样本未达阈值</span>'}</header>
          <dl><div><dt>延期客户</dt><dd>${Number(row.counts?.deferredCustomers || 0)} · ${Number(row.ratios?.deferredCustomerRate || 0)}%</dd></div><div><dt>延期后形成计划</dt><dd>${Number(row.counts?.plannedAfterDeferredCustomers || 0)} · ${Number(row.ratios?.planFormationRate || 0)}%</dd></div><div><dt>计划后按时动作</dt><dd>${Number(row.counts?.onTimeActionCustomers || 0)} · ${Number(row.ratios?.onTimeActionRate || 0)}%</dd></div><div><dt>沉默 / 未改善</dt><dd>${Number(row.counts?.firstTouchSilentCustomers || 0)} / ${Number(row.counts?.unimprovedAfterInterventionCustomers || 0)}</dd></div></dl>
          <p>${row.unavailable?.reasons?.length ? `<span class="subtle">${esc(row.unavailable.reasons.join('、'))}</span>` : ''}<button class="text-button" type="button" data-manager-metric-owner="${esc(row.actorId)}">查看该销售客户风险</button></p>
        </article>`).join('')
        : `<div class="empty">${esc(meta.error || `近 ${state.managerMetricRange} 天暂无统计数据`)}</div>`;
    renderManagerRisks();
  }

  function notificationAccount(customerId) {
    return state.data.accounts.find(row =>
      row.id === customerId || row.external_customer_id === customerId);
  }

  function renderNotifications() {
    const root = $('#notificationList');
    if (!root) return;
    const meta = state.authorizedBusinessLists.notifications;
    const all = notificationRowsAllowedByAIGate(meta.loaded ? meta.rows : []);
    const summary = meta.loaded && meta.summary
      ? meta.summary
      : {
        total: all.length,
        unread: all.filter(item => item.status === 'unread').length,
        failed: all.filter(item =>
          item.wecomDeliveryStatus === 'failed' || item.wecomStatus === 'failed').length,
      };
    $('#notificationSummary').innerHTML = [
      ['我的未读', Number(summary.unread || 0), '需要查看的新消息', Number(summary.unread) ? 'alert' : ''],
      ['我的通知', Number(summary.total || 0), '当前账号授权范围', ''],
      ['渠道降级', Number(summary.failed || 0), Number(summary.failed) ? '企微失败，网页通知仍可处理' : '网页投递正常', Number(summary.failed) ? 'warn' : ''],
    ].map(([label, value, note, cls]) => `<article class="metric ${cls}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    $('#notificationResultCount').textContent = meta.loading && !meta.loaded
      ? '正在读取授权结果…'
      : `已显示 ${all.length} / ${Number(meta.total || all.length)} 条`;
    const statusAuthorized = Boolean(meta.filterController?.getSchema().fields
      .some(field => field.key === 'notification_status'));
    const tabs = $('#notificationTabs');
    if (tabs) tabs.classList.toggle('hidden', Boolean(meta.filterController) && !statusAuthorized);
    if (meta.filterController && !statusAuthorized) state.notificationStatus = '';
    $$('#notificationTabs [data-notification-status]').forEach(button => {
      button.disabled = Boolean(meta.filterController) && !statusAuthorized;
      button.classList.toggle('active', button.dataset.notificationStatus === state.notificationStatus);
    });
    root.innerHTML = meta.loading && !meta.loaded
      ? '<div class="empty">正在读取通知…</div>'
      : all.length ? all.map(item => {
      const account = notificationAccount(item.customerId);
      const isOwn = !item.recipientId || item.recipientId === state.data.user.id;
      const isUnread = item.status === 'unread';
      const channelFailed = item.wecomDeliveryStatus === 'failed' || item.wecomStatus === 'failed';
      const severity = item.severity === 'critical' ? 'red' : item.severity === 'warning' ? 'amber' : '';
      const recipient = isOwn ? '发给我' : `发给 ${item.recipientName || '团队成员'}`;
      const action = item.code === 'ACTIVITY_CORRECTION_REVIEW'
        ? `<button class="text-button" type="button" data-notification-view="${esc(item.id)}" data-target-view="activityCorrections">处理更正申请</button>`
        : item.code === 'ACTIVITY_CORRECTION_COMPLETED' && account
          ? `<button class="text-button" type="button" data-notification-customer="${esc(item.id)}" data-customer-id="${esc(account.id)}">查看目标客户</button>`
          : account
            ? `<button class="text-button" type="button" data-notification-customer="${esc(item.id)}" data-customer-id="${esc(account.id)}">查看客户</button>`
        : item.code === 'MANAGER_ANOMALY_READY'
          ? `<button class="text-button" type="button" data-notification-view="${esc(item.id)}" data-target-view="alerts">查看异常</button>`
          : item.code === 'SALES_COACHING_READY'
            ? `<button class="text-button" type="button" data-notification-view="${esc(item.id)}" data-target-view="team">查看辅导</button>`
          : '';
      return `<article class="notification-item ${isUnread ? 'unread' : ''}">
        <span class="notification-state" aria-label="${isUnread ? '未读' : '已读'}"></span>
        <div class="notification-copy">
          <div class="notification-title"><span class="pill ${severity}">${esc(item.title)}</span><strong>${esc(accountDisplayName(account))}</strong></div>
          ${accountIdentity(account) ? `<small>${esc(accountIdentity(account))}</small>` : ''}
          <p>${esc(item.detail || '暂无详细说明')}</p>
          <small>${esc(recipient)} · ${shortDate(item.createdAt, true)}${channelFailed ? ' · 企微失败，网页可用' : ''}</small>
        </div>
        <div class="notification-actions">
          ${action}
          ${isOwn && isUnread ? `<button class="icon-button notification-read" type="button" data-notification-read="${esc(item.id)}" title="标记已读" aria-label="标记已读">✓</button>` : ''}
        </div>
      </article>`;
    }).join('') : `<div class="empty">${esc(meta.error || (state.notificationStatus === 'unread' ? '当前没有未读通知' : '暂无通知'))}</div>`;
  }

  async function markNotificationRead(notificationId, options = {}) {
    const notification = state.authorizedBusinessLists.notifications.rows
      .find(item => item.id === notificationId);
    if (!notification) return;
    if ((!notification.recipientId || notification.recipientId === state.data.user.id)
        && notification.status === 'unread') {
      await api(`/api/sales-crm/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'POST', body: '{}',
      });
      await loadAuthorizedBusinessPage('notifications', { reset: true });
      renderAll();
    }
    if (options.customerId) openCustomer(options.customerId);
    if (options.view) switchView(options.view);
  }

  function canViewManagerAnomalies() {
    return customerAIEnabled()
      && ['admin', 'manager'].includes(state.data?.user?.role)
      && can('view_alerts') && can('view_team');
  }

  function renderManagerAnomalies() {
    const root = $('#managerAnomalyTable');
    const status = $('#managerAnomalyStatus');
    if (!root || !status || !canViewManagerAnomalies()) return;
    const meta = state.managerAnomalies;
    const rows = meta.items.filter(item => {
      return (!state.alertSeverity
          || (state.alertSeverity === 'immediate' ? item.severity === 'critical'
            : state.alertSeverity === 'attention' ? item.severity !== 'critical'
              : false));
    });
    const ready = rows.filter(item => item.ai?.result && !item.ai.stale).length;
    const pending = rows.filter(item =>
      ['queued', 'running', 'retry_wait'].includes(item.ai?.job?.state)).length;
    status.textContent = meta.loading
      ? '正在读取需主管关注事项…'
      : meta.error
        ? `需主管关注事项暂不可用：${meta.error}`
        : `${rows.length} 条规则异常 · ${ready} 条 AI 建议已生成${pending ? ` · ${pending} 条处理中` : ''} · AI建议仅供经理复核`;
    if (meta.loading && !meta.loaded) {
      root.innerHTML = '<div class="empty">正在加载需主管关注事项…</div>';
      return;
    }
    if (!rows.length) {
      root.innerHTML = `<div class="empty">${meta.loaded ? '当前授权范围内没有五类需主管关注事项' : '尚未读取需主管关注事项'}</div>`;
      return;
    }
    root.innerHTML = table(
      ['优先级', '客户 / 负责人', '规则异常', 'AI 中文解释', '介入建议', '经理操作'],
      rows.map(item => {
        const account = state.data.accounts.find(row => row.id === item.customerId);
        const value = item.ai?.stale ? null : item.ai?.result?.value;
        const job = item.ai?.job;
        const jobStatus = aiJobLabels[job?.state]?.[0] || (job ? '等待处理' : '尚未生成');
        return [
          `<div class="manager-priority"><strong>${Number(value?.priorityScore || (item.severity === 'critical' ? 80 : 50))}</strong><span class="pill ${item.severity === 'critical' ? 'red' : 'amber'}">${item.severity === 'critical' ? '立即' : '关注'}</span></div>`,
          `<div class="company-cell"><strong>${esc(account ? accountDisplayName(account) : item.companyName)}</strong><span>${esc(accountIdentity(account))}${accountIdentity(account) ? ' · ' : ''}${esc(item.ownerName || userById(item.ownerId)?.name || '未分配')}</span></div>`,
          `<div class="manager-anomaly-copy"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></div>`,
          value
            ? `<div class="manager-ai-copy"><span class="pill">AI 中文</span><p>${esc(value.explanation)}</p></div>`
            : `<span class="subtle">${esc(item.ai?.stale ? '业务状态已变化，请重新扫描' : jobStatus)}</span>`,
          `<div class="manager-anomaly-copy"><strong>${value ? 'AI 建议' : '规则建议'}</strong><span>${esc(value?.interventionSuggestion || item.action)}</span></div>`,
          `<button class="button secondary tiny" data-open-customer="${esc(item.customerId)}">查看并决定介入</button>`,
        ];
      }),
    );
  }

  async function loadManagerAnomalies({ quiet = false } = {}) {
    if (!canViewManagerAnomalies() || !customerAIEnabled() || state.managerAnomalies.loading) return;
    state.managerAnomalies.loading = true;
    if (!quiet) renderManagerAnomalies();
    try {
      const payload = await api('/api/sales-crm/ai/manager-anomalies');
      state.managerAnomalies.items = payload.anomalies || [];
      state.managerAnomalies.loaded = true;
      state.managerAnomalies.error = '';
    } catch (error) {
      state.managerAnomalies.error = error.message;
    } finally {
      state.managerAnomalies.loading = false;
      renderManagerAnomalies();
    }
  }

  async function runManagerAnomalies() {
    if (state.data?.impersonation || !canViewManagerAnomalies() || state.managerAnomalies.pending) return;
    state.managerAnomalies.pending = true;
    const button = $('#runManagerAnomaly');
    if (button) {
      button.disabled = true;
      button.textContent = '正在提交…';
    }
    try {
      const payload = await api('/api/sales-crm/ai/manager-anomalies/run', {
        method: 'POST',
        body: '{}',
      });
      await loadManagerAnomalies({ quiet: true });
      toast(payload.jobs.length ? `已提交 ${payload.jobs.length} 条需主管关注事项建议` : '当前没有需要生成建议的异常');
      clearTimeout(state.managerAnomalies.timer);
      state.managerAnomalies.pollCount = 0;
      const poll = async () => {
        state.managerAnomalies.pollCount += 1;
        await loadManagerAnomalies({ quiet: true });
        const hasPending = state.managerAnomalies.items.some(item =>
          ['queued', 'running', 'retry_wait'].includes(item.ai?.job?.state));
        if (hasPending && state.managerAnomalies.pollCount < 10) {
          state.managerAnomalies.timer = setTimeout(poll, 1800);
        }
      };
      state.managerAnomalies.timer = setTimeout(poll, 1000);
    } catch (error) {
      toast(error.message);
    } finally {
      state.managerAnomalies.pending = false;
      if (button) {
        button.disabled = false;
        button.textContent = '✦ 生成 AI 介入建议';
      }
    }
  }

  function renderInsightsHub() {
    if (!can('view_insights')) return;
    const showAI = customerAIEnabled();
    const authorizedMeta = state.authorizedBusinessLists.insights;
    if (authorizedMeta.loaded || authorizedMeta.loading) {
      const rows = authorizedMeta.rows || [];
      const evaluated = rows.filter(item => item.evaluationStatus === 'evaluated').length;
      $('#insightSummary').innerHTML = [
        ['授权客户', authorizedMeta.authorizedTotal, '当前数据权限范围'],
        ['当前结果', authorizedMeta.total, '已应用服务端授权筛选'],
        ['已有评价', evaluated, `${percent(evaluated, rows.length)} 当前页覆盖率`],
        ['待评价企业', rows.filter(item => item.evaluationStatus !== 'evaluated').length, '当前已加载结果'],
      ].map(([label, value, note]) =>
        `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
      $('#insightResultCount').textContent = `已显示 ${rows.length} / ${authorizedMeta.total} 家企业`;
      $('#insightCompanyList').innerHTML = rows.length ? rows.map(item => `
        <article class="insight-hub-card">
          <div><span class="status-pill">${esc(stageLabel(item.stage))}</span><h3>${esc(accountDisplayName(item))}</h3><p>${esc(accountIdentity(item))}${accountIdentity(item) ? ' · ' : ''}${esc(item.country || '')} · ${esc(item.ownerName || '未分配')}</p></div>
          <div class="insight-preview ${item.evaluationStatus === 'evaluated' ? '' : 'empty-preview'}">${item.evaluationStatus === 'evaluated' ? `<strong>客户经营复盘：</strong>${esc(item.evaluationText || (showAI ? item.aiSummary : '') || '已有评价')}` : '尚未填写企业经营评价'}</div>
          <div>${showAI ? `<div class="ai-tag-row">${(item.aiLabels || []).slice(0, 5).map(label => `<span class="ai-tag">AI · ${esc(label.name || label)}</span>`).join('') || '<span class="subtle">暂无AI标签</span>'}</div>` : ''}<p style="margin-top:6px">${Number(item.evaluationCount || 0)} 条评价</p></div>
          <div class="insight-hub-actions"><button class="button secondary tiny" data-open-customer="${esc(item.customerId)}">查看详情</button><button class="button primary tiny" data-evaluate-company-id="${esc(item.customerId)}">${item.evaluationStatus === 'evaluated' ? '追加评价' : '写企业评价'}</button></div>
        </article>`).join('') : '<div class="empty">没有符合条件的客户</div>';
      return;
    }
    const insightData = state.data.insights || { contacts: [], evaluations: [] };
    const companyEvaluated = new Set(insightData.evaluations.filter(item => item.subjectType === 'company').map(item => item.customerId));
    const contactEvaluated = new Set(insightData.evaluations.filter(item => item.subjectType === 'contact').map(item => item.customerId));
    const aiCompleted = insightData.evaluations.filter(item => item.aiStatus === 'completed').length;
    const accounts = scopedAccounts().filter(item => !['won', 'repeat', 'lost', 'disqualified'].includes(item.stage));
    const insightMetrics = [
      ['活跃客户', accounts.length, '当前管理范围'],
      ['已有企业评价', companyEvaluated.size, `${percent(companyEvaluated.size, accounts.length)} 覆盖率`],
      ['已有联系人评价', contactEvaluated.size, '逐人记录判断'],
      ...(customerAIEnabled() ? [['AI标注完成', aiCompleted, '人工原文与AI分离']] : []),
      ['待评价企业', Math.max(0, accounts.length - companyEvaluated.size), '建议优先覆盖A类客户'],
    ];
    $('#insightSummary').innerHTML = insightMetrics
      .map(([label, value, note]) => `<article class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    const search = ($('#insightSearch')?.value || '').trim().toLowerCase();
    const coverage = $('#insightCoverageFilter')?.value || '';
    const rows = accounts.filter(account => {
      const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
      const labels = customerAIEnabled()
        ? evaluations.flatMap(item => item.aiLabels.map(label => label.name))
        : [];
      const text = [account.nickname, account.company_name, account.country, account.owner_name, ...labels].join(' ').toLowerCase();
      const covered = !coverage || (coverage === 'none' && !evaluations.length) || (coverage === 'company' && companyEvaluated.has(account.id)) || (coverage === 'contact' && contactEvaluated.has(account.id));
      return (!search || text.includes(search)) && covered;
    });
    $('#insightResultCount').textContent = `${rows.length} 家企业`;
    $('#insightCompanyList').innerHTML = rows.length ? rows.map(account => {
      const evaluations = insightData.evaluations.filter(item => item.customerId === account.id);
      const companyEval = evaluations.find(item => item.subjectType === 'company');
      const contactCount = insightData.contacts.filter(item => item.customerId === account.id).length;
      const contactEvalCount = evaluations.filter(item => item.subjectType === 'contact').length;
      const labels = customerAIEnabled() ? evaluations.flatMap(item => item.aiLabels).slice(0, 5) : [];
      return `<article class="insight-hub-card">
        <div><span class="status-pill">${esc(stageLabel(account.stage))}</span><h3>${esc(accountDisplayName(account))}</h3><p>${esc(accountIdentity(account))}${accountIdentity(account) ? ' · ' : ''}${esc(account.country)} · ${esc(account.owner_name)}</p></div>
        <div class="insight-preview ${companyEval ? '' : 'empty-preview'}">${companyEval ? `<strong>客户经营复盘：</strong>${esc(companyEval.evaluationText)}` : '尚未填写企业经营评价'}</div>
        <div>${customerAIEnabled() ? `<div class="ai-tag-row">${labels.length ? labels.map(label => `<span class="ai-tag">AI · ${esc(label.name)}</span>`).join('') : '<span class="subtle">暂无AI标签</span>'}</div>` : ''}<p style="margin-top:6px">${contactCount} 位对接人 · ${contactEvalCount} 条联系人评价</p></div>
        <div class="insight-hub-actions"><button class="button secondary tiny" data-open-customer="${account.id}">查看详情</button><button class="button primary tiny" data-evaluate-company-id="${account.id}">${companyEval ? '追加评价' : '写企业评价'}</button></div>
      </article>`;
    }).join('') : '<div class="empty">没有符合条件的客户</div>';
  }

  function canViewSalesCoaching() {
    return customerAIEnabled()
      && ['admin', 'manager'].includes(state.data?.user?.role)
      && can('view_team');
  }

  function canRunSalesCoaching() {
    return canViewSalesCoaching() && !state.data?.impersonation;
  }

  function coachingFor(userId) {
    return state.salesCoaching.items.find(item => item.salesUserId === userId) || null;
  }

  const teamProgressLabels = {
    progressedCustomers: '真实推进', silentCustomers: '持续沉默',
    repeatedDeferredCustomers: '反复延期', plansFormedCustomers: '形成计划',
    actionsAfterPlanCustomers: '计划后行动', overdueManagerTasks: '主管逾期',
    escalatedManagerTasks: '已升级',
  };
  const teamRatioLabels = {
    progressRate: '推进率', silenceRate: '沉默率', deferredRate: '延期率',
    planFormationRate: '计划形成率', actionAfterPlanRate: '计划后行动率',
  };
  const collaborationStatusLabels = {
    unresolved: '未解决', resolved: '已解决', escalated: '已升级', revoked: '已撤销',
  };
  const collaborationRelationLabels = {
    original: '原始记录', supplement: '补充记录', correction: '更正记录',
    revocation: '撤销记录', system: '系统事实',
  };

  function teamFilterPayload(kind = 'progress') {
    const controller = kind === 'collaboration'
      ? state.teamStatus.collaborationController
      : state.teamStatus.progressController;
    return controller?.serialize('applied') || { permissionVersion: '', filters: [] };
  }

  function teamStatusQuery(kind = 'progress', extra = {}) {
    const payload = teamFilterPayload(kind);
    return new URLSearchParams({
      ...extra,
      permissionVersion: String(payload.permissionVersion || ''),
      filters: JSON.stringify(componentPayloadToRaw(payload)),
    });
  }

  function renderTeamStatusState() {
    const status = $('#teamStatusState');
    if (!status) return;
    status.classList.toggle('error', Boolean(state.teamStatus.error));
    status.textContent = state.teamStatus.loading
      ? '正在读取授权团队状态…'
      : state.teamStatus.error
        ? `团队状态暂不可用：${state.teamStatus.error}`
        : state.teamStatus.loaded
          ? `${$('#teamRange')?.selectedOptions?.[0]?.textContent || '当前范围'} · 数据截至 ${shortDate(state.teamStatus.data?.sample?.toInclusive, true)}`
          : '进入页面后读取授权范围内的团队状态。';
  }

  function renderTeamProgress() {
    const data = state.teamStatus.data?.progress;
    if (!data) {
      $('#teamProgressSummary').innerHTML = state.teamStatus.loading ? '<div class="empty">正在加载业务推进…</div>' : '<div class="empty">暂无业务推进数据</div>';
      $('#teamProgressSales').innerHTML = '';
      $('#teamProgressDrilldownList').innerHTML = '';
      renderPagination('#teamProgressPagination', 'team_progress', {
        page: 1, pageSize: state.teamStatus.progressPageSize, total: 0,
      }, () => {});
      return;
    }
    const sample = data.sample || {};
    $('#teamProgressSummary').innerHTML = `<div class="team-progress-metrics">
      ${Object.entries(teamProgressLabels).map(([key, label]) => `<article class="team-progress-metric"><span>${label}</span><strong>${Number(data.counts?.[key] || 0)}</strong><small>样本 ${Number(sample.size || 0)}${sample.unavailable ? ' · 样本不足' : ''}</small></article>`).join('')}
    </div><div class="team-ratio-strip">${Object.entries(teamRatioLabels).map(([key, label]) => `<span><b>${label}</b><strong>${Number(data.ratios?.[key] || 0).toFixed(1)}%</strong></span>`).join('')}</div>`;
    $('#teamProgressSales').innerHTML = data.sales?.length ? data.sales.map(row => {
      const user = userById(row.salesUserId);
      return `<article class="team-progress-person">
        <header><div class="person"><span class="avatar">${esc((user?.name || '销').slice(0, 1))}</span><div><strong>${esc(user?.name || row.salesUserId)}</strong><small>样本 ${Number(row.sample?.size || 0)}${row.sample?.unavailable ? ' · 样本不足' : ''}</small></div></div><span class="pill">推进率 ${Number(row.ratios?.progressRate || 0).toFixed(1)}%</span></header>
        <dl><div><dt>真实推进</dt><dd>${Number(row.counts?.progressedCustomers || 0)}</dd></div><div><dt>持续沉默</dt><dd>${Number(row.counts?.silentCustomers || 0)}</dd></div><div><dt>反复延期</dt><dd>${Number(row.counts?.repeatedDeferredCustomers || 0)}</dd></div><div><dt>计划后行动</dt><dd>${Number(row.counts?.actionsAfterPlanCustomers || 0)}</dd></div></dl>
      </article>`;
    }).join('') : '<div class="empty">当前筛选下没有销售推进数据</div>';
    const drilldown = data.drilldown || { customers: [], tasks: [], timeline: [] };
    $$('[data-team-progress-drilldown]').forEach(button => button.classList.toggle(
      'active', button.dataset.teamProgressDrilldown === state.teamStatus.drilldown,
    ));
    const rows = state.teamStatus.drilldown === 'task' ? drilldown.tasks
      : state.teamStatus.drilldown === 'timeline' ? drilldown.timeline : drilldown.customers;
    const progressTotal = Number(data.pagination?.total ?? rows?.length ?? 0);
    const visibleRows = rows || [];
    $('#teamProgressDrilldownList').innerHTML = visibleRows.length ? visibleRows.map(row => {
      if (state.teamStatus.drilldown === 'customer') {
        const facts = [row.progressed && '有推进', row.deferred && '有延期',
          row.planned && '已形成计划', row.actedAfterPlan && '计划后已行动'].filter(Boolean);
        return `<button class="team-drilldown-row" type="button" data-open-customer="${esc(row.accountId)}"><span><strong>${esc(row.companyName || row.customerId)}</strong><small>${esc(row.customerId)} · ${esc(userById(row.ownerId)?.name || row.ownerId || '未分配')}</small></span><span>${facts.map(label => `<i class="pill gray">${label}</i>`).join('') || '<i class="pill gray">持续沉默</i>'}</span></button>`;
      }
      if (state.teamStatus.drilldown === 'task') {
        return `<button class="team-drilldown-row" type="button" data-manager-task-id="${esc(row.taskId)}"><span><strong>${esc(managerTaskReasonLabels[row.reason] || row.reason || '主管待办')}</strong><small>${esc(row.customerId)} · ${esc(userById(row.salesUserId)?.name || row.salesUserId)}</small></span><span class="pill ${row.status === 'overdue' || row.status === 'escalated' ? 'red' : 'gray'}">${esc(managerTaskStatusLabels[row.status] || row.status)}</span></button>`;
      }
      const kindLabels = { activity: '真实动作', deferred_plan: '暂未确定', next_plan: '形成计划', manager_task: '主管待办' };
      return `<div class="team-drilldown-row"><span><strong>${esc(kindLabels[row.kind] || row.kind)}</strong><small>${esc(row.customerId)} · ${esc(row.detail || '')}</small></span><time>${esc(shortDate(row.occurredAt, true))}</time></div>`;
    }).join('') : '<div class="empty">当前范围没有对应明细</div>';
    renderPagination('#teamProgressPagination', 'team_progress', {
      page: state.teamStatus.progressPage, pageSize: state.teamStatus.progressPageSize,
      total: progressTotal, loading: state.teamStatus.loading,
    }, ({ page, pageSize }) => {
      state.teamStatus.progressPageSize = pageSize || state.teamStatus.progressPageSize;
      state.teamStatus.progressPage = page || 1;
      void loadTeamStatus({ reset: false, page: state.teamStatus.progressPage });
    });
  }

  function renderTeamCapability() {
    if (!can('view_team')) return;
    const rows = Array.isArray(state.teamStatus.data?.capability)
      ? state.teamStatus.data.capability
      : state.data.teamReport;
    const coachingStatus = $('#teamCoachingStatus');
    if (coachingStatus) {
      coachingStatus.classList.toggle('hidden', !canViewSalesCoaching());
      const ready = state.salesCoaching.items.filter(item => item.ai?.result && !item.ai.stale).length;
      coachingStatus.textContent = state.salesCoaching.loading && !state.salesCoaching.loaded
        ? '正在读取团队辅导状态…'
        : state.salesCoaching.error
          ? `团队辅导暂不可用：${state.salesCoaching.error}`
          : `${rows.length} 位销售 · ${ready} 份 AI 辅导建议 · 样本不足时不调用模型`;
    }
    $('#teamCards').innerHTML = rows.length ? rows.map(item => {
      const topScores = Object.entries(item.scores).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const coaching = customerAIEnabled() ? coachingFor(item.user.id) : null;
      const coachingLabel = coaching?.ai?.result && !coaching.ai.stale
        ? 'AI辅导已生成'
        : ['queued', 'running', 'retry_wait'].includes(coaching?.ai?.job?.state)
          ? 'AI辅导处理中'
          : item.sampleSize < 10 ? '样本不足' : '待生成AI辅导';
      return `<article class="team-card ${state.teamUserId === item.user.id ? 'selected' : ''}" data-team-user="${item.user.id}">
        <div class="team-card-top"><div class="person"><span class="avatar">${esc(item.user.name.slice(0, 1))}</span><div><strong>${esc(item.user.name)}</strong><small>${esc(item.bestCountries.join(' / ') || '待积累数据')}</small></div></div><div class="score-ring" style="--score:${item.overall}%"><strong>${item.overall}</strong></div></div>
        <div class="capability-bars">${topScores.map(([key, value]) => `<div class="cap-row"><span>${capabilityLabels[key]}</span><div class="cap-track"><i style="width:${value}%"></i></div><b>${value}</b></div>`).join('')}</div>
        <div class="team-tags">${item.bestChannels.map(channel => `<span class="pill">${esc(channel)}</span>`).join('')}<span class="pill gray">${item.sampleStatus}</span>${customerAIEnabled() ? `<span class="pill">${coachingLabel}</span>` : ''}</div>
      </article>`;
    }).join('') : '<div class="empty">当前筛选下暂无销售能力样本</div>';
    if (state.teamUserId) renderTeamDetail(state.teamUserId);
  }

  function renderTeamCollaboration() {
    const rows = state.teamStatus.collaborationRows;
    const writeEnabled = state.teamStatus.writeEnabled && can('record_collaboration_support')
      && !state.data?.impersonation;
    $('#teamCollaborationAdd')?.classList.toggle('hidden', !writeEnabled);
    $('#teamCollaborationList').innerHTML = rows.length ? rows.map(item => {
      const sourceLabel = item.source === 'system' ? '系统事实' : '手工补记';
      const sourceClass = item.source === 'system' ? 'system' : 'manual';
      const actionable = writeEnabled && item.source === 'manual' && item.effective && !item.revoked;
      return `<article class="team-collaboration-item ${item.effective === false ? 'superseded' : ''}">
        <header><div><span class="team-source ${sourceClass}">${sourceLabel}</span><span class="pill ${item.status === 'escalated' ? 'red' : item.status === 'resolved' ? '' : 'gray'}">${esc(collaborationStatusLabels[item.status] || item.status)}</span></div><time>${esc(shortDate(item.createdAt, true))}</time></header>
        <div class="team-collaboration-title"><strong>${esc(userById(item.salesUserId)?.name || item.salesUserId || '未指定销售')}</strong><span>${esc(item.customerId || '未关联客户')}</span></div>
        <dl><div><dt>问题</dt><dd>${esc(item.problem || '—')}</dd></div><div><dt>建议</dt><dd>${esc(item.suggestion || '—')}</dd></div><div><dt>结果 / 下一步</dt><dd>${esc(item.outcome || item.nextStep || '待处理')}</dd></div></dl>
        <footer><span>${esc(collaborationRelationLabels[item.relationType] || item.relationType)} · 操作人 ${esc(userById(item.actorId)?.name || item.actorId || '系统')}${item.supersedesEventId ? ` · 接续 ${esc(item.supersedesEventId)}` : ''}</span>${actionable ? `<div><button class="text-button" type="button" data-collaboration-supplement="${esc(item.eventId)}">补充</button><button class="text-button" type="button" data-collaboration-correct="${esc(item.eventId)}">更正</button><button class="text-button danger" type="button" data-collaboration-revoke="${esc(item.eventId)}">撤销</button></div>` : ''}</footer>
      </article>`;
    }).join('') : `<div class="empty">${state.teamStatus.loaded ? '当前筛选下没有协作事实' : '进入栏目后加载协作事实'}</div>`;
    renderPagination('#teamCollaborationPagination', 'team_collaboration', {
      page: state.teamStatus.collaborationPage,
      pageSize: state.teamStatus.collaborationPageSize,
      total: state.teamStatus.collaborationTotal,
      loading: state.teamStatus.loading,
    }, ({ page, pageSize }) => {
      state.teamStatus.collaborationPageSize = pageSize || state.teamStatus.collaborationPageSize;
      void loadTeamCollaboration({ page: page || 1 });
    });
  }

  function renderTeamSection() {
    const collaborationOnly = !can('view_team');
    if (collaborationOnly) state.teamStatus.section = 'collaboration';
    $('#teamRange')?.classList.toggle('hidden', collaborationOnly);
    $$('[data-team-section]').forEach(button => {
      const active = button.dataset.teamSection === state.teamStatus.section;
      button.classList.toggle('hidden', collaborationOnly && button.dataset.teamSection !== 'collaboration');
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-team-panel]').forEach(panel => panel.classList.toggle(
      'hidden', panel.dataset.teamPanel !== state.teamStatus.section,
    ));
    renderTeamStatusState();
    renderTeamProgress();
    renderTeamCapability();
    renderTeamCollaboration();
    uiFormat?.mountIcons?.($('#teamView'));
  }

  async function loadTeamStatus({ reset = true, page } = {}) {
    if (!can('view_team')) return;
    if (state.teamStatus.loading && !reset) return;
    if (reset) {
      state.teamStatus.progressPage = 1;
      state.teamStatus.collaborationPage = 1;
    }
    const requestEpoch = ++state.teamStatus.requestEpoch;
    state.teamStatus.loading = true;
    state.teamStatus.error = '';
    renderTeamSection();
    try {
      const selectedRange = $('#teamRange')?.value || state.teamStatus.range || '30d';
      const range = state.data?.impersonation && selectedRange === 'since-last-view'
        ? '30d' : selectedRange;
      state.teamStatus.range = range;
      const targetPage = reset ? 1 : Math.max(1, Number(page || state.teamStatus.progressPage || 1));
      const pagination = {
        drilldown: state.teamStatus.drilldown,
        page: String(targetPage),
        pageSize: String(state.teamStatus.progressPageSize),
      };
      const params = teamStatusQuery('progress', range === 'since-last-view'
        ? pagination : { range, ...pagination });
      const result = range === 'since-last-view'
        ? await api('/team-status/since-last-view', {
          method: 'POST', preserveOnForbidden: true,
          body: JSON.stringify({
            permissionVersion: params.get('permissionVersion'),
            filters: JSON.parse(params.get('filters') || '{}'),
            ...pagination,
          }),
        })
        : await api(`/team-status?${params}`, { preserveOnForbidden: true, timeoutMs: 12000 });
      if (requestEpoch !== state.teamStatus.requestEpoch) return;
      const data = result.data || result;
      state.teamStatus.data = data;
      state.teamStatus.progressPage = Number(data.progress?.pagination?.page || targetPage);
      state.teamStatus.progressPageSize = Number(data.progress?.pagination?.pageSize
        || state.teamStatus.progressPageSize);
      state.teamStatus.progressTotalPages = Number(data.progress?.pagination?.totalPages
        ?? Math.ceil(Number(data.progress?.pagination?.total || 0) / state.teamStatus.progressPageSize));
      state.teamStatus.writeEnabled = Boolean(data.writeEnabled);
      state.teamStatus.loaded = true;
      state.teamStatus.error = '';
      if (data.schemas?.progress) state.teamStatus.progressController?.updateSchema(data.schemas.progress);
      if (data.schemas?.collaboration) state.teamStatus.collaborationController?.updateSchema(data.schemas.collaboration);
      state.teamStatus.progressMount?.setResultMeta({
        total: Number(data.progress?.sample?.size || 0), shown: Number(data.progress?.sample?.size || 0),
      });
      state.teamStatus.collaborationMount?.setResultMeta({
        total: state.teamStatus.collaborationTotal,
        shown: state.teamStatus.collaborationRows.length,
      });
      if (state.teamStatus.section === 'collaboration') {
        void loadTeamCollaboration({ reset: true, page: 1 });
      }
    } catch (error) {
      if (requestEpoch !== state.teamStatus.requestEpoch) return;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        state.teamStatus.loading = false;
        await initializeTeamStatusFilters({ force: true });
        return;
      }
      state.teamStatus.error = error.message || '数据读取失败';
    } finally {
      if (requestEpoch === state.teamStatus.requestEpoch) {
        state.teamStatus.loading = false;
        renderTeamSection();
      }
    }
  }

  async function loadTeamCollaboration({ reset = false, page } = {}) {
    const targetPage = reset ? 1 : Math.max(1, Number(page || state.teamStatus.collaborationPage || 1));
    const params = teamStatusQuery('collaboration', {
      page: String(targetPage), pageSize: String(state.teamStatus.collaborationPageSize),
    });
    try {
      const result = await api(`/collaboration-support?${params}`, { preserveOnForbidden: true });
      state.teamStatus.collaborationRows = result.rows || [];
      state.teamStatus.collaborationPage = Number(result.page || targetPage);
      state.teamStatus.collaborationTotal = Number(result.total || 0);
      state.teamStatus.collaborationTotalPages = Number(result.totalPages
        ?? Math.ceil(state.teamStatus.collaborationTotal / state.teamStatus.collaborationPageSize));
      state.teamStatus.collaborationHasMore = Boolean(result.hasMore);
      state.teamStatus.writeEnabled = Boolean(result.writeEnabled);
      if (result.schema) state.teamStatus.collaborationController?.updateSchema(result.schema);
      renderTeamCollaboration();
    } catch (error) {
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        await initializeTeamStatusFilters({ force: true });
        return;
      }
      state.teamStatus.error = error.message;
      renderTeamStatusState();
    }
  }

  async function initializeTeamStatusFilters({ force = false } = {}) {
    if (!can('view_customers') || !window.TradePulseFilterComponent) return;
    const mounts = [
      ['progress', 'team_status_progress', '#teamProgressFilters'],
      ['collaboration', 'team_status_collaboration', '#teamCollaborationFilters'],
    ].filter(([kind]) => kind === 'collaboration' || can('view_team'));
    try {
      for (const [kind, pageKey, selector] of mounts) {
        const root = $(selector);
        const mountKey = `${kind}Mount`;
        const controllerKey = `${kind}Controller`;
        if (!root || (state.teamStatus[mountKey] && !force)) continue;
        state.teamStatus[mountKey]?.destroy();
        root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
        const result = await api(`/filter-schema/${pageKey}`, { preserveOnForbidden: true });
        invalidateStaleResearchFilterState(pageKey, result.schema);
        const controller = window.TradePulseFilterComponent.createFilterController({
          storage: paginationFilterStorage,
          pageKey, schema: result.schema,
          onApply: () => kind === 'progress'
            ? void loadTeamStatus({ reset: true })
            : void loadTeamCollaboration({ reset: true }),
        });
        state.teamStatus[controllerKey] = controller;
        state.teamStatus[mountKey] = window.TradePulseFilterComponent.mountFilterComponent(root, {
          controller, resultMeta: { total: 0, shown: 0 },
        });
      }
      if (can('view_team')) await loadTeamStatus({ reset: true });
      else {
        state.teamStatus.section = 'collaboration';
        state.teamStatus.loaded = true;
        await loadTeamCollaboration({ reset: true });
        renderTeamSection();
      }
    } catch (error) {
      state.teamStatus.error = error.message;
      renderTeamSection();
    }
  }

  function collaborationFormMarkup(item = null, action = 'record') {
    const users = (state.data?.users || []).filter(user => user.role === 'sales' && user.active !== false);
    const accounts = scopedAccounts();
    const append = action !== 'record';
    return `<form id="collaborationSupportForm" data-action="${esc(action)}" data-event-id="${esc(item?.eventId || '')}" data-idempotency-key="${esc(crypto.randomUUID())}" class="collaboration-support-form">
      ${append ? `<div class="collaboration-reference"><strong>${esc(item?.problem || '协作记录')}</strong><span>${esc(item?.customerId || '未关联客户')} · ${esc(collaborationStatusLabels[item?.status] || item?.status || '')}</span></div>` : ''}
      <div class="form-grid two">
        <label>销售<select name="salesUserId" ${append ? 'disabled' : ''} required>${users.map(user => `<option value="${esc(user.id)}" ${user.id === item?.salesUserId ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select></label>
        <label>关联客户（可选）<select name="customerId" ${append ? 'disabled' : ''}><option value="">不关联客户</option>${accounts.map(account => `<option value="${esc(account.external_customer_id || account.id)}" ${(account.external_customer_id || account.id) === item?.customerId ? 'selected' : ''}>${esc(accountDisplayName(account))}</option>`).join('')}</select></label>
        <label class="span-2">问题<textarea name="problem" rows="3" ${action === 'record' ? 'required' : ''}>${esc(item?.problem || '')}</textarea></label>
        <label class="span-2">建议<textarea name="suggestion" rows="3">${esc(item?.suggestion || '')}</textarea></label>
        <label>结果<textarea name="outcome" rows="2">${esc(item?.outcome || '')}</textarea></label>
        <label>下一步<textarea name="nextStep" rows="2">${esc(item?.nextStep || '')}</textarea></label>
        <label>状态<select name="status"><option value="unresolved" ${item?.status === 'unresolved' ? 'selected' : ''}>未解决</option><option value="resolved" ${item?.status === 'resolved' ? 'selected' : ''}>已解决</option><option value="escalated" ${item?.status === 'escalated' ? 'selected' : ''}>已升级</option></select></label>
        ${append ? '<label>操作原因<input name="reason" required placeholder="说明为何补充、更正或撤销"></label>' : ''}
      </div>
      <p id="collaborationSupportStatus" class="form-status" role="status" aria-live="polite"></p>
      <div class="form-actions"><button class="button secondary" type="button" data-close-modal>取消</button><button class="button primary" type="submit">${action === 'record' ? '保存补记' : action === 'supplement' ? '追加补充' : action === 'correction' ? '提交更正' : '确认撤销'}</button></div>
    </form>`;
  }

  function openCollaborationSupport(item = null, action = 'record') {
    const titles = { record: '补记协作支持', supplement: '补充协作记录', correction: '更正协作记录', revocation: '撤销协作记录' };
    openModal(titles[action], 'COLLABORATION SUPPORT', collaborationFormMarkup(item, action), 'collaboration-support-modal');
  }

  async function submitCollaborationSupport(form) {
    if (state.teamStatus.submitting) return;
    const payload = formPayload(form);
    const action = form.dataset.action || 'record';
    const eventId = form.dataset.eventId || '';
    const status = $('#collaborationSupportStatus');
    const idempotencyKey = form.dataset.idempotencyKey;
    state.teamStatus.submitting = true;
    if (status) status.textContent = '正在保存…';
    const body = {
      problem: String(payload.problem || ''), suggestion: String(payload.suggestion || ''),
      outcome: String(payload.outcome || ''), nextStep: String(payload.nextStep || ''),
      status: String(payload.status || 'unresolved'), reason: String(payload.reason || ''),
      idempotencyKey,
    };
    if (action === 'record') {
      body.salesUserId = String(payload.salesUserId || '');
      body.customerId = String(payload.customerId || '');
    }
    try {
      const suffix = { supplement: 'supplements', correction: 'corrections', revocation: 'revocations' }[action];
      await api(suffix ? `/collaboration-support/${encodeURIComponent(eventId)}/${suffix}` : '/collaboration-support', {
        method: 'POST', preserveOnForbidden: true, body: JSON.stringify(body),
      });
      closeModal();
      toast('协作记录已按追加事件保存');
      if (can('view_team')) await loadTeamStatus({ reset: true });
      else await loadTeamCollaboration({ reset: true });
    } catch (error) {
      if (status) status.textContent = `${error.message}；输入已保留，请修正后重试。`;
    } finally {
      state.teamStatus.submitting = false;
    }
  }

  function downloadTeamStatus() {
    if (!can('export_data')) return toast('当前账号没有导出权限');
    const section = state.teamStatus.section;
    const filterKind = section === 'collaboration' ? 'collaboration' : 'progress';
    const format = $('#teamExportFormat')?.value || 'csv';
    const params = teamStatusQuery(filterKind, {
      section, format,
      ...(state.teamStatus.range === 'since-last-view' ? {} : { range: state.teamStatus.range }),
    });
    const link = document.createElement('a');
    link.href = section === 'collaboration' && !can('view_team')
      ? `/api/sales-crm/collaboration-support/export?${params}`
      : `/api/sales-crm/team-status/export?${params}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function loadSalesCoaching({ quiet = false } = {}) {
    if (!canViewSalesCoaching() || state.salesCoaching.loading) return;
    state.salesCoaching.loading = true;
    if (!quiet) renderTeam();
    try {
      const payload = await api('/api/sales-crm/ai/sales-coaching');
      state.salesCoaching.items = payload.items || [];
      state.salesCoaching.loaded = true;
      state.salesCoaching.error = '';
    } catch (error) {
      state.salesCoaching.error = error.message;
    } finally {
      state.salesCoaching.loading = false;
      renderTeam();
    }
  }

  async function runSalesCoaching(userId) {
    if (!canRunSalesCoaching() || state.salesCoaching.pendingUserId) return;
    state.salesCoaching.pendingUserId = userId;
    renderTeam();
    try {
      await api(`/api/sales-crm/ai/sales-coaching/${encodeURIComponent(userId)}/run`, {
        method: 'POST',
        body: '{}',
      });
      toast('销售辅导任务已提交');
      await loadSalesCoaching({ quiet: true });
      clearTimeout(state.salesCoaching.timer);
      state.salesCoaching.pollCount = 0;
      const poll = async () => {
        state.salesCoaching.pollCount += 1;
        await loadSalesCoaching({ quiet: true });
        const coaching = coachingFor(userId);
        const pending = ['queued', 'running', 'retry_wait'].includes(coaching?.ai?.job?.state);
        if (pending && state.salesCoaching.pollCount < SALES_COACHING_MAX_POLLS) {
          state.salesCoaching.timer = setTimeout(poll, 1800);
        }
      };
      state.salesCoaching.timer = setTimeout(poll, 1000);
    } catch (error) {
      toast(error.message);
    } finally {
      state.salesCoaching.pendingUserId = '';
      renderTeam();
    }
  }

  function salesCoachingBlock(item) {
    const coaching = coachingFor(item.user.id);
    const snapshot = coaching?.snapshot || {
      sampleSize: item.sampleSize,
      sampleStatus: item.sampleSize < 10 ? 'insufficient' : item.sampleSize < 30 ? 'limited' : 'sufficient',
    };
    const job = coaching?.ai?.job;
    const value = coaching?.ai?.result && !coaching.ai.stale ? coaching.ai.result.value : null;
    const pending = state.salesCoaching.pendingUserId === item.user.id
      || ['queued', 'running', 'retry_wait'].includes(job?.state);
    const sampleLabel = snapshot.sampleStatus === 'insufficient'
      ? `样本不足（${snapshot.sampleSize}/10）`
      : snapshot.sampleStatus === 'limited'
        ? `有限样本（${snapshot.sampleSize}）`
        : `样本充足（${snapshot.sampleSize}）`;
    const output = value
      ? `<div class="coaching-output">
          <div class="recommendation"><strong>优势</strong><ul>${value.strengths.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>
          <div class="recommendation"><strong>差距</strong><ul>${value.gaps.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>
          <div class="recommendation"><strong>辅导建议</strong><ul>${value.recommendations.map(text => `<li>${esc(text)}</li>`).join('')}</ul></div>
        </div>`
      : snapshot.sampleStatus === 'insufficient'
        ? '<div class="recommendation"><strong>样本不足</strong><br>暂不生成 AI 辅导结论，继续积累真实客户推进结果。</div>'
        : coaching?.ai?.stale
          ? '<div class="recommendation"><strong>数据已变化</strong><br>现有建议已过期，请基于最新聚合结果重新生成。</div>'
          : pending
            ? '<div class="recommendation"><strong>正在生成</strong><br>Worker 正在处理聚合后的转化与 SLA 指标。</div>'
            : '<div class="recommendation"><strong>尚未生成</strong><br>当前已有可评估样本。</div>';
    const action = canRunSalesCoaching()
      ? `<div class="coaching-actions">
          <button class="button primary tiny" type="button" data-run-sales-coaching="${esc(item.user.id)}"
            ${pending || snapshot.sampleStatus === 'insufficient' ? 'disabled' : ''}>${value || coaching?.ai?.stale ? '重新生成' : '生成 AI 辅导'}</button>
          <span class="${pending ? 'coaching-pending' : 'subtle'}">${esc(sampleLabel)} · AI 辅导建议仅供经理复核</span>
        </div>`
      : '';
    return `${output}${action}`;
  }

  function renderTeam() {
    if (!can('view_team')) return;
    renderTeamSection();
  }
  function renderTeamDetail(userId) {
    const rows = Array.isArray(state.teamStatus.data?.capability)
      ? state.teamStatus.data.capability
      : state.data.teamReport;
    const item = rows.find(row => row.user.id === userId);
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
        ${customerAIEnabled() ? salesCoachingBlock(item) : ''}
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
      if (!['lost', 'disqualified'].includes(account.stage) && order[account.stage] >= order.contacted) item.contacted += 1;
      if (!['lost', 'disqualified'].includes(account.stage) && order[account.stage] >= order.replied) item.replied += 1;
      if (!['lost', 'disqualified'].includes(account.stage) && order[account.stage] >= order.rfq) item.rfq += 1;
      if (!['lost', 'disqualified'].includes(account.stage) && order[account.stage] >= order.won) item.won += 1;
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
    const users = state.data.users || [];
    const archivedUsers = state.data.archivedUsers || [];
    const activeUsers = users.filter(user => user.active && !user.archived);
    const overrideUsers = users.filter(user => Number(user.permissionOverrideCount || 0) > 0);
    const permissionGroups = state.data.permissionGroups || [];
    $('#accessActiveUserCount').textContent = String(activeUsers.length);
    $('#accessPermissionGroupCount').textContent = String(permissionGroups.length);
    $('#accessOverrideUserCount').textContent = String(overrideUsers.length);
    $('#accessArchivedUserCount').textContent = String(archivedUsers.length);
    $('#activeUserPanelCount').textContent = `${activeUsers.length} 个启用 · ${users.length} 个在职`;
    $('#archivedUserPanelCount').textContent = `${archivedUsers.length} 人`;
    $('#userTable').innerHTML = table(
      ['用户', '角色', '权限组', '个人调整', '状态', '操作'],
      users.map(user => [
        `<div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>`,
        `<span class="pill">${roleLabel(user.role)}</span>`,
        esc(user.permissionGroupName || '—'),
        user.permissionOverrideCount ? `<span class="pill amber">${user.permissionOverrideCount} 项调整</span>` : '<span class="subtle">无个人调整</span>',
        `<span class="pill ${user.active ? '' : 'gray'}">${user.active ? '启用' : '停用'}</span>`,
        canMutate
          ? `<div class="user-row-actions">
              <button class="text-button" data-edit-user="${user.id}">编辑账号</button>
              <button class="text-button" data-edit-overrides="${user.id}">个人权限</button>
              ${user.id === state.data.user.id
                ? '<span class="current-account-label">当前账号</span>'
                : `<button class="text-button" data-reset-password="${user.id}">修改密码</button>
                  ${['manager', 'sales'].includes(user.role) && user.active ? `<button class="text-button" data-start-impersonation="${user.id}">身份检查</button>` : ''}
                  <button class="text-button danger-text" data-archive-user="${user.id}">归档账号</button>`}
            </div>`
          : '<span class="subtle">无变更权限</span>',
      ]),
    );
    $('#archivedUserTable').innerHTML = table(
      ['用户', '角色', '归档时间', '操作'],
      archivedUsers.map(user => [
        `<div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>`,
        `<span class="pill gray">${roleLabel(user.role)}</span>`,
        shortDate(user.archivedAt, true),
        canMutate
          ? `<div class="assignment-actions"><button class="text-button" data-restore-user="${user.id}">恢复</button><button class="text-button danger-text" data-delete-user="${user.id}">永久删除</button></div>`
          : '<span class="subtle">无变更权限</span>',
      ]),
    );
    switchAccessSection(state.accessSection);
    renderPermissionGroups(canMutate);
    if (state.filterPermissionAdmin) renderFilterPermissionAdmin();
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
          canMutate
            ? `<button class="text-button" data-resolve-review="${esc(review.id)}">确认迁移</button>`
            : '<span class="subtle">无变更权限</span>',
        ];
      }),
    );
  }

  function renderManagerTaskSettings() {
    const panel = $('#managerTaskSettingsPanel');
    const form = $('#managerTaskSettingsForm');
    if (!panel || !form) return;
    const user = state.data?.user || {};
    const allowed = user.role === 'admin' && isRealAdmin()
      && can('manage_manager_task_settings');
    panel.classList.toggle('hidden', !allowed);
    if (!allowed) return;
    const settings = state.data?.managerTaskSettings;
    if (!settings) {
      $('#managerTaskSettingsStatus').textContent = '正在读取主管介入规则…';
      return;
    }
    if (form.dataset.dirty === 'true'
        && form.dataset.settingsVersion === String(settings.version)) return;
    $('#managerTaskSettingsVersion').textContent = `v${Number(settings.version)}`;
    $('#managerTaskSettingsUpdatedAt').textContent = shortDate(settings.updatedAt, true);
    const rules = settings.rules || {};
    const grid = $('#managerTaskSettingsGrid');
    if (grid) {
      grid.innerHTML = [
        ['consecutiveDeferred', '连续暂未确定', '次', 'Count', rules.consecutiveDeferred],
        ['firstContactSilence', '首次触达后无二次动作', '天', 'Days', rules.firstContactSilence],
        ['plannedActionOverdue', '计划动作超时', '小时', 'Hours', rules.plannedActionOverdue],
      ].map(([key, label, unit, suffix, rule]) => `<fieldset class="manager-task-rule manager-rule-row">
        <div class="manager-task-rule-head"><div><strong>${esc(label)}</strong><span>达到阈值后创建主管协助事项</span></div><label class="check"><input name="${key}Enabled" type="checkbox" ${rule?.enabled ? 'checked' : ''}><span>启用</span></label></div>
        <div class="manager-task-rule-fields"><label>阈值（${esc(unit)}）<input name="${key}${suffix}" type="number" min="1" step="1" value="${Number(rule?.value || 1)}" required></label></div>
      </fieldset>`).join('') + `<fieldset class="manager-task-rule manager-rule-row manager-anomaly-rule">
        <div class="manager-task-rule-head"><div><strong>销售维度复盘</strong><span>只用于统计，不创建客户任务</span></div><label class="check"><input name="salesAnomalyEnabled" type="checkbox" ${rules.salesAnomaly?.enabled ? 'checked' : ''}><span>启用</span></label></div>
        <div class="manager-task-rule-fields"><label>活跃客户 M<input name="minActiveCustomers" type="number" min="1" step="1" value="${Number(rules.salesAnomaly?.minActiveCustomers || 10)}" required></label>
        <label>异常客户 K<input name="minAnomalousCustomers" type="number" min="1" step="1" value="${Number(rules.salesAnomaly?.minAnomalousCustomers || 3)}" required></label>
        <label>比例 R %<input name="anomalyRatioPercent" type="number" min="0.01" max="100" step="0.01" value="${Number(rules.salesAnomaly?.ratioPercent || 30)}" required></label></div>
      </fieldset>`;
    }
    const recipientRoot = $('#managerTaskSettingsRecipientList');
    if (recipientRoot) {
      const selected = new Set((settings.recipientIds || []).map(String));
      const recipients = (state.data.users || []).filter(user =>
        user.active && !user.archived && ['admin', 'manager'].includes(user.role)
        && user.permissions?.resolve_manager_tasks);
      recipientRoot.innerHTML = recipients.length
        ? recipients.map(user => `<label class="check manager-task-recipient manager-recipient-option">
          <input name="recipientIds" type="checkbox" value="${esc(user.id)}" ${selected.has(String(user.id)) ? 'checked' : ''}>
          <span><strong>${esc(user.name)}</strong><small>${esc(roleLabel(user.role))}</small></span>
        </label>`).join('')
        : '<span class="subtle">暂无在职且有主管任务权限的接收人</span>';
    }
    $('#managerTaskSettingsStatus').textContent = `当前版本 v${Number(settings.version)} · 仅影响后续新判断`;
    form.dataset.settingsVersion = String(settings.version);
    form.dataset.dirty = 'false';
  }

  async function loadManagerTaskSettings() {
    if (!isRealAdmin() || !can('manage_manager_task_settings')) return;
    const response = await api('/api/sales-crm/manager-task-settings', {
      method: 'GET', preserveOnForbidden: true,
    });
    state.data.managerTaskSettings = response.settings;
    renderManagerTaskSettings();
  }

  async function saveManagerTaskSettings(form) {
    const payload = formPayload(form);
    const recipientIds = Array.from(form.querySelectorAll('input[name="recipientIds"]:checked'))
      .map(input => input.value);
    const status = $('#managerTaskSettingsStatus');
    const button = $('#managerTaskSettingsSave');
    if (button) button.disabled = true;
    if (status) status.textContent = '正在保存主管介入规则…';
    try {
      const response = await api('/api/sales-crm/manager-task-settings', {
        method: 'PATCH',
        preserveOnForbidden: true,
        body: JSON.stringify({
          expectedVersion: Number(form.dataset.settingsVersion),
          patch: {
            consecutiveDeferred: {
              enabled: Boolean(payload.consecutiveDeferredEnabled),
              value: Number(payload.consecutiveDeferredCount),
            },
            firstContactSilence: {
              enabled: Boolean(payload.firstContactSilenceEnabled),
              value: Number(payload.firstContactSilenceDays),
            },
            plannedActionOverdue: {
              enabled: Boolean(payload.plannedActionOverdueEnabled),
              value: Number(payload.plannedActionOverdueHours),
            },
            salesAnomaly: {
              enabled: Boolean(payload.salesAnomalyEnabled),
              minActiveCustomers: Number(payload.minActiveCustomers),
              minAnomalousCustomers: Number(payload.minAnomalousCustomers),
              ratioPercent: Number(payload.anomalyRatioPercent),
            },
            recipientIds,
          },
        }),
      });
      state.data.managerTaskSettings = response.settings;
      form.dataset.dirty = 'false';
      renderManagerTaskSettings();
      if (status) status.textContent = `已保存 v${Number(response.settings.version)} · ${shortDate(response.settings.updatedAt, true)}`;
      toast('主管介入规则已保存');
    } catch (error) {
      if (status) status.textContent = error.code === 'MANAGER_SETTINGS_VERSION_CONFLICT'
        ? '规则版本已变化，请刷新确认后再保存；当前输入已保留'
        : `${error.message}；当前输入已保留`;
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function switchAccessSection(section, { focus = false } = {}) {
    const allowedSections = ['accounts', 'permissions', 'governance'];
    const nextSection = allowedSections.includes(section) ? section : 'accounts';
    state.accessSection = nextSection;
    $$('[data-access-section]').forEach(button => {
      const selected = button.dataset.accessSection === nextSection;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    const panels = {
      accounts: $('#accessAccountsPanel'),
      permissions: $('#accessPermissionsPanel'),
      governance: $('#accessGovernancePanel'),
    };
    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('hidden', key !== nextSection);
    });
  }

  const assistantEngineLabels = {
    qwen: '通义千问', 'kimi-cli': 'Kimi', hermes: 'Hermes', deepseek: 'DeepSeek', auto: '自动',
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
      rows.innerHTML = ['qwen', 'kimi-cli', 'hermes', 'deepseek'].map(engine => `<div class="assistant-runtime-row"><strong>${assistantEngineLabels[engine]}</strong><span>等待状态</span><span>—</span><span>—</span><span>—</span></div>`).join('');
      return;
    }
    mode.value = runtime.mode || 'auto';
    const active = runtime.activeEngine ? `当前优先使用 ${assistantEngineLabels[runtime.activeEngine] || runtime.activeEngine}` : '当前没有健康引擎';
    status.textContent = state.assistantRuntimeError || `${assistantEngineLabels[runtime.mode] || runtime.mode}模式 · ${active}`;
    rows.innerHTML = ['qwen', 'kimi-cli', 'hermes', 'deepseek'].map(engine => {
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
    qwen_online: '通义千问在线路由',
    qwen_batch: '通义千问夜间 Batch',
  };

  function syncBootstrapFeatures(features) {
    if (!state.data?.features || !features) return;
    state.data.features.aiStations = Boolean(features.ai_stations?.effectiveEnabled);
    state.data.features.customerEnrichment = Boolean(features.customer_enrichment?.effectiveEnabled);
    state.data.features.customerEnrichmentAutoTrigger = Boolean(features.customer_enrichment_auto_trigger?.effectiveEnabled);
    state.data.features.salesPack = Boolean(features.sales_pack?.effectiveEnabled);
    if (!customerEnrichmentAutoTriggerEnabled()) {
      state.data.features.customerEnrichmentAutoTrigger = false;
    }
    if (!customerEnrichmentEnabled()) {
      state.customerEnrichment = null;
      state.customerEnrichmentLastSuccess = null;
      state.customerEnrichmentError = '';
      state.customerEnrichmentPending = false;
    }
    if (!salesPackEnabled() && state.customerAi) {
      state.customerAi = { ...state.customerAi, salesPack: null };
    }
    state.aiTasks.items = (state.aiTasks.items || []).filter(task =>
      (task.taskType !== 'sales_pack' || salesPackEnabled())
      && (!task.enrichmentTask || customerEnrichmentEnabled()));
    if (!customerAIEnabled()) state.customerFilters.evaluationTags = [];
    stripDisabledAINotificationState();
    applyUser();
    populateFilters();
    renderAll();
    if ($('#customerDrawer')?.classList.contains('open')) {
      if (state.selectedCustomerId) renderDrawer();
      else closeDrawer();
    }
    if (state.view === 'aiTasks' && !customerAIEnabled()) switchView(firstAllowedBusinessView(), false);
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
      const previousAIEnabled = customerAIEnabled();
      const previousSalesPackEnabled = salesPackEnabled();
      const response = await api(`/api/sales-crm/ai/features/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      state.aiFeatures = response.features || state.aiFeatures;
      syncBootstrapFeatures(state.aiFeatures);
      const notificationGateChanged = previousAIEnabled !== customerAIEnabled()
        || previousSalesPackEnabled !== salesPackEnabled();
      if (notificationGateChanged
          && state.authorizedBusinessLists.notifications.filterMount) {
        await initializeAuthorizedBusinessFilters('notifications', { force: true });
      }
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

  const protectedStatusLabels = {
    protected: '保护中', activated: '已激活', withdrawn: '已撤回',
    previewed: '已预览', committing: '提交中', committed: '已提交', rolled_back: '已回滚',
    ready: '可提交', imported: '已导入', rejected: '不可执行', retry: '待补充', resolved: '已解决', pending: '待处理',
  };

  function protectedStatusMarkup(status) {
    const tone = ['rejected', 'withdrawn'].includes(status) ? 'red'
      : ['previewed', 'ready', 'retry', 'pending'].includes(status) ? 'amber' : '';
    return `<span class="pill ${tone}">${esc(protectedStatusLabels[status] || status || '未知')}</span>`;
  }

  function setProtectedInlineStatus(selector, status, message) {
    const root = $(selector);
    if (!root) return;
    root.className = `${root.id === 'protectedImportStatus' ? 'protected-operation-status' : 'protected-inline-status'}${status ? ` ${status}` : ''}`;
    root.textContent = message || '';
  }

  function protectedWritesAvailable() {
    return state.protectedCustomers.writeEnabled === true;
  }

  function renderProtectedWriteGate() {
    const gate = $('#protectedWriteGate');
    if (!gate) return;
    const enabled = protectedWritesAvailable();
    gate.className = `protected-gate ${enabled ? 'is-enabled' : 'is-disabled'}`;
    gate.textContent = enabled
      ? '保护客户写入已启用。提交、裁决、激活、资料修改和回滚都会写入受保护数据，请核对后操作。'
      : '生产写入未启用：当前可查看列表、下载模板和导出映射；预览、提交、裁决、激活、资料修改、重新扫描和回滚均已禁用。';
    ['protectedPreviewBtn', 'protectedCsvBtn', 'protectedAddRowBtn', 'protectedRescanBtn'].forEach(id => {
      const button = $(`#${id}`);
      if (button) button.disabled = !enabled || Boolean(state.protectedCustomers.pendingAction);
    });
  }

  function protectedImportRowMarkup(values = {}) {
    const fields = [
      ['alphaNickname', 'Alpha 昵称 *'], ['companyName', '正式公司名称'],
      ['country', '国家/地区'], ['city', '城市'], ['website', '官网'], ['industry', '行业'],
      ['customerType', '客户类型'], ['productFocus', '产品方向'],
    ];
    return `<div class="protected-import-row" data-protected-import-row>
      ${fields.map(([name, label]) => `<label>${label}<input data-protected-field="${name}" value="${esc(values[name] || '')}" ${name === 'alphaNickname' ? 'autocomplete="off"' : ''}></label>`).join('')}
      <button class="icon-button" type="button" data-remove-protected-row title="删除此行" aria-label="删除此行"><span data-tp-icon="close" aria-hidden="true"></span></button>
    </div>`;
  }

  function addProtectedImportRow(values = {}) {
    const root = $('#protectedImportRows');
    if (!root || !protectedWritesAvailable()) return;
    root.insertAdjacentHTML('beforeend', protectedImportRowMarkup(values));
    uiFormat?.mountIcons?.(root.lastElementChild);
  }

  function collectProtectedImportRows() {
    return $$('[data-protected-import-row]').map(row => {
      const value = {};
      row.querySelectorAll('[data-protected-field]').forEach(input => {
        value[input.dataset.protectedField] = input.value.trim();
      });
      return value;
    }).filter(row => Object.values(row).some(Boolean));
  }

  function protectedImportDraftKey() {
    return `tradepulse.protectedCustomerDraft.${state.data?.user?.id || 'anonymous'}`;
  }

  function saveProtectedImportDraft() {
    try { localStorage.setItem(protectedImportDraftKey(), JSON.stringify(collectProtectedImportRows())); }
    catch (_error) { /* Browser storage is optional; the live form still retains its values. */ }
  }

  function loadProtectedImportDraft() {
    try {
      const rows = JSON.parse(localStorage.getItem(protectedImportDraftKey()) || '[]');
      return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
    } catch (_error) { return []; }
  }

  function parseProtectedCustomerCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') {
        if (field) throw new Error(`CSV 第 ${records.length + 1} 行的引号位置无效`);
        quoted = true;
      } else if (char === ',') {
        record.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        record.push(field);
        if (record.some(value => value.trim())) records.push(record);
        record = [];
        field = '';
      } else field += char;
    }
    if (quoted) throw new Error('CSV 存在未闭合的双引号');
    record.push(field);
    if (record.some(value => value.trim())) records.push(record);
    if (!records.length) throw new Error('CSV 文件为空');
    const expected = ['alphaNickname', 'companyName', 'country', 'city', 'website', 'industry', 'customerType', 'productFocus'];
    const headers = records[0].map(value => value.trim());
    const duplicate = headers.find((header, index) => header && headers.indexOf(header) !== index);
    if (duplicate) throw new Error(`CSV 表头重复：${duplicate}`);
    const missing = expected.filter(header => !headers.includes(header));
    if (missing.length) throw new Error(`CSV 缺少表头：${missing.join('、')}`);
    const unknown = headers.filter(header => header && !expected.includes(header));
    if (unknown.length) throw new Error(`CSV 包含未知表头：${unknown.join('、')}`);
    const rows = records.slice(1).map((values, rowIndex) => {
      if (values.length > headers.length && values.slice(headers.length).some(value => value.trim())) {
        throw new Error(`CSV 第 ${rowIndex + 2} 行的列数超过表头`);
      }
      return Object.fromEntries(expected.map(header => [header, String(values[headers.indexOf(header)] || '').trim()]));
    }).filter(row => Object.values(row).some(Boolean));
    if (!rows.length) throw new Error('CSV 没有可导入的数据行');
    return rows;
  }

  async function loadProtectedCustomerCsv(file) {
    if (!file) return;
    try {
      const rows = parseProtectedCustomerCsv(await file.text());
      const root = $('#protectedImportRows');
      const existingRows = collectProtectedImportRows();
      if (!existingRows.length) root.innerHTML = '';
      rows.forEach(addProtectedImportRow);
      saveProtectedImportDraft();
      setProtectedInlineStatus('#protectedImportStatus', 'success', `已读取 ${file.name}：${rows.length} 行。请预览后再提交。`);
    } catch (error) {
      setProtectedInlineStatus('#protectedImportStatus', 'error', error.message);
    } finally {
      $('#protectedCsvInput').value = '';
    }
  }

  function renderProtectedCustomers() {
    const root = $('#protectedCustomerList');
    if (!root) return;
    const model = state.protectedCustomers;
    $('#protectedListCount').textContent = `${model.total || 0} 个客户`;
    renderPagination('#protectedCustomerPagination', 'protected_customers', {
      page: model.page, pageSize: model.pageSize, total: model.total, loading: model.loading,
    }, ({ page, pageSize }) => {
      model.pageSize = pageSize || model.pageSize;
      void loadProtectedCustomers({ page: page || 1 });
    });
    if (model.loading) {
      root.innerHTML = '<div class="empty">正在加载保护名单…</div>';
      setProtectedInlineStatus('#protectedListStatus', 'pending', '正在读取受保护数据…');
      return;
    }
    if (model.error) {
      root.innerHTML = '<div class="empty">保护名单加载失败，请重试。</div>';
      setProtectedInlineStatus('#protectedListStatus', 'error', model.error);
      return;
    }
    setProtectedInlineStatus('#protectedListStatus', model.loaded ? 'success' : '', model.loaded ? `已加载 ${model.total} 个保护客户` : '');
    if (!model.items.length) {
      root.innerHTML = '<div class="empty">当前筛选范围内没有保护客户</div>';
      return;
    }
    root.innerHTML = `<table><thead><tr><th>客户</th><th>正式公司名称</th><th>国家/地区</th><th>状态</th><th>稳定客户编号</th><th>创建/激活时间</th><th>操作</th></tr></thead><tbody>${model.items.map(item => `<tr>
      <td data-label="客户"><div class="protected-customer-name"><strong>${esc(item.alphaNickname || '—')}</strong><small>CRM 昵称：${esc(item.crmNickname || '—')}</small></div></td>
      <td data-label="正式公司名称">${esc(item.companyName || '—')}</td>
      <td data-label="国家/地区">${esc([item.country, item.city].filter(Boolean).join(' · ') || '—')}</td>
      <td data-label="状态">${protectedStatusMarkup(item.status)}</td>
      <td data-label="稳定客户编号"><strong>${esc(item.externalCustomerId || '—')}</strong><br><span class="subtle">批次 ${esc(item.batchId || '—')}</span></td>
      <td data-label="创建/激活时间">${esc(shortDate(item.createdAt, true))}${item.activatedAt ? `<br><span class="subtle">激活 ${esc(shortDate(item.activatedAt, true))}</span>` : ''}</td>
      <td data-label="操作"><div class="protected-row-actions">
        <button class="text-button" type="button" data-protected-profile="${esc(item.externalCustomerId)}">查看资料</button>
        ${item.status === 'protected' ? `<button class="text-button" type="button" data-protected-activate="${esc(item.externalCustomerId)}" ${protectedWritesAvailable() ? '' : 'disabled'}>激活分配</button>` : ''}
      </div></td>
    </tr>`).join('')}</tbody></table>`;
  }

  function renderProtectedBatch() {
    const root = $('#protectedBatchPreview');
    if (!root) return;
    const batch = state.protectedCustomers.batch;
    root.classList.toggle('hidden', !batch);
    if (!batch) return;
    const pending = state.protectedCustomers.pendingAction;
    const rows = Array.isArray(batch.rows) ? batch.rows : [];
    root.innerHTML = `<div class="protected-batch-summary">
      <div><strong>批次 ${esc(batch.batchId || '—')}</strong>${protectedStatusMarkup(batch.status)}<span>${rows.length} 行 · 已导入 ${Number(batch.imported || 0)} · 拒绝 ${Number(batch.rejected || 0)}</span></div>
      <div class="protected-batch-actions">
        <button class="button primary" type="button" data-protected-commit="${esc(batch.batchId)}" ${!protectedWritesAvailable() || pending || !rows.some(row => row.status === 'ready') ? 'disabled' : ''}>${pending === 'commit' ? '正在提交…' : '提交有效行'}</button>
        <button class="button secondary" type="button" data-protected-rollback="${esc(batch.batchId)}" ${!protectedWritesAvailable() || pending || batch.status !== 'committed' || !Number(batch.imported || 0) ? 'disabled' : ''}>条件回滚</button>
      </div>
    </div>
    <div class="protected-preview-table"><table><thead><tr><th>行号</th><th>Alpha 昵称</th><th>标准化结果</th><th>客户编号</th><th>状态</th><th>结果</th></tr></thead><tbody>${rows.map(row => `<tr>
      <td data-label="行号">${Number(row.rowNumber || 0)}</td><td data-label="Alpha 昵称">${esc(row.alphaNickname || '—')}</td>
      <td data-label="标准化结果">${esc(row.normalizedName || '—')}</td><td data-label="客户编号">${esc(row.externalCustomerId || '—')}</td>
      <td data-label="状态">${protectedStatusMarkup(row.status)}</td><td data-label="结果">${esc(row.errorMessage || (row.status === 'ready' ? '唯一身份检查通过，可以提交' : row.status === 'imported' ? '已创建稳定客户编号' : '—'))}</td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function renderProtectedConflictPagination() {
    if (state.pendingCenter.activeTab !== 'conflicts') return;
    const model = state.protectedCustomers;
    renderPagination('#pendingQueuePagination', 'protected_conflicts', {
      page: model.conflictPage, pageSize: model.conflictPageSize,
      total: model.conflictTotal, loading: model.conflictsLoading,
    }, ({ page, pageSize }) => {
      model.conflictPageSize = pageSize || model.conflictPageSize;
      void loadProtectedConflicts({ page: page || 1 });
    });
  }

  function protectedConflictSupplementFlags(info) {
    return [['contact', '联系人'], ['website', '官网'], ['industry', '行业']]
      .filter(([key]) => info?.[key])
      .map(([, label]) => label)
      .join('、');
  }

  function protectedConflictTargetExternalCustomerId(item, decision = 'link_existing') {
    if (decision !== 'link_existing') return '';
    const crmNames = Array.isArray(item && item.crmNames) ? item.crmNames : [];
    if (crmNames.length !== 1) return '';
    return String(crmNames[0] && crmNames[0].externalCustomerId || '');
  }

  // Pending-card decision options, gated to what the backend adjudication accepts
  // (Ruling 14): link_existing needs one CRM-side target; confirm_new is only
  // accepted by the backend once the conflict is no longer live; supplement_and_retry
  // is always available. Unavailable options stay visible but disabled with a
  // business-language hint so the manager never clicks into a dead-end error.
  function protectedConflictPendingOptions(item, model) {
    const linkTarget = protectedConflictTargetExternalCustomerId(item, 'link_existing');
    const live = (Array.isArray(item.leadExternalCustomerIds) && item.leadExternalCustomerIds.length > 0)
      || (Array.isArray(item.crmExternalCustomerIds) && item.crmExternalCustomerIds.length > 0);
    const locked = !protectedWritesAvailable() || model.conflictPendingId === item.conflictId;
    const option = (value, label, enabled, hint) => `<label class="duplicate-review-option${enabled ? '' : ' is-unavailable'}"><span class="duplicate-review-option-main"><input type="radio" name="conflict-decision-${esc(item.conflictId)}" value="${value}" ${!enabled || locked ? 'disabled' : ''}><strong>${label}</strong></span>${enabled ? '' : `<small>${hint}</small>`}</label>`;
    return [
      option('link_existing', '是同一个客户', Boolean(linkTarget), '请选择唯一可关联的已有客户'),
      option('confirm_new', '不是同一个客户', !live, '需先补充资料或等待证据变化后再确认'),
      option('supplement_and_retry', '资料还不够', true, ''),
    ].join('');
  }

  function protectedConflictComparisonMarkup(item) {
    const leadName = item.leadNames?.[0]?.rawName || item.leadNames?.[0]?.externalCustomerId || '待核验线索';
    const crmName = item.crmNames?.[0]?.rawName || item.crmNames?.[0]?.externalCustomerId || '';
    return `<div class="duplicate-review-comparison">
      <section class="duplicate-review-side submitted"><div class="duplicate-review-side-title"><span>这条新线索</span><strong>${esc(leadName)}</strong></div>${duplicateFacts([['客户编号', esc(item.leadNames?.[0]?.externalCustomerId || '—')]])}</section>
      <section class="duplicate-review-side existing"><div class="duplicate-review-side-title"><span>疑似已有客户</span><strong>${esc(crmName || '未识别')}</strong></div>${duplicateFacts([['客户编号', esc(item.crmNames?.[0]?.externalCustomerId || '—')]])}</section>
    </div>`;
  }

  function protectedConflictDecisionMarkup(item, model) {
    const candidates = Array.isArray(item.crmNames) ? item.crmNames : [];
    if (!candidates.length) {
      return `<div class="pending-evidence-empty">
        <strong>没有可比较的已有客户</strong>
        <p>补充官网、企业注册号、公司邮箱或所在国家后重新核验。</p>
      </div>
      <label class="pending-decision-option">
        <input type="radio" name="conflict-decision-${esc(item.conflictId)}" value="supplement_and_retry" checked>
        <span><strong>要求补充资料</strong><small>退回补充身份信息后重新核验</small></span>
      </label>`;
    }
    return `<div class="pending-comparison">${protectedConflictComparisonMarkup(item)}</div>
      <div class="pending-decision-options">${protectedConflictPendingOptions(item, model)}</div>`;
  }

  function protectedConflictDetailMarkup(item) {
    const model = state.protectedCustomers;
    const resolved = item.status === 'resolved';
    const retry = item.status === 'retry';
    const leadName = item.leadNames?.[0]?.rawName || item.leadNames?.[0]?.externalCustomerId || '待核验线索';
    const statusLabel = resolved ? (item.decision === 'link_existing' ? '已关联主客户' : '已确认为新身份') : retry ? '待补充资料' : '等待管理员核验';
    const supplementBlock = resolved && item.decision === 'link_existing' && item.complementaryInfo ? `<div class="protected-conflict-supplement">
      <span>可补充资料：${protectedConflictSupplementFlags(item.complementaryInfo)}</span>
      <button type="button" class="button secondary tiny" data-supplement-apply="${esc(item.conflictId)}" ${!protectedWritesAvailable() || model.conflictPendingId === item.conflictId ? 'disabled' : ''}>补充到主客户</button>
      <button type="button" class="button secondary tiny" data-supplement-skip="${esc(item.conflictId)}" ${!protectedWritesAvailable() || model.conflictPendingId === item.conflictId ? 'disabled' : ''}>暂不补充</button>
    </div>` : '';
    const noCandidates = !(Array.isArray(item.crmNames) && item.crmNames.length);
    const decisionBlock = (resolved || retry) ? `<div class="pending-comparison">${protectedConflictComparisonMarkup(item)}</div><div class="subtle">${statusLabel}</div>${supplementBlock}` : `
      ${protectedConflictDecisionMarkup(item, model)}
      <label id="conflictReasonField-${esc(item.conflictId)}" class="${noCandidates ? '' : 'hidden'}">需要补充的内容<textarea data-conflict-reason rows="2" maxlength="500" placeholder="例如：请补充官网与采购联系人"></textarea></label>
      <button class="button primary" type="button" data-save-protected-conflict="${esc(item.conflictId)}" ${!protectedWritesAvailable() || model.conflictPendingId === item.conflictId ? 'disabled' : ''}>保存并处理下一条</button>
      <p class="protected-operation-status" data-conflict-message role="status" aria-live="polite"></p>`;
    return `<section class="protected-conflict-detail" data-protected-conflict="${esc(item.conflictId)}">
      <header class="pending-detail-head"><div><span>身份冲突核验</span><h3>${esc(leadName)}</h3></div><span class="pill amber">${esc(statusLabel)}</span>${pendingNavigationMarkup()}<button class="text-button pending-detail-close" type="button" data-pending-detail-close>返回队列</button></header>
      <div class="duplicate-review-question"><strong>是不是同一个客户？</strong></div>
      ${decisionBlock}
    </section>`;
  }

  function duplicateEvidenceMarkup(candidate) {
    const reliable = Array.isArray(candidate?.reliableEvidence) ? candidate.reliableEvidence : [];
    const references = Array.isArray(candidate?.referenceSignals) ? candidate.referenceSignals : [];
    if (!reliable.length && !references.length) {
      return '<span class="pill amber">历史规则候选，建议先重算</span>';
    }
    return `${reliable.length ? `<div class="duplicate-evidence-group"><span>可靠证据</span><div>${reliable.map(item => `<span class="pill green">${esc(item.label || item.kind)}${item.value ? ` · ${esc(item.value)}` : ''}</span>`).join('')}</div></div>` : ''}
      ${references.length ? `<div class="duplicate-evidence-group"><span>仅供参考</span><div>${references.map(item => `<span class="pill gray">${esc(item.label || item.kind)}${item.value ? ` · ${esc(item.value)}` : ''}</span>`).join('')}</div></div>` : ''}`;
  }

  function duplicateFacts(items) {
    return `<dl class="duplicate-review-facts">${items.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value || '<span class="tp-empty-value">—</span>'}</dd></div>`).join('')}</dl>`;
  }

  function pendingRecordKey(type, item) {
    return type === 'conflicts' ? `conflict:${item.conflictId}` : `duplicate:${item.id}`;
  }

  function pendingQueueRecords() {
    let records;
    if (state.pendingCenter.activeTab === 'conflicts') {
      records = state.protectedCustomers.conflicts.map(item => ({
        key: pendingRecordKey('conflicts', item), type: 'conflicts', raw: item,
        name: item.leadNames?.[0]?.rawName || '待核验线索',
        reference: item.leadNames?.[0]?.externalCustomerId || '',
        risk: item.crmNames?.length ? '疑似已有客户' : '疑似重名',
        status: item.status === 'retry' ? '待补充资料' : item.status === 'resolved' ? '已解决' : '待管理员确认',
        time: item.createdAt || item.updatedAt || '',
      }));
    } else {
      records = state.duplicateReviews.items.map(item => ({
        key: pendingRecordKey('duplicates', item), type: 'duplicates', raw: item,
        name: item.input?.companyName || '未填写公司名称',
        reference: item.input?.externalCustomerId || item.id,
        risk: item.selectedCandidate?.customerId ? '疑似已有客户' : '证据不足',
        status: item.status === 'needs_info' ? '待补充资料' : item.status === 'pending' ? '待管理员确认' : '已解决',
        time: item.createdAt || '',
      }));
    }
    const query = state.pendingCenter.query.trim().toLocaleLowerCase('zh-CN');
    return query ? records.filter(item => `${item.name} ${item.reference}`.toLocaleLowerCase('zh-CN').includes(query)) : records;
  }

  function pendingSelectionIndex() {
    return pendingQueueRecords().findIndex(item => item.key === state.pendingCenter.selectedKey);
  }

  function movePendingSelection(delta) {
    const records = pendingQueueRecords();
    const current = pendingSelectionIndex();
    const next = Math.min(records.length - 1, Math.max(0, current + delta));
    if (records[next]) selectPendingRecord(records[next].key, { focus: true });
  }

  function selectPendingAfterMutation(previousIndex) {
    const records = pendingQueueRecords();
    if (!records.length) {
      state.pendingCenter.selectedKey = '';
      return;
    }
    const next = Math.min(Math.max(0, previousIndex), records.length - 1);
    selectPendingRecord(records[next].key, { focus: true });
  }

  function pendingNavigationMarkup() {
    const records = pendingQueueRecords();
    const index = pendingSelectionIndex();
    return `<nav class="pending-detail-navigation" aria-label="核验记录导航">
      <button class="button secondary tiny" type="button" data-pending-move="-1" ${index <= 0 ? 'disabled' : ''}>上一条</button>
      <span>${index >= 0 ? `${index + 1} / ${records.length}` : `0 / ${records.length}`}</span>
      <button class="button secondary tiny" type="button" data-pending-move="1" ${index >= records.length - 1 ? 'disabled' : ''}>下一条</button>
    </nav>`;
  }

  function ensurePendingSelection() {
    const records = pendingQueueRecords();
    if (state.pendingCenter.deepLinkUnavailable) return records;
    if (!records.some(item => item.key === state.pendingCenter.selectedKey)) {
      state.pendingCenter.selectedKey = records[0]?.key || '';
    }
    return records;
  }

  function selectPendingRecord(key, { openMobile = false, focus = false } = {}) {
    const record = pendingQueueRecords().find(item => item.key === key);
    if (!record) return false;
    state.pendingCenter.deepLinkUnavailable = false;
    state.pendingCenter.selectedKey = record.key;
    state.pendingCenter.mobileDetailOpen = openMobile;
    if (record.type === 'conflicts') state.protectedCustomers.expandedConflictId = record.raw.conflictId;
    else state.duplicateReviews.expandedId = record.raw.id;
    renderPendingQueue();
    renderPendingDetail();
    if (focus) requestAnimationFrame(() => document.querySelector(
      `[data-pending-record-key="${CSS.escape(record.key)}"]`,
    )?.focus());
    return true;
  }

  function renderPendingQueue() {
    const root = $('#pendingQueueList');
    if (!root) return;
    const records = ensurePendingSelection();
    const center = state.pendingCenter;
    const model = center.activeTab === 'conflicts' ? state.protectedCustomers : state.duplicateReviews;
    const loading = center.activeTab === 'conflicts' ? model.conflictsLoading : model.loading;
    const error = center.activeTab === 'conflicts' ? model.conflictsError : model.error;
    const search = $('#pendingQueueSearch');
    if (search && search.value !== center.query) search.value = center.query;
    $('#pendingWorkbench')?.classList.toggle('mobile-detail-open', center.mobileDetailOpen);
    if (loading && !records.length) {
      root.innerHTML = '<div class="empty">正在加载待核验记录…</div>';
      return;
    }
    if (error && !records.length) {
      root.innerHTML = '<div class="empty">核验记录加载失败，请刷新重试。</div>';
      return;
    }
    if (!records.length) {
      root.innerHTML = `<div class="empty">${center.query ? '当前页没有匹配的核验记录' : '当前没有待核验客户'}</div>`;
      return;
    }
    const interactionPending = Boolean(
      state.protectedCustomers.conflictPendingId
      || state.duplicateReviews.pendingAction
      || state.duplicateReviews.loading,
    );
    root.innerHTML = records.map(record => {
      const selected = record.key === center.selectedKey;
      const review = record.type === 'duplicates' ? record.raw : null;
      const checkbox = review ? `<label class="pending-queue-select" aria-label="选择 ${esc(record.name)}"><input type="checkbox" data-duplicate-review-select="${esc(review.id)}" ${state.duplicateReviews.selectedIds.has(review.id) ? 'checked' : ''} ${interactionPending || review.protectedExact ? 'disabled' : ''}></label>` : '';
      return `<div class="pending-queue-row${selected ? ' selected' : ''}">${checkbox}<button type="button" class="pending-queue-record" data-pending-record-key="${esc(record.key)}" aria-pressed="${selected}" ${interactionPending ? 'disabled' : ''}>
        <span class="pending-queue-record-main"><strong>${esc(record.name)}</strong><small>${esc(record.reference || '暂无编号')}</small></span>
        <span class="pending-queue-record-meta"><span class="pill amber">${esc(record.risk)}</span><span>${esc(record.status)}</span><time>${esc(record.time ? shortDate(record.time, true) : '—')}</time></span>
      </button></div>`;
    }).join('');
  }

  function duplicateReviewCandidateDecisionMarkup(review, interactionPending) {
    const candidate = review.selectedCandidate || {};
    const protectedExact = review.protectedExact === true;
    return `<label class="duplicate-review-option"><span class="duplicate-review-option-main"><input type="radio" name="duplicate-resolution-${esc(review.id)}" value="confirmed_same" data-duplicate-resolution="confirmed_same" data-review-id="${esc(review.id)}" data-candidate-id="${esc(candidate.customerId || '')}" ${candidate.customerId && !interactionPending && !protectedExact ? '' : 'disabled'}><strong>是同一个客户</strong></span><small>关联已有客户，不再分配成新客户。</small></label>
      <label class="duplicate-review-option"><span class="duplicate-review-option-main"><input type="radio" name="duplicate-resolution-${esc(review.id)}" value="confirmed_distinct" data-duplicate-resolution="confirmed_distinct" data-review-id="${esc(review.id)}" ${interactionPending || protectedExact ? 'disabled' : ''}><strong>不是同一个客户</strong></span><small>放行，主管可以继续分配。</small></label>
      <label class="duplicate-review-option"><span class="duplicate-review-option-main"><input type="radio" name="duplicate-resolution-${esc(review.id)}" value="needs_info" data-duplicate-resolution="needs_info" data-review-id="${esc(review.id)}" ${interactionPending || protectedExact ? 'disabled' : ''}><strong>资料还不够</strong></span><small>要求补充官网、联系人或来源说明。</small></label>`;
  }

  function duplicateReviewDecisionMarkup(review, interactionPending) {
    const candidate = review.selectedCandidate || {};
    if (!candidate.customerId) {
      return `<label class="pending-decision-option">
        <input type="radio" name="duplicate-resolution-${esc(review.id)}" value="needs_info" data-duplicate-resolution="needs_info" data-review-id="${esc(review.id)}" checked ${interactionPending ? 'disabled' : ''}>
        <span><strong>要求补充资料</strong><small>补充官网、联系人或来源说明后重新核验</small></span>
      </label>`;
    }
    return duplicateReviewCandidateDecisionMarkup(review, interactionPending);
  }

  function duplicateReviewDetailMarkup(review) {
    const model = state.duplicateReviews;
    const input = review.input || {};
    const candidate = review.selectedCandidate || {};
    const searchOpen = model.searchOpenId === review.id;
    const searchResults = model.searchResults[review.id] || [];
    const searchQuery = model.searchQueries[review.id] || '';
    const activeSearchIndex = Number(model.searchActiveIndexes[review.id] ?? -1);
    const searchListId = `duplicate-candidate-results-${review.id}`;
    const protectedExact = review.protectedExact === true;
    const interactionPending = Boolean(model.pendingAction || model.loading);
    return `<section class="duplicate-review-item expanded" data-duplicate-review-item="${esc(review.id)}" tabindex="-1">
      <header class="pending-detail-head"><div><span>重复客户核验</span><h3>${esc(input.companyName || '未填写公司名称')}</h3></div>${pendingNavigationMarkup()}<button class="text-button pending-detail-close" type="button" data-pending-detail-close>返回队列</button></header>
      <div class="duplicate-review-comparison">
        <section class="duplicate-review-side submitted">
          <div class="duplicate-review-side-title"><span>员工新提交</span><strong>${esc(input.companyName || '未填写公司名称')}</strong></div>
          ${duplicateFacts([
            ['官网', websiteMarkup(input.website)],
            ['国家 / 城市', esc([input.country, input.city].filter(Boolean).join(' · ') || '—')],
            ['行业', esc(input.industry || '—')],
            ['来源', esc(input.source || '—')],
          ])}
        </section>
        <section class="duplicate-review-side existing">
          <div class="duplicate-review-side-title"><span>疑似已有客户</span><strong>${esc(protectedExact ? '保护客户精确命中（详情受限）' : candidate.nickname || candidate.companyName || '没有可比较的已有客户')}</strong></div>
          ${duplicateFacts([
            ['正式名称', esc(candidate.companyName || '—')],
            ['官网', websiteMarkup(candidate.website)],
            ['客户编号', esc(candidate.customerId || '—')],
            ['国家 / 城市', esc([candidate.country, candidate.city].filter(Boolean).join(' · ') || '—')],
            ['负责人 / 阶段', esc(`${candidate.ownerName || '未分配'} · ${stageLabel(candidate.customerStage)}`)],
            ['行业', esc(candidate.industry || '—')],
          ])}
          <button class="text-button" type="button" data-toggle-duplicate-search="${esc(review.id)}" ${interactionPending || protectedExact ? 'disabled' : ''}>更换疑似客户</button>
          <div class="duplicate-candidate-search ${searchOpen ? '' : 'hidden'}">
            <input type="search" role="combobox" data-duplicate-candidate-search="${esc(review.id)}" value="${esc(searchQuery)}" autocomplete="off" placeholder="搜索客户昵称、公司名称、官网或客户编号" aria-label="搜索其他已有客户" aria-autocomplete="list" aria-controls="${esc(searchListId)}" aria-expanded="${searchOpen && searchResults.length ? 'true' : 'false'}" ${activeSearchIndex >= 0 ? `aria-activedescendant="${esc(searchListId)}-option-${activeSearchIndex}"` : ''} ${interactionPending ? 'disabled' : ''}>
            <div id="${esc(searchListId)}" class="duplicate-candidate-results" role="listbox">${searchResults.map((item, index) => `<button id="${esc(searchListId)}-option-${index}" type="button" role="option" aria-selected="${index === activeSearchIndex ? 'true' : 'false'}" data-duplicate-candidate-result="${esc(review.id)}" data-customer-id="${esc(item.customerId)}" ${interactionPending ? 'disabled' : ''}><strong>${esc(item.nickname || item.companyName)}</strong><span>${esc(item.companyName)} · ${esc(item.customerId)} · ${esc(item.ownerName || '未分配')} · ${esc(stageLabel(item.customerStage))}</span><span>${esc(uiFormat.website(item.website)?.label || '暂无官网')}</span></button>`).join('') || '<span class="subtle">输入至少两个字符开始搜索</span>'}</div>
          </div>
        </section>
      </div>
      <div class="duplicate-review-question"><strong>是不是同一个客户？</strong></div>
      <div class="duplicate-review-evidence"><strong>匹配依据</strong><div>${protectedExact ? '<span class="pill red">官网主域名或规范名称精确命中保护客户，禁止人工放行</span>' : duplicateEvidenceMarkup(candidate)}</div></div>
      <div class="duplicate-review-options">${duplicateReviewDecisionMarkup(review, interactionPending)}</div>
      <footer class="duplicate-review-actions">
        <button class="button primary" type="button" data-duplicate-resolution-save="${esc(review.id)}" data-candidate-id="${esc(candidate.customerId || '')}" ${interactionPending || protectedExact ? 'disabled' : ''}>保存并处理下一条</button>
      </footer>
      <p class="protected-operation-status" data-duplicate-message role="status" aria-live="polite"></p>
    </section>`;
  }

  function renderPendingDetail() {
    const root = $('#pendingDetail');
    if (!root) return;
    if (state.pendingCenter.deepLinkUnavailable) {
      root.innerHTML = '<div class="empty">核验记录不可用或无权查看</div>';
      return;
    }
    const record = ensurePendingSelection().find(item => item.key === state.pendingCenter.selectedKey);
    if (!record) {
      root.innerHTML = '<div class="empty">从左侧队列选择一条核验记录</div>';
      return;
    }
    root.innerHTML = record.type === 'conflicts'
      ? protectedConflictDetailMarkup(record.raw)
      : duplicateReviewDetailMarkup(record.raw);
  }

  function setPendingDetailMutationState(pending) {
    const root = $('#pendingDetail');
    if (!root) return;
    root.querySelectorAll('button, input, textarea, select').forEach(control => {
      if (pending) {
        control.dataset.pendingWasDisabled = control.disabled ? 'true' : 'false';
        control.disabled = true;
      } else if ('pendingWasDisabled' in control.dataset) {
        control.disabled = control.dataset.pendingWasDisabled === 'true';
        delete control.dataset.pendingWasDisabled;
      }
    });
  }

  function showPendingDetailError(error) {
    const root = $('#pendingDetail');
    if (!root) return;
    root.classList.add('has-error');
    const message = root.querySelector('[data-conflict-message], [data-duplicate-message]');
    if (message) message.textContent = error?.message || '保存失败，请重试';
  }

  function pendingTabsAvailable() {
    return { conflicts: canManageProtectedCustomers(), duplicates: canReviewDuplicateCustomers() };
  }

  function activateProtectionView(view) {
    const allowed = new Set(['verification', 'directory', 'import']);
    const activeView = allowed.has(view) ? view : 'verification';
    state.protectionWorkspace.activeView = activeView;
    $$('[data-protection-view]').forEach(button => {
      const active = button.dataset.protectionView === activeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-protection-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.protectionPanel !== activeView);
    });
  }

  function activatePendingTab(type, options = {}) {
    const tabs = pendingTabsAvailable();
    const activeTab = tabs[type] ? type : (tabs.conflicts ? 'conflicts' : 'duplicates');
    if (activeTab !== state.pendingCenter.activeTab) {
      state.pendingCenter.query = '';
      state.pendingCenter.selectedKey = '';
      state.pendingCenter.mobileDetailOpen = false;
      state.pendingCenter.deepLinkUnavailable = false;
      const search = $('#pendingQueueSearch');
      if (search) search.value = '';
    }
    state.pendingCenter.activeTab = activeTab;
    $$('#pendingTypeTabs [data-pending-type]').forEach(button => {
      const isActive = button.dataset.pendingType === activeTab;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    $('#pendingTypeTabs')?.classList.toggle('hidden', !(tabs.conflicts && tabs.duplicates));
    $('#pendingConflictsToolbar')?.classList.toggle('hidden', activeTab !== 'conflicts');
    $('#pendingDuplicatesToolbar')?.classList.toggle('hidden', activeTab !== 'duplicates');
    $('#duplicateReviewBulkBar')?.classList.toggle('hidden', activeTab !== 'duplicates');
    const pagination = $('#pendingQueuePagination');
    if (pagination) pagination.dataset.pagination = activeTab === 'duplicates' ? 'duplicate_reviews' : 'protected_conflicts';
    if (!options.skipRender) renderPendingCenter();
  }

  function renderProtectedConflicts() {
    if (state.pendingCenter.activeTab !== 'conflicts') return;
    const model = state.protectedCustomers;
    const navCount = $('#navProtectedConflictCount');
    $('#pendingConflictsToolbar')?.classList.remove('hidden');
    renderProtectedConflictPagination();
    if (navCount) {
      navCount.textContent = model.blockingUnresolved || 0;
      navCount.classList.toggle('hidden', !model.blockingUnresolved);
    }
    if (model.conflictsLoading) {
      setProtectedInlineStatus('#pendingVerificationStatus', 'pending', '正在根据最新客户身份数据重新计算…');
    } else if (model.conflictsError) {
      setProtectedInlineStatus('#pendingVerificationStatus', 'error', model.conflictsError);
    } else {
      const summary = `待处理 ${model.unresolved} 项，其中线索提示 ${model.leadWarnings} 项、阻断冲突 ${model.blockingUnresolved} 项；${model.canEnter172B ? '当前无阻断冲突' : '需先处理阻断冲突'}`;
      setProtectedInlineStatus('#pendingVerificationStatus', model.canEnter172B ? 'success' : 'error', summary);
    }
    ensurePendingSelection();
    renderPendingQueue();
    renderPendingDetail();
  }

  function renderDuplicateReviews() {
    const allowed = canReviewDuplicateCustomers();
    if (!allowed) return;
    if (state.pendingCenter.activeTab !== 'duplicates') return;
    $('#pendingDuplicatesToolbar')?.classList.remove('hidden');
    $('#duplicateReviewBulkBar')?.classList.remove('hidden');
    const model = state.duplicateReviews;
    const interactionPending = Boolean(model.pendingAction || model.loading);
    const selected = model.selectedIds;
    const visibleIds = new Set(model.items.map(item => item.id));
    for (const reviewId of [...selected]) if (!visibleIds.has(reviewId)) selected.delete(reviewId);
    const selectableItems = model.items.filter(item => !item.protectedExact);
    for (const reviewId of [...selected]) {
      if (!selectableItems.some(item => item.id === reviewId)) selected.delete(reviewId);
    }
    $('#pendingVerificationStatus').textContent = model.error
      || (model.loading ? '正在读取待核验记录…' : model.loaded ? `待处理 ${model.total} 条` : '');
    $('#pendingVerificationStatus').className = `protected-inline-status${model.error ? ' error' : model.loading ? ' pending' : model.loaded ? ' success' : ''}`;
    $('#duplicateReviewSelectedCount').textContent = `已选 ${selected.size} 条`;
    $('#duplicateReviewBulkDistinct').disabled = !selected.size || interactionPending;
    $('#duplicateReviewSelectAll').checked = Boolean(selectableItems.length)
      && selectableItems.every(item => selected.has(item.id));
    $('#duplicateReviewSelectAll').indeterminate = selected.size > 0 && !$('#duplicateReviewSelectAll').checked;
    $('#duplicateReviewSelectAll').disabled = interactionPending || !selectableItems.length;
    $('#duplicateReviewRecalculate').disabled = interactionPending;
    $('#duplicateReviewRefresh').disabled = interactionPending;
    renderPagination('#pendingQueuePagination', 'duplicate_reviews', {
      page: model.page, pageSize: model.pageSize, total: model.total, loading: model.loading,
    }, ({ page, pageSize }) => {
      model.pageSize = pageSize || model.pageSize;
      void loadDuplicateReviews({ page: page || 1 });
    });
    ensurePendingSelection();
    renderPendingQueue();
    renderPendingDetail();
  }

  function renderPendingCenter() {
    const tabs = pendingTabsAvailable();
    activatePendingTab(state.pendingCenter.activeTab, { skipRender: true });
    $('#pendingVerificationPanel')?.classList.toggle('hidden', !canAccessProtectionAndDedupe());
    const badgeConflicts = $('[data-pending-count="conflicts"]');
    if (badgeConflicts) {
      badgeConflicts.textContent = state.protectedCustomers.conflictsLoaded
        ? String(state.protectedCustomers.unresolved || 0) : '…';
    }
    const badgeDuplicates = $('[data-pending-count="duplicates"]');
    if (badgeDuplicates) {
      badgeDuplicates.textContent = state.duplicateReviews.loaded
        ? String(state.duplicateReviews.total || 0) : '…';
    }
    if (tabs.conflicts && state.pendingCenter.activeTab === 'conflicts') renderProtectedConflicts();
    else if (tabs.duplicates && state.pendingCenter.activeTab === 'duplicates') renderDuplicateReviews();
  }

  function applyDuplicateReviewDeepLink() {
    const hash = String(location.hash || '');
    if (!hash.startsWith('#protectedCustomers')) return;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const conflictId = String(params.get('conflict') || '');
    const reviewId = String(params.get('review') || '');
    const customerId = String(params.get('customer') || '');
    if (!conflictId && !reviewId && !customerId) {
      state.pendingCenter.deepLinkUnavailable = false;
      return;
    }
    activateProtectionView('verification');
    if (conflictId) {
      if (!canManageProtectedCustomers()) {
        state.pendingCenter.selectedKey = '';
        state.pendingCenter.deepLinkUnavailable = true;
        renderPendingCenter();
        return;
      }
      activatePendingTab('conflicts', { skipRender: true });
      state.pendingCenter.query = '';
      const conflictModel = state.protectedCustomers;
      if (!conflictModel.conflictsLoaded) return;
      const matched = conflictModel.conflicts.find(item => item.conflictId === conflictId);
      if (matched) {
        selectPendingRecord(pendingRecordKey('conflicts', matched), { openMobile: true, focus: true });
        return;
      }
      state.pendingCenter.selectedKey = '';
      state.pendingCenter.mobileDetailOpen = true;
      state.pendingCenter.deepLinkUnavailable = true;
      renderPendingCenter();
      return;
    }
    if (!canReviewDuplicateCustomers()) {
      state.pendingCenter.selectedKey = '';
      state.pendingCenter.deepLinkUnavailable = true;
      renderPendingCenter();
      return;
    }
    activatePendingTab('duplicates', { skipRender: true });
    state.pendingCenter.query = '';
    const model = state.duplicateReviews;
    if (!model.loaded) return;
    const matched = model.items.find(item =>
      (reviewId && item.id === reviewId)
      || (customerId && String(item.input?.externalCustomerId || '') === customerId)
      || (customerId && String(item.input?.customerId || '') === customerId));
    if (matched) {
      selectPendingRecord(pendingRecordKey('duplicates', matched), { openMobile: true, focus: true });
      return;
    }
    state.pendingCenter.selectedKey = '';
    state.pendingCenter.mobileDetailOpen = true;
    state.pendingCenter.deepLinkUnavailable = true;
    renderPendingCenter();
  }

  async function loadDuplicateReviews({ page } = {}) {
    if (!canReviewDuplicateCustomers()) return;
    const model = state.duplicateReviews;
    const epoch = model.requestEpoch + 1;
    model.requestEpoch = epoch;
    model.loading = true;
    model.error = '';
    renderDuplicateReviews();
    try {
      const targetPage = Math.max(1, Number(page || model.page || 1));
      const result = await api(`/api/sales-crm/duplicate-reviews?${new URLSearchParams({
        status: 'pending', page: String(targetPage), pageSize: String(model.pageSize),
      })}`);
      if (model.requestEpoch !== epoch) return;
      model.items = result.reviews || [];
      model.total = Number(result.total || 0);
      model.page = Number(result.page || targetPage);
      model.pageSize = Number(result.pageSize || model.pageSize);
      model.totalPages = Number(result.totalPages || 0);
      model.loaded = true;
      applyDuplicateReviewDeepLink();
    } catch (error) {
      if (model.requestEpoch === epoch) model.error = error.message || '核验记录加载失败';
    } finally {
      if (model.requestEpoch === epoch) {
        model.loading = false;
        renderPendingCenter();
      }
    }
  }

  function restoreDuplicateSearchFocus(reviewId) {
    requestAnimationFrame(() => {
      const input = document.querySelector(
        `[data-duplicate-candidate-search="${CSS.escape(reviewId)}"]`,
      );
      if (!input) return;
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
    });
  }

  function invalidateDuplicateCandidateSearch(reviewId) {
    const model = state.duplicateReviews;
    clearTimeout(model.searchTimers[reviewId]);
    delete model.searchTimers[reviewId];
    model.requestEpochs[reviewId] = Number(model.requestEpochs[reviewId] || 0) + 1;
  }

  function searchDuplicateCandidates(reviewId, query) {
    const model = state.duplicateReviews;
    clearTimeout(model.searchTimers[reviewId]);
    const text = String(query || '');
    const epoch = Number(model.requestEpochs[reviewId] || 0) + 1;
    model.requestEpochs[reviewId] = epoch;
    model.searchQueries[reviewId] = text;
    model.searchActiveIndexes[reviewId] = -1;
    if (text.trim().length < 2) {
      model.searchResults[reviewId] = [];
      renderDuplicateReviews();
      restoreDuplicateSearchFocus(reviewId);
      return;
    }
    model.searchTimers[reviewId] = setTimeout(async () => {
      try {
        const result = await api(`/api/sales-crm/duplicate-reviews/${encodeURIComponent(reviewId)}/candidates?q=${encodeURIComponent(text.trim())}`);
        if (model.requestEpochs[reviewId] !== epoch) return;
        model.searchResults[reviewId] = result.candidates || [];
        model.searchActiveIndexes[reviewId] = -1;
        renderDuplicateReviews();
        restoreDuplicateSearchFocus(reviewId);
      } catch (error) {
        if (model.requestEpochs[reviewId] === epoch) toast(error.message);
      }
    }, 250);
  }

  async function chooseDuplicateCandidate(reviewId, customerId) {
    const model = state.duplicateReviews;
    if (model.pendingAction || model.loading) return;
    invalidateDuplicateCandidateSearch(reviewId);
    model.pendingAction = reviewId;
    renderDuplicateReviews();
    try {
      const result = await api(`/api/sales-crm/duplicate-reviews/${encodeURIComponent(reviewId)}/candidate`, {
        method: 'PATCH', body: JSON.stringify({ customerId }),
      });
      const index = model.items.findIndex(item => item.id === reviewId);
      if (index >= 0) model.items[index] = result.review;
      model.searchOpenId = '';
      model.searchResults[reviewId] = [];
      model.searchQueries[reviewId] = '';
      model.searchActiveIndexes[reviewId] = -1;
      toast('疑似客户已更换并记录审计');
    } finally {
      if (model.pendingAction === reviewId) model.pendingAction = '';
      renderDuplicateReviews();
    }
  }

  function focusDuplicateReview(index = 0) {
    const model = state.duplicateReviews;
    requestAnimationFrame(() => {
      const rows = $$('[data-duplicate-review-item]');
      rows[Math.min(Math.max(0, index), Math.max(0, rows.length - 1))]?.focus();
    });
  }

  async function reloadDuplicateReviewsAfterMutation(preferredIndex = 0) {
    const model = state.duplicateReviews;
    await loadDuplicateReviews({ page: model.page });
    const lastPage = Math.max(1, model.totalPages || 1);
    if (model.page > lastPage) await loadDuplicateReviews({ page: lastPage });
    return preferredIndex;
  }

  async function resolveDuplicateReviewAction(reviewId, resolution, candidateCustomerId = '', note = '') {
    const model = state.duplicateReviews;
    if (model.pendingAction || model.loading) return;
    if (resolution === 'confirmed_same'
        && !window.confirm('确认双方为同一客户？该结论会阻止新客户进入业务流程，但不会覆盖已有客户资料。')) return;
    if (resolution === 'needs_info' && !note) {
      openDuplicateNeedsInfoModal(reviewId);
      return;
    }
    const previousIndex = pendingSelectionIndex();
    const selectedKey = state.pendingCenter.selectedKey;
    let committed = false;
    model.pendingAction = reviewId;
    setPendingDetailMutationState(true);
    renderPendingQueue();
    try {
      const result = await api(`/api/sales-crm/duplicate-reviews/${encodeURIComponent(reviewId)}/resolve`, {
        method: 'POST', body: JSON.stringify({ resolution, candidateCustomerId, note }),
      });
      committed = true;
      model.selectedIds.delete(reviewId);
      toast(result.deduplicated
        ? '该记录已由其他操作处理，列表已刷新'
        : resolution === 'confirmed_same' ? '已确认同一客户'
          : resolution === 'needs_info' ? '已要求补充资料，记录等待补充'
            : '已确认不是同一客户并放行');
      await reloadDuplicateReviewsAfterMutation(previousIndex);
      selectPendingAfterMutation(previousIndex);
      try {
        await Promise.all([
          loadAuthorizedBusinessPage('intake', { reset: true }),
          refreshTodayTasksAfterAction('查重核验结果已同步到线索池'),
        ]);
      } catch (refreshError) {
        toast(refreshError?.message || '线索池刷新失败，请稍后手动刷新');
      }
      return result;
    } catch (error) {
      state.pendingCenter.selectedKey = selectedKey;
      showPendingDetailError(error);
      throw error;
    } finally {
      if (model.pendingAction === reviewId) {
        model.pendingAction = '';
        if (committed) renderDuplicateReviews();
        else {
          setPendingDetailMutationState(false);
          renderPendingQueue();
        }
      }
    }
  }

  async function resolveProtectedConflictAction(conflictId, payload = {}) {
    const model = state.protectedCustomers;
    const previousIndex = pendingSelectionIndex();
    const selectedKey = state.pendingCenter.selectedKey;
    let committed = false;
    model.conflictPendingId = conflictId;
    setPendingDetailMutationState(true);
    renderPendingQueue();
    try {
      const result = await api(`/api/sales-crm/protected-customer-conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          decision: payload.decision,
          targetExternalCustomerId: payload.targetExternalCustomerId || '',
          details: payload.details || '',
          expectedVersion: payload.expectedVersion || '',
        }),
      });
      committed = true;
      toast('裁决已保存');
      await reloadProtectedWorkspace();
      selectPendingAfterMutation(previousIndex);
      try {
        await Promise.all([
          loadAuthorizedBusinessPage('intake', { reset: true }),
          refreshTodayTasksAfterAction('身份核验结果已同步到线索池'),
        ]);
      } catch (refreshError) {
        toast(refreshError?.message || '线索池刷新失败，请稍后手动刷新');
      }
      return result;
    } catch (error) {
      state.pendingCenter.selectedKey = selectedKey;
      showPendingDetailError(error);
      throw error;
    } finally {
      if (model.conflictPendingId === conflictId) {
        model.conflictPendingId = '';
        if (committed) renderPendingCenter();
        else {
          setPendingDetailMutationState(false);
          renderPendingQueue();
        }
      }
    }
  }

  function openDuplicateNeedsInfoModal(reviewId) {
    openModal('信息不足，要求补充', '重复客户确认', `<form id="duplicateNeedsInfoForm" class="form-grid">
      <input type="hidden" name="reviewId" value="${esc(reviewId)}">
      <label class="span-2">需要补充的内容<textarea name="note" rows="3" maxlength="500" required placeholder="例如：请补充采购负责人姓名与官网备案信息"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">确认要求补充</button></div>
    </form>`);
  }

  async function bulkResolveDuplicateDistinctAction() {
    const model = state.duplicateReviews;
    if (model.pendingAction || model.loading) return;
    const reviewIds = [...model.selectedIds];
    if (!reviewIds.length) return;
    if (!window.confirm(`确认将选中的 ${reviewIds.length} 条全部判定为“不是同一客户”并放行？`)) return;
    const preferredIndex = Math.max(0, model.items.findIndex(item => reviewIds.includes(item.id)));
    let shouldFocus = false;
    model.pendingAction = 'bulk-distinct';
    renderDuplicateReviews();
    try {
      const result = await api('/api/sales-crm/duplicate-reviews/bulk-distinct', {
        method: 'POST', body: JSON.stringify({ reviewIds }),
      });
      reviewIds.forEach(reviewId => model.selectedIds.delete(reviewId));
      toast(`已新放行 ${result.resolvedCount} 条${result.deduplicatedCount ? `，${result.deduplicatedCount} 条此前已处理` : ''}`);
      await reloadDuplicateReviewsAfterMutation(preferredIndex);
      try {
        await loadAuthorizedBusinessPage('intake', { reset: true });
        await refreshTodayTasksAfterAction('查重核验结果已同步到线索池');
      } catch (refreshError) {
        toast(refreshError?.message || '线索池刷新失败，请稍后手动刷新');
      }
      shouldFocus = true;
    } finally {
      if (model.pendingAction === 'bulk-distinct') {
        model.pendingAction = '';
        renderDuplicateReviews();
        if (shouldFocus) focusDuplicateReview(preferredIndex);
      }
    }
  }

  async function recalculateDuplicateReviewAction() {
    const model = state.duplicateReviews;
    if (model.pendingAction || model.loading) return;
    if (!window.confirm('按当前规则重新计算全部待核验记录？无可靠候选会自动放行，但不会合并、删除或覆盖客户主档。')) return;
    model.pendingAction = 'recalculate';
    let shouldFocus = false;
    renderDuplicateReviews();
    try {
      const result = await api('/api/sales-crm/duplicate-reviews/recalculate', {
        method: 'POST', body: JSON.stringify({}),
      });
      toast(`重算完成：放行 ${result.releasedCount} 条，保留人工核验 ${result.retainedCount} 条`);
      model.selectedIds.clear();
      await loadDuplicateReviews({ page: 1 });
      shouldFocus = true;
    } finally {
      if (model.pendingAction === 'recalculate') {
        model.pendingAction = '';
        renderDuplicateReviews();
        if (shouldFocus) focusDuplicateReview(0);
      }
    }
  }

  function renderProtectedWorkspace() {
    if (!$('#protectedCustomersView') || !canAccessProtectionAndDedupe()) return;
    const canManage = canManageProtectedCustomers();
    $('#protectedAdminWorkspace')?.classList.toggle('hidden', !canManageProtectedCustomers());
    $$('[data-protection-view="directory"], [data-protection-view="import"]').forEach(button => {
      button.classList.toggle('hidden', !canManage);
    });
    if (!canManage) state.protectionWorkspace.activeView = 'verification';
    renderPendingCenter();
    activateProtectionView(state.protectionWorkspace.activeView);
    applyDuplicateReviewDeepLink();
    if (!canManage) return;
    renderProtectedWriteGate();
    renderProtectedCustomers();
    renderProtectedBatch();
    if (!$('#protectedImportRows').children.length && protectedWritesAvailable()) {
      const draft = loadProtectedImportDraft();
      if (draft.length) draft.forEach(addProtectedImportRow);
      else addProtectedImportRow();
    }
  }

  async function loadProtectedCustomers({ reset = false, page } = {}) {
    if (!canManageProtectedCustomers()) return;
    const model = state.protectedCustomers;
    model.loading = true;
    model.error = '';
    renderProtectedCustomers();
    try {
      const targetPage = reset ? 1 : Math.max(1, Number(page || model.page || 1));
      const params = new URLSearchParams({
        status: model.status, query: model.query,
        page: String(targetPage), pageSize: String(model.pageSize),
      });
      const result = await api(`/api/sales-crm/protected-customers?${params}`);
      model.items = result.items || [];
      model.total = Number(result.total || 0);
      model.page = Number(result.page || targetPage);
      model.pageSize = Number(result.pageSize || model.pageSize || 50);
      model.totalPages = Number(result.totalPages ?? Math.ceil(model.total / model.pageSize));
      model.hasMore = Boolean(result.hasMore);
      model.writeEnabled = result.writeEnabled === true;
      model.loaded = true;
      applyDuplicateReviewDeepLink();
    } catch (error) {
      model.error = error.message || '保护名单加载失败';
    } finally {
      model.loading = false;
      renderProtectedWorkspace();
    }
  }

  function applyProtectedConflictResult(result) {
    const model = state.protectedCustomers;
    model.conflicts = result.items || [];
    model.conflictTotal = Number(result.total || 0);
    model.conflictPage = Number(result.page || 1);
    model.conflictPageSize = Number(result.pageSize || 50);
    model.conflictTotalPages = Number(result.totalPages || 0);
    model.conflictHasMore = result.hasMore === true;
    model.unresolved = Number(result.unresolved || 0);
    model.leadWarnings = Number(result.leadWarnings || 0);
    model.blockingUnresolved = Number(result.blockingUnresolved || 0);
    model.canEnter172B = result.canEnter172B === true;
    model.conflictsLoaded = true;
  }

  async function loadProtectedConflicts({ rescan = false, page } = {}) {
    if (!canManageProtectedCustomers()) return;
    const model = state.protectedCustomers;
    const retainDraft = model.conflicts.length > 0;
    model.conflictsLoading = true;
    model.conflictsError = '';
    if (retainDraft) setProtectedInlineStatus('#pendingVerificationStatus', 'pending', '正在根据最新客户身份数据重新计算…');
    else renderProtectedConflicts();
    renderProtectedConflictPagination();
    let completed = false;
    try {
      const status = model.conflictStatus;
      const targetPage = Math.max(1, Number(page || model.conflictPage || 1));
      model.conflictPage = targetPage;
      const query = { status, page: String(targetPage), pageSize: String(model.conflictPageSize) };
      let result = rescan
        ? await api('/api/sales-crm/protected-customer-conflicts/rescan', { method: 'POST', body: JSON.stringify(query) })
        : await api(`/api/sales-crm/protected-customer-conflicts?${new URLSearchParams(query)}`);
      const lastPage = Math.max(1, Number(result.totalPages || 0));
      if (targetPage > lastPage) {
        model.conflictPage = lastPage;
        result = await api(`/api/sales-crm/protected-customer-conflicts?${new URLSearchParams({ status, page: String(lastPage), pageSize: String(model.conflictPageSize) })}`);
      }
      applyProtectedConflictResult(result);
      completed = true;
      applyDuplicateReviewDeepLink();
      if (rescan) toast('身份冲突已按最新资料重新扫描');
    } catch (error) {
      model.conflictsError = error.message || '身份冲突加载失败';
    } finally {
      model.conflictsLoading = false;
      if (completed || !retainDraft) renderPendingCenter();
      else setProtectedInlineStatus('#pendingVerificationStatus', 'error', model.conflictsError);
      renderProtectedConflictPagination();
    }
  }

  async function loadProtectedWorkspace() {
    if (!canAccessProtectionAndDedupe()) return;
    await Promise.all([
      ...(canReviewDuplicateCustomers() ? [loadDuplicateReviews()] : []),
      ...(canManageProtectedCustomers() ? [loadProtectedCustomers(), loadProtectedConflicts()] : []),
    ]);
  }

  async function previewProtectedBatch() {
    const rows = collectProtectedImportRows();
    if (!rows.length) throw new Error('请至少填写一行保护客户资料');
    const model = state.protectedCustomers;
    model.pendingAction = 'preview';
    setProtectedInlineStatus('#protectedImportStatus', 'pending', `正在检查 ${rows.length} 行资料…`);
    renderProtectedWriteGate();
    try {
      model.batch = await api('/api/sales-crm/protected-customers/batches/preview', {
        method: 'POST', body: JSON.stringify({ idempotencyKey: proposalRequestId(), rows }),
      });
      renderProtectedBatch();
      setProtectedInlineStatus('#protectedImportStatus', 'success', `预览完成：${model.batch.rows?.length || 0} 行，拒绝 ${model.batch.rejected || 0} 行。`);
      $('#protectedBatchPreview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      setProtectedInlineStatus('#protectedImportStatus', 'error', error.message);
      throw error;
    } finally {
      model.pendingAction = '';
      renderProtectedWriteGate();
      renderProtectedBatch();
    }
  }

  async function commitProtectedBatch(batchId) {
    const model = state.protectedCustomers;
    model.pendingAction = 'commit';
    setProtectedInlineStatus('#protectedImportStatus', 'pending', '正在逐行提交有效资料…');
    renderProtectedBatch();
    try {
      model.batch = await api(`/api/sales-crm/protected-customers/batches/${encodeURIComponent(batchId)}/commit`, {
        method: 'POST', body: JSON.stringify({ idempotencyKey: proposalRequestId() }),
      });
      setProtectedInlineStatus('#protectedImportStatus', 'success', `提交完成：导入 ${model.batch.imported || 0} 行，拒绝 ${model.batch.rejected || 0} 行。`);
      await loadProtectedCustomers();
    } catch (error) {
      setProtectedInlineStatus('#protectedImportStatus', 'error', error.message);
      throw error;
    } finally {
      model.pendingAction = '';
      renderProtectedBatch();
    }
  }

  async function rollbackProtectedBatch(batchId, reason) {
    const model = state.protectedCustomers;
    model.pendingAction = 'rollback';
    setProtectedInlineStatus('#protectedImportStatus', 'pending', '正在检查回滚条件…');
    renderProtectedBatch();
    try {
      await api(`/api/sales-crm/protected-customers/batches/${encodeURIComponent(batchId)}/rollback`, {
        method: 'POST', body: JSON.stringify({ idempotencyKey: proposalRequestId(), reason }),
      });
      model.batch = { ...model.batch, status: 'rolled_back' };
      setProtectedInlineStatus('#protectedImportStatus', 'success', '批次已回滚，稳定客户编号不会被复用。');
      await loadProtectedCustomers();
    } catch (error) {
      setProtectedInlineStatus('#protectedImportStatus', 'error', error.message);
      throw error;
    } finally {
      model.pendingAction = '';
      renderProtectedBatch();
    }
  }

  async function reloadProtectedWorkspace() {
    await loadProtectedConflicts();
  }

  async function supplementProtectedConflictAction(conflictId, action) {
    const model = state.protectedCustomers;
    model.conflictPendingId = conflictId;
    renderPendingCenter();
    try {
      const result = await api(`/api/sales-crm/protected-customer-conflicts/${encodeURIComponent(conflictId)}/supplement`, {
        method: 'POST', body: JSON.stringify({ action }),
      });
      toast(action === 'apply' ? '已补充到主客户' : '已记录暂不补充');
      model.conflictPendingId = '';
      await reloadProtectedWorkspace();
      return result;
    } catch (error) {
      if (model.conflictPendingId === conflictId) model.conflictPendingId = '';
      renderPendingCenter();
      throw error;
    }
  }

  async function downloadProtectedCsv(path, fallbackName) {
    if (!canManageProtectedCustomers()) throw new Error('只有真实管理员可以下载保护客户文件');
    const response = await fetch(`/api/sales-crm${path}`, { credentials: 'same-origin' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || '文件下载失败');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  async function openProtectedProfileModal(externalCustomerId) {
    const result = await api(`/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`);
    const item = result.customer || {};
    openModal(`保护资料 · ${item.alphaNickname || externalCustomerId}`, '客户保护资料', `<form id="protectedProfileForm" class="form-grid">
      <input type="hidden" name="externalCustomerId" value="${esc(externalCustomerId)}">
      <div class="protected-modal-fields">
        <label>正式公司名称<input name="companyName" value="${esc(item.companyName || '')}"></label>
        <label>CRM 昵称<input value="${esc(item.crmNickname || '')}" disabled></label>
        <label>国家/地区<input name="country" value="${esc(item.country || '')}"></label>
        <label>城市<input name="city" value="${esc(item.city || '')}"></label>
        <label class="span-2">官网<input name="website" value="${esc(item.website || '')}"></label>
        <label>行业<input name="industry" value="${esc(item.industry || '')}"></label>
        <label>客户类型<input name="customerType" value="${esc(item.customerType || '')}"></label>
        <label class="span-2">产品方向<textarea name="productFocus">${esc(item.productFocus || '')}</textarea></label>
        <p id="protectedProfileError" class="protected-modal-status"></p>
      </div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>关闭</button>${item.status === 'protected' ? `<button class="button primary" type="submit" ${protectedWritesAvailable() ? '' : 'disabled'}>保存资料</button>` : ''}</div>
    </form>`);
  }

  function openProtectedActivationModal(externalCustomerId) {
    const item = state.protectedCustomers.items.find(row => row.externalCustomerId === externalCustomerId) || {};
    const owners = state.data.users.filter(user => user.active && !user.archived && user.role === 'sales');
    openModal(`激活分配 · ${item.alphaNickname || externalCustomerId}`, 'PROTECTED CUSTOMER ACTIVATION', `<form id="protectedActivationForm" class="form-grid">
      <input type="hidden" name="externalCustomerId" value="${esc(externalCustomerId)}"><input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <div class="protected-modal-fields">
        <label>销售负责人 *<select name="ownerId" required><option value="">请选择</option>${owners.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}</select></label>
        <label>正式公司名称 *<input name="companyName" value="${esc(item.companyName || '')}" required></label>
        <label>国家/地区<input name="country" value="${esc(item.country || '')}"></label><label>城市<input name="city" value="${esc(item.city || '')}"></label>
        <label class="span-2">官网<input name="website" value="${esc(item.website || '')}"></label><label>行业<input name="industry" value="${esc(item.industry || '')}"></label>
        <label>客户类型<input name="customerType" value="${esc(item.customerType || '')}"></label><label class="span-2">产品方向<input name="productFocus" value="${esc(item.productFocus || '')}"></label>
        <label>优先级<select name="priority"><option value="A">A</option><option value="B" selected>B</option><option value="C">C</option></select></label><label>首次下一步<input name="nextAction" value="完成首次触达"></label>
        <p id="protectedActivationError" class="protected-modal-status"></p>
      </div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">确认激活并分配</button></div>
    </form>`);
  }

  function openProtectedRollbackModal(batchId) {
    openModal(`回滚保护批次 · ${batchId}`, 'CONDITIONAL ROLLBACK', `<form id="protectedRollbackForm" class="form-grid">
      <input type="hidden" name="batchId" value="${esc(batchId)}">
      <div class="maintenance-warning">只有尚未激活且不存在业务引用的保护客户可以回滚。回滚后稳定客户编号仍保留，不会重新分配。</div>
      <label>回滚原因<textarea name="reason" required placeholder="填写合同取消、录入错误等可审计原因"></textarea></label>
      <p id="protectedRollbackError" class="protected-modal-status"></p>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button danger" type="submit">确认条件回滚</button></div>
    </form>`);
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
      ['CRM联系人', counts.contacts], ['客户经营复盘', counts.evaluations], ['通知', counts.notifications],
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

  function filterPermissionTarget() {
    const admin = state.filterPermissionAdmin;
    const targetId = $('#filterPermissionTarget')?.value || '';
    if (!admin || !targetId) return null;
    return $('#filterPermissionScope')?.value === 'user'
      ? admin.users.find(item => item.id === targetId)
      : admin.permissionGroups.find(item => item.id === targetId);
  }

  function filterPermissionPrerequisites(definition, permissions = {}) {
    return (definition.requiredPermissions || []).every(key => Boolean(permissions[key]));
  }

  const filterDisplayModeLabels = {
    horizontal: '横向筛选',
    more: '更多筛选',
    date_range: '日期范围',
    hidden: '不显示',
  };

  function filterDisplayModeOptions(selected) {
    return Object.entries(filterDisplayModeLabels).map(([mode, label]) =>
      `<option value="${mode}" ${selected === mode ? 'selected' : ''}>${label}</option>`).join('');
  }

  function syncNewFilterDefinitionButton(admin = state.filterPermissionAdmin) {
    const button = $('#newFilterDefinitionBtn');
    if (!button) return;
    const available = admin?.availableSources || [];
    button.disabled = !admin || Boolean(state.data.impersonation) || !available.length;
    button.title = available.length
      ? `还有 ${available.length} 个可新增筛选数据源`
      : '暂无可新增的数据源';
  }

  function syncFilterPermissionTargets() {
    const admin = state.filterPermissionAdmin;
    const target = $('#filterPermissionTarget');
    const preview = $('#filterIdentityPreview');
    if (!admin || !target || !preview) return;
    const previousTarget = target.value;
    const scope = $('#filterPermissionScope')?.value === 'user' ? 'user' : 'group';
    const rows = scope === 'user' ? admin.users : admin.permissionGroups;
    target.innerHTML = rows.map(item =>
      `<option value="${esc(item.id)}">${esc(item.name)}${item.role ? ` · ${esc(roleLabel(item.role))}` : ''}</option>`,
    ).join('');
    if (rows.some(item => item.id === previousTarget)) target.value = previousTarget;
    preview.innerHTML = '<option value="">不预览具体身份</option>'
      + admin.users.map(item =>
        `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(roleLabel(item.role))}</option>`,
      ).join('');
    $('#filterPermissionRestore')?.classList.toggle('hidden', scope !== 'user');
  }

  function filterPermissionEffectiveKeys(user) {
    const admin = state.filterPermissionAdmin;
    if (!admin || !user) return new Set();
    const group = admin.permissionGroups.find(item => item.id === user.permissionGroupId);
    return new Set([...(group?.filterGrants || []), ...(user.extraFilterGrants || [])]);
  }

  function renderFilterPermissionAdmin() {
    const admin = state.filterPermissionAdmin;
    const root = $('#filterPermissionTable');
    const status = $('#filterPermissionStatus');
    if (!root || !status) return;
    syncNewFilterDefinitionButton(admin);
    if (!admin) {
      root.innerHTML = '';
      status.textContent = '正在加载筛选权限配置…';
      return;
    }
    const scope = $('#filterPermissionScope')?.value === 'user' ? 'user' : 'group';
    const target = filterPermissionTarget();
    if (!target) {
      root.innerHTML = '<div class="empty-state">暂无可配置目标</div>';
      status.textContent = `配置版本 v${admin.version}`;
      return;
    }
    const group = scope === 'user'
      ? admin.permissionGroups.find(item => item.id === target.permissionGroupId)
      : target;
    const inherited = new Set(scope === 'user' ? group?.filterGrants || [] : []);
    const selected = new Set(scope === 'user' ? target.extraFilterGrants || [] : target.filterGrants || []);
    const permissions = scope === 'user'
      ? (target.permissions || {})
      : (target.permissions || {});
    const previewId = $('#filterIdentityPreview')?.value || '';
    const previewUser = admin.users.find(item => item.id === previewId);
    const previewKeys = filterPermissionEffectiveKeys(previewUser);
    const definitions = [...admin.definitions].sort((left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
        || String(left.label).localeCompare(String(right.label), 'zh-CN'));
    root.innerHTML = `<div class="filter-permission-list">
      <div class="filter-permission-row filter-permission-header" aria-hidden="true">
        <strong>筛选项目</strong><strong>销售可使用</strong><strong>页面显示</strong>
        <strong>数据安全</strong><strong>定义操作</strong>
      </div>
      ${definitions.map(definition => {
        const isInherited = inherited.has(definition.key);
        const isSelected = selected.has(definition.key);
        const prerequisitesMet = filterPermissionPrerequisites(definition, permissions);
        const checked = isInherited || isSelected;
        const disabled = isInherited || !definition.enabled || !prerequisitesMet;
        const previewed = previewUser && previewKeys.has(definition.key)
          && definition.enabled
          && filterPermissionPrerequisites(definition, previewUser.permissions || {});
        return `<div class="filter-permission-row ${definition.enabled ? '' : 'is-disabled'}">
          <div class="filter-permission-name">
            <strong>${esc(definition.label)}</strong><small>${esc(definition.key)}</small>
          </div>
          <label class="filter-permission-check">
            <input type="checkbox" data-filter-grant="${esc(definition.key)}"
              ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
            <span>${definition.enabled ? '允许使用' : '已全局停用'}</span>
          </label>
          <div><span class="pill gray">${esc(filterDisplayModeLabels[definition.displayMode] || definition.displayMode)}</span></div>
          <div class="filter-permission-badges">
            <span class="pill ${definition.sensitive ? 'amber' : 'gray'}">${definition.sensitive ? '敏感字段' : '普通字段'}</span>
            ${scope === 'user' && isInherited ? '<span class="pill">权限组设置</span>' : ''}
            ${scope === 'user' && !prerequisitesMet ? '<span class="pill red">缺少字段权限</span>' : ''}
            ${previewUser ? `<span class="pill ${previewed ? '' : 'gray'}">${previewed ? '预览可见' : '预览隐藏'}</span>` : ''}
          </div>
          <div class="filter-permission-row-actions">
            <button class="text-button" type="button"
              data-edit-filter-definition="${esc(definition.key)}">编辑定义</button>
            <button class="text-button ${definition.enabled ? 'danger-text' : ''}" type="button"
              data-toggle-filter-definition="${esc(definition.key)}"
              data-filter-enabled="${definition.enabled ? 'true' : 'false'}">
              ${definition.enabled ? '全局停用' : '全局启用'}
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
    const previewText = previewUser
      ? `；身份预览：${previewUser.name} 当前可见 ${definitions.filter(item =>
        previewKeys.has(item.key)
          && item.enabled
          && filterPermissionPrerequisites(item, previewUser.permissions || {})).length} 项`
      : '';
    status.textContent = `配置版本 v${admin.version}；${scope === 'user' ? '个人调整仅可追加，权限组已有项不可取消' : '权限组基础范围'}${previewText}`;
    $('#filterPermissionSave').disabled = Boolean(state.data.impersonation);
  }

  async function loadFilterPermissionAdmin({ force = false } = {}) {
    if (!can('manage_users') || state.data.impersonation) return;
    if (state.filterPermissionAdmin && !force) {
      renderFilterPermissionAdmin();
      return;
    }
    renderFilterPermissionAdmin();
    const result = await api('/filter-permissions');
    state.filterPermissionAdmin = result;
    syncFilterPermissionTargets();
    renderFilterPermissionAdmin();
  }

  function selectedFilterPermissionKeys() {
    return Array.from($('#filterPermissionTable')?.querySelectorAll('[data-filter-grant]') || [])
      .filter(input => input.checked && !input.disabled)
      .map(input => input.dataset.filterGrant);
  }

  function invalidateAuthorizedFilterMounts() {
    state.customerRequestEpoch += 1;
    state.customerFilterMount?.destroy();
    state.customerFilterMount = null;
    state.customerFilterController = null;
    resetResearchState();
    resetAuthorizedBusinessLists();
  }

  async function saveFilterPermissions({ restore = false } = {}) {
    const admin = state.filterPermissionAdmin;
    const target = filterPermissionTarget();
    if (!admin || !target) return;
    const scope = $('#filterPermissionScope')?.value === 'user' ? 'user' : 'group';
    const path = scope === 'user'
      ? `/filter-permissions/users/${encodeURIComponent(target.id)}`
      : `/filter-permissions/groups/${encodeURIComponent(target.id)}`;
    const body = {
      expectedVersion: admin.version,
      filterKeys: selectedFilterPermissionKeys(),
      restore,
    };
    const button = restore ? $('#filterPermissionRestore') : $('#filterPermissionSave');
    const originalLabel = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = restore ? '正在恢复…' : '正在保存…';
    }
    try {
      await api(path, { method: 'PUT', body: JSON.stringify(body) });
      await loadFilterPermissionAdmin({ force: true });
      invalidateAuthorizedFilterMounts();
      toast(restore ? '已恢复权限组筛选设置' : '筛选权限已保存');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  async function toggleFilterDefinition(button) {
    const admin = state.filterPermissionAdmin;
    if (!admin) return;
    const filterKey = button.dataset.toggleFilterDefinition;
    const enabled = button.dataset.filterEnabled !== 'true';
    button.disabled = true;
    try {
      await api(`/filter-permissions/definitions/${encodeURIComponent(filterKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedVersion: admin.version,
          patch: { enabled },
        }),
      });
      await loadFilterPermissionAdmin({ force: true });
      invalidateAuthorizedFilterMounts();
      toast(enabled ? '筛选项已全局启用' : '筛选项已全局停用');
    } finally {
      button.disabled = false;
    }
  }

  async function runFilterPermissionAction(action) {
    try {
      await action();
    } catch (error) {
      const message = error?.message || '筛选权限操作失败';
      const status = $('#filterPermissionStatus');
      if (status) status.textContent = `操作失败：${message}`;
      toast(message);
    }
  }

  function openFilterDefinitionEditor(filterKey) {
    const definition = state.filterPermissionAdmin?.definitions
      .find(item => item.key === filterKey);
    if (!definition) return;
    openModal('编辑筛选定义', 'AUTHORIZED FILTER DEFINITION', `
      <form id="filterDefinitionForm" class="form-grid">
        <input type="hidden" name="filterKey" value="${esc(definition.key)}">
        <label>显示名称<input name="label" value="${esc(definition.label)}" maxlength="80" required></label>
        <label>字段类型<select name="type">
          ${['text', 'multi', 'date_range', 'tag_multi'].map(type =>
            `<option value="${type}" ${definition.type === type ? 'selected' : ''}>${type}</option>`).join('')}
        </select></label>
        <label>展示方式<select name="displayMode">
          ${filterDisplayModeOptions(definition.displayMode)}
        </select></label>
        <label>展示顺序<input name="sortOrder" type="number" min="-100000" max="100000" value="${esc(definition.sortOrder)}" required></label>
        <label class="span-2">可用运算符<input name="operators" value="${esc((definition.operators || []).join(','))}" required></label>
        <label class="check span-2"><input name="sensitive" type="checkbox" ${definition.sensitive ? 'checked' : ''}>标记为敏感字段</label>
        <div class="form-actions span-2">
          <button type="button" class="button secondary" data-close-modal>取消</button>
          <button class="button primary" type="submit">保存定义</button>
        </div>
      </form>`);
  }

  function syncFilterDefinitionSourceFields() {
    const form = $('#filterDefinitionCreateForm');
    const source = state.filterPermissionAdmin?.availableSources
      ?.find(item => item.key === form?.elements?.sourceKey?.value);
    if (!form || !source) return;
    form.elements.label.value = source.label || source.key;
    form.elements.displayMode.value = source.displayMode || 'horizontal';
    form.elements.sortOrder.value = Number(source.sortOrder || 0);
    form.elements.enabled.checked = true;
    form.elements.sensitive.checked = Boolean(source.sensitive);
    form.elements.sensitive.disabled = Boolean(source.sensitive);
    form.querySelector('[data-source-type]').value = source.type || '';
    form.querySelector('[data-source-operators]').value = (source.operators || []).join(', ');
    form.querySelector('[data-source-pages]').value = (source.pages || []).join(', ');
    form.querySelector('[data-source-permissions]').value = (source.requiredPermissions || []).join(', ') || '无额外要求';
  }

  function openFilterDefinitionCreator() {
    const sources = state.filterPermissionAdmin?.availableSources || [];
    if (!sources.length) {
      toast('暂无可新增的数据源');
      return;
    }
    openModal('新增筛选定义', 'AUTHORIZED FILTER DEFINITION', `
      <form id="filterDefinitionCreateForm" class="form-grid">
        <label class="span-2">服务端数据源<select id="filterDefinitionSource" name="sourceKey" required>
          ${sources.map(source => `<option value="${esc(source.key)}">${esc(source.label)} · ${esc(source.key)}</option>`).join('')}
        </select></label>
        <label>显示名称<input name="label" maxlength="80" required></label>
        <label>字段类型<input data-source-type readonly></label>
        <label>展示方式<select name="displayMode">${filterDisplayModeOptions(sources[0].displayMode)}</select></label>
        <label>展示顺序<input name="sortOrder" type="number" min="-100000" max="100000" required></label>
        <label>可用运算符<input data-source-operators readonly></label>
        <label>适用页面<input data-source-pages readonly></label>
        <label class="span-2">最低字段权限<input data-source-permissions readonly></label>
        <label class="check"><input name="enabled" type="checkbox" checked>创建后全局启用</label>
        <label class="check"><input name="sensitive" type="checkbox">标记为敏感字段</label>
        <label class="span-2">变更备注<input name="note" maxlength="200" placeholder="记录新增原因"></label>
        <p id="filterDefinitionCreateStatus" class="form-error span-2" role="alert" aria-live="polite"></p>
        <div class="form-actions span-2">
          <button type="button" class="button secondary" data-close-modal>取消</button>
          <button id="createFilterDefinitionSubmit" class="button primary" type="submit">新增定义</button>
        </div>
      </form>`);
    syncFilterDefinitionSourceFields();
  }

  function nicknameTarget(customer, {
    source = 'crm',
    crmCustomerId = '',
    intakeItemId = '',
  } = {}) {
    const externalCustomerId = sharedCustomerId(customer);
    if (!customer || !externalCustomerId) return null;
    return {
      source,
      crmCustomerId: String(crmCustomerId || customer.id || '').trim(),
      intakeItemId: String(intakeItemId || '').trim(),
      externalCustomerId,
      companyName: sharedCustomerOfficialName(customer),
      nickname: String(customer.nickname || '').trim(),
    };
  }

  function customerAllowsNicknameEdit(customer) {
    if (!customer || !can('edit_customer') || !sharedCustomerId(customer)) return false;
    const explicit = customer.can_edit_nickname ?? customer.canEditNickname;
    return explicit !== false;
  }

  function resetDrawerActions() {
    state.drawerNicknameTarget = null;
    const nicknameButton = $('#drawerNicknameBtn');
    const updateButton = $('#drawerUpdateBtn');
    nicknameButton?.classList.add('hidden');
    updateButton?.classList.add('hidden');
    if (nicknameButton) nicknameButton.disabled = true;
    if (updateButton) updateButton.disabled = true;
  }

  function configureDrawerActions({
    customer = null,
    source = 'crm',
    crmCustomerId = '',
    intakeItemId = '',
    allowActivity = false,
    readOnly = false,
    allowNickname = !readOnly,
  } = {}) {
    resetDrawerActions();
    const nicknameButton = $('#drawerNicknameBtn');
    const updateButton = $('#drawerUpdateBtn');
    if (!readOnly && allowActivity && crmCustomerId && can('record_activity')) {
      updateButton?.classList.remove('hidden');
      if (updateButton) updateButton.disabled = false;
    }
    if (allowNickname && customerAllowsNicknameEdit(customer)) {
      state.drawerNicknameTarget = nicknameTarget(customer, {
        source, crmCustomerId, intakeItemId,
      });
      nicknameButton?.classList.remove('hidden');
      if (nicknameButton) nicknameButton.disabled = false;
    }
  }

  async function openReturnedHistoryModal(crmCustomerId) {
    openModal('查看开发历史', 'READ ONLY', '<div class="empty">正在读取开发历史…</div>', 'returned-history-modal');
    try {
      const result = await api(`/api/sales-crm/accounts/${encodeURIComponent(crmCustomerId)}/history`, {
        preserveOnForbidden: true,
      });
      const account = result.account || {};
      const displayName = account.nickname || account.companyName || account.externalCustomerId;
      openModal('查看开发历史', 'READ ONLY', `
        <div class="returned-history-side">
          <div class="returned-history-head">
            <span class="pill gray">只读查看</span>
            <h3>${esc(displayName)}</h3>
            <p>${esc(account.externalCustomerId)} · ${esc(account.country || '地区未标注')} · ${esc(account.status || '历史客户')}</p>
          </div>
          <div class="timeline">${(result.timeline || []).map(event => `
            <div class="timeline-item"><h4>${esc(timelineEventTitle(event))}</h4>
              ${event.summary ? `<p>${esc(event.summary)}</p>` : ''}
              <time>${esc(event.actor_name || '')}${event.actor_name ? ' · ' : ''}${shortDate(event.occurred_at, true)}</time></div>`).join('') || '<div class="empty">暂无开发历史</div>'}
          </div>
          <div class="form-actions"><button type="button" class="button secondary" data-close-modal>关闭</button></div>
        </div>`, 'returned-history-modal');
    } catch (error) {
      closeModal();
      toast(error.message);
    }
  }

  function openCustomer(customerId) {
    const account = state.data.accounts.find(item => item.id === customerId);
    if (!account) {
      resetDrawerActions();
      return toast('当前客户不在可见范围内');
    }
    claimCustomerDrawer(`crm:${customerId}`);
    state.selectedCustomerId = customerId;
    state.drawerAiContext = null;
    renderDrawer();
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
  }

  function customerAiSection(context) {
    if (!customerAIEnabled() || !can('use_ai_assistant')) return '';
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
    if (!item) {
      resetDrawerActions();
      return toast('当前线索不在可见范围内');
    }
    claimCustomerDrawer(`intake:${itemId}`);
    const signals = intakeSignals(item);
    const showAssignmentDecisions = canViewAssignmentDecisions();
    const showAI = customerAIEnabled();
    const showAssignmentAI = showAI && showAssignmentDecisions;
    const layers = showAssignmentDecisions ? intakeDecisionLayers(item) : null;
    state.selectedCustomerId = '';
    state.recycleCustomerDetail = null;
    state.drawerAiContext = {
      companyName: item.company_name || '',
      intakeItemId: item.id,
      profileSummary: [
        `客户：${item.company_name || '未命名客户'}`,
        `地区：${item.country || '未标注'}`,
        `行业/类型：${[item.industry, item.customer_type].filter(Boolean).join(' · ') || '未标注'}`,
        `产品重点：${item.product_focus || '未标注'}`,
        ...(showAI ? [`Fit：${signals.fitScore} / ${signals.fitGrade}；readiness：${signals.readiness}；优先级：${signals.priority}`] : []),
        `联系人等级：${item.contact_level || 'L0'}；分配状态：${intakeStatusLabel(item.status)}`,
        ...(showAssignmentDecisions ? [`分配依据：${item.decision_reason || '暂无'}`] : []),
      ].join('\n'),
      view: state.view,
    };
    $('#drawerStage').textContent = intakeStatusLabel(item.status);
    $('#drawerCompany').textContent = accountDisplayName(item) || '未命名客户';
    $('#drawerMeta').textContent = [
      accountIdentity(item), item.country, item.industry, item.customer_type,
    ].filter(Boolean).join(' · ');
    configureDrawerActions({
      customer: item,
      source: 'intake',
      intakeItemId: item.id,
      readOnly: false,
    });
    const evidence = jsonList(item.evidence_urls).filter(url => /^https?:\/\//i.test(url));
    const customerTags = Array.isArray(item.customerTags) ? item.customerTags : [];
    const assignmentAction = showAssignmentDecisions && can('manage_intake')
      && ['pending', 'approved', 'assigned', 'returned'].includes(item.status)
      && !item.claimBlocked && !item.identityWarning
      ? `<button class="button primary" type="button" data-intake-assign="${esc(item.id)}">${item.status === 'assigned' ? '重新分配' : '分配客户'}</button>`
      : '';
    const developmentTimeline = item.developmentTimeline || [];
    const recommendation = intakeBlockStatusLabel(item)
      || item.reviewVagueHint
      || item.assignmentBlockReason
      || item.decision_reason
      || (showAI ? `${signals.fitGrade} · ${signals.priority}` : '')
      || '待人工判断';
    $('#drawerContent').innerHTML = `
      <div class="next-step"><div><span class="eyebrow">LEAD PROFILE</span><p>${esc(item.reviewVagueHint || '查看企业背景、需求依据和完整开发历史。')}</p></div><div class="assignment-actions"><span class="pill amber">${esc(intakeStatusLabel(item.status))}</span>${assignmentAction}</div></div>
      ${customerTags.length ? `<div class="customer-tag-row">${customerTags.map(tag => `<span class="pill gray">${esc(tag.name || tag)}</span>`).join('')}</div>` : ''}
      <div class="account-facts">
        ${[
          ['官网', item.website],
          ['联系人等级', item.contact_level],
          ['成立年份', item.established_year],
          ['来源', item.batch_source || item.source_file || '线索池'],
          ['更新时间', shortDate(item.master_updated_at || item.updated_at, true)],
          ['推荐结论', recommendation],
        ].map(([label, value]) => `<div class="fact"><span>${label}</span><strong>${esc(value || '—')}</strong></div>`).join('')}
      </div>
      <section class="master-profile">
        <div class="insight-head"><div><p class="eyebrow">CUSTOMER MASTER DATA</p><h3>企业背景与开发依据</h3></div><div class="assignment-actions"><button class="button secondary tiny" type="button" data-open-intake-master="${esc(item.id)}">查看完整资料</button>${item.report_url ? `<a class="text-button" href="${esc(item.report_url)}" target="_blank" rel="noopener">查看背调报告</a>` : ''}</div></div>
        <div class="master-profile-grid">
          <div class="wide"><span>企业背景</span><p>${esc(item.master_description || '暂无企业简介')}</p></div>
          <div><span>主营产品</span><p>${esc(item.master_products || item.product_focus || '暂无产品信息')}</p></div>
          <div><span>潜在需求</span><p>${esc(item.product_focus || item.master_products || '待进一步确认')}</p></div>
          ${item.status === 'returned' ? `<div class="wide"><span>退回原因</span><p>${esc(item.return_reason || '未填写')}</p></div>` : ''}
          <div class="wide"><span>研究与来源证据</span><p>${evidence.length ? evidence.map(url => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`).join('<br>') : esc(item.source_file || item.batch_source || '暂无关联证据')}</p></div>
        </div>
      </section>
      <section class="development-history">
        <div class="insight-head"><div><p class="eyebrow">DEVELOPMENT HISTORY</p><h3>开发历史</h3></div>${item.developmentHistory ? `<span class="pill ${item.developmentHistory.recycled ? 'amber' : ''}">${item.developmentHistory.recycled ? '曾退回线索池' : '历史已延续'}</span>` : ''}</div>
        <div class="timeline">${developmentTimeline.length ? developmentTimeline.map(event => `<div class="timeline-item"><h4>${esc(timelineEventTitle(event))}</h4>${event.summary ? `<p>${esc(event.summary)}</p>` : ''}<time>${esc(event.actor_name || event.actorName || '')}${event.actor_name || event.actorName ? ' · ' : ''}${shortDate(event.occurred_at || event.occurredAt, true)}</time></div>`).join('') : '<div class="empty">暂无开发历史</div>'}</div>
      </section>
      ${showAssignmentDecisions ? `<section class="decision-review">
        <div class="insight-head"><div><p class="eyebrow">ASSIGNMENT ARBITRATION</p><h3>${showAI ? '分配三层裁决' : '分配裁决'}</h3></div>${showAI ? `<span class="pill ${item.arbitration?.candidateSnapshotId ? '' : 'gray'}">${item.arbitration?.candidateSnapshotId ? '已绑定候选快照' : '无可用快照'}</span>` : ''}</div>
        <div class="decision-review-grid ${showAI ? '' : 'without-ai'}">${showAI ? layers.ai : ''}${layers.rule}${layers.manual}</div>
        <div class="decision-audit"><span class="eyebrow">AUDIT TRAIL</span>${intakeAuditMarkup(item)}</div>
      </section>` : ''}
      ${customerAiSection(state.drawerAiContext)}
    `;
    $('#customerDrawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    stopDrawerNextActionTimer();
    state.drawerRequestEpoch += 1;
    state.drawerOwner = '';
    state.mismatchRecordRequestEpoch += 1;
    state.mismatchRecordDetail = null;
    state.mismatchRecordExpanded = false;
    $('#customerDrawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('open');
    $('#customerDrawer').setAttribute('aria-hidden', 'true');
    state.recycleCustomerDetail = null;
    resetDrawerActions();
  }

  function evaluationCard(item) {
    const ai = !customerAIEnabled() ? '' : item.aiStatus === 'completed' ? `
      <div class="ai-analysis">
        <div class="ai-analysis-head"><span class="ai-badge">AI 标注</span><span>${esc(item.aiModel || 'AI')} · 基于客户经营复盘自动提取 · 非人工结论</span></div>
        ${item.aiSummary ? `<div class="evaluation-text">${esc(item.aiSummary)}</div>` : ''}
        <div class="ai-tag-row">${item.aiLabels.map(label => `<span class="ai-tag" title="${esc(label.rationale || '')}">AI · ${esc(label.name)}</span>`).join('')}</div>
        ${item.aiOrderKeys.length ? `<div class="ai-strategy"><strong>AI提取的赢单关键：</strong>${esc(item.aiOrderKeys.join('、'))}</div>` : ''}
        ${item.aiRisks.length ? `<div class="ai-strategy"><strong>AI提取的风险：</strong>${esc(item.aiRisks.join('、'))}</div>` : ''}
        ${item.aiStrategy ? `<div class="ai-strategy"><strong>AI建议：</strong>${esc(item.aiStrategy)}</div>` : ''}
      </div>` : item.aiStatus === 'failed' ? `<div class="ai-analysis"><div class="ai-analysis-head"><span class="ai-badge">AI 标注失败</span><button class="text-button" data-retry-evaluation="${item.id}">重新生成</button></div><span class="subtle">${esc(item.aiError || 'AI服务暂时不可用')}</span></div>`
        : '<div class="ai-analysis"><div class="ai-analysis-head"><span class="ai-badge">AI 分析中</span></div></div>';
    return `<article class="evaluation-card manager-note">
      <div class="evaluation-meta"><span>客户经营复盘 · ${esc(item.authorName)}</span><time>${shortDate(item.createdAt, true)}</time></div>
      <div class="evaluation-text">${esc(item.evaluationText)}</div>${ai}
    </article>`;
  }

  function renderRecycleDrawer(detail) {
    const account = detail.account || {};
    const master = detail.customerPool?.[0] || {};
    const recycle = detail.recycle || {};
    const activities = detail.activities || [];
    const rfqs = detail.rfqs || [];
    const quotes = detail.quotes || [];
    const orders = detail.orders || [];
    const timeline = detail.timeline || [];
    const insights = detail.insights || { contacts: [], evaluations: [] };
    const contacts = insights.contacts || [];
    const evaluations = insights.evaluations || [];
    const auditLog = detail.auditLog || [];
    const customerId = account.id || state.selectedCustomerId;
    const name = accountDisplayName(account) || master.companyName || '未命名客户';
    const recycleKindLabel = RECYCLE_KIND_LABELS[recycle.kind] || '其他';
    const history = timeline.length ? timeline : activities.map(item => ({
      title: activityMeta[item.activity_type]?.[0] || item.activity_type || '跟进记录',
      summary: item.summary || item.outcome || '',
      actor_name: item.user_name || item.userName || '',
      occurred_at: item.occurred_at || item.occurredAt,
      next_action: item.next_action || item.nextAction,
      no_plan: Number(item.no_plan || item.noPlan || 0),
    }));
    const canReassign = ['sales_return', 'mismatch'].includes(detail.recycle.kind)
      && detail.actions.includes('reassign');
    const canRestore = detail.recycle.kind === 'manual_delete'
      && detail.actions.includes('restore')
      && can('manage_manual_customer_deletion')
      && !state.data.impersonation;
    const sales = state.data.assignmentCandidates || [];
    const recycleAction = canReassign
      ? `<div class="assignment-actions"><select data-recycle-detail-owner="${esc(customerId)}">${sales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}</select><button class="button primary" type="button" data-reassign-customer="${esc(customerId)}">重新分配</button></div>`
      : canRestore
        ? `<button class="button secondary" type="button" data-restore-customer="${esc(customerId)}">恢复客户</button>`
        : '<span class="subtle">当前没有可执行操作</span>';
    const commerceGroups = [
      ['询价历史', rfqs, item => `${item.subject || item.summary || item.id || '询价'} · ${item.status || '—'} · ${shortDate(item.received_at || item.receivedAt, true)}`],
      ['报价历史', quotes, item => `${item.quote_no || item.quoteNo || item.id || '报价'} · ${money(item.amount)} · ${item.status || '—'} · ${shortDate(item.sent_at || item.sentAt, true)}`],
      ['订单历史', orders, item => `${item.order_no || item.orderNo || item.id || '订单'} · ${money(item.amount)} · ${item.status || '—'} · ${shortDate(item.ordered_at || item.orderedAt, true)}`],
    ];

    $('#drawerStage').textContent = '回收站客户';
    $('#drawerCompany').textContent = name;
    $('#drawerMeta').textContent = [accountIdentity(account), account.country, account.city, account.industry, account.customer_type].filter(Boolean).join(' · ');
    configureDrawerActions({
      customer: {
        ...account,
        canEditNickname: detail.canEditNickname
          ?? detail.profileAccess?.canEditNickname
          ?? detail.permissions?.canEditNickname
          ?? account.canEditNickname
          ?? account.can_edit_nickname,
      },
      source: 'recycle',
      crmCustomerId: customerId,
      allowNickname: true,
      readOnly: true,
    });
    $('#drawerContent').innerHTML = `
      <div class="next-step">
        <div><span class="eyebrow">RECYCLED CUSTOMER · READ ONLY</span><p>${esc(recycle.reason || '未填写回收原因')}</p></div>
        <span class="pill amber">${esc(recycleKindLabel)}</span>
      </div>
      <div class="account-facts">
        ${[
          ['当前状态', '回收站客户'], ['回收类型', recycleKindLabel],
          ['原负责人', recycle.previousOwnerName || '未分配'],
          ['回收操作人', recycle.recycledByName || recycle.recycledBy || '—'],
          ['回收时间', shortDate(recycle.recycledAt, true)],
          ['回收原因', recycle.reason || '—'],
          ['原阶段', stageLabel(account.stage)], ['CRM 客户编号', customerId],
          ['客户主档编号', account.external_customer_id || master.customerId || '—'],
        ].map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value || '—')}</strong></div>`).join('')}
      </div>
      <section class="master-profile">
        <div class="insight-head"><div><p class="eyebrow">CUSTOMER MASTER DATA</p><h3>客户主档</h3></div><span class="pill gray">只读</span></div>
        <div class="master-profile-grid">
          <div><span>企业简介</span><p>${esc(master.description || account.master_description || '暂无企业简介')}</p></div>
          <div><span>行业与客户类型</span><p>${esc([master.industry || account.industry, master.customerType || account.customer_type].filter(Boolean).join(' · ') || '未标注')}</p></div>
          <div><span>产品与潜在需求</span><p>${esc(master.products || account.product_focus || '未标注')}</p></div>
          <div><span>官网与地区</span><p>${esc([master.website || account.website, master.country || account.country, master.city || account.city].filter(Boolean).join(' · ') || '未标注')}</p></div>
        </div>
      </section>
      <div class="commerce-strip recycle-commerce-strip">
        <div class="commerce-card"><span>跟进</span><strong>${activities.length}</strong></div>
      </div>
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">CONTACT HISTORY</p><h3>联系人历史</h3></div><span class="panel-note">${contacts.length} 人</span></div>
        <div class="insight-body">${contacts.length ? contacts.map(contact => `<article class="contact-insight"><div class="contact-insight-head"><div><strong>${esc(contact.name || '未命名联系人')}</strong><span>${esc([contact.title, contact.department, contact.contactLevel].filter(Boolean).join(' · ') || '职位未标注')}</span></div></div><p>${esc([contact.email, contact.phone, contact.social].filter(Boolean).join(' · ') || '联系方式受权限保护或未记录')}</p></article>`).join('') : '<div class="empty">暂无联系人历史</div>'}</div>
      </section>
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">MANAGER INSIGHT</p><h3>客户经营复盘历史</h3></div><span class="panel-note">${evaluations.length} 条</span></div>
        <div class="insight-body">${evaluations.length ? evaluations.map(item => `<article class="evaluation-card manager-note"><div class="evaluation-meta"><span>${esc(item.subjectName || item.authorName || '客户经营复盘')}</span><time>${shortDate(item.createdAt, true)}</time></div><div class="evaluation-text">${esc(item.evaluationText || '—')}</div></article>`).join('') : '<div class="empty">暂无客户经营复盘</div>'}</div>
      </section>
      ${commerceGroups.map(([label, rows, describe]) => `<section class="insight-section"><div class="insight-head"><div><h3>${label}</h3></div><span class="panel-note">${rows.length} 条</span></div><div class="insight-body">${rows.length ? rows.map(item => `<div class="audit-line"><strong>${esc(describe(item))}</strong></div>`).join('') : '<div class="empty">暂无记录</div>'}</div></section>`).join('')}
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">FULL TIMELINE</p><h3>完整客户时间线</h3></div><span class="panel-note">${history.length} 条<button class="text-button" data-open-timeline-modal>展开完整时间线</button></span></div>
        <div class="timeline">${history.map(event => {
          const title = timelineEventTitle(event);
          const summary = timelineEventSummary(event);
          return `<div class="timeline-item"><h4>${esc(title)}</h4>${summary ? `<p>${esc(summary)}${event.no_plan ? '<br><strong>下一步：</strong>暂无计划' : (event.next_action && event.next_action !== summary ? `<br><strong>下一步：</strong>${esc(event.next_action)}` : '')}</p>` : ''}<time>${esc(event.actor_name || '')}${event.actor_name ? ' · ' : ''}${shortDate(event.occurred_at, true)}</time></div>`;
        }).join('') || '<div class="empty">暂无历史记录</div>'}</div>
      </section>
      <section class="insight-section">
        <div class="insight-head"><div><p class="eyebrow">AUDIT TRAIL</p><h3>客户审计历史</h3></div><span class="panel-note">${auditLog.length} 条</span></div>
        <div class="insight-body">${auditLog.length ? auditLog.map(item => `<div class="audit-line"><strong>${esc(item.action || '客户操作')}</strong><span>${esc(item.userName || item.actorName || item.user_id || '')}</span><time>${shortDate(item.createdAt || item.created_at, true)}</time></div>`).join('') : '<div class="empty">暂无审计记录</div>'}</div>
      </section>
      <div class="form-actions">${recycleAction}</div>`;
  }

  function correctionActivityId(event) {
    if (event?.activity_id) return String(event.activity_id);
    return String(event?.id || '').replace(/^activity:/, '');
  }

  function canStartActivityCorrection(event) {
    const activityId = correctionActivityId(event);
    const activity = (state.data?.activities || []).find(row => String(row.id) === activityId);
    const role = String(state.data?.user?.role || '');
    const authoredByUser = String(activity?.user_id || activity?.userId || event?.creatorId || event?.actorId || '')
      === String(state.data?.user?.id || '');
    const effective = activity && activity.effective !== false
      && !activity.supersededAt && !activity.superseded_by && !activity.supersededBy
      && !event?.superseded && event?.provenance?.kind !== 'superseded_original';
    return Boolean(activityId && activity && effective && can('correct_own_activity')
      && !state.data?.impersonation && (authoredByUser || role === 'admin')
    );
  }

  function renderActivityTimelineItem(event) {
    const provenance = event.provenance || {};
    const replacementCustomerId = provenance.replacementCustomerId || provenance.targetCustomerId || '';
    const replacementActivityId = provenance.replacementActivityId || '';
    const originalCustomerId = provenance.originalCustomerId || provenance.sourceCustomerId || '';
    const originalActivityId = provenance.originalActivityId || '';
    const replacementCustomer = replacementCustomerId
      ? (state.data?.accounts || []).find(row => [row.id, row.external_customer_id].map(String).includes(String(replacementCustomerId)))
      : null;
    const originalCustomer = originalCustomerId
      ? (state.data?.accounts || []).find(row => [row.id, row.external_customer_id].map(String).includes(String(originalCustomerId)))
      : null;
    let provenanceMarkup = '';
    if (provenance.kind === 'superseded_original' || event.superseded) {
      provenanceMarkup = `<span class="activity-correction-provenance superseded">已更正 · ${replacementCustomerId && replacementActivityId && replacementCustomer ? `目标客户：${esc(accountDisplayName(replacementCustomer))}` : '目标记录信息受权限保护'}</span>`;
    } else if (provenance.kind === 'replacement') {
      provenanceMarkup = `<span class="activity-correction-provenance replacement">更正自${originalCustomerId && originalActivityId && originalCustomer ? `来源客户：${esc(accountDisplayName(originalCustomer))}` : '受保护的来源记录'} · 当前记录有效</span>`;
    }
    const activityId = correctionActivityId(event);
    const correctionWriteReady = state.activityCorrection.writeEnabled === true;
    const correctionEntry = canStartActivityCorrection(event)
      ? `<button class="text-button activity-correction-entry" type="button" data-correct-activity="${esc(activityId)}" ${correctionWriteReady ? '' : `disabled aria-disabled="true" title="${state.activityCorrection.writeEnabled === false ? '更正功能尚未启用' : '正在检查更正功能状态'}"`}>更正归属客户</button>`
      : '';
    const title = timelineEventTitle(event);
    const summary = timelineEventSummary(event);
    return `<div class="timeline-item ${event.superseded ? 'is-superseded' : ''}" data-timeline-kind="${esc(event.kind || 'activity')}">
      <div class="activity-correction-timeline-head"><h4>${esc(title)}</h4>${correctionEntry}</div>
      ${summary ? `<p>${esc(summary)}${event.no_plan ? '<br><strong>下一步：</strong>暂无计划' : (event.next_action && event.next_action !== summary ? `<br><strong>下一步：</strong>${esc(event.next_action)}` : '')}</p>` : ''}
      ${provenanceMarkup}<time>${esc(event.actor_name || '')}${event.actor_name ? ' · ' : ''}${shortDate(event.occurred_at, true)}</time></div>`;
  }

  function timelineActivityFor(event) {
    const rows = state.data.activities || [];
    const activityId = event.activity_id
      || (String(event.id || '').startsWith('activity:') ? String(event.id).slice(9) : '');
    return rows.find(row => String(row.id) === String(activityId)) || {};
  }

  function renderTimelineEventDetail(event) {
    const activity = timelineActivityFor(event);
    const title = timelineEventTitle(event);
    const summary = timelineEventSummary(event);
    const progressLabel = activity.progressType
      ? (progressOption(activity.progressType)?.label || activity.progressType)
      : event.event_type || '—';
    const rows = [
      ['事件', title],
      ['进展类型', progressLabel],
      ['进展说明', activity.outcome || activity.summary || summary || '—'],
      ['客户反应', activity.reactionSnapshot || '—'],
      ['渠道', activity.channel || '—'],
      ['详细说明', summary || activity.summary || '—'],
      ['下一步', (activity.noPlan || event.no_plan) ? '暂无计划' : (activity.nextAction || event.next_action || '—')],
      ['计划时间', activity.nextActionAt || event.next_action_at || '—'],
      ['阶段变化', `${activity.stage_before || '—'} → ${activity.stage_after || '—'}`],
      ['操作人', event.actor_name || event.actorName || '—'],
      ['发生时间', shortDate(event.occurred_at || event.occurredAt, true)],
      ['主管协助', activity.managerRequired ? '需要协助' : '—'],
    ];
    const formatChange = value => Object.entries(value || {})
      .map(([key, item]) => `${key}：${item ?? '—'}`).join('、');
    const before = formatChange(event.before);
    const after = formatChange(event.after);
    if (before) rows.push(['变更前', before]);
    if (after) rows.push(['变更后', after]);
    return `<dl class="timeline-modal-facts">${rows.map(([label, value]) =>
      `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  }

  function openTimelineModal(events, options = {}) {
    state.timelineModalEvents = Array.isArray(events) ? events : [];
    const emptyText = String(options.emptyText || '暂无时间线记录');
    const list = state.timelineModalEvents.map((event, index) => {
      const title = timelineEventTitle(event);
      const summary = timelineEventSummary(event);
      return `<button type="button" class="timeline-modal-item" data-timeline-modal-index="${index}">
        <strong>${esc(title)}</strong><span>${esc(summary || '—')}</span>
        <time>${esc(event.actor_name || event.actorName || '')}${(event.actor_name || event.actorName) ? ' · ' : ''}${shortDate(event.occurred_at || event.occurredAt, true)}</time>
      </button>`;
    }).join('');
    const modalTitle = options.title
      || `完整客户时间线 · ${state.timelineModalEvents.length} 条`;
    const detail = state.timelineModalEvents.length
      ? renderTimelineEventDetail(state.timelineModalEvents[0])
      : `<div class="empty">${esc(emptyText)}</div>`;
    openModal(modalTitle, options.eyebrow || 'FULL TIMELINE', `<div class="timeline-modal-layout">
      <div class="timeline-modal-list">${list || `<div class="empty">${esc(emptyText)}</div>`}</div>
      <div id="timelineModalDetail" class="timeline-modal-detail">${detail}</div>
    </div>`, 'timeline-modal-wide');
  }

  async function openCustomerHistoryModal(account) {
    const title = `客户历史 · ${accountDisplayName(account)}`;
    openTimelineModal([], { title, eyebrow: 'CUSTOMER HISTORY', emptyText: '正在读取客户历史' });
    try {
      const result = await api(`/api/sales-crm/accounts/${encodeURIComponent(account.id)}/history`);
      const currentTimeline = (state.data.timeline || [])
        .filter(item => item.customer_id === account.id);
      const merged = new Map();
      [...currentTimeline, ...(result.timeline || [])].forEach((item, index) => {
        const key = String(item.id || `${item.kind || item.event_type || 'event'}:${item.occurred_at || item.occurredAt || ''}:${index}`);
        merged.set(key, item);
      });
      const events = [...merged.values()].sort((left, right) =>
        String(right.occurred_at || right.occurredAt || '').localeCompare(
          String(left.occurred_at || left.occurredAt || ''),
        ) || String(right.id || '').localeCompare(String(left.id || '')));
      openTimelineModal(events, { title, eyebrow: 'CUSTOMER HISTORY', emptyText: '暂无历史记录' });
    } catch (error) {
      openTimelineModal([], {
        title,
        eyebrow: 'CUSTOMER HISTORY',
        emptyText: `客户历史读取失败：${error.message}`,
      });
    }
  }

  function newActivityCorrectionIdempotencyKey() {
    return `activity-correction-ui:${state.data?.user?.id || 'user'}:${crypto.randomUUID()}`;
  }

  function activityCorrectionIdempotencyKey(payload = {}) {
    const fingerprint = JSON.stringify({
      originalActivityId: String(payload.originalActivityId || ''),
      targetCustomerId: String(payload.targetCustomerId || ''),
      reason: String(payload.reason || '').trim(),
    });
    if (fingerprint !== state.activityCorrection.requestFingerprint
        || !state.activityCorrection.idempotencyKey) {
      state.activityCorrection.requestFingerprint = fingerprint;
      state.activityCorrection.idempotencyKey = `activity-correction-ui:${state.data?.user?.id || 'user'}:${crypto.randomUUID()}`;
    }
    return state.activityCorrection.idempotencyKey;
  }

  function rotateActivityCorrectionIdempotencyKey() {
    state.activityCorrection.idempotencyKey = newActivityCorrectionIdempotencyKey();
  }

  function openActivityCorrectionModal(activityId, trigger = document.activeElement) {
    if (state.data?.impersonation || !can('correct_own_activity')) return toast('当前账号不能发起跟进归属更正');
    if (state.activityCorrection.writeEnabled !== true) {
      return toast(state.activityCorrection.writeEnabled === false
        ? '更正功能尚未启用'
        : '正在检查更正功能状态，请稍后重试');
    }
    const activity = (state.data?.activities || []).find(row => String(row.id) === String(activityId));
    const event = (state.data?.timeline || []).find(row => correctionActivityId(row) === String(activityId));
    if (!activity || !canStartActivityCorrection(event || { id: `activity:${activityId}` })) {
      return toast('该跟进记录当前不能更正');
    }
    const returnFocus = trigger || document.activeElement;
    Object.assign(state.activityCorrection, {
      draft: { activity, event: event || null }, step: 1,
      originalActivityId: String(activityId), sourceCustomerId: String(activity.customer_id || ''),
      targetCustomerId: '', reason: '',
      idempotencyKey: `activity-correction-ui:${state.data?.user?.id || 'user'}:${crypto.randomUUID()}`,
      requestFingerprint: '', returnFocus, targets: [], targetRows: [], targetPage: 1, targetTotal: 0,
    });
    renderActivityCorrectionModal();
    requestAnimationFrame(() => $('#activityCorrectionModal [autofocus]')?.focus());
  }

  function correctionStepMarkup(step) {
    return `<ol class="activity-correction-steps" aria-label="更正步骤">
      ${['选择正确客户', '填写更正原因', '确认更正'].map((label, index) => {
        const number = index + 1;
        return `<li class="${number === step ? 'active' : number < step ? 'done' : ''}" ${number === step ? 'aria-current="step"' : ''}><span>${number}</span>${label}</li>`;
      }).join('')}</ol>`;
  }

  function correctionCustomerLabel(customer) {
    return accountDisplayName(customer) || customer?.companyName || customer?.externalCustomerId || customer?.id || '未命名客户';
  }

  function renderActivityCorrectionTargetRows() {
    const root = $('#activityCorrectionTargets');
    if (!root) return;
    const correction = state.activityCorrection;
    root.innerHTML = correction.targetLoading && !correction.targets.length
      ? '<div class="empty">正在读取授权客户…</div>'
      : correction.targets.length
        ? correction.targets.map(customer => `<button class="activity-correction-target ${String(customer.id) === correction.targetCustomerId ? 'selected' : ''}" type="button" data-correction-target="${esc(customer.id)}" aria-pressed="${String(customer.id) === correction.targetCustomerId}"><strong>${esc(correctionCustomerLabel(customer))}</strong><span>${esc([customer.externalCustomerId, stageLabel(customer.stage)].filter(Boolean).join(' · '))}</span></button>`).join('')
        : '<div class="empty">当前筛选下没有可选客户</div>';
    const count = $('#activityCorrectionTargetCount');
    if (count) count.textContent = `已显示 ${correction.targets.length} / ${correction.targetTotal} 条（授权范围 ${correction.targetAuthorizedTotal} 条）`;
    renderPagination('#activityCorrectionTargetPagination', 'correction_targets', {
      page: correction.targetPage, pageSize: correction.targetPageSize,
      total: correction.targetTotal, loading: correction.targetLoading,
    }, ({ page, pageSize }) => {
      correction.targetPageSize = pageSize || correction.targetPageSize;
      void loadActivityCorrectionTargets({ page: page || 1 });
    });
    const next = $('#activityCorrectionNext');
    if (next) next.disabled = !correction.targetCustomerId;
  }

  function renderActivityCorrectionModal() {
    const correction = state.activityCorrection;
    if (correction.step !== 1 && correction.targetMount) {
      correction.targetMount.destroy();
      correction.targetMount = null;
      correction.targetController = null;
      correction.targetRequestEpoch += 1;
    }
    const activity = correction.draft?.activity || {};
    const source = (state.data?.accounts || []).find(row => String(row.id) === correction.sourceCustomerId) || {};
    const target = correction.targets.find(row => String(row.id) === correction.targetCustomerId)
      || (state.data?.accounts || []).find(row => String(row.id) === correction.targetCustomerId) || {};
    const activityTime = activity.occurred_at || activity.occurredAt || '';
    const step = correction.step;
    const status = '<p id="activityCorrectionStatus" class="activity-correction-status" role="alert" aria-live="polite"></p>';
    const stepAccessibility = 'aria-label="跟进归属更正三步流程"';
    let content = '';
    if (step === 1) {
      content = `<form id="activityCorrectionTargetForm" class="activity-correction-step" data-correction-step="1" ${stepAccessibility}>
        <div class="activity-correction-source"><span>来源客户</span><strong>${esc(correctionCustomerLabel(source))}</strong><small>活动时间：${shortDate(activityTime, true)}</small></div>
        <div id="activityCorrectionTargetFilters" class="authorized-filter-host" aria-live="polite"></div>
        <div class="activity-correction-result-meta"><strong>选择正确客户</strong><span id="activityCorrectionTargetCount"></span></div>
        <div id="activityCorrectionTargets" class="activity-correction-targets"></div>
        <div id="activityCorrectionTargetPagination" class="shared-pagination" data-pagination="correction_targets"></div>
        ${status}<div class="form-actions"><button class="button secondary" type="button" data-close-activity-correction>取消</button><button id="activityCorrectionNext" class="button primary" type="submit" disabled>下一步</button></div>
      </form>`;
    } else if (step === 2) {
      content = `<form id="activityCorrectionReasonForm" class="activity-correction-step" data-correction-step="2">
        <div class="activity-correction-route"><div><span>来源客户</span><strong>${esc(correctionCustomerLabel(source))}</strong></div><span aria-hidden="true">→</span><div><span>目标客户</span><strong>${esc(correctionCustomerLabel(target))}</strong></div></div>
        <label>填写更正原因<textarea name="reason" maxlength="2000" required autofocus placeholder="说明为什么这条跟进属于另一客户">${esc(correction.reason)}</textarea></label>
        ${status}<div class="form-actions"><button class="button secondary" type="button" data-correction-back="1">上一步</button><button class="button primary" type="submit">下一步</button></div>
      </form>`;
    } else {
      content = `<form id="activityCorrectionConfirmForm" class="activity-correction-step" data-correction-step="3">
        <div class="activity-correction-confirm"><div><span>来源客户</span><strong>${esc(correctionCustomerLabel(source))}</strong></div><div><span>目标客户</span><strong>${esc(correctionCustomerLabel(target))}</strong></div><div><span>活动时间</span><strong>${shortDate(activityTime, true)}</strong></div><div><span>更正原因</span><strong>${esc(correction.reason)}</strong></div></div>
        <div class="activity-correction-impact"><strong>业务影响</strong><p>原记录保留为审计历史，新记录进入目标客户；客户阶段、待办与统计将按有效记录重新计算。</p></div>
        ${correction.writeEnabled !== true ? `<div class="activity-correction-disabled">${correction.writeEnabled === false ? '更正功能尚未启用，当前只能查看历史和审批资料。' : '正在检查更正功能状态，请稍后再提交。'}</div>` : ''}
        ${status}<div class="form-actions"><button class="button secondary" type="button" data-correction-back="2">上一步</button><button id="activityCorrectionSubmit" class="button primary" type="submit" autofocus ${correction.writeEnabled !== true ? 'disabled aria-disabled="true"' : ''}>确认更正</button></div>
      </form>`;
    }
    openModal('更正跟进归属', 'ACTIVITY CORRECTION', `${correctionStepMarkup(step)}${content}`, 'activity-correction-modal');
    $('#modal .modal')?.setAttribute('id', 'activityCorrectionModal');
    if (step === 1) void initializeActivityCorrectionTargetFilters();
  }

  function closeActivityCorrectionModal() {
    const returnFocus = state.activityCorrection.returnFocus || state.modalReturnFocus;
    closeModal();
    Object.assign(state.activityCorrection, {
      draft: null, step: 1, originalActivityId: '', sourceCustomerId: '',
      targetCustomerId: '', reason: '', idempotencyKey: '', returnFocus: null,
      requestFingerprint: '',
      targets: [], targetRows: [], targetPage: 1, targetTotal: 0,
    });
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
  }

  function activityCorrectionQuery(controller, page, pageSize, extra = {}) {
    const payload = controller?.serialize('applied') || { permissionVersion: '', filters: [] };
    return new URLSearchParams({
      page: String(page), pageSize: String(pageSize),
      ...(controller ? { permissionVersion: String(payload.permissionVersion || '') } : {}),
      filters: JSON.stringify(componentPayloadToRaw(payload)), ...extra,
    });
  }

  function clearActivityCorrectionTargetResults() {
    const correction = state.activityCorrection;
    correction.targetRequestEpoch += 1;
    correction.targetMount?.destroy();
    Object.assign(correction, {
      targets: [], targetRows: [], targetPage: 1, targetTotal: 0,
      targetAuthorizedTotal: 0, targetHasMore: false, targetLoading: false,
      targetController: null, targetMount: null, targetCustomerId: '',
      idempotencyKey: '', requestFingerprint: '',
    });
    const root = $('#activityCorrectionTargetFilters');
    if (root) root.innerHTML = '';
    renderActivityCorrectionTargetRows();
  }

  function clearActivityCorrectionProposalResults() {
    const correction = state.activityCorrection;
    correction.proposalRequestEpoch += 1;
    correction.proposalMount?.destroy();
    Object.assign(correction, {
      proposalRows: [], proposalPage: 1, proposalTotal: 0,
      proposalAuthorizedTotal: 0, proposalHasMore: false, proposalLoading: false,
      proposalController: null, proposalMount: null, proposalCustomerId: '',
      reviewSubmitting: '',
    });
    correction.reviewKeys.clear();
    correction.reviewDrafts.clear();
    const filters = $('#activityCorrectionProposalFilters');
    if (filters) filters.innerHTML = '';
    const list = $('#activityCorrectionProposalList');
    if (list) list.innerHTML = '<div class="empty">进入页面后读取更正待处理</div>';
    const count = $('#activityCorrectionProposalCount');
    if (count) count.textContent = '';
    $('#activityCorrectionProposalMore')?.classList.add('hidden');
  }

  function clearActivityCorrectionHistoryResults() {
    const correction = state.activityCorrection;
    correction.historyRequestEpoch += 1;
    correction.historyMount?.destroy();
    Object.assign(correction, {
      historyRows: [], historyPage: 1, historyTotal: 0,
      historyAuthorizedTotal: 0, historyHasMore: false, historyLoading: false,
      historyController: null, historyMount: null,
    });
    const filters = $('#activityCorrectionHistoryFilters');
    if (filters) filters.innerHTML = '';
    const list = $('#activityCorrectionHistoryList');
    if (list) list.innerHTML = '<div class="empty">进入页面后读取更正历史</div>';
    const count = $('#activityCorrectionHistoryCount');
    if (count) count.textContent = '';
    $('#activityCorrectionHistoryMore')?.classList.add('hidden');
  }

  function resetActivityCorrectionState() {
    const correction = state.activityCorrection;
    correction.statusRequestEpoch += 1;
    clearActivityCorrectionTargetResults();
    clearActivityCorrectionProposalResults();
    clearActivityCorrectionHistoryResults();
    Object.assign(correction, {
      draft: null, step: 1, originalActivityId: '', sourceCustomerId: '',
      targetCustomerId: '', reason: '', idempotencyKey: '', returnFocus: null,
      requestFingerprint: '', writeEnabled: null,
    });
    const writeStatus = $('#activityCorrectionWriteStatus');
    if (writeStatus) {
      writeStatus.className = 'activity-correction-write-status';
      writeStatus.textContent = '正在读取更正功能状态…';
    }
    const proposalStatus = $('#activityCorrectionProposalStatus');
    if (proposalStatus) proposalStatus.textContent = '';
    const historyStatus = $('#activityCorrectionHistoryStatus');
    if (historyStatus) historyStatus.textContent = '';
  }

  function applyActivityCorrectionReadEnvelope(result = {}) {
    if (typeof result.writeEnabled === 'boolean') {
      const changed = state.activityCorrection.writeEnabled !== result.writeEnabled;
      state.activityCorrection.writeEnabled = result.writeEnabled;
      const status = $('#activityCorrectionWriteStatus');
      if (status) {
        status.classList.toggle('enabled', result.writeEnabled);
        status.classList.toggle('disabled', !result.writeEnabled);
        status.textContent = result.writeEnabled
          ? '更正写入已启用。所有操作都会保留不可变审计记录。'
          : '更正写入尚未启用。历史与审批资料保持可读，发起和审批按钮已停用。';
      }
      if (changed && state.selectedCustomerId) renderDrawer();
    }
    return result;
  }

  async function loadActivityCorrectionWriteStatus() {
    const correction = state.activityCorrection;
    const requestEpoch = ++correction.statusRequestEpoch;
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '1', filters: '{}' });
      const result = await api(`/activity-corrections?${params}`, { preserveOnForbidden: true });
      if (requestEpoch !== correction.statusRequestEpoch) return null;
      return applyActivityCorrectionReadEnvelope(result);
    } catch (error) {
      if (requestEpoch !== correction.statusRequestEpoch) return null;
      if (error.status === 403) {
        resetActivityCorrectionState();
        return null;
      }
      const status = $('#activityCorrectionWriteStatus');
      if (status) status.textContent = '暂时无法读取更正功能状态，写入入口保持停用。';
      return null;
    }
  }

  async function loadActivityCorrectionTargets({ reset = false, page } = {}) {
    const correction = state.activityCorrection;
    const requestEpoch = ++correction.targetRequestEpoch;
    correction.targetLoading = true;
    if (reset) { correction.targets = []; correction.targetRows = []; correction.targetPage = 1; }
    renderActivityCorrectionTargetRows();
    try {
      const targetPage = reset ? 1 : Math.max(1, Number(page || correction.targetPage || 1));
      const payload = correction.targetController?.serialize('applied') || { permissionVersion: '', filters: [] };
      const params = new URLSearchParams({
        page: String(targetPage), pageSize: String(correction.targetPageSize),
        ...(correction.targetController ? { permissionVersion: String(payload.permissionVersion || '') } : {}),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
        excludeCustomerId: correction.sourceCustomerId,
      });
      const result = await api(`/activity-correction-targets?${params}`, { preserveOnForbidden: true });
      if (requestEpoch !== correction.targetRequestEpoch) return null;
      applyActivityCorrectionReadEnvelope(result);
      const rows = result.rows || result.customers || [];
      correction.targets = rows;
      correction.targetRows = correction.targets;
      correction.targetPage = Number(result.page || targetPage);
      correction.targetTotal = Number(result.total || 0);
      correction.targetTotalPages = Number(result.totalPages
        ?? Math.ceil(correction.targetTotal / correction.targetPageSize));
      correction.targetAuthorizedTotal = Number(result.authorizedTotal || 0);
      correction.targetHasMore = Boolean(result.hasMore);
      if (result.schema && correction.targetController) correction.targetController.updateSchema(result.schema);
      correction.targetMount?.setResultMeta({ total: result.total, shown: correction.targets.length });
      renderActivityCorrectionTargetRows();
      if (correction.writeEnabled === false) {
        const status = $('#activityCorrectionStatus');
        if (status) status.textContent = '更正写入尚未启用；可以查看授权客户，但暂不能提交。';
      }
      return result;
    } catch (error) {
      if (requestEpoch !== correction.targetRequestEpoch) return null;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        const retainedReason = correction.reason;
        correction.targetCustomerId = '';
        correction.reason = retainedReason;
        await initializeActivityCorrectionTargetFilters({ force: true });
        return null;
      }
      if (error.status === 403) {
        clearActivityCorrectionTargetResults();
        const filters = $('#activityCorrectionTargetFilters');
        if (filters && window.TradePulseFilterComponent) {
          filters.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({
            status: 'error', error: '当前账号无权读取可更正客户',
          });
        }
      }
      const status = $('#activityCorrectionStatus');
      if (status) status.textContent = `${error.message}；当前选择与输入已保留。`;
      return null;
    } finally {
      if (requestEpoch === correction.targetRequestEpoch) {
        correction.targetLoading = false;
        renderActivityCorrectionTargetRows();
      }
    }
  }

  async function initializeActivityCorrectionTargetFilters({ force = false } = {}) {
    const root = $('#activityCorrectionTargetFilters');
    if (!root || !window.TradePulseFilterComponent) return;
    if (state.activityCorrection.targetMount && !force) return;
    state.activityCorrection.targetMount?.destroy();
    state.activityCorrection.targetMount = null;
    state.activityCorrection.targetController = null;
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    const result = await loadActivityCorrectionTargets({ reset: true });
    if (!result?.schema || !root.isConnected) return;
    const controller = window.TradePulseFilterComponent.createFilterController({
      storage: paginationFilterStorage,
      pageKey: 'activity_correction_targets', schema: result.schema,
      onApply: () => void loadActivityCorrectionTargets({ reset: true }),
    });
    state.activityCorrection.targetController = controller;
    state.activityCorrection.targetMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
      controller, resultMeta: { total: result.total, shown: state.activityCorrection.targets.length },
    });
    controller.updateSchema(result.schema);
    await loadActivityCorrectionTargets({ reset: true });
    root.querySelector('input,button')?.focus();
  }

  async function submitActivityCorrection() {
    const correction = state.activityCorrection;
    if (correction.draft?.submitting) return;
    const button = $('#activityCorrectionSubmit');
    const status = $('#activityCorrectionStatus');
    correction.draft.submitting = true;
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = '正在更正…'; }
    if (status) status.textContent = '正在提交并重算来源与目标客户…';
    try {
      const requestPayload = {
        originalActivityId: correction.originalActivityId,
        targetCustomerId: correction.targetCustomerId,
        reason: correction.reason,
      };
      const idempotencyKey = activityCorrectionIdempotencyKey(requestPayload);
      const result = await api('/activity-corrections', {
        method: 'POST', preserveOnForbidden: true,
        body: JSON.stringify({
          ...requestPayload,
          idempotencyKey,
        }),
      });
      if (result.correction) {
        await refreshAfterActivityCorrection(result.correction, '跟进归属已更正');
      } else if (result.proposal) {
        await refreshAfterActivityCorrection({
          ...result.proposal,
          sourceCustomerId: correction.sourceCustomerId,
          targetCustomerId: correction.targetCustomerId,
        }, '已提交主管或管理员审批');
      }
    } catch (error) {
      let message = `${error.message}；当前输入已保留。`;
      if (error.code === 'ACTIVITY_CORRECTIONS_DISABLED' || error.status === 503) {
        correction.writeEnabled = false;
        message = '更正功能尚未启用或暂不可用，当前输入已保留。';
      } else if (error.code === 'ACTIVITY_CORRECTION_FORBIDDEN' || error.status === 403) {
        message = '当前账号无权更正这条记录，草稿已保留。';
      } else if (error.code === 'ACTIVITY_CORRECTION_MAPPING_CHANGED') {
        message = '业务关联已变化，请刷新真实状态后重新确认；草稿已保留。';
      } else if (error.code === 'FILTER_VERSION_CONFLICT' || error.status === 409) {
        message = '记录或筛选权限已变化，请刷新后重新确认；草稿已保留。';
      }
      if (status) status.textContent = message;
      toast(message);
    } finally {
      if (correction.draft) correction.draft.submitting = false;
      if (button?.isConnected) {
        button.disabled = correction.writeEnabled === false;
        button.removeAttribute('aria-busy');
        button.textContent = '确认更正';
      }
    }
  }

  function canReviewActivityCorrections() {
    return ['admin', 'manager'].includes(String(state.data?.user?.role || ''))
      && can('manage_activity_corrections') && !state.data?.impersonation;
  }

  function correctionProposalCustomer(row, side) {
    return row[`${side}Nickname`] || row[`${side}CompanyName`]
      || row[`${side}ExternalCustomerId`] || row[`${side}CustomerId`] || '受保护客户';
  }

  function renderActivityCorrectionProposal(proposal) {
    const mappingResolution = proposal.mappingResolution || null;
    const candidates = mappingResolution?.candidates || [];
    const reviewDraft = state.activityCorrection.reviewDrafts.get(proposal.proposalId) || {};
    const resolutionOptions = candidates.map(candidate => {
      const value = candidate.mode === 'activity_only'
        ? 'activity_only||'
        : `commerce_entity|${candidate.entityType}|${candidate.entityId}`;
      const label = candidate.mode === 'activity_only'
        ? '仅迁移活动，不迁移关联业务记录'
        : `同时迁移 ${candidate.entityType} · ${candidate.entityId}`;
      return `<option value="${esc(value)}" ${reviewDraft.resolutionValue === value ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
    const unavailable = mappingResolution?.required && (!mappingResolution.available || !candidates.length);
    const writesDisabled = state.activityCorrection.writeEnabled !== true;
    const writeWarning = state.activityCorrection.writeEnabled === false
      ? '更正写入尚未启用，审批操作暂不可用。'
      : '正在检查更正功能状态，审批操作暂不可用。';
    return `<article class="activity-correction-proposal" data-correction-proposal="${esc(proposal.proposalId)}">
      <header><div><strong>${esc(correctionProposalCustomer(proposal, 'source'))} → ${esc(correctionProposalCustomer(proposal, 'target'))}</strong><small>${shortDate(proposal.createdAt, true)}</small></div><span class="pill ${proposal.status === 'pending' ? 'amber' : proposal.status === 'approved' ? '' : 'gray'}">${esc(({ pending: '待确认', approved: '已通过', rejected: '未通过' })[proposal.status] || proposal.status)}</span></header>
      <p>${esc(proposal.reason || '未填写更正原因')}</p>
      ${proposal.status === 'pending' ? `<div class="activity-correction-review-fields">
        ${mappingResolution?.required ? `<label>业务记录处理<select data-correction-resolution ${unavailable ? 'disabled' : ''}><option value="">请选择处理方式</option>${resolutionOptions}</select></label>` : ''}
        ${unavailable ? '<div class="activity-correction-review-warning">当前映射无法安全确认，只能拒绝或刷新后再审。</div>' : ''}
        ${writesDisabled ? `<div class="activity-correction-review-warning">${writeWarning}</div>` : ''}
        <label>审批意见<textarea data-correction-review-reason maxlength="2000" placeholder="拒绝时必须填写原因">${esc(reviewDraft.reason || '')}</textarea></label>
        <p class="activity-correction-review-status" data-correction-review-status role="alert" aria-live="polite"></p>
        <div class="activity-correction-review-actions"><button class="button secondary" type="button" data-review-correction="rejected" ${writesDisabled ? 'disabled' : ''}>不通过</button><button class="button primary" type="button" data-review-correction="approved" ${unavailable || writesDisabled ? 'disabled' : ''}>通过</button></div>
      </div>` : `<small>${esc(proposal.reviewReason || '审批已完成')}</small>`}
    </article>`;
  }

  function renderActivityCorrectionProposalRows() {
    const correction = state.activityCorrection;
    const list = $('#activityCorrectionProposalList');
    if (list) list.innerHTML = correction.proposalLoading && !correction.proposalRows.length
      ? '<div class="empty">正在读取更正待处理…</div>'
      : correction.proposalRows.map(renderActivityCorrectionProposal).join('') || '<div class="empty">当前筛选下没有更正申请</div>';
    const count = $('#activityCorrectionProposalCount');
    if (count) count.textContent = `已显示 ${correction.proposalRows.length} / ${correction.proposalTotal} 条（授权范围 ${correction.proposalAuthorizedTotal} 条）`;
    renderPagination('#activityCorrectionProposalPagination', 'correction_proposals', {
      page: correction.proposalPage, pageSize: correction.proposalPageSize,
      total: correction.proposalTotal, loading: correction.proposalLoading,
    }, ({ page, pageSize }) => {
      correction.proposalPageSize = pageSize || correction.proposalPageSize;
      void loadActivityCorrectionProposals({ page: page || 1 });
    });
  }

  async function loadActivityCorrectionProposals({ reset = false, page } = {}) {
    const correction = state.activityCorrection;
    if (!can('manage_activity_corrections') || state.data?.impersonation) {
      clearActivityCorrectionProposalResults();
      return null;
    }
    const requestEpoch = ++correction.proposalRequestEpoch;
    correction.proposalLoading = true;
    if (reset) { correction.proposalRows = []; correction.proposalPage = 1; }
    renderActivityCorrectionProposalRows();
    try {
      const targetPage = reset ? 1 : Math.max(1, Number(page || correction.proposalPage || 1));
      const payload = correction.proposalController?.serialize('applied') || { permissionVersion: '', filters: [] };
      const params = new URLSearchParams({
        page: String(targetPage), pageSize: String(correction.proposalPageSize),
        ...(correction.proposalController ? { permissionVersion: String(payload.permissionVersion || '') } : {}),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
      });
      const result = await api(`/activity-correction-proposals?${params}`, { preserveOnForbidden: true });
      if (requestEpoch !== correction.proposalRequestEpoch) return null;
      applyActivityCorrectionReadEnvelope(result);
      const rows = result.rows || result.proposals || [];
      correction.proposalRows = rows;
      correction.proposalPage = Number(result.page || targetPage);
      correction.proposalTotal = Number(result.total || 0);
      correction.proposalTotalPages = Number(result.totalPages
        ?? Math.ceil(correction.proposalTotal / correction.proposalPageSize));
      correction.proposalAuthorizedTotal = Number(result.authorizedTotal || 0);
      correction.proposalHasMore = Boolean(result.hasMore);
      if (result.schema && correction.proposalController) correction.proposalController.updateSchema(result.schema);
      correction.proposalMount?.setResultMeta({ total: result.total, shown: correction.proposalRows.length });
      renderActivityCorrectionProposalRows();
      return result;
    } catch (error) {
      if (requestEpoch !== correction.proposalRequestEpoch) return null;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        await initializeActivityCorrectionProposalFilters({ force: true });
        return null;
      }
      if (error.status === 403) {
        clearActivityCorrectionProposalResults();
        const filters = $('#activityCorrectionProposalFilters');
        if (filters && window.TradePulseFilterComponent) {
          filters.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({
            status: 'error', error: '当前账号无权读取更正审批',
          });
        }
      }
      const status = $('#activityCorrectionProposalStatus');
      if (status) status.textContent = error.message;
      return null;
    } finally {
      if (requestEpoch === correction.proposalRequestEpoch) correction.proposalLoading = false;
      renderActivityCorrectionProposalRows();
    }
  }

  async function initializeActivityCorrectionProposalFilters({ force = false } = {}) {
    const root = $('#activityCorrectionProposalFilters');
    if (!root || !window.TradePulseFilterComponent || !canReviewActivityCorrections()) return;
    if (state.activityCorrection.proposalMount && !force) return;
    state.activityCorrection.proposalMount?.destroy();
    state.activityCorrection.proposalMount = null;
    state.activityCorrection.proposalController = null;
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    const result = await loadActivityCorrectionProposals({ reset: true });
    if (!result?.schema || !root.isConnected) return;
    const controller = window.TradePulseFilterComponent.createFilterController({
      storage: paginationFilterStorage,
      pageKey: 'activity_correction_proposals', schema: result.schema,
      onApply: () => void loadActivityCorrectionProposals({ reset: true }),
    });
    state.activityCorrection.proposalController = controller;
    state.activityCorrection.proposalMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
      controller, resultMeta: { total: result.total, shown: state.activityCorrection.proposalRows.length },
    });
    controller.updateSchema(result.schema);
    await loadActivityCorrectionProposals({ reset: true });
  }

  function proposalResolutionFromControl(root) {
    const value = String(root?.querySelector('[data-correction-resolution]')?.value || '');
    if (!value) return null;
    const [mode, entityType, entityId] = value.split('|');
    return mode === 'activity_only' ? { mode } : { mode: 'commerce_entity', entityType, entityId };
  }

  async function reviewActivityCorrectionProposal(proposalId, decision, button) {
    const proposal = state.activityCorrection.proposalRows.find(row => row.proposalId === proposalId);
    if (state.activityCorrection.writeEnabled !== true) {
      return toast(state.activityCorrection.writeEnabled === false
        ? '更正写入尚未启用，审批暂不可用'
        : '正在检查更正功能状态，请稍后重试');
    }
    const root = button?.closest('[data-correction-proposal]');
    const reason = String(root?.querySelector('[data-correction-review-reason]')?.value || '').trim();
    if (decision === 'rejected' && !reason) return toast('不通过更正时必须填写说明原因');
    const resolution = proposalResolutionFromControl(root);
    if (decision === 'approved' && proposal?.mappingResolution?.required
        && proposal.mappingResolution.available === false) {
      return toast('当前业务映射不可通过，请刷新或重新加载后处理');
    }
    if (decision === 'approved' && proposal?.mappingResolution?.required && !resolution) {
      return toast('请选择业务记录处理方式；无法确认时请拒绝或刷新');
    }
    if (!proposal || state.activityCorrection.reviewSubmitting) return;
    const key = JSON.stringify({
      proposalId,
      expectedVersion: proposal.version,
      decision,
      reason,
      resolution: resolution || null,
    });
    if (!state.activityCorrection.reviewKeys.has(key)) {
      state.activityCorrection.reviewKeys.set(key, `activity-correction-review-ui:${crypto.randomUUID()}`);
    }
    const idempotencyKey = state.activityCorrection.reviewKeys.get(key);
    state.activityCorrection.reviewDrafts.set(proposalId, {
      reason,
      resolutionValue: String(root?.querySelector('[data-correction-resolution]')?.value || ''),
    });
    const status = root?.querySelector('[data-correction-review-status]');
    state.activityCorrection.reviewSubmitting = proposalId;
    root?.setAttribute('aria-busy', 'true');
    root?.querySelectorAll('button,select,textarea').forEach(control => { control.disabled = true; });
    if (status) status.textContent = '正在提交审批…';
    try {
      const response = await api(`/activity-correction-proposals/${encodeURIComponent(proposalId)}/review`, {
        method: 'POST', preserveOnForbidden: true,
        body: JSON.stringify({ decision, expectedVersion: proposal.version, reason, idempotencyKey, ...(resolution ? { resolution } : {}) }),
      });
      state.activityCorrection.reviewDrafts.delete(proposalId);
      await refreshAfterActivityCorrection({
        ...(response.result || {}), sourceCustomerId: proposal.sourceCustomerId,
        targetCustomerId: proposal.targetCustomerId,
      }, decision === 'approved' ? '更正申请已通过' : '更正申请未通过');
    } catch (error) {
      if (error.code === 'ACTIVITY_CORRECTIONS_DISABLED' || error.status === 503) {
        state.activityCorrection.writeEnabled = false;
        if (status) status.textContent = '更正写入已关闭，审批意见已保留。';
        applyActivityCorrectionReadEnvelope({ writeEnabled: false });
      } else if (error.code === 'ACTIVITY_CORRECTION_MAPPING_CHANGED'
          || error.code === 'ACTIVITY_CORRECTION_VERSION_CONFLICT') {
        if (status) status.textContent = '业务映射或申请版本已变化，正在刷新真实状态…';
        await loadActivityCorrectionProposals({ reset: true });
      } else if (status) {
        status.textContent = `${error.message}；审批意见已保留。`;
      }
      toast(error.message);
    } finally {
      state.activityCorrection.reviewSubmitting = '';
      if (root?.isConnected) {
        root.removeAttribute('aria-busy');
        const mappingResolution = proposal?.mappingResolution || null;
        const unavailable = mappingResolution?.required
          && (!mappingResolution.available || !(mappingResolution.candidates || []).length);
        const writesDisabled = state.activityCorrection.writeEnabled !== true;
        const textarea = root.querySelector('[data-correction-review-reason]');
        const select = root.querySelector('[data-correction-resolution]');
        const reject = root.querySelector('[data-review-correction="rejected"]');
        const approve = root.querySelector('[data-review-correction="approved"]');
        if (textarea) textarea.disabled = false;
        if (select) select.disabled = Boolean(unavailable);
        if (reject) reject.disabled = writesDisabled;
        if (approve) approve.disabled = writesDisabled || Boolean(unavailable);
      }
    }
  }

  function renderActivityCorrectionHistoryRows() {
    const correction = state.activityCorrection;
    const list = $('#activityCorrectionHistoryList');
    if (list) list.innerHTML = correction.historyLoading && !correction.historyRows.length
      ? '<div class="empty">正在读取更正历史…</div>'
      : correction.historyRows.map(row => `<article class="activity-correction-history-item"><strong>${esc(correctionProposalCustomer(row, 'source'))} → ${esc(correctionProposalCustomer(row, 'target'))}</strong><p>${esc(row.reason || '未填写原因')}</p><small>${shortDate(row.createdAt, true)} · 已完成</small></article>`).join('') || '<div class="empty">当前筛选下没有更正历史</div>';
    const count = $('#activityCorrectionHistoryCount');
    if (count) count.textContent = `已显示 ${correction.historyRows.length} / ${correction.historyTotal} 条（授权范围 ${correction.historyAuthorizedTotal} 条）`;
    renderPagination('#activityCorrectionHistoryPagination', 'correction_history', {
      page: correction.historyPage, pageSize: correction.historyPageSize,
      total: correction.historyTotal, loading: correction.historyLoading,
    }, ({ page, pageSize }) => {
      correction.historyPageSize = pageSize || correction.historyPageSize;
      void loadActivityCorrections({ page: page || 1 });
    });
  }

  async function loadActivityCorrections({ reset = false, page } = {}) {
    const correction = state.activityCorrection;
    if (state.data?.impersonation
        || (!can('correct_own_activity') && !can('manage_activity_corrections'))) {
      clearActivityCorrectionHistoryResults();
      return null;
    }
    const requestEpoch = ++correction.historyRequestEpoch;
    correction.historyLoading = true;
    if (reset) { correction.historyRows = []; correction.historyPage = 1; }
    renderActivityCorrectionHistoryRows();
    try {
      const targetPage = reset ? 1 : Math.max(1, Number(page || correction.historyPage || 1));
      const payload = correction.historyController?.serialize('applied') || { permissionVersion: '', filters: [] };
      const params = new URLSearchParams({
        page: String(targetPage), pageSize: String(correction.historyPageSize),
        ...(correction.historyController ? { permissionVersion: String(payload.permissionVersion || '') } : {}),
        filters: JSON.stringify(componentPayloadToRaw(payload)),
      });
      const result = await api(`/activity-corrections?${params}`, { preserveOnForbidden: true });
      if (requestEpoch !== correction.historyRequestEpoch) return null;
      applyActivityCorrectionReadEnvelope(result);
      const rows = result.rows || result.corrections || [];
      correction.historyRows = rows;
      correction.historyPage = Number(result.page || targetPage);
      correction.historyTotal = Number(result.total || 0);
      correction.historyTotalPages = Number(result.totalPages
        ?? Math.ceil(correction.historyTotal / correction.historyPageSize));
      correction.historyAuthorizedTotal = Number(result.authorizedTotal || 0);
      correction.historyHasMore = Boolean(result.hasMore);
      if (result.schema && correction.historyController) correction.historyController.updateSchema(result.schema);
      correction.historyMount?.setResultMeta({ total: result.total, shown: correction.historyRows.length });
      renderActivityCorrectionHistoryRows();
      return result;
    } catch (error) {
      if (requestEpoch !== correction.historyRequestEpoch) return null;
      if (error.code === 'FILTER_VERSION_CONFLICT') {
        await initializeActivityCorrectionHistoryFilters({ force: true });
        return null;
      }
      if (error.status === 403) {
        clearActivityCorrectionHistoryResults();
        const filters = $('#activityCorrectionHistoryFilters');
        if (filters && window.TradePulseFilterComponent) {
          filters.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({
            status: 'error', error: '当前账号无权读取更正历史',
          });
        }
      }
      const status = $('#activityCorrectionHistoryStatus');
      if (status) status.textContent = error.message;
      return null;
    } finally {
      if (requestEpoch === correction.historyRequestEpoch) correction.historyLoading = false;
      renderActivityCorrectionHistoryRows();
    }
  }

  async function initializeActivityCorrectionHistoryFilters({ force = false } = {}) {
    const root = $('#activityCorrectionHistoryFilters');
    if (!root || !window.TradePulseFilterComponent || state.data?.impersonation
        || (!can('correct_own_activity') && !can('manage_activity_corrections'))) return;
    if (state.activityCorrection.historyMount && !force) return;
    state.activityCorrection.historyMount?.destroy();
    state.activityCorrection.historyMount = null;
    state.activityCorrection.historyController = null;
    root.innerHTML = window.TradePulseFilterComponent.renderFilterComponent({ status: 'loading' });
    const result = await loadActivityCorrections({ reset: true });
    if (!result?.schema || !root.isConnected) return;
    const controller = window.TradePulseFilterComponent.createFilterController({
      storage: paginationFilterStorage,
      pageKey: 'activity_corrections', schema: result.schema,
      onApply: () => void loadActivityCorrections({ reset: true }),
    });
    state.activityCorrection.historyController = controller;
    state.activityCorrection.historyMount = window.TradePulseFilterComponent.mountFilterComponent(root, {
      controller, resultMeta: { total: result.total, shown: state.activityCorrection.historyRows.length },
    });
    controller.updateSchema(result.schema);
    await loadActivityCorrections({ reset: true });
  }

  async function refreshAfterActivityCorrection(change = {}, message = '') {
    const sourceCustomerId = String(change.sourceCustomerId || '');
    const targetCustomerId = String(change.targetCustomerId || '');
    const affectedCustomerIds = new Set([sourceCustomerId, targetCustomerId].filter(Boolean));
    await refresh();
    if (state.customerFilterController) await loadCustomerPage({ reset: true });
    const reloads = [];
    if (state.authorizedBusinessLists.notifications.filterController) reloads.push(loadAuthorizedBusinessPage('notifications', { reset: true }));
    if (state.authorizedBusinessLists.alerts.filterController) reloads.push(loadAuthorizedBusinessPage('alerts', { reset: true }));
    if (state.authorizedBusinessLists.manager_tasks.filterController) reloads.push(loadAuthorizedBusinessPage('manager_tasks', { reset: true }));
    if (state.authorizedBusinessLists.manager_risks.filterController) reloads.push(loadAuthorizedBusinessPage('manager_risks', { reset: true }));
    if (state.authorizedBusinessLists.manager_metrics.filterController) reloads.push(loadAuthorizedBusinessPage('manager_metrics', { reset: true }));
    if (state.activityCorrection.historyController) reloads.push(loadActivityCorrections({ reset: true }));
    if (state.activityCorrection.proposalController) reloads.push(loadActivityCorrectionProposals({ reset: true }));
    await Promise.all(reloads);
    if (affectedCustomerIds.has(String(state.selectedCustomerId || ''))) {
      renderDrawer();
      if (state.view === 'customerProfile') reloadCustomerProfileFrame();
    }
    if (message) toast(message);
  }

  function renderDrawer() {
    if (state.drawerOwner.startsWith('mismatch:')) {
      renderMismatchRecordDrawer();
      return;
    }
    if (state.drawerOwner.startsWith('intake:')) return;
    if (state.drawerOwner.startsWith('recycle:')) {
      if (state.recycleCustomerDetail
        && (state.recycleCustomerDetail.account?.id || state.selectedCustomerId) === state.selectedCustomerId) {
        renderRecycleDrawer(state.recycleCustomerDetail);
      }
      return;
    }
    if (state.recycleCustomerDetail
      && (state.recycleCustomerDetail.account?.id || state.selectedCustomerId) === state.selectedCustomerId) {
      renderRecycleDrawer(state.recycleCustomerDetail);
      return;
    }
    const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
    if (!account) {
      resetDrawerActions();
      return;
    }
    configureDrawerActions({
      customer: account,
      source: 'crm',
      crmCustomerId: account.id,
      allowActivity: true,
      allowNickname: false,
    });
    $('#drawerStage').textContent = stageLabel(account.stage);
    $('#drawerCompany').textContent = accountDisplayName(account);
    $('#drawerMeta').textContent = [accountIdentity(account), account.country, account.city, account.industry, account.customer_type].filter(Boolean).join(' · ');
    const activities = state.data.activities.filter(item => item.customer_id === account.id);
    const rfqs = state.data.rfqs.filter(item => item.customer_id === account.id);
    const quotes = state.data.quotes.filter(item => item.customer_id === account.id);
    const orders = state.data.orders.filter(item => item.customer_id === account.id);
    const timeline = (state.data.timeline || []).filter(item => item.customer_id === account.id);
    const alert = alertFor(account.id);
    const accountFacts = [
      ['负责人', account.owner_name || '未分配'], ['创建人', creatorDisplayName(account)],
      ['优先级', account.priority], ['客户来源', account.source],
      ['成立年份', account.established_year || '未填写'],
      ...(customerAIEnabled() ? [['评价标签', labelsForAccount(account.id).join('、') || '暂无AI标签']] : []),
      ['最近动作', relative(account.last_activity_at)],
      ['管理介入', account.manager_status || (account.manager_required ? '待介入' : '暂不需要')],
      ['官网', account.website, 'website'],
      ['联系人质量', account.best_contact_level],
    ];
    state.drawerAiContext = { customerId: account.external_customer_id || account.id, crmCustomerId: account.id, companyName: account.company_name, view: state.view };
    $('#drawerContent').innerHTML = `
      ${hasMeaningfulAlertCopy(alert) ? `<div class="next-step" style="border-color:${alert.severity === 'critical' ? '#e0a09c' : '#e5c27c'}"><div><strong>${esc(alert.title)}</strong><p>${esc(alert.detail)}</p></div><span class="pill ${alert.severity === 'critical' ? 'red' : 'amber'}">${esc(alert.action)}</span></div>` : ''}
      ${alert && alertReasons(alert).length > 1 ? `<div class="alert-details"><span class="eyebrow">异常明细</span>${alertReasons(alert).map(reason => `<div class="alert-detail-row"><strong>${esc(reason.title)}</strong><p>${esc(reason.detail)}</p><span>${reason.dueAt ? `计划时间：${esc(shortDate(reason.dueAt, true))}` : ''}${Number(reason.overdueHours) > 0 ? ` · 已超时 ${Math.floor(Number(reason.overdueHours))} 小时` : ''}${reason.action ? ` · ${esc(reason.action)}` : ''}</span></div>`).join('')}</div>` : ''}
      <div class="next-step"><div><span class="eyebrow">NEXT ACTION</span><p>${esc(account.next_action || '尚未填写下一步')}</p></div>${nextActionTimeMarkup(account)}</div>
      ${sourceTagMarkup(account)}
      <div class="account-facts">
        ${accountFacts.map(drawerFactMarkup).join('')}
      </div>
      <section class="master-profile">
        <div class="insight-head"><div><p class="eyebrow">CUSTOMER MASTER DATA</p><h3>企业背景与开发依据</h3></div><button class="text-button" data-open-master="${esc(account.external_customer_id || '')}">查看完整客户资料 →</button></div>
        <div class="master-profile-grid drawer-master-grid">
          <div class="drawer-master-card-wide"><span>企业简介</span><p>${esc(account.master_description || '暂无企业简介')}</p></div>
          <div><span>产品与潜在需求</span><p>${esc(account.product_focus || '未标注')}</p></div>
          <div><span>背调与来源</span><p>${esc([account.deep_report, account.source_file].filter(Boolean).join(' · ') || '暂无关联资料')}</p></div>
        </div>
      </section>
      ${customerAiSection(state.drawerAiContext)}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${rfqs.length && can('record_quote') ? '<button class="button secondary" data-add-quote>＋ 记录报价</button>' : ''}
        ${quotes.length && can('record_order') ? '<button class="button secondary" data-add-order>＋ 记录订单</button>' : ''}
        ${can('edit_customer') ? '<button class="button secondary" data-edit-customer-profile>编辑客户资料</button>' : ''}
        ${canReturnCustomer(account)
          ? '<button class="button danger" data-return-customer="' + esc(account.id) + '">退回线索池</button>' : ''}
        ${canRejectCustomer(account)
          ? '<button class="button danger" data-reject-customer="' + esc(account.id) + '">标记不对口</button>' : ''}
        ${!state.data.impersonation && can('manage_manual_customer_deletion') && !account.intake_item_id && account.source_file === 'CRM手工新增'
          ? '<button class="button danger" data-trash-customer="' + esc(account.id) + '">删除到回收站</button>' : ''}
      </div>
      <div><div class="panel-head" style="padding-left:0;padding-right:0"><div><p class="eyebrow">FULL TIMELINE</p><h2>完整客户时间线</h2></div><span class="panel-note">${timeline.length} 条记录</span><button class="text-button" data-customer-history>查看客户历史</button></div>
      <div class="timeline">${timeline.map(renderActivityTimelineItem).join('') || '<div class="empty">暂无跟进记录</div>'}</div></div>`;
    startDrawerNextActionTimer();
  }

  function stopDrawerNextActionTimer() {
    if (state.drawerNextActionTimer !== null) clearInterval(state.drawerNextActionTimer);
    state.drawerNextActionTimer = null;
  }

  function refreshDrawerNextActionTime() {
    if (!$('#customerDrawer')?.classList.contains('open') || !state.drawerOwner.startsWith('crm:')) return;
    const account = state.data?.accounts?.find(item => item.id === state.selectedCustomerId);
    const mount = $('#drawerContent [data-next-action-time]');
    if (!account || !mount) return;
    const holder = document.createElement('div');
    holder.innerHTML = nextActionTimeMarkup(account);
    if (holder.firstElementChild) mount.replaceWith(holder.firstElementChild);
  }

  function startDrawerNextActionTimer() {
    stopDrawerNextActionTimer();
    if (!state.drawerOwner.startsWith('crm:')) return;
    refreshDrawerNextActionTime();
    if (document.visibilityState === 'visible') {
      state.drawerNextActionTimer = setInterval(refreshDrawerNextActionTime, 60 * 1000);
    }
  }

  function openModal(title, eyebrow, html, modalClass = '') {
    if (!$('#modal').classList.contains('open')) state.modalReturnFocus = document.activeElement;
    $('#modalTitle').textContent = title;
    $('#modalEyebrow').textContent = eyebrow;
    $('#modalBody').innerHTML = `<div class="modal-body">${html}</div>`;
    uiFormat?.mountIcons?.($('#modalBody'));
    const dialog = $('#modal .modal');
    if (dialog) dialog.className = `modal${modalClass ? ` ${modalClass}` : ''}`;
    $('#modal').classList.add('open');
    $('#modal').setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      const focusTarget = $('#modal [autofocus], #modal input:not([type="hidden"]), #modal textarea, #modal select, #modal button');
      focusTarget?.focus?.();
    });
  }
  function closeModal() {
    clearTimeout(state.activityCustomerSearchTimer);
    state.activityCustomerRequestEpoch += 1;
    $('#modal').classList.remove('open');
    $('#modal').setAttribute('aria-hidden', 'true');
    state.activityDraftBeforeReactionAdmin = null;
    state.activityCorrection.targetRequestEpoch += 1;
    state.activityCorrection.targetMount?.destroy();
    state.activityCorrection.targetMount = null;
    state.activityCorrection.targetController = null;
    state.activityCorrection.draft = null;
    const dialog = $('#modal .modal');
    if (dialog) {
      dialog.className = 'modal';
      dialog.removeAttribute('id');
    }
    const returnFocus = state.modalReturnFocus;
    state.modalReturnFocus = null;
    if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus?.());
  }

  function todayTaskById(taskId) {
    return state.authorizedBusinessLists.alerts.rows.find(item => String(item.id) === String(taskId));
  }

  function todayTaskFactGrid(facts) {
    return `<div class="today-task-facts">${facts.map(([label, value]) =>
      `<div><span>${esc(label)}</span><strong>${esc(value || '—')}</strong></div>`).join('')}</div>`;
  }

  function todayTaskErrorMarkup() {
    return '<p class="today-task-form-error" data-today-task-error role="alert" aria-live="polite"></p>';
  }

  function todayTaskCandidates() {
    return (state.data?.todayTaskAssignmentCandidates || [])
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        name: String(item.name || item.displayName || item.id),
        detail: String(item.detail || item.teamName || item.countries?.join(' / ') || ''),
      }));
  }

  function renderTodayTaskCandidateOptions(query = '') {
    const select = $('#todayTaskOwner');
    if (!select) return;
    const selected = select.value;
    const keyword = String(query || '').trim().toLocaleLowerCase();
    const rows = todayTaskCandidates().filter(item =>
      !keyword || `${item.name} ${item.detail} ${item.id}`.toLocaleLowerCase().includes(keyword));
    select.innerHTML = rows.length
      ? `<option value="">请选择新负责人</option>${rows.map(item =>
        `<option value="${esc(item.id)}">${esc(item.name)}${item.detail ? ` · ${esc(item.detail)}` : ''}</option>`).join('')}`
      : '<option value="">没有匹配的启用中销售人员</option>';
    if (rows.some(item => item.id === selected)) select.value = selected;
  }

  function openOverdueLeadTaskModal(item) {
    if (!item.intakeItemId) return toast('该超时线索缺少稳定编号，请刷新后重试');
    const canReassign = todayTaskActionAllowed(
      item,
      ['resolve_overdue_lead', 'reassign', 'resolve_overdue_lead_reassign'],
      ['admin', 'manager'].includes(state.data?.user?.role)
        && can('manage_intake'),
    );
    const canReturn = todayTaskActionAllowed(
      item,
      ['resolve_overdue_lead', 'return_to_pool', 'resolve_overdue_lead_return_to_pool'],
      ['admin', 'manager'].includes(state.data?.user?.role)
        && can('manage_intake'),
    );
    if (!canReassign && !canReturn) return toast('当前账号无权处理该超时线索');
    const overdue = Number(item.maxOverdueHours ?? item.overdueHours ?? 0);
    openModal('处理超时线索', '直接重新分配或退回线索池', `
      <form id="todayTaskOverdueForm" class="form-grid today-task-form" data-today-task-form>
        <input type="hidden" name="intakeItemId" value="${esc(item.intakeItemId)}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        ${todayTaskFactGrid([
          ['客户', accountDisplayName(item)],
          ['当前负责人', item.ownerName || userById(item.ownerId)?.name || item.ownerId],
          ['分配时间', item.assignedAt ? shortDate(item.assignedAt, true) : '未记录'],
          ['超时时长', overdue ? `${Math.floor(overdue)} 小时` : '已超过领取期限'],
        ])}
        ${canReassign ? `<div class="today-task-owner-picker">
          <label>搜索启用中的销售人员<input id="todayTaskOwnerSearch" type="search" autocomplete="off" placeholder="输入姓名、编号或团队"></label>
          <label>新负责人<select id="todayTaskOwner" name="ownerId"></select></label>
        </div>` : ''}
        ${todayTaskErrorMarkup()}
        <div class="form-actions today-task-actions">
          <button type="button" class="button secondary" data-close-modal>取消</button>
          ${canReturn ? '<button class="button secondary" type="submit" data-resolution="return_to_pool">确认退回</button>' : ''}
          ${canReassign ? '<button class="button primary" type="submit" data-resolution="reassign">确认重新分配</button>' : ''}
        </div>
      </form>`, 'today-task-modal');
    renderTodayTaskCandidateOptions();
  }

  function openNextPlanTaskModal(item) {
    if (!todayTaskActionAllowed(
      item,
      ['add_next_plan'],
      can('record_activity'),
    )) {
      return toast('当前账号无权为该客户补充计划');
    }
    const account = state.data.accounts.find(row => row.id === item.customerId);
    openModal('补充下一步计划', '只补计划，不虚构客户新进展', `
      <form id="todayTaskPlanForm" class="form-grid two today-task-form deferred-plan-form" data-today-task-form data-plan-mode="explicit">
        <input type="hidden" name="customerId" value="${esc(item.customerId)}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        <div class="span-2">${todayTaskFactGrid([
          ['客户', accountDisplayName(account || item)],
          ['当前负责人', item.ownerName || account?.owner_name || userById(item.ownerId)?.name],
          ['当前阶段', stageLabel(item.stage || account?.stage)],
        ])}</div>
        <div id="planModeTabs" class="segmented span-2 plan-mode-tabs" role="tablist" aria-label="下一步计划状态">
          <button class="active" type="button" role="tab" aria-selected="true" data-plan-mode="explicit">已有明确计划</button>
          <button type="button" role="tab" aria-selected="false" data-plan-mode="deferred">暂未确定</button>
        </div>
        <div id="explicitPlanFields" class="span-2 form-grid two explicit-plan-fields">
          <label class="span-2">下一步计划<input name="nextAction" maxlength="500" required placeholder="例如：确认 BOM 明细并准备报价"></label>
          <label class="span-2">计划执行时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${dateInput(1)}" required></label>
        </div>
        <div id="deferredPlanFields" class="span-2 form-grid two deferred-plan-fields hidden">
          <label class="span-2">再次复查时间<input name="reviewAt" type="datetime-local" data-future-datetime value="${dateInput(1)}"></label>
          <label class="span-2">当前情况 / 卡点（选填）<textarea name="reason" maxlength="500" rows="3" placeholder="例如：等待客户内部确认预算，本周五再次复查"></textarea></label>
        </div>
        <div class="span-2">${todayTaskErrorMarkup()}</div>
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit" data-plan-submit>保存并完成待办</button></div>
      </form>`, 'today-task-modal');
    $$('#todayTaskPlanForm [data-future-datetime]')
      .forEach(input => {
        setFutureDateTimeConstraint(input);
        validateFutureDateTime(input);
      });
  }

  function setNextPlanMode(mode) {
    const form = $('#todayTaskPlanForm');
    if (!form || !['explicit', 'deferred'].includes(mode)) return;
    form.dataset.planMode = mode;
    $$('#planModeTabs [data-plan-mode]').forEach(button => {
      const selected = button.dataset.planMode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    $('#explicitPlanFields')?.classList.toggle('hidden', mode !== 'explicit');
    $('#deferredPlanFields')?.classList.toggle('hidden', mode !== 'deferred');
    const nextAction = form.elements.nextAction;
    const nextActionAt = form.elements.nextActionAt;
    const reviewAt = form.elements.reviewAt;
    if (nextAction) nextAction.required = mode === 'explicit';
    if (nextActionAt) nextActionAt.required = mode === 'explicit';
    if (reviewAt) reviewAt.required = mode === 'deferred';
    const submit = form.querySelector('[data-plan-submit]');
    if (submit) submit.textContent = mode === 'explicit' ? '保存并完成待办' : '保存暂未确定状态';
    [nextActionAt, reviewAt].filter(Boolean).forEach(input => validateFutureDateTime(input));
  }

  function managerEvidencePresentation(key) {
    return ({
      activityId: '关联跟进记录',
      nextAction: '原下一步计划',
      nextActionAt: '原计划时间',
      dueAt: '处理期限',
      progressType: '原跟进方式',
      requestReason: '请求协助原因',
      requestedAt: '请求时间',
      contacts: '已记录联系人',
      summary: '情况摘要',
      originalPlan: '原下一步计划',
    })[key] || '';
  }

  function managerEvidenceDisplayValue(key, value) {
    if (value === undefined || value === null || value === '') return '未记录';
    if (key === 'nextActionAt' || key === 'requestedAt' || key === 'dueAt') return shortDate(String(value), true);
    if (key === 'progressType') {
      const progress = activityProgressOptions.find(item => item.key === value)
        || activityProgressOptions.find(item => item.activityType === value);
      return progress ? progress.label : String(value);
    }
    if (key === 'contacts' && Array.isArray(value)) {
      return value.map(contact =>
        `${contact.name || '未命名'}${contact.title ? ` · ${contact.title}` : ''}${contact.department ? ` · ${contact.department}` : ''}${contact.matchStatus === 'mismatch' ? ' · 已标记不对口' : ''}`,
      ).join('；') || '暂无联系人记录';
    }
    if (typeof value === 'object') return '';
    return String(value);
  }

  async function openManagerTaskDetail(taskId) {
    if (!can('resolve_manager_tasks') || !taskId) return toast('当前账号无权处理主管任务');
    openModal('主管协助事项详情', '主管协助事项', '<div class="empty">正在读取任务事实和客户风险历史…</div>', 'manager-task-modal');
    try {
      const result = await api(`/api/sales-crm/manager-tasks/${encodeURIComponent(taskId)}`, {
        preserveOnForbidden: true,
      });
      const task = result.task || {};
      const account = result.account || {};
      const risk = result.risk || {};
      const interventions = result.interventions || [];
      const evidence = Object.entries(task.evidence || {});
      const history = risk.history || [];
      const candidateRows = [
        ...(state.data.todayTaskAssignmentCandidates || []),
        ...(state.data.assignmentCandidates || []),
        ...(state.data.users || []).filter(user =>
          user.active && !user.archived && user.role === 'sales'),
      ];
      const sales = [...new Map(candidateRows.filter(user => user?.id)
        .map(user => [String(user.id), { id: String(user.id), name: String(user.name || user.displayName || user.id) }])).values()];
      const managerTaskActions = [
        ...(can('edit_customer') ? [
          ['plan_formed', '形成明确计划'],
          ['terminal_stage', '正式终止跟进'],
        ] : []),
        ...(can('manage_intake') ? [['reassigned', '重新分配负责人']] : []),
        ...(can('edit_customer') && can('record_activity')
          ? [['manager_advice', '记录主管建议并安排动作']] : []),
        ['escalate_owner', '升级为经营决策事项'],
      ];
      const assistanceHistory = result.customerAssistanceHistory || [];
      const evidenceRows = evidence.map(([key, value]) => {
        const label = managerEvidencePresentation(key);
        const display = managerEvidenceDisplayValue(key, value);
        if (!label || !display) return '';
        return `<div><span>${label}</span><strong>${esc(display)}</strong></div>`;
      }).join('');
      const assistanceCanReply = task.reason === 'manager_assistance'
        && task.status !== 'completed'
        && ['admin', 'manager'].includes(state.data?.user?.role)
        && can('view_team');
      openModal(`主管协助 · ${account.companyName || task.customerId}`, managerTaskReasonLabels[task.reason] || task.reason, `
        <div class="manager-task-detail">
          <div class="manager-task-layout">
            <div class="manager-task-main">
              <div class="manager-task-detail-grid">
                <div><span class="manager-risk-label">客户</span><strong>${esc(account.companyName || task.customerId)}</strong><p>${esc(account.externalCustomerId || task.customerId)}</p></div>
                <div><span class="manager-risk-label">当前负责人</span><strong>${esc(userById(account.ownerId)?.name || account.ownerId || '未记录')}</strong><p>${esc(account.sourceType === 'intake' ? '线索池' : stageLabel(account.stage))}</p></div>
                <div><span class="manager-risk-label">触发 / 到期</span><strong>${esc(shortDate(task.triggeredAt, true))}</strong><p>${esc(shortDate(task.dueAt, true))}</p></div>
                <div><span class="manager-risk-label">完成条件</span><strong>${esc(task.completionCondition || '必须形成真实业务变化')}</strong><p>${esc(managerTaskStatusLabels[task.status] || task.status)}</p></div>
              </div>
              <section><h3>${task.reason === 'manager_assistance' ? '协助请求' : '触发证据'}</h3>
                <div class="manager-evidence-list">${evidenceRows || '<span class="subtle">未记录补充证据</span>'}</div></section>
              ${task.reason === 'manager_assistance'
                ? (assistanceCanReply ? `
              <form id="managerAssistanceReplyForm" class="manager-task-resolve-form">
                <input type="hidden" name="taskId" value="${esc(task.id)}">
                <input type="hidden" name="customerId" value="${esc(account.id)}">
                <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
                <label>主管处理意见<textarea name="result" rows="3" maxlength="2000" required placeholder="填写本次处理意见、已完成的协助和后续安排"></textarea></label>
                <p id="managerAssistanceStatus" class="today-task-form-error" role="alert" aria-live="polite"></p>
                <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">回复销售并完成协助</button></div>
              </form>`
                  : `<div class="recommendation">该任务已完成，仅保留历史查看。</div>`)
                : `
              <form id="managerTaskResolveForm" class="manager-task-resolve-form">
                <input type="hidden" name="taskId" value="${esc(task.id)}">
                <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
                <label>处理方式<select id="managerTaskAction" name="action" required>
                  ${managerTaskActions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
                </select></label>
                <div id="managerTaskActionFields" class="manager-action-fields" data-action-contract="nextAction nextActionAt ownerId difficulty"
                  data-sales-options="${esc(sales.map(user => `${user.id}\t${user.name}`).join('\n'))}"></div>
                <p id="managerResolveStatus" class="today-task-form-error" role="alert" aria-live="polite"></p>
                <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">确认并记录业务变化</button></div>
              </form>`}
            </div>
            <aside class="manager-task-side">
              <section id="managerRiskDetail" class="manager-risk-detail">
                <h3>客户计划风险历史</h3>
                <div class="manager-risk-facts">
                  <div><span>当前连续暂未确定</span><strong>${Number(risk.currentConsecutiveDeferredCount || 0)} 次</strong></div>
                  <div><span>累计暂未确定</span><strong>${Number(risk.cumulativeDeferredCount || 0)} 次</strong></div>
                  <div><span>无明确计划持续</span><strong>${Number(risk.unplannedDurationDays || 0)} 天</strong></div>
                  <div><span>首次达到阈值</span><strong>${esc(risk.thresholdAt ? shortDate(risk.thresholdAt, true) : '尚未达到')}</strong></div>
                </div>
                <div class="manager-history-list">${history.length ? history.map(item => `<article>
                  <strong>${esc(shortDate(item.createdAt, true))} · 复查 ${esc(shortDate(item.reviewAt, true))}</strong>
                  <p>${esc(item.reason || '未填写卡点')}</p>
                  <small>记录人 ${esc(userById(item.actorId)?.name || item.actorId || '未记录')} · 当时负责人 ${esc(userById(item.ownerIdSnapshot)?.name || item.ownerIdSnapshot || '未记录')} · ${esc(item.source || 'manual')}</small>
                </article>`).join('') : '<span class="subtle">暂无暂未确定记录</span>'}</div>
              </section>
              <section class="manager-assistance-history">
                <h3>过往主管协助记录</h3>
                <div class="manager-history-list">${assistanceHistory.length ? assistanceHistory.map(item => `<article>
                  <strong>${esc(shortDate(item.requestedAt, true))} · 请求协助</strong>
                  <p>${esc(item.requestReason || '未记录具体原因')}</p>
                  ${item.replyText ? `<p>主管回复（${esc(shortDate(item.repliedAt, true))}）：${esc(item.replyText)}</p>` : ''}
                  ${item.confirmed ? `<p>销售已确认下一步（${esc(shortDate(item.confirmedAt, true))}）</p>` : ''}
                  <small>${esc(managerTaskStatusLabels[item.status] || item.status)}${item.taskId === task.id ? ' · 当前' : ''}</small>
                </article>`).join('') : '<span class="subtle">该客户暂无历史主管协助记录</span>'}</div>
              </section>
            </aside>
          </div>
        </div>`, 'manager-task-modal');
      setManagerTaskAction(managerTaskActions[0][0]);
    } catch (error) {
      closeModal();
      toast(error.message);
    }
  }

  function setManagerTaskAction(action) {
    const form = $('#managerTaskResolveForm');
    const root = $('#managerTaskActionFields');
    if (!form || !root) return;
    const nextAt = esc(dateInput(1));
    const salesOptions = String(root.dataset.salesOptions || '').split('\n').filter(Boolean)
      .map(row => row.split('\t'));
    const fields = {
      plan_formed: `<label>明确的下一步计划<input name="nextAction" maxlength="500" required placeholder="例如：确认 BOM 后提交正式报价"></label><label>计划执行时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${nextAt}" required></label>`,
      terminal_stage: `<label>终止阶段<select name="stage" required><option value="lost">丢单</option></select></label><label>终止原因<textarea name="note" maxlength="500" required></textarea></label>`,
      reassigned: `<label>新负责人<select name="ownerId" required><option value="">请选择在职销售</option>${salesOptions.map(([id, name]) => `<option value="${esc(id)}">${esc(name || id)}</option>`).join('')}</select></label>`,
      manager_advice: `<label>主管建议<textarea name="note" maxlength="500" required placeholder="记录给销售的具体建议"></textarea></label><label>下一步计划<input name="nextAction" maxlength="500" required></label><label>计划执行时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${nextAt}" required></label>`,
      escalate_owner: `<label>需进一步决策的难点<textarea name="difficulty" maxlength="500" required placeholder="说明具体困难和需要的决策"></textarea></label>`,
    };
    root.innerHTML = fields[action] || fields.plan_formed;
    constrainFutureDateTimes(root);
    const status = $('#managerResolveStatus');
    if (status) status.textContent = '';
  }

  function managerRequestValue(request, keys) {
    for (const key of keys) {
      if (request?.[key] !== undefined && request?.[key] !== null && request?.[key] !== '') {
        return request[key];
      }
    }
    return '';
  }

  function openManagerAssistanceTaskModal(item) {
    if (!todayTaskActionAllowed(
      item,
      ['complete_manager_assistance'],
      ['admin', 'manager'].includes(state.data?.user?.role)
        && can('view_team'),
    )) return toast('当前账号无权完成该协助请求');
    const account = state.data.accounts.find(row => row.id === item.customerId);
    const request = item.managerRequest || {};
    const requester = managerRequestValue(request, [
      'requesterName', 'applicantName', 'requestedByName', 'userName', 'requesterId',
    ]);
    const requestedAt = managerRequestValue(request, ['requestedAt', 'createdAt', 'occurredAt']);
    const reason = managerRequestValue(request, [
      'reason', 'requestReason', 'summary', 'content', 'progressContent', 'detail',
    ]) || item.detail;
    const originalPlan = managerRequestValue(request, ['originalPlan', 'nextAction', 'plan']) || '未记录';
    const dueAt = managerRequestValue(request, ['dueAt', 'deadline']);
    const contacts = Array.isArray(request.contacts) && request.contacts.length
      ? request.contacts.map(contact => `${esc(contact.name || '未命名')}${contact.title ? ` · ${esc(contact.title)}` : ''}${contact.department ? ` · ${esc(contact.department)}` : ''}${contact.matchStatus === 'mismatch' ? ' · 已标记不对口' : ''}`).join('<br>')
      : '暂无联系人记录';
    openModal('处理协助请求', '回复销售并完成主管任务', `
      <form id="todayTaskManagerForm" class="form-grid today-task-form" data-today-task-form>
        <input type="hidden" name="customerId" value="${esc(item.customerId)}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        ${todayTaskFactGrid([
          ['客户', accountDisplayName(account || item)],
          ['申请人', requester || '未记录'],
          ['处理期限', dueAt ? shortDate(dueAt, true) : '未设置'],
        ])}
        <div class="today-task-request"><span>申请原因</span><p>${esc(reason || '未记录具体原因')}</p></div>
        <div class="today-task-request"><span>销售原计划</span><p>${esc(originalPlan)}</p></div>
        <div class="today-task-request"><span>现有联系人</span><p>${contacts}</p></div>
        <label>主管处理意见<textarea name="result" rows="4" maxlength="2000" required placeholder="填写本次处理意见、已完成的协助和后续安排"></textarea></label>
        ${todayTaskErrorMarkup()}
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">回复销售并完成主管任务</button></div>
      </form>`, 'today-task-modal');
  }

  async function openTodayTaskAction(item) {
    if (!item) return toast('待办已更新，请刷新后重试');
    const kind = todayTaskActionKind(item);
    if (kind === 'overdue-lead') return openOverdueLeadTaskModal(item);
    if (kind === 'deferred-plan') return openNextPlanTaskModal(item);
    if (kind === 'next-plan') return openActivityModal(item.customerId, 'plan', {
      todayTaskTitle: item.title,
      todayTaskAction: '只更新下一步计划，不虚构客户新进展',
      todayTaskActionType: 'add_next_plan',
    });
    if (kind === 'manager-receipt') return openActivityModal(item.customerId, 'plan', {
      todayTaskTitle: '主管已回复，待销售确认并制定下一步计划',
      todayTaskAction: item.managerReply?.result || '保存下一步计划后完成协助闭环',
      todayTaskActionType: 'confirm_manager_assistance',
    });
    if (kind === 'manager-assistance') return openManagerAssistanceTaskModal(item);
    if (kind === 'quote') {
      if (!todayTaskActionAllowed(item, ['record_quote', 'quote'], can('record_quote'))) {
        return toast('当前账号没有记录报价权限');
      }
      return openQuoteModal(item.customerId, { fromTodayTask: true });
    }
    if (kind === 'activity') {
      if (!todayTaskActionAllowed(item, ['record_activity', 'activity'], can('record_activity'))) {
        return toast('当前账号没有记录进展权限');
      }
      openActivityModal.todayTaskContext = {
        todayTaskTitle: item.title,
        todayTaskAction: item.action,
      };
      return openActivityModal(item.customerId);
    }
    toast('该待办暂时没有可执行操作');
  }

  async function loadActivityReactions({ force = false, admin = false } = {}) {
    if (!force && state.activityReactionsLoaded && !admin) return state.activityReactions;
    const path = admin ? '/activity-reactions/admin' : '/activity-reactions';
    const result = await api(path);
    const rows = normalizeActivityReactions(result.reactions);
    if (admin) state.activityReactionAdminRows = rows.filter(item => item.active);
    state.activityReactions = rows.filter(item => item.active);
    state.activityReactionsLoaded = true;
    return admin ? rows : state.activityReactions;
  }

  function activityCustomerIdentity(customer) {
    const officialName = String(customer?.companyName || customer?.company_name || '').trim();
    const externalId = String(
      customer?.externalCustomerId || customer?.external_customer_id || customer?.id || '',
    ).trim();
    return customer?.nickname
      ? [officialName, externalId].filter(Boolean).join(' · ')
      : externalId;
  }

  function activityCustomerDisplayName(customer) {
    return String(customer?.nickname || customer?.companyName || customer?.company_name
      || customer?.externalCustomerId || customer?.external_customer_id || customer?.id || '').trim();
  }

  function renderActivityCustomerResults(message = '') {
    const root = $('#activityCustomerResults');
    if (!root) return;
    const rows = state.activityCustomerResults;
    if (message) {
      root.innerHTML = `<div class="activity-customer-result-state">${esc(message)}</div>`;
      root.classList.add('open');
      return;
    }
    if (!rows.length) {
      root.innerHTML = '';
      root.classList.remove('open');
      return;
    }
    root.innerHTML = rows.map((customer, index) => `
      <button type="button" role="option" id="activityCustomerOption${index}"
        aria-selected="${index === state.activityCustomerActiveIndex}"
        class="activity-customer-result${index === state.activityCustomerActiveIndex ? ' active' : ''}"
        data-activity-customer-result="${index}">
        <strong>${esc(activityCustomerDisplayName(customer))}</strong>
        <span>${esc(activityCustomerIdentity(customer))}${activityCustomerIdentity(customer) ? ' · ' : ''}${esc(customer.ownerName || '未分配')}</span>
      </button>`).join('');
    root.classList.add('open');
    const input = $('#activityCustomerSearch');
    if (input) input.setAttribute('aria-activedescendant',
      state.activityCustomerActiveIndex >= 0 ? `activityCustomerOption${state.activityCustomerActiveIndex}` : '');
  }

  function renderActivityCustomerPicker({ focusSearch = false } = {}) {
    const root = $('#activityCustomerPicker');
    const form = $('#activityForm');
    if (!root || !form) return;
    const customer = state.activitySelectedCustomer;
    const proposalDetails = $('.action-proposal-details');
    if (proposalDetails) {
      proposalDetails.classList.toggle('hidden', !String(
        customer?.externalCustomerId || customer?.external_customer_id || '',
      ).trim());
    }
    form.elements.customerId.value = customer?.id || '';
    if (customer) {
      root.innerHTML = `<section class="activity-customer-selected">
        <div><span>已选择客户</span><strong>${esc(activityCustomerDisplayName(customer))}</strong>
          <small>${esc(activityCustomerIdentity(customer))}${activityCustomerIdentity(customer) ? ' · ' : ''}${esc(customer.ownerName || '未分配')}</small></div>
        <button class="text-button" type="button" data-change-activity-customer>更换客户</button>
      </section>`;
      return;
    }
    root.innerHTML = `<div class="activity-customer-search-wrap">
      <label for="activityCustomerSearch">客户搜索</label>
      <input id="activityCustomerSearch" type="search" autocomplete="off" placeholder="搜索客户昵称、正式公司名称或客户编号"
        role="combobox" aria-autocomplete="list" aria-controls="activityCustomerResults" aria-expanded="false">
      <div id="activityCustomerResults" class="activity-customer-results" role="listbox"></div>
    </div>`;
    if (focusSearch) requestAnimationFrame(() => $('#activityCustomerSearch')?.focus());
  }

  async function searchActivityCustomers(query) {
    const normalized = String(query || '').trim();
    const requestEpoch = ++state.activityCustomerRequestEpoch;
    state.activityCustomerActiveIndex = -1;
    if (!normalized) {
      state.activityCustomerResults = [];
      renderActivityCustomerResults();
      return;
    }
    renderActivityCustomerResults('正在搜索有权客户…');
    try {
      const result = await api(`/activity-customers?q=${encodeURIComponent(normalized)}`, { timeoutMs: 10000 });
      if (requestEpoch !== state.activityCustomerRequestEpoch) return;
      state.activityCustomerResults = (result.customers || []).map(normalizeActivityCustomer).filter(customer => customer?.id);
      state.activityCustomerActiveIndex = state.activityCustomerResults.length ? 0 : -1;
      renderActivityCustomerResults(state.activityCustomerResults.length ? '' : '没有找到可记录进展的客户');
      $('#activityCustomerSearch')?.setAttribute('aria-expanded', String(Boolean(state.activityCustomerResults.length)));
    } catch (error) {
      if (requestEpoch !== state.activityCustomerRequestEpoch) return;
      state.activityCustomerResults = [];
      renderActivityCustomerResults(error.status === 403 ? '当前账号无权搜索客户' : (error.message || '客户搜索失败'));
    }
  }

  function selectActivityCustomer(customer) {
    state.activitySelectedCustomer = normalizeActivityCustomer(customer);
    state.activityCustomerResults = [];
    state.activityCustomerActiveIndex = -1;
    renderActivityCustomerPicker();
  }

  function progressOption(progressType) {
    return activityProgressOptions.find(item => item.key === progressType) || activityProgressOptions[0];
  }

  function progressTypeForLegacy(activityType, channel) {
    const normalizedChannel = String(channel || '').toLocaleLowerCase('en-US');
    const exact = activityProgressOptions.find(item => item.activityType === activityType
      && item.channel.toLocaleLowerCase('en-US') === normalizedChannel);
    if (exact) return exact.key;
    const sameType = activityProgressOptions.filter(item => item.activityType === activityType);
    return sameType.length === 1 ? sameType[0].key : '';
  }

  function setProgressType(progressType) {
    const option = progressOption(progressType);
    state.activityProgressType = option.key;
    state.activityType = option.activityType;
    const form = $('#activityForm');
    if (!form) return;
    form.elements.progressType.value = option.key;
    form.elements.activityType.value = option.activityType;
    form.elements.channel.value = option.channel;
    const submit = $('#activitySubmit');
    if (submit) submit.textContent = option.key === 'rfq' ? '继续填写询价信息' : '保存进展';
  }

  function setActivityReaction(reactionOptionId) {
    const form = $('#activityForm');
    if (!form) return;
    const reaction = state.activityReactions.find(item => item.id === reactionOptionId);
    if (form.elements.reactionOptionId) form.elements.reactionOptionId.value = reaction?.id || '';
    if (form.elements.outcome) form.elements.outcome.value = reaction?.name || '';
  }

  function resizeActivitySummary(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const computed = getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const verticalPadding = (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0);
    const maxHeight = lineHeight * 5 + verticalPadding + 2;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function showActivityRfqStep(show = true) {
    const main = $('#activityMainStep');
    const rfq = $('#activityRfqStep');
    if (!main || !rfq) return;
    main.classList.toggle('hidden', show);
    rfq.classList.toggle('hidden', !show);
    $('#modalEyebrow').textContent = show ? '询价补充信息 · 最后一步' : '选择客户后，记录本次进展与下一步计划';
    requestAnimationFrame(() => (show ? rfq.querySelector('input') : main.querySelector('select'))?.focus());
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
    const progressType = progressTypeForLegacy(value.activityType, value.channel);
    if (progressType) {
      setActivityField(form, 'progressType', progressType);
      setProgressType(progressType);
    } else {
      state.activityProgressType = '';
      state.activityType = '';
      setActivityField(form, 'progressType', '');
      setActivityField(form, 'activityType', '');
      setActivityField(form, 'channel', '');
    }
    setActivityReaction('');
    const reaction = state.activityReactions.find(item => item.name === String(value.outcome || '').trim());
    if (reaction) {
      setActivityField(form, 'reactionOptionId', reaction.id);
      setActivityReaction(reaction.id);
    }
    setActivityField(form, 'summary', value.summary);
    setActivityField(form, 'nextAction', value.nextAction);
    setActivityField(form, 'nextActionAt', suggestedPlanDateInput(value.nextActionAt));
    setActivityField(form, 'proposalJobId', task.taskId);
    const missingLabels = {
      activityType: '本次进展', channel: '本次进展', outcome: '客户反应',
      summary: '进展内容', nextAction: '下一步计划', nextActionAt: '下次跟进时间',
    };
    const missing = (value.missingFields || [])
      .filter(field => field !== 'outcome')
      .map(field => missingLabels[field] || field);
    if (!progressType) missing.push('本次进展（请重新选择）');
    if (String(value.outcome || '').trim() && !reaction && state.activityReactions.length) {
      missing.push('客户反应（请从当前配置中选择）');
    }
    const confidence = Math.round(Number(value.confidence || 0) * 100);
    const status = $('#actionProposalStatus');
    status.className = `action-proposal-status ${confidence < 70 || missing.length ? 'warning' : 'ready'}`;
    status.textContent = missing.length
      ? `AI 草稿置信度 ${confidence}%。确认前请补充：${missing.join('、')}。`
      : `AI 草稿置信度 ${confidence}%。请核对并修改，确认后才会写入客户时间线。`;
    $('#activitySubmit').textContent = progressType === 'rfq' ? '继续填写询价信息' : '保存进展';
    resizeActivitySummary(form.elements.summary);
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
    if (!customerAIEnabled() || !can('use_ai_assistant')) return;
    const form = $('#activityForm');
    const button = $('#actionProposalGenerate');
    const status = $('#actionProposalStatus');
    const input = $('#actionProposalInput')?.value.trim() || '';
    const account = state.activitySelectedCustomer;
    if (!account) return toast('请先选择客户');
    if (!String(account.externalCustomerId || '').trim()) {
      return toast('该客户尚未关联稳定客户编号，暂不能使用 AI 整理');
    }
    if (input.length < 3) return toast('请描述本次触达结果');
    button.disabled = true;
    status.className = 'action-proposal-status';
    status.textContent = '正在整理活动字段…';
    try {
      const created = await api(`/api/sales-crm/ai/customers/${encodeURIComponent(account.externalCustomerId)}/action-proposals`, {
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

  function activityReactionField() {
    const settings = isRealAdmin()
      ? '<button id="activityReactionSettings" class="icon-button activity-reaction-settings" type="button" title="管理客户反应" aria-label="管理客户反应"><span data-tp-icon="settings" aria-hidden="true"></span></button>'
      : '';
    if (!state.activityReactions.length) {
      return settings
        ? `<div class="activity-reaction-admin-entry">${settings}<span>配置客户反应</span></div>`
        : '';
    }
    return `<div id="activityReactionField" class="activity-field">
      <div class="activity-field-heading"><label for="activityReaction">客户反应</label>${settings}</div>
      <select id="activityReaction" name="reactionOptionId">
        <option value="">请选择</option>
        ${state.activityReactions.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}
      </select>
    </div>`;
  }

  function captureActivityDraft() {
    const form = $('#activityForm');
    if (!form) return null;
    return {
      customer: state.activitySelectedCustomer ? { ...state.activitySelectedCustomer } : null,
      payload: formPayload(form),
      rfqStep: !$('#activityRfqStep')?.classList.contains('hidden'),
      proposalInput: $('#actionProposalInput')?.value || '',
      proposalStatus: $('#actionProposalStatus')?.textContent || '',
      proposalStatusClass: $('#actionProposalStatus')?.className || '',
    };
  }

  async function restoreActivityDraft() {
    const draft = state.activityDraftBeforeReactionAdmin;
    state.activityDraftBeforeReactionAdmin = null;
    if (!draft) return closeModal();
    await openActivityModal(draft.customer?.id || '');
    if (draft.customer) {
      state.activitySelectedCustomer = normalizeActivityCustomer(draft.customer);
      renderActivityCustomerPicker();
    }
    const form = $('#activityForm');
    if (!form) return;
    Object.entries(draft.payload || {}).forEach(([name, value]) => {
      const field = form.elements[name];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = String(value ?? '');
    });
    if (draft.payload?.progressType
        && activityProgressOptions.some(item => item.key === draft.payload.progressType)) {
      setProgressType(draft.payload.progressType);
    }
    setActivityReaction(
      state.activityReactions.some(item => item.id === draft.payload?.reactionOptionId)
        ? draft.payload.reactionOptionId
        : '',
    );
    if ($('#actionProposalInput')) $('#actionProposalInput').value = draft.proposalInput;
    if ($('#actionProposalStatus')) {
      $('#actionProposalStatus').textContent = draft.proposalStatus;
      $('#actionProposalStatus').className = draft.proposalStatusClass || 'action-proposal-status';
    }
    showActivityRfqStep(Boolean(draft.rfqStep));
    resizeActivitySummary(form.elements.summary);
  }

  function syncActivityModeSections(mode) {
    const form = $('#activityForm');
    if (!form) return;
    const sections = {
      progress: $('#activityProgressFields'),
      plan: $('#activityPlanFields'),
      noPlan: $('#activityNoPlanFields'),
      manager: $('#activityManagerFields'),
    };
    Object.entries(sections).forEach(([key, section]) => {
      if (!section) return;
      section.querySelectorAll('input, select, textarea').forEach(el => {
        el.disabled = key !== mode;
      });
    });
  }

  function setActivityModalMode(mode) {
    const form = $('#activityForm');
    if (!form || !['progress', 'plan', 'noPlan', 'manager'].includes(mode)) return;
    state.activityModalMode = mode;
    form.elements.activityMode.value = mode;
    $$('#activityModeTabs [data-activity-mode]').forEach(button => {
      const selected = button.dataset.activityMode === mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    $('#activityProgressFields')?.classList.toggle('hidden', mode !== 'progress');
    $('#activityPlanFields')?.classList.toggle('hidden', mode !== 'plan');
    $('#activityNoPlanFields')?.classList.toggle('hidden', mode !== 'noPlan');
    $('#activityManagerFields')?.classList.toggle('hidden', mode !== 'manager');
    syncActivityModeSections(mode);
    const submit = $('#activitySubmit');
    if (submit) {
      submit.textContent = {
        progress: '保存进展',
        plan: '保存计划',
        noPlan: '保存暂无计划状态',
        manager: '提交主管协助请求',
      }[mode];
    }
  }

  async function openActivityModal(customerId = '', initialMode = 'progress', options = {}) {
    const todayOptions = options.todayTaskActionType ? options : (openActivityModal.todayTaskContext || {});
    openActivityModal.todayTaskContext = null;
    if (!can('record_activity')) return toast('当前账号没有记录进展权限');
    try {
      await loadActivityReactions({ force: true });
    } catch (error) {
      return toast(error.message || '客户反应选项读取失败');
    }
    const account = state.data.accounts.find(item => item.id === customerId);
    state.activitySelectedCustomer = account ? normalizeActivityCustomer(account) : null;
    state.activityCustomerResults = [];
    state.activityCustomerActiveIndex = -1;
    state.activityProgressType = 'email';
    state.activityType = 'email';
    const initialPlan = account?.next_action || '';
    const initialPlanAt = account?.next_action_at
      ? storedPlanDateInputWithBasis(
        account.next_action_at,
        account.next_action_time_basis || 'legacy_local',
      )
      : dateInput(2);
    openModal('记录新进展', '选择客户后，记录本次进展与下一步计划', `
      <form id="activityForm" class="activity-progress-form">
        <input type="hidden" name="customerId" value="${esc(state.activitySelectedCustomer?.id || '')}">
        <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
        <input type="hidden" name="activityMode" value="${esc(initialMode)}">
        ${todayOptions.todayTaskTitle ? '<input type="hidden" name="todayTaskSource" value="alerts">' : ''}
        ${todayOptions.todayTaskActionType ? `<input type="hidden" name="todayTaskActionType" value="${esc(todayOptions.todayTaskActionType)}">` : ''}
        <input type="hidden" name="activityType" value="email">
        <input type="hidden" name="channel" value="email">
        <input type="hidden" name="outcome" value="">
        <input type="hidden" name="proposalJobId" value="">
        <section id="activityMainStep" class="activity-main-step">
          ${todayOptions.todayTaskTitle ? `<div class="today-task-context"><strong>${esc(todayOptions.todayTaskTitle)}</strong><span>${esc(todayOptions.todayTaskAction || '请记录完成该待办的真实客户进展')}</span></div>` : ''}
          <div id="activityModeTabs" class="segmented activity-mode-tabs" role="tablist" aria-label="进展记录模式">
            <button class="active" type="button" role="tab" data-activity-mode="progress">记录新进展</button>
            <button type="button" role="tab" data-activity-mode="plan">只更新下一步计划</button>
            <button type="button" role="tab" data-activity-mode="noPlan">暂无计划</button>
            <button type="button" role="tab" data-activity-mode="manager">请求主管协助</button>
          </div>
          <div id="activityCustomerPicker" class="activity-customer-picker"></div>
          <section id="activityProgressFields">
            <div class="activity-primary-grid">
              <div class="activity-field">
                <label for="activityProgressType">本次进展</label>
                <select id="activityProgressType" name="progressType" required>
                  ${activityProgressOptions.map(item => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}
                </select>
              </div>
              ${activityReactionField()}
            </div>
            <label class="activity-summary-field">进展内容
              <textarea id="activitySummary" name="summary" rows="2" maxlength="4000" placeholder="记录客户反馈、需求或当前障碍"></textarea>
            </label>
            <div class="activity-primary-grid">
              <label>下一步计划<input name="nextAction" placeholder="例如：追踪客户 BOM"></label>
              <label>下次跟进时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${dateInput(2)}"></label>
            </div>
            ${customerAIEnabled() && can('use_ai_assistant') ? `<details class="action-proposal-details">
              <summary>使用 AI 整理本次进展</summary>
              <section class="action-proposal-compose">
                <div><strong>AI 整理进展</strong><span>输入事实描述，AI 只填写草稿，不会直接写入 CRM。</span></div>
                <textarea id="actionProposalInput" maxlength="4000" placeholder="例如：客户通过邮件回复，对 STM32 有兴趣，本周五整理 BOM，下周一上午跟进。"></textarea>
                <button id="actionProposalGenerate" class="button secondary" type="button">整理为进展草稿</button>
                <p id="actionProposalStatus" class="action-proposal-status" role="status" aria-live="polite"></p>
              </section>
            </details>` : ''}
          </section>
          <section id="activityPlanFields" class="hidden form-grid activity-plan-fields">
            <label class="span-2">下一步计划<input name="planNextAction" maxlength="1000" placeholder="例如：联系客户采购负责人，确认是否有新项目"></label>
            <label class="span-2">下次跟进时间<input name="planNextActionAt" type="datetime-local" data-future-datetime value="${initialPlan ? esc(initialPlanAt) : dateInput(1)}"></label>
            <label class="span-2">本次说明（选填）<textarea name="planNote" rows="2" maxlength="1000" placeholder="目前没有发生新的客户动作，只补充下一步安排"></textarea></label>
            <p class="span-2 subtle activity-plan-hint">不会生成“发送邮件”等虚假进展。</p>
          </section>
          <section id="activityNoPlanFields" class="hidden form-grid activity-no-plan-fields">
            <label class="span-2">原因<textarea name="noPlanReason" rows="3" maxlength="1000" placeholder="说明当前为什么没有下一步计划"></textarea></label>
            <p class="span-2 subtle activity-plan-hint">将保存为真实状态，连续 3 次暂无计划会提醒主管关注。</p>
          </section>
          <section id="activityManagerFields" class="hidden form-grid activity-manager-fields">
            <label class="span-2">需要主管协助的原因<textarea name="managerReason" rows="3" maxlength="1000" placeholder="例如：已发邮件且社媒无回应，目前没有思路"></textarea></label>
            <label class="span-2">原计划<input name="managerNextAction" maxlength="1000" value="${esc(initialPlan)}" placeholder="希望主管协助查询联系人或给出对接建议"></label>
            ${account?.next_action_at ? `<p class="span-2 activity-manager-plan-time">原定 ${esc(String(initialPlanAt).replace('T', ' ').replace(/-/g, '/'))}</p>` : ''}
            <p class="span-2 subtle activity-plan-hint">提交后会生成主管待办，包含客户、申请人、协助原因、原计划、联系人、处理期限和完结条件。</p>
          </section>
          <div class="form-actions activity-form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button id="activitySubmit" class="button primary">保存进展</button></div>
        </section>
        <section id="activityRfqStep" class="activity-rfq-step hidden">
          <div class="activity-step-intro"><strong>补充询价信息</strong><span>这些信息只在收到询价时填写，提交后与本次进展一次性保存。</span></div>
          <div class="activity-primary-grid">
            <label>询价编号<input name="reference" placeholder="如 RFQ-2026-0719"></label>
            <label>BOM 行数<input name="bomLines" type="number" min="0"></label>
            <label>预估金额（USD）<input name="expectedValue" type="number" min="0"></label>
            <label>资料完整度<input name="completeness" type="number" min="0" max="100" value="80"></label>
          </div>
          <label>产品类别<input name="productCategory" placeholder="MCU、连接器、传感器等"></label>
          <div class="form-actions activity-form-actions"><button type="button" class="button secondary" data-activity-main-step>返回修改</button><button class="button primary">保存进展</button></div>
        </section>
      </form>`, 'activity-progress-modal');
    renderActivityCustomerPicker({ focusSearch: !state.activitySelectedCustomer });
    setActivityModalMode(initialMode);
    setProgressType('email');
    resizeActivitySummary($('#activitySummary'));
    constrainFutureDateTimes($('#activityForm'));
  }

  function renderActivityReactionAdminModal() {
    const rows = state.activityReactionAdminRows;
    openModal('管理客户反应', '全公司统一选项 · 仅管理员可修改', `
      <div class="activity-reaction-admin">
        <p class="subtle">改名或移除只影响今后的选择，已经记录的历史文字保持不变。</p>
        <form id="activityReactionCreateForm" class="activity-reaction-create">
          <label>新增客户反应<input name="name" maxlength="40" required placeholder="例如：等待样品"></label>
          <button class="button primary" type="submit">新增</button>
        </form>
        <div class="activity-reaction-admin-list">
          ${rows.length ? rows.map((item, index) => `<div class="activity-reaction-admin-row" data-reaction-row="${esc(item.id)}">
            <input value="${esc(item.name)}" maxlength="40" aria-label="客户反应名称">
            <div class="activity-reaction-order">
              <button class="icon-button" type="button" data-reaction-move="${esc(item.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
              <button class="icon-button" type="button" data-reaction-move="${esc(item.id)}" data-direction="1" ${index === rows.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
            </div>
            <button class="button secondary tiny" type="button" data-reaction-save="${esc(item.id)}">保存</button>
            <button class="button danger tiny" type="button" data-reaction-remove="${esc(item.id)}">移除</button>
          </div>`).join('') : '<div class="empty">尚未配置客户反应，新增后销售即可选择。</div>'}
        </div>
        <div class="form-actions"><button type="button" class="button secondary" data-return-activity-draft>完成</button></div>
      </div>`, 'activity-reaction-admin-modal');
  }

  async function openActivityReactionAdmin() {
    if (!isRealAdmin()) return toast('只有真实管理员可以管理客户反应');
    state.activityDraftBeforeReactionAdmin = captureActivityDraft();
    try {
      await loadActivityReactions({ force: true, admin: true });
      renderActivityReactionAdminModal();
    } catch (error) {
      state.activityDraftBeforeReactionAdmin = null;
      toast(error.message || '客户反应配置读取失败');
    }
  }

  async function reloadActivityReactionAdmin(message = '') {
    await loadActivityReactions({ force: true, admin: true });
    renderActivityReactionAdminModal();
    if (message) toast(message);
  }

  async function saveActivityReaction(reactionId) {
    if (!isRealAdmin()) return toast('身份检查状态下不能修改客户反应');
    const row = document.querySelector(`[data-reaction-row="${CSS.escape(reactionId)}"]`);
    const name = row?.querySelector('input')?.value.trim() || '';
    if (!name) return toast('客户反应名称不能为空');
    await api(`/activity-reactions/${encodeURIComponent(reactionId)}`, {
      method: 'PATCH', body: JSON.stringify({ name }),
    });
    await reloadActivityReactionAdmin('客户反应名称已更新');
  }

  async function removeActivityReaction(reactionId) {
    if (!isRealAdmin()) return toast('身份检查状态下不能修改客户反应');
    await api(`/activity-reactions/${encodeURIComponent(reactionId)}`, { method: 'DELETE' });
    await reloadActivityReactionAdmin('客户反应已停止提供新选择');
  }

  async function moveActivityReaction(reactionId, direction) {
    if (!isRealAdmin()) return toast('身份检查状态下不能修改客户反应');
    const rows = state.activityReactionAdminRows.filter(item => item.active);
    const index = rows.findIndex(item => item.id === reactionId);
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
    [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
    await api('/activity-reactions/order', {
      method: 'PUT', body: JSON.stringify({ ids: rows.map(item => item.id) }),
    });
    await reloadActivityReactionAdmin('客户反应顺序已更新');
  }

  function openNewCustomerModal() {
    const sales = state.data.todayTaskAssignmentCandidates || [];
    const canLeaveUnassigned = can('view_all_customers') && can('manage_intake');
    const ownerOptions = `${canLeaveUnassigned ? '<optgroup label="操作"><option value="__unassigned__">暂不分配</option></optgroup>' : ''}<optgroup label="销售人员">${sales.map(user => `<option value="${user.id}" ${user.id === state.data.user.id ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</optgroup>`;
    openModal('新增对口客户', '客户录入', `<form id="customerForm" class="form-grid two customer-intake-form">
      <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <label class="span-2">公司名称<input name="companyName" placeholder="当地官方名称；公司名称或官网至少填写一项"><small>优先填写企业当地官方名称，作为客户主展示名</small></label>
      <label>本地名称/别名（选填）<input name="russianName"><small>公司名称不是当地官方名称或存在常用别名时填写</small></label>
      <label>英文名称（选填）<input name="englishName"></label>
      <label>官网<input name="website" type="url" placeholder="https://example.com"></label>
      <label>国家（可选）<input name="country"></label><label>城市<input name="city"></label>
      <label>行业<input name="industry" placeholder="工业控制、汽车电子等"></label><label>客户类型<select name="customerType"><option>终端制造商</option><option>EMS/代工厂</option><option>贸易商</option><option>维修企业</option><option>方案公司</option></select></label>
      <label>客户来源<select name="source"><option>公司指派</option><option>销售自行搜索</option><option>展会</option><option>LinkedIn</option><option>海关数据</option><option>老客户介绍</option></select></label>
      <label>负责人<select name="ownerId" id="newCustomerOwner">${ownerOptions}</select></label>
      <label>重点产品<input name="productFocus" placeholder="IC、连接器、传感器等"></label><label>成立年份（选填）<input name="establishedYear" inputmode="numeric" list="new-customer-year-options" pattern="[0-9]{4}" placeholder="搜索或选择年份"><datalist id="new-customer-year-options">${yearOptions()}</datalist></label>
      <label>优先级<select name="priority"><option>A</option><option selected>B</option><option>C</option></select></label><label>首次行动时间<input name="nextActionAt" type="datetime-local" data-future-datetime value="${dateInput(1)}"></label>
      <label class="span-2">下一步<input name="nextAction" value="完成首次触达"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" id="newCustomerSubmit">创建客户</button></div>
    </form>`, 'customer-intake-modal');
    constrainFutureDateTimes($('#customerForm'));
  }

  function openQuoteModal(customerId, options = {}) {
    openModal('记录报价', 'QUOTATION', `<form id="quoteForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      ${options.fromTodayTask ? '<input type="hidden" name="todayTaskSource" value="alerts">' : ''}
      <label>报价金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>预计毛利率 %<input name="grossMargin" type="number" step=".1" value="8"></label><label>报价后跟进时间<input name="nextFollowAt" type="datetime-local" data-future-datetime value="${dateInput(3)}"></label>
      <label class="span-2 check"><input name="lossLeader" type="checkbox"> 首单低价/亏本引流报价</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存报价</button></div>
    </form>`);
    constrainFutureDateTimes($('#quoteForm'));
  }
  function openOrderModal(customerId) {
    const quotes = state.data.quotes.filter(item => item.customer_id === customerId)
      .slice().sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')));
    openModal('记录客户订单', 'ORDER WON', `<form id="orderForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <input type="hidden" name="idempotencyKey" value="${esc(proposalRequestId())}">
      <label class="span-2">关联报价<select name="quoteId" required>${quotes.map(quote => `<option value="${esc(quote.id)}">${esc(quote.id)} · ${money(quote.amount)} ${esc(quote.currency || 'USD')} · ${esc(quote.status || 'sent')}</option>`).join('')}</select></label>
      <label>订单金额<input name="amount" type="number" min="0" required></label><label>币种<select name="currency"><option>USD</option><option>EUR</option><option>CNY</option></select></label>
      <label>实际毛利率 %<input name="grossMargin" type="number" step=".1" value="5"></label><label>下一次经营动作<input name="nextActionAt" type="datetime-local" data-future-datetime value="${dateInput(14)}"></label>
      <label class="span-2 check"><input name="isRepeat" type="checkbox"> 这是复购订单</label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">确认订单</button></div>
    </form>`);
    constrainFutureDateTimes($('#orderForm'));
  }
  function groupOptions(role, selected = '') {
    return (state.data.permissionGroups || []).filter(group => group.role === role)
      .map(group => `<option value="${esc(group.id)}" ${group.id === selected ? 'selected' : ''}>${esc(group.name)}</option>`).join('');
  }

  function groupPermissionValues(groupId, fallback = {}) {
    return (state.data.permissionGroups || []).find(group => group.id === groupId)?.permissions || fallback;
  }

  const PERMISSION_CATEGORIES = Object.freeze([
    Object.freeze({
      key: 'scope', label: '客户范围',
      description: '决定这个角色能看到哪些客户资料，这是最容易造成数据泄露的部分。',
      sensitivity: 'danger',
      permissions: Object.freeze([
        'view_customers', 'view_all_customers', 'view_intake', 'view_contacts',
        'view_own_mismatch_history', 'manage_protected_customers', 'view_team',
      ]),
    }),
    Object.freeze({
      key: 'action', label: '客户动作',
      description: '决定这个角色能对客户执行哪些业务动作。',
      sensitivity: '',
      permissions: Object.freeze([
        'manage_intake', 'manage_customer_recycle', 'reject_own_customer_mismatch',
        'manage_manual_customer_deletion', 'manage_customer_contacts', 'create_customer',
        'edit_customer', 'record_activity', 'correct_own_activity',
        'record_collaboration_support', 'record_quote', 'record_order',
      ]),
    }),
    Object.freeze({
      key: 'admin', label: '管理与审计',
      description: '管理、审计、导出与权限维护能力，只开放给需要的人。',
      sensitivity: '',
      permissions: Object.freeze([
        'manage_evaluations', 'manage_activity_corrections', 'view_users', 'manage_users',
        'manage_manager_task_settings', 'resolve_manager_tasks', 'export_data',
        'run_recon', 'use_prospect_agent', 'use_ai_assistant', 'cancel_ai_tasks',
        'bulk_manage_ai_tasks', 'manage_ai_budgets', 'review_ai_tasks',
      ]),
    }),
    Object.freeze({
      key: 'module', label: '模块入口',
      description: '决定这个角色可以进入哪些页面。',
      sensitivity: '',
      permissions: Object.freeze([
        'view_dashboard', 'view_alerts', 'view_notifications', 'view_recon',
        'view_pipeline', 'view_insights', 'view_markets', 'manage_data_maintenance',
      ]),
    }),
  ]);

  const PERMISSION_PACKS = Object.freeze([
    Object.freeze({
      key: 'sales', role: 'sales', name: '销售基础包',
      description: '适合普通销售：跟进本人客户，记录进展和订单里程碑。',
    }),
    Object.freeze({
      key: 'manager', role: 'manager', name: '主管协作包',
      description: '适合主管：查看团队问题、处理协助、做常规分配。',
    }),
    Object.freeze({
      key: 'admin', role: 'admin', name: '管理员维护包',
      description: '适合少数管理员：权限、查重、数据维护和导出。',
    }),
  ]);

  function permissionConclusion(permissions = {}) {
    const on = key => Boolean(permissions[key]);
    const parts = [];
    if (on('view_customers')) parts.push('可查看并处理本人负责的客户');
    if (on('view_all_customers')) parts.push('可查看团队与全公司客户');
    else if (on('view_customers')) parts.push('不能查看团队全部客户');
    if (on('manage_users')) parts.push('可管理账号与权限');
    else parts.push('不能管理权限');
    if (on('export_data')) parts.push('可导出数据');
    else parts.push('不能导出数据');
    if (on('manage_protected_customers')) parts.push('可维护客户保护名单');
    else parts.push('不能维护客户保护名单');
    if (on('manage_data_maintenance')) parts.push('可做数据维护');
    else parts.push('不能做数据维护');
    return parts.join('；') + '。';
  }

  function permissionPackActive(role, permissions = {}) {
    const template = state.data.rolePermissions?.[role] || {};
    const keys = Object.keys(visiblePermissionDefinitions());
    if (!keys.length) return false;
    return keys.every(key => Boolean(permissions[key]) === Boolean(template[key]));
  }

  function applyPermissionPack(form, role) {
    if (!form) return;
    const template = state.data.rolePermissions?.[role] || {};
    form.querySelectorAll('[name^="permission__"]').forEach(input => {
      const key = input.name.slice('permission__'.length);
      input.checked = Boolean(template[key]);
    });
    refreshPermissionGroupSummary(form);
  }

  function refreshPermissionGroupSummary(form) {
    if (!form) return;
    const permissions = Object.fromEntries(
      Array.from(form.querySelectorAll('[name^="permission__"]'))
        .map(input => [input.name.slice('permission__'.length), input.checked]),
    );
    const conclusion = form.querySelector('[data-permission-conclusion] p');
    if (conclusion) conclusion.textContent = permissionConclusion(permissions);
    form.querySelectorAll('[data-permission-panel]').forEach(panel => {
      const inputs = Array.from(panel.querySelectorAll('[name^="permission__"]'));
      const onCount = inputs.filter(input => input.checked).length;
      const counter = panel.querySelector('[data-permission-counts]');
      if (counter) counter.textContent = `本页 ${inputs.length} 项 · 已开启 ${onCount} 项`;
    });
    form.querySelectorAll('[data-permission-pack]').forEach(button => {
      const pack = PERMISSION_PACKS.find(item => item.key === button.dataset.permissionPack);
      if (pack) button.classList.toggle('active', permissionPackActive(pack.role, permissions));
    });
  }

  function permissionCategoryMarkup(permissions = {}, groupPermissions = {}, active = 'module', prefix = 'personal') {
    const definitions = visiblePermissionDefinitions();
    const descriptions = state.data.permissionDescriptions || {};
    const tabs = PERMISSION_CATEGORIES.map(category => {
      const selected = category.key === active;
      const tabId = `permission-${prefix}-tab-${category.key}`;
      const panelId = `permission-${prefix}-panel-${category.key}`;
      return `<button id="${tabId}" class="${selected ? 'active' : ''}"
        type="button" role="tab" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}"
        aria-controls="${panelId}" data-permission-category="${category.key}">${category.label}</button>`;
    }).join('');
    const panels = PERMISSION_CATEGORIES.map(category => {
      const visiblePermissions = visibleCategoryPermissions(category, definitions);
      const tabId = `permission-${prefix}-tab-${category.key}`;
      const panelId = `permission-${prefix}-panel-${category.key}`;
      return `<section class="permission-switch-panel ${category.key === active ? '' : 'hidden'}"
      id="${panelId}" role="tabpanel" aria-labelledby="${tabId}" data-permission-panel="${category.key}">
      <div class="permission-switch-grid">${visiblePermissions.map(key => {
        const allowed = Boolean(permissions[key]);
        const followsGroup = allowed === Boolean(groupPermissions[key]);
        const label = definitions[key];
        const description = permissionDescription(category, key, label, descriptions);
        return `<label class="permission-override-row permission-switch-row">
          <span class="permission-switch-label"><strong>${esc(label)}</strong><small>${esc(description)} · ${followsGroup ? '跟随权限组' : '个人调整'}</small></span>
          <input type="checkbox" role="switch" name="personalPermission__${esc(key)}" ${allowed ? 'checked' : ''} aria-label="${esc(label)}">
        </label>`;
      }).join('')}</div>
      <p class="permission-category-status">
        本分类共 ${visiblePermissions.length} 项，<span class="permission-desktop-status">已完整显示，无需滚动</span><span class="permission-mobile-status">全部权限均在当前分类中</span>
      </p>
    </section>`;
    }).join('');
    return `<div class="permission-category-tabs" role="tablist" aria-label="权限分类">${tabs}</div>${panels}`;
  }

  function personalPermissionFields(permissions = {}, groupPermissions = {}) {
    return permissionCategoryMarkup(permissions, groupPermissions, 'module');
  }

  function renderPersonalPermissionEditor(form, permissions) {
    const editor = form?.querySelector('[data-personal-permission-editor]');
    if (editor) editor.innerHTML = personalPermissionFields(permissions);
  }

  function openUserModal() {
    const initialGroupId = (state.data.permissionGroups || []).find(group => group.role === 'sales')?.id || '';
    const initialPermissions = groupPermissionValues(initialGroupId, state.data.rolePermissions?.sales || {});
    openModal('新增团队用户', 'USER & ROLE', `<form id="userForm" class="form-grid two">
      <label>姓名<input name="name" required></label><label>工作邮箱<input name="email" type="email" required></label>
      <label>角色<select name="role" data-role-source><option value="sales">销售代表</option><option value="manager">销售经理</option><option value="admin">系统管理员</option></select></label>
      <label>权限组<select name="permissionGroupId" data-role-group required>${groupOptions('sales')}</select></label>
      <label>初始密码<input name="password" type="password" placeholder="留空则由系统随机生成" minlength="8" autocomplete="new-password"></label>
      <label class="span-2">语言（用逗号分隔）<input name="languages" placeholder="英文, 俄语"></label>
      <label>优势国家<input name="countries" placeholder="俄罗斯, 哈萨克斯坦"></label><label>优势渠道<input name="channels" placeholder="电话, Telegram"></label>
      <section class="span-2 new-user-permissions">
        <div class="recommendation"><strong>个人权限</strong><br>已按所选权限组显示实际结果，可在创建前直接选择允许或拒绝。</div>
        <div class="permission-override-list" data-personal-permission-editor>${personalPermissionFields(initialPermissions)}</div>
      </section>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">创建用户</button></div>
    </form>`);
  }

  function permissionFields(permissions = {}) {
    const definitions = visiblePermissionDefinitions();
    const descriptions = state.data.permissionDescriptions || {};
    const tabs = PERMISSION_CATEGORIES.map(category => {
      const selected = category.key === 'scope';
      const visiblePermissions = visibleCategoryPermissions(category, definitions);
      return `<button id="permission-group-tab-${category.key}" class="${selected ? 'active' : ''}"
        type="button" role="tab" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}"
        aria-controls="permission-group-panel-${category.key}" data-permission-category="${category.key}">${category.label}<span class="permission-tab-count">${visiblePermissions.length}</span></button>`;
    }).join('');
    const panels = PERMISSION_CATEGORIES.map(category => {
      const visiblePermissions = visibleCategoryPermissions(category, definitions);
      const onCount = visiblePermissions.filter(key => Boolean(permissions[key])).length;
      return `<section class="permission-switch-panel ${category.key === 'scope' ? '' : 'hidden'}"
      id="permission-group-panel-${category.key}" role="tabpanel" aria-labelledby="permission-group-tab-${category.key}" data-permission-panel="${category.key}">
      <div class="permission-section-head">
        <div><h2>${category.label}</h2><p>${esc(category.description || '')}</p></div>
        <div class="permission-section-meta">
          ${category.sensitivity ? `<span class="permission-badge ${category.sensitivity}">${category.sensitivity === 'danger' ? '高敏感' : '需谨慎'}</span>` : ''}
          <span class="permission-category-counts" data-permission-counts>本页 ${visiblePermissions.length} 项 · 已开启 ${onCount} 项</span>
        </div>
      </div>
      <div class="permission-switch-grid permission-card-grid">${visiblePermissions.map(key => {
        const label = definitions[key];
        const description = permissionDescription(category, key, label, descriptions);
        return `<label class="permission-card permission-switch-row">
          <span class="permission-switch-label"><strong>${esc(label)}</strong><small>${esc(description)}</small></span>
          <input type="checkbox" role="switch" name="permission__${esc(key)}" ${permissions[key] ? 'checked' : ''} aria-label="${esc(label)}">
        </label>`;
      }).join('')}</div>
    </section>`;
    }).join('');
    return `<div class="permission-category-tabs" role="tablist" aria-label="权限分类">${tabs}</div>${panels}
    <div class="permission-principles">
      <div><b>命名原则</b>不再出现"客户回收站"等旧入口；所有名称必须对应当前左侧菜单或真实业务动作。</div>
      <div><b>配置原则</b>先定义数据范围，再定义可执行动作；避免销售因为一个开关看到范围外客户。</div>
      <div><b>保存原则</b>前端名称可以更清楚，但后端权限 key 必须兼容旧数据并继续服务端校验。</div>
    </div>`;
  }

  function selectPermissionCategoryTab(permissionCategoryButton) {
    if (!permissionCategoryButton || permissionCategoryButton.disabled) return false;
    $$('#modal [data-permission-category]').forEach(button => {
      const selected = button === permissionCategoryButton;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $$('#modal [data-permission-panel]').forEach(panel => {
      panel.classList.toggle('hidden', panel.dataset.permissionPanel !== permissionCategoryButton.dataset.permissionCategory);
    });
    return true;
  }

  function navigatePermissionCategoryTab(event) {
    const permissionCategoryTab = event.target.closest?.('#modal [data-permission-category][role="tab"]');
    if (!permissionCategoryTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    const tabs = $$('#modal [data-permission-category][role="tab"]').filter(tab => !tab.disabled);
    const currentIndex = tabs.indexOf(permissionCategoryTab);
    if (currentIndex < 0 || !tabs.length) return false;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex].click();
    tabs[nextIndex].focus();
    return true;
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

  function permissionGroupRole(form, group) {
    const roleSelect = form?.querySelector('select[name="role"]');
    return group?.role || (!roleSelect?.disabled ? roleSelect?.value : '') || '';
  }

  function applyPermissionGroupDefaults(form, defaults = {}) {
    form?.querySelectorAll('[name^="permission__"]').forEach(input => {
      const key = input.name.slice('permission__'.length);
      input.checked = Boolean(defaults[key]);
    });
  }

  function hidePermissionGroupResetConfirmation(form) {
    const confirmation = form?.querySelector('.permission-group-reset-confirm');
    confirmation?.classList.add('hidden');
    form?.classList.remove('permission-group-reset-visible');
    form?.querySelector('#restorePermissionGroupDefaults')?.focus();
  }

  function showPermissionGroupResetConfirmation(form) {
    const confirmation = form?.querySelector('.permission-group-reset-confirm');
    if (!form || !confirmation) return;
    form.classList.add('permission-group-reset-visible');
    confirmation.classList.remove('hidden');
    confirmation.querySelector('#cancelPermissionGroupDefaults')?.focus();
  }

  function cancelPermissionGroupReset(form) {
    hidePermissionGroupResetConfirmation(form);
  }

  function confirmPermissionGroupReset(form, group) {
    if (!form) return;
    const role = permissionGroupRole(form, group);
    applyPermissionGroupDefaults(form, state.data.rolePermissions?.[role] || {});
    form.dataset.permissionsReset = 'true';
    hidePermissionGroupResetConfirmation(form);
    refreshPermissionGroupSummary(form);
  }

  function openPermissionGroupModal(groupId = '') {
    const group = groupId ? (state.data.permissionGroups || []).find(item => item.id === groupId) : null;
    if (groupId && !group) return;
    const permissions = group?.permissions || state.data.rolePermissions?.sales || {};
    openModal(group ? `编辑权限组 · ${group.name}` : '新建权限组', '权限组', `<form id="permissionGroupForm" class="form-grid permission-group-form">
      <input type="hidden" name="groupId" value="${esc(group?.id || '')}">
      <div class="permission-group-layout">
        <aside class="permission-group-profile">
          <label class="permission-group-field">权限组名称<input name="name" value="${esc(group?.name || '')}" required placeholder="例如：销售经理权限"></label>
          <label class="permission-group-field">适用角色<select name="role" ${group ? 'disabled' : ''}>${['sales', 'manager', 'admin'].map(role => `<option value="${role}" ${role === (group?.role || 'sales') ? 'selected' : ''}>${roleLabel(role)}</option>`).join('')}</select></label>
          <label class="permission-group-field">业务说明<input name="description" value="${esc(group?.description || '')}" placeholder="例如：普通销售经理"></label>
          <div class="permission-conclusion" data-permission-conclusion>
            <strong>当前权限结论</strong>
            <p>${esc(permissionConclusion(permissions))}</p>
          </div>
          <div class="permission-packs" data-permission-packs>
            <div class="permission-packs-title">权限包</div>
            ${PERMISSION_PACKS.map(pack => `<button type="button" class="permission-pack${permissionPackActive(pack.role, permissions) ? ' active' : ''}" data-permission-pack="${pack.key}"><b>${pack.name}</b><span>${pack.description}</span></button>`).join('')}
          </div>
        </aside>
        <div class="permission-group-editor">${permissionFields(permissions)}</div>
      </div>
      ${group ? `<div class="permission-group-reset-confirm hidden" role="alert">
        <p><strong>恢复当前权限组默认？</strong><br>只恢复当前权限组的权限开关；个人权限例外、其他权限组、名称、角色和描述不会改变。保存权限组后生效。</p>
        <div class="assignment-actions">
          <button type="button" class="button secondary" id="cancelPermissionGroupDefaults">暂不恢复</button>
          <button type="button" class="button primary" id="confirmPermissionGroupDefaults">确认恢复</button>
        </div>
      </div>` : ''}
      <div class="form-actions permission-group-footer">
        ${group ? '<button type="button" class="button secondary" id="restorePermissionGroupDefaults">恢复权限组默认</button>' : '<span></span>'}
        <div class="assignment-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">${group ? '保存权限组' : '创建权限组'}</button></div>
      </div>
    </form>`, 'permission-group-modal');
  }

  function openOverridesModal(userId) {
    const user = state.data.users.find(item => item.id === userId);
    if (!user) return;
    const group = (state.data.permissionGroups || []).find(item => item.id === user.permissionGroupId);
    const groupPermissions = group?.permissions || {};
    openModal(`个人权限 · ${user.name}`, 'ALLOW OR DENY', `<form id="permissionOverrideForm" class="form-grid">
      <input type="hidden" name="userId" value="${esc(user.id)}">
      <div class="recommendation permission-override-user"><div><strong>${esc(user.email)}</strong><br>权限组：${esc(user.permissionGroupName || '未分配')}。开关开启表示允许、关闭表示拒绝；与权限组相同的开关会自动跟随权限组。</div><button type="button" class="button secondary" id="restoreUserPermissions">恢复权限组默认</button></div>
      <div class="permission-override-list" data-personal-permission-editor>${personalPermissionFields(user.permissions, groupPermissions)}</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存个人权限</button></div>
    </form>`, 'permission-modal-wide');
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
  function openCustomerProfileEditModal(customerId) {
    const account = state.data.accounts.find(item => item.id === customerId);
    if (!account) return toast('当前客户不在可编辑范围内');
    if (account.stage === 'disqualified') {
      toast('历史不对口客户请先通过不对口记录恢复');
      return;
    }
    const editableStages = state.data.stages.filter(item => item.key !== 'disqualified');
    const options = state.data.customerOptions || {};
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    const currentOwner = account.owner_id && !sales.some(user => user.id === account.owner_id)
      ? state.data.users.find(user => user.id === account.owner_id)
      : null;
    const canAssign = can('edit_customer') && can('view_all_customers') && can('manage_intake');
    const ownerOptions = `<optgroup label="操作"><option value="__unassigned__" ${account.owner_id ? '' : 'selected'}>暂不分配</option></optgroup><optgroup label="销售人员">${currentOwner ? `<option value="${esc(currentOwner.id)}" selected>${esc(currentOwner.name)}（当前负责人）</option>` : ''}${sales.map(user => `<option value="${user.id}" ${user.id === account.owner_id ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</optgroup>`;
    const nicknameField = customerAllowsNicknameEdit(account)
      ? `<label class="span-2">客户昵称<input name="nickname" value="${esc(account.nickname || '')}" maxlength="40" autocomplete="off" placeholder="最多40个字符，公司内部共用"></label>`
      : '';
    openModal('编辑客户资料', '客户资料', `<form id="customerProfileEditForm" class="form-grid two">
      <input type="hidden" name="customerId" value="${esc(customerId)}">
      <label>阶段<select name="stage">${editableStages.map(item => `<option value="${item.key}" ${item.key === account.stage ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
      <label>负责人<select name="ownerId" ${canAssign ? '' : 'disabled'}>${ownerOptions}</select></label>
      <label>优先级<select name="priority">${['A', 'B', 'C'].map(item => `<option ${item === account.priority ? 'selected' : ''}>${item}</option>`).join('')}</select></label>
      <label>成立年份（选填）<input name="establishedYear" inputmode="numeric" list="profile-year-options" pattern="[0-9]{4}" value="${esc(account.established_year || '')}" placeholder="搜索或选择年份"><datalist id="profile-year-options">${yearOptions(account.established_year)}</datalist></label>
      ${nicknameField}
      <label>国家 / 地区<input name="country" value="${esc(account.country)}"></label>
      <label>城市<input name="city" value="${esc(account.city)}"></label>
      <label class="span-2">官网<input name="website" type="url" value="${esc(account.website)}" placeholder="https://example.com"></label>
      <label>行业<input name="industry" value="${esc(account.industry)}"></label>
      <label>客户类型<select name="customerType">${selectedOptions(options.customerTypes, account.customer_type, '请选择客户类型')}</select></label>
      <label>来源<select name="source">${selectedOptions(options.sources, account.source, '请选择客户来源')}</select></label>
      <label class="span-2">重点产品<input name="productFocus" value="${esc(account.product_focus)}"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存资料</button></div>
    </form>`);
  }

  function openCustomerMasterEditModal() {
    const master = state.customerProfileMaster;
    if (!master || state.data.user?.role !== 'admin' || state.data.impersonation) return;
    const options = state.data.customerOptions || {};
    openModal('编辑客户主档', 'ADMIN MASTER PROFILE', `<form id="customerMasterForm" class="form-grid two">
      <label class="span-2">公司名称<input name="companyName" value="${esc(master.companyName)}"><small>优先填写企业当地官方名称，作为客户主展示名</small></label>
      <label>本地名称/别名（选填）<input name="russianName" value="${esc(master.russianName)}"><small>公司名称不是当地官方名称或存在常用别名时填写</small></label>
      <label>英文名称（选填）<input name="englishName" value="${esc(master.englishName)}"></label>
      <label>国家 / 地区<input name="country" value="${esc(master.country)}"></label>
      <label>城市<input name="city" value="${esc(master.city)}"></label>
      <label class="span-2">官网<input name="website" type="url" value="${esc(master.website)}" placeholder="https://example.com"></label>
      <label>行业<input name="industry" value="${esc(master.industry)}"></label>
      <label>客户类型<select name="customerType">${selectedOptions(options.customerTypes, master.customerType, '请选择客户类型')}</select></label>
      <label>成立年份（选填）<input name="establishedYear" inputmode="numeric" list="master-year-options" pattern="[0-9]{4}" value="${esc(master.establishedYear || '')}" placeholder="搜索或选择年份"><datalist id="master-year-options">${yearOptions(master.establishedYear)}</datalist></label>
      <label>评级<input name="rating" value="${esc(master.rating)}"></label>
      <label class="span-2">重点产品<input name="productFocus" value="${esc(master.products)}"></label>
      <label class="span-2">客户简介<textarea name="description">${esc(master.description)}</textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存主档</button></div>
    </form>`);
  }

  function synchronizeSharedNickname(externalCustomerId, nickname) {
    const normalizedId = String(externalCustomerId || '').trim();
    const normalizedNickname = String(nickname || '').trim();
    if (!normalizedId) return;
    const update = customer => {
      if (customer && sharedCustomerId(customer) === normalizedId) customer.nickname = normalizedNickname;
    };
    [
      state.data?.accounts,
      state.data?.intake?.items,
      state.customerList?.rows,
      state.recycleBin?.rows,
      state.data?.alerts,
      ...Object.values(state.authorizedBusinessLists || {}).map(meta => meta?.rows),
    ].forEach(rows => Array.isArray(rows) && rows.forEach(update));
    [
      state.customerProfileLead,
      state.customerProfileMaster,
      state.recycleCustomerDetail?.account,
      state.recycleCustomerDetail?.master,
    ].forEach(update);
    if (state.drawerNicknameTarget?.externalCustomerId === normalizedId) {
      state.drawerNicknameTarget.nickname = normalizedNickname;
    }
  }

  function renderAfterSharedNicknameUpdate(target) {
    renderAll();
    renderRecycleBin();
    if (!$('#customerDrawer')?.classList.contains('open')) return;
    if (target?.source === 'intake' && target.intakeItemId) {
      openIntakeProfile(target.intakeItemId);
    } else {
      renderDrawer();
    }
  }

  function openNicknameModal(customerId) {
    let target = customerId || state.drawerNicknameTarget;
    if (typeof target === 'string') {
      const account = state.data.accounts.find(item => item.id === target);
      target = nicknameTarget(account, { source: 'crm', crmCustomerId: target });
    }
    if (!target?.externalCustomerId || !can('edit_customer')) {
      return toast('当前客户不在可编辑范围内');
    }
    openModal(`${target.nickname ? '修改' : '创建'}客户昵称`, 'CUSTOMER NICKNAME', `<form id="nicknameForm" class="form-grid">
      <input type="hidden" name="externalCustomerId" value="${esc(target.externalCustomerId)}">
      <input type="hidden" name="nicknameSource" value="${esc(target.source || '')}">
      <input type="hidden" name="crmCustomerId" value="${esc(target.crmCustomerId || '')}">
      <input type="hidden" name="intakeItemId" value="${esc(target.intakeItemId || '')}">
      <label>客户名称<input value="${esc(target.companyName || '')}" readonly></label>
      <label>客户编号<input value="${esc(target.externalCustomerId)}" readonly></label>
      <label>客户昵称<input name="nickname" value="${esc(target.nickname || '')}" maxlength="40" autocomplete="off" placeholder="最多40个字符"></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存昵称</button></div>
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
    openModal('线索同步设置', 'INTAKE SETTINGS', `<form id="intakeSettingsForm" class="form-grid two">
      <label>运行状态<select name="enabled"><option value="true" ${value.enabled ? 'selected' : ''}>启用每日自动入库</option><option value="false" ${!value.enabled ? 'selected' : ''}>暂停自动入库</option></select></label>
      <label>领取时限（小时）<input name="claimSlaHours" type="number" min="1" max="72" value="${value.claimSlaHours}"></label>
      <label>首次触达时限（小时）<input name="contactSlaHours" type="number" min="1" max="168" value="${value.contactSlaHours}"></label>
      <label>允许同步组别<input name="matchGroups" value="${esc(value.matchGroups.join(','))}" placeholder="A,B,C,D"></label>
      <label class="span-2">同步国家（留空表示全部）<input name="countries" value="${esc(value.countries.join(','))}" placeholder="俄罗斯,巴西"></label>
      <div class="span-2 recommendation"><strong>分配方式</strong><br>同步只负责把线索放入线索池。管理员或销售经理勾选线索，或设置筛选条件后，再手动选择销售和分配数量。</div>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary">保存设置</button></div>
    </form>`);
  }

  function openIntakeAssignModal(itemId) {
    const item = state.data.intake.items.find(row => row.id === itemId);
    if (!item) return toast('线索已更新，请刷新后重试');
    if (intakeNeedsIdentityReview(item)) {
      return toast(item.identityWarning?.message || item.assignmentBlockReason || '该线索需要管理员核验客户身份后才能分配');
    }
    const sales = intakeAssignmentCandidates()
      .filter(user => String(user.id) !== String(item.assigned_owner_id || ''));
    if (!sales.length) return toast(item.assigned_owner_id ? '暂无其他可接收线索的在职销售' : '暂无可接收线索的在职销售');
    const suggestedOwnerId = customerAIEnabled() ? item.suggested_owner_id : '';
    const selectedOwnerId = sales.some(user => user.id === suggestedOwnerId) ? suggestedOwnerId : sales[0].id;
    openModal(item.crm_customer_id ? '重新分配客户' : '指定销售负责人', 'CUSTOMER ASSIGNMENT', `<form id="intakeAssignForm" class="form-grid">
      <input type="hidden" name="itemId" value="${esc(itemId)}">
      <div class="recommendation"><strong>${esc(item.company_name)}</strong><br>${esc(item.country)} · ${esc(item.contact_level)}</div>
      <label>当前负责人<span class="intake-current-owner">${esc(item.assigned_owner_name || '未分配')}</span></label>
      <label>销售负责人<select name="ownerId" required>${sales.map(user => `<option value="${esc(user.id)}" ${user.id === selectedOwnerId ? 'selected' : ''}>${esc(user.name)}</option>`).join('')}</select></label>
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
      reject: ['标记客户不对口', '说明不对口原因，客户将进入回收站“不对口”并可重新分配。'],
      trash: ['删除客户到回收站', '仅手工创建客户可执行，操作不会删除客户主档或经营历史。'],
      bulk: ['批量退回客户', '选中的客户会一次性退回，任一客户校验失败则全部不变。'],
    };
    const [title, note] = labels[action] || labels.return;
    openModal(title, '不对口记录', `<form id="recycleReasonForm" class="form-grid">
      <input type="hidden" name="customerId" value="${esc(customerId || '')}">
      <input type="hidden" name="action" value="${esc(action)}">
      <div class="recommendation">${esc(note)}</div>
      <label>原因<textarea name="reason" minlength="2" maxlength="500" required placeholder="请输入2至500个字符的原因"></textarea></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button danger">确认${esc(title)}</button></div>
    </form>`);
  }

  function openBulkCustomerAssignmentModal() {
    const count = customerSelectionCount();
    if (!count) return toast('请先勾选客户');
    const sales = state.data.users.filter(user => user.role === 'sales' && user.active && !user.archived);
    if (!sales.length) return toast('暂无可分配的在职销售');
    const scopeLabel = state.customerSelectionMode === 'filtered' ? '全部筛选结果' : '当前页已勾选客户';
    openModal('批量分配客户', 'BULK CUSTOMER ASSIGNMENT', `<form id="bulkCustomerAssignForm" class="form-grid">
      <div class="manual-assignment-summary">
        <div><span>分配范围</span><strong>${esc(scopeLabel)}</strong></div>
        <div><span>客户数量</span><strong>${esc(count)}</strong></div>
      </div>
      <label>目标销售<select name="ownerId" required>
        <option value="">请选择销售</option>
        ${sales.map(user => `<option value="${esc(user.id)}">${esc(user.name)}</option>`).join('')}
      </select></label>
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">确认分配</button></div>
    </form>`);
  }

  function openEvaluationModal(subjectType, contactId = '') {
    const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
    const contact = contactId ? state.data.insights.contacts.find(item => item.id === contactId) : null;
    const subjectName = subjectType === 'contact' ? contact?.name : accountDisplayName(account);
    const subjectTitle = subjectType === 'contact' ? contact?.title : '';
    const showAI = customerAIEnabled();
    openModal(subjectType === 'contact' ? `评价对接人：${subjectName}` : `评价企业：${accountDisplayName(account)}`, showAI ? 'MANAGER EVALUATION + AI LABELS' : 'MANAGER EVALUATION', `<form id="evaluationForm" class="form-grid">
      <input type="hidden" name="customerId" value="${esc(account.id)}"><input type="hidden" name="subjectType" value="${esc(subjectType)}">
      <input type="hidden" name="subjectId" value="${esc(contactId)}"><input type="hidden" name="subjectName" value="${esc(subjectName || '')}">
      <input type="hidden" name="subjectTitle" value="${esc(subjectTitle || '')}">
      <div class="recommendation"><strong>${esc(subjectName || '')}</strong>${subjectTitle ? `<br>${esc(subjectTitle)}` : ''}</div>
      <label>客户经营复盘<textarea name="evaluationText" required minlength="8" placeholder="${subjectType === 'company' ? '例如：公司规模很大但采购流程不规范，因此决策快、价格敏感度较低；质检实验室完整，赢单关键是提供可追溯质检服务。' : '例如：采购主管拥有供应商初筛权，重视响应速度和资料完整度；沟通直接，但最终价格需要老板确认。'}"></textarea></label>
      ${showAI ? '<div class="recommendation"><strong>AI如何处理</strong><br>系统会基于这段经理原文提取标签、风险、赢单关键和建议。所有生成内容均明确显示“AI标注”，不会覆盖经理原文。</div>' : ''}
      <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button class="button primary" type="submit">${showAI ? '保存并生成AI标注' : '保存评价'}</button></div>
    </form>`);
  }

  async function refresh(message = '') {
    const previous = state.data;
    const previousAIEnabled = Boolean(previous?.features?.aiStations);
    const previousSalesPackEnabled = previousAIEnabled && Boolean(previous?.features?.salesPack);
    const next = await api('/api/sales-crm/bootstrap', { timeoutMs: 15000 });
    for (const config of Object.values(researchConfig)) {
      if (previous?.[config.dataKey]?.length) next[config.dataKey] = previous[config.dataKey];
    }
    resetActivityCorrectionState();
    state.data = next;
    const aiGateChanged = previousAIEnabled !== customerAIEnabled()
      || previousSalesPackEnabled !== salesPackEnabled();
    stripDisabledAINotificationState();
    populateFilters();
    renderAll();
    if (!state.data.impersonation
        && (can('correct_own_activity') || can('manage_activity_corrections'))) {
      if (state.view === 'activityCorrections') {
        await Promise.all([
          initializeActivityCorrectionHistoryFilters(),
          initializeActivityCorrectionProposalFilters(),
        ]);
      } else {
        await loadActivityCorrectionWriteStatus();
      }
    }
    if (aiGateChanged && state.authorizedBusinessLists.notifications.filterMount) {
      await initializeAuthorizedBusinessFilters('notifications', { force: true });
    }
    renderImpersonationBanner();
    closeModal();
    if (message) toast(message);
  }

  async function refreshIntakeWorkflow(message = '') {
    await refresh();
    if (state.authorizedBusinessLists.intake?.filterController) {
      await loadAuthorizedBusinessPage('intake', { reset: true });
    }
    if (message) toast(message);
  }

  async function refreshTodayTasksAfterAction(message) {
    await refresh();
    await loadAuthorizedBusinessPage('alerts', { reset: true });
    $$('#alertTabs button').forEach(button => {
      button.classList.toggle('active', button.dataset.severity === state.alertSeverity);
    });
    toast(message);
  }

  async function submitTodayTaskAction(form, body, message) {
    if (form.dataset.submitting === 'true') return;
    const errorEl = form.querySelector('[data-today-task-error]');
    const buttons = Array.from(form.querySelectorAll('button'));
    const submitter = form._todayTaskSubmitter;
    const originalSubmitterText = submitter?.textContent || '';
    form.dataset.submitting = 'true';
    if (errorEl) errorEl.textContent = '';
    buttons.forEach(button => { button.disabled = true; });
    if (submitter) submitter.textContent = '处理中…';
    try {
      await api('/api/sales-crm/today-tasks/actions', {
        method: 'POST',
        body: JSON.stringify(body),
        preserveOnForbidden: true,
      });
      await refreshTodayTasksAfterAction(message);
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message;
      throw error;
    } finally {
      form.dataset.submitting = 'false';
      if (form.isConnected) {
        buttons.forEach(button => { button.disabled = false; });
        if (submitter) submitter.textContent = originalSubmitterText;
      }
      form._todayTaskSubmitter = null;
    }
  }

  function formPayload(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    form.querySelectorAll('input[type=checkbox]').forEach(input => { data[input.name] = input.checked; });
    return data;
  }
  function splitTags(value) {
    return String(value || '').split(/[,，]/).map(item => item.trim()).filter(Boolean);
  }
  function permissionsFromPayload(payload, fallback = {}) {
    const permissions = { ...fallback };
    Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
      if (Object.hasOwn(payload, `permission__${key}`)) {
        permissions[key] = Boolean(payload[`permission__${key}`]);
      }
      delete payload[`permission__${key}`];
    });
    return permissions;
  }

  function permissionGroupPermissions(form, payload, existingGroup) {
    const groupRole = permissionGroupRole(form, existingGroup) || payload.role;
    const permissionFallback = form.dataset.permissionsReset === 'true'
      ? state.data.rolePermissions?.[groupRole] || {}
      : existingGroup?.permissions || state.data.rolePermissions?.[groupRole] || {};
    return permissionsFromPayload(payload, permissionFallback);
  }

  function personalPermissionsFromPayload(payload, fallback = {}) {
    const permissions = { ...fallback };
    Object.keys(state.data.permissionDefinitions || {}).forEach(key => {
      const field = `personalPermission__${key}`;
      if (Object.hasOwn(payload, field)) permissions[key] = Boolean(payload[field]);
      delete payload[field];
    });
    return permissions;
  }

  document.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    try {
      const invalidFuture = Array.from(form.querySelectorAll('[data-future-datetime]'))
        .filter(input => !input.disabled && !input.closest('.hidden'))
        .find(input => !validateFutureDateTime(input));
      if (invalidFuture) throw new Error('下一步时间必须晚于当前时间');
      if (form.id === 'collaborationSupportForm') {
        await submitCollaborationSupport(form);
      } else if (form.id === 'activityCorrectionTargetForm') {
        if (!state.activityCorrection.targetCustomerId) throw new Error('请选择正确客户');
        state.activityCorrection.step = 2;
        renderActivityCorrectionModal();
      } else if (form.id === 'activityCorrectionReasonForm') {
        const reason = String(new FormData(form).get('reason') || '').trim();
        if (!reason) throw new Error('请填写更正原因');
        if (reason !== state.activityCorrection.reason) rotateActivityCorrectionIdempotencyKey();
        state.activityCorrection.reason = reason;
        state.activityCorrection.step = 3;
        renderActivityCorrectionModal();
      } else if (form.id === 'activityCorrectionConfirmForm') {
        await submitActivityCorrection();
      } else if (form.id === 'loginForm') {
        if (state.loginPending) return;
        state.loginPending = true;
        $('#loginError').textContent = '';
        setLoginState('login');
        await api('/api/sales-auth/login', { method: 'POST', body: JSON.stringify(formPayload(form)), timeoutMs: 10000 });
        setLoginState('workspace');
        await load({ fromLogin: true });
      } else if (form.id === 'protectedProfileForm') {
        const payload = formPayload(form);
        const externalCustomerId = payload.externalCustomerId;
        delete payload.externalCustomerId;
        const submit = event.submitter;
        if (submit) { submit.disabled = true; submit.textContent = '正在保存…'; }
        $('#protectedProfileError').textContent = '';
        try {
          await api(`/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}`, {
            method: 'PATCH', body: JSON.stringify(payload),
          });
          closeModal();
          await loadProtectedCustomers();
          toast('保护客户资料已更新');
        } catch (error) {
          $('#protectedProfileError').textContent = error.message;
          if (submit) { submit.disabled = false; submit.textContent = '保存资料'; }
        }
      } else if (form.id === 'protectedActivationForm') {
        const payload = formPayload(form);
        const externalCustomerId = payload.externalCustomerId;
        delete payload.externalCustomerId;
        const submit = event.submitter;
        if (submit) { submit.disabled = true; submit.textContent = '正在激活…'; }
        $('#protectedActivationError').textContent = '';
        try {
          await api(`/api/sales-crm/protected-customers/${encodeURIComponent(externalCustomerId)}/activate`, {
            method: 'POST', body: JSON.stringify(payload),
          });
          closeModal();
          await loadProtectedCustomers();
          toast('保护客户已激活并分配');
        } catch (error) {
          $('#protectedActivationError').textContent = error.message;
          if (submit) { submit.disabled = false; submit.textContent = '确认激活并分配'; }
        }
      } else if (form.id === 'protectedRollbackForm') {
        const payload = formPayload(form);
        const submit = event.submitter;
        if (submit) { submit.disabled = true; submit.textContent = '正在检查并回滚…'; }
        $('#protectedRollbackError').textContent = '';
        try {
          await rollbackProtectedBatch(payload.batchId, payload.reason);
          closeModal();
          toast('保护客户批次已回滚');
        } catch (error) {
          $('#protectedRollbackError').textContent = error.message;
          if (submit) { submit.disabled = false; submit.textContent = '确认条件回滚'; }
        }
      } else if (form.id === 'aiStrategyForm') {
        const payload = formPayload(form);
        payload.config = JSON.parse(payload.configJson || '{}');
        delete payload.configJson;
        await api('/api/sales-crm/ai/governance/strategies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        closeModal();
        await loadAiGovernance();
        toast('影子版本已创建');
      } else if (form.id === 'aiShadowEvaluationForm') {
        const payload = formPayload(form);
        const strategyId = payload.strategyId;
        await api(`/api/sales-crm/ai/governance/strategies/${encodeURIComponent(strategyId)}/evaluations`, {
          method: 'POST',
          body: JSON.stringify({
            outcome: payload.outcome,
            metrics: JSON.parse(payload.metricsJson || '{}'),
          }),
        });
        closeModal();
        await loadAiGovernance();
        toast('影子评估已保存');
      } else if (form.id === 'activityReactionCreateForm') {
        if (!isRealAdmin()) throw new Error('身份检查状态下不能修改客户反应');
        const name = String(formPayload(form).name || '').trim();
        if (!name) throw new Error('客户反应名称不能为空');
        await api('/activity-reactions', {
          method: 'POST', body: JSON.stringify({ name }),
        });
        await reloadActivityReactionAdmin('客户反应已新增');
      } else if (form.id === 'todayTaskOverdueForm') {
        const payload = formPayload(form);
        const resolution = event.submitter?.dataset.resolution || '';
        form._todayTaskSubmitter = event.submitter;
        if (!['reassign', 'return_to_pool'].includes(resolution)) {
          throw new Error('请选择重新分配或退回线索池');
        }
        if (resolution === 'reassign' && !payload.ownerId) throw new Error('请选择新负责人');
        await submitTodayTaskAction(form, {
          actionType: 'resolve_overdue_lead',
          intakeItemId: payload.intakeItemId,
          resolution,
          ...(resolution === 'reassign' ? { ownerId: payload.ownerId } : {}),
          idempotencyKey: payload.idempotencyKey,
        }, resolution === 'reassign' ? '超时线索已重新分配' : '超时线索已退回线索池');
      } else if (form.id === 'managerTaskSettingsForm') {
        if (!isRealAdmin() || !can('manage_manager_task_settings')) {
          throw new Error('只有真实管理员可以修改主管介入规则');
        }
        await saveManagerTaskSettings(form);
      } else if (form.id === 'managerTaskResolveForm') {
        const payload = formPayload(form);
        const supported = ['plan_formed', 'terminal_stage', 'reassigned', 'manager_advice', 'escalate_owner'];
        if (!supported.includes(payload.action)) throw new Error('请选择有效的主管处理方式');
        const body = {
          type: payload.action,
          idempotencyKey: payload.idempotencyKey,
        };
        if (['plan_formed', 'manager_advice'].includes(payload.action)) {
          if (!String(payload.nextAction || '').trim()) throw new Error('请填写明确的下一步计划');
          if (!validateFutureDateTime(form.elements.nextActionAt)) {
            throw new Error('下一步时间必须晚于当前时间');
          }
          body.nextAction = String(payload.nextAction).trim();
          body.nextActionAt = apiTime(payload.nextActionAt);
        }
        if (payload.action === 'manager_advice') {
          if (!String(payload.note || '').trim()) throw new Error('请填写主管建议');
          body.note = String(payload.note).trim();
        }
        if (payload.action === 'terminal_stage') {
          body.stage = payload.stage;
          body.note = String(payload.note || '').trim();
        }
        if (payload.action === 'reassigned') {
          if (!payload.ownerId) throw new Error('请选择新的在职销售负责人');
          body.ownerId = payload.ownerId;
        }
        if (payload.action === 'escalate_owner') {
          if (!String(payload.difficulty || '').trim()) throw new Error('请说明需进一步决策的难点');
          body.difficulty = String(payload.difficulty).trim();
        }
        const status = $('#managerResolveStatus');
        if (status) status.textContent = '正在保存业务变化…';
        await api(`/api/sales-crm/manager-tasks/${encodeURIComponent(payload.taskId)}/resolve`, {
          method: 'POST',
          preserveOnForbidden: true,
          body: JSON.stringify(body),
        });
        closeModal();
        await refresh();
        await Promise.all([
          loadAuthorizedBusinessPage('manager_tasks', { reset: true }),
          loadAuthorizedBusinessPage('manager_risks', { reset: true }),
          loadAuthorizedBusinessPage('manager_metrics', { reset: true }),
        ]);
        toast(payload.action === 'escalate_owner' ? '任务已升级为经营决策事项' : '主管处理已记录，业务状态已更新');
      } else if (form.id === 'todayTaskPlanForm') {
        const payload = formPayload(form);
        form._todayTaskSubmitter = event.submitter;
        const mode = form.dataset.planMode || 'explicit';
        if (mode === 'explicit') {
          if (!String(payload.nextAction || '').trim()) throw new Error('请填写下一步计划');
          if (!payload.nextActionAt) throw new Error('请选择计划执行时间');
          if (!validateFutureDateTime(form.elements.nextActionAt)) throw new Error('下一步时间必须晚于当前时间');
          // submitTodayTaskAction posts this path to /api/sales-crm/today-tasks/actions.
          await submitTodayTaskAction(form, {
            actionType: 'add_next_plan',
            customerId: payload.customerId,
            nextAction: String(payload.nextAction || '').trim(),
            nextActionAt: apiTime(payload.nextActionAt),
            idempotencyKey: payload.idempotencyKey,
          }, '下一步计划已保存，待办已更新');
        } else {
          if (!payload.reviewAt) throw new Error('请选择再次复查时间');
          if (!validateFutureDateTime(form.elements.reviewAt)) throw new Error('下一步时间必须晚于当前时间');
          await api(`/accounts/${encodeURIComponent(payload.customerId)}/deferred-plan`, {
            method: 'POST',
            preserveOnForbidden: true,
            body: JSON.stringify({
              reviewAt: apiTime(payload.reviewAt),
              reason: String(payload.reason || '').trim(),
              idempotencyKey: payload.idempotencyKey,
            }),
          });
          await refreshTodayTasksAfterAction('已记录暂未确定状态，将在复查时间重新提醒');
        }
      } else if (form.id === 'todayTaskManagerForm') {
        const payload = formPayload(form);
        form._todayTaskSubmitter = event.submitter;
        if (!String(payload.result || '').trim()) throw new Error('请填写主管处理意见');
        await submitTodayTaskAction(form, {
          actionType: 'complete_manager_assistance',
          customerId: payload.customerId,
          result: String(payload.result || '').trim(),
          idempotencyKey: payload.idempotencyKey,
        }, '已回复销售，等待销售确认下一步计划');
      } else if (form.id === 'managerAssistanceReplyForm') {
        const payload = formPayload(form);
        form._todayTaskSubmitter = event.submitter;
        if (!String(payload.result || '').trim()) throw new Error('请填写主管处理意见');
        await submitTodayTaskAction(form, {
          actionType: 'complete_manager_assistance',
          customerId: payload.customerId,
          result: String(payload.result || '').trim(),
          idempotencyKey: payload.idempotencyKey,
        }, '已回复销售，等待销售确认下一步计划');
        closeModal();
      } else if (form.id === 'activityForm') {
        if (state.activitySubmitting) return;
        const payload = formPayload(form);
        const mode = payload.activityMode || 'progress';
        if (!state.activitySelectedCustomer || payload.customerId !== state.activitySelectedCustomer.id) {
          throw new Error('请先搜索并选择客户');
        }
        const fromTodayTask = payload.todayTaskSource === 'alerts';
        const todayTaskActionType = payload.todayTaskActionType || '';
        delete payload.todayTaskSource;
        delete payload.todayTaskActionType;
        delete payload.activityMode;
        if (mode === 'plan') {
          if (!String(payload.planNextAction || '').trim()) throw new Error('请填写下一步计划');
          if (!payload.planNextActionAt) throw new Error('请选择下次跟进时间');
          if (!validateFutureDateTime(form.elements.planNextActionAt)) throw new Error('下一步时间必须晚于当前时间');
          const nextAction = String(payload.planNextAction || '').trim();
          const nextActionAt = apiTime(payload.planNextActionAt);
          const note = String(payload.planNote || '').trim();
          if (fromTodayTask && ['add_next_plan', 'confirm_manager_assistance'].includes(todayTaskActionType)) {
            await submitTodayTaskAction(form, {
              actionType: todayTaskActionType,
              customerId: payload.customerId,
              nextAction,
              nextActionAt,
              idempotencyKey: payload.idempotencyKey,
            }, todayTaskActionType === 'confirm_manager_assistance'
              ? '回执已确认，主管协助闭环完成'
              : '下一步计划已保存，待办已更新');
          } else {
            await api('/api/sales-crm/activities/plan-only', {
              method: 'POST',
              body: JSON.stringify({
                customerId: payload.customerId,
                nextAction,
                nextActionAt,
                note,
                idempotencyKey: payload.idempotencyKey,
              }),
            });
            await refresh('下一步计划已保存，未生成客户进展事件');
          }
          refreshDrawerNextActionTime();
          return;
        }
        if (mode === 'noPlan') {
          if (!String(payload.noPlanReason || '').trim()) throw new Error('请填写暂无计划的原因');
          payload.summary = String(payload.noPlanReason || '').trim();
          payload.noPlan = true;
          payload.nextAction = '';
          payload.nextActionAt = '';
          payload.activityType = 'note';
          payload.channel = '';
          delete payload.progressType;
          delete payload.reactionOptionId;
        }
        if (mode === 'manager') {
          if (!String(payload.managerReason || '').trim()) throw new Error('请填写需要主管协助的原因');
          payload.summary = String(payload.managerReason || '').trim();
          payload.managerRequired = true;
          payload.activityType = 'note';
          payload.channel = '';
          payload.nextAction = String(payload.managerNextAction || '').trim();
          payload.nextActionAt = '';
          delete payload.progressType;
          delete payload.reactionOptionId;
        }
        if (mode === 'progress' && payload.progressType === 'rfq' && $('#activityRfqStep')?.classList.contains('hidden')) {
          showActivityRfqStep(true);
          return;
        }
        const submitButtons = Array.from(form.querySelectorAll('button[type="submit"],button:not([type])'));
        state.activitySubmitting = true;
        submitButtons.forEach(button => { button.disabled = true; });
        try {
          if (payload.noPlan) {
            payload.nextAction = '';
            payload.nextActionAt = '';
          }
          payload.nextActionAt = apiTime(payload.nextActionAt);
          payload.bomLines = Number(payload.bomLines || 0);
          payload.expectedValue = Number(payload.expectedValue || 0);
          payload.completeness = Number(payload.completeness || 0);
          if (payload.progressType !== 'rfq') {
            delete payload.reference;
            delete payload.bomLines;
            delete payload.expectedValue;
            delete payload.completeness;
            delete payload.productCategory;
          }
          const result = await api('/api/sales-crm/activities', { method: 'POST', body: JSON.stringify(payload) });
          const stageBefore = result.stageBefore || result.previousStage || '';
          const stageAfter = result.stageAfter || result.stage || '';
          const stageChanged = result.stageChanged ?? Boolean(stageBefore && stageAfter && stageBefore !== stageAfter);
          const message = stageChanged
            ? `进展已记录，客户阶段已更新为“${stageLabel(stageAfter)}”`
            : mode === 'noPlan' ? '暂无计划已记录为真实状态'
              : mode === 'manager' ? '主管协助请求已提交'
                : '进展已记录，客户阶段未发生变化';
          if (fromTodayTask) await refreshTodayTasksAfterAction(message);
          else await refresh(message);
          refreshDrawerNextActionTime();
        } finally {
          state.activitySubmitting = false;
          if (form.isConnected) submitButtons.forEach(button => { button.disabled = false; });
        }
      } else if (form.id === 'customerForm') {
        const payload = formPayload(form);
        payload.companyName = String(payload.companyName || '').trim();
        payload.website = String(payload.website || '').trim();
        if (!payload.companyName && !payload.website) throw new Error('公司名称或官网至少填写一项');
        payload.nextActionAt = apiTime(payload.nextActionAt);
        try {
          const result = await api('/api/sales-crm/accounts', { method: 'POST', body: JSON.stringify(payload) });
          if (result.reviewRequired || result.accepted) {
            closeModal();
            await refresh(result.message || '资料已提交，系统将继续处理。');
            return;
          }
          const enrichmentState = result.enrichment?.state === 'pending_dispatch'
            ? '资料补全已排队'
            : result.enrichment?.reasonCode
              ? `资料补全未启动：${result.enrichment.reasonCode}`
              : '资料补全状态已记录';
          const assignmentState = payload.ownerId === '__unassigned__' ? '客户已创建，暂未分配' : '客户已创建并分配';
          await refresh(`${assignmentState} · ${result.externalCustomerId} · ${enrichmentState}`);
          openCustomerProfile(result.externalCustomerId);
        } catch (error) {
          if (error.code === 'CUSTOMER_DUPLICATE' && error.details?.canOpenExistingCustomer
              && error.details?.existingCustomerId) {
            closeModal();
            toast(error.message);
            openCustomerProfile(error.details.existingCustomerId);
            return;
          }
          throw error;
        }
      } else if (form.id === 'quoteForm') {
        const payload = formPayload(form);
        const fromTodayTask = payload.todayTaskSource === 'alerts';
        delete payload.todayTaskSource;
        payload.nextFollowAt = apiTime(payload.nextFollowAt);
        await api('/api/sales-crm/quotes', { method: 'POST', body: JSON.stringify(payload) });
        if (fromTodayTask) await refreshTodayTasksAfterAction('报价已记录，客户进入已报价阶段');
        else await refresh('报价已记录，客户进入已报价阶段');
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
        payload.permissions = personalPermissionsFromPayload(
          payload,
          groupPermissionValues(payload.permissionGroupId, state.data.rolePermissions?.[payload.role] || {}),
        );
        const result = await api('/api/sales-crm/users', { method: 'POST', body: JSON.stringify(payload) });
        await refresh(result.temporaryPassword ? `新用户已创建，临时密码：${result.temporaryPassword}` : '新用户已创建');
      } else if (form.id === 'editUserForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        const user = state.data.users.find(item => item.id === userId);
        if (user && payload.permissionGroupId !== user.permissionGroupId
          && !window.confirm('更换后将清除该用户原有的个人权限调整，并采用新权限组设置。')) {
          return;
        }
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
        const existingGroup = groupId
          ? (state.data.permissionGroups || []).find(group => group.id === groupId)
          : null;
        const body = {
          name: String(payload.name || '').trim(),
          description: String(payload.description || ''),
          permissions: permissionGroupPermissions(form, payload, existingGroup),
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
        const user = state.data.users.find(item => item.id === userId);
        const permissions = personalPermissionsFromPayload(payload, user?.permissions || {});
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/permission-overrides`, {
          method: 'PUT',
          body: JSON.stringify({ permissions }),
        });
        await refresh('个人权限已更新');
      } else if (form.id === 'duplicateNeedsInfoForm') {
        const payload = formPayload(form);
        await resolveDuplicateReviewAction(
          String(payload.reviewId || '').trim(),
          'needs_info',
          '',
          String(payload.note || '').trim(),
        );
        closeModal();
      } else if (form.id === 'filterDefinitionForm') {
        const payload = formPayload(form);
        const filterKey = payload.filterKey;
        const typeOperators = {
          text: ['contains'],
          multi: ['in'],
          date_range: ['between'],
          tag_multi: ['in'],
        };
        const requestedOperators = splitTags(payload.operators);
        const operators = requestedOperators.length
          ? requestedOperators
          : typeOperators[payload.type] || [];
        await api(`/filter-permissions/definitions/${encodeURIComponent(filterKey)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: state.filterPermissionAdmin?.version,
            patch: {
              label: payload.label,
              type: payload.type,
              displayMode: payload.displayMode,
              sortOrder: Number(payload.sortOrder),
              operators,
              sensitive: Boolean(payload.sensitive),
            },
          }),
        });
        closeModal();
        await loadFilterPermissionAdmin({ force: true });
        invalidateAuthorizedFilterMounts();
        toast('筛选定义已保存');
      } else if (form.id === 'filterDefinitionCreateForm') {
        const payload = formPayload(form);
        const submitButton = $('#createFilterDefinitionSubmit');
        const formStatus = $('#filterDefinitionCreateStatus');
        const originalLabel = submitButton?.textContent || '新增定义';
        if (submitButton?.disabled) return;
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = '正在创建…';
        }
        if (formStatus) formStatus.textContent = '';
        try {
          await api('/filter-permissions', {
            method: 'POST',
            body: JSON.stringify({
              expectedVersion: state.filterPermissionAdmin?.version,
              note: String(payload.note || '').trim(),
              sourceKey: payload.sourceKey,
              label: String(payload.label || '').trim(),
              displayMode: payload.displayMode,
              sortOrder: Number(payload.sortOrder),
              enabled: Boolean(payload.enabled),
              sensitive: Boolean(payload.sensitive),
            }),
          });
          await loadFilterPermissionAdmin({ force: true });
          invalidateAuthorizedFilterMounts();
          closeModal();
          toast('筛选定义已新增，授权后销售方可使用');
        } catch (error) {
          if (error.code === 'FILTER_VERSION_CONFLICT') {
            try { await loadFilterPermissionAdmin({ force: true }); }
            catch (_refreshError) {}
          }
          if (formStatus) formStatus.textContent = `创建失败：${error.message}`;
          throw error;
        } finally {
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
          }
        }
      } else if (form.id === 'adminPasswordResetForm') {
        const payload = formPayload(form);
        const userId = payload.userId;
        if (payload.password !== payload.passwordConfirm) throw new Error('两次输入的新密码不一致');
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/password-reset`, {
          method: 'POST', body: JSON.stringify({ password: payload.password, passwordConfirm: payload.passwordConfirm }),
        });
        form.reset();
        await refresh('密码已重置，该账号的现有登录态已失效');
      } else if (form.id === 'customerProfileEditForm') {
        const payload = formPayload(form);
        const customerId = payload.customerId;
        delete payload.customerId;
        const account = state.data.accounts.find(item => item.id === customerId);
        if (payload.ownerId === '__unassigned__' && account?.owner_id) {
          if (!window.confirm('负责人将被清空，客户会进入CRM未分配范围，全部历史记录继续保留。确认继续？')) return;
          payload.unassignReason = String(window.prompt('请填写暂不分配原因（必填）', '') || '').trim();
          if (payload.unassignReason.length < 2) throw new Error('转入CRM未分配范围必须填写至少2个字符的原因');
          payload.unassignConfirmed = true;
        }
        const result = await api(`/api/sales-crm/accounts/${encodeURIComponent(customerId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (payload.nickname !== undefined && account?.external_customer_id) {
          synchronizeSharedNickname(
            account.external_customer_id,
            String(result?.nickname ?? (payload.nickname || '')).trim(),
          );
        }
        await refresh('客户资料已更新');
        refreshDrawerNextActionTime();
        reloadCustomerProfileFrame();
      } else if (form.id === 'customerMasterForm') {
        const payload = formPayload(form);
        const result = await api(`/api/sales-crm/master/${encodeURIComponent(state.customerProfileExternalId)}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        state.customerProfileMaster = { ...state.customerProfileMaster, ...payload, updatedAt: result.updatedAt };
        Object.assign(state.customerProfileLead, {
          company_name: payload.companyName,
          customer_type: payload.customerType,
          industry: payload.industry,
        });
        closeModal();
        renderCustomerProfileHeader();
        reloadCustomerProfileFrame();
        toast(result.changed ? '客户主档已更新' : '客户主档没有变化');
      } else if (form.id === 'nicknameForm') {
        const payload = formPayload(form);
        const target = {
          source: payload.nicknameSource,
          crmCustomerId: payload.crmCustomerId,
          intakeItemId: payload.intakeItemId,
          externalCustomerId: payload.externalCustomerId,
        };
        const result = await api(`/api/sales-crm/customers/${encodeURIComponent(payload.externalCustomerId)}/nickname`, {
          method: 'PATCH', body: JSON.stringify({ nickname: payload.nickname }),
        });
        const nickname = result?.customer?.nickname ?? result?.nickname ?? payload.nickname;
        synchronizeSharedNickname(payload.externalCustomerId, nickname);
        closeModal();
        renderAfterSharedNicknameUpdate(target);
        toast(nickname ? '客户昵称已保存并同步' : '客户昵称已清除并同步');
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
        await refresh('线索同步设置已更新');
      } else if (form.id === 'intakeManualAssignForm') {
        if (state.intakeAssignmentSubmitting) return;
        const assignment = state.intakeAssignmentPreview;
        if (!assignment) throw new Error('分配预览已失效，请重新操作');
        const payload = formPayload(form);
        const button = form.querySelector('button[type="submit"]');
        state.intakeAssignmentSubmitting = true;
        if (button) { button.disabled = true; button.textContent = '正在分配…'; }
        try {
          const result = await api('/api/sales-crm/intake/action', {
            method: 'POST',
            body: JSON.stringify({
              action: 'manual_assign',
              itemIds: assignment.scope.itemIds,
              filterScope: assignment.scope.filterScope,
              allFiltered: assignment.scope.scopeType === 'all_filtered',
              ownerId: payload.ownerId,
              amount: Number(payload.amount),
              idempotencyKey: assignment.idempotencyKey,
              previewToken: assignment.preview.previewToken || '',
            }),
          });
          state.selectedIntakeIds.clear();
          state.intakeSelectAllScope = null;
          state.intakeAssignmentPreview = null;
          closeModal();
          const overview = await api('/api/sales-crm/intake?page=1&pageSize=20');
          state.data.intake = {
            ...state.data.intake,
            settings: overview.settings,
            stats: overview.stats,
            batches: overview.batches,
          };
          await loadAuthorizedBusinessPage('intake', { reset: true });
          const blockedReasons = Object.entries(result.blockedReasons || {})
            .map(([reason, count]) => `${reason} ${count} 条`).join('；');
          toast(`已分配 ${result.assigned} 条${result.blocked ? `，阻断 ${result.blocked} 条${blockedReasons ? `（${blockedReasons}）` : ''}` : ''}`);
        } catch (error) {
          if (['ASSIGNMENT_PREVIEW_EXPIRED', 'ASSIGNMENT_PREVIEW_REQUIRED'].includes(error.code)) {
            state.intakeAssignmentPreview = null;
            closeModal();
          }
          throw error;
        } finally {
          state.intakeAssignmentSubmitting = false;
          if (button) button.textContent = '确认分配';
          renderIntakeAssignmentBar();
          syncManualAssignmentAmount();
        }
      } else if (form.id === 'intakeAssignForm') {
        const payload = formPayload(form);
        payload.action = 'assign';
        await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify(payload) });
        await refreshIntakeWorkflow('客户已分配并生成领取任务');
      } else if (form.id === 'intakeReasonForm') {
        const payload = formPayload(form);
        await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify(payload) });
        await refreshIntakeWorkflow(payload.action === 'reject'
          ? '已移入不对口记录'
          : '客户已退回管理者队列');
        if (payload.action === 'reject') await loadRecycleBin();
      } else if (form.id === 'bulkCustomerAssignForm') {
        const payload = formPayload(form);
        if (!payload.ownerId) throw new Error('请选择有效的销售负责人');
        const result = await api('/api/sales-crm/accounts/bulk-assign', {
          method: 'POST',
          body: JSON.stringify({ ...customerSelectionPayload(), ownerId: payload.ownerId }),
        });
        resetCustomerSelection();
        closeModal();
        await refresh(`已批量分配 ${result.updated} 个客户`);
      } else if (form.id === 'recycleReasonForm') {
        const payload = formPayload(form);
        const action = payload.action;
        if (action === 'reject') {
          await rejectCustomerAsMismatch(payload.customerId, payload.reason);
          return;
        }
        const route = action === 'trash'
          ? `/api/sales-crm/accounts/${encodeURIComponent(payload.customerId)}/trash`
          : action === 'bulk'
            ? '/api/sales-crm/accounts/bulk-return'
            : `/api/sales-crm/accounts/${encodeURIComponent(payload.customerId)}/return`;
        const body = action === 'bulk'
          ? { ...customerSelectionPayload(), reason: payload.reason }
          : { reason: payload.reason };
        await api(route, { method: 'POST', body: JSON.stringify(body) });
        resetCustomerSelection();
        await refresh(action === 'trash' ? '客户已移入回收站' : '客户已退回线索池');
        if (action === 'bulk') switchView('pool');
      } else if (form.id === 'evaluationForm') {
        const button = form.querySelector('button[type="submit"], button:not([type])');
        if (button) {
          button.disabled = true;
          button.textContent = customerAIEnabled() ? 'AI分析中…' : '保存中…';
        }
        try {
          const result = await api('/api/sales-crm/evaluations', {
            method: 'POST',
            body: JSON.stringify(formPayload(form)),
          });
          await refresh(customerAIEnabled()
            ? (result.aiWarning ? '客户经营复盘已保存；AI标注暂时失败，可稍后重试' : '客户经营复盘和AI标注已生成')
            : '客户经营复盘已保存');
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = customerAIEnabled() ? '保存并生成AI标注' : '保存评价';
          }
        }
      } else if (form.id === 'drawerAiForm') {
        if (!customerAIEnabled()) return;
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
        if (form.matches('[data-today-task-form]')) {
          const status = form.querySelector('[data-today-task-error]');
          if (status) status.textContent = error.message;
        }
        if (form.id === 'managerTaskResolveForm') {
          const status = $('#managerResolveStatus');
          if (status) status.textContent = `${error.message}；当前输入已保留`;
        }
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
    const paginationButton = event.target.closest('[data-pagination-action]');
    if (paginationButton && !paginationButton.disabled) {
      const root = paginationButton.closest('[data-pagination]');
      const handler = paginationRegistry.get(root?.dataset.pagination || '');
      const current = Number(root?.dataset.page || 1);
      const totalPages = Number(root?.dataset.totalPages || 1);
      const action = paginationButton.dataset.paginationAction;
      const page = action === 'first' ? 1
        : action === 'prev' ? Math.max(1, current - 1)
          : action === 'next' ? Math.min(totalPages, current + 1)
            : action === 'last' ? totalPages
              : Math.max(1, Math.min(totalPages, Number(paginationButton.dataset.page || current)));
      if (handler && page !== current) handler({ page });
      return;
    }
    const nav = event.target.closest('[data-view]');
    if (nav) switchView(nav.dataset.view);
    const go = event.target.closest('[data-go]');
    if (go) switchView(go.dataset.go);
    const teamSection = event.target.closest('[data-team-section]');
    if (teamSection) {
      state.teamStatus.section = teamSection.dataset.teamSection;
      if (state.teamStatus.section === 'collaboration') {
        state.teamStatus.collaborationPage = 1;
        void loadTeamCollaboration({ reset: true, page: 1 });
      }
      renderTeamSection();
    }
    const progressDrilldown = event.target.closest('[data-team-progress-drilldown]');
    if (progressDrilldown) {
      state.teamStatus.drilldown = progressDrilldown.dataset.teamProgressDrilldown;
      state.teamStatus.progressPage = 1;
      void loadTeamStatus({ reset: false, page: 1 });
    }
    if (event.target.closest('#teamRefresh')) await loadTeamStatus({ reset: true });
    if (event.target.closest('#teamExport')) downloadTeamStatus();
    if (event.target.closest('#teamCollaborationAdd')) openCollaborationSupport();
    for (const [attribute, action] of [
      ['data-collaboration-supplement', 'supplement'],
      ['data-collaboration-correct', 'correction'],
      ['data-collaboration-revoke', 'revocation'],
    ]) {
      const button = event.target.closest(`[${attribute}]`);
      if (!button) continue;
      const item = state.teamStatus.collaborationRows.find(row =>
        row.eventId === button.getAttribute(attribute));
      if (item) openCollaborationSupport(item, action);
    }
    const accessSection = event.target.closest('[data-access-section]');
    if (accessSection) switchAccessSection(accessSection.dataset.accessSection);
    const planMode = event.target.closest('#planModeTabs [data-plan-mode]');
    if (planMode) setNextPlanMode(planMode.dataset.planMode);
    const managerMetric = event.target.closest('[data-manager-metric-owner]');
    if (managerMetric) await drillDownManagerMetric(managerMetric.dataset.managerMetricOwner);
    const managerTask = event.target.closest('[data-manager-task-id]');
    if (managerTask) await openManagerTaskDetail(managerTask.dataset.managerTaskId);
    if (event.target.closest('#managerTaskRefresh')) {
      state.managerTaskPage = 1;
      await loadAuthorizedBusinessPage('manager_tasks', { reset: true });
    }
    if (event.target.closest('#managerMetricRefresh')) {
      await Promise.all([
        loadAuthorizedBusinessPage('manager_metrics', { reset: true }),
        loadAuthorizedBusinessPage('manager_risks', { reset: true }),
      ]);
    }
    const managerRange = event.target.closest('[data-manager-range]');
    if (managerRange) {
      state.managerMetricRange = Number(managerRange.dataset.managerRange) === 90 ? 90 : 30;
      state.authorizedBusinessLists.manager_metrics.page = 1;
      state.authorizedBusinessLists.manager_risks.page = 1;
      const metricController = state.authorizedBusinessLists.manager_metrics.filterController;
      if (metricController) {
        metricController.setDraft('metric_window', [String(state.managerMetricRange)]);
        metricController.apply();
      }
      void Promise.all([
        loadAuthorizedBusinessPage('manager_metrics', { reset: true }),
        loadAuthorizedBusinessPage('manager_risks', { reset: true }),
      ]);
    }
    if (event.target.closest('#managerTaskExport')) {
      if (!can('export_data')) toast('当前账号没有导出权限');
      else {
        const payload = state.authorizedBusinessLists.manager_tasks.filterController?.serialize('applied')
          || { filters: [], permissionVersion: '' };
        const params = new URLSearchParams({
          permissionVersion: String(payload.permissionVersion || ''),
          filters: JSON.stringify(componentPayloadToRaw(payload)),
        });
        const link = document.createElement('a');
        link.href = `/api/sales-crm/manager-tasks/export?${params}`;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    }
    if (event.target.closest('[data-filter-permission-entry]')) {
      await runFilterPermissionAction(async () => {
        switchAccessSection('permissions');
        await loadFilterPermissionAdmin({ force: true });
        $('#filterPermissionAdmin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    if (event.target.closest('#filterPermissionSave')) {
      await runFilterPermissionAction(() => saveFilterPermissions());
    }
    if (event.target.closest('#filterPermissionRestore')) {
      await runFilterPermissionAction(() => saveFilterPermissions({ restore: true }));
    }
    const definitionToggle = event.target.closest('[data-toggle-filter-definition]');
    if (definitionToggle) {
      await runFilterPermissionAction(() => toggleFilterDefinition(definitionToggle));
    }
    const definitionEditor = event.target.closest('[data-edit-filter-definition]');
    if (definitionEditor) openFilterDefinitionEditor(definitionEditor.dataset.editFilterDefinition);
    if (event.target.closest('#newFilterDefinitionBtn')) openFilterDefinitionCreator();
    const todayTaskAction = event.target.closest('[data-today-task-action]');
    if (todayTaskAction) {
      await openTodayTaskAction(todayTaskById(todayTaskAction.dataset.todayTaskId));
    }
    const mismatchRecord = event.target.closest('[data-open-mismatch-record]');
    if (mismatchRecord) openMismatchRecord(mismatchRecord.dataset.openMismatchRecord);
    const recycleCustomer = event.target.closest('[data-open-recycle-customer]');
    if (recycleCustomer
      && (!event.target.closest('button,a,input,select,textarea')
        || recycleCustomer.matches('button[data-open-recycle-customer]'))) {
      openRecycleCustomer(recycleCustomer.dataset.openRecycleCustomer);
    }
    const customer = event.target.closest('[data-open-customer],[data-customer]');
    if (customer && (!event.target.closest('button,a,input,select,textarea') || customer.matches('button[data-open-customer]'))) openCustomer(customer.dataset.openCustomer || customer.dataset.customer);
    const intakeProfile = event.target.closest('[data-intake-profile]');
    if (intakeProfile && (!event.target.closest('button,a,input,select,textarea') || intakeProfile.matches('button[data-intake-profile]'))) openIntakeProfile(intakeProfile.dataset.intakeProfile);
    const intakeMaster = event.target.closest('[data-open-intake-master]');
    if (intakeMaster) openIntakeMasterProfile(intakeMaster.dataset.openIntakeMaster);
    const master = event.target.closest('[data-open-master]');
    if (master && (!event.target.closest('button,a,input,select,textarea') || master.matches('button[data-open-master]'))) {
      openCustomerProfile(master.dataset.openMaster);
    }
    const stageJump = event.target.closest('[data-stage-jump]');
    if (stageJump) {
      switchView('customers');
      state.stageReached = '';
      state.customerFilterController?.setDraft('stage', [stageJump.dataset.stageJump]);
      state.customerFilterController?.apply();
    }
    const quickView = event.target.closest('[data-customer-quick]');
    if (quickView) {
      state.customerFilters.quickView = quickView.dataset.customerQuick || 'all';
      saveCustomerFilters();
      syncCustomerFilterControls();
      renderCustomers();
    }
    if (event.target.closest('#customerSearchClear')) {
      $('#customerSearch').value = '';
      state.customerFilters.search = '';
      saveCustomerFilters();
      syncCustomerFilterControls();
      renderCustomers();
    }
    if (event.target.closest('#customerFilterToggle')) {
      if ($('#customerFilterPanel').classList.contains('hidden')) openCustomerFilterPanel();
      else closeCustomerFilterPanel();
    }
    if (event.target.closest('[data-close-customer-filters]')) closeCustomerFilterPanel();
    if (event.target.closest('#customerFilterApply')) applyCustomerFilters({ close: true });
    if (event.target.closest('#customerFilterReset') || event.target.closest('[data-clear-customer-filters]')) {
      state.customerFilters = defaultCustomerFilters();
      state.stageReached = '';
      saveCustomerFilters();
      syncCustomerFilterControls();
      renderCustomers();
    }
    const removeFilter = event.target.closest('[data-remove-customer-filter]');
    if (removeFilter) {
      const key = removeFilter.dataset.removeCustomerFilter;
      const value = removeFilter.dataset.filterValue;
      if (Array.isArray(state.customerFilters[key])) {
        state.customerFilters[key] = state.customerFilters[key].filter(item => item !== value);
      } else {
        state.customerFilters[key] = key === 'quickView' ? 'all' : '';
      }
      saveCustomerFilters();
      syncCustomerFilterControls();
      renderCustomers();
    }
    const correctActivity = event.target.closest('[data-correct-activity]');
    if (correctActivity && !correctActivity.disabled) {
      openActivityCorrectionModal(correctActivity.dataset.correctActivity, correctActivity);
    }
    const correctionTarget = event.target.closest('[data-correction-target]');
    if (correctionTarget) {
      const nextTargetId = String(correctionTarget.dataset.correctionTarget || '');
      if (nextTargetId !== state.activityCorrection.targetCustomerId) rotateActivityCorrectionIdempotencyKey();
      state.activityCorrection.targetCustomerId = nextTargetId;
      renderActivityCorrectionTargetRows();
    }
    const correctionBack = event.target.closest('[data-correction-back]');
    if (correctionBack) {
      state.activityCorrection.step = Number(correctionBack.dataset.correctionBack) || 1;
      renderActivityCorrectionModal();
    }
    if (event.target.closest('[data-close-activity-correction]')) closeActivityCorrectionModal();
    if (event.target.closest('#activityCorrectionProposalMore') && state.activityCorrection.proposalHasMore) {
      await loadActivityCorrectionProposals();
    }
    if (event.target.closest('#activityCorrectionHistoryMore') && state.activityCorrection.historyHasMore) {
      await loadActivityCorrections();
    }
    const correctionReview = event.target.closest('[data-review-correction]');
    if (correctionReview) {
      const proposalRoot = correctionReview.closest('[data-correction-proposal]');
      await reviewActivityCorrectionProposal(
        proposalRoot?.dataset.correctionProposal || '',
        correctionReview.dataset.reviewCorrection,
        correctionReview,
      );
    }
    if (event.target.closest('#activityCorrectionWorkspaceRefresh')) {
      await Promise.all([
        loadActivityCorrections({ reset: true }),
        loadActivityCorrectionProposals({ reset: true }),
      ]);
    }
    if (event.target.closest('[data-close-drawer]')) closeDrawer();
    if (event.target.closest('[data-close-modal]')) {
      if (state.activityDraftBeforeReactionAdmin && $('.activity-reaction-admin')) void restoreActivityDraft();
      else if ($('#modal .modal')?.classList.contains('activity-correction-modal')) closeActivityCorrectionModal();
      else closeModal();
    }
    if (event.target.closest('#restoreUserPermissions')) {
      const form = document.querySelector('#permissionOverrideForm');
      const userId = form?.elements?.userId?.value || '';
      if (!userId) return;
      const user = state.data.users.find(item => item.id === userId);
      if (!user) return;
      openModal('恢复权限组默认？', 'PERMISSION RESTORE', `<form id="restorePermissionsForm" class="form-grid">
        <input type="hidden" name="userId" value="${esc(user.id)}">
        <p class="recommendation">将清除${esc(user.name)}的个人权限例外，之后自动跟随“${esc(user.permissionGroupName || '当前权限组')}”权限组。权限组本身不会改变。</p>
        <div class="form-actions"><button type="button" class="button secondary" data-close-modal>取消</button><button type="button" class="button primary" id="confirmRestorePermissions">确认恢复</button></div>
      </form>`);
      return;
    }
    if (event.target.closest('#confirmRestorePermissions')) {
      const form = document.querySelector('#restorePermissionsForm');
      const userId = form?.elements?.userId?.value || '';
      if (!userId) return;
      try {
        await api(`/api/sales-crm/users/${encodeURIComponent(userId)}/permission-overrides`, {
          method: 'PUT',
          body: JSON.stringify({ restoreDefault: true }),
        });
        closeModal();
        await refresh('已恢复权限组默认');
      } catch (error) { toast(error.message); }
      return;
    }
    if (event.target.closest('#restorePermissionGroupDefaults')) {
      showPermissionGroupResetConfirmation(document.querySelector('#permissionGroupForm'));
      return;
    }
    if (event.target.closest('#cancelPermissionGroupDefaults')) {
      cancelPermissionGroupReset(document.querySelector('#permissionGroupForm'));
      return;
    }
    if (event.target.closest('#confirmPermissionGroupDefaults')) {
      const form = document.querySelector('#permissionGroupForm');
      const groupId = form?.elements?.groupId?.value || '';
      const group = groupId
        ? (state.data.permissionGroups || []).find(item => item.id === groupId)
        : null;
      confirmPermissionGroupReset(form, group);
      return;
    }
    const permissionCategoryButton = event.target.closest('[data-permission-category]');
    if (permissionCategoryButton) {
      selectPermissionCategoryTab(permissionCategoryButton);
      return;
    }
    const permissionPackButton = event.target.closest('[data-permission-pack]');
    if (permissionPackButton && !permissionPackButton.disabled) {
      const pack = PERMISSION_PACKS.find(item => item.key === permissionPackButton.dataset.permissionPack);
      if (pack) applyPermissionPack(permissionPackButton.closest('#permissionGroupForm'), pack.role);
      return;
    }
    if (event.target.closest('[data-return-activity-draft]')) void restoreActivityDraft();
    if (event.target.closest('#customerProfileBack')) returnFromCustomerProfile();
    if (event.target.closest('#customerProfileActivity')) {
      if (state.customerProfileReadOnly) toast('当前为只读主档，领取并进入 CRM 后才能记录跟进');
      else if (state.selectedCustomerId) void openActivityModal(state.selectedCustomerId);
      else {
        const matchedAccount = (state.data.accounts || []).find(item =>
          item.external_customer_id === state.customerProfileExternalId);
        if (matchedAccount) void openActivityModal(matchedAccount.id);
        else toast('该线索尚未进入 CRM，请先在线索池领取后再记录跟进');
      }
    }
    const activitySubmitButton = event.target.closest('#activitySubmit');
    if (activitySubmitButton && !activitySubmitButton.disabled) {
      const activityForm = activitySubmitButton.closest('#activityForm');
      if (activityForm && !activityForm.checkValidity()) {
        activityForm.reportValidity();
        const firstInvalid = activityForm.querySelector(':invalid');
        if (firstInvalid && firstInvalid.closest('.hidden')) {
          toast('存在未完成的必填项或无效时间，请检查表单');
        }
      }
    }
    if (event.target.closest('#customerProfileDataEdit')) {
      if (state.customerProfileReadOnly) toast('当前为只读主档，领取并进入 CRM 后才能编辑资料');
      else if (state.selectedCustomerId) openCustomerProfileEditModal(state.selectedCustomerId);
      else openCustomerMasterEditModal();
    }
    const notificationRead = event.target.closest('[data-notification-read]');
    if (notificationRead) {
      try { await markNotificationRead(notificationRead.dataset.notificationRead); }
      catch (error) { toast(error.message); }
    }
    const notificationCustomer = event.target.closest('[data-notification-customer]');
    if (notificationCustomer) {
      try {
        await markNotificationRead(notificationCustomer.dataset.notificationCustomer, {
          customerId: notificationCustomer.dataset.customerId,
        });
      } catch (error) { toast(error.message); }
    }
    const notificationView = event.target.closest('[data-notification-view]');
    if (notificationView) {
      try {
        await markNotificationRead(notificationView.dataset.notificationView, {
          view: notificationView.dataset.targetView,
        });
      } catch (error) { toast(error.message); }
    }
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
    const aiFeedback = event.target.closest('[data-ai-feedback]');
    if (aiFeedback) {
      try { await recordAiFeedback(aiFeedback.dataset.aiFeedback); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#aiGovernanceRefresh')) void loadAiGovernance();
    if (event.target.closest('#aiStrategyCreate')) openStrategyModal();
    const strategyEvaluate = event.target.closest('[data-strategy-evaluate]');
    if (strategyEvaluate) openShadowEvaluationModal(strategyEvaluate.dataset.strategyEvaluate);
    const strategyActionButton = event.target.closest('[data-strategy-action]');
    if (strategyActionButton) {
      try {
        await strategyAction(
          strategyActionButton.dataset.strategyAction,
          strategyActionButton.dataset.strategyId,
        );
      } catch (error) { toast(error.message); }
    }
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
    const activityCustomerResult = event.target.closest('[data-activity-customer-result]');
    if (activityCustomerResult) {
      const customer = state.activityCustomerResults[Number(activityCustomerResult.dataset.activityCustomerResult)];
      if (customer) selectActivityCustomer(customer);
    }
    if (event.target.closest('[data-change-activity-customer]')) {
      state.activitySelectedCustomer = null;
      state.activityCustomerResults = [];
      state.activityCustomerActiveIndex = -1;
      renderActivityCustomerPicker({ focusSearch: true });
    }
    if (event.target.closest('[data-activity-main-step]')) showActivityRfqStep(false);
    if (event.target.closest('#activityReactionSettings')) void openActivityReactionAdmin();
    const reactionSave = event.target.closest('[data-reaction-save]');
    if (reactionSave) {
      try { await saveActivityReaction(reactionSave.dataset.reactionSave); }
      catch (error) { toast(error.message); }
    }
    const reactionRemove = event.target.closest('[data-reaction-remove]');
    if (reactionRemove) {
      try { await removeActivityReaction(reactionRemove.dataset.reactionRemove); }
      catch (error) { toast(error.message); }
    }
    const reactionMove = event.target.closest('[data-reaction-move]');
    if (reactionMove) {
      try { await moveActivityReaction(reactionMove.dataset.reactionMove, reactionMove.dataset.direction); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#quickUpdateBtn')) void openActivityModal();
    if (event.target.closest('#newCustomerBtn')) openNewCustomerModal();
    if (event.target.closest('#drawerUpdateBtn')) void openActivityModal(state.selectedCustomerId);
    if (event.target.closest('#drawerNicknameBtn')) openNicknameModal(state.drawerNicknameTarget);
    if (event.target.closest('[data-add-quote]')) openQuoteModal(state.selectedCustomerId);
    if (event.target.closest('[data-add-order]')) openOrderModal(state.selectedCustomerId);
    if (event.target.closest('[data-edit-customer-profile]')) openCustomerProfileEditModal(state.selectedCustomerId);
    const evaluateCompanyId = event.target.closest('[data-evaluate-company-id]');
    if (evaluateCompanyId) {
      state.selectedCustomerId = evaluateCompanyId.dataset.evaluateCompanyId;
      openEvaluationModal('company');
    }
    if (event.target.closest('[data-evaluate-company]')) openEvaluationModal('company');
    if (event.target.closest('[data-customer-history]')) {
      const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
      if (!account) return;
      await openCustomerHistoryModal(account);
      return;
    }
    if (event.target.closest('[data-open-timeline-modal]')) {
      let events = [];
      if (state.recycleCustomerDetail) {
        const detail = state.recycleCustomerDetail;
        events = detail.timeline?.length
          ? detail.timeline
          : (detail.activities || []).map(item => ({
            id: item.id,
            kind: 'activity',
            event_type: item.activity_type,
            title: activityMeta[item.activity_type]?.[0] || item.activity_type || '客户活动',
            summary: item.summary || item.outcome || '',
            next_action: item.next_action || '',
            actor_name: item.user_name || item.userName || '',
            occurred_at: item.occurred_at || item.occurredAt,
          }));
      } else {
        const account = state.data.accounts.find(item => item.id === state.selectedCustomerId);
        if (account) events = (state.data.timeline || []).filter(item => item.customer_id === account.id);
      }
      openTimelineModal(events);
      return;
    }
    if (event.target.closest('[data-timeline-modal-index]')) {
      const index = Number(event.target.closest('[data-timeline-modal-index]').dataset.timelineModalIndex);
      const modalEvent = state.timelineModalEvents[index];
      if (modalEvent) {
        $$('.timeline-modal-item').forEach((item, itemIndex) => item.classList.toggle('is-active', itemIndex === index));
        const detail = $('#timelineModalDetail');
        if (detail) detail.innerHTML = renderTimelineEventDetail(modalEvent);
      }
      return;
    }
    const retryEvaluation = event.target.closest('[data-retry-evaluation]');
    if (retryEvaluation && customerAIEnabled()) {
      try {
        toast('正在重新生成AI标注…');
        const result = await api(`/api/sales-crm/evaluations/${encodeURIComponent(retryEvaluation.dataset.retryEvaluation)}/retry`, { method: 'POST', body: '{}' });
        await refresh(result.aiWarning ? 'AI标注仍未成功，请稍后再试' : 'AI标注已重新生成');
      } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#newUserBtn')) openUserModal();
    const protectionView = event.target.closest('[data-protection-view]');
    if (protectionView) activateProtectionView(protectionView.dataset.protectionView);
    if (event.target.closest('#protectedTemplateBtn')) {
      try { await downloadProtectedCsv('/protected-customers/template', 'protected-customer-template.csv'); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#protectedExportBtn')) {
      try {
        const params = new URLSearchParams({
          status: state.protectedCustomers.status,
          query: state.protectedCustomers.query,
        });
        await downloadProtectedCsv(`/protected-customers/export?${params}`, 'protected-customer-mapping.csv');
      } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#protectedCsvBtn')) $('#protectedCsvInput')?.click();
    if (event.target.closest('#protectedAddRowBtn')) {
      addProtectedImportRow();
      saveProtectedImportDraft();
    }
    const removeProtectedRow = event.target.closest('[data-remove-protected-row]');
    if (removeProtectedRow) {
      removeProtectedRow.closest('[data-protected-import-row]')?.remove();
      if (!$('#protectedImportRows').children.length && protectedWritesAvailable()) addProtectedImportRow();
      saveProtectedImportDraft();
    }
    if (event.target.closest('#protectedPreviewBtn')) {
      try { await previewProtectedBatch(); } catch (error) { toast(error.message); }
    }
    const commitProtected = event.target.closest('[data-protected-commit]');
    if (commitProtected && window.confirm('只会提交预览中服务端标记为可执行的行。确认继续？')) {
      try { await commitProtectedBatch(commitProtected.dataset.protectedCommit); }
      catch (error) { toast(error.message); }
    }
    const rollbackProtected = event.target.closest('[data-protected-rollback]');
    if (rollbackProtected) openProtectedRollbackModal(rollbackProtected.dataset.protectedRollback);
    const protectedProfile = event.target.closest('[data-protected-profile]');
    if (protectedProfile) {
      try { await openProtectedProfileModal(protectedProfile.dataset.protectedProfile); }
      catch (error) { toast(error.message); }
    }
    const protectedActivate = event.target.closest('[data-protected-activate]');
    if (protectedActivate) openProtectedActivationModal(protectedActivate.dataset.protectedActivate);
    if (event.target.closest('#protectedRefreshBtn')) await loadProtectedCustomers();
    if (event.target.closest('#protectedRescanBtn')) await loadProtectedConflicts({ rescan: true });
    const pendingType = event.target.closest('[data-pending-type]');
    if (pendingType) {
      state.pendingCenter.deepLinkUnavailable = false;
      activatePendingTab(pendingType.dataset.pendingType);
    }
    const pendingRecord = event.target.closest('[data-pending-record-key]');
    if (pendingRecord) {
      selectPendingRecord(pendingRecord.dataset.pendingRecordKey, { openMobile: true });
    }
    if (event.target.closest('[data-pending-detail-close]')) {
      state.pendingCenter.mobileDetailOpen = false;
      renderPendingQueue();
    }
    const pendingMove = event.target.closest('[data-pending-move]');
    if (pendingMove) movePendingSelection(Number(pendingMove.dataset.pendingMove));
    const conflictToggle = event.target.closest('[data-toggle-protected-conflict]');
    if (conflictToggle) {
      const conflictId = conflictToggle.dataset.toggleProtectedConflict;
      selectPendingRecord(`conflict:${conflictId}`, { openMobile: true });
    }
    const conflictSave = event.target.closest('[data-save-protected-conflict]');
    if (conflictSave && protectedWritesAvailable()) {
      const conflictId = conflictSave.dataset.saveProtectedConflict;
      const item = state.protectedCustomers.conflicts.find(row => row.conflictId === conflictId);
      if (!item) return;
      const radio = document.querySelector(`input[name="conflict-decision-${CSS.escape(conflictId)}"]:checked`);
      if (!radio) { toast('请先选择处理方式'); return; }
      const decision = radio.value;
      const rawReason = document.querySelector(`#conflictReasonField-${CSS.escape(conflictId)} textarea`)?.value || '';
      if (decision === 'supplement_and_retry' && !String(rawReason).trim()) {
        document.querySelector(`#conflictReasonField-${CSS.escape(conflictId)}`)?.classList.remove('hidden');
        toast('资料不够时必须填写需要补充的内容');
        return;
      }
      const reason = String(rawReason).trim()
        || (decision === 'link_existing' ? '管理员确认为同一客户'
          : decision === 'confirm_new' ? '管理员确认不是同一客户' : '');
      const targetExternalCustomerId = protectedConflictTargetExternalCustomerId(item, decision);
      try {
        await resolveProtectedConflictAction(conflictId, {
          decision, targetExternalCustomerId,
          details: reason, expectedVersion: item.expectedVersion || '',
        });
      } catch (error) {
        toast(error.message);
      }
    }
    const supplementApply = event.target.closest('[data-supplement-apply]');
    if (supplementApply && protectedWritesAvailable()) {
      try { await supplementProtectedConflictAction(supplementApply.dataset.supplementApply, 'apply'); }
      catch (error) { toast(error.message); }
    }
    const supplementSkip = event.target.closest('[data-supplement-skip]');
    if (supplementSkip && protectedWritesAvailable()) {
      try { await supplementProtectedConflictAction(supplementSkip.dataset.supplementSkip, 'skip'); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#customerExportBtn')) {
      const link = document.createElement('a');
      const payload = state.customerFilterController?.serialize('applied') || { filters: [] };
      const params = new URLSearchParams({
        format: 'csv',
        sort: $('#customerSort')?.value || 'pending_priority',
        permissionVersion: payload.permissionVersion || '',
        filters: JSON.stringify(componentPayloadToRaw(payload)),
      });
      link.href = `/api/sales-crm/export?${params}`;
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    const intakeStat = event.target.closest('[data-intake-stat]');
    if (intakeStat) {
      const statKey = intakeStat.dataset.intakeStat;
      if (intakeStat.hasAttribute('data-intake-stat-crm')) {
        await jumpIntakeStatToCrm(statKey);
      } else {
        applyIntakeStatCard(statKey);
      }
      return;
    }
    if (event.target.closest('#intakeSelectAllResults')) {
      const total = Number(state.data?.intake?.total || 0);
      if (!total) return toast('当前筛选结果为空');
      if (!window.confirm(`将选择全部筛选结果 ${total} 条，而不只是当前页。确认继续？`)) return;
      const payload = state.authorizedBusinessLists.intake?.filterController?.serialize('applied') || { filters: [] };
      const filterScope = {
        permissionVersion: String(payload.permissionVersion || ''),
        filters: componentPayloadToRaw(payload),
      };
      try {
        const preview = await api('/api/sales-crm/intake/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'manual_assign_preview', filterScope, allFiltered: true }),
        });
        if (!preview.eligibleCount) return toast('全部筛选结果中没有可分配线索');
        state.intakeSelectAllScope = {
          total: Number(preview.eligibleCount || 0),
          matchedTotal: total,
          filterScope,
        };
        state.selectedIntakeIds.clear();
        renderIntake();
      } catch (error) {
        toast(error.message);
      }
      return;
    }
    if (event.target.closest('[data-select-all-filtered-customers]')) {
      const total = Number(state.customerList.total || 0);
      if (total > 500) return toast('全部筛选结果超过500条，请缩小筛选范围后再试');
      if (!total) return toast('当前筛选结果为空');
      if (!window.confirm(`将选择全部筛选结果 ${total} 条，而不只是当前页。确认继续？`)) return;
      const payload = state.customerFilterController?.serialize('applied') || { filters: [] };
      state.customerSelectionMode = 'filtered';
      state.customerSelectionFilterScope = {
        permissionVersion: String(payload.permissionVersion || ''),
        filters: componentPayloadToRaw(payload),
      };
      state.selectedCustomerIds.clear();
      renderCustomers();
    }
    if (event.target.closest('#bulkAssignCustomers')) {
      openBulkCustomerAssignmentModal();
    }
    const returnCustomer = event.target.closest('[data-return-customer]');
    if (returnCustomer) {
      const account = state.data.accounts.find(item => item.id === returnCustomer.dataset.returnCustomer);
      if (!canReturnCustomer(account)) return toast('仅当前仍在 CRM 且有退回权限的客户可退回');
      openRecycleReasonModal(returnCustomer.dataset.returnCustomer, 'return');
    }
    const rejectCustomer = event.target.closest('[data-reject-customer]');
    if (rejectCustomer) {
      openRecycleReasonModal(rejectCustomer.dataset.rejectCustomer, 'reject');
    }
    const trashCustomer = event.target.closest('[data-trash-customer]');
    if (trashCustomer) openRecycleReasonModal(trashCustomer.dataset.trashCustomer, 'trash');
    if (event.target.closest('#bulkReturnCustomers')) {
      if (!customerSelectionCount()) return toast('请先勾选客户');
      if (!selectedCustomersReturnEligible()) return toast('所选客户中包含已退回、已离开 CRM 或无权退回的客户');
      openRecycleReasonModal('', 'bulk');
    }
    if (event.target.closest('#recycleRefresh')) void loadRecycleBin();
    if (event.target.closest('[data-expand-mismatch-profile]')) {
      toggleMismatchRecordExpanded();
    }
    const restoreCustomer = event.target.closest('[data-restore-customer]');
    if (restoreCustomer) {
      try {
        await api(`/api/sales-crm/accounts/${encodeURIComponent(restoreCustomer.dataset.restoreCustomer)}/restore`, { method: 'POST', body: '{}' });
        closeDrawer();
        await refresh('手工客户已恢复');
        await loadRecycleBin();
      } catch (error) { toast(error.message); }
    }
    const restoreMismatch = event.target.closest('[data-restore-mismatch]');
    if (restoreMismatch) {
      const reason = window.prompt('请输入恢复原因', '不对口判定有误') || '';
      if (reason.trim().length < 2) return;
      await restoreMismatchRecord(restoreMismatch.dataset.restoreMismatch, reason);
    }
    const reassignCustomer = event.target.closest('[data-reassign-customer]');
    if (reassignCustomer) {
      const reason = window.prompt('请输入重新分配原因', '按区域和语言能力重新分配') || '';
      if (!reason.trim()) return;
      await reassignMismatchCustomer(reassignCustomer, reason);
    }
    const retryResearch = event.target.closest('[data-retry-research]');
    if (retryResearch) await loadResearch(retryResearch.dataset.retryResearch, { reset: true });
    const retryResearchSchema = event.target.closest('[data-retry-research-schema]');
    if (retryResearchSchema) {
      await initializeResearchFilters(retryResearchSchema.dataset.retryResearchSchema, { force: true });
    }
    if (event.target.closest('#changePasswordBtn')) openPasswordModal();
    if (event.target.closest('#intakeSettingsBtn')) openIntakeSettingsModal();
    if (event.target.closest('#manualAssignIntakeBtn')) {
      try { await openManualIntakeAssignment(); }
      catch (error) { toast(error.message); }
    }
    if (event.target.closest('#clearIntakeSelection')) {
      state.selectedIntakeIds.clear();
      state.intakeSelectAllScope = null;
      renderIntake();
    }
    if (event.target.closest('#scanIntakeBtn')) {
      try {
        const result = await api('/api/sales-crm/intake/scan', { method: 'POST', body: '{}' });
        await refresh(`同步完成：入库 ${result.imported}，跳过 ${result.skipped}`);
      } catch (error) { toast(error.message); }
    }
    const intakeTab = event.target.closest('[data-intake-status]');
    if (intakeTab) {
      state.intakeStatus = intakeTab.dataset.intakeStatus;
      $$('#intakeTabs button').forEach(item => item.classList.toggle('active', item === intakeTab));
      void loadIntakePage({ reset: true });
    }
    if (event.target.closest('#intakeFilterToggle')) {
      const panel = $('#intakeFilterPanel');
      panel.classList.toggle('hidden');
      $('#intakeFilterToggle').setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
    }
    if (event.target.closest('#intakeFilterApply')) {
      readIntakeFilterControls();
      $('#intakeFilterPanel').classList.add('hidden');
      $('#intakeFilterToggle').setAttribute('aria-expanded', 'false');
      void loadIntakePage({ reset: true });
    }
    if (event.target.closest('#intakeFilterReset') || event.target.closest('#intakeClearFilters')) {
      Object.keys(state.intakeFilters).forEach(key => { state.intakeFilters[key] = key === 'unassignedOnly' ? false : ''; });
      syncIntakeFilterControls();
      void loadIntakePage({ reset: true });
    }
    const removeIntakeFilter = event.target.closest('[data-remove-intake-filter]');
    if (removeIntakeFilter) {
      const key = removeIntakeFilter.dataset.removeIntakeFilter;
      if (Object.hasOwn(state.intakeFilters, key)) {
        state.intakeFilters[key] = key === 'unassignedOnly' ? false : '';
        syncIntakeFilterControls();
        void loadIntakePage({ reset: true });
      }
    }
    const reviewIntake = event.target.closest('[data-intake-review]');
    if (reviewIntake) {
      const reviewItem = (state.data?.intake?.items || [])
        .find(row => String(row.id) === String(reviewIntake.dataset.intakeReview));
      if (reviewItem) openIntakeReview(reviewItem);
      return;
    }
    const assignIntake = event.target.closest('[data-intake-assign]');
    if (assignIntake) openIntakeAssignModal(assignIntake.dataset.intakeAssign);
    const unassignIntake = event.target.closest('[data-intake-unassign]');
    if (unassignIntake) {
      const item = (state.data?.intake?.items || []).find(row => row.id === unassignIntake.dataset.intakeUnassign);
      if (!item) return;
      if (!window.confirm(`确认取消分配「${item.company_name || item.id}」？将清空负责人和领取期限并恢复为待分配。`)) return;
      try {
        await api('/api/sales-crm/intake/action', {
          method: 'POST',
          body: JSON.stringify({ action: 'unassign', itemId: item.id, idempotencyKey: proposalRequestId() }),
        });
        await refreshIntakeWorkflow('已取消分配，线索恢复为待分配');
      } catch (error) { toast(error.message); }
      return;
    }
    const intakeAction = event.target.closest('[data-intake-action]');
    if (intakeAction) {
      const action = intakeAction.dataset.intakeAction;
      const itemId = intakeAction.dataset.itemId;
      if (['return', 'reject'].includes(action)) openIntakeReasonModal(itemId, action);
      else {
        try {
          await api('/api/sales-crm/intake/action', { method: 'POST', body: JSON.stringify({ action, itemId, ownerId: intakeAction.dataset.ownerId || '', idempotencyKey: intakeAction.dataset.idempotencyKey || proposalRequestId() }) });
          if (action === 'claim') {
            await refreshIntakeWorkflow('领取成功，客户已进入 CRM');
          } else {
            await refresh('客户已分配');
          }
        } catch (error) { toast(error.message); }
      }
    }
    const team = event.target.closest('[data-team-user]');
    if (team) {
      state.teamUserId = team.dataset.teamUser;
      renderTeam();
      $('#teamDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const runCoaching = event.target.closest('[data-run-sales-coaching]');
    if (runCoaching) await runSalesCoaching(runCoaching.dataset.runSalesCoaching);
    const alertTab = event.target.closest('[data-severity]');
    if (alertTab) {
      state.alertSeverity = alertTab.dataset.severity;
      state.authorizedBusinessLists.alerts.page = 1;
      $$('#alertTabs button').forEach(item => item.classList.toggle('active', item === alertTab));
      void loadAuthorizedBusinessPage('alerts', { reset: true });
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
    if (event.target.closest('#runManagerAnomaly')) await runManagerAnomalies();
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
    const duplicateResolution = event.target.closest('button[data-duplicate-resolution]');
    if (duplicateResolution) {
      try {
        await resolveDuplicateReviewAction(
          duplicateResolution.dataset.reviewId,
          duplicateResolution.dataset.duplicateResolution,
          duplicateResolution.dataset.candidateId || '',
        );
      } catch (error) { toast(error.message); }
    }
    const duplicateResolutionSave = event.target.closest('[data-duplicate-resolution-save]');
    if (duplicateResolutionSave && !state.duplicateReviews.pendingAction && !state.duplicateReviews.loading) {
      const reviewId = duplicateResolutionSave.dataset.duplicateResolutionSave;
      const radio = document.querySelector(
        `input[data-duplicate-resolution][data-review-id="${CSS.escape(reviewId)}"]:checked`,
      );
      if (!radio) { toast('请先选择处理方式'); return; }
      const resolution = radio.value;
      if (resolution === 'needs_info') { openDuplicateNeedsInfoModal(reviewId); return; }
      try {
        await resolveDuplicateReviewAction(reviewId, resolution, duplicateResolutionSave.dataset.candidateId || '');
      } catch (error) { toast(error.message); }
    }
    const duplicateReviewToggle = event.target.closest('[data-toggle-duplicate-review]');
    if (duplicateReviewToggle && !state.duplicateReviews.pendingAction && !state.duplicateReviews.loading) {
      const reviewId = duplicateReviewToggle.dataset.toggleDuplicateReview;
      selectPendingRecord(`duplicate:${reviewId}`, { openMobile: true });
    }
    const duplicateSearchToggle = event.target.closest('[data-toggle-duplicate-search]');
    if (duplicateSearchToggle && !state.duplicateReviews.pendingAction && !state.duplicateReviews.loading) {
      const reviewId = duplicateSearchToggle.dataset.toggleDuplicateSearch;
      if (state.duplicateReviews.searchOpenId) {
        invalidateDuplicateCandidateSearch(state.duplicateReviews.searchOpenId);
      }
      state.duplicateReviews.searchOpenId = state.duplicateReviews.searchOpenId === reviewId ? '' : reviewId;
      renderDuplicateReviews();
      requestAnimationFrame(() => document.querySelector(
        `[data-duplicate-candidate-search="${CSS.escape(reviewId)}"]`,
      )?.focus());
    }
    const duplicateCandidate = event.target.closest('[data-duplicate-candidate-result]');
    if (duplicateCandidate && !state.duplicateReviews.pendingAction && !state.duplicateReviews.loading) {
      try {
        await chooseDuplicateCandidate(
          duplicateCandidate.dataset.duplicateCandidateResult,
          duplicateCandidate.dataset.customerId,
        );
      } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#duplicateReviewRefresh')) {
      if (!state.duplicateReviews.pendingAction && !state.duplicateReviews.loading) {
        void loadDuplicateReviews({ page: state.duplicateReviews.page });
      }
    }
    if (event.target.closest('#duplicateReviewBulkDistinct')) {
      try { await bulkResolveDuplicateDistinctAction(); } catch (error) { toast(error.message); }
    }
    if (event.target.closest('#duplicateReviewRecalculate')) {
      try { await recalculateDuplicateReviewAction(); } catch (error) { toast(error.message); }
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
    const pageSize = event.target.closest('[data-pagination-size]');
    if (!pageSize) return;
    const root = pageSize.closest('[data-pagination]');
    const handler = paginationRegistry.get(root?.dataset.pagination || '');
    const value = Number(pageSize.value);
    if (handler && PAGE_SIZE_OPTIONS.includes(value)) handler({ page: 1, pageSize: value });
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'managerTaskAction') setManagerTaskAction(event.target.value);
    if (event.target.name?.startsWith('permission__') && event.target.closest('#permissionGroupForm')) {
      refreshPermissionGroupSummary(event.target.closest('#permissionGroupForm'));
    }
    if (event.target.closest('#managerTaskSettingsForm')) {
      event.target.closest('#managerTaskSettingsForm').dataset.dirty = 'true';
    }
    if (event.target.matches('#assistantRuntimeMode')) void setAssistantRuntimeMode(event.target.value);
    if (event.target.matches('[data-ai-feature]')) void setAIFeature(event.target.dataset.aiFeature, event.target.checked);
    if (event.target.matches('#aiTaskStateFilter,#aiTaskTypeFilter,#aiTaskFromFilter,#aiTaskToFilter')) void loadAiTasks({ reset: true });
    if (event.target.matches('[data-select-customer]')) {
      const customerId = event.target.dataset.selectCustomer;
      if (state.customerSelectionMode === 'filtered') {
        state.customerSelectionMode = 'explicit';
        state.customerSelectionFilterScope = null;
        state.selectedCustomerIds = new Set(selectedVisibleCustomerIds());
      }
      if (event.target.checked) state.selectedCustomerIds.add(customerId);
      else state.selectedCustomerIds.delete(customerId);
      renderCustomers();
    }
    if (event.target.id === 'selectCustomerPage') {
      state.customerSelectionMode = 'explicit';
      state.customerSelectionFilterScope = null;
      selectedVisibleCustomerIds().forEach(customerId => {
        if (event.target.checked) state.selectedCustomerIds.add(customerId);
        else state.selectedCustomerIds.delete(customerId);
      });
      renderCustomers();
    }
    if (event.target.matches('[data-select-intake]')) {
      switchIntakeSelectionToCurrentPage();
      const itemId = event.target.dataset.selectIntake;
      if (event.target.checked) state.selectedIntakeIds.add(itemId);
      else state.selectedIntakeIds.delete(itemId);
      renderIntake();
    }
    if (event.target.id === 'selectVisibleIntake') {
      switchIntakeSelectionToCurrentPage();
      const assignable = (state.data.intake?.items || [])
        .filter(intakeItemAssignable);
      assignable.forEach(item => {
        if (event.target.checked) state.selectedIntakeIds.add(item.id);
        else state.selectedIntakeIds.delete(item.id);
      });
      renderIntake();
    }
    if (event.target.matches('#intakeManualAssignForm select[name="ownerId"]')) {
      syncManualAssignmentAmount();
    }
  });

  document.addEventListener('input', event => {
    if (event.target.closest('#managerTaskSettingsForm')) {
      event.target.closest('#managerTaskSettingsForm').dataset.dirty = 'true';
    }
    if (event.target.id === 'todayTaskOwnerSearch') {
      renderTodayTaskCandidateOptions(event.target.value);
    }
    if (event.target.id === 'recycleSearch') {
      clearTimeout(loadRecycleBin.timer);
      loadRecycleBin.timer = setTimeout(() => void loadRecycleBin({ reset: true }), 250);
    }
    if (event.target.matches('#activityCorrectionReasonForm textarea[name="reason"]')) {
      const nextReason = event.target.value;
      if (nextReason !== state.activityCorrection.reason) rotateActivityCorrectionIdempotencyKey();
      state.activityCorrection.reason = nextReason;
    }
  });

  document.addEventListener('click', event => {
    const activityModeButton = event.target.closest('[data-activity-mode]');
    if (activityModeButton) {
      setActivityModalMode(activityModeButton.dataset.activityMode);
      return;
    }
    const returnedHistory = event.target.closest('[data-returned-history]');
    if (returnedHistory) {
      void openReturnedHistoryModal(returnedHistory.dataset.returnedHistory);
      return;
    }
    const tab = event.target.closest('[data-notification-status]');
    if (tab) {
      const controller = state.authorizedBusinessLists.notifications.filterController;
      state.authorizedBusinessLists.notifications.page = 1;
      const statusAuthorized = Boolean(controller?.getSchema().fields
        .some(field => field.key === 'notification_status'));
      if (!controller || !statusAuthorized) {
        state.notificationStatus = '';
        renderNotifications();
        return;
      }
      const requestedStatus = String(tab.dataset.notificationStatus || '');
      if (requestedStatus) {
        if (controller.setDraft('notification_status', [requestedStatus])) controller.apply();
      } else {
        controller.clearField('notification_status', { apply: true });
      }
    }
    if (event.target.closest('#notificationRefresh')) {
      void loadAuthorizedBusinessPage('notifications', { reset: true })
        .then(() => toast('通知已刷新')).catch(error => toast(error.message));
    }
  });

  function switchView(view, pushHistory = true) {
    if (!viewMeta[view]) return;
    if (view === 'aiTasks' && !customerAIEnabled()) {
      view = firstAllowedBusinessView();
      toast('AI 功能已关闭，已返回业务首页');
    }
    const legacyIntakeStatus = view === 'pending' ? 'assigned' : view === 'claimed' ? 'claimed' : '';
    const intakeAlias = ['intake', 'pending', 'claimed'].includes(view);
    let canonicalView = intakeAlias ? 'pool' : view;
    if (!identityInspectionAllowsView(canonicalView)) {
      canonicalView = firstAllowedBusinessView();
      view = canonicalView;
      toast('身份检查期间不能进入安全管理页面');
    }
      const permission = canonicalView === 'customerProfile' && state.customerProfileReadOnly
      ? 'view_intake'
      : viewPermissions[view] || `view_${canonicalView}`;
    if (canonicalView === 'protectedCustomers') {
      if (!canAccessProtectionAndDedupe()) return toast('当前账号没有客户保护或查重权限');
    } else if (!can(permission)) return toast('当前账号没有该模块权限');
      const viewChanged = state.view !== canonicalView;
      state.view = canonicalView;
      if (viewChanged && canonicalView === 'customers') restoreCustomerFilters();
      if (viewChanged && canonicalView === 'managerMetrics') state.managerMetricRange = 30;
    state.intakeStatus = legacyIntakeStatus || (canonicalView === 'pool' ? '' : state.intakeStatus);
    $$('.view').forEach(item => item.classList.toggle('active', item.id === `${canonicalView}View`));
    $$('#nav [data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === canonicalView));
    $('#viewEyebrow').textContent = viewMeta[canonicalView][0];
    $('#viewTitle').textContent = viewMeta[canonicalView][1];
    document.body.classList.toggle('customer-profile-active', canonicalView === 'customerProfile');
    document.body.classList.toggle('access-admin-active', canonicalView === 'users');
    if (canonicalView === 'pool') renderIntake();
      if (canonicalView === 'pool') {
        void initializeAuthorizedBusinessFilters('intake', { force: viewChanged });
      }
      if (canonicalView === 'customers') void initializeCustomerFilters({ force: viewChanged });
    if (canonicalView === 'users' && can('manage_users') && !state.data.impersonation) {
      void loadFilterPermissionAdmin().catch(error => toast(error.message));
    }
    if (canonicalView === 'users' && isRealAdmin() && can('manage_manager_task_settings')) {
      void loadManagerTaskSettings().catch(error => toast(error.message));
    }
      if (researchConfig[canonicalView] && (viewChanged || !state.research[canonicalView].filterMount)) {
        void initializeResearchFilters(canonicalView, { force: viewChanged });
      }
      if (canonicalView === 'aiTasks' && viewChanged) {
        ['aiTaskStateFilter', 'aiTaskTypeFilter', 'aiTaskCustomerFilter', 'aiTaskOwnerFilter',
          'aiTaskModelFilter', 'aiTaskFromFilter', 'aiTaskToFilter'].forEach(id => {
          const input = $(`#${id}`);
          if (input) input.value = '';
        });
        void loadAiTasks({ reset: true });
      } else if (canonicalView === 'aiTasks' && !state.aiTasks.loaded) void loadAiTasks({ reset: true });
    if (canonicalView === 'aiTasks' && !state.aiGovernance.loaded) void loadAiGovernance();
    if (canonicalView === 'alerts' && canViewManagerAnomalies() && !state.managerAnomalies.loaded) {
      void loadManagerAnomalies();
    }
    if (canonicalView === 'team' && canViewSalesCoaching() && !state.salesCoaching.loaded) {
      void loadSalesCoaching();
    }
      if (canonicalView === 'team' && (viewChanged || !state.teamStatus.loaded)) {
        state.teamStatus.section = 'progress';
        state.teamStatus.drilldown = 'customer';
        state.teamStatus.range = '30d';
        if ($('#teamRange')) $('#teamRange').value = '30d';
        void initializeTeamStatusFilters({ force: viewChanged });
    }
      const businessPageKey = {
      pipeline: 'pipeline',
      alerts: 'alerts',
      insights: 'insights',
      recycleBin: 'recycle_bin',
      notifications: 'notifications',
      }[canonicalView];
      if (canonicalView === 'alerts' && viewChanged) state.alertSeverity = '';
      if (businessPageKey) void initializeAuthorizedBusinessFilters(businessPageKey, { force: viewChanged });
      if (canonicalView === 'managerTasks') {
        void initializeAuthorizedBusinessFilters('manager_tasks', { force: viewChanged });
      }
      if (canonicalView === 'managerMetrics') {
        void initializeAuthorizedBusinessFilters('manager_metrics', { force: viewChanged });
        void initializeAuthorizedBusinessFilters('manager_risks', { force: viewChanged });
      }
      if (canonicalView === 'activityCorrections') {
        void initializeActivityCorrectionHistoryFilters({ force: viewChanged });
        void initializeActivityCorrectionProposalFilters({ force: viewChanged });
    }
    if (canonicalView === 'maintenance') void loadMaintenanceRuns().catch(error => toast(error.message));
      if (canonicalView === 'protectedCustomers' && (viewChanged
          || (canManageProtectedCustomers() && !state.protectedCustomers.loaded)
          || (canReviewDuplicateCustomers() && !state.duplicateReviews.loaded))) {
        if (viewChanged) Object.assign(state.protectedCustomers, {
          query: '', status: 'all', page: 1, conflictStatus: 'unresolved', conflictPage: 1,
        });
        if ($('#protectedSearch')) $('#protectedSearch').value = state.protectedCustomers.query;
        if ($('#protectedStatus')) $('#protectedStatus').value = state.protectedCustomers.status;
        if ($('#protectedConflictStatus')) $('#protectedConflictStatus').value = state.protectedCustomers.conflictStatus;
        void loadProtectedWorkspace();
    }
    closeDrawer();
    closeCustomerFilterPanel();
    document.body.classList.remove('sidebar-open');
    window.scrollTo?.(0, 0);
    if (location.hash.replace(/^#/, '').split('?')[0] !== canonicalView) {
      const navigationUrl = leadWorkflowNavigationUrl(canonicalView);
      if (pushHistory && !intakeAlias) history.pushState(null, '', navigationUrl);
      else history.replaceState(null, '', navigationUrl);
    }
  }

  document.addEventListener('input', event => {
    if (event.target.matches('[data-protected-field]')) saveProtectedImportDraft();
    if (event.target.matches('[data-duplicate-candidate-search]')) {
      searchDuplicateCandidates(event.target.dataset.duplicateCandidateSearch, event.target.value);
    }
    if (event.target.id === 'pendingQueueSearch') {
      state.pendingCenter.deepLinkUnavailable = false;
      state.pendingCenter.query = event.target.value;
      ensurePendingSelection();
      renderPendingQueue();
      renderPendingDetail();
    }
    if (event.target.id === 'protectedSearch') {
      clearTimeout(state.protectedCustomers.searchTimer);
      state.protectedCustomers.searchTimer = setTimeout(() => {
          state.protectedCustomers.query = event.target.value.trim();
          void loadProtectedCustomers({ reset: true });
      }, 300);
    }
    if (event.target.id === 'customerSearch') {
      clearTimeout(state.customerSearchTimer);
      state.customerSearchTimer = setTimeout(() => {
        state.customerFilters.search = event.target.value.trim();
        saveCustomerFilters();
        syncCustomerFilterControls();
        renderCustomers();
      }, 250);
    }
    if (event.target.id === 'activityCustomerSearch') {
      clearTimeout(state.activityCustomerSearchTimer);
      state.activityCustomerSearchTimer = setTimeout(() => void searchActivityCustomers(event.target.value), 250);
    }
    if (event.target.id === 'activitySummary') resizeActivitySummary(event.target);
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'teamRange') void loadTeamStatus({ reset: true });
    if (event.target.matches('[data-duplicate-review-select]')) {
      if (state.duplicateReviews.pendingAction || state.duplicateReviews.loading) return;
      const reviewId = event.target.dataset.duplicateReviewSelect;
      if (event.target.checked) state.duplicateReviews.selectedIds.add(reviewId);
      else state.duplicateReviews.selectedIds.delete(reviewId);
      renderDuplicateReviews();
    }
    if (event.target.id === 'duplicateReviewSelectAll') {
      if (state.duplicateReviews.pendingAction || state.duplicateReviews.loading) return;
      state.duplicateReviews.items.forEach(item => {
        if (item.protectedExact) return;
        if (event.target.checked) state.duplicateReviews.selectedIds.add(item.id);
        else state.duplicateReviews.selectedIds.delete(item.id);
      });
      renderDuplicateReviews();
    }
    if (event.target.id === 'protectedCsvInput') void loadProtectedCustomerCsv(event.target.files?.[0]);
        if (event.target.id === 'protectedStatus') {
          state.protectedCustomers.status = event.target.value;
          void loadProtectedCustomers({ reset: true });
    }
    if (event.target.id === 'protectedConflictStatus') {
      state.protectedCustomers.conflictStatus = event.target.value;
      state.protectedCustomers.conflictPage = 1;
      void loadProtectedConflicts();
    }
    if (event.target.matches('input[name^="conflict-decision-"]')) {
      const root = event.target.closest('[data-protected-conflict]');
      const reasonField = document.querySelector(`#conflictReasonField-${CSS.escape(root?.dataset.protectedConflict || '')}`);
      reasonField?.classList.toggle('hidden', event.target.value !== 'supplement_and_retry');
    }
    if (event.target.id === 'customerSort') {
      void loadCustomerPage({ reset: true });
    }
    if (event.target.id === 'filterPermissionScope') {
      syncFilterPermissionTargets();
      renderFilterPermissionAdmin();
    }
    if (event.target.id === 'filterDefinitionSource') syncFilterDefinitionSourceFields();
    if (['filterPermissionTarget', 'filterIdentityPreview'].includes(event.target.id)) {
      renderFilterPermissionAdmin();
    }
    if (event.target.id === 'stageFilter') state.stageReached = '';
    if (event.target.id === 'activityProgressType') setProgressType(event.target.value);
    if (event.target.id === 'activityReaction') setActivityReaction(event.target.value);
    if (event.target.closest('#customerFilterPanel')) {
      readCustomerFilterControls();
      if ($('#customerFilterApply')) $('#customerFilterApply').textContent = `查看结果（${filteredCustomerAccounts().length}）`;
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'insightSearch') renderInsightsHub();
    if (event.target.id === 'intakeSearch') {
      clearTimeout(state.intakeSearchTimer);
      state.intakeSearchTimer = setTimeout(() => {
        if (state.view === 'pool') void loadIntakePage({ reset: true });
      }, 300);
    }
    if (['aiTaskCustomerFilter', 'aiTaskOwnerFilter', 'aiTaskModelFilter'].includes(event.target.id)) {
      clearTimeout(loadAiTasks.timer);
      loadAiTasks.timer = setTimeout(() => void loadAiTasks({ reset: true }), 250);
    }
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'insightCoverageFilter') renderInsightsHub();
    if (event.target.matches('select[data-role-source]')) {
      const form = event.target.closest('form');
      const groupSelect = form?.querySelector('select[data-role-group]');
      if (groupSelect) {
        groupSelect.innerHTML = groupOptions(event.target.value);
        if (form.id === 'userForm') {
          renderPersonalPermissionEditor(
            form,
            groupPermissionValues(groupSelect.value, state.data.rolePermissions?.[event.target.value] || {}),
          );
        }
      }
    }
    if (event.target.matches('#userForm select[data-role-group]')) {
      renderPersonalPermissionEditor(
        event.target.closest('form'),
        groupPermissionValues(event.target.value, {}),
      );
    }
    if (event.target.matches('#newCustomerOwner')) {
      const submit = $('#newCustomerSubmit');
      if (submit) submit.textContent = event.target.value ? '创建并分配' : '创建客户';
    }
    if (event.target.matches('#permissionGroupForm select[name="role"]')) {
      const form = event.target.closest('form');
      if (form && !form.elements.groupId.value) {
        const defaults = state.data.rolePermissions?.[permissionGroupRole(form)] || {};
        applyPermissionGroupDefaults(form, defaults);
        delete form.dataset.permissionsReset;
      }
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/sales-auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    location.reload();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && $('#modal').classList.contains('open')) {
      const focusable = Array.from($('#modal .modal')?.querySelectorAll(
        'button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])',
      ) || []).filter(element => !element.closest('.hidden'));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    if (event.target.id === 'activityCustomerSearch') {
      const rows = state.activityCustomerResults;
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        state.activityCustomerActiveIndex = (state.activityCustomerActiveIndex + direction + rows.length) % rows.length;
        renderActivityCustomerResults();
        return;
      }
      if (event.key === 'Enter' && rows.length && state.activityCustomerActiveIndex >= 0) {
        event.preventDefault();
        selectActivityCustomer(rows[state.activityCustomerActiveIndex]);
        return;
      }
      if (event.key === 'Escape' && ($('#activityCustomerResults')?.classList.contains('open'))) {
        event.preventDefault();
        state.activityCustomerResults = [];
        state.activityCustomerActiveIndex = -1;
        renderActivityCustomerResults();
        event.target.setAttribute('aria-expanded', 'false');
        return;
      }
    }
    if (navigatePermissionCategoryTab(event)) return;
    const duplicateSearch = event.target.closest?.('[data-duplicate-candidate-search]');
    if (duplicateSearch) {
      const reviewId = duplicateSearch.dataset.duplicateCandidateSearch;
      const rows = state.duplicateReviews.searchResults[reviewId] || [];
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) {
        event.preventDefault();
        const current = Number(state.duplicateReviews.searchActiveIndexes[reviewId] ?? -1);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        state.duplicateReviews.searchActiveIndexes[reviewId] = current < 0
          ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
          : (current + direction + rows.length) % rows.length;
        renderDuplicateReviews();
        restoreDuplicateSearchFocus(reviewId);
        return;
      }
      if (event.key === 'Enter') {
        const activeIndex = Number(state.duplicateReviews.searchActiveIndexes[reviewId] ?? -1);
        if (rows[activeIndex]) {
          event.preventDefault();
          void chooseDuplicateCandidate(reviewId, rows[activeIndex].customerId)
            .catch(error => toast(error.message));
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        invalidateDuplicateCandidateSearch(reviewId);
        state.duplicateReviews.searchOpenId = '';
        state.duplicateReviews.searchActiveIndexes[reviewId] = -1;
        renderDuplicateReviews();
        document.querySelector(`[data-duplicate-review-item="${CSS.escape(reviewId)}"]`)?.focus();
        return;
      }
    }
    const permissionSwitch = event.target.closest?.('.permission-switch-row input[type="checkbox"]');
    if (permissionSwitch && [' ', 'Space', 'Spacebar', 'Enter'].includes(event.key)) {
      event.preventDefault();
      permissionSwitch.checked = !permissionSwitch.checked;
      permissionSwitch.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const accessTab = event.target.closest?.('[data-access-section]');
    if (accessTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = $$('[data-access-section]');
      const currentIndex = tabs.indexOf(accessTab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      switchAccessSection(tabs[nextIndex].dataset.accessSection, { focus: true });
    }
    if (event.key === 'Escape') {
      if (state.activityDraftBeforeReactionAdmin && $('.activity-reaction-admin')) {
        event.preventDefault();
        void restoreActivityDraft();
      } else if ($('#modal .modal')?.classList.contains('activity-correction-modal')) {
        closeActivityCorrectionModal();
      } else {
        closeModal();
      }
      closeDrawer();
      closeCustomerFilterPanel();
      document.body.classList.remove('sidebar-open');
    }
  });
  $('#salesMenuBtn').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#salesSidebarMask').addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  window.addEventListener('message', event => {
    const profileFrame = $('#customerProfileFrame');
    if (event.source !== profileFrame?.contentWindow || event.origin !== location.origin
      || event.data?.type !== 'tradepulse:customer-tags-updated' || !state.data) return;
    const customerId = String(event.data.customerId || '');
    const tags = Array.isArray(event.data.tags) ? event.data.tags : [];
    state.data.accounts.filter(account => String(account.external_customer_id || '') === customerId)
      .forEach(account => { account.customerTags = tags; });
    (state.data.intake?.items || []).filter(item => String(item.external_customer_id || '') === customerId)
      .forEach(item => { item.customerTags = tags; });
    renderCustomers();
    renderIntake();
    if (state.selectedCustomerId) {
      renderCustomerProfileHeader();
      if ($('#customerDrawer').classList.contains('open')) renderDrawer();
    }
  });
  window.addEventListener('hashchange', () => {
    const view = location.hash.replace(/^#/, '');
    if (viewMeta[view] && state.data) {
      restoreLeadWorkflowFromLocation(view);
      switchView(view, false);
    }
  });
  window.addEventListener('popstate', () => {
    const view = location.hash.replace(/^#/, '');
    if (viewMeta[view] && state.data) {
      restoreLeadWorkflowFromLocation(view);
      switchView(view, false);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopDrawerNextActionTimer();
    } else if ($('#customerDrawer')?.classList.contains('open')
      && state.drawerOwner.startsWith('crm:')) {
      refreshDrawerNextActionTime();
      startDrawerNextActionTimer();
    }
  });

  initializeDataTableOverflowHints();
  load();
})();

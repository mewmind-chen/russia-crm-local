import { escapeAttribute, escapeHtml } from '../../components/html.js';
import { renderEmptyState } from '../../components/empty-state.js';
import { renderAIResult } from '../../components/ai-result.js';

export const CUSTOMER_DETAIL_TABS = Object.freeze([
  { id: 'overview', label: '概览' },
  { id: 'timeline', label: '跟进与时间线' },
  { id: 'commerce', label: '商务' },
  { id: 'intelligence', label: '情报' },
  { id: 'evaluations', label: '评价' },
  { id: 'tags', label: '标签' },
  { id: 'ai', label: 'AI' },
]);

export const TAB_SERVICE_DEPENDENCIES = Object.freeze({
  overview: 'customers.getProfile(customerId, options)',
  timeline: 'customers.getTimeline(customerId, options)',
  commerce: 'customers.getCommerce(customerId, options)',
  intelligence: 'intelligence.customerDetail(customerId, options)',
  evaluations: 'customers.getEvaluations(customerId, options)',
  tags: 'customers.getTags(customerId, options)',
  ai: 'ai.customerResults(customerId, options) + ai.customerEnrichment(customerId, options)',
});

const TAB_IDS = new Set(CUSTOMER_DETAIL_TABS.map(tab => tab.id));
const STATUS_LABELS = Object.freeze({
  open: '进行中',
  pending: '待处理',
  queued: '排队中',
  running: '执行中',
  done: '已完成',
  succeeded: '已完成',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  draft: '草稿',
  sent: '已发送',
  accepted: '已接受',
  rejected: '已拒绝',
  won: '已成交',
  lost: '已流失',
});
const CONTACT_KEYS = new Set([
  'email', 'phone', 'contact', 'contactname', 'contacttitle', 'contactmethods',
  'methodssummary', 'fullname', 'fullnamelocal', 'title', 'personsummary',
  'contactsummary', 'contactssummary', 'contactsignal', 'contactcount',
  'contactnextaction', 'contactreconstatus', 'bestpersonid', 'bestcontactlevel',
  'contactlevel', 'decisionrole', 'rolecategory', 'procurementrelevance',
  'employmentstatus', 'employmentconfidence', 'salesready', 'personid',
  'evidence', 'evidenceurls', 'methods', 'resultjson', 'reportpath', 'reporturl',
  'notes', 'feedback', 'reason', 'invalidreason', 'nextaction', 'description',
  'opportunitysummary', 'outreachangle', 'summary', 'outcome', 'detail', 'action',
  'masterdescription', 'deepreport', 'sourcefile', 'decisionreason', 'returnreason',
  'products', 'productfocus', 'recommendedproducts', 'businesssummary',
  'evaluationtext', 'aisummary', 'ailabels', 'aiorderkeys', 'airisks', 'aistrategy',
  'query', 'needsignal', 'sellsignal', 'sourcesummary', 'url', 'snippet',
]);

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function redactContactFields(value) {
  if (Array.isArray(value)) return value.map(redactContactFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !CONTACT_KEYS.has(normalizedKey(key)))
    .map(([key, child]) => [key, redactContactFields(child)]));
}

export function normalizeCustomerDetailTab(tabId) {
  return TAB_IDS.has(String(tabId || '')) ? String(tabId) : 'overview';
}

export function classifyDetailError(error = {}) {
  const status = Number(error.status ?? error.statusCode ?? error.response?.status ?? 0);
  if (error.name === 'AbortError') return { kind: 'aborted', retryable: false };
  if (status === 403) return { kind: 'forbidden', retryable: false };
  if (status === 404) return { kind: 'not-found', retryable: false };
  if (status === 409 || error.code === 'STALE') return { kind: 'stale', retryable: true };
  if (error.code === 'SERVICE_DEPENDENCY_MISSING') {
    return { kind: 'dependency', retryable: false };
  }
  return { kind: 'network', retryable: true };
}

function dependencyError(tabId) {
  const error = new Error(`详情接口待接入：${TAB_SERVICE_DEPENDENCIES[tabId]}`);
  error.code = 'SERVICE_DEPENDENCY_MISSING';
  error.dependency = TAB_SERVICE_DEPENDENCIES[tabId];
  return error;
}

function callTabService(services, group, method, customerId, tabId, signal) {
  const service = services?.[group];
  if (typeof service?.[method] === 'function') {
    return service[method](customerId, { signal });
  }
  if (typeof services?.customers?.getDetailTab === 'function') {
    return services.customers.getDetailTab(customerId, tabId, { signal });
  }
  throw dependencyError(tabId);
}

export async function loadCustomerDetailTab({
  services,
  customerId,
  tabId,
  signal,
  canViewContacts = false,
}) {
  const normalizedTab = normalizeCustomerDetailTab(tabId);
  let payload;
  if (normalizedTab === 'overview') {
    if (typeof services?.customers?.getProfile !== 'function') throw dependencyError(normalizedTab);
    payload = await services.customers.getProfile(customerId, { signal });
  } else if (normalizedTab === 'timeline') {
    payload = await callTabService(services, 'customers', 'getTimeline', customerId, normalizedTab, signal);
  } else if (normalizedTab === 'commerce') {
    payload = await callTabService(services, 'customers', 'getCommerce', customerId, normalizedTab, signal);
  } else if (normalizedTab === 'intelligence') {
    payload = await callTabService(services, 'intelligence', 'customerDetail', customerId, normalizedTab, signal);
  } else if (normalizedTab === 'evaluations') {
    payload = await callTabService(services, 'customers', 'getEvaluations', customerId, normalizedTab, signal);
  } else if (normalizedTab === 'tags') {
    payload = await callTabService(services, 'customers', 'getTags', customerId, normalizedTab, signal);
  } else {
    if (typeof services?.ai?.customerResults !== 'function'
      || typeof services?.ai?.customerEnrichment !== 'function') {
      throw dependencyError(normalizedTab);
    }
    const [results, enrichment] = await Promise.all([
      services.ai.customerResults(customerId, { signal }),
      services.ai.customerEnrichment(customerId, { signal }),
    ]);
    payload = { results, enrichment };
  }
  return canViewContacts ? payload : redactContactFields(payload);
}

function list(value, ...keys) {
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function first(value, ...keys) {
  for (const key of keys) {
    if (value?.[key] !== undefined && value[key] !== null && value[key] !== '') return value[key];
  }
  return '';
}

function safeUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function statusLabel(value, fallback = '') {
  const key = String(value || '').trim();
  return STATUS_LABELS[key] || key || fallback;
}

function rows(items, renderItem, emptyTitle) {
  return items.length
    ? `<div class="detail-list">${items.map(renderItem).join('')}</div>`
    : renderEmptyState({ title: emptyTitle });
}

function renderOverview(data, options) {
  const pool = list(data, 'customerPool', 'customer_pool')[0] || data.pool || data.customer || {};
  const followed = list(data, 'customers', 'accounts')[0] || {};
  const company = first(pool, 'companyName', 'company_name', 'englishName', 'customerId')
    || first(followed, 'companyName', 'company_name', 'customerId');
  const website = safeUrl(first(pool, 'website', 'domain'));
  const contacts = list(data, 'people', 'contacts');
  return `<div class="customer-detail-overview">
    <section class="detail-facts" aria-label="客户概览">
      ${[
        ['企业', company || '未命名客户'],
        ['地区', [first(pool, 'country'), first(pool, 'city')].filter(Boolean).join(' · ') || '未标注'],
        ['行业 / 类型', [first(pool, 'industry'), first(pool, 'customerType', 'customer_type')].filter(Boolean).join(' · ') || '未标注'],
        ['产品需求', first(pool, 'products', 'productFocus', 'product_focus') || '未标注'],
        ['来源', first(pool, 'sourceFile', 'source_file', 'currentPool') || '未标注'],
        ['风险', first(pool, 'riskStatus', 'risk_status') || (pool.isRisk ? '需关注' : '暂无风险标记')],
      ].map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
    </section>
    ${website ? `<p><a href="${escapeAttribute(website)}" target="_blank" rel="noopener">访问官网</a></p>` : ''}
    <section><h3>企业资料</h3><p>${escapeHtml(first(pool, 'description', 'masterDescription') || '暂无企业简介')}</p></section>
    <section><h3>联系人</h3>${options.canViewContacts
      ? rows(contacts, contact => `<article class="detail-row"><strong>${escapeHtml(first(contact, 'full_name', 'name') || '未命名联系人')}</strong><span>${escapeHtml(first(contact, 'title', 'department') || '职位未标注')}</span><small>${escapeHtml(first(contact, 'methods_summary', 'methodsSummary', 'email', 'phone') || '暂无联系方式')}</small></article>`, '暂无联系人')
      : '<div class="restricted-data" role="note">联系人字段已按当前权限脱敏</div>'}</section>
  </div>`;
}

function renderTimeline(data) {
  const events = list(data, 'timeline', 'events', 'activities');
  return rows(events, event => `<article class="timeline-item" data-timeline-kind="${escapeAttribute(first(event, 'kind', 'event_type') || 'activity')}">
    <h3>${escapeHtml(first(event, 'title', 'activity_type', 'event_type') || '客户事件')}</h3>
    <p>${escapeHtml(first(event, 'summary', 'outcome', 'next_action') || '无补充说明')}</p>
    <time>${escapeHtml(first(event, 'occurred_at', 'occurredAt', 'created_at', 'createdAt') || '')}</time>
  </article>`, '暂无跟进与时间线记录');
}

function renderCommerce(data) {
  const rfqs = list(data, 'rfqs');
  const quotes = list(data, 'quotes');
  const orders = list(data, 'orders');
  const group = (title, items) => `<section><h3>${title} <span>${items.length}</span></h3>${rows(items,
    item => `<article class="detail-row"><strong>${escapeHtml(first(item, 'reference', 'id') || title)}</strong><span>${escapeHtml(first(item, 'amount') || 0)} ${escapeHtml(first(item, 'currency') || '')}</span><small>${escapeHtml(statusLabel(first(item, 'status'), first(item, 'created_at')))}</small></article>`,
    `暂无${title}`)}</section>`;
  return `<div class="commerce-detail">${group('RFQ', rfqs)}${group('报价', quotes)}${group('订单', orders)}</div>`;
}

function renderIntelligence(data, options) {
  const jobs = list(data, 'reconJobs', 'recon_jobs');
  const results = list(data, 'reconResults', 'recon_results');
  const contactJobs = list(data, 'contactReconJobs', 'contact_recon_jobs');
  return `<div class="intelligence-detail">
    <section><h3>公司 Recon</h3>${rows([...jobs, ...results], item => `<article class="detail-row">
      <strong>${escapeHtml(first(item, 'company_name', 'companyName', 'job_id') || 'Recon 记录')}</strong>
      <span>${escapeHtml(statusLabel(first(item, 'status'), '已完成'))}</span>
      <small>${escapeHtml(first(item, 'updated_at', 'updatedAt') || '')}</small>
    </article>`, '暂无公司 Recon')}</section>
    <section><h3>联系人 Recon</h3>${options.canViewContacts
      ? rows(contactJobs, item => `<article class="detail-row"><strong>${escapeHtml(first(item, 'task_id', 'job_id') || '联系人任务')}</strong><span>${escapeHtml(statusLabel(first(item, 'status')))}</span></article>`, '暂无联系人 Recon')
      : '<div class="restricted-data" role="note">联系人情报已按当前权限脱敏</div>'}</section>
  </div>`;
}

function renderEvaluations(data) {
  const evaluations = list(data, 'evaluations', 'items');
  return rows(evaluations, item => `<article class="evaluation-card">
    <div><span>经理原文</span><p>${escapeHtml(first(item, 'evaluationText', 'evaluation_text') || '暂无原文')}</p></div>
    ${first(item, 'aiSummary', 'ai_summary') ? `<div><span class="ai-badge">AI 推断</span><p>${escapeHtml(first(item, 'aiSummary', 'ai_summary'))}</p></div>` : ''}
    <small>${escapeHtml(first(item, 'authorName', 'author_name', 'createdAt', 'created_at') || '')}</small>
  </article>`, '暂无客户评价');
}

function renderTags(data) {
  const tags = Array.isArray(data) ? data : list(data, 'tags', 'items');
  return tags.length
    ? `<div class="tag-list">${tags.map(tag => `<span class="pill" data-read-only="${Boolean(tag.readOnly)}">${escapeHtml(first(tag, 'name', 'label') || tag)}</span>`).join('')}</div>`
    : renderEmptyState({ title: '暂无标签' });
}

function renderAi(data) {
  const results = data?.results || {};
  const views = [
    results.presentation,
    results.salesPack?.presentation,
    results.nextAction?.presentation,
    data?.enrichment?.presentation,
  ].filter(view => view?.kind === 'ai_business_result');
  if (!views.length) {
    return renderEmptyState({
      title: '暂无 AI 业务结果',
      description: '现有客户事实和人工流程仍可正常使用。',
    });
  }
  const bindings = {
    view_evidence() {},
    regenerate() {},
    adopt() {},
    edit_adopt() {},
    reject() {},
    review() {},
    copy() {},
    close() {},
  };
  return `<div class="customer-ai-detail">${views.map(view =>
    `<div data-capability="${escapeAttribute(view.capability)}">${renderAIResult(view, bindings)}</div>`).join('')}</div>`;
}

export function renderCustomerDetailTab(tabId, data, options = {}) {
  const tab = normalizeCustomerDetailTab(tabId);
  if (tab === 'overview') return renderOverview(data || {}, options);
  if (tab === 'timeline') return renderTimeline(data || {});
  if (tab === 'commerce') return renderCommerce(data || {});
  if (tab === 'intelligence') return renderIntelligence(data || {}, options);
  if (tab === 'evaluations') return renderEvaluations(data || {});
  if (tab === 'tags') return renderTags(data || {});
  return renderAi(data || {});
}

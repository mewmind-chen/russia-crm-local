'use strict';

const crypto = require('node:crypto');
const { createNotification } = require('../crm_notifications');
const { canonicalize, contextHash, createEvidenceCollector } = require('./evidence');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { FOLLOW_UP_TERMINAL_STAGES } = require('../customer_stages');

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((Number(numerator || 0) * 100 / denominator).toFixed(1)) : 0;
}

function timestamp(value) {
  const text = clean(value, 80);
  if (!text) return 0;
  const parsed = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sampleStatus(sampleSize) {
  if (sampleSize < 10) return 'insufficient';
  if (sampleSize < 30) return 'limited';
  return 'sufficient';
}

function buildSalesCoachingSnapshot(input = {}) {
  const user = input.user || {};
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .filter(row => clean(row.owner_id) === clean(user.id));
  const accountIds = new Set(accounts.map(row => row.id));
  const activities = (Array.isArray(input.activities) ? input.activities : [])
    .filter(row => accountIds.has(row.customer_id));
  const rfqs = (Array.isArray(input.rfqs) ? input.rfqs : []).filter(row => accountIds.has(row.customer_id));
  const quotes = (Array.isArray(input.quotes) ? input.quotes : []).filter(row => accountIds.has(row.customer_id));
  const orders = (Array.isArray(input.orders) ? input.orders : []).filter(row => accountIds.has(row.customer_id));
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const uniqueActivityCustomers = types => new Set(activities
    .filter(row => types.includes(row.activity_type))
    .map(row => row.customer_id)).size;
  const contacted = uniqueActivityCustomers(['email', 'call', 'social']);
  const replied = uniqueActivityCustomers(['reply']);
  const meetings = uniqueActivityCustomers(['meeting', 'manager_join']);
  const rfqCustomers = new Set(rfqs.map(row => row.customer_id)).size;
  const quoteCustomers = new Set(quotes.map(row => row.customer_id)).size;
  const orderCustomers = new Set(orders.map(row => row.customer_id)).size;
  const repeatCustomers = new Set(orders.filter(row => Number(row.is_repeat) === 1)
    .map(row => row.customer_id)).size;
  const observedCustomerIds = new Set([
    ...activities.map(row => row.customer_id),
    ...rfqs.map(row => row.customer_id),
    ...quotes.map(row => row.customer_id),
    ...orders.map(row => row.customer_id),
    ...accounts.filter(row => clean(row.next_action) && clean(row.next_action_at)).map(row => row.id),
  ]);
  const planned = accounts.filter(row => clean(row.next_action) && clean(row.next_action_at)).length;
  const overdue = accounts.filter(row => clean(row.next_action_at)
    && timestamp(row.next_action_at) < now.getTime()
    && !FOLLOW_UP_TERMINAL_STAGES.has(clean(row.stage))).length;
  const rfqCompleteness = rfqs.length
    ? Number((rfqs.reduce((sum, row) => sum + Number(row.completeness || 0), 0) / rfqs.length).toFixed(1))
    : 0;
  const metrics = Object.freeze({
    accounts: accounts.length,
    activities: activities.length,
    contacted,
    replied,
    meetings,
    rfqs: rfqCustomers,
    quotes: quoteCustomers,
    orders: orderCustomers,
    repeats: repeatCustomers,
    planned,
    overdue,
    rfqCompleteness,
    revenue: Number(orders.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)),
    grossProfit: Number(orders.reduce((sum, row) =>
      sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0).toFixed(2)),
  });
  const rates = Object.freeze({
    activation: rate(contacted, accounts.length),
    reply: rate(replied, contacted),
    meeting: rate(meetings, replied),
    rfq: rate(rfqCustomers, meetings),
    quote: rate(quoteCustomers, rfqCustomers),
    order: rate(orderCustomers, rfqCustomers),
    repeat: rate(repeatCustomers, orderCustomers),
    planning: rate(planned, accounts.length),
    overdue: rate(overdue, accounts.length),
  });
  return Object.freeze({
    salesUserId: clean(user.id, 160),
    populationSize: accounts.length,
    sampleSize: observedCustomerIds.size,
    sampleStatus: sampleStatus(observedCustomerIds.size),
    metrics,
    rates,
  });
}

function loadSalesCoachingScope(db, accessContext) {
  const accountIds = accessContext?.accountIds instanceof Set ? [...accessContext.accountIds] : [];
  if (!accountIds.length) return { users: [], accounts: [], activities: [], rfqs: [], quotes: [], orders: [] };
  const placeholders = accountIds.map(() => '?').join(',');
  const accountTestClause = db.prepare('PRAGMA table_info(crm_accounts)').all()
    .some(column => column.name === 'is_test_data') ? 'AND COALESCE(is_test_data,0)=0' : '';
  const activityTestClause = db.prepare('PRAGMA table_info(crm_activities)').all()
    .some(column => column.name === 'is_test_data') ? 'AND COALESCE(is_test_data,0)=0' : '';
  const accounts = db.prepare(`SELECT * FROM crm_accounts
    WHERE id IN (${placeholders}) AND COALESCE(lifecycle_status,'active')='active'
      AND COALESCE(assignment_status,'claimed')!='returned'
      ${accountTestClause}
    ORDER BY owner_id,id`).all(...accountIds);
  const ownerIds = [...new Set(accounts.map(row => row.owner_id).filter(Boolean))];
  const users = ownerIds.length ? db.prepare(`SELECT id,name,role,active FROM sales_users
    WHERE id IN (${ownerIds.map(() => '?').join(',')}) AND role='sales' AND active=1 AND archived_at=''
    ORDER BY id`).all(...ownerIds) : [];
  return {
    users,
    accounts,
    activities: db.prepare(`SELECT customer_id,activity_type,channel,occurred_at
      FROM crm_activities WHERE customer_id IN (${placeholders})
        ${activityTestClause}
      ORDER BY customer_id,occurred_at,id`).all(...accountIds),
    rfqs: db.prepare(`SELECT customer_id,completeness,received_at
      FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY customer_id,received_at,id`).all(...accountIds),
    quotes: db.prepare(`SELECT customer_id,sent_at
      FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY customer_id,sent_at,id`).all(...accountIds),
    orders: db.prepare(`SELECT customer_id,amount,gross_margin,is_repeat,ordered_at
      FROM crm_orders WHERE customer_id IN (${placeholders}) ORDER BY customer_id,ordered_at,id`).all(...accountIds),
  };
}

function teamBenchmark(scope, now) {
  const snapshots = scope.users.map(user => buildSalesCoachingSnapshot({ ...scope, user, now }));
  const evaluable = snapshots.filter(item => item.sampleSize >= 10);
  const rateKeys = ['activation', 'reply', 'meeting', 'rfq', 'quote', 'order', 'repeat', 'planning', 'overdue'];
  return Object.freeze({
    evaluableSales: evaluable.length,
    totalSales: snapshots.length,
    rates: Object.freeze(Object.fromEntries(rateKeys.map(key => [
      key,
      evaluable.length
        ? Number((evaluable.reduce((sum, item) => sum + item.rates[key], 0) / evaluable.length).toFixed(1))
        : 0,
    ]))),
  });
}

function coachingError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function findSnapshot(db, accessContext, salesUserId, options = {}) {
  const scope = loadSalesCoachingScope(db, accessContext);
  const user = scope.users.find(item => item.id === clean(salesUserId, 160));
  if (!user) {
    throw coachingError('销售不在当前授权团队范围内', 404, 'AI_SALES_COACHING_SCOPE_NOT_FOUND');
  }
  return {
    scope,
    user,
    snapshot: buildSalesCoachingSnapshot({ ...scope, user, now: options.now }),
  };
}

function buildSalesCoachingContext(db, accessContext, salesUserId, options = {}) {
  const { scope, user, snapshot } = findSnapshot(db, accessContext, salesUserId, options);
  if (snapshot.sampleStatus === 'insufficient') {
    throw coachingError(
      `样本不足：当前只有 ${snapshot.sampleSize} 个授权客户，至少需要 10 个才能生成 AI 辅导结论`,
      400,
      'AI_SALES_COACHING_SAMPLE_INSUFFICIENT',
    );
  }
  const anchor = scope.accounts.find(item => item.owner_id === user.id
    && accessContext.externalCustomerIds.has(item.external_customer_id));
  if (!anchor) {
    throw coachingError('当前授权范围没有可用于持久化辅导任务的客户', 409, 'AI_SALES_COACHING_ANCHOR_MISSING');
  }
  const benchmark = teamBenchmark(scope, options.now);
  const evidence = createEvidenceCollector({ idPrefix: 'SCE', maxEvidence: 10 });
  const checkedAt = new Date(options.now || Date.now()).toISOString();
  evidence.add({
    sourceTable: 'sales_coaching_aggregate',
    sourceId: user.id,
    field: 'outcome_counts',
    value: JSON.stringify(snapshot.metrics),
    checkedAt,
    confidence: 'deterministic',
  });
  evidence.add({
    sourceTable: 'sales_coaching_aggregate',
    sourceId: user.id,
    field: 'conversion_and_sla_rates',
    value: JSON.stringify(snapshot.rates),
    checkedAt,
    confidence: 'deterministic',
  });
  evidence.add({
    sourceTable: 'sales_coaching_team_aggregate',
    sourceId: 'authorized_scope',
    field: 'benchmark_rates',
    value: JSON.stringify(benchmark),
    checkedAt,
    confidence: benchmark.evaluableSales >= 2 ? 'deterministic' : 'limited_sample',
  });
  const context = {
    station: 'sales_coaching',
    customerId: anchor.external_customer_id,
    crmAccountId: anchor.id,
    snapshot,
    teamBenchmark: benchmark,
    serverScope: {
      scopedAccountCount: scope.accounts.length,
      scopedSalesCount: scope.users.length,
      canViewAllCustomers: Boolean(accessContext.canViewAllCustomers),
    },
    evidenceIds: evidence.ids(),
  };
  return Object.freeze({
    context: Object.freeze(context),
    evidence: evidence.all(),
    evidenceIds: evidence.ids(),
    salesUserIds: Object.freeze([user.id]),
    sampleSizes: Object.freeze([snapshot.sampleSize]),
    sampleStatuses: Object.freeze([snapshot.sampleStatus]),
    contextHash: contextHash(canonicalize(context)),
  });
}

function enqueueSalesCoaching(db, accessContext, actor, salesUserId, options = {}) {
  const context = buildSalesCoachingContext(db, accessContext, salesUserId, options);
  const jobs = createAIJobStore(db);
  const key = `ai-station:sales_coaching:v1:${actor.id}:${salesUserId}:${context.contextHash}`;
  return Object.freeze({
    snapshot: context.context.snapshot,
    job: jobs.enqueue({
      customerId: context.context.customerId,
      crmAccountId: context.context.crmAccountId,
      station: 'sales_coaching',
      contextHash: context.contextHash,
      payload: {
        contextVersion: 'sales-coaching-aggregate-v1',
        stationVersion: 'v1',
        salesUserId,
      },
      createdBy: actor.id,
      eventType: 'sales_coaching',
      eventId: salesUserId,
      priority: 40,
    }, key),
  });
}

function listSalesCoaching(db, accessContext, actor, options = {}) {
  const scope = loadSalesCoachingScope(db, accessContext);
  const jobs = createAIJobStore(db);
  const results = createAIResultStore(db);
  return Object.freeze(scope.users.map(user => {
    const snapshot = buildSalesCoachingSnapshot({ ...scope, user, now: options.now });
    const row = db.prepare(`SELECT id FROM crm_ai_jobs
      WHERE station='sales_coaching' AND created_by=? AND event_type='sales_coaching' AND event_id=?
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(actor.id, user.id);
    const job = row ? jobs.getJob(row.id) : null;
    const storedResult = job ? results.getForJob(job.id) : null;
    const result = storedResult ? Object.freeze({
      ...storedResult,
      customerId: '',
      crmAccountId: null,
    }) : null;
    let stale = Boolean(job && snapshot.sampleStatus === 'insufficient');
    if (job && !stale) {
      stale = job.contextHash !== buildSalesCoachingContext(db, accessContext, user.id, options).contextHash;
    }
    return Object.freeze({
      salesUserId: user.id,
      salesUserName: user.name,
      snapshot,
      ai: job ? Object.freeze({ job, result, stale }) : null,
    });
  }));
}

function recordSalesCoachingNotification(db, job, result) {
  const value = result?.value || {};
  const key = `sales-coaching:${job.id}:ready`;
  createNotification(db, {
    id: `NTF-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`,
    userId: job.createdBy,
    customerId: '',
    code: 'SALES_COACHING_READY',
    severity: 'info',
    title: '销售辅导建议已生成',
    detail: clean(value.recommendations?.[0] || '请在销售能力页面复核辅导建议', 500),
    dedupeKey: key,
  }, { wecomEnabled: false });
}

module.exports = {
  buildSalesCoachingContext,
  buildSalesCoachingSnapshot,
  enqueueSalesCoaching,
  listSalesCoaching,
  loadSalesCoachingScope,
  recordSalesCoachingNotification,
};

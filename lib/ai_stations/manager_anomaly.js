'use strict';

const crypto = require('node:crypto');
const { createNotification } = require('../crm_notifications');
const { canonicalize, contextHash, createEvidenceCollector } = require('./evidence');
const { createAIJobStore } = require('./jobs');
const { createAIResultStore } = require('./results');
const { isActivePipelineStage } = require('../customer_stages');

const RULE_ORDER = Object.freeze({
  RFQ_UNQUOTED: 0,
  MEETING_NO_RFQ: 1,
  HIGH_VALUE_STALE: 2,
  QUOTE_IDLE: 3,
  WORKLOAD_IMBALANCE: 4,
});

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function timestamp(value) {
  const text = clean(value, 80);
  if (!text) return 0;
  const parsed = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageHours(value, now) {
  const time = timestamp(value);
  return time ? Math.max(0, (now.getTime() - time) / 3_600_000) : Number.POSITIVE_INFINITY;
}

function latest(rows, field) {
  return rows.slice().sort((left, right) =>
    timestamp(right[field]) - timestamp(left[field]) || clean(right.id).localeCompare(clean(left.id)))[0] || null;
}

function publicAccount(account) {
  return {
    id: clean(account.id, 160),
    externalCustomerId: clean(account.external_customer_id, 160),
    companyName: clean(account.company_name, 300),
    ownerId: clean(account.owner_id, 160),
    ownerName: clean(account.owner_name, 300),
    stage: clean(account.stage, 80),
    priority: clean(account.priority, 40),
    potentialValue: Number(account.potential_value || 0),
    lastActivityAt: clean(account.last_activity_at || account.created_at, 80),
  };
}

function anomaly(account, code, severity, title, detail, action, source = {}) {
  const accountValue = publicAccount(account);
  return Object.freeze({
    id: `MANAGER-${code}-${accountValue.id}`,
    code,
    severity,
    title,
    detail,
    action,
    customerId: accountValue.id,
    externalCustomerId: accountValue.externalCustomerId,
    companyName: accountValue.companyName,
    ownerId: accountValue.ownerId,
    ownerName: accountValue.ownerName,
    stage: accountValue.stage,
    priority: accountValue.priority,
    potentialValue: accountValue.potentialValue,
    lastActivityAt: accountValue.lastActivityAt,
    sourceType: clean(source.type, 80),
    sourceId: clean(source.id, 160),
    sourceAt: clean(source.at, 80),
    workload: source.workload || null,
  });
}

function buildManagerAnomalies(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .filter(row => clean(row.id) && clean(row.external_customer_id)
      && clean(row.lifecycle_status || 'active') === 'active'
      && clean(row.assignment_status || 'claimed') !== 'returned');
  const activities = Array.isArray(input.activities) ? input.activities : [];
  const rfqs = Array.isArray(input.rfqs) ? input.rfqs : [];
  const quotes = Array.isArray(input.quotes) ? input.quotes : [];
  const users = Array.isArray(input.users) ? input.users : [];
  const anomalies = [];

  for (const account of accounts) {
    if (!isActivePipelineStage(clean(account.stage))) continue;
    const accountActivities = activities.filter(row => row.customer_id === account.id);
    const accountRfqs = rfqs.filter(row => row.customer_id === account.id);
    const accountQuotes = quotes.filter(row => row.customer_id === account.id);
    const meeting = latest(
      accountActivities.filter(row => ['meeting', 'manager_join'].includes(row.activity_type)),
      'occurred_at',
    );
    const meetingAt = meeting?.occurred_at
      || (['meeting', 'manager'].includes(account.stage) ? account.last_activity_at || account.created_at : '');
    if (meetingAt && !accountRfqs.length && ageHours(meetingAt, now) > 168) {
      anomalies.push(anomaly(
        account,
        'MEETING_NO_RFQ',
        'critical',
        '会议后7天仍无询价',
        '规则确认该客户已有会议节点，但授权范围内没有关联 RFQ。',
        '复盘会议结论并确认 BOM、采购窗口和技术阻塞点',
        { type: meeting ? 'crm_activities' : 'crm_accounts', id: meeting?.id || account.id, at: meetingAt },
      ));
    }

    const unquotedRfq = latest(accountRfqs.filter(rfq =>
      !rfq.quoted_at && !accountQuotes.some(quote => quote.rfq_id && quote.rfq_id === rfq.id)), 'received_at');
    if (unquotedRfq && ageHours(unquotedRfq.received_at, now) > 24) {
      anomalies.push(anomaly(
        account,
        'RFQ_UNQUOTED',
        'critical',
        '询价超过24小时未报价',
        `${Number(unquotedRfq.bom_lines || 0)} 行 BOM 尚未形成关联报价。`,
        '立即确认缺料、成本和审批阻塞，协调完成报价',
        { type: 'crm_rfqs', id: unquotedRfq.id, at: unquotedRfq.received_at },
      ));
    }

    const activeQuote = latest(accountQuotes.filter(quote => !['won', 'lost'].includes(clean(quote.status))), 'sent_at');
    const repliedAfterQuote = activeQuote && accountActivities.some(activity =>
      activity.activity_type === 'reply' && timestamp(activity.occurred_at) > timestamp(activeQuote.sent_at));
    if (activeQuote && !repliedAfterQuote && ageHours(activeQuote.sent_at, now) > 72) {
      anomalies.push(anomaly(
        account,
        'QUOTE_IDLE',
        'warning',
        '报价后3天没有客户回复',
        `报价 ${clean(activeQuote.currency, 12) || 'USD'} ${Number(activeQuote.amount || 0).toLocaleString('zh-CN')} 发出后未记录客户回复。`,
        '确认报价送达、客户异议和下一次跟进时间',
        { type: 'crm_quotes', id: activeQuote.id, at: activeQuote.sent_at },
      ));
    }

    const highValue = clean(account.priority).toUpperCase() === 'A' || Number(account.potential_value || 0) >= 50_000;
    const lastAt = account.last_activity_at || account.created_at;
    if (highValue && ageHours(lastAt, now) > 168) {
      anomalies.push(anomaly(
        account,
        'HIGH_VALUE_STALE',
        'critical',
        '高价值客户超过7天未推进',
        `客户优先级为 ${clean(account.priority) || '未标注'}，预计价值 ${Number(account.potential_value || 0).toLocaleString('zh-CN')}，但近期没有有效动作。`,
        '经理确认机会真实性、负责人资源和下一决策节点',
        { type: 'crm_accounts', id: account.id, at: lastAt },
      ));
    }
  }

  const sales = users.filter(user => user.role === 'sales' && Number(user.active) === 1);
  if (sales.length >= 2) {
    const activeAccounts = accounts.filter(account => isActivePipelineStage(clean(account.stage)) && clean(account.owner_id));
    const workload = sales.map(user => ({
      ownerId: clean(user.id, 160),
      ownerName: clean(user.name, 300),
      activeAccounts: activeAccounts.filter(account => account.owner_id === user.id).length,
    })).sort((left, right) => right.activeAccounts - left.activeAccounts || left.ownerId.localeCompare(right.ownerId));
    const busiest = workload[0];
    const lightest = workload[workload.length - 1];
    const average = workload.reduce((sum, row) => sum + row.activeAccounts, 0) / workload.length;
    if (busiest.activeAccounts - lightest.activeAccounts >= 3
        && busiest.activeAccounts >= Math.max(4, Math.ceil(average * 1.5))) {
      const anchor = activeAccounts.filter(account => account.owner_id === busiest.ownerId)
        .sort((left, right) => Number(right.potential_value || 0) - Number(left.potential_value || 0)
          || timestamp(left.last_activity_at || left.created_at) - timestamp(right.last_activity_at || right.created_at))[0];
      if (anchor) {
        const item = anomaly(
          anchor,
          'WORKLOAD_IMBALANCE',
          'warning',
          '团队在手客户负荷不均',
          `${busiest.ownerName}有 ${busiest.activeAccounts} 个活跃客户，${lightest.ownerName}有 ${lightest.activeAccounts} 个。`,
          '经理核对客户难度和销售能力后决定是否重新分配',
          { type: 'crm_accounts', id: anchor.id, at: anchor.updated_at || anchor.created_at, workload },
        );
        anomalies.push(Object.freeze({
          ...item,
          id: `MANAGER-WORKLOAD_IMBALANCE-${busiest.ownerId}-${anchor.id}`,
        }));
      }
    }
  }

  return Object.freeze(anomalies.sort((left, right) =>
    (left.severity === 'critical' ? 0 : 1) - (right.severity === 'critical' ? 0 : 1)
    || RULE_ORDER[left.code] - RULE_ORDER[right.code]
    || right.potentialValue - left.potentialValue
    || left.companyName.localeCompare(right.companyName, 'zh-CN')));
}

function loadManagerScope(db, accessContext) {
  const accountIds = accessContext?.accountIds instanceof Set ? [...accessContext.accountIds] : [];
  if (!accountIds.length) return { users: [], accounts: [], activities: [], rfqs: [], quotes: [] };
  const placeholders = accountIds.map(() => '?').join(',');
  const accounts = db.prepare(`SELECT a.*,u.name owner_name FROM crm_accounts a
    LEFT JOIN sales_users u ON u.id=a.owner_id
    WHERE a.id IN (${placeholders}) AND COALESCE(a.lifecycle_status,'active')='active'
    ORDER BY a.id`).all(...accountIds);
  const scopedOwnerIds = [...new Set(accounts.map(row => row.owner_id).filter(Boolean))];
  const users = accessContext.canViewAllCustomers
    ? db.prepare("SELECT id,name,role,active FROM sales_users WHERE role='sales' AND active=1 AND archived_at='' ORDER BY id").all()
    : scopedOwnerIds.length
      ? db.prepare(`SELECT id,name,role,active FROM sales_users
          WHERE id IN (${scopedOwnerIds.map(() => '?').join(',')}) AND role='sales' AND active=1 AND archived_at=''
          ORDER BY id`).all(...scopedOwnerIds)
      : [];
  return {
    users,
    accounts,
    activities: db.prepare(`SELECT * FROM crm_activities WHERE customer_id IN (${placeholders}) ORDER BY customer_id,occurred_at DESC,id`).all(...accountIds),
    rfqs: db.prepare(`SELECT * FROM crm_rfqs WHERE customer_id IN (${placeholders}) ORDER BY customer_id,received_at DESC,id`).all(...accountIds),
    quotes: db.prepare(`SELECT * FROM crm_quotes WHERE customer_id IN (${placeholders}) ORDER BY customer_id,sent_at DESC,id`).all(...accountIds),
  };
}

function scanManagerScope(db, accessContext, options = {}) {
  return buildManagerAnomalies({ ...loadManagerScope(db, accessContext), now: options.now });
}

function buildManagerAnomalyContext(db, accessContext, anomalyId, options = {}) {
  const anomalyValue = scanManagerScope(db, accessContext, options)
    .find(item => item.id === clean(anomalyId, 220));
  if (!anomalyValue) {
    const error = new Error('经理异常已失效，请重新扫描');
    error.code = 'AI_MANAGER_ANOMALY_STALE';
    error.statusCode = 409;
    throw error;
  }
  const evidence = createEvidenceCollector({ idPrefix: 'MAE', maxEvidence: 20 });
  evidence.add({
    sourceTable: 'manager_anomaly_rule',
    sourceId: anomalyValue.id,
    field: 'rule_finding',
    value: `${anomalyValue.title}；${anomalyValue.detail}`,
    checkedAt: anomalyValue.sourceAt,
  });
  evidence.add({
    sourceTable: 'crm_accounts',
    sourceId: anomalyValue.customerId,
    field: 'account_state',
    value: JSON.stringify({
      stage: anomalyValue.stage,
      priority: anomalyValue.priority,
      potentialValue: anomalyValue.potentialValue,
      lastActivityAt: anomalyValue.lastActivityAt,
      ownerId: anomalyValue.ownerId,
    }),
    checkedAt: anomalyValue.lastActivityAt,
  });
  if (anomalyValue.sourceType && anomalyValue.sourceId) {
    evidence.add({
      sourceTable: anomalyValue.sourceType,
      sourceId: anomalyValue.sourceId,
      field: 'trigger',
      value: `${anomalyValue.code}:${anomalyValue.sourceAt || 'no-time'}`,
      checkedAt: anomalyValue.sourceAt,
    });
  }
  if (anomalyValue.workload) {
    evidence.add({
      sourceTable: 'sales_users',
      sourceId: anomalyValue.ownerId,
      field: 'scoped_workload',
      value: JSON.stringify(anomalyValue.workload),
      checkedAt: new Date(options.now || Date.now()).toISOString(),
    });
  }
  const context = {
    station: 'manager_anomaly',
    customerId: anomalyValue.externalCustomerId,
    crmAccountId: anomalyValue.customerId,
    anomaly: anomalyValue,
    serverScope: {
      accountIds: [...accessContext.accountIds].sort(),
      canViewAllCustomers: Boolean(accessContext.canViewAllCustomers),
    },
    evidenceIds: evidence.ids(),
  };
  return Object.freeze({
    context: Object.freeze(context),
    evidence: evidence.all(),
    evidenceIds: evidence.ids(),
    anomalyIds: Object.freeze([anomalyValue.id]),
    anomalyCodes: Object.freeze([anomalyValue.code]),
    customerIds: Object.freeze([anomalyValue.customerId]),
    contextHash: contextHash(canonicalize(context)),
  });
}

function enqueueManagerAnomalies(db, accessContext, actor, options = {}) {
  const anomalies = scanManagerScope(db, accessContext, options);
  const jobs = createAIJobStore(db);
  const enqueued = [];
  for (const item of anomalies) {
    if (!accessContext.externalCustomerIds.has(item.externalCustomerId)) continue;
    const context = buildManagerAnomalyContext(db, accessContext, item.id, options);
    enqueued.push(jobs.enqueue({
      customerId: item.externalCustomerId,
      crmAccountId: item.customerId,
      station: 'manager_anomaly',
      contextHash: context.contextHash,
      payload: {
        contextVersion: 'manager-scope-v1',
        stationVersion: 'v1',
        anomalyId: item.id,
        anomalyCode: item.code,
      },
      createdBy: actor.id,
      eventType: 'manager_anomaly',
      eventId: item.id,
      priority: item.severity === 'critical' ? 70 : 50,
    }, `ai-station:manager_anomaly:v1:${actor.id}:${item.id}:${context.contextHash}`));
  }
  return Object.freeze({ anomalies, jobs: Object.freeze(enqueued) });
}

function listManagerAnomalies(db, accessContext, actor, options = {}) {
  const anomalies = scanManagerScope(db, accessContext, options);
  const jobs = createAIJobStore(db);
  const results = createAIResultStore(db);
  return Object.freeze(anomalies.map(item => {
    const context = buildManagerAnomalyContext(db, accessContext, item.id, options);
    const row = db.prepare(`SELECT id FROM crm_ai_jobs
      WHERE station='manager_anomaly' AND created_by=? AND event_type='manager_anomaly' AND event_id=?
      ORDER BY created_at DESC,id DESC LIMIT 1`).get(actor.id, item.id);
    const job = row ? jobs.getJob(row.id) : null;
    const result = job ? results.getForJob(job.id) : null;
    return Object.freeze({
      ...item,
      ai: job ? Object.freeze({
        job,
        result,
        stale: job.contextHash !== context.contextHash,
      }) : null,
    });
  }).sort((left, right) =>
    Number(right.ai?.result?.value?.priorityScore || (right.severity === 'critical' ? 80 : 50))
      - Number(left.ai?.result?.value?.priorityScore || (left.severity === 'critical' ? 80 : 50))
    || left.id.localeCompare(right.id)));
}

function recordManagerAnomalyNotification(db, job, result) {
  const value = result?.value || {};
  const key = `manager-anomaly:${job.id}:ready`;
  createNotification(db, {
    id: `NTF-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`,
    userId: job.createdBy,
    customerId: job.crmAccountId || '',
    code: 'MANAGER_ANOMALY_READY',
    severity: value.severity === 'critical' ? 'critical' : 'warning',
    title: '经理异常建议已生成',
    detail: clean(value.interventionSuggestion, 500),
    dedupeKey: key,
  }, { wecomEnabled: false });
}

module.exports = {
  buildManagerAnomalies,
  buildManagerAnomalyContext,
  enqueueManagerAnomalies,
  listManagerAnomalies,
  loadManagerScope,
  recordManagerAnomalyNotification,
  scanManagerScope,
};

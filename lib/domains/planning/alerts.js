'use strict';

// Alert aggregation and reason ordering for the today-task and recycle views.
// These are pure projections over already-loaded rows.

const ALERT_REASON_ORDER = Object.freeze({
  RFQ_UNQUOTED: 10,
  MANAGER_NEEDED: 20,
  MANAGER_REPLIED: 25,
  UNCLAIMED_LEAD: 30,
  UNCLAIMED: 30,
  PRIORITY_OVERDUE: 40,
  NO_NEXT_DEFERRED: 45,
  NO_PLAN_STREAK: 46,
  NO_NEXT: 50,
  INTAKE_IDLE: 60,
  OVERDUE: 70,
  REPLY_IDLE: 80,
  POST_MANAGER_IDLE: 81,
  MEETING_NO_RFQ: 90,
  QUOTE_IDLE: 91,
  STALE: 92,
});

function reasonOrder(alert) {
  if (alert.code === 'OVERDUE'
    && ['A', 'B'].includes(alert.customerPriority)
    && Number(alert.overdueHours || 0) >= 72) return ALERT_REASON_ORDER.PRIORITY_OVERDUE;
  return ALERT_REASON_ORDER[alert.code] || 999;
}

function urgencyFor(alert) {
  const order = reasonOrder(alert);
  if (order <= ALERT_REASON_ORDER.PRIORITY_OVERDUE) return 'immediate';
  if (['NO_NEXT_DEFERRED', 'NO_NEXT', 'INTAKE_IDLE', 'OVERDUE', 'REPLY_IDLE', 'POST_MANAGER_IDLE'].includes(alert.code)) return 'today';
  return 'attention';
}

function groupAlerts(alerts) {
  const customerIdsByExternalId = new Map();
  for (const alert of alerts) {
    if (!alert.externalCustomerId || !alert.customerId) continue;
    const customerIds = customerIdsByExternalId.get(alert.externalCustomerId) || new Set();
    customerIds.add(alert.customerId);
    customerIdsByExternalId.set(alert.externalCustomerId, customerIds);
  }
  const groups = new Map();
  for (const alert of alerts) {
    const externalCustomerIds = customerIdsByExternalId.get(alert.externalCustomerId);
    const unambiguousExternalId = alert.externalCustomerId && (!externalCustomerIds || externalCustomerIds.size <= 1);
    const key = unambiguousExternalId
      ? `external:${alert.externalCustomerId}`
      : alert.customerId
        ? `customer:${alert.customerId}`
        : alert.intakeItemId
          ? `intake:${alert.intakeItemId}`
          : `alert:${alert.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }
  const urgencyOrder = { immediate: 0, today: 1, attention: 2 };
  const priorityOrder = { A: 0, B: 1, C: 2, D: 3 };
  return [...groups.values()].map(reasons => {
    const semanticReasons = [];
    const overdueClaimIndex = new Map();
    for (const reason of reasons) {
      const isOverdueClaim = ['UNCLAIMED', 'UNCLAIMED_LEAD'].includes(reason.code)
        && reason.intakeItemId;
      if (!isOverdueClaim) {
        semanticReasons.push(reason);
        continue;
      }
      const semanticKey = String(reason.intakeItemId);
      const existingIndex = overdueClaimIndex.get(semanticKey);
      if (existingIndex === undefined) {
        overdueClaimIndex.set(semanticKey, semanticReasons.length);
        semanticReasons.push(reason);
        continue;
      }
      const existing = semanticReasons[existingIndex];
      const preferred = reason.code === 'UNCLAIMED_LEAD' ? reason : existing;
      const companion = preferred === reason ? existing : reason;
      semanticReasons[existingIndex] = {
        ...companion,
        ...preferred,
        customerId: preferred.customerId || companion.customerId || '',
        externalCustomerId: preferred.externalCustomerId || companion.externalCustomerId || '',
        intakeItemId: preferred.intakeItemId || companion.intakeItemId || '',
        overdueHours: Math.max(
          Number(existing.overdueHours || 0),
          Number(reason.overdueHours || 0),
        ),
      };
    }
    const ordered = semanticReasons.sort((left, right) =>
      reasonOrder(left) - reasonOrder(right)
      || Number(right.overdueHours || 0) - Number(left.overdueHours || 0)
      || String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const primary = ordered[0];
    const urgency = urgencyFor(primary);
    return {
      ...primary,
      externalCustomerId: ordered.find(reason => reason.externalCustomerId)?.externalCustomerId || '',
      intakeItemId: ordered.find(reason => reason.intakeItemId)?.intakeItemId || '',
      customerId: ordered.find(reason => reason.customerId)?.customerId || '',
      severity: urgency === 'immediate' ? 'critical' : urgency === 'today' ? 'today' : 'warning',
      urgency,
      urgencyLabel: urgency === 'immediate' ? '立即处理' : urgency === 'today' ? '今天完成' : '需要关注',
      reasons: ordered.map(reason => ({
        code: reason.code,
        title: reason.title,
        detail: reason.detail,
        action: reason.action,
        actionKind: reason.actionKind || '',
        allowedActions: reason.allowedActions || [],
        assignedAt: reason.assignedAt || '',
        ownerName: reason.ownerName || '',
        managerRequest: reason.managerRequest || null,
        dueAt: reason.dueAt || '',
        overdueHours: Number(reason.overdueHours || 0),
        noPlanStreak: Number(reason.noPlanStreak || 0),
      })),
      reasonCount: ordered.length,
      otherReasons: ordered.slice(1).map(reason => reason.title),
      maxOverdueHours: Math.max(...ordered.map(reason => Number(reason.overdueHours || 0))),
    };
  }).sort((left, right) =>
    urgencyOrder[left.urgency] - urgencyOrder[right.urgency]
    || (priorityOrder[left.customerPriority] ?? 9) - (priorityOrder[right.customerPriority] ?? 9)
    || Number(right.maxOverdueHours || 0) - Number(left.maxOverdueHours || 0)
    || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
    || String(left.companyName || '').localeCompare(String(right.companyName || ''), 'zh-CN')
    || String(left.customerId || '').localeCompare(String(right.customerId || ''))
    || String(left.intakeItemId || '').localeCompare(String(right.intakeItemId || ''))
    || String(left.id || '').localeCompare(String(right.id || '')));
}

module.exports = Object.freeze({
  ALERT_REASON_ORDER,
  reasonOrder,
  urgencyFor,
  groupAlerts,
});
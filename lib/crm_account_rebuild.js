'use strict';

const {
  STAGE_INDEX,
  isFollowUpTerminalStage,
  isValidStage,
} = require('./customer_stages');
const { effectiveCommerceSql, listEffectiveActivities } = require('./crm_activity_effective');

function hasTable(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function clean(value) {
  return String(value ?? '').trim();
}

function parsedJson(value) {
  try {
    const result = JSON.parse(String(value || '{}'));
    return result && typeof result === 'object' ? result : {};
  } catch (_error) {
    return {};
  }
}

function timestamp(value) {
  const text = clean(value);
  if (!text) return Number.NaN;
  const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text)
    ? text
    : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function nowTimestamp(value) {
  if (value === undefined) return Date.now();
  const parsed = value instanceof Date ? value.getTime() : timestamp(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error('重算时间无效');
    error.code = 'CRM_ACCOUNT_REBUILD_NOW_INVALID';
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function compareEvents(left, right) {
  return clean(left.occurredAt).localeCompare(clean(right.occurredAt))
    || clean(left.createdAt).localeCompare(clean(right.createdAt))
    || clean(left.id).localeCompare(clean(right.id));
}

function isVisibleAt(event, nowMs) {
  const occurredMs = timestamp(event.occurredAt);
  const createdMs = timestamp(event.createdAt);
  return (!Number.isFinite(occurredMs) || occurredMs <= nowMs)
    && (!Number.isFinite(createdMs) || createdMs <= nowMs);
}

function stageAfter(current, proposed, before = '') {
  const next = clean(proposed);
  if (!isValidStage(next)) return current;
  if (isFollowUpTerminalStage(next)) return next;
  if (isFollowUpTerminalStage(before) || ['lost', 'disqualified'].includes(current)) return next;
  return (STAGE_INDEX[next] ?? -1) > (STAGE_INDEX[current] ?? -1) ? next : current;
}

function customerIds(account) {
  return [...new Set([clean(account.id), clean(account.external_customer_id)].filter(Boolean))];
}

function customerWhere(ids) {
  return `customer_id IN (${ids.map(() => '?').join(',')})`;
}

function activityEvents(db, account, nowMs) {
  return listEffectiveActivities(db, account.id)
    .map(row => ({
      id: row.id,
      kind: 'activity',
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      row,
    }))
    .filter(event => isVisibleAt(event, nowMs));
}

function commerceEvents(db, account, nowMs) {
  const events = [];
  const specs = [
    ['crm_rfqs', 'rfq', 'received_at', 'rfq'],
    ['crm_quotes', 'quote', 'sent_at', 'quoted'],
    ['crm_orders', 'order', 'ordered_at', 'won'],
  ];
  for (const [table, kind, occurredColumn, proposedStage] of specs) {
    const columns = tableColumns(db, table);
    if (!columns.has('customer_id') || !columns.has(occurredColumn)) continue;
    const selected = [
      'commerce.id', 'commerce.customer_id', `commerce.${occurredColumn}`,
      columns.has('created_at') ? 'commerce.created_at' : `'' created_at`,
      kind === 'order' && columns.has('is_repeat') ? 'commerce.is_repeat' : '0 is_repeat',
      kind === 'quote' && columns.has('next_follow_at') ? 'commerce.next_follow_at' : "'' next_follow_at",
    ];
    const commerceSql = effectiveCommerceSql(db, kind, {
      commerce: 'commerce', activity: 'linked_activity',
    });
    const rows = db.prepare(`SELECT ${selected.join(',')} FROM ${table} commerce
      ${commerceSql.join}
      WHERE commerce.customer_id=? AND ${commerceSql.condition}`).all(account.id);
    for (const row of rows) {
      const stage = kind === 'order' && Number(row.is_repeat) ? 'repeat' : proposedStage;
      const event = {
        id: row.id,
        kind,
        occurredAt: row[occurredColumn],
        createdAt: row.created_at || row[occurredColumn],
        stage,
        nextAction: kind === 'quote' && row.next_follow_at ? '报价后跟进' : '',
        nextActionAt: kind === 'quote' ? row.next_follow_at : '',
        row,
      };
      if (isVisibleAt(event, nowMs)) events.push(event);
    }
  }
  return events;
}

function terminalInterventionEvents(db, account, nowMs) {
  const interventionColumns = tableColumns(db, 'crm_manager_interventions');
  const taskColumns = tableColumns(db, 'crm_manager_tasks');
  if (!interventionColumns.has('action') || !interventionColumns.has('business_change_json')
      || !interventionColumns.has('created_at') || !taskColumns.has('id')
      || !taskColumns.has('customer_id')) return [];
  const ids = customerIds(account);
  const rows = db.prepare(`SELECT i.id,i.created_at,i.business_change_json
    FROM crm_manager_interventions i
    JOIN crm_manager_tasks t ON t.id=i.task_id
    WHERE i.action='terminal_stage' AND ${customerWhere(ids).replaceAll('customer_id', 't.customer_id')}`)
    .all(...ids);
  return rows.map(row => {
    const change = parsedJson(row.business_change_json);
    const stage = clean(change.after?.stage || change.evidence?.after?.stage);
    return {
      id: row.id,
      kind: 'terminal',
      occurredAt: row.created_at,
      createdAt: row.created_at,
      stage,
    };
  }).filter(event => isFollowUpTerminalStage(event.stage) && isVisibleAt(event, nowMs));
}

function allActivityBaseline(db, account, effectiveEvents) {
  const columns = tableColumns(db, 'crm_activities');
  const firstEffective = effectiveEvents[0]?.row;
  if (isValidStage(firstEffective?.stage_before)) return firstEffective.stage_before;
  if (!columns.has('stage_before')) {
    return !effectiveEvents.length && isValidStage(account.stage) ? account.stage : 'new';
  }
  const row = db.prepare(`SELECT stage_before FROM crm_activities
    WHERE customer_id=? AND trim(stage_before)!=''
    ORDER BY occurred_at,created_at,id LIMIT 1`).get(account.id);
  if (!effectiveEvents.length && isValidStage(row?.stage_before)) return row.stage_before;
  const superseded = columns.has('superseded_at') && db.prepare(`SELECT 1 FROM crm_activities
    WHERE customer_id=? AND superseded_at!='' LIMIT 1`).get(account.id);
  if (!effectiveEvents.length && superseded) {
    const error = new Error('无法从现有历史确定客户阶段，需要主管或管理员确认');
    error.code = 'CRM_ACCOUNT_REBUILD_BASELINE_UNCERTAIN';
    error.statusCode = 409;
    throw error;
  }
  if (!effectiveEvents.length && isValidStage(account.stage)) return account.stage;
  return 'new';
}

function manualTerminalFallback(db, account, businessEvents) {
  if (!isFollowUpTerminalStage(account.stage)) return null;
  if (businessEvents.some(event => clean(
    event.kind === 'activity' ? event.row.stage_after : event.stage,
  ) === account.stage)) return null;
  const columns = tableColumns(db, 'crm_activities');
  if (!columns.has('stage_after')) return businessEvents.length ? null : account.stage;
  const matching = db.prepare(`SELECT 1 FROM crm_activities
    WHERE customer_id=? AND stage_after=? LIMIT 1`).get(account.id, account.stage);
  return matching ? null : account.stage;
}

function clearsFollowUp(stage) {
  return ['lost', 'disqualified'].includes(clean(stage));
}

function effectiveSourceSets(activityEventsValue, commerceEventsValue) {
  const activityIds = new Set(activityEventsValue.map(event => clean(event.id)));
  const commerceIds = new Map([
    ['quote', new Set()], ['order', new Set()], ['rfq', new Set()],
  ]);
  for (const event of commerceEventsValue) commerceIds.get(event.kind)?.add(clean(event.id));
  return { activityIds, commerceIds };
}

function validPlanSource(row, sources) {
  const source = clean(row.source);
  const sourceId = clean(row.source_event_id);
  if (!sourceId) return true;
  if (source === 'activity') return sources.activityIds.has(sourceId);
  if (sources.commerceIds.has(source)) return sources.commerceIds.get(source).has(sourceId);
  return true;
}

function planEvents(db, account, nowMs, sources) {
  const ids = customerIds(account);
  const events = [];
  const specs = [
    ['crm_deferred_plan_events', 'deferred'],
    ['crm_next_plan_events', 'explicit'],
  ];
  for (const [table, kind] of specs) {
    const columns = tableColumns(db, table);
    if (!columns.has('customer_id') || !columns.has('created_at')) continue;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${customerWhere(ids)}`).all(...ids);
    for (const row of rows) {
      if (!validPlanSource(row, sources)) continue;
      const event = {
        id: row.id,
        kind,
        occurredAt: row.created_at,
        createdAt: row.created_at,
        nextAction: kind === 'explicit' ? clean(row.next_action) : '',
        nextActionAt: kind === 'explicit' ? clean(row.next_action_at) : '',
      };
      if (isVisibleAt(event, nowMs)) events.push(event);
    }
  }
  return events.sort(compareEvents);
}

function activityManagerChange(state, event) {
  const row = event.row;
  if (Number(row.manager_required)) {
    return { required: true, status: '待介入', managerId: state.managerId };
  }
  if (clean(row.activity_type) === 'manager_join') {
    return {
      required: false,
      status: clean(row.outcome) === '已完成' ? '已完成' : '已介入',
      managerId: clean(row.user_id) || state.managerId,
    };
  }
  return state;
}

function applyPlan(state, event) {
  if (event.kind === 'deferred') return { nextAction: '', nextActionAt: '' };
  return { nextAction: event.nextAction, nextActionAt: event.nextActionAt };
}

function accountError(accountId) {
  const error = new Error('客户不存在');
  error.code = 'CRM_ACCOUNT_REBUILD_NOT_FOUND';
  error.statusCode = 404;
  error.accountId = clean(accountId);
  return error;
}

function rebuildAccountDerivedState(db, accountId, options = {}) {
  const cleanAccountId = clean(accountId);
  const account = hasTable(db, 'crm_accounts')
    ? db.prepare('SELECT * FROM crm_accounts WHERE id=?').get(cleanAccountId)
    : null;
  if (!account) throw accountError(cleanAccountId);
  const nowMs = nowTimestamp(options.now);
  const activities = activityEvents(db, account, nowMs);
  const commerce = commerceEvents(db, account, nowMs);
  const terminal = terminalInterventionEvents(db, account, nowMs);
  const businessEvents = [...activities, ...commerce, ...terminal].sort(compareEvents);
  const baseline = allActivityBaseline(db, account, activities);
  let stage = baseline;
  let managerState = {
    required: false,
    status: '',
    managerId: clean(account.manager_id),
  };
  let nextAction = '';
  let nextActionAt = '';
  let lastActivityAt = '';
  const plans = planEvents(
    db, account, nowMs, effectiveSourceSets(activities, commerce),
  );
  for (const event of [...businessEvents, ...plans].sort(compareEvents)) {
    if (event.kind === 'deferred' || event.kind === 'explicit') {
      if (!clearsFollowUp(stage)) {
        ({ nextAction, nextActionAt } = applyPlan({ nextAction, nextActionAt }, event));
      }
      continue;
    }
    if (event.kind === 'activity') {
      const row = event.row;
      stage = stageAfter(stage, row.stage_after, row.stage_before);
      managerState = activityManagerChange(managerState, event);
      nextAction = clean(row.next_action);
      nextActionAt = clean(row.next_action_at);
      lastActivityAt = clean(event.occurredAt) || lastActivityAt;
    } else {
      stage = stageAfter(stage, event.stage);
      if (event.kind !== 'terminal') {
        lastActivityAt = clean(event.occurredAt) || lastActivityAt;
      }
      if (event.nextAction && event.nextActionAt) {
        nextAction = event.nextAction;
        nextActionAt = event.nextActionAt;
      }
    }
    if (clearsFollowUp(stage)) {
      nextAction = '';
      nextActionAt = '';
      managerState = { ...managerState, required: false, status: '' };
    }
  }
  const fallbackTerminal = manualTerminalFallback(db, account, businessEvents);
  if (fallbackTerminal) stage = fallbackTerminal;
  if (clearsFollowUp(stage)) {
    nextAction = '';
    nextActionAt = '';
    managerState = { ...managerState, required: false, status: '' };
  }
  const result = Object.freeze({
    stage,
    lastActivityAt,
    nextAction,
    nextActionAt,
    managerState: Object.freeze({ ...managerState }),
  });
  const nextBasis = nextAction && nextActionAt ? 'utc' : '';
  const changed = account.stage !== stage
    || clean(account.last_activity_at) !== lastActivityAt
    || clean(account.next_action) !== nextAction
    || clean(account.next_action_at) !== nextActionAt
    || clean(account.next_action_time_basis) !== nextBasis
    || Number(account.manager_required || 0) !== Number(managerState.required)
    || clean(account.manager_status) !== managerState.status
    || clean(account.manager_id) !== managerState.managerId;
  if (changed) {
    const updateColumns = tableColumns(db, 'crm_accounts');
    const assignments = [];
    const params = [];
    for (const [column, value] of [
      ['stage', stage],
      ['last_activity_at', lastActivityAt],
      ['next_action', nextAction],
      ['next_action_at', nextActionAt],
      ['next_action_time_basis', nextBasis],
      ['manager_required', managerState.required ? 1 : 0],
      ['manager_status', managerState.status],
      ['manager_id', managerState.managerId],
    ]) {
      if (!updateColumns.has(column)) continue;
      assignments.push(`${column}=?`);
      params.push(value);
    }
    if (updateColumns.has('updated_at')) {
      assignments.push('updated_at=?');
      params.push(new Date(nowMs).toISOString().slice(0, 19).replace('T', ' '));
    }
    params.push(account.id);
    db.prepare(`UPDATE crm_accounts SET ${assignments.join(',')} WHERE id=?`).run(...params);
  }
  return result;
}

module.exports = {
  rebuildAccountDerivedState,
};

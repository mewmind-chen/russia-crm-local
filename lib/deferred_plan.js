'use strict';

const crypto = require('node:crypto');

const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Shanghai';
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function planError(message, code, statusCode = 400, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.defineProperty(error, 'internalMetadata', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...metadata }),
    writable: false,
  });
  return error;
}

function explicitBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function deferredPlanWritesEnabled(env = process.env) {
  return explicitBoolean(env.CRM_DEFERRED_PLAN_WRITES_ENABLED);
}

function assertDeferredPlanWritesEnabled(env = process.env) {
  if (deferredPlanWritesEnabled(env)) return true;
  throw planError(
    'Deferred plan writes are disabled',
    'DEFERRED_PLAN_WRITES_DISABLED',
    409,
  );
}

function utcText(value) {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function eventTimeText(value) {
  return value.toISOString().replace('T', ' ').replace('Z', '');
}

function nextEventCreatedAt(db, now) {
  const latest = db.prepare(`SELECT MAX(created_at) created_at FROM (
    SELECT created_at FROM crm_deferred_plan_events
    UNION ALL
    SELECT created_at FROM crm_next_plan_events
  )`).get()?.created_at;
  const latestTimestamp = latest
    ? Date.parse(`${String(latest).replace(' ', 'T')}Z`)
    : Number.NaN;
  const timestamp = Number.isFinite(latestTimestamp) && latestTimestamp >= now.getTime()
    ? latestTimestamp + 1
    : now.getTime();
  return eventTimeText(new Date(timestamp));
}

function validDateParts(parts) {
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ));
  return date.getUTCFullYear() === parts.year
    && date.getUTCMonth() + 1 === parts.month
    && date.getUTCDate() === parts.day
    && date.getUTCHours() === parts.hour
    && date.getUTCMinutes() === parts.minute
    && date.getUTCSeconds() === parts.second;
}

function dateTimeFormatter(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch (error) {
    throw planError('业务时区配置无效', 'BUSINESS_TIMEZONE_INVALID', 500, {
      timezone,
      cause: String(error.message || error),
    });
  }
}

function resolveBusinessTimezone(env = process.env) {
  const timezone = String(
    env.CRM_BUSINESS_TIMEZONE === undefined
      ? DEFAULT_BUSINESS_TIMEZONE
      : env.CRM_BUSINESS_TIMEZONE,
  ).trim();
  dateTimeFormatter(timezone);
  return timezone;
}

function zonedParts(formatter, timestamp) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function sameLocalSecond(left, right) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function localDateTimeToUtc(parts, timezone) {
  const formatter = dateTimeFormatter(timezone);
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let candidate = wallClock;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const rendered = zonedParts(formatter, candidate);
    const renderedClock = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
      parts.millisecond,
    );
    const adjusted = candidate + (wallClock - renderedClock);
    if (adjusted === candidate) break;
    candidate = adjusted;
  }
  if (!sameLocalSecond(zonedParts(formatter, candidate), parts)) {
    throw planError('下一步时间格式不正确', 'NEXT_ACTION_AT_INVALID', 400, {
      timezone,
    });
  }
  return new Date(candidate);
}

function parsedNow(value) {
  if (value === undefined || value === null) return new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw planError('当前时间配置无效', 'BUSINESS_NOW_INVALID', 500);
  }
  return date;
}

function parseInputDateTime(input, timezone) {
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) {
      throw planError('下一步时间格式不正确', 'NEXT_ACTION_AT_INVALID');
    }
    return new Date(input.getTime());
  }
  const text = String(input ?? '').trim();
  if (!text) throw planError('下一步时间不能为空', 'NEXT_ACTION_AT_REQUIRED');

  const local = LOCAL_DATE_TIME.exec(text);
  if (local && !EXPLICIT_OFFSET.test(text)) {
    const parts = {
      year: Number(local[1]),
      month: Number(local[2]),
      day: Number(local[3]),
      hour: Number(local[4]),
      minute: Number(local[5]),
      second: Number(local[6] || 0),
      millisecond: Number(String(local[7] || '').padEnd(3, '0') || 0),
    };
    if (!validDateParts(parts)) {
      throw planError('下一步时间格式不正确', 'NEXT_ACTION_AT_INVALID');
    }
    return localDateTimeToUtc(parts, timezone);
  }

  if (!EXPLICIT_OFFSET.test(text)) {
    throw planError('下一步时间格式不正确', 'NEXT_ACTION_AT_INVALID');
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw planError('下一步时间格式不正确', 'NEXT_ACTION_AT_INVALID');
  }
  return new Date(timestamp);
}

function parseBusinessDateTime(input, options = {}) {
  const timezone = options.timezone === undefined
    ? resolveBusinessTimezone()
    : resolveBusinessTimezone({ CRM_BUSINESS_TIMEZONE: options.timezone });
  const date = parseInputDateTime(input, timezone);
  const now = parsedNow(options.now);
  const normalized = utcText(date);
  const normalizedTimestamp = Date.parse(`${normalized.replace(' ', 'T')}Z`);
  if (normalizedTimestamp <= now.getTime()) {
    throw planError(
      '下一步时间必须晚于当前时间',
      'NEXT_ACTION_AT_MUST_BE_FUTURE',
      400,
      { timezone },
    );
  }
  return normalized;
}

function hasTable(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

function tableColumns(db, table) {
  if (!hasTable(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function ensureColumn(db, table, column, definition) {
  if (!tableColumns(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function installDeferredPlanSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_deferred_plan_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      owner_id_snapshot TEXT NOT NULL DEFAULT '',
      review_at TEXT NOT NULL CHECK(length(trim(review_at)) > 0),
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL CHECK(length(trim(source)) > 0),
      source_event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
    );

    CREATE TABLE IF NOT EXISTS crm_next_plan_events (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL CHECK(length(trim(customer_id)) > 0),
      actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) > 0),
      owner_id_snapshot TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL CHECK(length(trim(next_action)) > 0),
      next_action_at TEXT NOT NULL CHECK(length(trim(next_action_at)) > 0),
      source TEXT NOT NULL CHECK(length(trim(source)) > 0),
      source_event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL CHECK(length(trim(created_at)) > 0)
    );
  `);
  ensureColumn(db, 'crm_deferred_plan_events', 'source_event_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_next_plan_events', 'source_event_id', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE INDEX IF NOT EXISTS crm_deferred_plan_events_customer_idx
      ON crm_deferred_plan_events(customer_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_deferred_plan_events_actor_idx
      ON crm_deferred_plan_events(actor_id,created_at DESC,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_deferred_plan_events_source_event_idx
      ON crm_deferred_plan_events(source,source_event_id) WHERE source_event_id!='';
    CREATE INDEX IF NOT EXISTS crm_next_plan_events_customer_idx
      ON crm_next_plan_events(customer_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS crm_next_plan_events_actor_idx
      ON crm_next_plan_events(actor_id,created_at DESC,id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS crm_next_plan_events_source_event_idx
      ON crm_next_plan_events(source,source_event_id) WHERE source_event_id!='';

    CREATE TRIGGER IF NOT EXISTS crm_deferred_plan_events_no_update
      BEFORE UPDATE ON crm_deferred_plan_events
      BEGIN SELECT RAISE(ABORT, 'crm_deferred_plan_events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_deferred_plan_events_no_delete
      BEFORE DELETE ON crm_deferred_plan_events
      BEGIN SELECT RAISE(ABORT, 'crm_deferred_plan_events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_next_plan_events_no_update
      BEFORE UPDATE ON crm_next_plan_events
      BEGIN SELECT RAISE(ABORT, 'crm_next_plan_events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS crm_next_plan_events_no_delete
      BEFORE DELETE ON crm_next_plan_events
      BEGIN SELECT RAISE(ABORT, 'crm_next_plan_events are immutable'); END;
  `);
}

function requiredText(value, field, message, maxLength = 500) {
  const text = String(value ?? '').trim();
  if (!text) throw planError(message, `${field.toUpperCase()}_REQUIRED`);
  if (text.length > maxLength) {
    throw planError(`${message.replace(/不能为空$/, '')}过长`, `${field.toUpperCase()}_TOO_LONG`);
  }
  return text;
}

function eventId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

function deferredEventView(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    type: 'deferred',
    customerId: row.customer_id,
    actorId: row.actor_id,
    ownerIdSnapshot: row.owner_id_snapshot,
    reviewAt: row.review_at,
    reason: row.reason,
    source: row.source,
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
  });
}

function nextPlanEventView(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    type: 'explicit',
    customerId: row.customer_id,
    actorId: row.actor_id,
    ownerIdSnapshot: row.owner_id_snapshot,
    nextAction: row.next_action,
    nextAt: row.next_action_at,
    source: row.source,
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
  });
}

function idempotencyConflict(source, sourceEventId) {
  return planError(
    '来源事件已绑定其他计划记录',
    'PLAN_EVENT_IDEMPOTENCY_CONFLICT',
    409,
    { source, sourceEventId },
  );
}

function findSourceEvent(db, source, sourceEventId) {
  if (!sourceEventId) return null;
  const deferred = db.prepare(`SELECT * FROM crm_deferred_plan_events
    WHERE source=? AND source_event_id=?`).get(source, sourceEventId);
  const explicit = db.prepare(`SELECT * FROM crm_next_plan_events
    WHERE source=? AND source_event_id=?`).get(source, sourceEventId);
  if (deferred && explicit) throw idempotencyConflict(source, sourceEventId);
  if (deferred) return { type: 'deferred', row: deferred };
  if (explicit) return { type: 'explicit', row: explicit };
  return null;
}

function sameDeferredEvent(existing, row) {
  return existing.customer_id === row.customerId
    && existing.actor_id === row.actorId
    && existing.owner_id_snapshot === row.ownerIdSnapshot
    && existing.review_at === row.reviewAt
    && existing.reason === row.reason
    && existing.source === row.source
    && existing.source_event_id === row.sourceEventId;
}

function sameExplicitEvent(existing, row) {
  return existing.customer_id === row.customerId
    && existing.actor_id === row.actorId
    && existing.owner_id_snapshot === row.ownerIdSnapshot
    && existing.next_action === row.nextAction
    && existing.next_action_at === row.nextAt
    && existing.source === row.source
    && existing.source_event_id === row.sourceEventId;
}

function runInWriteTransaction(db, operation) {
  return db.inTransaction ? operation() : db.transaction(operation).immediate();
}

function recordDeferredPlan(db, payload = {}) {
  assertDeferredPlanWritesEnabled(payload.env || process.env);
  installDeferredPlanSchema(db);
  const customerId = requiredText(payload.customerId, 'customer_id', '客户编号不能为空', 120);
  const actorId = requiredText(payload.actorId, 'actor_id', '操作人不能为空', 120);
  const ownerIdSnapshot = String(payload.ownerIdSnapshot ?? '').trim().slice(0, 120);
  const source = requiredText(payload.source || 'manual', 'source', '来源不能为空', 120);
  const sourceEventId = String(payload.sourceEventId ?? '').trim();
  if (sourceEventId.length > 240) {
    throw planError('来源事件编号过长', 'SOURCE_EVENT_ID_TOO_LONG');
  }
  const reason = String(payload.reason ?? '').trim();
  if (reason.length > 2000) throw planError('暂未确定原因过长', 'REASON_TOO_LONG');
  const now = parsedNow(payload.now);
  const reviewAt = parseBusinessDateTime(payload.reviewAt, {
    now,
    timezone: payload.timezone,
  });
  const row = {
    id: String(payload.id || '').trim() || eventId('DPE'),
    customerId,
    actorId,
    ownerIdSnapshot,
    reviewAt,
    reason,
    source,
    sourceEventId,
  };
  return runInWriteTransaction(db, () => {
    const sourceMatch = findSourceEvent(db, row.source, row.sourceEventId);
    if (sourceMatch) {
      if (sourceMatch.type !== 'deferred' || !sameDeferredEvent(sourceMatch.row, row)) {
        throw idempotencyConflict(row.source, row.sourceEventId);
      }
      return deferredEventView(sourceMatch.row);
    }
    const idMatch = db.prepare('SELECT * FROM crm_deferred_plan_events WHERE id=?').get(row.id);
    if (idMatch) {
      if (!sameDeferredEvent(idMatch, row)) {
        throw idempotencyConflict(row.source, row.sourceEventId || row.id);
      }
      return deferredEventView(idMatch);
    }
    row.createdAt = nextEventCreatedAt(db, now);
    db.prepare(`INSERT INTO crm_deferred_plan_events
      (id,customer_id,actor_id,owner_id_snapshot,review_at,reason,source,source_event_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      row.id,
      row.customerId,
      row.actorId,
      row.ownerIdSnapshot,
      row.reviewAt,
      row.reason,
      row.source,
      row.sourceEventId,
      row.createdAt,
    );
    return getDeferredPlanEvent(db, row.id);
  });
}

function recordExplicitPlan(db, payload = {}) {
  assertDeferredPlanWritesEnabled(payload.env || process.env);
  installDeferredPlanSchema(db);
  const customerId = requiredText(payload.customerId, 'customer_id', '客户编号不能为空', 120);
  const actorId = requiredText(payload.actorId, 'actor_id', '操作人不能为空', 120);
  const ownerIdSnapshot = String(payload.ownerIdSnapshot ?? '').trim().slice(0, 120);
  const nextAction = requiredText(payload.nextAction, 'next_action', '下一步计划不能为空', 2000);
  const source = requiredText(payload.source || 'manual', 'source', '来源不能为空', 120);
  const sourceEventId = String(payload.sourceEventId ?? '').trim();
  if (sourceEventId.length > 240) {
    throw planError('来源事件编号过长', 'SOURCE_EVENT_ID_TOO_LONG');
  }
  const now = parsedNow(payload.now);
  const nextAt = parseBusinessDateTime(payload.nextAt, {
    now,
    timezone: payload.timezone,
  });
  const row = {
    id: String(payload.id || '').trim() || eventId('NPE'),
    customerId,
    actorId,
    ownerIdSnapshot,
    nextAction,
    nextAt,
    source,
    sourceEventId,
  };
  return runInWriteTransaction(db, () => {
    const sourceMatch = findSourceEvent(db, row.source, row.sourceEventId);
    if (sourceMatch) {
      if (sourceMatch.type !== 'explicit' || !sameExplicitEvent(sourceMatch.row, row)) {
        throw idempotencyConflict(row.source, row.sourceEventId);
      }
      return nextPlanEventView(sourceMatch.row);
    }
    const idMatch = db.prepare('SELECT * FROM crm_next_plan_events WHERE id=?').get(row.id);
    if (idMatch) {
      if (!sameExplicitEvent(idMatch, row)) {
        throw idempotencyConflict(row.source, row.sourceEventId || row.id);
      }
      return nextPlanEventView(idMatch);
    }
    row.createdAt = nextEventCreatedAt(db, now);
    db.prepare(`INSERT INTO crm_next_plan_events
      (id,customer_id,actor_id,owner_id_snapshot,next_action,next_action_at,source,source_event_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      row.id,
      row.customerId,
      row.actorId,
      row.ownerIdSnapshot,
      row.nextAction,
      row.nextAt,
      row.source,
      row.sourceEventId,
      row.createdAt,
    );
    return getNextPlanEvent(db, row.id);
  });
}

function getDeferredPlanEvent(db, id) {
  if (!hasTable(db, 'crm_deferred_plan_events')) return null;
  return deferredEventView(db.prepare(
    'SELECT * FROM crm_deferred_plan_events WHERE id=?',
  ).get(String(id || '').trim()));
}

function getNextPlanEvent(db, id) {
  if (!hasTable(db, 'crm_next_plan_events')) return null;
  return nextPlanEventView(db.prepare(
    'SELECT * FROM crm_next_plan_events WHERE id=?',
  ).get(String(id || '').trim()));
}

function listDeferredPlanEvents(db, customerId) {
  if (!hasTable(db, 'crm_deferred_plan_events')) return [];
  return db.prepare(`SELECT * FROM crm_deferred_plan_events
    WHERE customer_id=? ORDER BY created_at,id`).all(String(customerId || '').trim())
    .map(deferredEventView);
}

function listNextPlanEvents(db, customerId) {
  if (!hasTable(db, 'crm_next_plan_events')) return [];
  return db.prepare(`SELECT * FROM crm_next_plan_events
    WHERE customer_id=? ORDER BY created_at,id`).all(String(customerId || '').trim())
    .map(nextPlanEventView);
}

function listPlanEvents(db, customerId) {
  return [...listDeferredPlanEvents(db, customerId), ...listNextPlanEvents(db, customerId)]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id));
}

function getCurrentPlanState(db, customerId) {
  const events = listPlanEvents(db, customerId);
  const latest = events.at(-1) || null;
  let consecutiveDeferredCount = 0;
  for (let index = events.length - 1; index >= 0 && events[index].type === 'deferred'; index -= 1) {
    consecutiveDeferredCount += 1;
  }
  return Object.freeze({
    customerId: String(customerId || '').trim(),
    state: latest?.type || 'none',
    latest,
    consecutiveDeferredCount,
    deferredCount: events.filter(event => event.type === 'deferred').length,
    explicitPlanCount: events.filter(event => event.type === 'explicit').length,
  });
}

module.exports = {
  DEFAULT_BUSINESS_TIMEZONE,
  assertDeferredPlanWritesEnabled,
  deferredPlanWritesEnabled,
  getCurrentPlanState,
  getDeferredPlanEvent,
  getNextPlanEvent,
  installDeferredPlanSchema,
  listDeferredPlanEvents,
  listNextPlanEvents,
  listPlanEvents,
  parseBusinessDateTime,
  recordDeferredPlan,
  recordExplicitPlan,
  resolveBusinessTimezone,
};

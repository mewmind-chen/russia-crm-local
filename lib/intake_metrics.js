'use strict';

const { resolveBusinessTimezone } = require('./deferred_plan');

function sqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function formatterFor(timezone) {
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
}

function zonedParts(formatter, at) {
  return Object.fromEntries(formatter.formatToParts(at)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function localPartsToUtc(parts, formatter) {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
  );
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(formatter, new Date(guess));
    const actualValue = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = target - actualValue;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(guess);
}

function businessDayUtcRange(at = new Date(), timezone = 'Asia/Shanghai') {
  const selectedTimezone = resolveBusinessTimezone({ CRM_BUSINESS_TIMEZONE: timezone });
  const instant = at instanceof Date ? new Date(at.getTime()) : new Date(at);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Invalid business-day instant');
  const formatter = formatterFor(selectedTimezone);
  const local = zonedParts(formatter, instant);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day) + 86400000);
  const start = localPartsToUtc({
    year: local.year,
    month: local.month,
    day: local.day,
  }, formatter);
  const end = localPartsToUtc({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  }, formatter);
  return {
    localDate: `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`,
    start: sqlTimestamp(start),
    end: sqlTimestamp(end),
  };
}

function loadIntakeMetrics(db, _user, scope, options = {}) {
  const range = businessDayUtcRange(
    options.now === undefined ? new Date() : options.now,
    options.timezone === undefined ? 'Asia/Shanghai' : options.timezone,
  );
  const baseFilters = Array.isArray(scope?.filters) ? scope.filters : [];
  const baseParams = Array.isArray(scope?.params) ? scope.params : [];
  const count = (extraFilters, extraParams = []) => {
    const filters = [...baseFilters, ...extraFilters];
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return Number(db.prepare(`SELECT COUNT(*) n FROM crm_intake_items i ${where}`)
      .get(...baseParams, ...extraParams).n || 0);
  };
  return {
    assigned: count(["i.status='assigned'"]),
    todayAssigned: count(['i.assigned_at>=?', 'i.assigned_at<?'], [range.start, range.end]),
    todayImported: count(['i.created_at>=?', 'i.created_at<?'], [range.start, range.end]),
    businessDate: range.localDate,
  };
}

module.exports = { businessDayUtcRange, loadIntakeMetrics };

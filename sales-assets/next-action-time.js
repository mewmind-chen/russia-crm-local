(function initTradePulseNextActionTime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TradePulseNextActionTime = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNextActionTime() {
  'use strict';

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  function utcTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return NaN;
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
      ? raw
      : `${raw.replace(' ', 'T')}Z`;
    return Date.parse(normalized);
  }

  function futureLabel(diff) {
    if (diff >= 48 * HOUR) return `还有 ${Math.floor(diff / DAY)} 天`;
    if (diff > DAY) {
      return `还有 1 天 ${Math.floor((diff - DAY) / HOUR)} 小时`;
    }
    if (diff > HOUR) return `还有 ${Math.ceil(diff / HOUR)} 小时`;
    return `还有 ${Math.max(1, Math.ceil(diff / MINUTE))} 分钟`;
  }

  function overdueLabel(elapsed) {
    if (elapsed > DAY) {
      const days = Math.floor(elapsed / DAY);
      const hours = Math.floor((elapsed % DAY) / HOUR);
      return `已超时 ${days} 天${hours ? ` ${hours} 小时` : ''}`;
    }
    if (elapsed > HOUR) return `已超时 ${Math.ceil(elapsed / HOUR)} 小时`;
    return `已超时 ${Math.max(1, Math.ceil(elapsed / MINUTE))} 分钟`;
  }

  function describeNextActionTime(value, basis, nowMs = Date.now()) {
    if (basis !== 'utc') {
      return { state: 'unavailable', label: '', ariaLabel: '' };
    }
    const targetMs = utcTimestamp(value);
    if (!Number.isFinite(targetMs) || !Number.isFinite(Number(nowMs))) {
      return { state: 'unavailable', label: '', ariaLabel: '' };
    }
    const diff = targetMs - Number(nowMs);
    if (diff < 0) {
      const label = overdueLabel(Math.abs(diff));
      return { state: 'overdue', label, ariaLabel: label };
    }
    if (diff === 0) {
      return { state: 'dueSoon', label: '已到计划时间', ariaLabel: '已到计划时间' };
    }
    const state = diff > DAY ? 'normal' : diff > 6 * HOUR ? 'approaching' : 'dueSoon';
    const label = futureLabel(diff);
    return { state, label, ariaLabel: label };
  }

  return Object.freeze({ describeNextActionTime });
}));

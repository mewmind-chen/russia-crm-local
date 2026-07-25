import { visiblePages } from './registry.js';

const STORAGE_PREFIX = 'tradepulse:layout:';

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function storageKey(userId) {
  return `${STORAGE_PREFIX}${String(userId || '')}`;
}

function resolveArgs(userId, context, storage) {
  if (userId && typeof userId === 'object') {
    return {
      userId: userId.userId || userId.id || '',
      context: userId.context || {},
      storage: userId.storage || globalThis.localStorage,
    };
  }
  return { userId, context: context || {}, storage: storage || globalThis.localStorage };
}

export function sanitizeLayoutPreference(preference = {}, context = {}) {
  const allowedPages = visiblePages(context);
  const allowedIds = allowedPages.map(page => page.id);
  const allowedIdSet = new Set(allowedIds);
  const requestedOrder = uniqueStrings(preference.pageOrder || preference.order);
  const pageOrder = [
    ...requestedOrder.filter(id => allowedIdSet.has(id)),
    ...allowedIds.filter(id => !requestedOrder.includes(id)),
  ];
  const requestedDefault = String(preference.defaultPageId || preference.defaultPage || '');
  const defaultPageId = allowedIdSet.has(requestedDefault)
    ? requestedDefault
    : pageOrder[0] || '';
  const allowedGroups = new Set(allowedPages.map(page => page.nav?.group).filter(Boolean));
  const collapsedGroups = uniqueStrings(preference.collapsedGroups)
    .filter(group => allowedGroups.has(group));
  return { defaultPageId, pageOrder, collapsedGroups };
}

export function loadLayoutPreference(userId, context = {}, storage) {
  const args = resolveArgs(userId, context, storage);
  let saved = {};
  try {
    saved = JSON.parse(args.storage?.getItem(storageKey(args.userId)) || '{}');
  } catch (_error) {
    saved = {};
  }
  return sanitizeLayoutPreference(saved, args.context);
}

export function saveLayoutPreference(userId, preference, context = {}, storage) {
  let args;
  let value = preference;
  if (userId && typeof userId === 'object') {
    args = resolveArgs(userId);
    value = userId.preference || userId.value || {};
  } else {
    args = resolveArgs(userId, context, storage);
  }
  const sanitized = sanitizeLayoutPreference(value, args.context);
  try {
    args.storage?.setItem(storageKey(args.userId), JSON.stringify(sanitized));
  } catch (_error) {
    // Storage may be unavailable in private or restricted browser contexts.
  }
  return sanitized;
}

export { STORAGE_PREFIX };

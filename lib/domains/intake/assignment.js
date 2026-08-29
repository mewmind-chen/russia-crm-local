'use strict';

// Manual-intake assignment idempotency, preview, and scope helpers. These are
// pure functions of the actor and payload shape used to deduplicate requests
// and decide whether a preview snapshot must be presented first.

const crypto = require('crypto');

function intakeActionIdempotencyKey(user, payload) {
  const requested = String(payload.idempotencyKey || '').trim();
  if (requested) return requested.slice(0, 240);
  const action = String(payload.action || '').trim();
  const itemId = String(payload.itemId || '').trim();
  const reason = String(payload.reason || '').trim();
  return `intake:${crypto.createHash('sha256')
    .update(`${user.id}:${action}:${itemId}:${reason}`)
    .digest('hex')}`;
}

function manualAssignmentRequestHash(user, payload) {
  const signature = {
    actorId: user.id,
    itemIds: Array.isArray(payload.itemIds) ? payload.itemIds : [],
    filterScope: payload.filterScope || null,
    allFiltered: Boolean(payload.allFiltered),
    ownerId: String(payload.ownerId || ''),
    amount: Number(payload.amount || 0),
    previewToken: String(payload.previewToken || ''),
  };
  return crypto.createHash('sha256').update(JSON.stringify(signature)).digest('hex');
}

function manualAssignmentRequiresPreview(payload = {}) {
  const itemIds = Array.isArray(payload.itemIds)
    ? payload.itemIds.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  if (itemIds.length) return false;
  const filterScope = payload.filterScope && typeof payload.filterScope === 'object'
    ? payload.filterScope
    : {};
  const rawFilters = filterScope.filters && typeof filterScope.filters === 'object'
    && !Array.isArray(filterScope.filters)
    ? filterScope.filters
    : {};
  return Boolean(payload.allFiltered || Object.keys(rawFilters).length);
}

module.exports = Object.freeze({
  intakeActionIdempotencyKey,
  manualAssignmentRequestHash,
  manualAssignmentRequiresPreview,
});
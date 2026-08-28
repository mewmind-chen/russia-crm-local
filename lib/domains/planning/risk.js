'use strict';

// Planning-risk projection helpers. `isEmptyPlanRisk` builds the no-risk
// fallback shape shared by manager metric and recycle risk frames.

function emptyCustomerPlanRisk(task, account) {
  return {
    customerId: String(account.external_customer_id || task.customerId || ''),
    accountId: String(account.id || ''),
    currentOwnerId: String(account.owner_id || ''),
    state: 'none',
    currentConsecutiveDeferredCount: 0,
    cumulativeDeferredCount: 0,
    unplannedDurationDays: 0,
    thresholdAt: '',
    history: [],
  };
}

module.exports = Object.freeze({
  emptyCustomerPlanRisk,
});
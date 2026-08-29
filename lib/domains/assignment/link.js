'use strict';

// Assignment-domain account/intake linkage checks shared by claimed-account
// reuse and returned-customer flows.

function isCurrentIntakeAccount(account, item) {
  return (String(account?.intake_item_id || '').trim() !== ''
      && String(account.intake_item_id) === String(item.id))
    || (String(item?.crm_customer_id || '').trim() !== ''
      && String(item.crm_customer_id) === String(account?.id));
}

function isReturnedAccountForIntake(account, item) {
  if (!account || !isCurrentIntakeAccount(account, item)) return false;
  if (String(account.lifecycle_status || 'active') === 'recycled'
      && String(account.recycle_kind || '') === 'sales_return') return true;
  return String(account.lifecycle_status || 'active') === 'active'
    && String(account.assignment_status || '') === 'returned';
}

function reusableReturnedAccountForIntake(accounts, item) {
  const linked = accounts.find(account => isReturnedAccountForIntake(account, item));
  if (linked) return linked;
  if (String(item.crm_customer_id || '').trim() || !String(item.external_customer_id || '').trim()) {
    return null;
  }
  const externalMatches = accounts.filter(account =>
    String(account.external_customer_id || '') === String(item.external_customer_id));
  if (externalMatches.length !== 1) return null;
  const account = externalMatches[0];
  return String(account.lifecycle_status || 'active') === 'recycled'
    && String(account.recycle_kind || '') === 'sales_return'
    ? account
    : null;
}

module.exports = Object.freeze({
  isCurrentIntakeAccount,
  isReturnedAccountForIntake,
  reusableReturnedAccountForIntake,
});
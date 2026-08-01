'use strict';

const crypto = require('node:crypto');

const OPEN_INTAKE_STATUSES = Object.freeze(['pending', 'approved', 'assigned', 'returned']);
const AUDIT_ACTION = 'intake_crm_invariant_reconciled';

function nowText(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function snapshot(row) {
  return {
    status: row.status || '',
    crmCustomerId: row.crm_customer_id || '',
    suggestedOwnerId: row.suggested_owner_id || '',
    assignedOwnerId: row.assigned_owner_id || '',
    assignedAt: row.assigned_at || '',
    claimDueAt: row.claim_due_at || '',
    claimedAt: row.claimed_at || '',
    decisionReason: row.decision_reason || '',
    returnReason: row.return_reason || '',
    duplicateState: row.duplicate_state || '',
    duplicateReviewId: row.duplicate_review_id || '',
    updatedAt: row.updated_at || '',
  };
}

function listIntakeCrmConflicts(db) {
  const placeholders = OPEN_INTAKE_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`SELECT i.*,a.id crm_account_id,
      a.intake_item_id account_intake_item_id,a.owner_id account_owner_id,
      a.claimed_at account_claimed_at
    FROM crm_intake_items i
    JOIN crm_accounts a ON a.external_customer_id=i.external_customer_id
    WHERE i.status IN (${placeholders})
      AND TRIM(COALESCE(i.external_customer_id,''))!=''
      AND COALESCE(a.lifecycle_status,'active')='active'
      AND a.assignment_status='claimed'
    ORDER BY i.id,a.rowid`).all(...OPEN_INTAKE_STATUSES);

  const selected = new Map();
  for (const row of rows) {
    const current = selected.get(row.id);
    if (!current || (row.account_intake_item_id === row.id
        && current.account_intake_item_id !== current.id)) {
      selected.set(row.id, row);
    }
  }

  return [...selected.values()].map(row => {
    const claimed = row.account_intake_item_id === row.id;
    return {
      intakeItemId: row.id,
      externalCustomerId: row.external_customer_id,
      crmCustomerId: row.crm_account_id,
      accountOwnerId: row.account_owner_id || '',
      accountClaimedAt: row.account_claimed_at || '',
      accountIntakeItemId: row.account_intake_item_id || '',
      resolution: claimed ? 'claimed' : 'duplicate',
      before: snapshot(row),
    };
  }).sort((left, right) => left.resolution.localeCompare(right.resolution)
    || left.intakeItemId.localeCompare(right.intakeItemId));
}

function auditId() {
  return `AUD-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function applyIntakeCrmConflicts(db, conflicts, options = {}) {
  if (!conflicts.length) return [];
  if (!db.inTransaction) throw new Error('Intake CRM reconciliation requires an active transaction');
  const at = options.at || nowText();
  const actorId = options.actorId || 'system';
  const alignClaimedAccount = db.prepare(`UPDATE crm_accounts
    SET owner_id=?,claimed_at=?
    WHERE id=? AND external_customer_id=?
      AND COALESCE(lifecycle_status,'active')='active'
      AND assignment_status='claimed'
      AND intake_item_id=?
      AND COALESCE(owner_id,'')=?
      AND COALESCE(claimed_at,'')=?`);
  const updateClaimed = db.prepare(`UPDATE crm_intake_items
    SET status='claimed',crm_customer_id=?,
      assigned_owner_id=CASE WHEN TRIM(?)!='' THEN ? ELSE assigned_owner_id END,
      claimed_at=?,updated_at=?
    WHERE id=? AND external_customer_id=? AND status=?
      AND EXISTS (
        SELECT 1 FROM crm_accounts a
        WHERE a.id=? AND a.external_customer_id=crm_intake_items.external_customer_id
          AND COALESCE(a.lifecycle_status,'active')='active'
          AND a.assignment_status='claimed'
          AND a.intake_item_id=crm_intake_items.id
          AND COALESCE(a.owner_id,'')=?
          AND COALESCE(a.claimed_at,'')=?
      )`);
  const updateDuplicate = db.prepare(`UPDATE crm_intake_items
    SET status='duplicate',crm_customer_id=?,suggested_owner_id='',assigned_owner_id='',
      assigned_at='',claim_due_at='',claimed_at='',return_reason='',
      duplicate_state='exact',duplicate_review_id='',decision_reason='客户已在CRM',updated_at=?
    WHERE id=? AND external_customer_id=? AND status=?
      AND EXISTS (
        SELECT 1 FROM crm_accounts a
        WHERE a.id=? AND a.external_customer_id=crm_intake_items.external_customer_id
          AND COALESCE(a.lifecycle_status,'active')='active'
          AND a.assignment_status='claimed'
          AND COALESCE(a.intake_item_id,'')!=crm_intake_items.id
          AND COALESCE(a.owner_id,'')=?
          AND COALESCE(a.claimed_at,'')=?
      )`);
  const readAfter = db.prepare('SELECT * FROM crm_intake_items WHERE id=?');
  const insertAudit = db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?)`);

  return conflicts.map(conflict => {
    const update = conflict.resolution === 'claimed' ? updateClaimed : updateDuplicate;
    const accountOwnerId = conflict.resolution === 'claimed'
      ? conflict.accountOwnerId || conflict.before.assignedOwnerId
      : conflict.accountOwnerId;
    const accountClaimedAt = conflict.resolution === 'claimed'
      ? conflict.accountClaimedAt || conflict.before.claimedAt || at
      : conflict.accountClaimedAt;
    if (conflict.resolution === 'claimed') {
      const aligned = alignClaimedAccount.run(
        accountOwnerId,
        accountClaimedAt,
        conflict.crmCustomerId,
        conflict.externalCustomerId,
        conflict.intakeItemId,
        conflict.accountOwnerId,
        conflict.accountClaimedAt,
      );
      if (aligned.changes !== 1) {
        throw new Error(`CRM account changed during reconciliation: ${conflict.crmCustomerId}`);
      }
    }
    const commonConditions = [
      conflict.intakeItemId,
      conflict.externalCustomerId,
      conflict.before.status,
      conflict.crmCustomerId,
      accountOwnerId,
      accountClaimedAt,
    ];
    const result = conflict.resolution === 'claimed'
      ? update.run(
        conflict.crmCustomerId,
        accountOwnerId,
        accountOwnerId,
        accountClaimedAt,
        at,
        ...commonConditions,
      )
      : update.run(conflict.crmCustomerId, at, ...commonConditions);
    if (result.changes !== 1) throw new Error(`Intake conflict changed during reconciliation: ${conflict.intakeItemId}`);
    const after = snapshot(readAfter.get(conflict.intakeItemId));
    insertAudit.run(
      auditId(), actorId, AUDIT_ACTION, 'crm_intake_item', conflict.intakeItemId,
      JSON.stringify({
        externalCustomerId: conflict.externalCustomerId,
        crmCustomerId: conflict.crmCustomerId,
        account: {
          ownerId: accountOwnerId,
          claimedAt: accountClaimedAt,
          beforeOwnerId: conflict.accountOwnerId,
          beforeClaimedAt: conflict.accountClaimedAt,
          intakeItemId: conflict.accountIntakeItemId,
          assignmentStatus: 'claimed',
          lifecycleStatus: 'active',
        },
        resolution: conflict.resolution,
        before: conflict.before,
        after,
      }),
      at,
    );
    return { ...conflict, accountOwnerId, accountClaimedAt, after };
  });
}

function reconcileIntakeCrmInvariant(db, options = {}) {
  const reconcile = () => {
    const conflicts = listIntakeCrmConflicts(db);
    const applied = applyIntakeCrmConflicts(db, conflicts, options);
    const remaining = listIntakeCrmConflicts(db);
    if (remaining.length) {
      throw new Error(`Intake CRM reconciliation left ${remaining.length} conflict(s)`);
    }
    return {
      scannedCount: conflicts.length,
      appliedCount: applied.length,
      remainingConflictCount: remaining.length,
      conflicts: applied,
    };
  };
  return db.inTransaction ? reconcile() : db.transaction(reconcile).immediate();
}

module.exports = {
  AUDIT_ACTION,
  OPEN_INTAKE_STATUSES,
  applyIntakeCrmConflicts,
  listIntakeCrmConflicts,
  reconcileIntakeCrmInvariant,
};

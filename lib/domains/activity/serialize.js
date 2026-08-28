'use strict';

// Public activity row serialization shared by list, bootstrap, and timeline
// routes. The effective-activity predicate comes from the effective-activity
// module (schema-aware), while presentation helpers stay local.

const { legacyProgressKey, scopedActivityProvenance } = require('./present');
const { isEffectiveActivity } = require('../../crm_activity_effective');

function publicActivityRecord(row, visibleActivityIds = new Set()) {
  const {
    superseded_by: _supersededBy,
    provenance: _provenance,
    ...publicRow
  } = row;
  const replacementId = String(row.superseded_by || '');
  const replacementVisible = !replacementId || visibleActivityIds.has(replacementId);
  return {
    ...publicRow,
    externalCustomerId: row.external_customer_id || '',
    progressType: row.progress_key || legacyProgressKey(row.activity_type, row.channel) || '',
    activityType: row.activity_type || '',
    reactionOptionId: row.reaction_option_id || '',
    reactionSnapshot: row.reaction_label_snapshot || row.outcome || '',
    nextAction: row.next_action || '',
    nextActionAt: row.next_action_at || '',
    managerRequired: Boolean(row.manager_required),
    noPlan: Boolean(row.no_plan),
    supersededAt: row.superseded_at || '',
    supersededBy: replacementVisible ? replacementId : '',
    effective: isEffectiveActivity(row),
    provenance: scopedActivityProvenance(row, visibleActivityIds),
  };
}

function publicActivityRecords(rows) {
  const visibleActivityIds = new Set(rows.map(row => String(row.id || '')).filter(Boolean));
  return rows.map(row => publicActivityRecord(row, visibleActivityIds));
}

module.exports = Object.freeze({
  publicActivityRecord,
  publicActivityRecords,
});
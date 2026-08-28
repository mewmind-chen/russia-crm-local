'use strict';

// Planning-domain helpers. Effectivity lookup is injected so this module stays
// free of direct schema access.

const { isEffectiveActivity } = require('../../crm_activity_effective');

function noPlanStreakForActivities(activities) {
  const rows = (Array.isArray(activities) ? activities : [])
    .filter(row => isEffectiveActivity(row) && !Number(row.is_test_data || 0))
    .sort((left, right) =>
      String(right.occurred_at || '').localeCompare(String(left.occurred_at || ''))
      || String(right.id || '').localeCompare(String(left.id || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || ''))
    );
  let count = 0;
  let streakStartId = '';
  for (const row of rows) {
    if (!Number(row.no_plan || row.noPlan || 0)) break;
    count += 1;
    streakStartId = String(row.id || '');
  }
  return { count, streakStartId };
}

module.exports = Object.freeze({
  noPlanStreakForActivities,
});
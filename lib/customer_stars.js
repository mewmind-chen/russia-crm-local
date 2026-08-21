'use strict';

const { hasPermission } = require('./access_control');

function canViewTeamStars(user) {
  return ['admin', 'manager'].includes(String(user?.role || ''))
    && hasPermission(user, 'view_all_customers');
}

function starViewError() {
  const error = new Error('星标范围未获授权');
  error.statusCode = 403;
  error.code = 'FILTER_NOT_AUTHORIZED';
  return error;
}

function normalizeStarView(value, user) {
  const view = String(value || 'all');
  if (!['all', 'mine', 'team'].includes(view)) throw starViewError();
  if (view === 'team' && !canViewTeamStars(user)) throw starViewError();
  return view;
}

function starFilter(view, user, alias = 'a') {
  const normalized = normalizeStarView(view, user);
  if (normalized === 'mine') {
    return {
      sql: `EXISTS (SELECT 1 FROM crm_customer_stars star_filter
        WHERE star_filter.customer_id=${alias}.id AND star_filter.user_id=? AND star_filter.active=1)`,
      params: [String(user?.id || '')],
    };
  }
  if (normalized === 'team') {
    return {
      sql: `EXISTS (SELECT 1 FROM crm_customer_stars star_filter
        WHERE star_filter.customer_id=${alias}.id AND star_filter.active=1)`,
      params: [],
    };
  }
  return { sql: '', params: [] };
}

function attachCustomerStarState(db, user, rows) {
  const customerIds = [...new Set((rows || []).map(row => String(row.id || '')).filter(Boolean))];
  const teamVisible = canViewTeamStars(user);
  const byCustomer = new Map();
  if (customerIds.length) {
    const stars = db.prepare(`SELECT s.customer_id,s.user_id,s.reason,s.starred_at,u.name user_name
      FROM crm_customer_stars s
      LEFT JOIN sales_users u ON u.id=s.user_id
      WHERE s.active=1 AND s.customer_id IN (${customerIds.map(() => '?').join(',')})
      ORDER BY s.starred_at DESC,s.id DESC`).all(...customerIds);
    for (const star of stars) {
      const list = byCustomer.get(star.customer_id) || [];
      list.push({
        userId: star.user_id,
        userName: star.user_name || '在职成员',
        reason: star.reason || '',
        starredAt: star.starred_at || '',
      });
      byCustomer.set(star.customer_id, list);
    }
  }
  return (rows || []).map(row => {
    const allStars = byCustomer.get(String(row.id || '')) || [];
    const myStar = allStars.find(item => item.userId === String(user?.id || '')) || null;
    const visibleStars = teamVisible ? allStars : myStar ? [myStar] : [];
    return {
      ...row,
      myStar,
      isStarred: Boolean(myStar),
      starCount: visibleStars.length,
      starUsers: visibleStars,
      canViewTeamStars: teamVisible,
    };
  });
}

module.exports = {
  attachCustomerStarState,
  canViewTeamStars,
  normalizeStarView,
  starFilter,
};

'use strict';

// Reporting funnel builders. These are pure aggregates over already-loaded
// account/activity/order rows; stage predicates come from customer_stages.

const { hasReachedStage, isActivePipelineStage } = require('../../customer_stages');
const { safeUser } = require('../auth/user');
const { projectNextAction } = require('../lifecycle/state_projection');

function rate(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 1000) / 10 : 0;
}

function buildCountryReport(accounts, activities, orders) {
  const report = {};
  const hasActivity = (customerId, types) => activities.some(row => row.customer_id === customerId && types.includes(row.activity_type));
  for (const account of accounts) {
    const key = account.country || '未标注';
    const item = report[key] ||= { country: key, accounts: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, orders: 0, repeatOrders: 0, revenue: 0, grossProfit: 0 };
    item.accounts += 1;
    if (hasActivity(account.id, ['email', 'call', 'social'])) item.contacted += 1;
    if (hasActivity(account.id, ['reply'])) item.replied += 1;
    if (hasActivity(account.id, ['meeting', 'manager_join'])) item.meetings += 1;
    if (hasActivity(account.id, ['rfq'])) item.rfqs += 1;
    const customerOrders = orders.filter(order => order.customer_id === account.id);
    if (customerOrders.length) item.orders += 1;
    if (customerOrders.some(order => order.is_repeat)) item.repeatOrders += 1;
    item.revenue += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
    item.grossProfit += customerOrders.reduce((sum, order) => sum + Number(order.amount || 0) * Number(order.gross_margin || 0) / 100, 0);
  }
  return Object.values(report).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.accounts),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.replied),
    rfqRate: rate(item.rfqs, item.meetings || item.contacted),
    orderRate: rate(item.orders, item.rfqs),
    repeatRate: rate(item.repeatOrders, item.orders),
    valuePerAccount: Math.round(item.grossProfit / Math.max(1, item.accounts)),
    sampleStatus: item.accounts < 10 ? '样本不足' : '可参考',
  })).sort((a, b) => b.valuePerAccount - a.valuePerAccount || b.orderRate - a.orderRate);
}

function buildCohortReport(accounts, activities, orders) {
  const groups = {};
  for (const account of accounts) {
    const date = String(account.assigned_at || account.created_at || '').slice(0, 7) || '未标注';
    const item = groups[date] ||= { cohort: date, assigned: 0, contacted: 0, replied: 0, meetings: 0, rfqs: 0, ordered: 0, revenue: 0 };
    item.assigned += 1;
    if (hasReachedStage(account.stage, 'contacted')) item.contacted += 1;
    if (hasReachedStage(account.stage, 'replied')) item.replied += 1;
    if (hasReachedStage(account.stage, 'meeting')) item.meetings += 1;
    if (activities.some(row => row.customer_id === account.id && row.activity_type === 'rfq')) item.rfqs += 1;
    const customerOrders = orders.filter(row => row.customer_id === account.id);
    if (customerOrders.length) item.ordered += 1;
    item.revenue += customerOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  }
  return Object.values(groups).sort((a, b) => b.cohort.localeCompare(a.cohort)).map(item => ({
    ...item,
    contactRate: rate(item.contacted, item.assigned),
    replyRate: rate(item.replied, item.contacted),
    meetingRate: rate(item.meetings, item.contacted),
    rfqRate: rate(item.rfqs, item.meetings),
    orderRate: rate(item.ordered, item.rfqs),
  }));
}

function buildTeamReport(users, accounts, activities, rfqs, quotes, orders) {
  return users.filter(user => user.role === 'sales').map(user => {
    const owned = accounts.filter(row => row.owner_id === user.id);
    const customerIds = new Set(owned.map(row => row.id));
    const acts = activities.filter(row => customerIds.has(row.customer_id));
    const userRfqs = rfqs.filter(row => customerIds.has(row.customer_id));
    const userQuotes = quotes.filter(row => customerIds.has(row.customer_id));
    const userOrders = orders.filter(row => customerIds.has(row.customer_id));
    const unique = type => new Set(acts.filter(row => type.includes(row.activity_type)).map(row => row.customer_id)).size;
    const contacted = unique(['email', 'call', 'social']);
    const replied = unique(['reply']);
    const connected = unique(['social']);
    const meetings = unique(['meeting', 'manager_join']);
    const rfqCount = new Set(userRfqs.map(row => row.customer_id)).size;
    const won = new Set(userOrders.map(row => row.customer_id)).size;
    const repeated = new Set(userOrders.filter(row => row.is_repeat).map(row => row.customer_id)).size;
    const activeOwned = owned.filter(row => isActivePipelineStage(row.stage));
    const planStates = activeOwned.map(row => projectNextAction(row));
    const overdue = planStates.filter(item => item.overdue).length;
    const planned = planStates.filter(item => item.planned).length;
    const managerCases = owned.filter(row => row.manager_required).length;
    const managerFollowed = owned.filter(row => row.manager_required && ['rfq', 'quoted', 'negotiating', 'won', 'repeat'].includes(row.stage)).length;
    const rfqComplete = userRfqs.length ? userRfqs.reduce((sum, row) => sum + Number(row.completeness || 0), 0) / userRfqs.length : 0;
    const quoteCoverage = rate(userQuotes.length, userRfqs.length);
    const scores = {
      activation: Math.round(Math.min(100, rate(contacted, owned.length))),
      outreach: Math.round(Math.min(100, (rate(replied, contacted) * 1.7))),
      relationship: Math.round(Math.min(100, (rate(meetings, Math.max(replied, 1)) * 1.2))),
      discovery: Math.round(Math.min(100, (rate(rfqCount, Math.max(meetings, 1)) * 1.2))),
      professional: Math.round(Math.min(100, rfqComplete * 0.7 + quoteCoverage * 0.3)),
      conversion: Math.round(Math.min(100, rate(won, Math.max(rfqCount, 1)) * 1.6)),
      retention: Math.round(Math.min(100, rate(repeated, Math.max(won, 1)) * 2)),
      execution: Math.round(Math.max(0, Math.min(100, rate(planned, Math.max(owned.length, 1)) - rate(overdue, Math.max(owned.length, 1)) * 0.6))),
      collaboration: Math.round(Math.min(100, rate(managerFollowed, Math.max(managerCases, 1)) * 1.2)),
    };
    const overall = Math.round(Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length);
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const countryPerformance = buildCountryReport(owned, acts, userOrders).slice(0, 2);
    const channelCounts = {};
    acts.forEach(activity => { if (activity.channel) channelCounts[activity.channel] = (channelCounts[activity.channel] || 0) + 1; });
    const channelPerformance = Object.entries(channelCounts).map(([channel, actions]) => {
      const touchedIds = new Set(acts.filter(activity => activity.channel === channel).map(activity => activity.customer_id));
      const channelReplies = new Set(acts.filter(activity => touchedIds.has(activity.customer_id) && activity.activity_type === 'reply').map(activity => activity.customer_id)).size;
      const channelRfqs = new Set(userRfqs.filter(rfq => touchedIds.has(rfq.customer_id)).map(rfq => rfq.customer_id)).size;
      return { channel, actions, customers: touchedIds.size, replyRate: rate(channelReplies, touchedIds.size), rfqRate: rate(channelRfqs, touchedIds.size) };
    }).sort((a, b) => b.rfqRate - a.rfqRate || b.replyRate - a.replyRate || b.actions - a.actions);
    const bestChannels = channelPerformance.slice(0, 2).map(item => item.channel);
    return {
      user: safeUser(user), sampleSize: owned.length, sampleStatus: owned.length < 10 ? '样本不足' : '可评估',
      overall, scores, strongest: sorted.slice(0, 2).map(([key]) => key), weakest: sorted.slice(-2).map(([key]) => key),
      metrics: { assigned: owned.length, contacted, replied, connected, meetings, rfqs: rfqCount, quotes: userQuotes.length, orders: won, repeats: repeated, overdue, planned },
      rates: { activation: rate(contacted, owned.length), reply: rate(replied, contacted), meeting: rate(meetings, replied), rfq: rate(rfqCount, meetings), order: rate(won, rfqCount), repeat: rate(repeated, won) },
      bestCountries: countryPerformance.map(row => row.country), bestChannels, channelPerformance,
      revenue: userOrders.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      grossProfit: Math.round(userOrders.reduce((sum, row) => sum + Number(row.amount || 0) * Number(row.gross_margin || 0) / 100, 0)),
    };
  }).sort((a, b) => b.overall - a.overall);
}

module.exports = Object.freeze({
  buildCountryReport,
  buildCohortReport,
  buildTeamReport,
  rate,
});
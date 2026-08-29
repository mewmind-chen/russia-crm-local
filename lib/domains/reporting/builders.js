'use strict';

// Reporting funnel builders. These are pure aggregates over already-loaded
// account/activity/order rows; stage predicates come from customer_stages.

const { hasReachedStage } = require('../../customer_stages');

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

module.exports = Object.freeze({
  buildCountryReport,
  buildCohortReport,
});
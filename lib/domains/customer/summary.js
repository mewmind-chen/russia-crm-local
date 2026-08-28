'use strict';

// Account display helpers shared by history and audit rendering.

const { STAGE_LABELS } = require('../../customer_stages');

function creatorDisplayName(row) {
  if (String(row?.created_by || '') === 'system') return '系统导入';
  if (row?.creator_name) return row.creator_name;
  return '历史数据/未知';
}

function historyAccountSummary(account) {
  return {
    companyName: String(account.company_name || '').trim(),
    nickname: String(account.nickname || '').trim(),
    externalCustomerId: String(account.external_customer_id || ''),
    country: String(account.country || ''),
    stageLabel: STAGE_LABELS[account.stage] || account.stage || '',
    status: account.assignment_status === 'returned'
      ? '已退回线索池'
      : account.lifecycle_status === 'recycled' ? '历史客户' : 'CRM 客户',
  };
}

module.exports = Object.freeze({
  creatorDisplayName,
  historyAccountSummary,
});

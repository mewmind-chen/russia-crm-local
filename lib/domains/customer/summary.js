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
  changedFieldLabels,
});

const ACCOUNT_FIELD_LABELS = Object.freeze({
  nickname: '昵称',
  companyName: '公司名称',
  russianName: '本地名称/别名',
  englishName: '英文名称',
  country: '国家',
  city: '城市',
  website: '官网',
  industry: '行业',
  customerType: '客户类型',
  description: '企业简介',
  productFocus: '产品',
  rating: '评级',
  establishedYear: '成立年份',
  priority: '优先级',
  stage: '阶段',
  ownerId: '负责人',
  source: '来源',
});

function changedFieldLabels(changed, key) {
  const result = {};
  for (const [field, change] of Object.entries(changed || {})) {
    result[ACCOUNT_FIELD_LABELS[field] || field] = key === 'from' ? change.from : change.to;
  }
  return result;
}

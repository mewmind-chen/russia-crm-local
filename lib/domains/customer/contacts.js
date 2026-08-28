'use strict';

// Customer-contact display mapping extracted from sales_crm.js.

const CONTACT_MATCH_STATUS_LABELS = Object.freeze({
  pending: '待确认',
  match: '对口',
  mismatch: '不对口',
});

const CONTACT_PROCUREMENT_ROLE_LABELS = Object.freeze({
  pending: '待确认',
  yes: '负责采购',
  no: '不负责采购',
});

function publicAccountContact(row) {
  return {
    id: `local:${row.id}`,
    rawId: row.id,
    customerId: row.customer_id,
    externalCustomerId: row.external_customer_id || '',
    name: row.name,
    title: row.title,
    department: row.department,
    phone: row.phone,
    email: row.email,
    social: row.social,
    matchStatus: row.match_status,
    matchStatusLabel: CONTACT_MATCH_STATUS_LABELS[row.match_status] || '待确认',
    procurementRole: row.procurement_role,
    procurementRoleLabel: CONTACT_PROCUREMENT_ROLE_LABELS[row.procurement_role] || '待确认',
    workContent: row.work_content,
    source: row.source_type || 'manual',
    sourceLabel: row.source_type === 'recon' ? '联系人研究' : '人工录入',
    createdBy: row.created_by,
    updatedBy: row.updated_by || row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || '',
  };
}

module.exports = Object.freeze({
  CONTACT_MATCH_STATUS_LABELS,
  CONTACT_PROCUREMENT_ROLE_LABELS,
  publicAccountContact,
});
'use strict';

const crypto = require('node:crypto');
const { installAIStationSchema } = require('../schema');
const { normalizeWebsite } = require('./intake');
const { createEnrichmentEvidenceStore } = require('./evidence');

const FIELD_MAP = Object.freeze({
  website: Object.freeze({ pool: 'website', account: 'website' }),
  country: Object.freeze({ pool: 'country', account: 'country' }),
  industry: Object.freeze({ pool: 'industry', account: 'industry' }),
  customer_type: Object.freeze({ pool: 'customer_type', account: 'customer_type' }),
  products: Object.freeze({ pool: 'products', account: 'product_focus' }),
  description: Object.freeze({ pool: 'description', account: '' }),
  rating: Object.freeze({ pool: 'rating', account: 'priority' }),
  current_pool: Object.freeze({ pool: 'current_pool', account: '' }),
});

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? '')).digest('hex');
}

function parse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function mapProposal(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    runId: row.run_id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id,
    fieldName: row.field_name,
    originalValueHash: row.original_value_hash,
    proposedValue: parse(row.proposed_value_json, null),
    proposedValueHash: row.proposed_value_hash,
    evidenceIds: Object.freeze(parse(row.evidence_ids_json, [])),
    confidence: row.confidence,
    state: row.state,
    reasonCode: row.reason_code,
    normalization: Object.freeze(parse(row.normalization_json, {})),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function normalizedValue(fieldName, value) {
  const input = value;
  if (fieldName === 'website') {
    const output = normalizeWebsite(value).replace(/\/$/, '');
    return {
      value: output,
      audit: { input, output, rule: 'canonical_http_url' },
    };
  }
  const output = String(value ?? '').replace(/\s+/g, ' ').trim();
  return {
    value: output,
    audit: { input, output, rule: 'trim_and_collapse_whitespace' },
  };
}

function createEnrichmentProposalStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (prefix => `${prefix}-${crypto.randomUUID()}`);
  const evidenceStore = createEnrichmentEvidenceStore(db, { now });
  const findProposal = db.prepare('SELECT * FROM crm_ai_field_proposals WHERE id=?');

  function timestamp() {
    return new Date(now()).toISOString();
  }

  function run(runId) {
    const selected = db.prepare('SELECT * FROM crm_ai_enrichment_runs WHERE id=?').get(String(runId || ''));
    if (!selected) throw new Error('enrichment run not found');
    return selected;
  }

  function currentValue(selectedRun, fieldName) {
    const mapping = FIELD_MAP[fieldName];
    if (!mapping) throw new Error(`unsupported proposal field: ${fieldName}`);
    const pool = db.prepare(`SELECT ${mapping.pool} value FROM customer_pool WHERE customer_id=?`)
      .get(selectedRun.customer_id);
    return pool?.value ?? '';
  }

  function fieldProvenance(selectedRun, fieldName) {
    return db.prepare(`SELECT * FROM crm_ai_field_provenance
      WHERE customer_id=? AND field_name=? AND source_state='employee_confirmed'
      ORDER BY updated_at DESC LIMIT 1`).get(selectedRun.customer_id, fieldName);
  }

  function applyField(selectedRun, fieldName, value, evidenceId, sourceState, confirmedBy = '') {
    const mapping = FIELD_MAP[fieldName];
    db.prepare(`UPDATE customer_pool SET ${mapping.pool}=? WHERE customer_id=?`)
      .run(value, selectedRun.customer_id);
    if (mapping.account) {
      db.prepare(`UPDATE crm_accounts SET ${mapping.account}=?,updated_at=? WHERE id=?`)
        .run(value, timestamp(), selectedRun.crm_account_id);
    }
    evidenceStore.setFieldProvenance({
      customerId: selectedRun.customer_id,
      crmAccountId: selectedRun.crm_account_id,
      targetType: mapping.account ? 'crm_account' : 'customer_pool',
      targetId: mapping.account ? selectedRun.crm_account_id : selectedRun.customer_id,
      fieldName,
      value,
      sourceState,
      evidenceId: sourceState === 'ai_provisional' ? evidenceId : undefined,
      confirmedBy,
    });
  }

  function propose(input) {
    if (!input || typeof input !== 'object') throw new Error('proposal input is required');
    const selectedRun = run(input.runId);
    const fieldName = String(input.fieldName || '').trim();
    if (!FIELD_MAP[fieldName]) throw new Error(`unsupported proposal field: ${fieldName}`);
    const normalized = normalizedValue(fieldName, input.proposedValue);
    if (!normalized.value) throw new Error('proposedValue is required');
    const confidence = Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new Error('confidence must be between 0 and 1');
    }
    const evidenceIds = [...new Set((input.evidenceIds || []).map(String))].sort();
    if (!evidenceIds.length) throw new Error('evidenceIds are required');
    for (const evidenceId of evidenceIds) {
      const evidence = evidenceStore.getEvidence(evidenceId);
      if (!evidence || evidence.customerId !== selectedRun.customer_id || evidence.runId !== selectedRun.id) {
        throw new Error('proposal evidence does not match enrichment run');
      }
    }
    const proposedHash = sha256(normalized.value);
    const existing = db.prepare(`SELECT * FROM crm_ai_field_proposals
      WHERE run_id=? AND field_name=? AND proposed_value_hash=?`).get(
      selectedRun.id, fieldName, proposedHash,
    );
    if (existing) return mapProposal(existing);
    const originalValue = currentValue(selectedRun, fieldName);
    const protectedField = fieldProvenance(selectedRun, fieldName);
    const reliableConflict = db.prepare(`SELECT 1 found FROM crm_ai_field_proposals
      WHERE run_id=? AND field_name=? AND proposed_value_hash!=? AND confidence>=0.75
      LIMIT 1`).get(selectedRun.id, fieldName, proposedHash);
    let state = 'needs_review';
    let reasonCode = originalValue ? 'existing_value' : '';
    if (protectedField) reasonCode = 'employee_confirmed_protected';
    else if (reliableConflict && confidence >= 0.75) reasonCode = 'reliable_source_conflict';
    else if (!originalValue) state = 'auto_applied';
    else if (String(originalValue) === String(normalized.value)) state = 'auto_applied';
    const at = timestamp();
    const id = String(idFactory('AIPR') || '').trim();
    if (!id) throw new Error('proposal id is required');
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO crm_ai_field_proposals
        (id,run_id,customer_id,crm_account_id,field_name,original_value_hash,proposed_value_json,
         proposed_value_hash,evidence_ids_json,confidence,state,reason_code,normalization_json,
         created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, selectedRun.id, selectedRun.customer_id, selectedRun.crm_account_id, fieldName,
        sha256(originalValue), JSON.stringify(normalized.value), proposedHash,
        JSON.stringify(evidenceIds), confidence, state, reasonCode,
        JSON.stringify(normalized.audit), at, at,
      );
      if (state === 'auto_applied' && String(originalValue) !== String(normalized.value)) {
        applyField(selectedRun, fieldName, normalized.value, evidenceIds[0], 'ai_provisional');
      }
    });
    transaction.immediate();
    return mapProposal(findProposal.get(id));
  }

  function review(proposalId, input) {
    const id = String(proposalId || '').trim();
    const decision = String(input?.decision || '').trim();
    const reviewerId = String(input?.reviewerId || '').trim();
    if (!['accepted', 'rejected'].includes(decision)) throw new Error('invalid proposal decision');
    if (!reviewerId) throw new Error('reviewerId is required');
    const transaction = db.transaction(() => {
      const row = findProposal.get(id);
      if (!row) throw new Error('proposal not found');
      if (row.state !== 'needs_review') return mapProposal(row);
      const selectedRun = run(row.run_id);
      const at = timestamp();
      if (decision === 'rejected') {
        db.prepare(`UPDATE crm_ai_field_proposals
          SET state='rejected',reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND state='needs_review'`)
          .run(reviewerId, at, at, id);
        return mapProposal(findProposal.get(id));
      }
      if (sha256(currentValue(selectedRun, row.field_name)) !== row.original_value_hash) {
        db.prepare(`UPDATE crm_ai_field_proposals
          SET state='superseded',reason_code='context_changed',reviewed_by=?,reviewed_at=?,updated_at=?
          WHERE id=? AND state='needs_review'`).run(reviewerId, at, at, id);
        return mapProposal(findProposal.get(id));
      }
      applyField(
        selectedRun,
        row.field_name,
        parse(row.proposed_value_json, ''),
        '',
        'employee_confirmed',
        reviewerId,
      );
      db.prepare(`UPDATE crm_ai_field_proposals
        SET state='accepted',reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=? AND state='needs_review'`)
        .run(reviewerId, at, at, id);
      return mapProposal(findProposal.get(id));
    });
    return transaction.immediate();
  }

  function listForRun(runId) {
    return db.prepare(`SELECT * FROM crm_ai_field_proposals
      WHERE run_id=? ORDER BY created_at,id`).all(String(runId || '')).map(mapProposal);
  }

  function finalize(runId) {
    const selectedRun = run(runId);
    const customer = db.prepare(`SELECT company_name,website,country,industry,customer_type,
      products,description,best_contact_level,current_pool FROM customer_pool WHERE customer_id=?`)
      .get(selectedRun.customer_id);
    if (!customer) throw new Error('enrichment customer not found');
    const required = {
      company_name: customer.company_name,
      website: customer.website,
      country: customer.country,
      industry: customer.industry,
      customer_type: customer.customer_type,
      products: customer.products,
      description: customer.description,
      contact: customer.best_contact_level && customer.best_contact_level !== 'L0',
    };
    const missingItems = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
    const completeness = Math.round(((Object.keys(required).length - missingItems.length)
      / Object.keys(required).length) * 100);
    const pendingReview = db.prepare(`SELECT COUNT(*) count FROM crm_ai_field_proposals
      WHERE run_id=? AND state='needs_review'`).get(selectedRun.id).count;
    const routeState = pendingReview ? 'needs_review'
      : missingItems.length ? 'missing_info' : 'pending_assignment';
    const tags = [...new Set([
      customer.customer_type,
      customer.industry,
      customer.current_pool && customer.current_pool !== '未分池' ? `${customer.current_pool}池` : '',
      customer.best_contact_level && customer.best_contact_level !== 'L0'
        ? `联系人${customer.best_contact_level}` : '',
    ].filter(Boolean))];
    const state = routeState === 'needs_review' ? 'needs_review' : 'succeeded';
    const at = timestamp();
    db.prepare(`UPDATE crm_ai_enrichment_runs SET state=?,route_state=?,reason_code=?,
      completeness=?,missing_items_json=?,tags_json=?,updated_at=?,finished_at=?
      WHERE id=?`).run(
      state, routeState, routeState === 'pending_assignment' ? '' : routeState,
      completeness, JSON.stringify(missingItems), JSON.stringify(tags), at, at, selectedRun.id,
    );
    return Object.freeze({
      runId: selectedRun.id,
      state,
      routeState,
      completeness,
      missingItems: Object.freeze(missingItems),
      tags: Object.freeze(tags),
    });
  }

  return Object.freeze({
    propose,
    review,
    listForRun,
    finalize,
    get: id => mapProposal(findProposal.get(String(id || ''))),
  });
}

module.exports = { createEnrichmentProposalStore };

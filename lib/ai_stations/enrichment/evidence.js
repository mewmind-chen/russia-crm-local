'use strict';

const crypto = require('node:crypto');
const { installAIStationSchema } = require('../schema');
const { normalizeWebsite } = require('./intake');

function required(value, name) {
  const selected = String(value || '').trim();
  if (!selected) throw new Error(`${name} is required`);
  return selected;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function timestamp(value, name) {
  const selected = required(value, name);
  const date = new Date(selected);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function confidence(value) {
  const selected = Number(value);
  if (!Number.isFinite(selected) || selected < 0 || selected > 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  return selected;
}

function contentHash(input) {
  if (input.content !== undefined) return sha256(input.content);
  const selected = required(input.contentHash, 'contentHash').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(selected)) throw new Error('contentHash must be SHA-256');
  return selected;
}

function safeSummary(value, contactSensitive) {
  let summary = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!contactSensitive) return summary;
  summary = summary
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted-phone]');
  return summary;
}

function canonicalEvidenceId(input) {
  const digest = sha256([
    required(input.customerId, 'customerId'),
    required(input.sourceUrl, 'sourceUrl'),
    required(input.contentHash, 'contentHash'),
    required(input.collector, 'collector'),
    required(input.collectorVersion, 'collectorVersion'),
  ].join('\n'));
  return `AIE-${digest}`;
}

function mapEvidence(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    runId: row.run_id,
    nodeKey: row.node_key,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    collectedAt: row.collected_at,
    summary: row.summary,
    contentHash: row.content_hash,
    confidence: row.confidence,
    collector: row.collector,
    collectorVersion: row.collector_version,
    contactSensitive: Boolean(row.contact_sensitive),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  });
}

function mapProvenance(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    crmAccountId: row.crm_account_id,
    targetType: row.target_type,
    targetId: row.target_id,
    fieldName: row.field_name,
    valueHash: row.value_hash,
    sourceState: row.source_state,
    evidenceId: row.evidence_id || null,
    confirmedBy: row.confirmed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createEnrichmentEvidenceStore(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  installAIStationSchema(db);
  const now = options.now || (() => new Date());
  const findEvidence = db.prepare('SELECT * FROM crm_ai_enrichment_evidence WHERE id=?');
  const findProvenance = db.prepare(`SELECT * FROM crm_ai_field_provenance
    WHERE target_type=? AND target_id=? AND field_name=?`);

  function nowIso() {
    return new Date(now()).toISOString();
  }

  function recordEvidence(input) {
    if (!input || typeof input !== 'object') throw new Error('evidence input is required');
    const values = {
      customerId: required(input.customerId, 'customerId'),
      runId: required(input.runId, 'runId'),
      nodeKey: required(input.nodeKey, 'nodeKey'),
      sourceUrl: normalizeWebsite(required(input.sourceUrl, 'sourceUrl')),
      sourceType: required(input.sourceType, 'sourceType'),
      collectedAt: timestamp(input.collectedAt, 'collectedAt'),
      contentHash: contentHash(input),
      confidence: confidence(input.confidence),
      collector: required(input.collector, 'collector'),
      collectorVersion: required(input.collectorVersion, 'collectorVersion'),
      contactSensitive: Boolean(input.contactSensitive),
    };
    const id = canonicalEvidenceId(values);
    const key = String(input.idempotencyKey || id);
    const summary = safeSummary(input.summary, values.contactSensitive);
    const existing = findEvidence.get(id);
    if (existing) {
      if (existing.run_id !== values.runId || existing.node_key !== values.nodeKey
          || existing.source_type !== values.sourceType || existing.collected_at !== values.collectedAt
          || existing.summary !== summary || existing.confidence !== values.confidence
          || Boolean(existing.contact_sensitive) !== values.contactSensitive) {
        throw new Error('enrichment evidence collision');
      }
      return mapEvidence(existing);
    }
    db.prepare(`INSERT INTO crm_ai_enrichment_evidence
      (id,customer_id,run_id,node_key,source_url,source_type,collected_at,summary,content_hash,
       confidence,collector,collector_version,contact_sensitive,idempotency_key,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, values.customerId, values.runId, values.nodeKey, values.sourceUrl, values.sourceType,
      values.collectedAt, summary, values.contentHash, values.confidence, values.collector,
      values.collectorVersion, values.contactSensitive ? 1 : 0, key, nowIso(),
    );
    return mapEvidence(findEvidence.get(id));
  }

  function setFieldProvenance(input) {
    if (!input || typeof input !== 'object') throw new Error('field provenance input is required');
    const targetType = required(input.targetType, 'targetType');
    if (!['customer_pool', 'crm_account'].includes(targetType)) throw new Error('invalid targetType');
    const sourceState = required(input.sourceState, 'sourceState');
    if (!['employee_confirmed', 'ai_provisional'].includes(sourceState)) throw new Error('invalid sourceState');
    const values = {
      customerId: required(input.customerId, 'customerId'),
      crmAccountId: required(input.crmAccountId, 'crmAccountId'),
      targetType,
      targetId: required(input.targetId, 'targetId'),
      fieldName: required(input.fieldName, 'fieldName'),
      valueHash: sha256(input.value),
      sourceState,
      evidenceId: input.evidenceId ? required(input.evidenceId, 'evidenceId') : null,
      confirmedBy: String(input.confirmedBy || '').trim(),
    };
    if (sourceState === 'ai_provisional') {
      if (!values.evidenceId) throw new Error('ai_provisional field requires evidence');
      const evidence = findEvidence.get(values.evidenceId);
      if (!evidence || evidence.customer_id !== values.customerId) {
        throw new Error('field evidence does not match customer');
      }
      values.confirmedBy = '';
    } else {
      if (!values.confirmedBy) throw new Error('employee_confirmed field requires confirmedBy');
      values.evidenceId = null;
    }
    const existing = findProvenance.get(values.targetType, values.targetId, values.fieldName);
    if (existing?.source_state === 'employee_confirmed' && sourceState === 'ai_provisional') {
      throw new Error('employee-confirmed field cannot be overwritten by AI');
    }
    const at = nowIso();
    const id = existing?.id || `AIP-${sha256(`${values.targetType}\n${values.targetId}\n${values.fieldName}`)}`;
    db.prepare(`INSERT INTO crm_ai_field_provenance
      (id,customer_id,crm_account_id,target_type,target_id,field_name,value_hash,source_state,
       evidence_id,confirmed_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(target_type,target_id,field_name) DO UPDATE SET
        customer_id=excluded.customer_id,crm_account_id=excluded.crm_account_id,
        value_hash=excluded.value_hash,source_state=excluded.source_state,evidence_id=excluded.evidence_id,
        confirmed_by=excluded.confirmed_by,updated_at=excluded.updated_at`).run(
      id, values.customerId, values.crmAccountId, values.targetType, values.targetId,
      values.fieldName, values.valueHash, values.sourceState, values.evidenceId,
      values.confirmedBy, at, at,
    );
    return mapProvenance(findProvenance.get(values.targetType, values.targetId, values.fieldName));
  }

  return Object.freeze({
    recordEvidence,
    getEvidence: id => mapEvidence(findEvidence.get(required(id, 'evidenceId'))),
    setFieldProvenance,
    getFieldProvenance: (targetType, targetId, fieldName) =>
      mapProvenance(findProvenance.get(
        required(targetType, 'targetType'),
        required(targetId, 'targetId'),
        required(fieldName, 'fieldName'),
      )),
  });
}

module.exports = {
  canonicalEvidenceId,
  createEnrichmentEvidenceStore,
  safeSummary,
};

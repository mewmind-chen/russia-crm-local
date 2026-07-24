'use strict';

const crypto = require('node:crypto');
const { domainToASCII } = require('node:url');
const { createCustomerEnrichmentStore } = require('./store');

const REQUIRED_PERMISSIONS = Object.freeze([
  'view_customers',
  'use_ai_assistant',
  'run_recon',
  'view_recon',
  'view_contacts',
]);

function normalizeWebsite(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch (_error) {
    throw new Error('请输入有效的 HTTP(S) 官网');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('官网必须使用 HTTP(S)');
  const hostname = domainToASCII(parsed.hostname.toLowerCase());
  if (!hostname) throw new Error('请输入有效的 HTTP(S) 官网');
  parsed.username = '';
  parsed.password = '';
  parsed.hostname = hostname;
  parsed.hash = '';
  if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
    parsed.port = '';
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|gclid$|fbclid$|yclid$)/i.test(key)) parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

function normalizeMinimalCustomerInput(payload = {}) {
  const website = normalizeWebsite(payload.website);
  const enteredName = String(payload.companyName || '').trim();
  if (!enteredName && !website) throw new Error('请输入公司名称或官网');
  return Object.freeze({
    companyName: enteredName || new URL(website).hostname,
    website,
    provisionalCompanyName: !enteredName,
  });
}

function evaluateEnrichmentStartGate(actor, flags, permissionCheck) {
  if (!flags?.enabled || !flags?.autoTriggerEnabled) {
    return Object.freeze({ eligible: false, reasonCode: 'feature_disabled' });
  }
  const allowed = typeof permissionCheck === 'function'
    ? permission => permissionCheck(actor, permission)
    : permission => Boolean(actor?.permissions?.[permission]);
  const missingPermissions = REQUIRED_PERMISSIONS.filter(permission => !allowed(permission));
  if (missingPermissions.length) {
    return Object.freeze({ eligible: false, reasonCode: 'missing_permissions', missingPermissions });
  }
  return Object.freeze({ eligible: true, reasonCode: '', missingPermissions: [] });
}

function inputFingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify({
    companyName: input.companyName,
    website: input.website,
    country: String(input.country || '').trim(),
  })).digest('hex');
}

function createEnrichmentTrigger(db, actor, account, input, options = {}) {
  const gate = evaluateEnrichmentStartGate(actor, options.flags, options.permissionCheck);
  const store = createCustomerEnrichmentStore(db, options.storeOptions);
  let run = store.createTrigger({
    customerId: account.externalCustomerId,
    crmAccountId: account.customerId,
    triggerSource: options.triggerSource || 'manual_create',
    triggeredBy: actor.id,
    inputFingerprint: inputFingerprint(input),
    pipelineVersion: options.pipelineVersion || 'v1',
  });
  if (!gate.eligible && run.state === 'pending_dispatch') run = store.markSkipped(run.id, gate.reasonCode);
  return Object.freeze({ runId: run.id, state: run.state, reasonCode: run.reasonCode });
}

module.exports = {
  REQUIRED_PERMISSIONS,
  normalizeWebsite,
  normalizeMinimalCustomerInput,
  evaluateEnrichmentStartGate,
  inputFingerprint,
  createEnrichmentTrigger,
};

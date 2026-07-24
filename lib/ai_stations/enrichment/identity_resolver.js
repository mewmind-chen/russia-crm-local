'use strict';

const crypto = require('node:crypto');
const { isIP } = require('node:net');
const { normalizeWebsite } = require('./intake');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isPublicHttpUrl(website) {
  let parsed;
  try {
    parsed = new URL(website);
  } catch (_error) {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return !isPrivateIpv4(hostname);
  // Stay conservative without a DNS/network policy layer: explicit IPv6 literals,
  // including compressed IPv4-mapped forms, do not enter the deterministic path.
  if (ipVersion === 6) return false;
  if (!hostname.includes('.') || hostname.endsWith('.')) return false;
  return !['localhost', 'local', 'internal', 'home', 'lan', 'test', 'example', 'invalid']
    .some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function resolveExplicitWebsiteIdentity(input = {}, options = {}) {
  let website;
  try {
    const raw = String(input.website || '').trim();
    if (!raw) return null;
    const parsedRaw = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsedRaw.username || parsedRaw.password) return null;
    website = normalizeWebsite(raw);
  } catch (_error) {
    return null;
  }
  if (!isPublicHttpUrl(website) || !options.db || typeof options.db.prepare !== 'function') return null;
  const provenance = options.db.prepare(`SELECT value_hash,source_state,confirmed_by
    FROM crm_ai_field_provenance
    WHERE customer_id=? AND crm_account_id=? AND target_type='crm_account'
      AND target_id=? AND field_name='website'`).get(
    String(input.customerId || ''),
    String(input.crmAccountId || ''),
    String(input.crmAccountId || ''),
  );
  if (!provenance
      || provenance.source_state !== 'employee_confirmed'
      || !String(provenance.confirmed_by || '').trim()
      || provenance.value_hash !== sha256(website)) {
    return null;
  }
  const collectedAt = (options.now ? options.now() : new Date()).toISOString();
  const companyName = String(input.companyName || '').trim();
  const country = String(input.country || '').trim();
  return Object.freeze({
    officialWebsite: website,
    country,
    confidence: 1,
    risk: Object.freeze({ blocked: false }),
    sources: Object.freeze([Object.freeze({
      url: website,
      type: 'employee_confirmed_website',
      collectedAt,
      summary: 'Employee-confirmed website supplied during CRM customer intake.',
      content: JSON.stringify({ companyName, website, country }),
      confidence: 1,
    })]),
  });
}

module.exports = {
  isPublicHttpUrl,
  resolveExplicitWebsiteIdentity,
};

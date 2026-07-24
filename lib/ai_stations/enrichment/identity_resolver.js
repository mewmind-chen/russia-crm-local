'use strict';

const { normalizeWebsite } = require('./intake');

function resolveExplicitWebsiteIdentity(input = {}, options = {}) {
  const website = normalizeWebsite(input.website);
  if (!website) return null;
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

module.exports = { resolveExplicitWebsiteIdentity };

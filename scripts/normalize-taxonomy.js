#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { normalizeCustomerType, normalizeIndustry } = require('../lib/taxonomy');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function contextFor(row) {
  return [
    row.customer_type,
    row.industry,
    row.description,
    row.products,
    row.reason,
    row.notes,
    row.company_name,
    row.russian_name,
    row.english_name,
    row.domain,
    row.website,
    row.risk_status,
  ].join(' ');
}

function normalizeTable(db, table, idColumn) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const update = db.prepare(`UPDATE ${table} SET customer_type = ?, industry = ? WHERE ${idColumn} = ?`);
  let changedType = 0;
  let changedIndustry = 0;

  const apply = db.transaction(() => {
    rows.forEach(row => {
      const context = contextFor(row);
      const nextType = normalizeCustomerType(row.customer_type, context);
      const nextIndustry = normalizeIndustry(row.industry, context);
      if (nextType !== row.customer_type || nextIndustry !== row.industry) {
        update.run(nextType, nextIndustry, row[idColumn]);
        if (nextType !== row.customer_type) changedType++;
        if (nextIndustry !== row.industry) changedIndustry++;
      }
    });
  });
  apply();

  return { rows: rows.length, changedType, changedIndustry };
}

function normalizeReconResults(db) {
  const rows = db.prepare(`
    SELECT r.*, p.industry AS pool_industry, p.city AS pool_city, p.phone AS pool_phone,
           p.email AS pool_email, p.inn AS pool_inn, p.rating AS pool_rating,
           p.description AS pool_description, p.current_pool AS pool_current_pool,
           p.risk_status AS pool_risk_status, p.website_verification AS pool_website_verification,
           p.verified AS pool_verified, p.contact_count AS pool_contact_count
    FROM recon_results r
    LEFT JOIN customer_pool p ON p.customer_id = r.customer_id
  `).all();
  const update = db.prepare(`
    UPDATE recon_results SET
      customer_type = ?, industry = ?, city = ?, phone = ?, email = ?, inn = ?,
      rating = ?, description = ?, current_pool = ?, risk_status = ?,
      website_verification = ?, verified = ?, contact_count = ?, opportunity_summary = ?
    WHERE job_id = ?
  `);
  let changedType = 0;
  let enriched = 0;
  const noisySummary = text => {
    const clean = String(text || '').trim();
    return !clean
      || /now i have|let me compile|compile (the )?(final|complete) report|已有足够数据|开始编译|开始整理完整报告/i.test(clean)
      || /^[^|]{1,80}\s*\|\s*(https?:\/\/|[\w.-]+\.[a-z]{2,})\s*\|\s*评分/i.test(clean);
  };
  const apply = db.transaction(() => {
    rows.forEach(row => {
      const nextType = normalizeCustomerType(row.customer_type, [
        row.opportunity_summary,
        row.recommended_products,
        row.outreach_angle,
      ].join(' '));
      const nextIndustry = row.industry || row.pool_industry || '';
      const nextCity = row.city || row.pool_city || '';
      const nextPhone = row.phone || row.pool_phone || '';
      const nextEmail = row.email || row.pool_email || '';
      const nextInn = row.inn || row.pool_inn || '';
      const nextRating = row.rating || '';
      const nextDescription = row.description || row.pool_description || '';
      const nextCurrentPool = row.current_pool || '';
      const nextRiskStatus = row.risk_status || row.pool_risk_status || '';
      const nextWebsiteVerification = row.website_verification || row.pool_website_verification || '';
      const nextVerified = row.verified || row.pool_verified || '';
      const nextContactCount = row.contact_count || row.pool_contact_count || '';
      const nextSummary = noisySummary(row.opportunity_summary)
        ? (row.outreach_angle || row.next_action || row.recommended_products || nextDescription || '')
        : row.opportunity_summary;
      const changed = nextType !== row.customer_type
        || nextIndustry !== row.industry
        || nextCity !== row.city
        || nextPhone !== row.phone
        || nextEmail !== row.email
        || nextInn !== row.inn
        || nextRating !== row.rating
        || nextDescription !== row.description
        || nextCurrentPool !== row.current_pool
        || nextRiskStatus !== row.risk_status
        || nextWebsiteVerification !== row.website_verification
        || nextVerified !== row.verified
        || nextContactCount !== row.contact_count
        || nextSummary !== row.opportunity_summary;
      if (changed) {
        update.run(
          nextType, nextIndustry, nextCity, nextPhone, nextEmail, nextInn,
          nextRating, nextDescription, nextCurrentPool, nextRiskStatus,
          nextWebsiteVerification, nextVerified, nextContactCount, nextSummary,
          row.job_id,
        );
        if (nextType !== row.customer_type) changedType++;
        enriched++;
      }
    });
  });
  apply();
  return { rows: rows.length, changedType, enriched };
}

function syncFollowupTaxonomyFromPool(db) {
  const rows = db.prepare(`
    SELECT c.follow_id, c.customer_type, c.industry,
           p.customer_type AS pool_customer_type,
           p.industry AS pool_industry
    FROM customers c
    JOIN customer_pool p ON p.customer_id = c.customer_id
    WHERE c.customer_id != ''
  `).all();
  const update = db.prepare('UPDATE customers SET customer_type = ?, industry = ? WHERE follow_id = ?');
  let changedType = 0;
  let changedIndustry = 0;
  const apply = db.transaction(() => {
    rows.forEach(row => {
      const nextType = row.pool_customer_type || row.customer_type || '';
      const nextIndustry = row.pool_industry || row.industry || '';
      if (nextType !== row.customer_type || nextIndustry !== row.industry) {
        update.run(nextType, nextIndustry, row.follow_id);
        if (nextType !== row.customer_type) changedType++;
        if (nextIndustry !== row.industry) changedIndustry++;
      }
    });
  });
  apply();
  return { rows: rows.length, changedType, changedIndustry };
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`找不到数据库：${DB_PATH}`);
  }

  const backupPath = path.join(path.dirname(DB_PATH), `crm.db.bak-${stamp()}-before-taxonomy-normalize`);
  require('../lib/db').ensureTables();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.prepare('VACUUM INTO ?').run(backupPath);

  const pool = normalizeTable(db, 'customer_pool', 'customer_id');
  const customers = normalizeTable(db, 'customers', 'follow_id');
  const followupSync = syncFollowupTaxonomyFromPool(db);
  const recon = normalizeReconResults(db);

  db.close();
  const { refreshAutoTags } = require('../lib/db');
  const autoTagsInserted = refreshAutoTags();

  console.log(JSON.stringify({
    ok: true,
    backupPath,
    customerPool: pool,
    customers,
    followupSync,
    reconResults: recon,
    autoTagsInserted,
  }, null, 2));
}

main();

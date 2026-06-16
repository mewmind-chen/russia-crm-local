#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');

const NOISY_RE = /now i have|let me compile|compile (the )?(final|complete) report|I have sufficient|Let me now|已有足够数据|开始编译|开始整理完整报告|现在我将|下面是.*完整侦查报告|尽调报告$/i;

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clean(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^华强北\s*/, '')
    .replace(/华强北可供应/g, '可提供')
    .replace(/华强北可提供/g, '可提供')
    .replace(/华强北现货渠道/g, '现货渠道')
    .replace(/华强北全球品牌元器件/g, '全球品牌元器件')
    .replace(/华强北电子元器件供应链/g, '电子元器件供应链')
    .replace(/华强北全球供应链/g, '全球供应链')
    .replace(/华强北替代渠道/g, '替代渠道')
    .replace(/华强北货源/g, '货源')
    .replace(/华强北/g, '')
    .replace(/合规风险，谨慎评估/g, '制裁驱动机会，确认合规路径')
    .replace(/合规风险/g, '合规路径')
    .replace(/制裁风险/g, '制裁机会信号')
    .replace(/不建议直接接触该实体/g, '建议先确认合规路径与替代采购切入点')
    .replace(/不建议直接接触/g, '建议先确认合规路径')
    .replace(/直接交易需合规评估/g, '可围绕替代采购需求确认合规路径')
    .replace(/\s+/g, ' ');
}

function isNoisy(value) {
  const text = clean(value);
  return !text || NOISY_RE.test(text);
}

function demandOnly(value) {
  let text = clean(value);
  if (!text || isNoisy(text)) return '';
  text = text.split(/可提供|我们可|我们能|我们有|我方可|我方能|我方有|我司可|可供应|供应能力|供应方案|切入点[：:]|推荐/)[0];
  return text.replace(/[，,；;:\s]+$/, '').trim();
}

function stripSupplyPrefix(value) {
  return clean(value)
    .replace(/^可(?:以)?(?:提供|供应|供)[：:，,\s]*/, '')
    .replace(/^我们(?:能|可以)?(?:提供|供应|卖)[：:，,\s]*/, '')
    .trim();
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function normalizeScore(value) {
  const text = clean(value);
  if (/^\d+(\.\d+)?$/.test(text)) return text;
  if (!text) return '';
  return '';
}

function buildFields(row) {
  const opportunityDo = first(row.opportunity_do, row.description);
  const opportunityNeed = first(
    row.opportunity_need,
    isNoisy(row.opportunity_summary) ? '' : demandOnly(row.opportunity_summary),
    demandOnly(row.outreach_angle),
  );
  const opportunitySell = stripSupplyPrefix(first(row.opportunity_sell, row.recommended_products));
  const opportunityDecision = first(row.opportunity_decision, row.next_action);
  return {
    score: normalizeScore(row.score),
    opportunity_do: opportunityDo,
    opportunity_need: opportunityNeed,
    opportunity_sell: opportunitySell,
    opportunity_decision: opportunityDecision,
    opportunity_summary: isNoisy(row.opportunity_summary) ? opportunityNeed : clean(row.opportunity_summary),
    outreach_angle: clean(row.outreach_angle),
    next_action: clean(row.next_action),
    recommended_products: clean(row.recommended_products),
    notes: clean(row.notes),
  };
}

function main() {
  const apply = process.argv.includes('--apply');
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 10000');

  const rows = db.prepare('SELECT * FROM recon_results ORDER BY updated_at DESC').all();
  const changes = [];
  for (const row of rows) {
    const next = buildFields(row);
    const rowChanges = [];
    for (const [field, value] of Object.entries(next)) {
      if (clean(row[field]) !== clean(value)) {
        rowChanges.push({ field, from: row[field] || '', to: value || '' });
      }
    }
    if (rowChanges.length) changes.push({ job_id: row.job_id, company_name: row.company_name, changes: rowChanges });
  }

  let backupPath = '';
  if (apply && changes.length) {
    backupPath = path.join(path.dirname(DB_PATH), `crm.db.bak-${stamp()}-before-recon-display-cleanup`);
    db.prepare('VACUUM INTO ?').run(backupPath);
    const update = db.prepare(`
      UPDATE recon_results
      SET score = ?, opportunity_do = ?, opportunity_need = ?, opportunity_sell = ?,
          opportunity_decision = ?, opportunity_summary = ?, outreach_angle = ?,
          next_action = ?, recommended_products = ?, notes = ?
      WHERE job_id = ?
    `);
    const tx = db.transaction(() => {
      for (const item of changes) {
        const row = rows.find(r => r.job_id === item.job_id);
        const next = buildFields(row);
        update.run(
          next.score, next.opportunity_do, next.opportunity_need, next.opportunity_sell,
          next.opportunity_decision, next.opportunity_summary, next.outreach_angle,
          next.next_action, next.recommended_products, next.notes, item.job_id,
        );
      }
    });
    tx();
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    total: rows.length,
    rows_with_changes: changes.length,
    field_changes: changes.reduce((sum, item) => sum + item.changes.length, 0),
    backupPath,
    changes,
  }, null, 2));
  db.close();
}

main();

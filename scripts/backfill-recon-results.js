#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'crm.db');

const BACKFILL_FIELDS = [
  ['industry', 'industry'],
  ['customer_type', 'customer_type'],
  ['city', 'city'],
  ['employees', 'employees'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['inn', 'inn'],
  ['rating', 'rating'],
  ['products', 'recommended_products'],
  ['description', 'description'],
  ['opportunity_summary', 'opportunity_summary'],
  ['sanctioned', 'sanctioned'],
  ['sanction_status', 'sanction_status'],
  ['quality_status', 'quality_status'],
  ['missing_steps', 'missing_steps'],
  ['step5_status', 'step5_status'],
  ['step5_plus_status', 'step5_plus_status'],
  ['contact_classification', 'contact_classification'],
  ['contact_name', 'contact_name'],
  ['contact_title', 'contact_title'],
  ['notes', 'notes'],
  ['opportunity_do', 'opportunity_do'],
  ['opportunity_need', 'opportunity_need'],
  ['opportunity_sell', 'opportunity_sell'],
  ['opportunity_decision', 'opportunity_decision'],
];

const PLACEHOLDERS = new Set([
  '', '-', '—', 'n/a', 'na', 'none', 'null', 'unknown',
  '未找到', '未获取', '未知', '未查到', '未提供', '待确认', '未验证',
  'не указан', 'не указано', 'нет данных', 'не найдено',
]);

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has('--apply'),
    json: args.has('--json'),
  };
}

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  let text = Array.isArray(value) ? value.filter(Boolean).join('; ') : String(value);
  text = text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  if (text === '[]') return '';
  return PLACEHOLDERS.has(text.toLowerCase()) ? '' : text;
}

function normalizeValue(sourceField, value) {
  const text = clean(value);
  if (!text && sourceField !== 'sanctioned') return '';
  if (sourceField === 'sanctioned') {
    return ['true', '1', 'yes', 'y', '是', '命中'].includes(String(value || '').trim().toLowerCase()) ? 'true' : 'false';
  }
  if (sourceField === 'missing_steps') {
    return text
      .replace(/^\[|\]$/g, '')
      .split(/[;,，、]/)
      .map(item => clean(item))
      .filter(Boolean)
      .join('; ');
  }
  if (sourceField === 'opportunity_sell' || sourceField === 'products') {
    return normalizeSupplyText(text);
  }
  return normalizeSanctionLanguage(text);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseArtifacts(row) {
  try {
    return JSON.parse(row.artifacts_json || '{}') || {};
  } catch {
    return {};
  }
}

function localReportDir(row, job) {
  const reportPath = clean(row.report_path);
  if (reportPath && !/^https?:\/\//i.test(reportPath)) return path.dirname(reportPath);
  if (clean(job?.output_dir)) return clean(job.output_dir);
  return '';
}

function findHermesSource(row, job) {
  const reportPath = clean(row.report_path);
  if (/^https:\/\/docs\.google\.com/i.test(reportPath)) {
    return { kind: 'google_docs', path: reportPath, text: '' };
  }

  const artifacts = parseArtifacts(row);
  const dir = localReportDir(row, job);
  const candidates = [];
  if (clean(artifacts.report_md)) candidates.push({ kind: 'report_md', path: clean(artifacts.report_md) });
  if (reportPath && !/^https?:\/\//i.test(reportPath)) {
    candidates.push({ kind: 'report_md', path: reportPath.replace(/\.html?$/i, '.md') });
  }
  if (dir) candidates.push({ kind: 'report_md', path: path.join(dir, 'report.md') });
  if (clean(artifacts.stdout_txt)) candidates.push({ kind: 'hermes_stdout', path: clean(artifacts.stdout_txt) });
  if (dir) candidates.push({ kind: 'hermes_stdout', path: path.join(dir, 'hermes_stdout.txt') });
  if (reportPath && !/^https?:\/\//i.test(reportPath)) candidates.push({ kind: 'report_html', path: reportPath });
  if (clean(artifacts.report_html)) candidates.push({ kind: 'report_html', path: clean(artifacts.report_html) });

  const seen = new Set();
  let firstExisting = null;
  for (const candidate of candidates) {
    const filePath = path.resolve(candidate.path);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');
    const text = candidate.kind === 'report_html' ? stripHtml(raw) : raw;
    const data = parseReportData(text);
    const found = {
      kind: candidate.kind,
      path: filePath,
      text,
      data,
    };
    if (!firstExisting) firstExisting = found;
    if (Object.keys(data).length) return found;
  }
  if (firstExisting) {
    return firstExisting;
  }
  return { kind: 'missing', path: reportPath, text: '', data: {} };
}

function parseSummaryBlock(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const headingPattern = /^\+?\s*#{1,6}\s*客户数据摘要\s*$/gm;
  const matches = Array.from(normalized.matchAll(headingPattern));
  if (!matches.length) return {};
  const start = matches[matches.length - 1].index + matches[matches.length - 1][0].length;
  const block = normalized.slice(start);
  const data = {};
  const knownKeys = new Set(BACKFILL_FIELDS.map(([sourceField]) => sourceField));
  let started = false;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim().replace(/^\+\s?/, '').replace(/^[-*]\s*/, '');
    if (!line || line === '```') continue;
    if (/^#{1,6}\s+/.test(line)) {
      if (started) break;
      continue;
    }
    if (!line.includes(':')) {
      if (started && /^---+$/.test(line)) break;
      continue;
    }
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (knownKeys.has(key)) {
      data[key] = value;
      started = true;
    }
  }
  return data;
}

function parseReportData(text) {
  return { ...parseJsonSummary(text), ...parseSummaryBlock(text) };
}

function parseJsonSummary(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/^\+/gm, '');
  const knownKeys = new Set(BACKFILL_FIELDS.map(([sourceField]) => sourceField));
  const candidates = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of normalized.matchAll(fencePattern)) candidates.push(match[1]);
  const objectMatch = normalized.match(/\{[\s\S]*?"(?:opportunity_do|customer_type|sanctioned|recommended_products)"[\s\S]*?\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const data = {};
      for (const key of knownKeys) {
        if (parsed[key] !== undefined) data[key] = parsed[key];
      }
      if (parsed.recommended_products !== undefined && data.products === undefined) {
        data.products = parsed.recommended_products;
      }
      if (Object.keys(data).length) return data;
    } catch {
      // Older Hermes logs may contain prose fences; keep scanning candidates.
    }
  }
  return {};
}

function normalizeSupplyText(value) {
  return clean(value)
    .replace(/^华强北\s*/, '')
    .replace(/^可(?:以)?(?:提供|供应|供)[：:，,\s]*/, '')
    .replace(/^我们(?:能|可以)?(?:提供|供应|卖)[：:，,\s]*/, '')
    .replace(/华强北现货渠道/g, '现货渠道')
    .replace(/华强北全球品牌元器件/g, '全球品牌元器件')
    .replace(/华强北电子元器件供应链/g, '电子元器件供应链')
    .replace(/华强北/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSanctionLanguage(value) {
  return clean(value)
    .replace(/合规风险，谨慎评估/g, '制裁驱动机会，确认合规路径')
    .replace(/合规风险/g, '合规路径')
    .replace(/风险评估/g, '制裁与机会信号')
    .replace(/风险提示/g, '机会/合规提示')
    .replace(/制裁风险/g, '制裁机会信号')
    .replace(/不建议直接接触该实体/g, '建议先确认合规路径与替代采购切入点')
    .replace(/不建议直接接触/g, '建议先确认合规路径')
    .replace(/HIT｜制裁命中，见报告/g, 'HIT｜制裁命中，供应链替代机会信号')
    .trim();
}

function isNumericScore(value) {
  return /^\d+(\.\d+)?$/.test(clean(value));
}

function buildChanges(row, data, columns) {
  const changes = [];
  const missingColumns = new Set();
  for (const [sourceField, dbField] of BACKFILL_FIELDS) {
    if (!columns.has(dbField)) {
      missingColumns.add(dbField);
      continue;
    }
    if (!(sourceField in data)) continue;
    const incoming = normalizeValue(sourceField, data[sourceField]);
    if (!incoming && sourceField !== 'sanctioned') continue;
    const current = clean(row[dbField]);
    if (current !== incoming) {
      changes.push({ field: dbField, from: current, to: incoming });
    }
  }
  return { changes, missingColumns: Array.from(missingColumns) };
}

function main() {
  const args = parseArgs();
  if (!fs.existsSync(DB_PATH)) throw new Error(`Database not found: ${DB_PATH}`);

  if (args.apply) {
    require('../lib/db').ensureTables();
  }

  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 10000');
  const columns = new Set(db.prepare('PRAGMA table_info(recon_results)').all().map(row => row.name));
  const rows = db.prepare(`
    SELECT r.*, j.output_dir AS job_output_dir
    FROM recon_results r
    LEFT JOIN recon_jobs j ON j.job_id = r.job_id
    ORDER BY r.updated_at DESC
  `).all();

  const stats = {
    mode: args.apply ? 'apply' : 'dry-run',
    total: rows.length,
    report_md: 0,
    hermes_stdout: 0,
    report_html: 0,
    google_docs: 0,
    missing_source: 0,
    parsed_summary: 0,
    rows_with_changes: 0,
    field_changes: 0,
    backupPath: '',
  };
  const rowsWithChanges = [];
  const skipped = [];
  const scoreAnomalies = [];
  const missingColumns = new Set();

  for (const row of rows) {
    const source = findHermesSource(row, { output_dir: row.job_output_dir });
    if (source.kind === 'report_md') stats.report_md++;
    else if (source.kind === 'hermes_stdout') stats.hermes_stdout++;
    else if (source.kind === 'report_html') stats.report_html++;
    else if (source.kind === 'google_docs') stats.google_docs++;
    else stats.missing_source++;

    if (row.score && !isNumericScore(row.score)) {
      scoreAnomalies.push({ job_id: row.job_id, company_name: row.company_name, score: row.score });
    }
    if (source.kind === 'google_docs') {
      skipped.push({ job_id: row.job_id, company_name: row.company_name, reason: 'google_docs_report_needs_fetch', path: source.path });
      continue;
    }
    if (!source.text) {
      skipped.push({ job_id: row.job_id, company_name: row.company_name, reason: 'missing_local_hermes_source', path: source.path });
      continue;
    }

    const data = source.data || parseReportData(source.text);
    if (!Object.keys(data).length) {
      skipped.push({ job_id: row.job_id, company_name: row.company_name, reason: 'missing_customer_summary_block', path: source.path });
      continue;
    }
    stats.parsed_summary++;
    const { changes, missingColumns: rowMissingColumns } = buildChanges(row, data, columns);
    rowMissingColumns.forEach(col => missingColumns.add(col));
    if (changes.length) {
      stats.rows_with_changes++;
      stats.field_changes += changes.length;
      rowsWithChanges.push({
        job_id: row.job_id,
        customer_id: row.customer_id,
        company_name: row.company_name,
        source: source.kind,
        source_path: source.path,
        changes,
      });
    }
  }

  if (args.apply) {
    stats.backupPath = path.join(path.dirname(DB_PATH), `crm.db.bak-${stamp()}-before-recon-backfill`);
    db.prepare('VACUUM INTO ?').run(stats.backupPath);
    const apply = db.transaction(() => {
      for (const item of rowsWithChanges) {
        const assignments = item.changes.map(change => `${change.field} = ?`).join(', ');
        const values = item.changes.map(change => change.to);
        values.push(item.job_id);
        db.prepare(`UPDATE recon_results SET ${assignments} WHERE job_id = ?`).run(...values);
      }
    });
    apply();
  }

  const output = {
    ok: true,
    stats,
    missingColumns: Array.from(missingColumns),
    scoreAnomalies,
    skipped,
    changes: rowsWithChanges,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(JSON.stringify({
      ok: output.ok,
      stats,
      missingColumns: output.missingColumns,
      scoreAnomalies,
      skipped,
      changedRowsPreview: rowsWithChanges.slice(0, 8),
    }, null, 2));
  }
  db.close();
}

main();

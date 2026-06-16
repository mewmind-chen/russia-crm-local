#!/usr/bin/env node
/**
 * Submit a Codex-produced recon result into the CRM database.
 *
 * Usage:
 *   node scripts/submit-codex-recon-result.js \
 *     --job-id RR-... \
 *     --result-file recon-runs/.../result.json \
 *     --evidence-file recon-runs/.../evidence.json \
 *     --report-file recon-runs/.../report.md
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { submitReconResult } = require('../lib/db');

const ROOT = path.join(__dirname, '..');

function argValue(name, required = false) {
  const idx = process.argv.indexOf(name);
  const value = idx === -1 ? '' : process.argv[idx + 1] || '';
  if (required && !value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readJson(filePath, fallback) {
  if (!filePath) return fallback;
  const abs = path.resolve(ROOT, filePath);
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return parsed == null ? fallback : parsed;
}

function uniqueEvidenceUrls(evidence) {
  return new Set(
    evidence
      .filter(item => item && item.field_name && item.source_url)
      .map(item => String(item.source_url).trim())
      .filter(Boolean)
  );
}

function hasSection(markdown, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^#{1,6}\\s*${escaped}\\s*$`, 'm').test(markdown);
}

function validateDeepReport(result, evidence, reportMarkdown) {
  if (hasFlag('--allow-shallow')) return;

  const requiredSections = [
    '目标',
    'Network Sentinel预检结果',
    '核验事实',
    '制裁标记',
    '机会判断',
    '联系人',
    'Step 5执行记录',
    'Step 5+执行记录',
    '数据质量声明',
    '证据链接',
    '客户数据摘要',
  ];
  const missingSections = requiredSections.filter(title => !hasSection(reportMarkdown, title));
  const urls = uniqueEvidenceUrls(evidence);
  const errors = [];

  if (reportMarkdown.trim().length < 2500) {
    errors.push('report.md 太短，疑似精简报告，至少需要完整深度分析');
  }
  if (urls.size < 6) {
    errors.push(`有效证据 URL 不足 6 条，当前 ${urls.size} 条`);
  }
  if (missingSections.length) {
    errors.push(`缺少报告章节：${missingSections.join(', ')}`);
  }
  if (!result.step5_status || String(result.step5_status).includes('未执行')) {
    errors.push('Step 5 未完成');
  }
  if (String(result.step5_plus_status || '').includes('应启未启')) {
    errors.push('Step 5+ 应启未启');
  }
  if (!['CLEAR', 'PARTIAL_CLEAR', 'UNKNOWN', 'HIT'].includes(String(result.sanction_status || ''))) {
    errors.push('sanction_status 必须是 CLEAR/PARTIAL_CLEAR/UNKNOWN/HIT');
  }

  if (errors.length) {
    throw new Error(`深度 recon 质量门槛未通过：${errors.join('；')}。如确需导入历史浅报告，可显式加 --allow-shallow。`);
  }
}

function main() {
  const jobId = argValue('--job-id', true);
  const resultFile = argValue('--result-file', true);
  const evidenceFile = argValue('--evidence-file', true);
  const reportFile = argValue('--report-file', true);

  const result = readJson(resultFile, {});
  const evidence = readJson(evidenceFile, []);
  if (!Array.isArray(evidence)) throw new Error('evidence-file must contain a JSON array');

  const reportPath = path.resolve(ROOT, reportFile);
  if (!fs.existsSync(reportPath)) throw new Error(`Report file not found: ${reportPath}`);

  const outputDir = path.dirname(reportPath);
  const reportMarkdown = fs.readFileSync(reportPath, 'utf8');
  validateDeepReport(result, evidence, reportMarkdown);

  const htmlPath = path.join(outputDir, 'report.html');
  const relativeHtmlPath = path.relative(ROOT, htmlPath);
  const render = spawnSync('python3', [
    path.join(ROOT, 'scripts', 'render-codex-recon-html.py'),
    '--job-id', jobId,
    '--result-file', resultFile,
    '--evidence-file', evidenceFile,
    '--report-file', reportFile,
    '--html-file', relativeHtmlPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (render.status !== 0) {
    throw new Error(`HTML render failed: ${(render.stderr || render.stdout || '').trim()}`);
  }

  result.report_path = htmlPath;
  const artifacts = {
    report_html: htmlPath,
    report_md: reportPath,
    result_json: path.resolve(ROOT, resultFile),
    evidence_json: path.resolve(ROOT, evidenceFile),
    runner: 'codex',
  };

  const submitted = submitReconResult({
    job_id: jobId,
    result,
    evidence,
    report_markdown: reportMarkdown,
    report_path: reportPath,
    output_dir: outputDir,
    artifacts,
  });

  console.log(JSON.stringify({
    ok: true,
    job_id: jobId,
    customer_id: submitted.result.customer_id,
    score: submitted.result.score,
    current_pool: submitted.result.current_pool,
    rating: submitted.result.rating,
    report_path: submitted.result.report_path,
    evidence_count: submitted.evidence_count,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

'use strict';

/**
 * Governance authority guard.
 *
 * This verifies document-authority freezing only. It does not verify remote
 * and production SHA consistency; workspace AGENTS requires that separate,
 * read-only baseline verification.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(process.env.GOVERNANCE_AUTHORITY_ROOT || path.resolve(__dirname, '..'));
const ARCHIVE = path.join(ROOT, 'docs/archive/planning-2026-07-25');
const FROZEN_MARKER = '冻结归档（2026-09-01）';
const ARCHIVE_README_MARKER = '不得用于判断当前进度';
const LEGACY_FILES = [
  'tradepulse-unified-master-plan.md',
  'tradepulse-execution-plan.md',
];
const FROZEN_DIGESTS = new Map([
  ['tradepulse-unified-master-plan.md', '4be48b87282a30b0c6513954c187ef777ad6bf0a6ada94ae578037a56e239f83'],
  ['tradepulse-execution-plan.md', '8f674bfa03571659b0e78d4b5aa0be7b2bad1121a82c7a01f3915410b0a30a79'],
]);
const ACTIVE_DOCS = [
  'docs/planning/README.md',
  'docs/development.md',
  'docs/governance/README.md',
  'docs/governance/PLANNING_SUPPLEMENT.md',
  'docs/governance/REQUIREMENTS_INDEX.md',
  'docs/governance/DECISION_LOG.md',
  'docs/governance/WORK_PROTOCOL.md',
  'docs/evidence/a4-04-stage-gate.md',
];
const HISTORICAL_SUPERPOWERS_DOCS = [
  'docs/superpowers/specs/2026-07-24-a1-09-customer-enrichment-design.md',
  'docs/superpowers/plans/2026-07-24-a1-09-customer-enrichment.md',
];
const HISTORICAL_SUPERPOWERS_MARKER = '历史资料（已冻结）';
const BANNED_ACTIVE_PATTERNS = [
  /docs\/planning\/tradepulse-unified-master-plan\.md/i,
  /docs\/planning\/tradepulse-execution-plan\.md/i,
  /origin\/codex\/ai-integration/i,
  /codex\/ai-integration/i,
  /authoritative product and execution plans/i,
  /authoritative roadmap and execution ledger/i,
];
const REQUIRED_ACTIVE_MARKERS = new Map([
  ['docs/planning/README.md', '不再承载当前路线图或执行台账'],
  ['docs/development.md', '当前重构工作区提示'],
  ['docs/governance/README.md', '`docs/archive/**` 永远是历史证据'],
  ['docs/governance/WORK_PROTOCOL.md', '`docs/archive/**` 永不作为当前事实或进度依据'],
  ['docs/evidence/a4-04-stage-gate.md', '历史快照（非当前进度）'],
]);

// `docs/archive/**` and `docs/governance/sessions/**` are historical material.
// The two listed superpowers documents are excluded from the active-document
// scan only after their historical marker is verified.
const HISTORICAL_EXCLUSIONS = [
  'docs/archive/**',
  'docs/governance/sessions/**',
  'docs/superpowers/** marked 历史资料（已冻结）',
];

function fail(message) {
  console.error(`[check-governance-authority] ${message}`);
  process.exitCode = 1;
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

for (const filename of LEGACY_FILES) {
  const activePath = path.join(ROOT, 'docs/planning', filename);
  const archivedPath = path.join(ARCHIVE, filename);
  if (fs.existsSync(activePath)) fail(`legacy plan remains active: docs/planning/${filename}`);
  if (!fs.existsSync(archivedPath)) {
    fail(`missing frozen archive: docs/archive/planning-2026-07-25/${filename}`);
    continue;
  }
  const source = fs.readFileSync(archivedPath, 'utf8');
  if (!source.includes(FROZEN_MARKER)) {
    fail(`missing frozen marker: docs/archive/planning-2026-07-25/${filename}`);
  }
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  if (digest !== FROZEN_DIGESTS.get(filename)) {
    fail(`frozen archive content changed: docs/archive/planning-2026-07-25/${filename}`);
  }
}

const archiveReadmePath = path.join(ARCHIVE, 'README.md');
if (!fs.existsSync(archiveReadmePath)
    || !fs.readFileSync(archiveReadmePath, 'utf8').includes(ARCHIVE_README_MARKER)) {
  fail('missing or invalid frozen archive README: docs/archive/planning-2026-07-25/README.md');
}

for (const relative of HISTORICAL_SUPERPOWERS_DOCS) {
  const sourcePath = path.join(ROOT, relative);
  if (!fs.existsSync(sourcePath) || !read(relative).includes(HISTORICAL_SUPERPOWERS_MARKER)) {
    fail(`historical superpowers document is missing its marker: ${relative}`);
  }
}

for (const relative of ACTIVE_DOCS) {
  if (!fs.existsSync(path.join(ROOT, relative))) {
    fail(`missing active governance document: ${relative}`);
    continue;
  }
  const source = read(relative);
  for (const pattern of BANNED_ACTIVE_PATTERNS) {
    if (pattern.test(source)) fail(`legacy authority/workflow reference in ${relative}: ${pattern}`);
  }
  const requiredMarker = REQUIRED_ACTIVE_MARKERS.get(relative);
  if (requiredMarker && !source.includes(requiredMarker)) {
    fail(`missing current-authority marker in ${relative}: ${requiredMarker}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  `[check-governance-authority] OK: document authority freeze only; ${LEGACY_FILES.length} frozen plans and ` +
  `${ACTIVE_DOCS.length} active documents checked (historical exclusions: ${HISTORICAL_EXCLUSIONS.join(', ')})`,
);

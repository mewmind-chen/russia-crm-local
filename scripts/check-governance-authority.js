'use strict';

/**
 * Governance authority guard.
 *
 * The 2026-07-25 planning pair is retained only as frozen audit evidence.
 * Current work must derive facts from remote main, production release state,
 * the after checkout's Git/code/tests, and governance documentation.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'docs/archive/planning-2026-07-25');
const FROZEN_MARKER = '冻结归档（2026-09-01）';
const LEGACY_FILES = [
  'tradepulse-unified-master-plan.md',
  'tradepulse-execution-plan.md',
];
const ACTIVE_DOCS = [
  'docs/planning/README.md',
  'docs/development.md',
  'docs/governance/README.md',
  'docs/governance/PLANNING_SUPPLEMENT.md',
  'docs/governance/REQUIREMENTS_INDEX.md',
  'docs/governance/DECISION_LOG.md',
  'docs/governance/WORK_PROTOCOL.md',
];
const BANNED_ACTIVE_PATTERNS = [
  /docs\/planning\/tradepulse-unified-master-plan\.md/i,
  /docs\/planning\/tradepulse-execution-plan\.md/i,
  /origin\/codex\/ai-integration/i,
  /codex\/ai-integration/i,
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
  if (!fs.readFileSync(archivedPath, 'utf8').includes(FROZEN_MARKER)) {
    fail(`missing frozen marker: docs/archive/planning-2026-07-25/${filename}`);
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
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[check-governance-authority] OK: ${LEGACY_FILES.length} frozen plans and ${ACTIVE_DOCS.length} active documents checked`);

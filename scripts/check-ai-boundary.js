'use strict';

/**
 * AI boundary guard.
 *
 * Fails when production code outside the allowlist requires a module from the
 * AI surface (lib/ai_stations, assistant engines, AI sales evaluation).
 *
 * Goal: new features must not silently couple to the AI-legacy code that is
 * being kept dormant. Files that already require AI modules are allowlisted
 * explicitly; anything new that needs AI has to be reviewed deliberately.
 *
 * Usage: node scripts/check-ai-boundary.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// AI module targets (relative to repo root). Directory entries match the
// whole subtree; file entries match the module with or without the .js suffix.
const AI_TARGETS = [
  'lib/ai_stations',
  'lib/assistant.js',
  'lib/assistant_conversations.js',
  'lib/assistant_index.js',
  'lib/assistant_router.js',
  'lib/assistant_runtime_api.js',
  'lib/hermes_assistant.js',
  'lib/kimi_assistant.js',
  'lib/qwen_assistant.js',
  'lib/sales_evaluation_ai.js',
];

// Callers that are allowed to require AI modules. This is the current
// coupling surface that predates the isolation work; it must not grow.
const ALLOWLIST = [
  'server.js',
  'lib/smoke_test_data.js',
  'lib/db.js',
  'lib/business_page_filters.js',
  'lib/sales_crm.js',
  'scripts/ai-station-worker.js',
  'scripts/qwen-batch-worker.js',
];

function isAiTarget(target) {
  for (const ai of AI_TARGETS) {
    if (target === ai || target === `${ai}.js`) return true;
    if (ai.endsWith('.js')) continue;
    if (target.startsWith(`${ai}${path.sep}`)) return true;
  }
  return false;
}

function isAllowlisted(relative) {
  if (ALLOWLIST.includes(relative)) return true;
  // AI modules may reference each other freely.
  if (isAiTarget(relative)) return true;
  return false;
}

function extractRequireTargets(source) {
  const targets = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) targets.push(match[1]);
  return targets;
}

function collectJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

function main() {
  const files = ['server.js', ...collectJsFiles(path.join(ROOT, 'lib')), ...collectJsFiles(path.join(ROOT, 'scripts'))];
  const violations = [];

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    if (isAllowlisted(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const target of extractRequireTargets(source)) {
      if (!target.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), target);
      const rel = path.relative(ROOT, resolved);
      if (!rel.startsWith('..') && isAiTarget(rel)) {
        violations.push(`${relative} -> ${target}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('[check-ai-boundary] AI boundary violations:');
    for (const v of violations) console.error(`  ${v}`);
    console.error('[check-ai-boundary] New code must not require AI-legacy modules. ' +
      'If this is deliberate, extend the allowlist in scripts/check-ai-boundary.js after review.');
    process.exit(1);
  }
  console.log(`[check-ai-boundary] OK: ${files.length} files checked, no AI boundary violations`);
}

main();

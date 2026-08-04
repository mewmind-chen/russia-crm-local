'use strict';

/**
 * Core test runner with AI-legacy isolation.
 *
 * `npm test`            -> runs only core tests (AI-legacy tests excluded)
 * `npm run test:ai-legacy` -> runs only AI-legacy tests
 *
 * A test file is classified as "AI-legacy" when it requires any module under
 * the AI surface (lib/ai_stations, assistant engines, AI sales evaluation).
 * The classification is derived from the code itself, so the list does not
 * need to be maintained by hand.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT, 'test');

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

function isAiTarget(target) {
  for (const ai of AI_TARGETS) {
    if (ai.endsWith('.js')) {
      // File targets match with or without the .js suffix.
      if (target === ai || target === ai.slice(0, -3)) return true;
      continue;
    }
    // Directory targets match the whole subtree.
    if (target === ai || target === `${ai}.js`) return true;
    if (target.startsWith(`${ai}${path.sep}`)) return true;
  }
  return false;
}

// Test files that reach the AI surface indirectly (helpers, worker scripts)
// keep the stable naming convention, so prefixes are classified as AI too.
const AI_FILE_PREFIXES = ['ai_', 'assistant_', 'hermes_', 'kimi_', 'qwen_'];

function isAiTestFile(name) {
  return AI_FILE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function extractRequireTargets(source) {
  const targets = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source)) !== null) targets.push(match[1]);
  return targets;
}

function classifyTestFile(file) {
  const name = path.basename(file);
  if (isAiTestFile(name)) return 'ai';
  const source = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  for (const target of extractRequireTargets(source)) {
    if (!target.startsWith('.')) continue; // bare module names are never AI-local
    const resolved = path.resolve(dir, target);
    const relative = path.relative(ROOT, resolved);
    if (!relative.startsWith('..') && isAiTarget(relative)) return 'ai';
  }
  return 'core';
}

function listTestFiles() {
  return fs.readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(TEST_DIR, name))
    .sort();
}

function main() {
  const onlyAi = process.argv.includes('--ai');
  const listOnly = process.argv.includes('--list');

  const all = listTestFiles();
  const classified = all.map((file) => ({ file, kind: classifyTestFile(file) }));
  const core = classified.filter((c) => c.kind === 'core').map((c) => c.file);
  const ai = classified.filter((c) => c.kind === 'ai').map((c) => c.file);
  const selected = onlyAi ? ai : core;

  if (listOnly) {
    for (const file of selected) console.log(path.relative(ROOT, file));
    console.error(
      `[run-core-tests] ${onlyAi ? 'AI-legacy' : 'core'} files: ${selected.length} ` +
      `(total ${all.length}, ai ${ai.length}, core ${core.length})`,
    );
    return;
  }

  if (selected.length === 0) {
    console.error('[run-core-tests] no test files selected');
    process.exit(onlyAi ? 0 : 1);
  }

  const result = spawnSync(process.execPath, ['--test', ...selected], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

main();

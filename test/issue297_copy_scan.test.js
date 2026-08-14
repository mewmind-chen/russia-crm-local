'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'check-forbidden-copy.js');

test('forbidden copy scan is clean across production sources', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: ROOT });
  assert.equal(
    result.status,
    0,
    `scan failed with exit ${result.status}:\n${result.stderr || result.stdout}`,
  );
});

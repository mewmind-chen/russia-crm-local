'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'docs/archive/planning-2026-07-25');
const FROZEN_MARKER = '冻结归档（2026-09-01）';

test('governance authority guard accepts the frozen planning archive', () => {
  const output = execFileSync(process.execPath, ['scripts/check-governance-authority.js'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /OK: 2 frozen plans and 7 active documents checked/);
});

test('current governance documents name only live authority sources', () => {
  const governance = fs.readFileSync(path.join(ROOT, 'docs/governance/README.md'), 'utf8');
  const protocol = fs.readFileSync(path.join(ROOT, 'docs/governance/WORK_PROTOCOL.md'), 'utf8');
  assert.match(governance, /实时远端 `main`/);
  assert.match(governance, /生产 `current`\/release state/);
  assert.match(governance, /`after\/` 当前 Git、代码与测试/);
  assert.match(protocol, /`docs\/archive\/\*\*` 永不作为当前事实或进度依据/);
});

test('both legacy plans are archived with a frozen marker', () => {
  for (const filename of ['tradepulse-unified-master-plan.md', 'tradepulse-execution-plan.md']) {
    assert.equal(fs.existsSync(path.join(ROOT, 'docs/planning', filename)), false);
    assert.match(fs.readFileSync(path.join(ARCHIVE, filename), 'utf8'), new RegExp(FROZEN_MARKER));
  }
});

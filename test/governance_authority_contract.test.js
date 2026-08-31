'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'docs/archive/planning-2026-07-25');
const FROZEN_MARKER = '冻结归档（2026-09-01）';
const ARCHIVE_README_MARKER = '不得用于判断当前进度';
const LEGACY_FILES = ['tradepulse-unified-master-plan.md', 'tradepulse-execution-plan.md'];
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
const REQUIRED_ACTIVE_CONTENT = new Map([
  ['docs/planning/README.md', '不再承载当前路线图或执行台账'],
  ['docs/development.md', '当前重构工作区提示'],
  ['docs/governance/README.md', '`docs/archive/**` 永远是历史证据'],
  ['docs/governance/WORK_PROTOCOL.md', '`docs/archive/**` 永不作为当前事实或进度依据'],
  ['docs/evidence/a4-04-stage-gate.md', '历史快照（非当前进度）'],
]);

function write(root, relative, source) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source, 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-authority-'));
  for (const filename of LEGACY_FILES) {
    write(
      root,
      `docs/archive/planning-2026-07-25/${filename}`,
      fs.readFileSync(path.join(ARCHIVE, filename), 'utf8'),
    );
  }
  write(root, 'docs/archive/planning-2026-07-25/README.md', ARCHIVE_README_MARKER);
  for (const relative of ACTIVE_DOCS) {
    write(root, relative, REQUIRED_ACTIVE_CONTENT.get(relative) || 'current governance guidance');
  }
  for (const relative of HISTORICAL_SUPERPOWERS_DOCS) write(root, relative, HISTORICAL_SUPERPOWERS_MARKER);
  return root;
}

function runGuard(root) {
  return execFileSync(process.execPath, ['scripts/check-governance-authority.js'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GOVERNANCE_AUTHORITY_ROOT: root },
  });
}

function assertGuardFails(root, expected) {
  assert.throws(() => runGuard(root), (error) => {
    assert.equal(error.status, 1);
    assert.match(error.stderr, expected);
    return true;
  });
}

test('governance authority guard accepts the frozen planning archive', () => {
  const output = execFileSync(process.execPath, ['scripts/check-governance-authority.js'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(output, /document authority freeze only; 2 frozen plans and 8 active documents checked/);
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
  for (const filename of LEGACY_FILES) {
    assert.equal(fs.existsSync(path.join(ROOT, 'docs/planning', filename)), false);
    assert.match(fs.readFileSync(path.join(ARCHIVE, filename), 'utf8'), new RegExp(FROZEN_MARKER));
  }
});

test('guard rejects a missing frozen archive in an isolated fixture', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.rmSync(path.join(fixture, 'docs/archive/planning-2026-07-25/tradepulse-execution-plan.md'));
  assertGuardFails(fixture, /missing frozen archive/);
});

test('guard rejects an archive without the frozen marker in an isolated fixture', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  write(fixture, 'docs/archive/planning-2026-07-25/tradepulse-unified-master-plan.md', 'unmarked archive');
  assertGuardFails(fixture, /missing frozen marker/);
});

test('guard rejects changes to frozen archive content even when the marker remains', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const relative = 'docs/archive/planning-2026-07-25/tradepulse-unified-master-plan.md';
  write(fixture, relative, `${fs.readFileSync(path.join(fixture, relative), 'utf8')}\nchanged\n`);
  assertGuardFails(fixture, /frozen archive content changed/);
});

test('guard rejects legacy paths and ai-integration workflow in active documents', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  write(
    fixture,
    'docs/evidence/a4-04-stage-gate.md',
    `${REQUIRED_ACTIVE_CONTENT.get('docs/evidence/a4-04-stage-gate.md')} docs/planning/tradepulse-execution-plan.md`,
  );
  assertGuardFails(fixture, /legacy authority\/workflow reference/);
  write(
    fixture,
    'docs/evidence/a4-04-stage-gate.md',
    `${REQUIRED_ACTIVE_CONTENT.get('docs/evidence/a4-04-stage-gate.md')} codex/ai-integration`,
  );
  assertGuardFails(fixture, /legacy authority\/workflow reference/);
});

test('guard rejects restoring the old planning README authority claim', t => {
  const fixture = makeFixture();
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  write(fixture, 'docs/planning/README.md', 'This directory contains the authoritative product and execution plans.');
  assertGuardFails(fixture, /legacy authority\/workflow reference|missing current-authority marker/);
});

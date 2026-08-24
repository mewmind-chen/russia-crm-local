const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

function functionSlice(name, nextName) {
  const start = APP_JS.indexOf(`function ${name}(`);
  const end = APP_JS.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `缺少 ${name}`);
  assert.notEqual(end, -1, `缺少 ${nextName}`);
  return APP_JS.slice(start, end);
}

const ROW_ACTION_SOURCE = functionSlice('rowActionCluster', 'jsonList');
const rowActionCluster = vm.runInNewContext(`${ROW_ACTION_SOURCE}\nrowActionCluster`);

function assertNoInternalCount(html) {
  assert.doesNotMatch(html, /(?:⋯|…|\.\.\.|\+)\s*\d+/u);
  assert.doesNotMatch(html, /title="[^\"]*\d/);
}

test('Issue #344: one primary action and one secondary action use a count-free 更多 menu', () => {
  const html = rowActionCluster(
    ['<button>分配</button>'],
    ['<button>取消分配</button>'],
  );

  assert.match(html, /分配/);
  assert.match(html, /取消分配/);
  assert.match(html, /<summary class="more" title="更多" aria-label="更多">更多<\/summary>/);
  assertNoInternalCount(html);
});

test('Issue #344: multiple secondary actions still use one count-free 更多 menu', () => {
  const html = rowActionCluster(
    ['<button>分配</button>'],
    ['<button>取消分配</button>', '<button>标记不对口</button>'],
  );

  assert.equal((html.match(/<details class="row-more">/g) || []).length, 1);
  assert.match(html, /取消分配/);
  assert.match(html, /标记不对口/);
  assertNoInternalCount(html);
});

test('Issue #344: only a primary action has no 更多入口', () => {
  const html = rowActionCluster(['<button>打开客户</button>'], []);

  assert.match(html, /打开客户/);
  assert.doesNotMatch(html, /row-more|更多/);
  assertNoInternalCount(html);
});

test('Issue #344: no actions render an empty action cluster for the caller to replace with —', () => {
  const html = rowActionCluster([], []);
  const intake = functionSlice('renderIntake', 'customerProfileFrameUrl');

  assert.equal(html, '<div class="row-actions"></div>');
  assert.doesNotMatch(html, /row-more|更多/);
  assert.match(intake, /else if \(!actions\) \{\s*actions = '—';/);
});

test('Issue #344: intake state and role branches keep only real actions', () => {
  const intake = functionSlice('renderIntake', 'customerProfileFrameUrl');

  assert.match(intake, /const salesView =/);
  assert.match(intake, /const canManualAssign = !salesView && can\('manage_intake'\)/);
  assert.match(intake, /salesView && item\.status === 'assigned'/);
  assert.match(intake, /!salesView && item\.status === 'assigned'/);
  assert.match(intake, /item\.status === 'claimed'/);
  assert.match(intake, /item\.status === 'returned'/);
  assert.match(intake, /data-intake-action="claim"/);
  assert.match(intake, /data-intake-action="return"/);
  assert.match(intake, /data-intake-action="reject"/);
  assert.match(intake, /data-intake-unassign=/);
  assert.match(intake, /item\.assignable === false|intakeItemAssignable\(item\)/);
  assert.doesNotMatch(intake, /⋯\s*\$\{overflow\.length\}|…\s*\$\{overflow\.length\}|\.\.\.\s*\$\{overflow\.length\}/u);
});

test('Issue #344: shared action cluster remains used by customer overview and pipeline', () => {
  const customers = functionSlice('renderCustomers', 'loadRecycleBin');
  const pipeline = functionSlice('renderPipeline', 'pipelineStayMarkup');

  assert.match(customers, /rowActionCluster\(lifecycleActions\.slice\(0, 2\), lifecycleActions\.slice\(2\)\)/);
  assert.match(pipeline, /rowActionCluster\(primaryActions, moreActions\)/);
});

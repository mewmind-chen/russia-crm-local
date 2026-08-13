'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(
  path.join(__dirname, '..', 'sales-assets', 'app.js'),
  'utf8',
);

function topLevelFunction(name) {
  const pattern = new RegExp(`\\n  (?:async )?function ${name}\\(`);
  const match = pattern.exec(app);
  assert.ok(match, `sales-assets/app.js must define ${name}()`);
  const start = match.index;
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = start + match[0].length;
  const following = next.exec(app);
  return app.slice(start, following?.index ?? app.length);
}

function sectionBetween(startText, endText) {
  const start = app.indexOf(startText);
  assert.notEqual(start, -1, `missing source marker: ${startText}`);
  const end = app.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing source marker: ${endText}`);
  return app.slice(start, end);
}

test('recycle-bin names open the authorized read-only mismatch detail', () => {
  const render = topLevelFunction('renderRecycleBin');
  const open = topLevelFunction('openMismatchRecord');
  const clickHandler = sectionBetween(
    "document.addEventListener('click', async event => {",
    "document.addEventListener('change',",
  );

  assert.match(app, /recycleCustomerDetail:\s*null/);
  assert.match(
    render,
    /data-open-mismatch-record="\$\{esc\((?:row|item)\.recordKey\)\}"/,
  );
  assert.match(render, /data-open-mismatch-record/);
  assert.match(render, /<div class="company-cell">\$\{customerCell\}/);
  assert.doesNotMatch(render, /row\._attrs\s*=\s*`data-open-(?:recycle-customer|mismatch-record)=/);

  assert.match(clickHandler, /closest\('\[data-open-mismatch-record\]'\)/);
  assert.match(clickHandler, /openMismatchRecord\(mismatchRecord\.dataset\.openMismatchRecord\)/);

  assert.match(
    open,
    /api\(`\/api\/sales-crm\/mismatch-recycle\/\$\{encodeURIComponent\(recordKey\)\}\/profile`\)/,
  );
  assert.match(open, /state\.mismatchRecordDetail\s*=\s*\{ recordKey, loading: false/);
  assert.match(open, /renderMismatchRecordDrawer\(\)/);
  assert.match(open, /\$\('#customerDrawer'\)\.classList\.add\('open'\)/);
});

test('recycle drawer is visibly read-only and includes recycle metadata plus full history', () => {
  const render = topLevelFunction('renderRecycleDrawer');
  const normalRender = topLevelFunction('renderDrawer');

  assert.match(normalRender, /state\.recycleCustomerDetail/);
  assert.match(normalRender, /renderRecycleDrawer\(/);

  assert.match(render, /回收站客户/);
  for (const field of [
    'recycle.kind',
    'recycle.reason',
    'recycle.previousOwnerName',
    'recycle.recycledAt',
  ]) {
    assert.match(render, new RegExp(field.replace('.', '\\.')), field);
  }
  for (const collection of [
    'activities',
    'rfqs',
    'quotes',
    'orders',
    'timeline',
    'insights',
    'auditLog',
  ]) {
    assert.match(render, new RegExp(`detail\\.${collection}\\b`), collection);
  }

  assert.doesNotMatch(
    render,
    /data-(?:add-quote|add-order|edit-stage-rating|edit-customer-profile|return-customer|trash-customer|evaluate-company|evaluate-contact|add-contact)/,
    'a recycled customer must expose history without normal CRM mutation actions',
  );
  assert.doesNotMatch(render, /customerAiSection\(/);
});

test('recycle drawer exposes only the action valid for its recycle kind and current authority', () => {
  const render = topLevelFunction('renderRecycleDrawer');

  assert.match(render, /\['sales_return', 'mismatch'\]\.includes\(detail\.recycle\.kind\)/);
  assert.match(render, /detail\.actions\.includes\('reassign'\)/);
  assert.match(render, /state\.data\.assignmentCandidates \|\| \[\]/);
  assert.match(render, /data-recycle-detail-owner=/);
  assert.match(render, /data-reassign-customer=/);

  assert.match(render, /detail\.recycle\.kind\s*===\s*'manual_delete'/);
  assert.match(render, /detail\.actions\.includes\('restore'\)/);
  assert.match(render, /can\('manage_manual_customer_deletion'\)/);
  assert.match(render, /!state\.data\.impersonation/);
  assert.match(render, /data-restore-customer=/);
});

test('recycle list uses the server action whitelist and minimal assignment candidates', () => {
  const render = topLevelFunction('renderRecycleBin');

  assert.match(render, /state\.data\.assignmentCandidates \|\| \[\]/);
  assert.match(render, /row\.actions\?\.includes\('reassign'\)/);
  assert.match(render, /row\.actions\?\.includes\('restore'\)/);
  assert.match(render, /state\.data\.user\?\.role === 'admin'/);
  assert.match(render, /!state\.data\.impersonation/);
});

test('restore and reassign success close recycle detail then refresh bootstrap and recycle list', () => {
  const clickHandler = sectionBetween(
    "document.addEventListener('click', async event => {",
    "document.addEventListener('change',",
  );
  const restore = sectionBetween(
    'const restoreCustomer =',
    'const reassignCustomer =',
  );
  const reassignEnd = clickHandler.indexOf('const retryResearch =', clickHandler.indexOf('const reassignCustomer ='));
  assert.notEqual(reassignEnd, -1, 'missing source marker after reassign handler');
  const reassign = clickHandler.slice(
    clickHandler.indexOf('const reassignCustomer ='),
    reassignEnd,
  );
  const reassignAction = topLevelFunction('reassignMismatchCustomer');
  const refreshAction = topLevelFunction('refreshAfterMismatchAction');

  assert.match(restore, /\/restore`/);
  assert.match(restore, /closeDrawer\(\)/);
  assert.match(restore, /await refresh\('手工客户已恢复'\)/);
  assert.match(restore, /await loadRecycleBin\(\)/);

  assert.match(reassign, /reassignMismatchCustomer\(reassignCustomer, reason\)/);
  assert.match(reassignAction, /\/reassign`/);
  assert.match(reassignAction, /refreshAfterMismatchAction\('客户已重新分配'\)/);
  assert.match(refreshAction, /closeDrawer\(\)/);
  assert.match(refreshAction, /await refresh\(message\)/);
  assert.match(refreshAction, /await loadRecycleBin\(\)/);
});

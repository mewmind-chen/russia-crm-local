'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('Issue 264 intake tabs drop claimed and rejected', () => {
  const tabs = html.slice(html.indexOf('id="intakeTabs"'), html.indexOf('</div>', html.indexOf('id="intakeTabs"') + 400));
  assert.match(tabs, /data-intake-status=""/);
  assert.match(tabs, /data-intake-status="unassigned"/);
  assert.match(tabs, /data-intake-status="assigned"/);
  assert.match(tabs, /data-intake-status="returned"/);
  assert.doesNotMatch(tabs, /data-intake-status="claimed"/);
  assert.doesNotMatch(tabs, /data-intake-status="rejected"/);
});

test('Issue 264 stat cards add CRM entry, drop manager claimed and rejected', () => {
  const cards = functionBlock(app, 'intakeStatCards');
  assert.match(cards, /\['crm', '已进入 CRM'/);
  const manager = cards.slice(cards.indexOf('] : [') + 4);
  assert.match(manager, /\['unassigned',/);
  assert.match(manager, /\['crm',/);
  assert.doesNotMatch(manager, /\['claimed',/);
  assert.doesNotMatch(manager, /\['rejected',/);
  const sales = cards.slice(0, cards.indexOf('] : [') + 1);
  assert.match(sales, /\['claimed', '已领取'/);
  assert.match(sales, /\['crm', '已进入 CRM'/);
});

test('Issue 264 renderIntake tab labels drop claimed and rejected', () => {
  const render = functionBlock(app, 'renderIntake');
  const labels = render.slice(render.indexOf('const tabLabels'), render.indexOf('$$(\'#intakeTabs button\')'));
  assert.doesNotMatch(labels, /claimed: '已领取'/);
  assert.doesNotMatch(labels, /rejected: '不对口'/);
  assert.match(labels, /returned: '已退回'/);
});

test('Issue 264 CRM jump maps crm and claimed cards to claimed flow', () => {
  const jump = functionBlock(app, 'jumpIntakeStatToCrm');
  assert.match(jump, /key === 'claimed' \|\| key === 'crm'/);
  assert.match(jump, /pendingCustomerIntakeFlow = flow/);
});

test('Issue 264 nav count uses role-scoped actionable totals', () => {
  const block = app.slice(app.indexOf("if ($('#navIntakeCount'))"), app.indexOf("if ($('#navIntakeCount'))") + 500);
  assert.match(block, /navIntakeCount/);
  assert.match(block, /canViewAssignmentDecisions/);
  assert.match(block, /intakeStats\?\.pending/);
  assert.match(block, /intakeStats\?\.returned/);
  assert.match(block, /intakeStats\?\.approved/);
});

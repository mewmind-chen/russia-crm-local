'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let parentheses = 0;
  let bodyStart = -1;
  let signatureQuote = '';
  let signatureEscaped = false;
  for (let index = source.indexOf('(', start); index < source.length; index += 1) {
    const character = source[index];
    if (signatureQuote) {
      if (signatureEscaped) signatureEscaped = false;
      else if (character === '\\') signatureEscaped = true;
      else if (character === signatureQuote) signatureQuote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') { signatureQuote = character; continue; }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === '{' && parentheses === 0) { bodyStart = index; break; }
  }
  assert.notEqual(bodyStart, -1, `missing body for ${name}`);
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
    if (character === '{') depth += 1;
    if (character === '}') { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  assert.fail(`unterminated function ${name}`);
}

test('applyTableColumnClasses assigns semantic classes to headers and body cells', () => {
  const source = `
    ${functionBlock(app, 'applyTableColumnClasses')}
    ({ applyTableColumnClasses });
  `;
  const heads = ['a', 'b', 'c'].map(() => ({ classList: { add() {} } }));
  const bodyRows = [['x', 'y', 'z'], ['p', 'q', 'r']].map(cells => cells.map(() => ({ classList: { add() {} } })));
  const container = {
    querySelectorAll(selector) {
      if (selector === 'thead th') return heads;
      if (selector === 'tbody tr') return bodyRows;
      return [];
    },
  };
  const added = [];
  const mkEl = () => ({ classList: { add(name) { added.push(name); } } });
  const heads2 = ['a', 'b', 'c'].map(mkEl);
  const bodyRows2 = [['x', 'y', 'z'], ['p', 'q', 'r']].map(cells => ({ children: cells.map(mkEl) }));
  const container2 = {
    querySelectorAll(selector) {
      if (selector === 'thead th') return heads2;
      if (selector === 'tbody tr') return bodyRows2;
      return [];
    },
  };
  const api = vm.runInNewContext(source);
  api.applyTableColumnClasses(container2, ['col-x', 'col-y', 'col-z']);
  assert.deepEqual(added.slice(0, 3), ['col-x', 'col-y', 'col-z'], 'header cells get classes');
  assert.equal(added.length, 9, 'all body cells get classes');
});

test('renderCustomers assigns the ten CRM column classes', () => {
  const renderer = functionBlock(app, 'renderCustomers');
  assert.match(renderer, /applyTableColumnClasses\(/);
  assert.match(renderer, /col-check/);
  assert.match(renderer, /col-company/);
  assert.match(renderer, /col-country/);
  assert.match(renderer, /col-stage/);
  assert.match(renderer, /col-owner/);
  assert.match(renderer, /col-last/);
  assert.match(renderer, /col-next/);
  assert.match(renderer, /col-priority/);
  assert.match(renderer, /col-status/);
  assert.match(renderer, /col-actions/);
});

test('renderIntake builds column classes from the same conditions as its headers', () => {
  const renderer = functionBlock(app, 'renderIntake');
  assert.match(renderer, /applyTableColumnClasses\(/);
  assert.match(renderer, /showAI/);
  assert.match(renderer, /showAssignmentAI/);
  assert.match(renderer, /canManualAssign/);
  assert.match(renderer, /col-actions/);
});

test('CSS pins the action columns and short columns on both pages', () => {
  assert.match(css, /#customerTable[^{]*\.col-actions\{[^}]*width:190px/);
  assert.match(css, /#intakeTable[^{]*\.col-actions\{[^}]*width:148px/);
  assert.match(css, /#customerTable[^{]*\.col-priority\{[^}]*width:56px/);
  assert.match(css, /#customerTable[^{]*\.col-status\{[^}]*width:104px/);
  assert.match(css, /\.col-actions\{[^}]*white-space:nowrap/);
});

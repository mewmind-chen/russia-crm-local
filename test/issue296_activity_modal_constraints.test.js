'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

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
    if (character === "'" || character === '"' || character === '`') {
      signatureQuote = character;
      continue;
    }
    if (character === '(') parentheses += 1;
    else if (character === ')') parentheses -= 1;
    else if (character === '{' && parentheses === 0) {
      bodyStart = index;
      break;
    }
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
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

function disabledStateHarness() {
  const sections = {};
  ['progress', 'plan', 'noPlan', 'manager'].forEach(key => {
    const els = ['a', 'b'].map(() => ({ disabled: false }));
    sections[key] = { querySelectorAll: () => els, _els: els };
  });
  const form = {
    elements: { activityMode: { value: 'progress' } },
    classList: {},
  };
  const $ = selector => {
    if (selector === '#activityForm') return form;
    if (selector === '#activityProgressFields') return sections.progress;
    if (selector === '#activityPlanFields') return sections.plan;
    if (selector === '#activityNoPlanFields') return sections.noPlan;
    if (selector === '#activityManagerFields') return sections.manager;
    return null;
  };
  const $$ = selector => {
    if (selector === '#activityModeTabs [data-activity-mode]') {
      return ['progress', 'plan', 'noPlan', 'manager'].map(key => ({
        dataset: { activityMode: key },
        classList: { toggle() {} },
        setAttribute() {},
      }));
    }
    return [];
  };
  const state = { activityModalMode: 'progress' };
  const source = `
    ${functionBlock(app, 'syncActivityModeSections')}
    ({ syncActivityModeSections });
  `;
  const api = vm.runInNewContext(source, { $, state, Object });
  return { api, sections };
}

test('syncActivityModeSections disables inactive sections and enables the active one', () => {
  const { api, sections } = disabledStateHarness();
  api.syncActivityModeSections('manager');
  assert.deepEqual(sections.manager._els.map(el => el.disabled), [false, false]);
  for (const key of ['progress', 'plan', 'noPlan']) {
    assert.deepEqual(sections[key]._els.map(el => el.disabled), [true, true], `${key} must be disabled`);
  }
  api.syncActivityModeSections('progress');
  assert.deepEqual(sections.progress._els.map(el => el.disabled), [false, false]);
  assert.deepEqual(sections.manager._els.map(el => el.disabled), [true, true]);
});

test('setActivityModalMode invokes section sync for every mode switch', () => {
  const modal = section(app, 'function setActivityModalMode', 'function openActivityModal');
  assert.match(modal, /syncActivityModeSections\(mode\)/);
});

test('manager fields use approved copy and drop the editable plan time input', () => {
  const markup = section(app, '<section id="activityManagerFields"', '</section>');
  assert.match(markup, /需要主管协助的原因/);
  assert.match(markup, />原计划</);
  assert.match(markup, /activity-manager-plan-time/);
  assert.match(markup, /原定 /);
  assert.doesNotMatch(markup, /name="managerNextActionAt"/);
  assert.doesNotMatch(markup, /申请原因/);
});

test('manager submit payload never carries a plan time', () => {
  const submit = section(app, "if (mode === 'manager') {", 'if (mode === \'progress\'');
  assert.match(submit, /payload\.nextActionAt = '';/);
  assert.doesNotMatch(submit, /managerNextActionAt/);
});

test('submit fallback surfaces hidden-section validation failures', () => {
  const click = section(app, "const activitySubmitButton = event.target.closest('#activitySubmit')", "if (event.target.closest('#customerProfileDataEdit'))");
  assert.match(click, /checkValidity\(\)/);
  assert.match(click, /reportValidity\(\)/);
  assert.match(click, /:invalid/);
  assert.match(click, /存在未完成的必填项或无效时间，请检查表单/);
});

test('intake master profile prefills the matching CRM account', () => {
  const handler = section(app, "if (event.target.closest('#customerProfileActivity')) {", 'const activitySubmitButton');
  assert.match(handler, /customerProfileExternalId/);
  assert.match(handler, /openActivityModal\(matchedAccount\.id\)/);
  assert.match(handler, /该线索尚未进入 CRM/);
});

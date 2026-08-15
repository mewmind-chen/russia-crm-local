'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

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
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}') { depth -= 1; if (depth === 0) return source.slice(start, index + 1); }
  }
  assert.fail(`unterminated function ${name}`);
}

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

function blockStatusApi() {
  const source = `
    ${functionBlock(app, 'intakeNeedsIdentityReview')}
    ${functionBlock(app, 'intakeBlockStatusLabel')}
    ({ needsReview: intakeNeedsIdentityReview, label: intakeBlockStatusLabel });
  `;
  return vm.runInNewContext(source);
}

function reviewActionApi(dedupeAccess) {
  const source = `
    const esc = value => String(value ?? '');
    const canAccessProtectionAndDedupe = () => ${dedupeAccess ? 'true' : 'false'};
    ${functionBlock(app, 'intakeReviewActionMarkup')}
    intakeReviewActionMarkup(item);
  `;
  const run = (item) => vm.runInNewContext(source, { item });
  return run;
}

function deepLinkApi() {
  const source = `
    ${functionBlock(app, 'intakeReviewDeepLink')}
    ${functionBlock(app, 'openIntakeReview')}
    ({ deepLink: intakeReviewDeepLink, open: openIntakeReview });
  `;
  const calls = [];
  const location = { hash: '#pool' };
  const api = vm.runInNewContext(source, {
    switchView: (view) => calls.push(view),
    location,
    encodeURIComponent,
  });
  return { api, calls, location };
}

test('intakeBlockStatusLabel maps review/identity states to plain business copy', () => {
  const { label } = blockStatusApi();
  assert.equal(label({ duplicate_state: 'review' }), '疑似重名，等待管理员确认');
  assert.equal(label({ identityWarning: { active: true }, claimBlocked: true }), '管理员确认后才能分配');
  assert.equal(label({ duplicate_state: 'cleared' }), '已确认不是同一客户，可以分配');
  assert.equal(label({ duplicate_state: 'exact', linkedMasterName: 'ACME 主客户' }), '已关联主客户：ACME 主客户');
  assert.equal(label({ duplicate_state: 'review', supplementRequirement: '营业执照' }), '资料不足，需要补充营业执照');
});

test('intakeBlockStatusLabel falls back to generic supplement copy without a requirement', () => {
  const { label } = blockStatusApi();
  assert.equal(
    label({ duplicate_state: 'review', decision_reason: '管理员要求补充资料后再判断' }),
    '资料不足，需要补充资料',
  );
});

test('intakeBlockStatusLabel emits no raw internal keys in user copy', () => {
  const { label } = blockStatusApi();
  const fixtures = [
    { duplicate_state: 'review' },
    { identityWarning: { active: true }, claimBlocked: true },
    { duplicate_state: 'cleared' },
    { duplicate_state: 'exact', linkedMasterName: 'ACME' },
    { duplicate_state: 'review', supplementRequirement: '营业执照' },
  ];
  for (const item of fixtures) {
    const copy = label(item);
    for (const key of ['duplicate_state', 'assignmentBlockReason', 'confirmed_same',
      'confirmed_distinct', 'needs_info', 'claimBlocked', 'identityWarning',
      'review', 'cleared', 'exact']) {
      assert.ok(!copy.includes(key), `${key} must not leak into copy: ${copy}`);
    }
  }
});

test('resolved states win over a stale supplement marker', () => {
  const { label } = blockStatusApi();
  assert.equal(
    label({ duplicate_state: 'exact', linkedMasterName: 'ACME', supplementRequirement: '营业执照' }),
    '已关联主客户：ACME',
  );
  assert.equal(
    label({ duplicate_state: 'cleared', supplementRequirement: '营业执照' }),
    '已确认不是同一客户，可以分配',
  );
});

test('intakeBlockStatusLabel surfaces identity-conflict-linked masters before review blocks', () => {
  const { label } = blockStatusApi();
  assert.equal(
    label({ linkedMasterName: 'ACME 主客户', claimBlocked: true }),
    '已关联主客户：ACME 主客户',
  );
  assert.equal(
    label({ linkedMasterExternalId: 'RU-9402' }),
    '已关联主客户：RU-9402',
  );
  assert.equal(
    label({ linkedMasterName: 'ACME', claimBlocked: true, supplementRequirement: '营业执照' }),
    '已关联主客户：ACME',
  );
});

test('intakeNeedsIdentityReview identifies blocked identity-review items only', () => {
  const { needsReview } = blockStatusApi();
  assert.equal(needsReview({ identityWarning: { active: true } }), true);
  assert.equal(needsReview({ claimBlocked: true }), true);
  assert.equal(needsReview({ claimBlocked: 1 }), true, 'truthy claimBlocked is treated as blocked');
  assert.equal(needsReview({ duplicate_state: 'review' }), true);
  assert.equal(needsReview({ duplicate_state: 'cleared' }), false);
  assert.equal(needsReview({ duplicate_state: 'exact' }), false);
  assert.equal(needsReview({ status: 'assigned', assignable: false }), false);
});

test('identity-review row action renders 去处理核验 only with dedupe access', () => {
  const item = { id: 'I-1', duplicate_review_id: 'DUPREV-1' };
  const adminMarkup = reviewActionApi(true)(item);
  assert.match(adminMarkup, /去处理核验/);
  assert.match(adminMarkup, /data-intake-review="I-1"/);
  assert.doesNotMatch(adminMarkup, /disabled/);

  const managerMarkup = reviewActionApi(false)(item);
  assert.match(managerMarkup, /等待管理员核验/);
  assert.match(managerMarkup, /disabled/);
  assert.match(managerMarkup, /title="管理员确认后才能分配"/);
  assert.doesNotMatch(managerMarkup, /去处理核验/);
});

test('deep-link prefers the duplicate review id and falls back to the customer param', () => {
  const { api } = deepLinkApi();
  assert.equal(
    api.deepLink({ duplicate_review_id: 'DUPREV-9', external_customer_id: 'C-1' }),
    '#protectedCustomers?review=DUPREV-9',
  );
  assert.equal(
    api.deepLink({ external_customer_id: 'C-1' }),
    '#protectedCustomers?customer=C-1',
  );
  assert.equal(api.deepLink({}), '#protectedCustomers');
});

test('openIntakeReview switches to the protected customers view and emits the deep link', () => {
  const { api, calls, location } = deepLinkApi();
  api.open({ duplicate_review_id: 'DUPREV-7' });
  assert.deepEqual(calls, ['protectedCustomers']);
  assert.equal(location.hash, '#protectedCustomers?review=DUPREV-7');
});

test('openIntakeAssignModal refuses identity-review items without opening a modal', () => {
  const state = {
    data: {
      intake: {
        items: [
          { id: 'I-1', identityWarning: { active: true, message: '名称待核验' }, assignmentBlockReason: '疑似重名，等待管理员确认' },
          { id: 'I-2', duplicate_state: 'review', claimBlocked: true },
          { id: 'I-3', status: 'assigned' },
        ],
      },
    },
  };
  const toasts = [];
  const opens = [];
  const source = `
    ${functionBlock(app, 'intakeNeedsIdentityReview')}
    ${functionBlock(app, 'openIntakeAssignModal')}
    ({ openIntakeAssignModal });
  `;
  const api = vm.runInNewContext(source, {
    state,
    esc: (value) => String(value ?? ''),
    toast: (message) => toasts.push(message),
    openModal: (...args) => opens.push(args),
    intakeAssignmentCandidates: () => [{ id: 'u1', name: '销售一' }],
    customerAIEnabled: () => false,
  });

  api.openIntakeAssignModal('I-1');
  assert.equal(opens.length, 0, 'identity warning item must not open the modal');
  assert.ok(toasts.some(message => message.includes('核验')), 'guard surfaces a reason');

  api.openIntakeAssignModal('I-2');
  assert.equal(opens.length, 0, 'duplicate review item must not open the modal');
  assert.ok(toasts.some(message => message.includes('核验')), 'review guard surfaces a reason');

  api.openIntakeAssignModal('I-3');
  assert.equal(opens.length, 1, 'plain assigned item still opens the reassign modal');
});

test('manual assignment submit resets the submitting flag and button in a finally block', () => {
  const submit = section(app, "form.id === 'intakeManualAssignForm'", "form.id === 'intakeAssignForm'");
  assert.match(submit, /finally \{/);
  assert.match(submit, /state\.intakeAssignmentSubmitting = false/);
  assert.match(submit, /button\.textContent = '确认分配'/);
  assert.match(submit, /blockedReasons/);
});

test('manual assignment preview resets the submitting flag in a finally block', () => {
  const preview = functionBlock(app, 'openManualIntakeAssignment');
  assert.match(preview, /finally \{/);
  assert.match(preview, /state\.intakeAssignmentSubmitting = false/);
  assert.match(preview, /blockedReasons/);
});

test('assign failure paths surface a toast with the reason', () => {
  const manualButton = section(app, "closest('#manualAssignIntakeBtn')", "closest('#clearIntakeSelection')");
  assert.match(manualButton, /catch \(error\) \{ toast\(error\.message\); \}/);

  const assignButton = section(app, "closest('[data-intake-assign]')", "closest('[data-intake-unassign]')");
  assert.match(assignButton, /openIntakeAssignModal\(assignIntake\.dataset\.intakeAssign\)/);

  const unassign = section(app, "closest('[data-intake-unassign]')", "closest('[data-intake-action]')");
  assert.match(unassign, /catch \(error\) \{ toast\(error\.message\); \}/);
});

test('renderIntake drives block copy and row actions through the new helpers', () => {
  const renderer = functionBlock(app, 'renderIntake');
  assert.match(renderer, /intakeBlockStatusLabel\(item\)/);
  assert.match(renderer, /intakeNeedsIdentityReview\(item\)/);
  assert.match(renderer, /intakeReviewActionMarkup\(item\)/);
});

test('identity-conflict-linked items expose a view entry to the linked master', () => {
  const renderer = functionBlock(app, 'renderIntake');
  const actions = section(renderer, "let actions = '';", 'const signals = intakeSignals(item);');
  assert.match(actions, /item\.linkedMasterExternalId/);
  assert.match(actions, /data-open-customer="\$\{item\.linkedMasterExternalId\}"/);
  assert.match(actions, /查看已关联客户/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing shared function ${name}`);
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
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
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

function paginationTokensFunction() {
  return vm.runInNewContext(`(${functionBlock(app, 'paginationTokens')})`);
}

function renderPaginationHarness() {
  const source = `
    const PAGE_SIZE_OPTIONS = Object.freeze([50, 100]);
    const paginationRegistry = new Map();
    ${functionBlock(app, 'paginationTokens')}
    ${functionBlock(app, 'renderPagination')}
    ({ renderPagination, paginationRegistry });
  `;
  return vm.runInNewContext(source, { Math, Number, Object, Array, Set, Map });
}

test('all principal list surfaces remove incremental-load language and hooks', () => {
  const source = `${html}\n${app}`;
  assert.doesNotMatch(source, /继续加载|加载更多/);
  assert.doesNotMatch(source, /data-load-business-page|data-load-research/);
  assert.doesNotMatch(source, /(?:LoadMore|loadMore|load-more-row)/);
});

test('shared page tokens keep first and last pages and collapse large gaps', () => {
  const paginationTokens = paginationTokensFunction();
  assert.deepEqual(Array.from(paginationTokens(1, 1)), [1]);
  assert.deepEqual(Array.from(paginationTokens(3, 5)), [1, 2, 3, 4, 5]);
  assert.deepEqual(Array.from(paginationTokens(1, 100)), [1, 2, 'ellipsis', 100]);
  assert.deepEqual(
    Array.from(paginationTokens(50, 100)),
    [1, 'ellipsis', 49, 50, 51, 'ellipsis', 100],
  );
  assert.deepEqual(Array.from(paginationTokens(100, 100)), [1, 'ellipsis', 99, 100]);
});

test('shared renderer exposes first, previous, numbered, next and last navigation', () => {
  const { renderPagination, paginationRegistry } = renderPaginationHarness();
  const root = { className: '', dataset: {}, innerHTML: '' };
  const onChange = () => {};
  renderPagination(root, 'customers', { page: 50, pageSize: 50, total: 5000 }, onChange);

  assert.match(root.className, /\bshared-pagination\b/);
  assert.equal(root.dataset.pagination, 'customers');
  assert.equal(paginationRegistry.get('customers'), onChange);
  assert.match(root.innerHTML, /共 5000 条 · 第 50 \/ 100 页/);
  for (const action of ['first', 'prev', 'page', 'next', 'last']) {
    assert.match(root.innerHTML, new RegExp(`data-pagination-action="${action}"`), action);
  }
  assert.match(root.innerHTML, /data-page="1"/);
  assert.match(root.innerHTML, /data-page="100"/);
  assert.match(root.innerHTML, />…<\/span>/);
});

test('page-size selector offers exactly 50 and 100 and changing size is a first-page action', () => {
  const { renderPagination } = renderPaginationHarness();
  const root = { className: '', dataset: {}, innerHTML: '' };
  renderPagination(root, 'intake', { page: 2, pageSize: 100, total: 501 }, () => {});
  assert.match(root.innerHTML, /data-pagination-size/);
  const values = [...root.innerHTML.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(values, [50, 100]);

  assert.match(app, /paginationRegistry\.get\(/);
  assert.match(app, /closest\(['"]\[data-pagination-action\]['"]\)/);
  assert.match(app, /closest\(['"]\[data-pagination-size\]['"]\)/);
  assert.match(app, /data-pagination-size[\s\S]{0,500}(?:page\s*:\s*1|page\s*=\s*1)/);
});

test('zero and single-page results expose counts without fake navigation buttons', () => {
  const { renderPagination } = renderPaginationHarness();
  for (const input of [
    { page: 1, pageSize: 50, total: 0 },
    { page: 1, pageSize: 50, total: 1 },
    { page: 1, pageSize: 50, total: 50 },
  ]) {
    const root = { className: '', dataset: {}, innerHTML: '' };
    renderPagination(root, 'empty-boundary', input, () => {});
    assert.match(root.innerHTML, new RegExp(`共 ${input.total} 条`));
    const totalPages = Math.ceil(input.total / input.pageSize);
    assert.match(root.innerHTML, new RegExp(`第 ${input.total ? 1 : 0} / ${totalPages} 页`));
    assert.equal(input.totalPages, totalPages);
    assert.doesNotMatch(root.innerHTML, /<button\b/);
    assert.doesNotMatch(root.innerHTML, /data-pagination-size/);
  }
});

test('current-page assignment stays explicit while all-filtered selection is separately confirmed', () => {
  const assignmentScope = functionBlock(app, 'currentIntakeAssignmentScope');
  assert.match(assignmentScope, /const itemIds = visibleOrder/);
  assert.match(assignmentScope, /scopeType:\s*'selection', itemIds/);
  assert.match(assignmentScope, /state\.intakeSelectAllScope[\s\S]*scopeType:\s*'all_filtered'/);
  assert.match(app, /window\.confirm\(`将选择全部筛选结果/);
  assert.match(assignmentScope, /return null/);
});

test('filter and business-tab resets request page one rather than appending another page', () => {
  const authorizedLoader = functionBlock(app, 'loadAuthorizedBusinessPage');
  assert.match(authorizedLoader, /if\s*\(reset\)[\s\S]{0,450}page\s*:\s*1/);
  assert.doesNotMatch(authorizedLoader, /meta\.page\s*\+\s*1/);
  assert.doesNotMatch(authorizedLoader, /\[\.\.\.meta\.rows,\s*\.\.\.result\.rows\]/);

  for (const loaderName of [
    'loadIntakePage',
    'loadCustomerPage',
    'loadResearch',
    'loadRecycleBin',
    'loadTeamCollaboration',
    'loadActivityCorrectionProposals',
    'loadActivityCorrections',
    'loadAiTasks',
  ]) {
    const loader = functionBlock(app, loaderName);
    assert.match(loader, /reset/);
    assert.doesNotMatch(loader, /(?:page|Page)\s*\+\s*1/, `${loaderName} must request a target page`);
    assert.doesNotMatch(loader, /\.\.\.(?:result\.rows|\(result\.rows)/,
      `${loaderName} must replace the visible page instead of accumulating rows`);
  }
  assert.doesNotMatch(functionBlock(app, 'loadIntakePage'), /intakePage\s*\+\s*1|\.\.\.previousItems/);
  assert.doesNotMatch(functionBlock(app, 'loadRecycleBin'), /page=1&pageSize=100/);
  assert.match(app, /renderPagination\(config\?\.pagination/);

  assert.match(app, /onApply:[\s\S]{0,160}\{\s*reset:\s*true/);
  for (const tabHook of [
    'data-severity',
    'data-notification-status',
    'data-team-section',
    'data-team-progress-drilldown',
    'data-manager-range',
  ]) {
    const position = app.indexOf(`closest('[${tabHook}]')`);
    assert.notEqual(position, -1, `missing ${tabHook} tab hook`);
    const nearby = app.slice(position, position + 1800);
    assert.match(nearby, /(?:page\s*=\s*1|page\s*:\s*1|reset:\s*true)/,
      `${tabHook} changes must return the affected list to page 1`);
  }
});

test('every principal business list mounts the shared pagination component', () => {
  const expected = {
    intake: '线索池',
    customers: 'CRM 客户全景',
    contacts: '客户联系人线索',
    recon: 'Recon 情报',
    recycle_bin: '客户回收站',
    pipeline: '推进管道',
    alerts: '今日待办',
    notifications: '通知中心',
    manager_tasks: '主管协助事项',
    correction_history: '更正历史',
    correction_proposals: '更正审批',
    manager_metrics: '延期统计',
    manager_risks: '介入风险',
    team_progress: '团队推进明细',
    team_collaboration: '团队协作明细',
    insights: '客户经营复盘',
    protected_conflicts: '合作客户保护冲突',
    ai_tasks: 'AI 任务中心',
  };
  for (const [key, label] of Object.entries(expected)) {
    assert.match(
      `${html}\n${app}`,
      new RegExp(`data-pagination=["']${key}["']`),
      `${label} (${key}) must mount shared pagination`,
    );
  }
});

test('shared pagination CSS wraps on mobile without horizontal scrolling', () => {
  assert.match(css, /\.shared-pagination\s*\{[^}]*max-width\s*:\s*100%/);
  assert.match(css, /\.shared-pagination-controls\s*\{[^}]*flex-wrap\s*:\s*wrap/);
  assert.match(css, /\.shared-pagination-pages\s*\{[^}]*flex-wrap\s*:\s*wrap/);
  assert.match(css, /@media\s*\(max-width\s*:\s*\d+px\)[\s\S]*\.shared-pagination/);

  const paginationRules = [...css.matchAll(/\.shared-pagination[^\{]*\{([^}]*)\}/g)]
    .map(match => match[1]).join('\n');
  assert.doesNotMatch(paginationRules, /overflow-x\s*:\s*(?:auto|scroll)/);
});

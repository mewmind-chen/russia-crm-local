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

function renderedPermissionEditors() {
  const source = `
    const state = { data: {
      permissionDefinitions: { view_dashboard: '经营驾驶舱', manage_intake: '管理线索', manage_users: '管理用户' },
      permissionDescriptions: {},
    } };
    const PERMISSION_CATEGORIES = [
      { key: 'scope', label: '客户范围', description: '决定这个角色能看到哪些客户资料。', sensitivity: 'danger', permissions: ['view_dashboard'] },
      { key: 'action', label: '客户动作', description: '决定这个角色能对客户执行哪些业务动作。', sensitivity: '', permissions: ['manage_intake'] },
      { key: 'admin', label: '管理与审计', description: '管理、审计、导出与权限维护能力。', sensitivity: '', permissions: ['manage_users'] },
      { key: 'module', label: '模块入口', description: '决定这个角色可以进入哪些页面。', sensitivity: '', permissions: [] },
    ];
    const esc = value => String(value || '');
    const visiblePermissionDefinitions = () => state.data.permissionDefinitions;
    const visibleCategoryPermissions = (category, definitions) => category.permissions.filter(key => definitions[key]);
    const permissionDescription = (category, key, label) => label;
    ${functionBlock(app, 'permissionCategoryMarkup')}
    ${functionBlock(app, 'personalPermissionFields')}
    ${functionBlock(app, 'permissionFields')}
    ({ personal: personalPermissionFields({}), group: permissionFields({}) });
  `;
  return vm.runInNewContext(source);
}

function renderedElements(markup, tagName) {
  const elements = [];
  const matcher = new RegExp(`<${tagName}\\b([^>]*)>`, 'g');
  for (const match of markup.matchAll(matcher)) {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
    );
    elements.push({ attributes });
  }
  return elements;
}

function trackedClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function permissionGroupFormHarness({ groupId = 'PGRP-EDIT', role = 'sales', roleDisabled = true } = {}) {
  const resetButton = { focused: false, focus() { this.focused = true; } };
  const cancelButton = { focused: false, focus() { this.focused = true; } };
  const confirmation = {
    classList: trackedClassList(['hidden']),
    querySelector(selector) { return selector === '#cancelPermissionGroupDefaults' ? cancelButton : null; },
  };
  const roleSelect = { value: role, disabled: roleDisabled };
  const inputs = [
    { name: 'permission__view_dashboard', checked: false, focused: false, focus() { this.focused = true; } },
    { name: 'permission__view_contacts', checked: true, focused: false, focus() { this.focused = true; } },
  ];
  const form = {
    dataset: {},
    classList: trackedClassList(),
    elements: { groupId: { value: groupId } },
    entries: [
      ['groupId', groupId],
      ['name', 'Executable group'],
      ['description', 'Behavior test'],
    ],
    querySelector(selector) {
      if (selector.startsWith('select[name="role"]')) return roleSelect;
      if (selector === '.permission-group-reset-confirm') return confirmation;
      if (selector === '#restorePermissionGroupDefaults') return resetButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[name^="permission__"]' || selector === 'input[type=checkbox]') return inputs;
      return [];
    },
  };
  return { form, roleSelect, inputs, confirmation, resetButton, cancelButton };
}

function permissionGroupProductionApi(state) {
  class TestFormData {
    constructor(form) { this.form = form; }
    entries() { return this.form.entries[Symbol.iterator](); }
  }
  const source = `
    const PERMISSION_PACKS = [{ key: 'sales', role: 'sales' }, { key: 'manager', role: 'manager' }, { key: 'admin', role: 'admin' }];
    const visiblePermissionDefinitions = () => state.data.permissionDefinitions || {};
    ${functionBlock(app, 'formPayload')}
    ${functionBlock(app, 'permissionsFromPayload')}
    ${functionBlock(app, 'permissionGroupRole')}
    ${functionBlock(app, 'applyPermissionGroupDefaults')}
    ${functionBlock(app, 'hidePermissionGroupResetConfirmation')}
    ${functionBlock(app, 'showPermissionGroupResetConfirmation')}
    ${functionBlock(app, 'cancelPermissionGroupReset')}
    ${functionBlock(app, 'permissionConclusion')}
    ${functionBlock(app, 'permissionPackActive')}
    ${functionBlock(app, 'refreshPermissionGroupSummary')}
    ${functionBlock(app, 'confirmPermissionGroupReset')}
    ${functionBlock(app, 'permissionGroupPermissions')}
    ({ formPayload, permissionGroupRole, showPermissionGroupResetConfirmation,
      cancelPermissionGroupReset, confirmPermissionGroupReset, permissionGroupPermissions });
  `;
  return vm.runInNewContext(source, { state, FormData: TestFormData, Object, Boolean });
}

function permissionTabHarness() {
  const tabs = ['scope', 'action', 'admin', 'module'].map((key, index) => {
    const classNames = new Set(index === 0 ? ['active'] : []);
    const tab = {
      dataset: { permissionCategory: key },
      disabled: key === 'action',
      tabIndex: index === 0 ? 0 : -1,
      focused: false,
      clicks: 0,
      classList: {
        toggle(name, enabled) { if (enabled) classNames.add(name); else classNames.delete(name); },
        contains(name) { return classNames.has(name); },
      },
      setAttribute(name, value) { this[name] = String(value); },
      closest(selector) { return selector.includes('[data-permission-category]') ? this : null; },
      focus() { this.focused = true; },
    };
    return tab;
  });
  const panels = tabs.map((tab, index) => {
    const classNames = new Set(index === 0 ? [] : ['hidden']);
    return {
      dataset: { permissionPanel: tab.dataset.permissionCategory },
      classList: {
        toggle(name, enabled) { if (enabled) classNames.add(name); else classNames.delete(name); },
        contains(name) { return classNames.has(name); },
      },
    };
  });
  const $$ = selector => selector.includes('data-permission-category') ? tabs : panels;
  const source = `
    ${functionBlock(app, 'selectPermissionCategoryTab')}
    ${functionBlock(app, 'navigatePermissionCategoryTab')}
    ({ selectPermissionCategoryTab, navigatePermissionCategoryTab });
  `;
  const api = vm.runInNewContext(source, { $$ });
  tabs.forEach(tab => {
    tab.click = () => {
      tab.clicks += 1;
      api.selectPermissionCategoryTab(tab);
    };
  });
  return { tabs, panels, api };
}

function press(harness, tab, key) {
  let prevented = false;
  const handled = harness.api.navigatePermissionCategoryTab({
    key,
    target: tab,
    preventDefault() { prevented = true; },
  });
  return { handled, prevented };
}

function specificity(selector) {
  return [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length,
    (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length,
  ];
}

function outranks(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

test('Issue 293 permission editor assets use the current cache token', () => {
  assert.match(html, /app\.css\?v=20260821-issue335-action-command-v1/);
  assert.match(html, /app\.js\?v=20260821-issue335-action-command-v1/);
});

test('Issue 293 uses current module names once and removes stale navigation wording', () => {
  const categories = section(app, 'const PERMISSION_CATEGORIES', 'function permissionCategoryMarkup');
  const permissionPresentationSource = section(app, 'function visiblePermissionDefinitions', 'function applyBusinessAIVisibility');
  for (const label of ['经营驾驶舱', '今日待办', '通知中心', '查看线索池', '查看客户联系人线索',
    'Recon 情报', '查看本人负责客户', '查看团队与全公司客户', '查看不对口记录', '推进管道', '主管协助事项',
    '查看团队状态', '客户经营复盘', '用户与权限', '查看查重候选与保护名单', '数据维护']) {
    assert.match(permissionPresentationSource, new RegExp(label));
  }
  assert.doesNotMatch(permissionPresentationSource, /客户回收站|客户开发工作台/);
  assert.equal((categories.match(/'view_intake'/g) || []).length, 1);
  assert.match(app, /team: 'view_team'/);
});

test('every visible permission card has category-aware explanatory copy', () => {
  const groupFields = section(app, 'function permissionFields', 'function openEditUserModal');
  assert.match(groupFields, /permissionDescription\(/);
  assert.match(app, /允许进入/);
  assert.match(app, /允许执行/);
});

test('category counts use only definitions that are actually rendered', () => {
  assert.match(app, /function visibleCategoryPermissions\(/);
  assert.match(app, /visiblePermissions\.length/);
  assert.match(app, /本页 \$\{visiblePermissions\.length\} 项/);
});

test('group editor uses a dedicated wide modal shell and layout contracts', () => {
  const modal = section(app, 'function openPermissionGroupModal', 'function openOverridesModal');
  assert.match(modal, /permission-group-modal/);
  assert.match(modal, /permission-group-form/);
  assert.match(modal, /permission-group-layout/);
  assert.match(modal, /permission-group-profile/);
  assert.match(modal, /data-permission-conclusion/);
  assert.match(modal, /data-permission-packs/);
  assert.match(modal, /permission-group-editor/);
  assert.match(modal, /permission-group-footer/);
  assert.doesNotMatch(modal, /PERMISSION GROUP/);
  assert.match(css, /\.permission-group-modal\{[^}]*width:min\(1320px,calc\(100vw - 48px\)\)/);
  assert.match(css, /\.permission-group-modal\{[^}]*overflow:hidden/);
  assert.match(css, /\.permission-group-layout\{[^}]*grid-template-columns:330px minmax\(0,1fr\)/);
  assert.match(css, /\.permission-group-modal \.permission-switch-panel\{[^}]*overflow:visible/);
  assert.match(css, /\.permission-group-footer\{[^}]*position:sticky/);
  assert.match(css, /@media\(max-width:1099px\)[\s\S]*permission-group-modal[\s\S]*overflow:auto/);
});

test('group footer padding outranks the later generic modal action rule', () => {
  const footerSelector = '#modal .permission-group-footer';
  const footerStart = css.indexOf(`${footerSelector}{`);
  const genericStart = css.indexOf('.modal .form-actions{');
  assert.ok(footerStart >= 0, 'group footer rule is present');
  assert.ok(genericStart > footerStart, 'generic modal action rule follows the group footer rule');
  assert.match(css.slice(footerStart, css.indexOf('}', footerStart) + 1), /padding:12px 24px/);
  assert.ok(
    outranks(specificity(footerSelector), specificity('.modal .form-actions')),
    'group footer selector must outrank the later generic selector',
  );
});

test('reset confirmation replaces guidance in the existing three-row desktop grid', () => {
  assert.match(css, /\.permission-group-form\{[^}]*grid-template-areas:"layout" "reset" "footer"/);
  assert.match(css, /\.permission-group-layout\{grid-area:layout/);
  assert.match(css, /\.permission-group-reset-confirm\{grid-area:reset/);
  assert.match(css, /#modal \.permission-group-footer\{[^}]*grid-area:footer/);
});

test('existing group reset uses inline confirmation and role-template serialization', () => {
  const groupModal = section(app, 'function openPermissionGroupModal', 'function openOverridesModal');
  assert.match(groupModal, /id="restorePermissionGroupDefaults"/);
  assert.match(groupModal, /只恢复当前权限组的权限开关/);
  assert.match(groupModal, /个人权限例外、其他权限组、名称、角色和描述不会改变/);
  assert.match(groupModal, /保存权限组后生效/);
});

test('group defaults update only rendered switches', () => {
  const rendered = [
    { name: 'permission__view_dashboard', checked: false },
    { name: 'permission__view_contacts', checked: true },
  ];
  const unrelated = { name: 'description', checked: true };
  const form = {
    querySelectorAll(selector) {
      assert.equal(selector, '[name^="permission__"]');
      return rendered;
    },
  };
  const source = `${functionBlock(app, 'applyPermissionGroupDefaults')}; applyPermissionGroupDefaults`;
  const applyPermissionGroupDefaults = vm.runInNewContext(source);
  applyPermissionGroupDefaults(form, { view_dashboard: true, view_contacts: false, view_development: true });
  assert.deepEqual(rendered.map(input => input.checked), [true, false]);
  assert.equal(unrelated.checked, true);
});

test('cancelling group reset leaves switches and reset state unchanged', () => {
  const state = { data: { rolePermissions: { sales: {} } } };
  const api = permissionGroupProductionApi(state);
  const harness = permissionGroupFormHarness();
  const checksBefore = harness.inputs.map(input => input.checked);

  api.showPermissionGroupResetConfirmation(harness.form);
  assert.equal(harness.form.classList.contains('permission-group-reset-visible'), true);
  assert.equal(harness.confirmation.classList.contains('hidden'), false);
  assert.equal(harness.cancelButton.focused, true);

  api.cancelPermissionGroupReset(harness.form);
  assert.deepEqual(harness.inputs.map(input => input.checked), checksBefore);
  assert.equal(Object.hasOwn(harness.form.dataset, 'permissionsReset'), false);
  assert.equal(harness.confirmation.classList.contains('hidden'), true);
  assert.equal(harness.form.classList.contains('permission-group-reset-visible'), false);
  assert.equal(harness.resetButton.focused, true);
});

test('production role and serialization helpers preserve complete hidden maps', () => {
  const roleTemplate = {
    view_dashboard: true,
    view_contacts: true,
    view_development: true,
    view_pool: true,
  };
  const existingGroup = {
    role: 'sales',
    permissions: {
      view_dashboard: false,
      view_contacts: true,
      view_development: false,
      view_pool: false,
    },
  };
  const state = { data: {
    permissionDefinitions: Object.fromEntries(Object.keys(roleTemplate).map(key => [key, key])),
    rolePermissions: { sales: roleTemplate },
  } };
  const api = permissionGroupProductionApi(state);
  const harness = permissionGroupFormHarness({ role: 'manager', roleDisabled: true });
  harness.inputs.find(input => input.name === 'permission__view_dashboard').checked = true;
  harness.inputs.find(input => input.name === 'permission__view_contacts').checked = false;

  assert.equal(api.permissionGroupRole(harness.form, existingGroup), 'sales');
  let payload = api.formPayload(harness.form);
  let permissions = api.permissionGroupPermissions(harness.form, payload, existingGroup);
  assert.deepEqual({ ...permissions }, {
    view_dashboard: true,
    view_contacts: false,
    view_development: false,
    view_pool: false,
  });
  assert.equal(Object.hasOwn(payload, 'permission__view_dashboard'), false);

  api.confirmPermissionGroupReset(harness.form, existingGroup);
  assert.equal(harness.form.dataset.permissionsReset, 'true');
  assert.equal(harness.inputs.some(input => input.focused), false);
  assert.equal(harness.resetButton.focused, true);
  assert.equal(harness.confirmation.classList.contains('hidden'), true);
  assert.equal(harness.form.classList.contains('permission-group-reset-visible'), false);

  harness.inputs.find(input => input.name === 'permission__view_contacts').checked = false;
  payload = api.formPayload(harness.form);
  permissions = api.permissionGroupPermissions(harness.form, payload, existingGroup);
  assert.deepEqual({ ...permissions }, {
    view_dashboard: true,
    view_contacts: false,
    view_development: true,
    view_pool: true,
  });
  assert.deepEqual(Object.keys(permissions).sort(), Object.keys(roleTemplate).sort());
});

test('new-group role changes reapply defaults and clear stale reset state', () => {
  const roleChange = section(
    app,
    "if (event.target.matches('#permissionGroupForm select[name=\"role\"]'))",
    '\n    }\n  });',
  );
  assert.match(roleChange, /applyPermissionGroupDefaults\(form, defaults\)/);
  assert.match(roleChange, /delete form\.dataset\.permissionsReset/);
  assert.match(roleChange, /!form\.elements\.groupId\.value/);
});

test('rendered group and personal tabs reciprocally link panels with one tab stop', () => {
  const editors = renderedPermissionEditors();
  for (const markup of Object.values(editors)) {
    const tabs = renderedElements(markup, 'button');
    const panels = renderedElements(markup, 'section');
    assert.equal(tabs.filter(tab => tab.attributes.tabindex === '0').length, 1);
    assert.equal(tabs.filter(tab => tab.attributes.tabindex === '-1').length, tabs.length - 1);
    for (const tab of tabs) {
      const panel = panels.find(item => item.attributes.id === tab.attributes['aria-controls']);
      assert.ok(panel, `${tab.attributes.id} controls a rendered panel`);
      assert.equal(panel.attributes.role, 'tabpanel');
      assert.equal(panel.attributes['aria-labelledby'], tab.attributes.id);
    }
  }
});

test('permission tab keyboard navigation wraps enabled tabs through click delegation', () => {
  const harness = permissionTabHarness();
  const [first, disabled, , last] = harness.tabs;
  assert.deepEqual(press(harness, first, 'ArrowLeft'), { handled: true, prevented: true });
  assert.equal(last.focused, true);
  assert.equal(last.clicks, 1);
  assert.equal(last['aria-selected'], 'true');
  assert.equal(last.tabIndex, 0);
  assert.equal(first.tabIndex, -1);
  assert.equal(harness.panels[3].classList.contains('hidden'), false);
  assert.equal(harness.panels[0].classList.contains('hidden'), true);
  assert.equal(disabled.clicks, 0, 'disabled tab is skipped');

  assert.deepEqual(press(harness, last, 'ArrowRight'), { handled: true, prevented: true });
  assert.equal(first.focused, true);
  assert.equal(first.clicks, 1);
  assert.equal(first['aria-selected'], 'true');
});

test('Home and End select the first and last enabled permission tabs', () => {
  const harness = permissionTabHarness();
  const [first, , , last] = harness.tabs;
  press(harness, first, 'End');
  assert.equal(last.clicks, 1);
  assert.equal(last['aria-selected'], 'true');
  press(harness, last, 'Home');
  assert.equal(first.clicks, 1);
  assert.equal(first['aria-selected'], 'true');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const componentPath = path.join(__dirname, '..', 'sales-assets', 'filter-component.js');
const cssPath = path.join(__dirname, '..', 'sales-assets', 'filter-component.css');
const {
  createFilterController,
  renderFilterComponent,
  mountFilterComponent,
} = require(componentPath);

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function schema(overrides = {}) {
  return {
    schemaVersion: 'schema-1',
    permissionVersion: 'permission-1',
    fields: [
      {
        key: 'search',
        label: '关键词',
        type: 'search',
        operator: 'contains',
        placement: 'search',
        placeholder: '搜索企业、网站或产品',
      },
      {
        key: 'country',
        label: '国家 / 地区',
        type: 'facet',
        operator: 'in',
        placement: 'facet',
        multi: true,
        options: [
          { value: 'RU', label: '俄罗斯' },
          { value: 'BR', label: '巴西' },
        ],
      },
      {
        key: 'tag_customer_type',
        label: '客户类型',
        type: 'tag',
        operator: 'in',
        placement: 'tag',
        multi: true,
        options: [
          { value: 'manufacturer', label: '终端制造商' },
          { value: 'ems', label: 'EMS / 代工厂' },
        ],
      },
      {
        key: 'owner',
        label: '分配销售',
        type: 'select',
        operator: 'eq',
        placement: 'more',
        options: [
          { value: 'U-1', label: '销售 A' },
          { value: 'U-2', label: '销售 B' },
        ],
      },
    ],
    ...overrides,
  };
}

test('controllers isolate persisted state by pageKey and schemaVersion', () => {
  const storage = new MemoryStorage();
  const customers = createFilterController({ pageKey: 'customers', schema: schema(), storage });
  const pipeline = createFilterController({ pageKey: 'pipeline', schema: schema(), storage });

  customers.setDraft('country', ['RU']);
  customers.apply();

  assert.deepEqual(customers.getState().applied.country, ['RU']);
  assert.deepEqual(pipeline.getState().applied, {});
  assert.equal(customers.getState().schemaVersion, 'schema-1');
  assert.match(customers.storageKey, /tradepulse\.authorizedFilters\.customers$/);
  assert.match(pipeline.storageKey, /tradepulse\.authorizedFilters\.pipeline$/);
});

test('draft values remain separate until apply and apply emits a fixed query contract', () => {
  const storage = new MemoryStorage();
  const calls = [];
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage,
    onApply: payload => calls.push(payload),
  });

  controller.setDraft('search', '  控制器  ');
  controller.toggleValue('country', 'RU');

  assert.deepEqual(controller.getState().applied, {});
  assert.equal(controller.getState().draft.search, '控制器');
  assert.deepEqual(controller.getState().draft.country, ['RU']);

  const payload = controller.apply();
  assert.deepEqual(payload, {
    pageKey: 'customers',
    schemaVersion: 'schema-1',
    permissionVersion: 'permission-1',
    filters: [
      { field: 'search', operator: 'contains', value: '控制器' },
      { field: 'country', operator: 'in', value: ['RU'] },
    ],
  });
  assert.deepEqual(calls, [payload]);
  assert.deepEqual(controller.getState().applied, {
    search: '控制器',
    country: ['RU'],
  });
});

test('restored state intersects the current authorized fields and option values', () => {
  const storage = new MemoryStorage();
  storage.setItem('tradepulse.authorizedFilters.customers', JSON.stringify({
    schemaVersion: 'schema-old',
    permissionVersion: 'permission-old',
    draft: {
      search: '医疗',
      country: ['RU', 'DE'],
      hidden_margin: ['high'],
    },
    applied: {
      search: '医疗',
      country: ['RU', 'DE'],
      hidden_margin: ['high'],
    },
  }));

  const controller = createFilterController({ pageKey: 'customers', schema: schema(), storage });

  assert.deepEqual(controller.getState().draft, {
    search: '医疗',
    country: ['RU'],
  });
  assert.deepEqual(controller.getState().applied, {
    search: '医疗',
    country: ['RU'],
  });
  assert.doesNotMatch(storage.getItem(controller.storageKey), /hidden_margin|DE/);
});

test('toggle supports same-category OR selection, single removal and clear all', () => {
  const calls = [];
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage: new MemoryStorage(),
    onApply: payload => calls.push(payload),
  });

  controller.toggleValue('tag_customer_type', 'manufacturer');
  controller.toggleValue('tag_customer_type', 'ems');
  assert.deepEqual(controller.getState().draft.tag_customer_type, ['manufacturer', 'ems']);

  controller.apply();
  controller.remove('tag_customer_type', 'manufacturer');
  assert.deepEqual(controller.getState().draft.tag_customer_type, ['ems']);
  assert.deepEqual(controller.getState().applied.tag_customer_type, ['ems']);

  controller.clearAll();
  assert.deepEqual(controller.getState().draft, {});
  assert.deepEqual(controller.getState().applied, {});
  assert.equal(calls.length, 3);
});

test('removing an applied chip preserves a different pending draft value', () => {
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage: new MemoryStorage(),
  });
  controller.setDraft('owner', 'U-1');
  controller.apply();
  controller.setDraft('owner', 'U-2');

  controller.remove('owner', 'U-1', { apply: false });

  assert.equal(controller.getState().draft.owner, 'U-2');
  assert.equal(controller.getState().applied.owner, undefined);
});

test('an unchecked boolean is an absent filter instead of an eq false condition', () => {
  const controller = createFilterController({
    pageKey: 'intake',
    schema: schema({
      fields: [{
        key: 'unassigned_only',
        label: '仅看未分配',
        type: 'boolean',
        operator: 'eq',
        placement: 'more',
      }],
    }),
    storage: new MemoryStorage(),
  });
  controller.setDraft('unassigned_only', true);
  assert.deepEqual(controller.serialize('draft').filters, [
    { field: 'unassigned_only', operator: 'eq', value: true },
  ]);

  controller.setDraft('unassigned_only', false);
  assert.deepEqual(controller.serialize('draft').filters, []);
});

test('serialization ignores unauthorized fields and never accepts caller-supplied operators', () => {
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage: new MemoryStorage(),
  });

  assert.equal(controller.setDraft('secret_profit', ['high']), false);
  assert.equal(controller.setDraft('country', ['RU', 'UNKNOWN']), true);
  controller.setDraft('owner', 'U-2');

  assert.deepEqual(controller.serialize('draft').filters, [
    { field: 'country', operator: 'in', value: ['RU'] },
    { field: 'owner', operator: 'eq', value: 'U-2' },
  ]);
  assert.equal(JSON.stringify(controller.serialize('draft')).includes('secret_profit'), false);
});

test('permission version changes immediately remove revoked state and persisted values', () => {
  const storage = new MemoryStorage();
  const permissionChanges = [];
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage,
    onPermissionChange: event => permissionChanges.push(event),
  });
  controller.setDraft('country', ['RU']);
  controller.setDraft('owner', 'U-1');
  controller.apply();

  controller.updateSchema(schema({
    schemaVersion: 'schema-2',
    permissionVersion: 'permission-2',
    fields: schema().fields.filter(field => field.key !== 'owner'),
  }));

  assert.deepEqual(controller.getState().draft, { country: ['RU'] });
  assert.deepEqual(controller.getState().applied, { country: ['RU'] });
  assert.equal(controller.getState().schemaVersion, 'schema-2');
  assert.equal(controller.getState().permissionVersion, 'permission-2');
  assert.equal(permissionChanges.length, 1);
  assert.doesNotMatch(storage.getItem(controller.storageKey), /owner|U-1/);
});

test('schema-driven rendering includes authorized search, facets, tags, chips and result meta only', () => {
  const html = renderFilterComponent({
    schema: schema(),
    state: {
      draft: {
        search: '工业',
        country: ['RU'],
        tag_customer_type: ['manufacturer', 'ems'],
      },
      applied: {
        search: '工业',
        country: ['RU'],
      },
    },
    resultMeta: { total: 14, shown: 14 },
  });

  assert.match(html, /tp-filter-component/);
  assert.match(html, /搜索企业、网站或产品/);
  assert.match(html, /data-filter-field="country"/);
  assert.match(html, /国家 \/ 地区/);
  assert.match(html, /客户类型/);
  assert.match(html, /终端制造商/);
  assert.match(html, /EMS \/ 代工厂/);
  assert.match(html, /已启用条件/);
  assert.match(html, /14 条结果/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /hidden_margin|secret_profit/);
});

test('renderer supports loading, error and no-authorized-filter states without leaking fields', () => {
  assert.match(renderFilterComponent({ status: 'loading' }), /正在加载可用筛选项/);
  assert.match(renderFilterComponent({
    status: 'error',
    error: '权限结构读取失败',
    schema: schema({ fields: [] }),
  }), /权限结构读取失败/);
  assert.match(renderFilterComponent({
    status: 'ready',
    schema: schema({ fields: [] }),
  }), /当前没有可用筛选项/);
});

test('mount API is exported and component CSS covers desktop facets and 390px mobile layout', () => {
  assert.equal(typeof mountFilterComponent, 'function');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /\.tp-filter-facet-row/);
  assert.match(css, /\.tp-filter-option\[aria-pressed="true"\]/);
  assert.match(css, /#0f766e/i);
  assert.match(css, /@media\s*\(max-width:\s*780px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
  assert.match(css, /flex-wrap:\s*wrap/);
});

test('compact layout keeps common fields visible and advanced filters collapsed', () => {
  const html = renderFilterComponent({
    schema: schema({
      fields: [
        ...schema().fields,
        {
          key: 'stage',
          label: '客户阶段',
          type: 'select',
          operator: 'eq',
          placement: 'more',
          options: [{ value: 'qualified', label: '已确认' }],
        },
        {
          key: 'updated_range',
          label: '更新时间',
          type: 'date_range',
          operator: 'between',
          placement: 'more',
        },
      ],
    }),
    state: { draft: {}, applied: {} },
    resultMeta: { total: 42, shown: 42 },
  });

  assert.match(html, /class="tp-filter-primary-row"/);
  assert.match(html, /class="tp-filter-menu"/);
  assert.match(html, /data-filter-basic="owner"/);
  assert.match(html, /data-filter-basic="stage"/);
  assert.match(html, /<details class="tp-filter-advanced">/);
  assert.doesNotMatch(html, /<details class="tp-filter-advanced" open/);
  assert.match(html, /更新时间/);
  assert.match(html, /42 条结果/);
});

test('studio filter keeps one footer row: text 详细筛选 plus current-result copy', () => {
  const html = renderFilterComponent({
    schema: schema({
      fields: [
        ...schema().fields,
        {
          key: 'stage',
          label: '客户阶段',
          type: 'select',
          operator: 'eq',
          placement: 'more',
          options: [{ value: 'qualified', label: '已确认' }],
        },
      ],
    }),
    state: { draft: {}, applied: {} },
    resultMeta: { total: 18, shown: 18 },
  });
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(html, /class="tp-filter-foot"/);
  assert.match(html, /<div class="tp-filter-foot">[\s\S]*<details class="tp-filter-advanced">[\s\S]*<div class="tp-filter-applied">/);
  assert.match(html, /当前结果/);
  assert.match(html, /18 条结果/);
  assert.match(html, /暂无条件，显示当前权限范围内全部数据/);
  assert.match(css, /\.tp-filter-foot\s*\{/);
  assert.match(css, /\.tp-filter-advanced > summary\s*\{[^}]*border:\s*0/);
  assert.match(css, /\.tp-filter-applied\s*\{[^}]*background:\s*(?:none|transparent)/);
});

test('presentation grouping does not alter serialized authorization payload', () => {
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage: new MemoryStorage(),
  });
  controller.setDraft('search', '电源');
  controller.toggleValue('country', 'RU');
  controller.setDraft('owner', 'U-1');

  assert.deepEqual(controller.apply().filters, [
    { field: 'search', operator: 'contains', value: '电源' },
    { field: 'country', operator: 'in', value: ['RU'] },
    { field: 'owner', operator: 'eq', value: 'U-1' },
  ]);
});

test('primary multi-select rerender restores only the active menu disclosure', () => {
  class FilterRoot {
    constructor() {
      this.listeners = {};
      this.menus = [];
      this.html = '';
    }

    set innerHTML(value) {
      this.html = value;
      this.menus = [...value.matchAll(/data-filter-menu="([^"]+)"/g)].map(match => ({
        dataset: { filterMenu: match[1] },
        open: false,
      }));
    }

    get innerHTML() {
      return this.html;
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    removeEventListener(type) {
      delete this.listeners[type];
    }

    contains() {
      return true;
    }

    querySelectorAll(selector) {
      return selector === '[data-filter-menu]' ? this.menus : [];
    }
  }

  const root = new FilterRoot();
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema({
      fields: [
        ...schema().fields,
        {
          key: 'status',
          label: '线索状态',
          type: 'facet',
          operator: 'in',
          placement: 'facet',
          multi: true,
          options: [{ value: 'new', label: '新线索' }],
        },
      ],
    }),
    storage: new MemoryStorage(),
  });
  mountFilterComponent(root, { controller });

  const countryMenu = root.menus.find(menu => menu.dataset.filterMenu === 'country');
  const countryOption = {
    dataset: { filterField: 'country', filterValue: 'RU' },
    closest: selector => (selector === '[data-filter-menu]' ? countryMenu : null),
  };
  root.listeners.click({
    target: {
      closest(selector) {
        if (selector === '.tp-filter-option[data-filter-value]') return countryOption;
        return null;
      },
    },
  });

  assert.deepEqual(controller.getState().draft.country, ['RU']);
  assert.equal(root.menus.find(menu => menu.dataset.filterMenu === 'country').open, true);
  assert.equal(root.menus.find(menu => menu.dataset.filterMenu === 'status').open, false);

  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-apply]' ? {} : null),
    },
  });
  assert.equal(root.menus.every(menu => menu.open === false), true);

  const currentCountryMenu = root.menus.find(menu => menu.dataset.filterMenu === 'country');
  const countryAll = {
    dataset: { filterField: 'country' },
    closest: selector => (selector === '[data-filter-menu]' ? currentCountryMenu : null),
  };
  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-all]' ? countryAll : null),
    },
  });
  assert.equal(controller.getState().draft.country, undefined);
  assert.equal(root.menus.find(menu => menu.dataset.filterMenu === 'country').open, true);
  assert.equal(root.menus.find(menu => menu.dataset.filterMenu === 'status').open, false);

  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-clear]' ? {} : null),
    },
  });
  assert.equal(root.menus.every(menu => menu.open === false), true);

  const nextCountryMenu = root.menus.find(menu => menu.dataset.filterMenu === 'country');
  const nextCountryOption = {
    dataset: { filterField: 'country', filterValue: 'RU' },
    closest: selector => (selector === '[data-filter-menu]' ? nextCountryMenu : null),
  };
  root.listeners.click({
    target: {
      closest(selector) {
        if (selector === '.tp-filter-option[data-filter-value]') return nextCountryOption;
        return null;
      },
    },
  });
  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-apply]' ? {} : null),
    },
  });
  assert.deepEqual(controller.getState().applied.country, ['RU']);
  const removeCountry = {
    dataset: { filterRemove: 'country', filterValue: 'RU' },
  };
  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-remove]' ? removeCountry : null),
    },
  });
  assert.equal(controller.getState().applied.country, undefined);
  assert.equal(root.menus.every(menu => menu.open === false), true);
});

test('advanced multi-select rerender preserves an open disclosure until apply or clear', () => {
  class FilterRoot {
    constructor() {
      this.listeners = {};
      this.advanced = null;
      this.html = '';
    }

    set innerHTML(value) {
      this.html = value;
      this.advanced = value.includes('class="tp-filter-advanced"') ? { open: false } : null;
    }

    get innerHTML() {
      return this.html;
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    removeEventListener(type) {
      delete this.listeners[type];
    }

    contains() {
      return true;
    }

    querySelector(selector) {
      return selector === '.tp-filter-advanced' ? this.advanced : null;
    }

    querySelectorAll() {
      return [];
    }
  }

  const root = new FilterRoot();
  const controller = createFilterController({
    pageKey: 'customers',
    schema: schema(),
    storage: new MemoryStorage(),
  });
  mountFilterComponent(root, { controller });

  root.advanced.open = true;
  const advancedOption = {
    dataset: { filterField: 'tag_customer_type', filterValue: 'manufacturer' },
    closest(selector) {
      return selector === '.tp-filter-advanced' ? root.advanced : null;
    },
  };
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === '.tp-filter-option[data-filter-value]' ? advancedOption : null;
      },
    },
  });

  assert.deepEqual(controller.getState().draft.tag_customer_type, ['manufacturer']);
  assert.equal(root.advanced.open, true);

  const advancedAll = {
    dataset: { filterField: 'tag_customer_type' },
    closest(selector) {
      return selector === '.tp-filter-advanced' ? root.advanced : null;
    },
  };
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === '[data-filter-all]' ? advancedAll : null;
      },
    },
  });

  assert.equal(controller.getState().draft.tag_customer_type, undefined);
  assert.equal(root.advanced.open, true);

  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-apply]' ? {} : null),
    },
  });
  assert.equal(root.advanced.open, false);

  root.advanced.open = true;
  root.listeners.click({
    target: {
      closest: selector => (selector === '[data-filter-clear]' ? {} : null),
    },
  });
  assert.equal(root.advanced.open, false);
});

test('customer filter initialization ignores stale concurrent schema responses', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
  const initializeSource = appSource.slice(
    appSource.indexOf('async function initializeCustomerFilters'),
    appSource.indexOf('function setLoginState'),
  );

  assert.match(initializeSource, /const initializeEpoch = \+\+state\.customerInitializeEpoch/);
  assert.match(
    initializeSource,
    /if \(initializeEpoch !== state\.customerInitializeEpoch\) return;/,
  );
  assert.match(appSource, /state\.customerInitializeEpoch \+= 1;/);
});

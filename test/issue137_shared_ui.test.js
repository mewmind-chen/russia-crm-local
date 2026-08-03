const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(rootDir, 'sales-assets', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(rootDir, 'sales-assets', 'app.css'), 'utf8');
const filterCss = fs.readFileSync(path.join(rootDir, 'sales-assets', 'filter-component.css'), 'utf8');
const {
  createFilterController,
  renderFilterComponent,
  mountFilterComponent,
} = require(path.join(rootDir, 'sales-assets', 'filter-component.js'));

function filterSchema() {
  return {
    schemaVersion: 'schema-137',
    permissionVersion: 'permission-137',
    fields: [
      {
        key: 'search',
        label: '关键词',
        type: 'search',
        operator: 'contains',
        placement: 'search',
      },
      {
        key: 'country',
        label: '国家/地区',
        type: 'facet',
        operator: 'in',
        placement: 'facet',
        multi: true,
        options: [{ value: 'RU', label: '俄罗斯' }],
      },
      {
        key: 'industry',
        label: '行业',
        type: 'facet',
        operator: 'in',
        placement: 'facet',
        multi: true,
        options: [{ value: 'industrial', label: '工业' }],
      },
      {
        key: 'updated_at',
        label: '更新时间',
        type: 'date_range',
        operator: 'between',
        placement: 'more',
      },
    ],
  };
}

test('shared advanced filter is a labelled secondary control with icon, count and arrow', () => {
  const html = renderFilterComponent({
    schema: filterSchema(),
    state: {
      draft: { industry: ['industrial'] },
      applied: {},
    },
  });

  assert.match(html, /<summary aria-expanded="false">/);
  assert.match(html, /class="tp-filter-advanced-icon"/);
  assert.match(html, /class="tp-filter-advanced-label">详细筛选<\/span>/);
  assert.match(html, /class="tp-filter-advanced-count" data-filter-advanced-count\s+aria-label="已选 1 个高级条件"\s+>1<\/span>/);
  assert.match(html, /class="tp-filter-advanced-arrow" aria-hidden="true">▼<\/span>/);
  assert.match(filterCss, /\.tp-filter-advanced > summary\s*\{[^}]*border:\s*1px solid/);
  assert.match(filterCss, /\.tp-filter-advanced (?:> )?summary:focus-visible/);
});

test('advanced filter disclosure synchronizes aria-expanded and visible arrow', () => {
  class FilterRoot {
    constructor() {
      this.listeners = {};
      this.advanced = null;
      this.html = '';
    }

    set innerHTML(value) {
      this.html = value;
      if (!value.includes('class="tp-filter-advanced"')) {
        this.advanced = null;
        return;
      }
      const arrow = { textContent: '▼' };
      const summary = {
        attributes: { 'aria-expanded': 'false' },
        setAttribute(name, nextValue) {
          this.attributes[name] = nextValue;
        },
        querySelector(selector) {
          return selector === '.tp-filter-advanced-arrow' ? arrow : null;
        },
      };
      this.advanced = {
        open: false,
        arrow,
        summary,
        closest(selector) {
          return selector === '.tp-filter-advanced' ? this : null;
        },
        querySelector(selector) {
          return selector === 'summary' ? summary : null;
        },
      };
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
    schema: filterSchema(),
  });
  mountFilterComponent(root, { controller });

  root.advanced.open = true;
  root.listeners.toggle({ target: root.advanced });
  assert.equal(root.advanced.summary.attributes['aria-expanded'], 'true');
  assert.equal(root.advanced.arrow.textContent, '▲');

  root.advanced.open = false;
  root.listeners.toggle({ target: root.advanced });
  assert.equal(root.advanced.summary.attributes['aria-expanded'], 'false');
  assert.equal(root.advanced.arrow.textContent, '▼');
});

test('all nine authorized business pages continue to use the shared filter component', () => {
  assert.match(appSource, /const pageKey = 'customers'/);
  ['contacts', 'recon'].forEach(pageKey => {
    assert.match(appSource, new RegExp(`pageKey:\\s*['"]${pageKey}['"]`));
  });
  ['intake', 'recycle_bin', 'pipeline', 'alerts', 'insights'].forEach(pageKey => {
    assert.match(appSource, new RegExp(`\\n\\s*${pageKey}:\\s*\\{\\n\\s*root:`));
  });
  assert.match(appSource, /TradePulseFilterComponent\.mountFilterComponent/g);
});

test('table swipe hint is conditional on measured overflow and resets after redraw', () => {
  assert.match(appSource, /scrollWidth \|\| 0\) > Number\(element\.clientWidth \|\| 0\) \+ 1/);
  assert.match(appSource, /element\.addEventListener\('scroll'/);
  assert.match(appSource, /nextScrollLeft !== meta\.lastScrollLeft/);
  assert.match(appSource, /meta\.dismissed = true/);
  assert.match(appSource, /new ResizeObserver/);
  assert.match(appSource, /new MutationObserver/);
  assert.match(appSource, /scheduleDataTableOverflowRefresh\(\[\.\.\.affected\]\)/);
  assert.doesNotMatch(appCss, /\.data-table:after/);
  assert.match(appCss, /\.data-table\.is-horizontally-overflowing\{padding-bottom:/);
  assert.match(appCss, /\.data-table\.show-horizontal-scroll-hint:after/);
  assert.match(appCss, /touch-action:pan-x pan-y/);
  assert.match(appCss, /-webkit-overflow-scrolling:touch/);
  assert.match(appSource, /commerce-strip recycle-commerce-strip/);
  assert.match(appCss, /\.recycle-commerce-strip\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

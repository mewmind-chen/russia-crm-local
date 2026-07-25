'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

function importComponent(name) {
  return import(pathToFileURL(path.join(root, 'sales-assets', 'components', name)).href);
}

test('html helpers escape dynamic text and attributes', async () => {
  const { escapeHtml, escapeAttribute } = await importComponent('html.js');
  assert.equal(escapeHtml(`<script data-x="'">&</script>`), '&lt;script data-x=&quot;&#39;&quot;&gt;&amp;&lt;/script&gt;');
  assert.equal(escapeAttribute('" onfocus="alert(1)'), '&quot; onfocus=&quot;alert(1)');
});

test('table renders a scroll container, semantic headers, labels, and escaped cells', async () => {
  const { renderTable } = await importComponent('table.js');
  const output = renderTable({
    caption: '客户 <清单>',
    columns: [
      { key: 'company', label: '公司' },
      { key: 'status', label: '状态', render: row => row.status },
    ],
    rows: [{ id: '"><x', company: '<img src=x>', status: '正常 & 跟进' }],
  });
  assert.match(output, /class="table-scroll /);
  assert.match(output, /tabindex="0"/);
  assert.match(output, /<th scope="col">公司<\/th>/);
  assert.match(output, /data-label="状态"/);
  assert.match(output, /&lt;img src=x&gt;/);
  assert.match(output, /data-row-key="&quot;&gt;&lt;x"/);
  assert.doesNotMatch(output, /<img src=x>/);
});

test('empty state and status never interpolate executable markup', async () => {
  const { renderEmptyState } = await importComponent('empty-state.js');
  const { renderStatus } = await importComponent('status.js');
  assert.match(renderEmptyState({
    title: '<svg/onload=alert(1)>',
    actionLabel: '<点击>',
    actionId: '" onclick="alert(1)',
  }), /&lt;svg\/onload=alert\(1\)&gt;/);
  assert.match(renderStatus('running', { label: '<b>运行</b>' }), /&lt;b&gt;运行&lt;\/b&gt;/);
});

test('shell navigation is generated only from visiblePages', async () => {
  const { renderShell } = await importComponent('shell.js');
  const output = renderShell({
    context: {
      role: 'sales',
      permissions: {
        view_dashboard: true,
        view_customers: true,
        view_intake: true,
      },
    },
    user: { name: '<销售>', role: 'sales' },
  });
  assert.match(output, /data-page-id="my-today"/);
  assert.match(output, /data-page-id="customers"/);
  assert.match(output, /data-page-id="intake"/);
  assert.doesNotMatch(output, /data-page-id="team-dashboard"/);
  assert.doesNotMatch(output, /data-page-id="administration"/);
  assert.match(output, /&lt;销售&gt;/);

  const source = fs.readFileSync(path.join(root, 'sales-assets', 'components', 'shell.js'), 'utf8');
  assert.match(source, /import \{ visiblePages \} from '\.\.\/core\/registry\.js'/);
  assert.doesNotMatch(source, /PAGE_REGISTRY/);
});

test('modal and drawer implement escape close, focus trap, and focus restoration', () => {
  for (const name of ['modal.js', 'drawer.js']) {
    const source = fs.readFileSync(path.join(root, 'sales-assets', 'components', name), 'utf8');
    assert.match(source, /event\.key === 'Escape'/, `${name} must close on Escape`);
    assert.match(source, /event\.key !== 'Tab'/, `${name} must trap Tab`);
    assert.match(source, /previousFocus/, `${name} must capture previous focus`);
    assert.match(source, /previousFocus\.focus\(\)/, `${name} must restore focus`);
    assert.match(source, /removeEventListener\('keydown'/, `${name} must clean up listeners`);
  }
});

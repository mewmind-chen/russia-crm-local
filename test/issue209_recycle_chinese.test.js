'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('Issue 209 recycle-kind filter options use Chinese labels with safe fallback', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const recycleAccount = fx.db.prepare(`UPDATE crm_accounts SET lifecycle_status='recycled',
    recycle_kind=?,recycle_reason='测试回收',recycled_at=? WHERE id=?`);
  recycleAccount.run('sales_return', '2026-08-04 08:00:00', 'CRM-WU');
  recycleAccount.run('manual_delete', '2026-08-04 08:01:00', 'CRM-OWN');
  recycleAccount.run('legacy_unknown', '2026-08-04 08:02:00', 'CRM-OTHER');

  const schema = await fx.requestJson('/api/sales-crm/filter-schema/recycle_bin', {
    cookie: fx.adminCookie,
  });
  const kind = schema.schema.fields.find(field => field.key === 'recycle_kind');
  assert.ok(kind, 'recycle_kind filter field missing');
  const labels = Object.fromEntries(kind.options.map(option => [option.value, option.label]));
  assert.equal(labels.sales_return, '销售退回');
  assert.equal(labels.manual_delete, '手动删除');
  assert.equal(labels.legacy_unknown, '其他');
  assert.equal(kind.options.some(option => option.label === 'sales_return'), false);
  assert.equal(kind.options.some(option => option.label === 'manual_delete'), false);
});

test('Issue 209 recycle UI shares one Chinese label map', () => {
  assert.doesNotMatch(html, /手工删除/);
  assert.doesNotMatch(app, /recycle\.kind === 'sales_return' \? '销售退回' : '手工删除'/);
  assert.match(app, /RECYCLE_KIND_LABELS[\s\S]*?sales_return:\s*'销售退回'/);
  assert.match(app, /RECYCLE_KIND_LABELS\[recycle\.kind\]/);
  assert.doesNotMatch(app, /recycle\.kind === 'sales_return' \? '销售退回'/);
});

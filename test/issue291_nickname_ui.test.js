'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('nickname entry and modal use the simplified creation wording', () => {
  assert.match(html, /id="drawerNicknameBtn"[^>]*>创建昵称</);
  const modal = section(app, 'function openNicknameModal', 'function openPasswordModal');
  assert.match(modal, /修改'\s*:\s*'创建'\}客户昵称|['"]修改['"]\s*:\s*['"]创建['"]/);
  assert.match(modal, /客户昵称/);
  assert.match(modal, /客户名称/);
  assert.match(modal, /客户编号/);
  assert.match(modal, /客户昵称/);
  assert.match(modal, /保存昵称/);
  assert.doesNotMatch(modal, /绑定客户主档并供公司内部共用|不影响正式名称、去重、AI、Recon、制裁核查/);
});

test('normalized nickname collision returns the friendly conflict message', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  fx.db.prepare("UPDATE customer_pool SET nickname='ABC' WHERE customer_id='RU-9002'").run();
  const response = await fx.request('/api/sales-crm/customers/RU-9003/nickname', {
    cookie: fx.adminCookie,
    method: 'PATCH',
    body: { nickname: 'ＡＢＣ' },
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, '该昵称已被其他客户使用，请更换昵称');
});

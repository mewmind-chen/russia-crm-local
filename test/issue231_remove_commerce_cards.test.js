'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('Issue 231 removes empty commerce cards from every customer detail entry', () => {
  assert.doesNotMatch(app, /累计报价/);
  assert.doesNotMatch(app, /累计订单/);
  assert.doesNotMatch(app, /<div class="commerce-card"><span>询价<\/span>/);
  assert.doesNotMatch(app, /<div class="commerce-card"><span>报价<\/span>/);
  assert.doesNotMatch(app, /<div class="commerce-card"><span>订单<\/span>/);
  assert.doesNotMatch(html, /累计报价|累计订单/);
  // 保留有业务价值的跟进卡与真实动作按钮
  assert.match(app, /<div class="commerce-card"><span>跟进<\/span>/);
  assert.match(app, /data-add-quote/);
  assert.match(app, /data-add-order/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('customer forms use shared local-name semantics', () => {
  assert.match(app, /本地名称\/别名（选填）/);
  assert.match(app, /公司名称不是当地官方名称或存在常用别名时填写/);
  assert.doesNotMatch(app, /<label>俄文名称/);

  const createForm = app.match(/openModal\('新增对口客户'[\s\S]*?<\/form>/)?.[0] || '';
  const masterForm = app.match(/openModal\('编辑客户主档'[\s\S]*?<\/form>/)?.[0] || '';
  for (const form of [createForm, masterForm]) {
    assert.match(form, /name="companyName"/);
    assert.match(form, /name="russianName"/);
    assert.match(form, /name="englishName"/);
  }
});

test('all established-year inputs share a searchable selector without number spinners', () => {
  assert.match(app, /function yearOptions\(selectedYear/);
  assert.equal((app.match(/name="establishedYear"/g) || []).length, 3);
  assert.equal((app.match(/name="establishedYear"[^>]*list="[^"]+"/g) || []).length, 3);
  assert.doesNotMatch(app, /name="establishedYear"[^>]*type="number"/);
  assert.equal((app.match(/<datalist id="[^"]+">\$\{yearOptions\(/g) || []).length, 3);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');

test('Issue 244 evaluation save button is a real submit with safe handler', () => {
  assert.match(app, /<button class="button primary" type="submit">保存/);
  assert.match(app, /form\.querySelector\('button\[type="submit"\], button:not\(\[type\]\)'\)/);
  assert.match(app, /if \(button\) \{[\s\S]*?button\.disabled = true/);
  assert.match(app, /finally[\s\S]*?button\.disabled = false/);
});

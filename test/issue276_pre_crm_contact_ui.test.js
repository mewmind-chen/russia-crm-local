'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'profile-contacts.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');

test('pre-CRM contact editor submits the stable customer id without requiring an account', () => {
  assert.match(script, /values\.customerId = accountId/);
  assert.match(script, /values\.externalCustomerId = customerId/);
  assert.doesNotMatch(script, /if \(!accountId\).*新增联系人/);
});

test('profile contacts use a fresh cache token', () => {
  assert.match(html, /profile-contacts\.js\?v=20260811-issue276-pre-crm-contacts/);
});

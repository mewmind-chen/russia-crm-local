'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { seededFixture } = require('./helpers/permission_fixture');
const {
  redactContactFields,
  contactSafeCustomerRecord,
} = require('../lib/access_control');

const root = path.join(__dirname, '..');
const accessSource = fs.readFileSync(path.join(root, 'lib', 'access_control.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'lib', 'db.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = sourceText.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const initialBody = functionSlice(dbSource, 'getInitialData', 'profileEvaluationTags');
const profileBody = functionSlice(dbSource, 'getCustomerProfileData', 'updateCustomer');

function legacyCustomerRow() {
  return {
    rowNumber: 7,
    followId: 'FOLLOW-1',
    customerId: 'RU-0001',
    companyName: 'Fixture Components',
    website: 'https://fixture.example',
    customerType: '制造商',
    industry: '电子元器件',
    rating: 'A',
    products: 'secret product focus',
    reason: 'secret qualification narrative',
    email: 'buyer@secret.example',
    phone: '+7-secret',
    contact: 'Secret Buyer',
    owner: 'Wu',
    assignedDate: '2026-08-01',
    status: '已分配待联系',
    firstContactDate: '',
    lastFollowDate: '',
    channel: 'email',
    feedback: 'secret feedback',
    nextAction: 'secret next action',
    nextFollowDate: '2026-08-10',
    invalidReason: 'secret invalid reason',
    notes: 'secret notes',
    statusGroup: '待联系',
    nextFollowDateKey: '2026-08-10',
    isDueToday: false,
    isOverdue: false,
    isRisk: false,
    riskReasons: [],
    tags: [{
      id: 1,
      name: '重点客户',
      category: '客户类型',
      color: '#0f766e',
      isPreset: true,
      createdAt: '2026-08-01 08:00:00',
      readOnly: true,
      description: 'tag description must not survive the projection',
      email: 'tag-email@secret.example',
    }],
  };
}

// 阶段 C：legacy customers 两个 bootstrap/profile 返回路径统一使用字段级白名单。
test('legacy customer bootstrap and profile paths use the customer whitelist', () => {
  assert.match(accessSource, /CONTACT_SAFE_CUSTOMER_ROW_KEYS/);
  assert.match(accessSource, /function contactSafeCustomerRecord\(/);
  assert.match(dbSource, /contactSafeCustomerRecord/);
  assert.match(initialBody, /customers\.map\(contactSafeCustomerRecord\)/);
  assert.match(profileBody, /legacyCustomers\.map\(contactSafeCustomerRecord\)/);
});

// 等价性：白名单必须逐键镜像 CONTACT_KEYS 递归黑名单，包含 tags 嵌套形状。
test('legacy customer whitelist is key-for-key equivalent to the blacklist', () => {
  const raw = legacyCustomerRow();
  assert.deepEqual(
    contactSafeCustomerRecord(raw),
    redactContactFields(raw),
    'customer whitelist must mirror the blacklist on the legacy customer row shape',
  );
});

// 泄漏契约：保留的 tags 值本身也必须经过黑名单后保持不变。
test('legacy customer whitelist does not leak contact keys inside tags', () => {
  const white = contactSafeCustomerRecord(legacyCustomerRow());
  assert.deepEqual(
    redactContactFields(white),
    white,
    'kept customer values must not carry CONTACT_KEYS descendants',
  );
  assert.equal(white.tags[0].name, '重点客户');
  assert.equal(white.tags[0].readOnly, true);
  assert.ok(!('description' in white.tags[0]));
  assert.ok(!('email' in white.tags[0]));
});

// 行为契约：无 view_contacts 用户仍能看到客户业务/状态字段，但看不到联系方式及联系叙事。
test('legacy customer bootstrap and profile hide contacts without view_contacts', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());

  const initial = await (await fx.request('/api/initial', { cookie: fx.cookie })).json();
  const initialRow = initial.customers.find(row => row.customerId === 'RU-9001');
  assert.ok(initialRow, 'legacy customer must be present in bootstrap');
  for (const key of ['customerId', 'companyName', 'status', 'statusGroup', 'isRisk', 'tags']) {
    assert.ok(key in initialRow, `bootstrap row must keep business key ${key}`);
  }
  for (const key of ['email', 'phone', 'contact', 'products', 'reason', 'feedback', 'nextAction', 'invalidReason', 'notes']) {
    assert.ok(!(key in initialRow), `bootstrap row must not expose ${key}`);
  }

  const profile = await (await fx.request('/api/sales-crm/profile/RU-9001', { cookie: fx.cookie })).json();
  const profileRow = profile.customers.find(row => row.customerId === 'RU-9001');
  assert.ok(profileRow, 'legacy customer must be present in profile payload');
  for (const key of ['customerId', 'companyName', 'status', 'statusGroup', 'tags']) {
    assert.ok(key in profileRow, `profile row must keep business key ${key}`);
  }
  for (const key of ['email', 'phone', 'contact', 'products', 'reason', 'feedback', 'nextAction', 'invalidReason', 'notes']) {
    assert.ok(!(key in profileRow), `profile row must not expose ${key}`);
  }
});


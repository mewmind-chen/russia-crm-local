'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const { redactContactFields, contactSafeAccountRecord } = require('../lib/access_control');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = sourceText.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'listCustomerAccounts', 'setCustomerStar');

// 阶段 C：accounts 列表（无 view_contacts 时）由字段级白名单投影驱动，
// 不再走 CONTACT_KEYS 递归黑名单。
test('accounts list uses the account whitelist instead of the blacklist', () => {
  assert.match(body, /contactSafeAccountRecord\(/, 'accounts list must use the account whitelist');
  assert.doesNotMatch(
    body,
    /redactContactFields\(/,
    'accounts list must not use the recursive contact blacklist',
  );
});

// 等价性：对端点同款行形状，白名单与黑名单输出逐键等价（无丢失、无新增）。
function endpointAccountRows(db) {
  const cols = db.prepare('PRAGMA table_info(crm_accounts)').all()
    .map(column => String(column.name || ''))
    .filter(column => column && column !== 'potential_value');
  return db.prepare(`SELECT ${cols.map(column => `a."${column.replace(/"/g, '""')}"`).join(',')},
    COALESCE(p.nickname,a.nickname,'') nickname,
    COALESCE(NULLIF(p.company_name,''),a.company_name) company_name,
    COALESCE(p.russian_name,'') russian_name,
    COALESCE(p.english_name,'') english_name,
    COALESCE(NULLIF(p.country,''),a.country) country,
    COALESCE(NULLIF(p.city,''),a.city) city,
    COALESCE(NULLIF(p.website,''),a.website) website,
    COALESCE(NULLIF(p.industry,''),a.industry) industry,
    COALESCE(NULLIF(p.customer_type,''),a.customer_type) customer_type,
    COALESCE(NULLIF(p.products,''),a.product_focus) product_focus,
    COALESCE(p.established_year,a.established_year) established_year,
    p.description master_description,p.current_pool,p.rating,p.best_contact_level,
    p.contact_recon_status,p.deep_report,p.source_file,
    owner.name owner_name,creator.name creator_name
    FROM crm_accounts a
    LEFT JOIN customer_pool p ON p.customer_id=a.external_customer_id
    LEFT JOIN sales_users owner ON owner.id=a.owner_id
    LEFT JOIN sales_users creator ON creator.id=a.created_by`).all();
}

test('account whitelist is key-for-key equivalent to the blacklist on endpoint rows', async t => {
  const fx = await adminFixture();
  t.after(() => fx.close());
  const rows = endpointAccountRows(fx.db);
  assert.ok(rows.length > 0, 'fixture must have account rows');
  for (const raw of rows) {
    raw.customerTags = [{ id: 'T-1', name: '重点', category: '等级', color: '#f00', isPreset: false }];
    const black = redactContactFields(raw);
    const white = contactSafeAccountRecord(raw);
    assert.deepEqual(white, black,
      `whitelist must mirror the blacklist on account row ${raw.id}`);
  }
});

// 行为契约：无 view_contacts 的销售可见业务字段、不可见联系方式、无 state DTO。
test('accounts list without view_contacts keeps business fields and hides contacts', async t => {
  const fx = await seededFixture();
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', {
    view_customers: true, view_all_customers: false, view_contacts: false, view_insights: false,
  });
  const cookie = await fx.login('other@example.com', 'Password123!');
  const body = await (await fx.request('/api/sales-crm/accounts?pageSize=50', { cookie })).json();
  assert.equal(body.rows.length > 0, true, 'accounts must be visible');
  const row = body.rows[0];
  for (const key of ['stage', 'lifecycle_status', 'assignment_status', 'company_name', 'customerTags']) {
    assert.ok(key in row, `account row must keep business key ${key}`);
  }
  for (const key of ['email', 'phone', 'contact', 'notes', 'summary', 'state']) {
    assert.ok(!(key in row), `account row must not expose ${key}`);
  }
});
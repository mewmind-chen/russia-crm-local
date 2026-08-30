'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture, seededFixture } = require('./helpers/permission_fixture');
const { redactContactFields, contactSafeNotificationRecord } = require('../lib/access_control');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'business_page_filters.js'), 'utf8');

function functionSlice(sourceText, functionName, nextFunctionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = sourceText.indexOf(`function ${nextFunctionName}(`, start + 1);
  assert.notEqual(end, -1, `missing function ${nextFunctionName}`);
  return sourceText.slice(start, end);
}

const body = functionSlice(source, 'listNotificationRows', 'businessFilterOptions');

// 阶段 C：notifications 页的联系人脱敏应由字段级白名单驱动。
test('notification list uses the notification whitelist instead of the blacklist', () => {
  assert.match(body, /contactSafeNotificationRecord\(/, 'notification list must use the notification whitelist');
  assert.doesNotMatch(body, /redactContactFields\(/, 'notification list must not use the recursive blacklist');
});

// 等价性：对通知行的业务 copy 形状，白名单与黑名单逐键等价。
test('notification whitelist is key-for-key equivalent to the blacklist on endpoint rows', () => {
  const salesPack = {
    id: 'NTF-1',
    recipientId: 'U-1',
    recipientName: '销售甲',
    customerId: 'CRM-1',
    code: 'SALES_PACK_FAILED',
    severity: 'warning',
    title: '销售资料包生成失败',
    detail: '请稍后重试或联系主管。',
    status: 'unread',
    createdAt: '2026-08-21 15:00:00',
    readAt: '',
    webDeliveryStatus: 'sent',
    wecomDeliveryStatus: 'sent',
    wecomStatus: 'sent',
  };
  const black = redactContactFields(salesPack);
  const white = contactSafeNotificationRecord(salesPack);
  assert.deepEqual(white, black, 'notification whitelist must mirror the blacklist for business copy rows');
});

// 行为契约：无 view_contacts 的通知列表不暴露联系方式，且不剥业务标识字段。
// 说明：title/detail 在 CONTACT_KEYS 中，黑名单（及镜像它的白名单）对无
// view_contacts 用户会一并剥离——忠实转换保持该行为（issue325 的 title 断言
// 仅对 view_contacts 用户成立）。
test('notifications keep identifiers and hide contacts for sales without view_contacts', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true, salesPackEnabled: true } },
  });
  t.after(() => fx.close());
  fx.setUserPermissions('U-OTHER', { view_customers: true, view_contacts: false, view_insights: false });
  fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,
     wecom_status,created_at,read_at)
    VALUES ('NTF-PCN','U-OTHER','CRM-OTHER','SALES_PACK_FAILED','warning',
      '销售资料包生成失败','模型 qwen 置信度不足，证据缺失','unread','pcn:pack','pending',
      '2026-08-21 15:00:00','')`).run();
  const cookie = await fx.login('other@example.com', 'Password123!');
  const body = await (await fx.request('/api/sales-crm/lists/notifications?page=1&pageSize=50', { cookie })).json();
  const row = body.rows.find(item => item.id === 'NTF-PCN');
  assert.ok(row, 'sales-pack notification must be present');
  for (const key of ['id', 'code', 'severity', 'status']) {
    assert.ok(key in row, `notification row must keep business key ${key}`);
  }
  for (const key of ['email', 'phone', 'contact', 'notes', 'summary', 'state']) {
    assert.ok(!(key in row), `notification row must not expose ${key}`);
  }
});
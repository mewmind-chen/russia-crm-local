'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redactContactFields,
  contactSafeTimelineRecord,
  contactSafeAuditLogRecord,
} = require('../lib/access_control');

// 阶段 C S3 形状：timeline 事件与 audit 日志的字段级白名单须与递归黑名单
// 逐键等价，且保留的嵌套值（provenance）不得含 CONTACT_KEYS 子键（泄漏校验）。

function timelineEvents() {
  return [
    {
      id: 'claim:c1', customer_id: 'CRM-1', kind: 'claim', title: '领取客户',
      summary: '甲领取该线索并进入 CRM', actor_name: '销售甲', occurred_at: '2026-08-01 10:00:00',
    },
    {
      id: 'activity:a1', customer_id: 'CRM-1', kind: 'activity', event_type: 'email',
      title: '发送邮件', summary: '客户回复', next_action: '跟进报价', no_plan: 0,
      manager_required: 1, outcome: '有回复', actor_name: '销售甲',
      occurred_at: '2026-08-01 10:00:00',
      provenance: {
        kind: 'superseded_original', originalActivityId: 'ACT-1', replacementActivityId: 'ACT-2',
        originalCustomerId: 'CRM-1', replacementCustomerId: 'CRM-2', originalActivityIds: ['ACT-1'],
      },
      superseded: true, superseded_by: 'ACT-2',
    },
    {
      id: 'rfq:r1', customer_id: 'CRM-1', kind: 'rfq', title: '收到询价',
      summary: 'REF-1 · 3 行 BOM · 资料完整度 80%', actor_name: '',
      occurred_at: '2026-08-01 10:00:00', activity_id: 'ACT-1', provenance: null, superseded: false,
    },
  ];
}

test('timeline whitelist is key-for-key equivalent to the blacklist on event rows', () => {
  for (const event of timelineEvents()) {
    assert.deepEqual(
      contactSafeTimelineRecord(event),
      redactContactFields(event),
      `timeline whitelist must mirror the blacklist for ${event.kind} events`,
    );
  }
});

test('timeline whitelist does not leak contact keys inside kept provenance values', () => {
  for (const event of timelineEvents()) {
    const white = contactSafeTimelineRecord(event);
    if (white.provenance && typeof white.provenance === 'object') {
      // 泄漏校验：若 provenance 内含 CONTACT_KEYS 子键，黑名单会剥它——
      // 白名单保留值须在黑名单下不变。
      assert.deepEqual(
        redactContactFields(white.provenance),
        white.provenance,
        `provenance must not carry contact-sensitive sub-keys (${event.kind})`,
      );
    }
  }
});

test('audit log whitelist mirrors the blacklist and strips the action field', () => {
  const row = {
    id: 'AUD-1', user_id: 'U-1', action: 'customer_rejected', entity_type: 'crm_account',
    entity_id: 'CRM-1', created_at: '2026-08-01 10:00:00', real_user_id: 'USR-ADMIN',
    effective_user_id: 'USR-ADMIN', impersonation_context_id: '', user_name: '销售甲',
    real_user_name: '管理员', effective_user_name: '管理员',
  };
  const white = contactSafeAuditLogRecord(row);
  const black = redactContactFields(row);
  assert.deepEqual(white, black, 'audit whitelist must mirror the blacklist');
  assert.ok(!('action' in white), 'action must stay stripped');
  assert.equal(white.user_name, '销售甲', 'audit actor name must survive');
});
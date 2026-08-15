'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

test('pending center renders a selectable queue and persistent detail', () => {
  for (const signature of [
    'function pendingRecordKey',
    'function pendingQueueRecords',
    'function selectPendingRecord',
    'function renderPendingQueue',
    'function renderPendingDetail',
  ]) assert.match(app, new RegExp(signature));
  assert.match(app, /data-pending-record-key/);
  assert.match(app, /selectedKey/);
});

test('identity decision UI adapts to candidate availability', () => {
  assert.match(app, /function protectedConflictDecisionMarkup/);
  assert.match(app, /function duplicateReviewDecisionMarkup/);
  assert.match(app, /没有可比较的已有客户/);
  assert.match(app, /要求补充资料/);
  assert.match(app, /crmNames.*length/s);
  assert.match(app, /是同一个客户/);
  assert.match(app, /不是同一个客户/);
  assert.doesNotMatch(app, /当前线索没有可关联的已有客户，暂不能合并/);
});

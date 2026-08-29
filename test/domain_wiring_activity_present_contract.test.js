'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（activity/present 批）：活动反应/队列/进展相关 helper 必须
// 从 lib/domains/activity/present import，不得内联。注入式错误构造函数
// （normalizeActivityReactionName/activityReactionNameKey/normalizeActivityActionQueueKey）
// 的调用点必须注入 { badRequest } 以保持与原内联版相同的 HttpError 语义。
// PIPELINE_ACTION_QUEUE_KEYS 随接线移入域模块，不得再内联。
test('activity present helpers are wired from domain module, not inlined', () => {
  assert.match(source, /const \{\s*normaleActivityReactionName,?|activityReactionNameKey|legacyProgressKey|normalizeActivityActionQueueKey|publicActivityReaction|scopedActivityProvenance|escapeActivitySearchLike/);
  assert.doesNotMatch(source, /^function normalizeActivityReactionName\(/m);
  assert.doesNotMatch(source, /^function activityReactionNameKey\(/m);
  assert.doesNotMatch(source, /^function legacyProgressKey\(/m);
  assert.doesNotMatch(source, /^function normalizeActivityActionQueueKey\(/m);
  assert.doesNotMatch(source, /^function publicActivityReaction\(/m);
  assert.doesNotMatch(source, /^function scopedActivityProvenance\(/m);
  assert.doesNotMatch(source, /^function escapeActivitySearchLike\(/m);
  assert.doesNotMatch(source, /const PIPELINE_ACTION_QUEUE_KEYS = new Set\(/);
  // 注入点：normalizeActivityReactionName 3 + activityReactionNameKey 5 + normalizeActivityActionQueueKey 2 = 10
  const injections = (source.match(/\{ badRequest \}/g) || []).length;
  assert.ok(injections >= 10, `expected >=10 injected call sites, got ${injections}`);
});

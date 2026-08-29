'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib', 'sales_crm.js'), 'utf8');

// 阶段 A 接线契约（activity/progress 批）：进展阶段常量与请求规格解析必须
// 从 lib/domains/activity/progress import，不得内联。resolveActivityRequestSpec
// 为注入式错误构造，调用点（recordActivity）注入 { badRequest } 保持 HttpError 语义。
test('activity progress helpers are wired from domain module, not inlined', () => {
  assert.match(source, /const \{\s*ACTIVITY_STAGE,\s*PROGRESS_TYPE_MAP,\s*LEGACY_ACTIVITY_TYPES,\s*LEGACY_ACTIVITY_CHANNELS,\s*resolveActivityRequestSpec,\s*\} = require\('\.\/domains\/activity\/progress'\);/);
  assert.doesNotMatch(source, /^const ACTIVITY_STAGE = \{/m);
  assert.doesNotMatch(source, /^const PROGRESS_TYPE_MAP = Object\.freeze\(\{/m);
  assert.doesNotMatch(source, /^const LEGACY_ACTIVITY_TYPES = new Set\(\[/m);
  assert.doesNotMatch(source, /^const LEGACY_ACTIVITY_CHANNELS = new Set\(\[/m);
  assert.doesNotMatch(source, /^function resolveActivityRequestSpec\(/m);
  // ACTIVITY_STAGE 仍须经 module.exports 导出（测试消费方依赖）
  assert.match(source, /ACTIVITY_STAGE,/);
  // 调用点注入 { badRequest }
  assert.match(source, /resolveActivityRequestSpec\(payload, \{ badRequest \}\)/);
});

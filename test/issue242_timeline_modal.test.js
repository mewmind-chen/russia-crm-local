'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

test('Issue 242 timeline modal exposes expand entry, detail fields and dash placeholders', () => {
  assert.match(app, /function openTimelineModal\(events, options = \{\}\)/);
  assert.match(app, /function renderTimelineEventDetail\(event\)/);
  assert.match(app, /data-open-timeline-modal/);
  assert.match(app, /data-timeline-modal-index/);
  assert.match(app, /展开完整时间线/);
  assert.match(app, /timelineModalDetail/);
  assert.match(app, /timeline-modal-wide/);
  assert.match(app, /timeline-modal-layout/);
  for (const field of ['进展类型', '进展说明', '客户反应', '渠道', '详细说明', '下一步', '计划时间', '阶段变化', '操作人', '发生时间', '主管协助']) {
    assert.match(app, new RegExp(field));
  }
  assert.match(app, /\|\| '—'/);
  assert.match(css, /\.timeline-modal-layout\{display:grid;grid-template-columns:/);
  assert.match(css, /@media\(max-width:700px\)\{\.timeline-modal-layout\{grid-template-columns:minmax\(0,1fr\)[^}]*\}/);
});

test('customer drawer consolidates history while recycle drawer keeps its timeline entry', () => {
  const drawer = app.match(/function renderDrawer\(\)([\s\S]*?)\n  function openModal/)?.[1] || '';
  assert.equal((drawer.match(/data-customer-history/g) || []).length, 1);
  assert.doesNotMatch(drawer, /data-open-timeline-modal|展开完整时间线/);
  assert.match(app, /data-open-timeline-modal/);
});

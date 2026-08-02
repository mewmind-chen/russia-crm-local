'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function functionBlock(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const next = /\n  (?:async )?function [A-Za-z0-9_$]+\(/g;
  next.lastIndex = start + marker.length;
  const match = next.exec(source);
  return source.slice(start, match?.index ?? source.length);
}

test('team navigation becomes a three-section team status workspace', () => {
  assert.match(html, /data-view="team"[^>]*>[\s\S]*?<span>团队状态<\/span>/);
  assert.match(app, /team:\s*\[['"]TEAM STATUS['"],\s*['"]团队状态['"]\]/);
  for (const [section, label] of [
    ['progress', '业务推进'], ['capability', '销售能力'], ['collaboration', '协作支持'],
  ]) {
    assert.match(html, new RegExp(`data-team-section="${section}"[^>]*>${label}<`));
    assert.match(html, new RegExp(`id="team${label === '业务推进' ? 'Progress' : label === '销售能力' ? 'Capability' : 'Collaboration'}Panel"`));
  }
});

test('team status consumes authorized filters, ranges and server-owned since cursor', () => {
  for (const id of [
    'teamRange', 'teamProgressFilters', 'teamCollaborationFilters', 'teamProgressSummary',
    'teamProgressSales', 'teamProgressDrilldown', 'teamCollaborationList', 'teamStatusState',
  ]) assert.match(html, new RegExp(`id="${id}"`), id);

  const initialize = functionBlock(app, 'initializeTeamStatusFilters');
  assert.match(initialize, /team_status_progress/);
  assert.match(initialize, /team_status_collaboration/);
  assert.match(initialize, /TradePulseFilterComponent/);
  const load = `${functionBlock(app, 'teamStatusQuery')}\n${functionBlock(app, 'loadTeamStatus')}`;
  assert.match(load, /\/team-status/);
  assert.match(load, /since-last-view/);
  assert.match(load, /permissionVersion/);
  assert.match(load, /componentPayloadToRaw/);
  assert.match(load, /FILTER_VERSION_CONFLICT/);
});

test('progress renders authorized customer, task and timeline drill-downs with return state', () => {
  const render = functionBlock(app, 'renderTeamProgress');
  assert.match(render, /data-team-progress-drilldown/);
  assert.match(render, /customer/);
  assert.match(render, /task/);
  assert.match(render, /timeline/);
  assert.match(render, /data-open-customer/);
  assert.match(render, /data-manager-task-id/);
  assert.match(app, /teamStatus\.drilldown/);
});

test('capability keeps the existing score ring, bars, funnel and review rendering', () => {
  const render = `${functionBlock(app, 'renderTeamCapability')}\n${functionBlock(app, 'renderTeamDetail')}`;
  for (const contract of [
    'score-ring', 'capability-bars', 'PERSONAL FUNNEL', '优势', '短板', '样本',
  ]) assert.match(render, new RegExp(contract), contract);
  assert.doesNotMatch(`${html}\n${app}`, /主管排行榜|主管评分|优秀员工|不合格员工/);
});

test('collaboration supports fact provenance and append-only write actions', () => {
  const render = `${app.match(/const collaborationStatusLabels = \{[\s\S]*?\n  \};/)?.[0] || ''}\n${functionBlock(app, 'renderTeamCollaboration')}`;
  assert.match(render, /系统事实/);
  assert.match(render, /手工补记/);
  assert.match(render, /未解决/);
  assert.match(render, /已解决/);
  assert.match(render, /已升级/);
  assert.match(render, /data-collaboration-(supplement|correct|revoke)/);
  assert.match(render, /writeEnabled/);
  assert.match(render, /actorId/);
  const submit = `${functionBlock(app, 'collaborationFormMarkup')}\n${functionBlock(app, 'submitCollaborationSupport')}`;
  assert.match(submit, /idempotencyKey/);
  assert.match(submit, /crypto\.randomUUID/);
  assert.match(submit, /输入已保留|保留/);
});

test('team exports use the authorized query and AI content remains gated', () => {
  const download = `${functionBlock(app, 'teamStatusQuery')}\n${functionBlock(app, 'downloadTeamStatus')}`;
  assert.match(download, /\/team-status\/export/);
  assert.match(download, /\/collaboration-support\/export/);
  assert.match(download, /teamExportFormat/);
  assert.match(download, /permissionVersion/);
  assert.match(download, /componentPayloadToRaw/);
  assert.match(html, /id="teamExportFormat"[\s\S]*value="csv"[\s\S]*value="json"/);
  assert.match(app, /customerAIEnabled\(\)\s*\?\s*salesCoachingBlock/);
  assert.match(html, /id="teamCoachingStatus"[^>]*data-ai-business/);
});

test('team workspace is responsive down to 320px without page-level horizontal scrolling', () => {
  assert.match(css, /\.team-status-workspace/);
  assert.match(css, /\.team-section-tabs/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*team-status/);
  assert.match(css, /team-status-workspace[^}]*overflow-x:(?:clip|hidden)/);
  assert.match(css, /team-section-tabs[^}]*overflow-x:auto/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const access = fs.readFileSync(path.join(root, 'lib/access_control.js'), 'utf8');

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : -1;
  return source.slice(start, end < 0 ? source.length : end);
}

test('team status navigation uses the same view_team permission as its route and backend', () => {
  assert.match(
    html,
    /<button data-view="team" data-permission="view_team">[\s\S]*?<span>团队状态<\/span><\/button>/,
  );
  assert.match(app, /team:\s*'view_team'/);
  assert.match(access, /'GET \/team-status':\s*\{ permissions:\s*\['view_team'\] \}/);
});

test('all permission-controlled navigation entries match their route permission contract', () => {
  const expected = {
    dashboard: 'view_dashboard', alerts: 'view_alerts', notifications: 'view_notifications',
    aiTasks: 'view_customers', pool: 'view_intake', contacts: 'view_contacts', recon: 'view_recon',
    customers: 'view_customers', recycleBin: 'view_own_mismatch_history', pipeline: 'view_pipeline',
    managerTasks: 'resolve_manager_tasks', activityCorrections: 'manage_activity_corrections',
    managerMetrics: 'resolve_manager_tasks', team: 'view_team', insights: 'view_insights',
    markets: 'view_markets', users: 'view_users', maintenance: 'manage_data_maintenance',
  };
  const actual = Object.fromEntries([...html.matchAll(
    /<button data-view="([^"]+)" data-permission="([^"]+)"/g,
  )].map(match => [match[1], match[2]]));
  assert.deepEqual(actual, expected);
});

test('manual team status routes fall back and explain the missing permission', () => {
  const hashParser = functionBlock(app, 'viewFromLocationHash', 'beginPendingDeepLinkNavigation');
  assert.match(hashParser, /teamStatus/);
  assert.match(hashParser, /return view === 'teamStatus' \? 'team' : view/);

  const switcher = `${functionBlock(app, 'unauthorizedViewMessage', 'load')}\n${functionBlock(app, 'switchView')}`;
  assert.match(switcher, /const fallback = firstAllowedBusinessView\(\)/);
  assert.match(switcher, /switchView\(fallback, false\)/);
  assert.match(switcher, /当前账号暂未开通团队状态权限/);

  const load = app.slice(app.indexOf('async function load('), app.indexOf('function applyUser('));
  assert.match(load, /const requestedView = viewFromLocationHash\(\)/);
  assert.match(load, /unauthorizedViewMessage\(requestedView\)/);
});

test('permission refresh hides and restores navigation through the shared permission pass', () => {
  const applyUser = functionBlock(app, 'applyUser');
  assert.match(applyUser, /\$\$\('\[data-permission\]'\)[\s\S]*classList\.toggle\('hidden', !can\(el\.dataset\.permission\)\)/);
});

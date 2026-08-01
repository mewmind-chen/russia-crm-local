'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');

function block(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing ${end}`);
  return source.slice(startAt, endAt);
}

function literal(source, expression, label) {
  const match = source.match(expression);
  assert.ok(match, `missing ${label}`);
  return Number(match[1]);
}

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function managerTransportPageSize(source, displayPageSize) {
  const config = block(source, 'manager_tasks: {', 'manager_risks: {');
  const loader = block(
    source,
    'async function loadAuthorizedBusinessPage(',
    'async function initializeAuthorizedBusinessFilters(',
  );
  if (/pageKey\s*===\s*['"]manager_tasks['"][\s\S]{0,120}managerTaskPageSize/.test(loader)) {
    return displayPageSize;
  }

  const explicitConfigSize = config.match(/pageSize:\s*(\d+)/);
  if (explicitConfigSize && /config\.pageSize/.test(loader)) {
    return Number(explicitConfigSize[1]);
  }

  const stateBlock = block(source, 'const state = {', 'const viewMeta = {');
  const managerState = stateBlock.match(
    /['"]?manager_tasks['"]?\s*:\s*emptyAuthorizedListState\((\d+)\)/,
  );
  if (managerState) return Number(managerState[1]);

  return literal(
    block(source, 'const emptyAuthorizedListState', 'const state = {'),
    /pageSize:\s*(\d+)/,
    'authorized-list transport page size',
  );
}

function simulateForwardNavigation(total, transportPageSize, displayPageSize) {
  const all = Array.from({ length: total }, (_, index) =>
    `TASK-${String(index + 1).padStart(3, '0')}`);
  let loaded = all.slice(0, transportPageSize);
  let transportPage = 1;
  let page = 1;
  const navigatedPages = [loaded.slice(0, displayPageSize)];

  for (let guard = 0; guard < total + 2; guard += 1) {
    let maxPage = Math.max(1, Math.ceil(loaded.length / displayPageSize));
    const hasMore = loaded.length < total;
    if (page >= maxPage && hasMore) {
      transportPage += 1;
      const offset = (transportPage - 1) * transportPageSize;
      loaded = loaded.concat(all.slice(offset, offset + transportPageSize));
      maxPage = Math.max(1, Math.ceil(loaded.length / displayPageSize));
    }

    const previousPage = page;
    if (page < maxPage) page += 1;
    if (page !== previousPage) {
      const start = (page - 1) * displayPageSize;
      navigatedPages.push(loaded.slice(start, start + displayPageSize));
    }

    if (loaded.length >= total && page >= maxPage) break;
  }

  return { all, navigatedPages };
}

test('manager task forward pagination exposes every task once in stable order', () => {
  const displayPageSize = literal(app, /managerTaskPageSize:\s*(\d+)/,
    'manager task display page size');
  const transportPageSize = managerTransportPageSize(app, displayPageSize);
  const result = simulateForwardNavigation(59, transportPageSize, displayPageSize);
  const visible = result.navigatedPages.flat();
  const missing = result.all.filter(id => !visible.includes(id));
  const duplicates = visible.filter((id, index) => visible.indexOf(id) !== index);

  assert.deepEqual(
    visible,
    result.all,
    `manager pagination must advance through all 59 tasks exactly once; `
      + `transport=${transportPageSize}, display=${displayPageSize}, `
      + `missing=${missing.join(',') || 'none'}, duplicates=${duplicates.join(',') || 'none'}`,
  );
});

test('manager task and 30/90 metric summaries come from authorized server aggregates', () => {
  const tasks = functionBlock(app, 'renderManagerTasks');
  assert.match(tasks, /meta\.loaded[\s\S]{0,100}meta\.summary/);
  assert.match(tasks, /taskSummary\.open/);
  assert.match(tasks, /taskSummary\.overdue/);
  assert.match(tasks, /taskSummary\.escalated/);
  assert.doesNotMatch(tasks, /const active = rows\.filter/);

  const metrics = functionBlock(app, 'renderManagerMetrics');
  assert.match(metrics, /meta\.summary\?\.ranges\?\.\[String\(state\.managerMetricRange\)\]/);
  assert.match(metrics, /serverSummary\?\.sampleSize/);
  assert.match(metrics, /serverSummary\?\.ratios\?\.planFormationRate/);
  assert.match(metrics, /serverSummary\?\.ratios\?\.onTimeActionRate/);
  assert.match(metrics, /meta\.loaded[\s\S]{0,260}serverSummary/);
  assert.match(metrics, /row\.actorName \|\| row\.actorId/);
  assert.match(metrics, /<button[^>]*data-manager-metric-owner=/);
  assert.doesNotMatch(metrics, /<article[^>]*data-manager-metric-owner=/);

  const drilldown = functionBlock(app, 'drillDownManagerMetric');
  assert.match(drilldown, /metricController\.serialize\('applied'\)/);
  assert.match(drilldown, /riskController\.getSchema\(\)/);
  assert.match(drilldown, /filter\.field === 'metric_window'/);
  assert.match(drilldown, /riskController\.setDraft\(filter\.field, filter\.value\)/);
  assert.match(drilldown, /riskController\.setDraft\('owner', \[String\(ownerId\)\]\)/);
  assert.match(drilldown, /riskController\.apply\(\)/);
  assert.match(app, /drillDownManagerMetric\(managerMetric\.dataset\.managerMetricOwner\)/);
});

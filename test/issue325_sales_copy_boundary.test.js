'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { adminFixture } = require('./helpers/permission_fixture');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const legacy = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('sales role has a dedicated business-copy boundary independent of permissions', () => {
  const salesRole = functionBlock(app, 'isSalesRepresentative');
  const technicalAI = functionBlock(app, 'technicalAIPresentationAllowed');
  assert.match(salesRole, /user\?\.role === 'sales'/);
  assert.match(technicalAI, /customerAIEnabled\(\) && !isSalesRepresentative\(\)/);

  const visibility = functionBlock(app, 'applyBusinessAIVisibility');
  assert.match(visibility, /technicalAIPresentationAllowed\(\)/);
  const route = app.slice(app.indexOf('function switchView('), app.indexOf('function switchView(') + 1800);
  assert.match(route, /view === 'aiTasks' && !technicalAIPresentationAllowed\(\)/);
});

test('intake list keeps business copy for sales, manager and admin roles', () => {
  const render = functionBlock(app, 'renderIntake');
  assert.match(render, /const showAI = technicalAIPresentationAllowed\(\)/);
  assert.match(render, /const sourceMeta = `<span>更新 \$\{esc\(shortDate\(item\.updated_at, true\)\)\}<\/span>`/);
  assert.doesNotMatch(render, /暂无来源证据|批次 \$\{|背调报告|证据\$\{/);
});

test('sales intake and customer drawers suppress technical AI and source sections', () => {
  const intake = functionBlock(app, 'openIntakeProfile');
  assert.match(intake, /const showAI = technicalAIPresentationAllowed\(\)/);
  assert.match(intake, /showTechnicalSources/);
  assert.match(intake, /\.\.\.\(showTechnicalSources \? \[\['推荐结论'/);
  assert.match(intake, /showTechnicalSources && item\.report_url/);
  assert.match(intake, /showTechnicalSources \? `<div class="wide"><span>研究与来源证据/);

  const assistant = functionBlock(app, 'customerAiSection');
  assert.match(assistant, /drawerAiContext\(context\)/);
  assert.match(assistant, /!drawerAi\.drawerAiWidget \|\| !drawerAi\.enabled/);
  const aiGate = functionBlock(app, 'drawerAiContext');
  assert.match(aiGate, /technicalAIPresentationAllowed\(\) && can\('use_ai_assistant'\)/);
  const drawerFacts = functionBlock(app, 'drawerFactsContext');
  assert.match(drawerFacts, /technicalAIPresentationAllowed\(\) \? \[\['评价标签'/);
  const mismatch = functionBlock(app, 'renderMismatchRecordDrawer');
  assert.doesNotMatch(mismatch, /记录编号|valueOrEmpty\(detail\.recordKey/);
  assert.doesNotMatch(mismatch, /mismatchSafeJoin\(\[detail\.recordKey/);
});

test('sales-facing static copy uses business language while Recon name stays unchanged', () => {
  assert.match(html, />Recon 情报<\/span>/);
  assert.match(html, /<h2>Recon 情报<\/h2>/);
  assert.doesNotMatch(html, /联系人凭证/);
  assert.doesNotMatch(functionBlock(app, 'renderUnifiedPeople'), /证据状态/);
  const reconSection = html.slice(html.indexOf('id="reconView"'), html.indexOf('id="pipelineView"'));
  assert.doesNotMatch(reconSection, /证据/);
});

test('sales notification presentation removes technical AI task copy but keeps business sales-pack notices', () => {
  const allowed = functionBlock(app, 'notificationRowsAllowedByAIGate');
  assert.match(allowed, /salesTechnicalNotificationCodes/);
  assert.match(allowed, /isSalesRepresentative\(\)/);
  const copy = functionBlock(app, 'notificationBusinessCopy');
  assert.match(copy, /SALES_PACK_READY/);
  assert.match(copy, /SALES_PACK_FAILED/);
  assert.doesNotMatch(copy, /模型|算法|证据|置信度/);
});

test('sales notification API hides technical jobs and sanitizes sales-pack failure details', async t => {
  const fx = await adminFixture({
    appOptions: { salesCrm: { aiStationsEnabled: true, salesPackEnabled: true } },
  });
  t.after(() => fx.close());
  const insert = fx.db.prepare(`INSERT INTO crm_notifications
    (id,user_id,customer_id,code,severity,title,detail,status,dedupe_key,
     wecom_status,created_at,read_at)
    VALUES (?,?,?,?,?,?,?,'unread',?,'pending','2026-08-21 15:00:00','')`);
  insert.run(
    'NOTE-325-TECH', 'U-OTHER', 'CRM-OTHER', 'AI_TASK_FAILED', 'warning',
    'AI任务失败', '模型 qwen 置信度不足，证据缺失', 'issue325:tech',
  );
  insert.run(
    'NOTE-325-PACK', 'U-OTHER', 'CRM-OTHER', 'SALES_PACK_FAILED', 'warning',
    '销售资料包生成失败', '模型 qwen 置信度不足，证据缺失', 'issue325:pack',
  );

  const response = await fx.request('/api/sales-crm/lists/notifications?page=1&pageSize=50', {
    cookie: fx.otherCookie,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows.some(row => row.id === 'NOTE-325-TECH'), false);
  const pack = body.rows.find(row => row.id === 'NOTE-325-PACK');
  assert.ok(pack);
  assert.equal(pack.title, '销售资料包暂未生成');
  assert.equal(pack.detail, '请稍后重试或联系主管。');
  assert.doesNotMatch(`${pack.title} ${pack.detail}`, /AI|模型|算法|证据|置信度/);

  const schemaResponse = await fx.request('/api/sales-crm/filter-schema/intake', {
    cookie: fx.otherCookie,
  });
  assert.equal(schemaResponse.status, 200);
  const schema = (await schemaResponse.json()).schema;
  assert.equal(schema.fields.some(field => field.key === 'source_batch'), false);
});

test('customer profile AI station and progress assistant are unavailable to sales even if permission is granted', () => {
  const profile = functionBlock(app, 'openCustomerProfile');
  assert.match(profile, /technicalAIPresentationAllowed\(\)/);
  const header = functionBlock(app, 'renderCustomerProfileHeader');
  assert.match(header, /!technicalAIPresentationAllowed\(\)/);
  assert.match(app, /technicalAIPresentationAllowed\(\) && can\('use_ai_assistant'\) \? `<details class="action-proposal-details">/);
  assert.match(legacy, /function legacyAIEnabled\(\)\{return Boolean\(state\.capabilities\.features&&state\.capabilities\.features\.aiStations\)&&state\.capabilities\.user\?\.role!==\'sales\'\}/);
  assert.match(legacy, /function legacyTechnicalSourcesAllowed\(\)\{return state\.capabilities\.user\?\.role!==\'sales'\}/);
  assert.doesNotMatch(legacy, /证据|置信度/);
});

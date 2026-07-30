'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test('public topbar keeps only notification, create customer and record progress actions', () => {
  const topbar = section(html, '<header class="topbar">', '</header>');
  assert.match(topbar, /id="notificationButton"/);
  assert.match(topbar, /id="newCustomerBtn"[^>]*data-permission="create_customer"[^>]*>[^<]*新增CRM客户/);
  assert.match(topbar, /id="quickUpdateBtn"[^>]*data-permission="record_activity"[^>]*>[^<]*记录新进展/);
  assert.doesNotMatch(topbar, /销售经营中心|全部国家|全部负责人|全部销售|近90天|快速更新/);
  assert.doesNotMatch(topbar, /workspace-chip|filters-inline|countryFilter|ownerFilter|periodFilter/);
});

test('removing public filters also removes every old JavaScript dependency', () => {
  for (const id of ['countryFilter', 'ownerFilter', 'periodFilter']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(app, new RegExp(`['"\`]#?${id}['"\`]`));
  }
  assert.doesNotMatch(app, /\['countryFilter',\s*'ownerFilter',\s*'periodFilter'\]/);
  assert.doesNotMatch(app, /#periodFilter/);
  assert.match(app, /customerCountryFilter/);
  assert.match(app, /customerOwnerFilter/);
  assert.match(app, /intakeOwnerFilter/);
});

test('record progress modal uses the confirmed compact wording and fields', () => {
  const modal = section(app, 'function openActivityModal', 'function openNewCustomerModal');
  for (const copy of [
    '记录新进展',
    '选择客户后，记录本次进展与下一步计划',
    '本次进展',
    '客户反应',
    '进展内容',
    '下一步计划',
    '下次跟进时间',
    '需要经理协助',
    '勾选后提醒销售经理关注并协助本次进展',
    '保存进展',
  ]) assert.match(modal, new RegExp(copy));
  assert.match(app, /客户搜索/);
  assert.doesNotMatch(modal, /记录客户动作|本次动作|简短记录|下一步动作|计划时间|这是重点节点，需要管理者介入|保存并更新阶段/);
  assert.doesNotMatch(modal, /<label[^>]*>渠道|name="channel"[^>]*type="(?:text|search)"|<select[^>]*name="channel"/);
  assert.match(modal, /name="summary"[^>]*(?:rows="2"[^>]*|data-[^>]*rows)/);
  assert.match(modal, /name="managerRequired"[^>]*type="checkbox"|type="checkbox"[^>]*name="managerRequired"/);
});

test('real admins keep a reaction settings entry when no active options remain', () => {
  const reactionField = section(app, 'function activityReactionField', 'async function openActivityModal');
  assert.match(reactionField, /if \(!state\.activityReactions\.length\)/);
  assert.match(reactionField, /activity-reaction-admin-entry/);
  assert.match(reactionField, /管理客户反应/);
});

test('opening reaction settings preserves and restores the current progress draft', () => {
  assert.match(app, /function captureActivityDraft/);
  assert.match(app, /function restoreActivityDraft/);
  assert.match(app, /activityDraftBeforeReactionAdmin/);
  assert.match(app, /data-return-activity-draft/);
  assert.match(app, /event\.key === ['"]Escape['"][\s\S]{0,220}restoreActivityDraft/);
});

test('AI proposals clear unmatched legacy reactions instead of blocking an optional reaction field', () => {
  const proposal = section(app, 'function applyActionProposal', 'async function loadActionProposal');
  assert.match(proposal, /setActivityReaction\(['"]{2}\)/);
  assert.match(proposal, /field !== ['"]outcome['"]/);
  assert.match(proposal, /客户反应（请从当前配置中选择）/);
  assert.match(proposal, /本次进展（请重新选择）/);
});

test('customer picker searches with q, renders nickname first and pins a replaceable selection', () => {
  assert.match(app, /activity-customers\?q=/);
  assert.match(app, /activity-customer-results|progress-customer-results/);
  assert.match(app, /accountDisplayName|nickname/);
  assert.match(app, /externalCustomerId/);
  assert.match(app, /ownerName/);
  assert.match(app, /更换客户/);
  assert.match(app, /activity-customer-selected|progress-customer-summary/);
  assert.match(app, /openActivityModal\(state\.selectedCustomerId\)/);
  assert.match(app, /openActivityModal\(customerId\s*=\s*['"]{2}\)/);
  assert.match(app, /externalCustomerId \|\| customer\?\.external_customer_id \|\| customer\?\.id/);
  assert.match(css, /\.(?:activity|progress)-customer-results\{[^}]*position:absolute/);
});

test('AI proposal entry requires a selected customer with a stable external customer id', () => {
  assert.match(app, /该客户尚未关联稳定客户编号，暂不能使用 AI 整理/);
  assert.match(app, /proposalDetails\.classList\.toggle\(['"]hidden['"]/);
});

test('progress options are compact stable choices and manager assistance is not a progress type', () => {
  const modal = section(app, 'function openActivityModal', 'function openNewCustomerModal');
  const optionList = section(app, 'const activityProgressOptions', '];');
  const choices = [
    ['email', '发送邮件'],
    ['call', '电话开发'],
    ['whatsapp', 'WhatsApp 联系'],
    ['telegram', 'Telegram 联系'],
    ['linkedin', 'LinkedIn\\s*\\/\\s*社媒联系'],
    ['reply', '客户回复'],
    ['meeting', '视频会议'],
    ['rfq', '收到询价'],
    ['negotiation', '商务谈判'],
    ['lost', '暂停\\s*\\/\\s*流失'],
  ];
  for (const [key, label] of choices) {
    assert.match(optionList, new RegExp(`['"\`]${key}['"\`][^\\n]{0,100}${label}`));
  }
  assert.doesNotMatch(modal, /manager_join|管理者介入/);
  assert.doesNotMatch(modal, /class="activity-type|id="activityTypes"/);
  assert.match(modal, /progressType/);
});

test('RFQ details live in a separate compact second step and save through one activity write', () => {
  const main = section(app, 'function openActivityModal', 'function openNewCustomerModal');
  const firstStep = section(main, '<section id="activityMainStep"', '<section id="activityRfqStep"');
  assert.doesNotMatch(firstStep, /id="rfqFields"|name="reference"|name="bomLines"|name="expectedValue"|name="completeness"|name="productCategory"/);
  assert.match(main, /id="activityRfqStep"[^>]*class="[^"]*hidden/);
  assert.match(app, /showActivityRfqStep/);
  assert.match(app, /name="reference"/);
  assert.match(app, /name="bomLines"/);
  assert.match(app, /name="expectedValue"/);
  assert.match(app, /name="completeness"/);
  assert.match(app, /name="productCategory"/);
  const activityWrites = app.match(/api\/sales-crm\/activities/g) || [];
  assert.equal(activityWrites.length, 1, 'all progress paths should converge on one atomic activity write');
  assert.match(main, /name="idempotencyKey"/);
  assert.match(app, /state\.activitySubmitting/);
});

test('reaction settings are admin-only and inspection-safe while empty sales choices stay hidden', () => {
  assert.match(app, /activity-reactions/);
  assert.match(app, /activityReactionSettings|reactionSettings|reaction-settings/i);
  assert.match(app, /role\s*===\s*['"]admin['"]/);
  assert.match(app, /!state\.data\.impersonation|state\.data\.impersonation\s*\?/);
  assert.match(app, /if\s*\(!state\.activityReactions\.length\)/);
  assert.match(app, /activity-reaction-admin-entry/);
});

test('manager checkbox, textarea and modal scrolling have dedicated responsive contracts', () => {
  assert.match(css, /\.(?:manager-assistance|progress-manager-check|activity-manager-check)\{[^}]*display:flex/);
  assert.match(css, /\.(?:manager-assistance|progress-manager-check|activity-manager-check)[^{]*input[^{]*\{[^}]*width:(?:16|18|20)px/);
  assert.match(css, /\.(?:manager-assistance|progress-manager-check|activity-manager-check)[^{]*input[^{]*\{[^}]*flex:0 0/);
  assert.match(css, /\.(?:progress-summary|activity-summary|progress-form)[^{]*(?:textarea|\[name="summary"\])\{[^}]*overflow-y:hidden/);
  assert.match(css, /\.(?:progress-summary|activity-summary|progress-form)[^{]*(?:textarea|\[name="summary"\])\{[^}]*max-height/);
  assert.match(app, /textarea\.style\.overflowY\s*=\s*textarea\.scrollHeight\s*>\s*maxHeight\s*\?\s*['"]auto['"]\s*:\s*['"]hidden['"]/);
  assert.match(css, /\.activity-progress-form,[^{]*\{[^}]*min-width:0/);
  assert.match(css, /\.activity-primary-grid\{[^}]*min-width:0/);
  assert.match(css, /@media\s*\(max-(?:width|height):[^)]+\)[\s\S]*overflow-y:auto/);
  assert.doesNotMatch(css, /\.(?:progress-modal|activity-modal)[^{]*\{[^}]*overflow-x:(?!hidden)/);
});

test('Issue 149 assets are cache-busted together', () => {
  assert.match(html, /sales-assets\/app\.css\?v=20260731-issue149/);
  assert.match(html, /sales-assets\/app\.js\?v=20260731-issue149/);
});

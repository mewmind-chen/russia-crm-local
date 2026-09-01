'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');
const timelineWidget = fs.readFileSync(path.join(ROOT, 'sales-assets', 'timeline-widget.js'), 'utf8');

function functionBlock(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const tail = source.slice(start + 1);
  const nextFunction = tail.match(/\n  (?:async )?function /);
  const next = nextFunction ? start + 1 + nextFunction.index : -1;
  return source.slice(start, next === -1 ? source.length : next);
}

function namedSection(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `missing ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test('timeline correction entry is gated by feature, permission, authorship, effective state and impersonation', () => {
  const gate = functionBlock(app, 'canStartActivityCorrection');
  assert.match(gate, /can\(['"]correct_own_activity['"]\)/);
  assert.match(gate, /role\s*===\s*['"]admin['"]/);
  assert.match(gate, /user_id|userId|creatorId|actorId/);
  assert.match(gate, /state\.data\?*\.impersonation|state\.data\.impersonation/);
  assert.match(gate, /superseded|provenance|effective/);

  const adapter = `${functionBlock(app, 'activityTimelineRenderContext')}\n${functionBlock(app, 'renderActivityTimelineItem')}`;
  assert.match(adapter, /canStartActivityCorrection\(event\)/);
  assert.match(adapter, /renderActivityItemHtml/);
  assert.match(timelineWidget, /data-correct-activity=/);
  assert.match(timelineWidget, /更正归属|更正客户/);
  assert.match(timelineWidget, /writeReady\s*===\s*true/);
  assert.match(timelineWidget, /disabled aria-disabled/);
});

test('timeline keeps both audit sides and renders only visible provenance counterparts', () => {
  const timeline = `${functionBlock(app, 'activityTimelineRenderContext')}\n${functionBlock(app, 'renderActivityTimelineItemFallback')}`;
  assert.match(timeline, /superseded_original/);
  assert.match(timeline, /replacement/);
  assert.match(timeline, /已更正/);
  assert.match(timeline, /更正自|来源/);
  assert.match(timeline, /replacementCustomerId|targetCustomerId/);
  assert.match(timeline, /originalCustomerId|sourceCustomerId/);
  assert.match(timeline, /replacementActivityId/);
  assert.match(timeline, /originalActivityId/);
  assert.match(timeline, /correctionCustomerLabel|accountDisplayName|state\.data\?*\.accounts/);

  // A cross-scope API response deliberately blanks the counterpart IDs. The UI must not
  // guess, fetch or print an inaccessible customer merely because provenance exists.
  assert.match(timeline, /(?:if\s*\([^)]*)?replacementCustomerId\s*(?:\?|&&|\))/);
  assert.match(timeline, /(?:if\s*\([^)]*)?originalCustomerId\s*(?:\?|&&|\))/);
  assert.doesNotMatch(timeline, /api\([^)]*(replacement|original)(Customer|Activity)Id/);
  assert.match(timelineWidget, /受保护的来源记录|目标记录信息受权限保护/);
});

test('correction modal is an explicit three-step accessible workflow', () => {
  const open = functionBlock(app, 'openActivityCorrectionModal');
  const render = `${functionBlock(app, 'correctionStepMarkup')}\n${functionBlock(app, 'renderActivityCorrectionModal')}`;
  assert.match(open, /step:\s*1|step\s*=\s*1/);
  assert.match(open, /idempotencyKey/);
  assert.match(open, /crypto\.randomUUID\(\)/);
  assert.match(render, /选择正确客户/);
  assert.match(render, /填写更正原因/);
  assert.match(render, /确认更正/);
  assert.match(render, /data-correction-step=["']?1|activity-correction-step/);
  assert.match(render, /data-correction-step=["']?2|activity-correction-step/);
  assert.match(render, /data-correction-step=["']?3|activity-correction-step/);
  assert.match(render, /name=["']reason["']/);
  assert.match(render, /required/);
  assert.match(render, /来源客户/);
  assert.match(render, /目标客户/);
  assert.match(render, /活动时间/);
  assert.match(render, /业务影响/);
  assert.match(render, /aria-current|aria-label/);
  assert.match(render, /role=["']alert["']|aria-live=["']polite["']/);
});

test('target picker consumes the #116 schema and the complete paginated response contract', () => {
  const loadTargets = functionBlock(app, 'loadActivityCorrectionTargets');
  const query = functionBlock(app, 'activityCorrectionQuery');
  assert.match(loadTargets, /\/activity-correction-targets\?/);
  assert.match(query, /permissionVersion/);
  assert.match(query, /filters/);
  assert.match(query, /pageSize/);
  assert.match(loadTargets, /excludeCustomerId/);
  assert.match(loadTargets, /result\.schema/);
  assert.match(loadTargets, /result\.(rows|customers)/);
  assert.match(loadTargets, /result\.page/);
  assert.match(loadTargets, /result\.total/);
  assert.match(loadTargets, /result\.authorizedTotal/);
  assert.match(loadTargets, /result\.hasMore/);
  assert.match(loadTargets, /correction\.targets\s*=\s*rows/);
  assert.doesNotMatch(loadTargets, /\.\.\.state\.activityCorrection\.targets|concat\(/);
  assert.match(loadTargets, /FILTER_VERSION_CONFLICT/);

  const initialize = functionBlock(app, 'initializeActivityCorrectionTargetFilters');
  assert.match(initialize, /TradePulseFilterComponent/);
  assert.match(initialize, /activity_correction_targets/);
  assert.match(initialize, /updateSchema|createFilterController/);
});

test('manager proposal queue consumes its authorized schema, totals and pagination', () => {
  const load = functionBlock(app, 'loadActivityCorrectionProposals');
  const query = functionBlock(app, 'activityCorrectionQuery');
  const gate = functionBlock(app, 'canReviewActivityCorrections');
  assert.match(gate, /can\(['"]manage_activity_corrections['"]\)/);
  assert.match(gate, /state\.data\?*\.impersonation|state\.data\.impersonation/);
  assert.match(load, /\/activity-correction-proposals\?/);
  assert.match(query, /permissionVersion/);
  assert.match(query, /filters/);
  assert.match(query, /pageSize/);
  assert.match(load, /result\.schema/);
  assert.match(load, /result\.(rows|proposals)/);
  assert.match(load, /result\.page/);
  assert.match(load, /result\.total/);
  assert.match(load, /result\.authorizedTotal/);
  assert.match(load, /result\.hasMore/);
  assert.match(load, /FILTER_VERSION_CONFLICT/);

  const initialize = functionBlock(app, 'initializeActivityCorrectionProposalFilters');
  assert.match(initialize, /TradePulseFilterComponent/);
  assert.match(initialize, /activity_correction_proposals/);
  assert.match(initialize, /updateSchema|createFilterController/);
});

test('correction history is the third complete #116 authorized page', () => {
  const load = functionBlock(app, 'loadActivityCorrections');
  const query = functionBlock(app, 'activityCorrectionQuery');
  assert.match(load, /\/activity-corrections\?/);
  assert.match(query, /permissionVersion/);
  assert.match(query, /filters/);
  assert.match(query, /pageSize/);
  assert.match(load, /result\.schema/);
  assert.match(load, /result\.(rows|corrections)/);
  assert.match(load, /result\.page/);
  assert.match(load, /result\.total/);
  assert.match(load, /result\.authorizedTotal/);
  assert.match(load, /result\.hasMore/);
  assert.match(load, /FILTER_VERSION_CONFLICT/);

  const initialize = functionBlock(app, 'initializeActivityCorrectionHistoryFilters');
  assert.match(initialize, /TradePulseFilterComponent/);
  assert.match(initialize, /activity_corrections/);
  assert.match(initialize, /updateSchema|createFilterController/);
});

test('correction management has its own permission-gated route independent of manager tasks', () => {
  assert.match(html, /data-view=["']activityCorrections["'][^>]*data-permission=["']manage_activity_corrections["']/);
  assert.match(html, /data-view-panel=["']activityCorrections["']/);

  const viewMeta = namedSection(app, 'const viewMeta = {', 'const viewPermissions = {');
  const viewPermissions = namedSection(app, 'const viewPermissions = {', 'const activityMeta = {');
  assert.match(viewMeta, /activityCorrections/);
  assert.match(viewPermissions, /activityCorrections:\s*['"]manage_activity_corrections['"]/);
  assert.doesNotMatch(viewPermissions, /activityCorrections:\s*['"]resolve_manager_tasks['"]/);
});

test('submit reuses one idempotency key and preserves the draft on every failure', () => {
  const submit = functionBlock(app, 'submitActivityCorrection');
  assert.match(submit, /\/activity-corrections/);
  assert.match(submit, /originalActivityId/);
  assert.match(submit, /targetCustomerId/);
  assert.match(submit, /reason/);
  assert.match(submit, /idempotencyKey/);
  assert.doesNotMatch(submit, /crypto\.randomUUID\(\)/);
  assert.match(submit, /preserveOnForbidden:\s*true/);
  assert.match(submit, /pending|aria-busy|disabled/);
  assert.match(submit, /catch\s*\(error\)/);
  assert.match(submit, /error\.code|error\.status/);
  assert.doesNotMatch(submit, /catch\s*\([^)]*\)[\s\S]{0,240}(resetActivityCorrection|closeModal)\(/);
  assert.doesNotMatch(submit, /catch\s*\([^)]*\)[\s\S]{0,240}(targetCustomerId|reason)\s*=\s*['"]/);
});

test('idempotency key rotates for a changed payload but remains stable for a retry', () => {
  const key = functionBlock(app, 'activityCorrectionIdempotencyKey');
  const submit = functionBlock(app, 'submitActivityCorrection');
  assert.match(key, /originalActivityId/);
  assert.match(key, /targetCustomerId/);
  assert.match(key, /reason/);
  assert.match(key, /fingerprint|requestHash|JSON\.stringify/);
  assert.match(key, /state\.activityCorrection\.idempotencyKey/);
  assert.match(key, /crypto\.randomUUID\(\)/);
  assert.match(key, /!==|!=/);
  assert.match(submit, /activityCorrectionIdempotencyKey\(/);
  assert.doesNotMatch(submit, /crypto\.randomUUID/);
});

test('submit distinguishes direct success, approval pending, disabled writes and stale mapping', () => {
  const submit = functionBlock(app, 'submitActivityCorrection');
  assert.match(submit, /result\.correction|status\s*===\s*200/);
  assert.match(submit, /result\.proposal|status\s*===\s*202/);
  assert.match(submit, /ACTIVITY_CORRECTIONS_DISABLED|status\s*===\s*503/);
  assert.match(submit, /ACTIVITY_CORRECTION_MAPPING_CHANGED/);
  assert.match(submit, /FILTER_VERSION_CONFLICT|status\s*===\s*409/);
  assert.match(submit, /ACTIVITY_CORRECTION_FORBIDDEN|status\s*===\s*403/);
  assert.match(submit, /待审批|主管|管理员/);
  assert.match(submit, /尚未启用|暂不可用/);
  assert.match(submit, /刷新|重新/);
});

test('proposal review requires mapping resolution when offered and a reason when rejected', () => {
  const render = functionBlock(app, 'renderActivityCorrectionProposal');
  assert.match(render, /mappingResolution/);
  assert.match(render, /candidates/);
  assert.match(render, /activity_only/);
  assert.match(render, /commerce_entity/);
  assert.match(render, /拒绝/);
  assert.match(render, /reviewReason|reason/);

  const review = functionBlock(app, 'reviewActivityCorrectionProposal');
  assert.match(review, /\/activity-correction-proposals\/.*\/review/);
  assert.match(review, /decision/);
  assert.match(review, /expectedVersion/);
  assert.match(review, /idempotencyKey/);
  assert.match(review, /JSON\.stringify\(\{/);
  assert.match(review, /proposalId/);
  assert.match(review, /expectedVersion/);
  assert.match(review, /reason/);
  assert.match(review, /resolution/);
  assert.match(review, /resolution/);
  assert.match(review, /preserveOnForbidden:\s*true/);
  assert.match(review, /decision\s*===\s*['"]rejected['"][\s\S]{0,200}reason|reason[\s\S]{0,200}rejected/);
  assert.match(review, /ACTIVITY_CORRECTION_MAPPING_CHANGED|ACTIVITY_CORRECTION_VERSION_CONFLICT/);
  assert.doesNotMatch(review, /catch\s*\([^)]*\)[\s\S]{0,240}(closeModal|resetActivityCorrection)\(/);
  const conflictReloads = /catch\s*\([^)]*\)[\s\S]*loadActivityCorrectionProposals\(/.test(review);
  const preservesReviewDraft = /reviewDraft|retainedReason|preserveReview/.test(review);
  assert.equal(conflictReloads && !preservesReviewDraft, false,
    'mapping/version conflict must not discard the typed review reason');
});

test('an unavailable mapping cannot be approved from stale proposal UI', () => {
  const render = functionBlock(app, 'renderActivityCorrectionProposal');
  const review = functionBlock(app, 'reviewActivityCorrectionProposal');
  assert.match(render, /mappingResolution\?*\.required/);
  assert.match(render, /mappingResolution\?*\.available/);
  assert.match(render, /disabled/);
  assert.match(review, /mappingResolution\?*\.required/);
  assert.match(review, /!resolution/);
  assert.match(review, /decision\s*===\s*['"]approved['"]/);
  assert.match(review, /刷新|不可批准|重新加载/);
});

test('successful correction and review use one refresh path for all dependent views', () => {
  const refresh = functionBlock(app, 'refreshAfterActivityCorrection');
  assert.match(refresh, /sourceCustomerId/);
  assert.match(refresh, /targetCustomerId/);
  assert.match(refresh, /await\s+(?:load|refresh)\(/);
  assert.match(refresh, /customerProfile|openCustomerProfile|selectedCustomerId/);
  // load()/refresh() reloads bootstrap and renderAll(), which is the existing unified path
  // for profile, timeline and team. Authorized list controllers keep their own rows, so
  // alerts and manager metrics must also be invalidated/reloaded explicitly.
  assert.match(refresh, /sourceCustomerId[\s\S]*targetCustomerId|targetCustomerId[\s\S]*sourceCustomerId/);
  assert.match(refresh, /(?:loadAuthorizedBusinessPage|initializeAuthorizedBusinessFilters)\(['"]alerts['"]/);
  assert.match(refresh, /(?:loadAuthorizedBusinessPage|initializeAuthorizedBusinessFilters)\(['"]manager_metrics['"]/);
  assert.match(refresh, /(?:loadAuthorizedBusinessPage|initializeAuthorizedBusinessFilters)\(['"]manager_tasks['"]/);
  assert.match(refresh, /(?:loadAuthorizedBusinessPage|initializeAuthorizedBusinessFilters)\(['"]manager_risks['"]/);
  assert.match(refresh, /(?:loadAuthorizedBusinessPage|initializeAuthorizedBusinessFilters)\(['"]notifications['"]/);
  assert.match(refresh, /loadCustomerPage\(/);
  assert.match(refresh, /loadActivityCorrections\(/);
  assert.match(refresh, /loadActivityCorrectionProposals\(/);

  const submit = functionBlock(app, 'submitActivityCorrection');
  const review = functionBlock(app, 'reviewActivityCorrectionProposal');
  assert.match(submit, /refreshAfterActivityCorrection\(/);
  assert.match(review, /refreshAfterActivityCorrection\(/);
});

test('write availability comes from GET envelopes and disabled writes keep every read surface usable', () => {
  const apply = functionBlock(app, 'applyActivityCorrectionReadEnvelope');
  assert.match(app, /writeEnabled:\s*null/);
  assert.match(apply, /result\.writeEnabled/);
  assert.match(apply, /state\.activityCorrection\.writeEnabled/);
  assert.doesNotMatch(apply, /writeEnabled\s*=\s*true/);

  for (const name of [
    'loadActivityCorrectionTargets',
    'loadActivityCorrections',
    'loadActivityCorrectionProposals',
  ]) {
    const load = functionBlock(app, name);
    assert.match(load, /applyActivityCorrectionReadEnvelope\(result\)/, name);
    assert.doesNotMatch(load, /if\s*\([^)]*!?state\.activityCorrection\.writeEnabled[^)]*\)\s*return/, name);
  }

  const status = functionBlock(app, 'loadActivityCorrectionWriteStatus');
  assert.match(status, /\/activity-corrections\?/);
  assert.match(status, /preserveOnForbidden:\s*true/);
  assert.match(status, /statusRequestEpoch/);
  assert.match(status, /applyActivityCorrectionReadEnvelope/);
});

test('identity and permission boundaries clear correction state and invalidate stale requests', () => {
  const reset = functionBlock(app, 'resetActivityCorrectionState');
  assert.match(reset, /statusRequestEpoch\s*\+=\s*1/);
  assert.match(reset, /clearActivityCorrectionTargetResults\(\)/);
  assert.match(reset, /clearActivityCorrectionProposalResults\(\)/);
  assert.match(reset, /clearActivityCorrectionHistoryResults\(\)/);
  assert.match(reset, /writeEnabled:\s*null/);

  for (const name of [
    'clearActivityCorrectionTargetResults',
    'clearActivityCorrectionProposalResults',
    'clearActivityCorrectionHistoryResults',
  ]) {
    const clear = functionBlock(app, name);
    assert.match(clear, /RequestEpoch\s*\+=\s*1/);
    assert.match(clear, /\.destroy\(\)/);
    assert.match(clear, /Rows:\s*\[\]|targets:\s*\[\]/);
  }

  assert.match(functionBlock(app, 'load'), /resetActivityCorrectionState\(\)/);
  assert.match(functionBlock(app, 'refresh'), /resetActivityCorrectionState\(\)/);
  assert.match(functionBlock(app, 'clearForbiddenState'), /resetActivityCorrectionState\(\)/);
  assert.match(functionBlock(app, 'handleImpersonationEnded'), /resetActivityCorrectionState\(\)/);

  for (const name of [
    'loadActivityCorrectionTargets',
    'loadActivityCorrectionProposals',
    'loadActivityCorrections',
  ]) {
    const load = functionBlock(app, name);
    assert.match(load, /requestEpoch\s*!==[\s\S]{0,80}return null/);
    assert.match(load, /error\.status\s*===\s*403/);
  }
});

test('correction pagination requests explicit target pages without implicit increments', () => {
  const targets = functionBlock(app, 'loadActivityCorrectionTargets');
  const proposals = functionBlock(app, 'loadActivityCorrectionProposals');
  const history = functionBlock(app, 'loadActivityCorrections');
  for (const source of [targets, proposals, history]) {
    assert.match(source, /reset = false, page/);
    assert.doesNotMatch(source, /(?:target|proposal|history)Page\s*\+\s*1/);
  }
});

test('review transitions to read-only when the write gate closes and restores controls by policy', () => {
  const review = functionBlock(app, 'reviewActivityCorrectionProposal');
  assert.match(review, /ACTIVITY_CORRECTIONS_DISABLED/);
  assert.match(review, /error\.status\s*===\s*503/);
  assert.match(review, /writeEnabled\s*=\s*false/);
  assert.match(review, /writesDisabled/);
  assert.match(review, /unavailable/);
  assert.doesNotMatch(review, /querySelectorAll\(['"]button,select,textarea['"]\)[\s\S]{0,100}disabled\s*=\s*false/);
});

test('correction notifications provide review and completed actions without exposing hidden fields', () => {
  const render = functionBlock(app, 'renderNotifications');
  assert.match(render, /ACTIVITY_CORRECTION_REVIEW/);
  assert.match(render, /activityCorrections/);
  assert.match(render, /ACTIVITY_CORRECTION_COMPLETED/);
  assert.match(render, /data-notification-customer|data-target-view/);
  assert.doesNotMatch(render, /assignmentReason|decision_reason|rankedCandidates|aiRecommendation/);
});

test('correction UI never renders AI evidence or assignment-decision fields', () => {
  const correctionUi = [
    'renderActivityTimelineItem',
    'renderActivityCorrectionModal',
    'renderActivityCorrectionProposal',
  ].map(name => functionBlock(app, name)).join('\n');
  assert.doesNotMatch(correctionUi, /rankedCandidates|aiRecommendation|AI[_A-Za-z]|aiContext|异常辅导/);
  assert.doesNotMatch(correctionUi, /assignmentReason|decision_reason|suggested_owner|candidateSnapshot|quota|额度|分配原因|候选销售|排除原因/);
});

test('correction dialog restores focus and remains usable at 320px', () => {
  const open = functionBlock(app, 'openActivityCorrectionModal');
  const close = functionBlock(app, 'closeActivityCorrectionModal');
  assert.match(open, /activeElement|returnFocus|trigger/);
  assert.match(open, /focus\(/);
  assert.match(close, /returnFocus|trigger/);
  assert.match(close, /focus\(/);

  assert.match(css, /\.activity-correction-[\w-]+/);
  assert.match(css, /@media\s*\(max-width:\s*(?:320|3[2-9]\d|4[0-3]\d)px\)[\s\S]*activity-correction/);
  assert.match(css, /\.activity-correction-[\w-]+\s*\{[^}]*(?:minmax\(0,\s*1fr\)|grid-template-columns:\s*1fr|width:\s*100%)/);
  assert.match(css, /\.activity-correction-[\w-]+\s*\{[^}]*(?:overflow-wrap|word-break|min-width:\s*0)/);
});

test('Issue 171 JavaScript and CSS assets share a new cache-busting release token', () => {
  const jsVersion = html.match(/\/sales-assets\/app\.js\?v=([^"']+)/)?.[1];
  const cssVersion = html.match(/\/sales-assets\/app\.css\?v=([^"']+)/)?.[1];
  assert.ok(jsVersion, 'app.js must have a cache-busting version');
  assert.ok(cssVersion, 'app.css must have a cache-busting version');
  assert.equal(jsVersion, cssVersion);
  assert.match(jsVersion, /issue171|202608\d{2}/);
});

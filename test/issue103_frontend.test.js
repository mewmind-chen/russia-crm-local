'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');

function poolMarkup() {
  return html.match(/<section id="poolView"[\s\S]*?<section id="customersView"/)?.[0] || '';
}

test('Issue #103 keeps one canonical lead pool surface and legacy route aliases', () => {
  assert.equal((html.match(/id="poolView"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="intakeView"|id="unifiedPoolTable"|id="poolSearch"/);
  assert.doesNotMatch(js, /function renderUnifiedPool/);
  const researchConfig = js.match(/const researchConfig = \{[\s\S]*?\n  \};/)?.[0] || '';
  assert.doesNotMatch(researchConfig, /\bpool:/);
  assert.match(js, /intakeAlias = \['intake', 'pending', 'claimed'\]\.includes\(view\)/);
  assert.match(js, /canonicalView = intakeAlias \? 'pool' : view/);
});

test('Issue #103 exposes the unified status model without a review tab', () => {
  const pool = poolMarkup();
  for (const status of ['', 'unassigned', 'assigned', 'claimed', 'returned', 'rejected']) {
    assert.match(pool, new RegExp(`data-intake-status="${status}"`));
  }
  assert.doesNotMatch(pool, /待审核|data-intake-status="pending"|data-intake-status="approved"/);
  assert.match(js, /if \(state\.intakeStatus\) params\.set\('status', state\.intakeStatus\)/);
  assert.match(js, /unassigned: Number\(stats\.pending \|\| 0\) \+ Number\(stats\.approved \|\| 0\)/);
});

test('Issue #103 detailed filters use the intake API and customer-tag wording', () => {
  const pool = poolMarkup();
  for (const id of [
    'intakeSearch', 'intakeCustomerTagFilter', 'intakeCountryFilter', 'intakeIndustryFilter',
    'intakeCustomerTypeFilter', 'intakeContactLevelFilter', 'intakeOwnerFilter',
    'intakeSourceBatchFilter', 'intakeUpdatedFromFilter', 'intakeUpdatedToFilter',
    'intakeHasWebsiteFilter', 'intakeHasNamedContactFilter', 'intakeUnassignedOnlyFilter',
  ]) {
    assert.match(pool, new RegExp(`id="${id}"`), `missing filter ${id}`);
  }
  assert.match(pool, /客户标签/);
  assert.doesNotMatch(pool, /业务标签/);
  assert.match(js, /Object\.entries\(state\.intakeFilters\)[\s\S]*?params\.set\(key/);
  assert.match(js, /\/api\/sales-crm\/intake\?\$\{params\}/);
});

test('Issue #103 preserves the AI gate and applies one return eligibility rule everywhere', () => {
  assert.match(js, /const showAI = customerAIEnabled\(\)/);
  assert.match(js, /const intakeHeaders = showAI/);
  assert.match(js, /function canReturnCustomer\(account\)/);
  assert.match(js, /!\['assigned', 'claimed'\]\.includes\(String\(account\.assignment_status \|\| ''\)\)/);
  assert.match(js, /const canReturn = canReturnCustomer\(account\)/);
  assert.match(js, /\$\{canReturnCustomer\(account\)/);
  assert.match(js, /function selectedCustomersReturnEligible\(\)/);
  assert.match(js, /if \(!selectedCustomersReturnEligible\(\)\) return toast/);
});

test('Issue #103 shows returned reasons in list and lead details', () => {
  assert.match(js, /item\.status === 'returned' \? \[\['退回原因', item\.return_reason \|\| '未填写'\]\]/);
  assert.match(js, /<span>退回原因<\/span><p>\$\{esc\(item\.return_reason \|\| '未填写'\)\}/);
  assert.match(js, /esc\(item\.return_reason \|\| ''\)/);
});

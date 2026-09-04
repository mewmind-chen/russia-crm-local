const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales-crm.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'sales-assets', 'app.css'), 'utf8');

test('primary navigation is made of real links with stable routes', () => {
  const sidebar = html.match(/<nav id="nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.doesNotMatch(sidebar, /<button[^>]*data-view=/);
  for (const view of ['dashboard', 'alerts', 'notifications', 'pool', 'customers', 'pipeline', 'team']) {
    assert.match(sidebar, new RegExp(`<a[^>]+href="/#${view}"[^>]+data-view="${view}"`));
  }
  assert.match(html, /<a[^>]+href="\/#alerts"[^>]+data-go="alerts">查看全部<\/a>/);
  assert.match(html, /<a[^>]+href="\/#markets"[^>]+data-go="markets">深度分析<\/a>/);
  assert.doesNotMatch(`${html}\n${appJs}`, /href="(?:#|javascript:|)"/i);
});

test('customer and lead names render as real detail links', () => {
  const intakeRows = appJs.match(/const businessColumns = \[[\s\S]*?\n          `<div class="intake-contact/)?.[0] || '';
  assert.match(appJs, /company:\s*customerEntityMarkup\(\s*account\s*,/);
  assert.match(intakeRows, /intakeDrawerHref\(item\.id, 'pool'\)/);
  assert.match(intakeRows, /data-intake-profile="\$\{esc\(item\.id\)\}"/);
  assert.match(appJs, /function customerEntityMarkup\(account,[\s\S]*?href: customerDrawerHref\(account\.id/);
  assert.match(appJs, /class="an tp-company-anchor internal-detail-link" href=/);
  assert.match(appJs, /<a class="text-button internal-detail-link" href="\$\{esc\(customerDrawerHref\(account\.id, 'notifications'\)\)\}" data-notification-customer=/);
  assert.match(appJs, /function todayTaskCustomerMarkup\(item, account, view = 'alerts'\)/);
  assert.match(appJs, /data-intake-profile="\$\{esc\(intakeId\)\}"/);
  assert.match(appJs, /data-open-customer="\$\{esc\(customerId\)\}"/);
});

test('website values are direct external links across list and review surfaces', () => {
  assert.match(appJs, /function listEntityWebsiteMarkup\(value\)/);
  assert.match(appJs, /listEntityWebsiteMarkup\(item\.website\)/);
  assert.match(appJs, /listEntityWebsiteMarkup\(account\.website \|\| account\.domain\)/);
  assert.match(appJs, /website:\s*websiteMarkup\(item\.website\)/);
  assert.match(appJs, /function comparisonValueMarkup\(value, kind = 'text'\)/);
  assert.match(appJs, /comparisonValueMarkup\(submitted, kind\)/);
  assert.match(appJs, /duplicate-candidate-result/);
  assert.match(appJs, /websiteMarkup\(item\.website\)/);
  assert.match(appJs, /\['官网', websiteMarkup\(recycleWebsite\)\]/);
});

test('modified clicks preserve browser link behavior while plain clicks keep SPA behavior', () => {
  assert.match(appJs, /function isPlainPrimaryClick\(event\)/);
  assert.match(appJs, /event\.button === 0/);
  assert.match(appJs, /!event\.ctrlKey && !event\.metaKey && !event\.shiftKey && !event\.altKey/);
  assert.match(appJs, /if \(!isPlainPrimaryClick\(event\)\) return true;/);
  assert.match(appJs, /event\.preventDefault\(\);[\s\S]*?switchView\(link\.dataset\.view\)/);
  assert.match(appJs, /link\.matches\('a\[data-go\]'\)[\s\S]*?switchView\(link\.dataset\.go\)/);
  assert.match(appJs, /const active = item\.dataset\.view === canonicalView;[\s\S]*?setAttribute\('aria-current', 'page'\)[\s\S]*?removeAttribute\('aria-current'\)/);
});

test('deep links restore the selected view and detail target', () => {
  assert.match(appJs, /function internalNavigationHref\(/);
  assert.match(appJs, /url\.searchParams\.set\('customer', customer\)/);
  assert.match(appJs, /url\.searchParams\.set\('intake', intake\)/);
  assert.match(appJs, /function restoreInternalNavigationFromLocation\(/);
  assert.equal(
    (appJs.match(/requestedIntakeItemId && \['pool', 'intake', 'pending', 'claimed', 'alerts'\]\.includes\(requestedView\)/g) || []).length,
    2,
  );
  assert.match(appJs, /openCustomer\(requestedCustomerId, \{ updateUrl: false \}\)/);
  assert.match(appJs, /openIntakeProfile\(requestedIntakeItemId, \{ updateUrl: false \}\)/);
  assert.match(appJs, /if \(!requestedCustomerId && !requestedIntakeItemId[\s\S]*?closeDrawer\(\{ preserveUrl: true \}\)/);
  assert.match(appJs, /if \(state\.selectedCustomerId\) renderDrawer\(\);[\s\S]*?else if \(!state\.drawerOwner\.startsWith\('intake:'\)\) closeDrawer\(\)/);
});

test('navigation links retain keyboard focus and do not inherit underlined browser styling', () => {
  assert.match(appCss, /\.nav a:focus-visible/);
  assert.match(appCss, /\.attention-item,\.feed-item,\.internal-detail-link\{[^}]*text-decoration:none/);
});

test('business mutations remain buttons instead of navigation links', () => {
  assert.match(appJs, /<button class="button primary tiny" data-intake-action="claim"/);
  assert.match(appJs, /<button class="text-button danger-text" data-intake-unassign=/);
  assert.match(appJs, /<button class="text-button danger-text" data-return-customer=/);
  assert.match(appJs, /<button class="button primary tiny" type="button" data-pipeline-progress=/);
});

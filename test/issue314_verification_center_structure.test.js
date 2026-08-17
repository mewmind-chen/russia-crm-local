'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.css'), 'utf8');

function cssRule(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

function mediaBlock(query) {
  const marker = `@media(${query}){`;
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const end = css.indexOf('\n@media', start + marker.length);
  return css.slice(start, end === -1 ? css.length : end);
}

test('protection workspace has one title and three top-level views', () => {
  assert.equal((html.match(/<h2>客户保护与查重<\/h2>/g) || []).length, 1);
  for (const view of ['verification', 'directory', 'import']) {
    assert.match(html, new RegExp(`data-protection-view="${view}"`));
    assert.match(html, new RegExp(`data-protection-panel="${view}"`));
  }
  assert.match(app, /function activateProtectionView\(view/);
  assert.match(app, /activeView: 'verification'/);
});

test('directory and import actions live in their own panels', () => {
  const directory = html.slice(html.indexOf('data-protection-panel="directory"'), html.indexOf('data-protection-panel="import"'));
  const importPanel = html.slice(html.indexOf('data-protection-panel="import"'));
  assert.match(directory, /protectedExportBtn/);
  assert.doesNotMatch(directory, /protectedTemplateBtn/);
  assert.match(importPanel, /protectedTemplateBtn/);
});

test('live workbench rows have stable desktop tracks', () => {
  assert.match(cssRule('.pending-workbench'), /grid-template-columns:minmax\(330px,380px\) minmax\(0,1fr\)/);
  assert.match(cssRule('.pending-queue-row'), /min-height:82px/);
  assert.match(cssRule('.pending-queue-record'), /min-height:82px/);
});

test('production verification page keeps the approved preview hierarchy', () => {
  for (const marker of [
    'verification-page-header', 'verification-page-description',
    'verification-status-tabs', 'verification-tools',
    'pending-queue-heading', 'pending-detail-head', 'pending-detail-summary',
  ]) assert.match(`${html}\n${app}`, new RegExp(marker));
  assert.match(cssRule('.pending-workbench'), /min-height:0/);
  assert.match(cssRule('.pending-queue-row'), /min-height:82px/);
  assert.match(cssRule('.pending-detail-actions'), /min-height:68px/);
});

test('live conflict and duplicate details use the safe-area action footer', () => {
  assert.match(app, /<footer class="pending-detail-actions protected-conflict-actions">\s*<button[^>]*data-pending-detail-close[^>]*>暂不处理<\/button>\s*<button[^>]*data-save-protected-conflict[^>]*>[^<]*<\/button>\s*<\/footer>/);
  assert.match(app, /<footer class="pending-detail-actions duplicate-review-actions">\s*<button[^>]*data-duplicate-resolution-save[^>]*>[^<]*<\/button>\s*<\/footer>/);
  assert.match(cssRule('.pending-detail-actions'), /position:sticky/);
  assert.match(cssRule('.pending-detail-actions'), /border-top:1px solid var\(--line\)/);
  assert.match(cssRule('.pending-detail-actions'), /background:#fff/);
  assert.match(cssRule('.pending-detail-actions .button'), /min-height:44px/);
});

test('live verification detail tracks and footers stay content-sized', () => {
  assert.match(cssRule('.protected-conflict-detail'), /align-content:start/);
  assert.match(cssRule('.protected-conflict-detail'), /grid-auto-rows:max-content/);
  assert.match(cssRule('.pending-detail-actions'), /align-self:stretch/);
});

test('mobile workbench rules target live panes and controls', () => {
  const mobile = mediaBlock('max-width:760px');
  const narrow = mediaBlock('max-width:320px');
  const reducedMotion = mediaBlock('prefers-reduced-motion:reduce');

  assert.match(cssRule('.pending-detail.mobile-detail-open,.pending-workbench.mobile-detail-open .pending-detail', mobile), /transform:translateX\(0\)/);
  assert.match(cssRule('.pending-queue[aria-hidden="true"],.pending-detail[aria-hidden="true"]', mobile), /pointer-events:none/);
  assert.match(cssRule('.pending-detail-close,.pending-mobile-back', mobile), /min-height:44px/);
  assert.match(cssRule('.pending-detail-actions', mobile), /env\(safe-area-inset-bottom\)/);
  assert.match(cssRule('.pending-comparison,.duplicate-review-comparison', mobile), /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(cssRule('.pending-detail-actions', narrow), /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(cssRule('.pending-detail-actions .button', narrow), /width:100%/);
  assert.match(cssRule('.pending-detail', reducedMotion), /transition:none/);
});

test('login heading keeps fixed responsive breakpoint sizes', () => {
  assert.match(cssRule('.login-brand h1'), /font-size:76px/);
  assert.match(cssRule('.login-brand h1', mediaBlock('max-width:1400px')), /font-size:64px/);
  assert.match(cssRule('.login-brand h1', mediaBlock('max-width:1100px')), /font-size:52px/);
  assert.match(cssRule('.login-brand h1', mediaBlock('max-width:900px')), /font-size:42px/);
  assert.doesNotMatch(cssRule('.login-brand h1'), /font-size:clamp\([^)]*vw/);
});

test('all CRM frontend assets and visible badge share the current release version', () => {
  const version = '20260817-issue318-distinct-identity';
  assert.match(html, new RegExp(`data-app-version="${version}"`));
  const versions = [...html.matchAll(/sales-assets\/[^"]+\?v=([^"&]+)/g)].map(match => match[1]);
  assert.ok(versions.length >= 4);
  assert.deepEqual([...new Set(versions)], [version]);
});

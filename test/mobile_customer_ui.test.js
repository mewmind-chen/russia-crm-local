'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'sales-assets', 'app.css'), 'utf8');

test('sales shell reserves safe-area space for mobile browsers', () => {
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
});

test('shared list renderers expose labels for mobile card presentation', () => {
  assert.match(app, /<td data-label="\$\{esc\(labels\[index\] \|\| ''\)\}">\$\{cell\}<\/td>/);
  assert.match(css, /#intakeTable > table > tbody > tr > td::before/);
  assert.match(css, /#customerTable > table > tbody > tr > td::before/);
});

test('pool and customer lists switch to viewport-safe labelled cards on small screens', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /#intakeTable > table > tbody > tr,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /#customerTable > table > tbody > tr,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /#poolView \.intake-list-toolbar[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /#customersView \.customer-list-toolbar[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
});

test('customer profile keeps controls and facts within a single mobile viewport', () => {
  assert.match(css, /body\.customer-profile-active\[data-app="sales"\] \.top-actions\s*\{\s*display: none !important;/);
  assert.match(css, /\.customer-profile-view\.active\s*\{[\s\S]*?height: calc\(100dvh - 71px\)/);
  assert.match(css, /\.profile-widget-section\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.customer-profile-tabs\s*\{[\s\S]*?overflow-x: auto/);
});

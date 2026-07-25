'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const {
  LEGACY_FRONTEND_SHELL,
  MODULAR_FRONTEND_SHELL,
  resolveFrontendShell,
} = require('../lib/frontend_shell');

test('frontend shell resolver fails closed to the legacy shell', () => {
  for (const value of [undefined, '', '0', 'false', 'yes', 'enabled', 'TRUE-ish']) {
    assert.equal(
      resolveFrontendShell(value === undefined ? {} : { CRM_UX_REDESIGN_ENABLED: value }),
      LEGACY_FRONTEND_SHELL,
    );
  }
});

test('frontend shell resolver accepts only explicit 1 and true values', () => {
  for (const value of ['1', 1, true, 'true', ' TRUE ']) {
    assert.equal(
      resolveFrontendShell({ CRM_UX_REDESIGN_ENABLED: value }),
      MODULAR_FRONTEND_SHELL,
    );
  }
});

test('root route delegates only shell selection to the resolver', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /const \{ resolveFrontendShell \} = require\('\.\/lib\/frontend_shell'\)/);
  assert.match(source, /app\.get\('\/',[\s\S]{0,180}resolveFrontendShell\(options\.env \|\| process\.env\)/);
});

test('both shells use the same sales API and extracted service layer', () => {
  const legacy = fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8');
  const modular = fs.readFileSync(path.join(root, 'sales-crm-next.html'), 'utf8');
  const modularApp = fs.readFileSync(path.join(root, 'sales-assets', 'modular-app.js'), 'utf8');
  assert.match(legacy, /\/sales-assets\/app\.js/);
  assert.match(modular, /\/sales-assets\/modular-app\.js/);
  assert.match(modularApp, /from '\.\/services\/session\.js'/);
  assert.match(modularApp, /bootstrap\(\['core'\]/);
  assert.doesNotMatch(modularApp, /bootstrap\(null/);
  assert.match(modularApp, /\/core\/|\.\/core\//);
  assert.doesNotMatch(modularApp, /\/api\/sales-crm\//);
});

test('new html stays a thin mount document with shared portals', () => {
  const source = fs.readFileSync(path.join(root, 'sales-crm-next.html'), 'utf8');
  for (const id of ['loginScreen', 'appMount', 'modalPortal', 'drawerPortal', 'toastPortal']) {
    assert.match(source, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(source, /customerProfileFrame|dashboardView|customerTable/);
});

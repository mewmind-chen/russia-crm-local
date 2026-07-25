const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'refactor', 'frontend-capability-manifest.json');
const {
  DESIGN_CAPABILITY_CATEGORIES,
  auditManifest,
  loadManifest,
} = require('../scripts/audit-frontend-parity');
const { SALES_ROUTE_POLICIES } = require('../lib/access_control');

function repositoryAudit(manifest = loadManifest(MANIFEST_PATH)) {
  return auditManifest({
    manifest,
    html: fs.readFileSync(path.join(ROOT, 'sales-crm.html'), 'utf8'),
    appSource: fs.readFileSync(path.join(ROOT, 'sales-assets', 'app.js'), 'utf8'),
    routePolicies: SALES_ROUTE_POLICIES,
  });
}

test('capability manifest records every required migration field', () => {
  const manifest = loadManifest(MANIFEST_PATH);

  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.capabilities));
  assert.ok(manifest.capabilities.length > DESIGN_CAPABILITY_CATEGORIES.length);

  const requiredFields = [
    'id',
    'category',
    'legacyRoutes',
    'newModules',
    'roles',
    'permissions',
    'featureFlags',
    'apiPolicies',
    'tests',
    'migrationStatus',
  ];
  for (const capability of manifest.capabilities) {
    for (const field of requiredFields) {
      assert.ok(
        Object.hasOwn(capability, field),
        `${capability.id || '<missing id>'} is missing ${field}`,
      );
    }
  }
});

test('audit reports an unmapped data-view', () => {
  const manifest = loadManifest(MANIFEST_PATH);
  const result = auditManifest({
    manifest,
    html: '<button data-view="new-unmapped-view">New</button>',
    appSource: '',
    routePolicies: {},
  });

  assert.deepEqual(result.unmappedViews, ['new-unmapped-view']);
  assert.equal(result.ok, false);
});

test('audit reports an unmapped SALES_ROUTE_POLICIES entry', () => {
  const manifest = loadManifest(MANIFEST_PATH);
  const result = auditManifest({
    manifest,
    html: '',
    appSource: '',
    routePolicies: {
      'GET /future-policy': { permissions: ['view_customers'] },
    },
  });

  assert.deepEqual(result.unmappedRoutePolicies, ['GET /future-policy']);
  assert.equal(result.ok, false);
});

test('audit reports a missing design section 3 category', () => {
  const manifest = loadManifest(MANIFEST_PATH);
  const missingCategory = DESIGN_CAPABILITY_CATEGORIES[0];
  const result = repositoryAudit({
    ...manifest,
    capabilities: manifest.capabilities.filter(item => item.category !== missingCategory),
  });

  assert.ok(result.unmappedCategories.includes(missingCategory));
  assert.equal(result.ok, false);
});

test('repository capability baseline has no unmapped views, policies, or categories', () => {
  const result = repositoryAudit();

  assert.deepEqual(result.invalidCapabilities, []);
  assert.deepEqual(result.duplicateCapabilityIds, []);
  assert.deepEqual(result.unmappedViews, []);
  assert.deepEqual(result.unmappedRoutePolicies, []);
  assert.deepEqual(result.unmappedCategories, []);
  assert.equal(result.ok, true);
});

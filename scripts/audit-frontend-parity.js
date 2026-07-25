#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DESIGN_CAPABILITY_CATEGORIES = Object.freeze([
  '身份与会话',
  '权限治理',
  '经营首页',
  '销售首页',
  '线索分配',
  '客户经营',
  '跟进',
  '商务',
  '客户资料',
  '情报',
  'AI 助手',
  'AI 工作站',
  'AI 补全',
  'AI Control Plane',
  'AI 治理',
  '通知',
  '团队洞察',
  '系统管理',
  '报表与交付',
  '运行保障',
]);

const REQUIRED_FIELDS = Object.freeze([
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
]);
const ARRAY_FIELDS = new Set([
  'legacyRoutes',
  'newModules',
  'roles',
  'permissions',
  'featureFlags',
  'apiPolicies',
  'tests',
]);
const NON_EMPTY_ARRAY_FIELDS = new Set(['newModules', 'roles', 'tests']);
const MIGRATION_STATUSES = new Set(['baseline', 'in_progress', 'verified', 'retired']);

function loadManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    error.message = `Unable to load frontend capability manifest at ${resolved}: ${error.message}`;
    throw error;
  }
}

function extractDataViews(source) {
  const views = new Set();
  const pattern = /\bdata-view\s*=\s*(["'])([^"']+)\1/g;
  for (const match of String(source || '').matchAll(pattern)) views.add(match[2].trim());
  return views;
}

function normalizeLegacyRoute(route) {
  const value = String(route || '').trim();
  if (!value) return '';
  if (value.includes('#')) return value.slice(value.lastIndexOf('#') + 1).split(/[?&]/, 1)[0];
  return value.replace(/^#/, '');
}

function validateCapability(capability, index) {
  const issues = [];
  const label = capability?.id || `capabilities[${index}]`;
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
    return [`${label} must be an object`];
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(capability, field)) {
      issues.push(`${label} is missing ${field}`);
      continue;
    }
    if (ARRAY_FIELDS.has(field) && !Array.isArray(capability[field])) {
      issues.push(`${label}.${field} must be an array`);
    } else if (
      NON_EMPTY_ARRAY_FIELDS.has(field)
      && Array.isArray(capability[field])
      && capability[field].length === 0
    ) {
      issues.push(`${label}.${field} must not be empty`);
    }
  }
  if (typeof capability.id !== 'string' || !capability.id.trim()) {
    issues.push(`${label}.id must be a non-empty string`);
  }
  if (typeof capability.category !== 'string' || !capability.category.trim()) {
    issues.push(`${label}.category must be a non-empty string`);
  }
  if (!MIGRATION_STATUSES.has(capability.migrationStatus)) {
    issues.push(`${label}.migrationStatus must be one of ${[...MIGRATION_STATUSES].join(', ')}`);
  }
  return issues;
}

function auditManifest({ manifest, html = '', appSource = '', routePolicies = {} }) {
  const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const invalidCapabilities = capabilities.flatMap(validateCapability);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    invalidCapabilities.unshift('manifest must be an object');
  } else if (!Array.isArray(manifest.capabilities)) {
    invalidCapabilities.unshift('manifest.capabilities must be an array');
  }

  const ids = new Set();
  const duplicateCapabilityIds = [];
  for (const capability of capabilities) {
    const id = typeof capability?.id === 'string' ? capability.id.trim() : '';
    if (!id) continue;
    if (ids.has(id)) duplicateCapabilityIds.push(id);
    ids.add(id);
  }

  const mappedViews = new Set(capabilities.flatMap(item => (
    Array.isArray(item?.legacyRoutes) ? item.legacyRoutes.map(normalizeLegacyRoute) : []
  )).filter(Boolean));
  const sourceViews = new Set([
    ...extractDataViews(html),
    ...extractDataViews(appSource),
  ]);
  const mappedRoutePolicies = new Set(capabilities.flatMap(item => (
    Array.isArray(item?.apiPolicies) ? item.apiPolicies : []
  )));
  const mappedCategories = new Set(capabilities.map(item => item?.category).filter(Boolean));

  const unmappedViews = [...sourceViews].filter(view => !mappedViews.has(view)).sort();
  const unmappedRoutePolicies = Object.keys(routePolicies || {})
    .filter(policy => !mappedRoutePolicies.has(policy))
    .sort();
  const unmappedCategories = DESIGN_CAPABILITY_CATEGORIES
    .filter(category => !mappedCategories.has(category));

  return {
    ok: invalidCapabilities.length === 0
      && duplicateCapabilityIds.length === 0
      && unmappedViews.length === 0
      && unmappedRoutePolicies.length === 0
      && unmappedCategories.length === 0,
    capabilityCount: capabilities.length,
    sourceViewCount: sourceViews.size,
    routePolicyCount: Object.keys(routePolicies || {}).length,
    designCategoryCount: DESIGN_CAPABILITY_CATEGORIES.length,
    invalidCapabilities,
    duplicateCapabilityIds: [...new Set(duplicateCapabilityIds)].sort(),
    unmappedViews,
    unmappedRoutePolicies,
    unmappedCategories,
  };
}

function runCli(argv = process.argv.slice(2)) {
  const unknown = argv.filter(arg => arg !== '--json');
  if (unknown.length) {
    process.stderr.write(`Unknown option: ${unknown.join(', ')}\n`);
    return 2;
  }

  const root = path.join(__dirname, '..');
  const { SALES_ROUTE_POLICIES } = require(path.join(root, 'lib', 'access_control'));
  const result = auditManifest({
    manifest: loadManifest(path.join(root, 'docs', 'refactor', 'frontend-capability-manifest.json')),
    html: fs.readFileSync(path.join(root, 'sales-crm.html'), 'utf8'),
    appSource: fs.readFileSync(path.join(root, 'sales-assets', 'app.js'), 'utf8'),
    routePolicies: SALES_ROUTE_POLICIES,
  });

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Frontend parity audit: ${result.ok ? 'PASS' : 'FAIL'}`,
      `Capabilities: ${result.capabilityCount}`,
      `Unmapped data-view routes: ${result.unmappedViews.length}`,
      `Unmapped SALES_ROUTE_POLICIES: ${result.unmappedRoutePolicies.length}`,
      `Unmapped design categories: ${result.unmappedCategories.length}`,
      `Invalid capability records: ${result.invalidCapabilities.length}`,
      `Duplicate capability IDs: ${result.duplicateCapabilityIds.length}`,
      '',
    ].join('\n'));
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  DESIGN_CAPABILITY_CATEGORIES,
  auditManifest,
  loadManifest,
  runCli,
};

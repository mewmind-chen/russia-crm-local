'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { hasPermission, ROLE_PERMISSIONS, contactSafeAccountRecord } = require('../lib/access_control');
const { FILTER_DEFINITIONS } = require('../lib/filter_catalog');
const {
  effectiveFilterSchemaFor,
  installFilterAuthorization,
  listFilterDefinitions,
} = require('../lib/filter_authorization');

const NOW = '2026-08-01 12:00:00';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE permission_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_key TEXT NOT NULL,
      permissions_json TEXT NOT NULL
    );
    CREATE TABLE sales_users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      permission_group_id TEXT NOT NULL,
      permissions_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE user_permission_overrides (
      user_id TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      effect TEXT NOT NULL,
      PRIMARY KEY(user_id, permission_key)
    );
  `);
  const insertGroup = db.prepare(
    'INSERT INTO permission_groups(id,name,role_key,permissions_json) VALUES (?,?,?,?)',
  );
  const insertUser = db.prepare(
    'INSERT INTO sales_users(id,role,permission_group_id) VALUES (?,?,?)',
  );
  for (const role of ['admin', 'manager', 'sales']) {
    const groupId = `PGRP-${role.toUpperCase()}`;
    insertGroup.run(groupId, role, role, JSON.stringify(ROLE_PERMISSIONS[role]));
    insertUser.run(role.toUpperCase(), role, groupId);
  }
  installFilterAuthorization(db, { now: NOW });
  return db;
}

function user(role, patch = {}) {
  return {
    id: role.toUpperCase(),
    role,
    permission_group_id: `PGRP-${role.toUpperCase()}`,
    permissions: { ...ROLE_PERMISSIONS[role], ...patch },
  };
}

function authorizedFilterKeys(db, actor, page) {
  return effectiveFilterSchemaFor(db, actor, page).filters.map(item => item.key);
}

// 阶段 C 按页面合同：已授权筛选 schema 永不包含用户权限不满足的筛选器，
// 且联系人门控（requiredPermissions 含 view_contacts）对无 view_contacts 用户绝对缺席。
test('authorized filter schema never leaks a filter the user lacks permission for', () => {
  const db = createDb();
  const variants = [
    ['sales-nocontact', 'sales', { view_contacts: false }],
    ['sales-contact', 'sales', { view_contacts: true }],
    ['manager', 'manager', {}],
    ['admin', 'admin', {}],
  ];
  const pages = ['customers', 'intake', 'lead_flow', 'pipeline', 'alerts', 'notifications'];
  const definitions = new Map(listFilterDefinitions(db).map(item => [item.key, item]));
  for (const [, role, patch] of variants) {
    const actor = user(role, patch);
    for (const page of pages) {
      for (const key of authorizedFilterKeys(db, actor, page)) {
        const definition = definitions.get(key);
        assert.ok(definition, `unknown filter ${key} leaked for ${role} on ${page}`);
        for (const permission of definition.requiredPermissions) {
          assert.equal(hasPermission(actor, permission), true,
            `filter ${key} requires ${permission} but leaked for ${role} on ${page}`);
        }
      }
    }
  }
  db.close();
});

test('contact-gated filters are absent for no-view_contacts users on account pages', () => {
  const db = createDb();
  // 目录不变量：联系人敏感筛选器必须在 requiredPermissions 声明 view_contacts
  const definitions = new Map(FILTER_DEFINITIONS.map(item => [item.key, item]));
  for (const key of ['tag_business_product', 'tag_demand_product']) {
    assert.ok(definitions.get(key).requiredPermissions.includes('view_contacts'),
      `${key} must gate on view_contacts`);
  }
  for (const page of ['customers', 'intake', 'lead_flow', 'pipeline']) {
    assert.deepEqual(
      authorizedFilterKeys(db, user('sales', { view_contacts: false }), page)
        .filter(key => key === 'tag_business_product' || key === 'tag_demand_product'),
      [],
      `no contact-gated filter may appear for a sales user without view_contacts on ${page}`,
    );
  }
  db.close();
});

// 字段↔筛选对称：account 白名单剥联系人字段，决定了无 view_contacts 用户
// 没有可筛选的联系人维度（与上一测的筛选缺席一致）。
test('account whitelist strips the same contact fields the no-contact filters hide', () => {
  const safe = contactSafeAccountRecord({
    id: 'CRM-1', stage: 'quoted', company_name: 'Firm', email: 'a@b.io', phone: '123',
    contact: '张三', contact_level: 'L1', owner_name: '销售甲', potential_value: 100,
  });
  for (const key of ['email', 'phone', 'contact', 'contact_level']) {
    assert.ok(!(key in safe), `account whitelist must strip ${key}`);
  }
  for (const key of ['stage', 'company_name', 'owner_name', 'potential_value']) {
    assert.ok(key in safe, `account whitelist must keep ${key}`);
  }
});
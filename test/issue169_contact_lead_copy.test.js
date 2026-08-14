'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PERMISSION_DEFINITIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  policyForLegacyRequest,
} = require('../lib/access_control');

const root = path.resolve(__dirname, '..');
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');
const salesHtml = read('sales-crm.html');
const salesJs = read('sales-assets', 'app.js');
const workbenchHtml = read('Index.html');
const readme = read('README.md');

const moduleName = '客户联系人线索';
const permissionName = '客户联系人线索';
const description = '寻找并核实客户公司的采购、老板、工程师等潜在联系人；确认后进入正式客户联系人。';

test('Sales CRM names and explains the customer contact lead module consistently', () => {
  assert.match(salesHtml, new RegExp(`data-view="contacts"[^>]*>[\\s\\S]*?<span>${moduleName}</span>`));
  assert.match(salesHtml, new RegExp(`<h2>${moduleName}</h2><p>${description}</p>`));
  assert.match(salesJs, new RegExp(`contacts: \\['联系人凭证', '${moduleName}'\\]`));
  assert.doesNotMatch(`${salesHtml}\n${salesJs}`, /负责人线索/);
});

test('legacy workbench uses contact language only inside the contact-research workflow', () => {
  const contactSource = workbenchHtml.slice(
    workbenchHtml.indexOf('function contactLevelTag('),
    workbenchHtml.indexOf('function bindContactEvents('),
  );
  for (const expected of [
    moduleName,
    `全部${moduleName}`,
    description,
    '候选联系人',
    '无联系人',
    '未找到具名联系人',
    '寻找联系人',
    '具名联系人',
    '联系人研究任务',
    '聚焦联系人',
  ]) {
    assert.match(workbenchHtml, new RegExp(expected), `missing contact copy: ${expected}`);
  }
  for (const obsolete of [
    '负责人线索',
    '具体负责人',
    '无负责人',
    '未找到具体负责人',
    '寻找负责人',
    '具名负责人',
  ]) {
    assert.doesNotMatch(contactSource, new RegExp(obsolete), `obsolete contact copy remains: ${obsolete}`);
  }
  assert.doesNotMatch(workbenchHtml, /负责人线索|负责人任务|聚焦负责人/);
});

test('view_contacts keeps its stable key and authorization behavior with clearer UI copy', () => {
  assert.equal(PERMISSION_DEFINITIONS.view_contacts, permissionName);
  assert.equal(PERMISSION_DESCRIPTIONS.view_contacts, description);
  assert.equal(ROLE_PERMISSIONS.admin.view_contacts, true);
  assert.equal(ROLE_PERMISSIONS.manager.view_contacts, true);
  assert.equal(ROLE_PERMISSIONS.sales.view_contacts, true);
  assert.deepEqual(policyForLegacyRequest('GET', '/customers/CUST-1/people', ''), {
    permissions: ['view_contacts'],
  });
});

test('documentation uses customer contact terminology while sales ownership copy remains intact', () => {
  assert.match(readme, new RegExp(`前端的“${moduleName}”页`));
  assert.match(readme, /具名相关联系人/);
  assert.match(readme, /未找到有效客户联系人线索/);
  assert.doesNotMatch(readme, /负责人线索/);

  assert.match(salesHtml, /批量分配/);
  assert.match(workbenchHtml, /活跃客户无负责人/);
  assert.match(workbenchHtml, /for="ownerFilter">负责人<\/label>/);
  assert.match(readme, /不会代替业务人员填写负责人、下一步动作或跟进日期/);
});

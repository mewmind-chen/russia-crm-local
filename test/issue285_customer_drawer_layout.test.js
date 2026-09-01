'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'sales-assets/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'sales-assets/app.css'), 'utf8');
const masterProfileWidget = require('../sales-assets/master-profile-widget');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`  function ${name}(`);
  const end = appSource.indexOf(`  function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} must be declared`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return appSource.slice(start, end);
}

function parseMarkup(markup) {
  const rootNode = { tag: 'root', classes: [], text: '', children: [] };
  const stack = [rootNode];
  const tokens = markup.match(/<\/?[a-z][^>]*>|[^<]+/gi) || [];
  for (const token of tokens) {
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([a-z][\w-]*)/i)?.[1]?.toLowerCase();
      if (!tag) continue;
      const classes = token.match(/class="([^"]*)"/i)?.[1]?.split(/\s+/).filter(Boolean) || [];
      const node = { tag, classes, text: '', children: [] };
      stack.at(-1).children.push(node);
      if (!/\/$/.test(token) && !['br', 'img', 'input'].includes(tag)) stack.push(node);
      continue;
    }
    stack.at(-1).text += token.replace(/\s+/g, ' ').trim();
  }
  return rootNode;
}

function findByClass(node, className) {
  if (node.classes.includes(className)) return node;
  for (const child of node.children) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

function cssRule(selector, source = cssSource) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

function cssBlock(prefix) {
  const start = cssSource.indexOf(prefix);
  assert.notEqual(start, -1, `${prefix} must exist`);
  const open = cssSource.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < cssSource.length; index += 1) {
    if (cssSource[index] === '{') depth += 1;
    if (cssSource[index] === '}') depth -= 1;
    if (depth === 0) return cssSource.slice(open + 1, index);
  }
  assert.fail(`${prefix} must have a closing brace`);
}

test('CRM drawer keeps business cards for sales and adds the technical source card for managers', () => {
  const drawer = functionSource('renderDrawer', 'openModal');
  const master = functionSource('renderDrawerMasterWidget', 'renderDrawerTimelineWidget');
  // 主档区块经注册表 widget 委托渲染：gridClass 与业务卡片在 widget 调用处组装
  assert.match(master, /gridClass: 'drawer-master-grid'/);
  assert.match(master, /\[企业简介|'企业简介'/);
  assert.match(master, /\[产品与潜在需求|'产品与潜在需求'/);
  assert.match(master, /showTechnicalSources \? \[\['背调与来源'/);
  assert.doesNotMatch(master, /行业与客户类型/, '#286 duplicate card must remain removed');

  // 模板保真：drawer-master-grid 网格、master-profile-grid 基类、首卡 drawer-master-card-wide
  const section = masterProfileWidget.renderMasterSectionHtml({
    gridClass: 'drawer-master-grid',
    rows: [
      ['企业简介', '__intro__', 'drawer-master-card-wide'],
      ['产品与潜在需求', '__focus__'],
    ],
  });
  const tree = parseMarkup(section);
  const grid = findByClass(tree, 'drawer-master-grid');
  assert.ok(grid, 'CRM drawer must use its drawer-specific grid class');
  assert.ok(grid.classes.includes('master-profile-grid'), 'existing master-profile styling must remain');
  assert.equal(grid.children.length, 2);
  assert.deepEqual(
    grid.children.map(card => card.children.find(child => child.tag === 'span')?.text),
    ['企业简介', '产品与潜在需求'],
  );
  assert.ok(grid.children[0].classes.includes('drawer-master-card-wide'));
  assert.ok(grid.children.slice(1).every(card => !card.classes.includes('drawer-master-card-wide')));

  // #286 website 事实渲染保留：官网 website 链接行在 drawer-facts-widget 的 fallback（drawerFactsContext）
  assert.match(appSource, /\['官网', account\.website, 'website'\]/, '#286 website rendering must remain');
  assert.match(appSource, /drawerFactsContext\(account, showTechnicalSources\)/);
});

test('drawer-specific CSS creates a responsive two-column layout without fixed card heights', () => {
  const gridRule = cssRule('.drawer-master-grid');
  const childRule = cssRule('.drawer-master-grid > div');
  const wideRule = cssRule('.drawer-master-card-wide');
  const mobile = cssBlock('@media(max-width:720px)');
  const mobileGridRule = cssRule('.drawer-master-grid', mobile);
  const mobileWideRule = cssRule('.drawer-master-card-wide', mobile);

  assert.match(gridRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(childRule, /min-width:\s*0/);
  assert.match(childRule, /overflow-wrap:\s*anywhere/);
  assert.match(wideRule, /grid-column:\s*1\s*\/\s*-1/);
  assert.match(mobileGridRule, /grid-template-columns:\s*1fr/);
  assert.match(mobileWideRule, /grid-column:\s*auto/);

  for (const rule of [gridRule, childRule, wideRule, mobileGridRule, mobileWideRule]) {
    assert.doesNotMatch(rule, /(?:^|[;{])\s*(?:min-)?height\s*:/);
  }
});

test('drawer layout classes do not leak into other master profile grids', () => {
  const drawer = functionSource('renderDrawer', 'openModal');
  const drawerMaster = functionSource('renderDrawerMasterWidget', 'renderDrawerTimelineWidget');
  const outsideDrawer = appSource.replace(drawer, '').replace(drawerMaster, '');
  // drawer 专属网格类只在 crmDrawer 的 master widget 调用中作为参数出现
  assert.doesNotMatch(outsideDrawer, /drawer-master-(?:grid|card-wide)/);
  // 其他主档区块（intake/recycle）经同一 masterProfileSectionHtml 渲染，不附加 drawer 专属类
  assert.match(appSource, /masterProfileSectionHtml\(\{/);
  assert.match(outsideDrawer, /masterProfileSectionHtml\(\{/);
});

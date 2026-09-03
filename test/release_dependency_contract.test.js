const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('release candidate keeps Express 4 and pins patched transitive dependencies', () => {
  assert.match(pkg.dependencies.express, /^\^4\./);
  assert.deepEqual(pkg.overrides, {
    'body-parser': '1.20.6',
    'fast-uri': '3.1.7',
    qs: '6.16.0',
  });
  for (const [name, version] of Object.entries(pkg.overrides)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} lock version`);
  }
});

test('release dependency contract does not relax the frozen AI boundary', () => {
  assert.equal(pkg.dependencies.express, '^4.21.0');
  assert.equal(pkg.devDependencies.playwright, '1.62.1');
});

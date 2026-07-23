const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('report reader returns content from the same validated open file', t => {
  const { readExistingFileWithinRoot } = require('../lib/report_files');
  assert.equal(typeof readExistingFileWithinRoot, 'function');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-report-file-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const storageRoot = path.join(tempDir, 'storage');
  const releaseRoot = path.join(tempDir, 'release-reports');
  const reportPath = path.join(storageRoot, 'report.html');
  fs.mkdirSync(storageRoot);
  fs.writeFileSync(reportPath, '<title>Validated report</title>');
  fs.symlinkSync(storageRoot, releaseRoot, 'dir');

  const report = readExistingFileWithinRoot(releaseRoot, reportPath, ['.html']);
  assert.equal(report.path, fs.realpathSync(reportPath));
  assert.equal(report.content.toString('utf8'), '<title>Validated report</title>');
});

test('report reader rejects a replacement of the allowed root during validation', t => {
  const { readExistingFileWithinRoot } = require('../lib/report_files');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-report-root-race-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const storageRoot = path.join(tempDir, 'storage');
  const movedRoot = path.join(tempDir, 'moved-storage');
  const releaseRoot = path.join(tempDir, 'release-reports');
  const reportPath = path.join(storageRoot, 'report.html');
  fs.mkdirSync(storageRoot);
  fs.writeFileSync(reportPath, '<title>Original report</title>');
  fs.symlinkSync(storageRoot, releaseRoot, 'dir');

  const originalOpenSync = fs.openSync;
  let openCount = 0;
  fs.openSync = (...args) => {
    const descriptor = originalOpenSync(...args);
    openCount += 1;
    if (openCount === 1) {
      fs.renameSync(storageRoot, movedRoot);
      fs.mkdirSync(storageRoot);
      fs.writeFileSync(path.join(storageRoot, 'report.html'), '<title>Replacement report</title>');
    }
    return descriptor;
  };
  t.after(() => { fs.openSync = originalOpenSync; });

  assert.equal(readExistingFileWithinRoot(releaseRoot, reportPath, ['.html']), null);
});

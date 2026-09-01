'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LEGACY_ENTRYPOINTS,
  legacyEntrypointsEnabled,
  registerLegacyEntrypoints,
} = require('../lib/legacy_entrypoints');

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise(resolve => server.once('listening', () => resolve(server)));
}

test('legacy entrypoint switch is strict and case-insensitive', () => {
  assert.equal(legacyEntrypointsEnabled('true'), true);
  assert.equal(legacyEntrypointsEnabled(' TRUE '), true);
  for (const value of ['', undefined, null, false, '1', 'yes', 'false']) {
    assert.equal(legacyEntrypointsEnabled(value), false);
  }
});

test('legacy entrypoint registration is opt-in and keeps file mapping isolated', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-legacy-entrypoint-module-'));
  for (const entry of LEGACY_ENTRYPOINTS) {
    fs.writeFileSync(path.join(tempDir, entry.file), `<!doctype html><title>${entry.file}</title>`);
  }
  let disabledServer;
  let enabledServer;
  try {
    disabledServer = await listen(registerLegacyEntrypoints(express(), { enabled: 'false', rootDir: tempDir }));
    const disabledBase = `http://127.0.0.1:${disabledServer.address().port}`;
    for (const entry of LEGACY_ENTRYPOINTS) {
      assert.equal((await fetch(`${disabledBase}${entry.route}`)).status, 404);
    }

    enabledServer = await listen(registerLegacyEntrypoints(express(), { enabled: 'true', rootDir: tempDir }));
    const enabledBase = `http://127.0.0.1:${enabledServer.address().port}`;
    for (const entry of LEGACY_ENTRYPOINTS) {
      const response = await fetch(`${enabledBase}${entry.route}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), new RegExp(entry.file.replace('.', '\\.'), 'i'));
    }
  } finally {
    if (disabledServer) await new Promise(resolve => disabledServer.close(resolve));
    if (enabledServer) await new Promise(resolve => enabledServer.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

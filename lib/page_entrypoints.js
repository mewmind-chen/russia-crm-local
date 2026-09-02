'use strict';

const express = require('express');
const path = require('path');

function registerSalesCrmPageEntrypoints(app, { rootDir } = {}) {
  if (!app) return app;
  const baseDir = rootDir || path.join(__dirname, '..');
  app.get('/sales', (_req, res) => res.redirect(302, '/'));
  app.use('/sales-assets', express.static(path.join(baseDir, 'sales-assets')));
  return app;
}

function registerServerPageEntrypoints(app, { rootDir } = {}) {
  if (!app) return app;
  const baseDir = rootDir || path.join(__dirname, '..');
  app.get('/', (_req, res) => res.sendFile(path.join(baseDir, 'sales-crm.html')));
  app.use('/shared-assets', express.static(path.join(baseDir, 'shared-assets')));
  return app;
}

module.exports = { registerSalesCrmPageEntrypoints, registerServerPageEntrypoints };

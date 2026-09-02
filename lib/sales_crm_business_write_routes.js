'use strict';

/**
 * HTTP adapters for CRM exports, ordinary commerce/activity writes and the
 * impersonation lifecycle. Domain and permission services remain supplied by
 * the CRM composition root to preserve existing behavior.
 */
function registerSalesCrmBusinessWriteRoutes(app, {
  openDb,
  sendApiError,
  hardFeatureFlags,
  exportCrmCsv,
  exportCrmData,
  planOnlyActivity,
  auditIdentity,
  addActivity,
  deferAccountPlan,
  addQuote,
  addOrder,
  startImpersonation,
  stopImpersonation,
  nowText,
  hydrateUserPermissions,
  safeUser,
} = {}, routes = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('business write route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});
  const clock = typeof nowText === 'function' ? nowText : () => '';
  const toSafeUser = typeof safeUser === 'function' ? safeUser : user => user;
  const includeExportActivity = routes.exportActivity !== false;
  const includeCommerce = routes.commerce !== false;
  const includeImpersonation = routes.impersonation !== false;

  if (includeExportActivity) {
    app.get('/api/sales-crm/export', (req, res) => {
      try {
        if (String(req.query.format || '').toLowerCase() === 'csv') {
          const dataset = String(req.query.dataset || '').toLowerCase();
          const filename = `crm-${dataset === 'activities' ? 'activities' : 'customers'}-${new Date().toISOString().slice(0, 10)}.csv`;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(exportCrmCsv(
            req.salesUser, req.query || {}, { hardFlags: hardFeatureFlags },
          ));
        }
        const filename = `crm-data-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(JSON.stringify(
          exportCrmData(req.salesUser, req.query || {}, { hardFlags: hardFeatureFlags }),
          null,
          2,
        ));
      } catch (error) { return handleError(res, error); }
    });

    app.post('/api/sales-crm/activities/plan-only', (req, res) => {
      try {
        res.json({ ok: true, ...planOnlyActivity(req.salesUser, req.body || {}, identity(req)) });
      } catch (error) { handleError(res, error); }
    });
    app.post('/api/sales-crm/activities', (req, res) => {
      try {
        res.json({
          ok: true,
          ...addActivity(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }),
        });
      } catch (error) { handleError(res, error); }
    });
    app.post('/api/sales-crm/accounts/:customerId/deferred-plan', (req, res) => {
      try {
        res.json({
          ok: true,
          ...deferAccountPlan(req.salesUser, req.params.customerId, req.body || {}, {
            realUserId: req.realUser?.id || req.salesUser.id,
            effectiveUserId: req.salesUser.id,
            contextId: req.impersonation?.contextId || '',
          }),
        });
      } catch (error) { handleError(res, error); }
    });
  }

  if (includeCommerce) {
    app.post('/api/sales-crm/quotes', (req, res) => {
      try {
        res.json({ ok: true, ...addQuote(req.salesUser, req.body || {}, { hardFlags: hardFeatureFlags }) });
      } catch (error) { handleError(res, error); }
    });
    app.post('/api/sales-crm/orders', (req, res) => {
      try { res.json({ ok: true, ...addOrder(req.salesUser, req.body || {}) }); }
      catch (error) { handleError(res, error); }
    });
  }

  if (includeImpersonation) {
    app.post('/api/sales-crm/impersonation/start', (req, res) => {
      const value = db();
      try {
        const context = startImpersonation(
          value,
          req.realUser,
          req.sessionTokenHash,
          String(req.body?.targetUserId || ''),
          clock(),
        );
        const target = hydrateUserPermissions(
          value,
          value.prepare('SELECT * FROM sales_users WHERE id=?').get(context.targetUserId),
        );
        res.json({
          ok: true,
          impersonation: {
            contextId: context.contextId,
            startedAt: context.startedAt,
            expiresAt: context.expiresAt,
            targetUser: toSafeUser(target),
          },
        });
      } catch (error) { handleError(res, error); }
      finally { value.close(); }
    });
    app.post('/api/sales-crm/impersonation/stop', (req, res) => {
      const value = db();
      try {
        stopImpersonation(value, req.realUser, req.sessionTokenHash, 'stopped', clock());
        res.json({ ok: true, stopped: true });
      } catch (error) { handleError(res, error); }
      finally { value.close(); }
    });
  }

  return app;
}

module.exports = { registerSalesCrmBusinessWriteRoutes };

'use strict';

/**
 * HTTP assembly for read/list adapters. Business-page authorization, task
 * actions, intake redaction and research scope stay in their existing service
 * functions; the composition root injects them to preserve existing policy.
 */
function registerSalesCrmListRoutes(app, {
  sendApiError,
  logRequestTiming,
  loadAuthorizedBusinessPage,
  hardFeatureFlags,
  executeTodayTaskAction,
  auditIdentity,
} = {}) {
  if (!app) return app;
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});

  app.get('/api/sales-crm/lists/:pageKey', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/lists/${req.params.pageKey}`, req, res, startedAt, () => counts);
    try {
      const payload = loadAuthorizedBusinessPage(req.salesUser, req.params.pageKey, req.query || {}, {
        isImpersonating: Boolean(req.impersonation),
        hardFlags: hardFeatureFlags,
      });
      counts = { page: payload.page, rows: payload.rows.length, total: payload.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...payload });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/today-tasks/actions', (req, res) => {
    try {
      res.json({ ok: true, ...executeTodayTaskAction(req.salesUser, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error, 500); }
  });

  return app;
}

function registerSalesCrmIntakeResearchRoutes(app, {
  openDb,
  sendApiError,
  logRequestTiming,
  featureState,
  hardFeatureFlags,
  loadIntakeState,
  hasPermission,
  redactContactFields,
  redactIntakeAggregate,
  loadResearchPage,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('read route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });

  app.get('/api/sales-crm/intake', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/intake', req, res, startedAt, () => counts);
    try {
      const value = db();
      try {
        const aiEnabled = featureState(value, hardFeatureFlags).ai_stations.effectiveEnabled;
        const payload = loadIntakeState(value, req.salesUser, req.query || {}, { includeAI: aiEnabled });
        counts = { page: payload.page, rows: payload.items.length, total: payload.total };
        const safePayload = hasPermission(req.salesUser, 'view_contacts')
          ? payload
          : (typeof redactIntakeAggregate === 'function'
            ? redactIntakeAggregate(payload)
            : redactContactFields(payload));
        res.json({ ok: true, ...safePayload });
      } finally { value.close(); }
    } catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/research/:kind', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming(`sales-crm/research/${req.params.kind}`, req, res, startedAt, () => counts);
    try {
      const result = loadResearchPage(req.salesUser, req.params.kind, req.query || {});
      counts = { page: result.page, rows: result.rows.length, total: result.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...result });
    } catch (error) { handleError(res, error); }
  });

  return app;
}

module.exports = {
  registerSalesCrmListRoutes,
  registerSalesCrmIntakeResearchRoutes,
};

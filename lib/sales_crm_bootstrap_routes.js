'use strict';

/**
 * HTTP assembly for bootstrap and filter-schema reads. Services, feature
 * gates, permissions and redaction remain injected from the CRM composition
 * root; this module preserves response and database-lifetime semantics.
 */
function registerSalesCrmBootstrapRoutes(app, {
  openDb,
  sendApiError,
  logRequestTiming,
  loadPayload,
  hardFeatureFlags,
  featureState,
  safeUser,
  authorizedFilterAst,
  authorizedFilterSchema,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('bootstrap route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const toSafeUser = typeof safeUser === 'function' ? safeUser : user => user;

  app.get('/api/sales-crm/bootstrap', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/bootstrap', req, res, startedAt, () => counts);
    try {
      const payload = loadPayload(req.salesUser, { hardFlags: hardFeatureFlags });
      counts = {
        accounts: payload.accounts.length,
        activities: payload.activities.length,
        intakeItems: payload.intake?.items?.length || 0,
        customerPool: payload.customerPool.length,
        people: payload.people.length,
        reconResults: payload.reconResults.length,
      };
      res.json({
        ok: true,
        ...payload,
        features: (() => {
          const value = db();
          try {
            const flags = featureState(value, hardFeatureFlags);
            return {
              aiStations: flags.ai_stations.effectiveEnabled,
              customerEnrichment: flags.customer_enrichment.effectiveEnabled,
              customerEnrichmentAutoTrigger: flags.customer_enrichment_auto_trigger.effectiveEnabled,
              salesPack: flags.sales_pack.effectiveEnabled,
            };
          } finally { value.close(); }
        })(),
        realUser: toSafeUser(req.realUser),
        impersonation: req.impersonation ? {
          contextId: req.impersonation.contextId,
          startedAt: req.impersonation.startedAt,
          expiresAt: req.impersonation.expiresAt,
          targetUser: toSafeUser(req.salesUser),
        } : null,
      });
    } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
  });

  app.get('/api/sales-crm/filter-schema/:pageKey', (req, res) => {
    const value = db();
    try {
      const pageKey = String(req.params.pageKey || '');
      const features = pageKey === 'notifications'
        ? featureState(value, hardFeatureFlags)
        : null;
      const runtimeOptions = features
        ? {
          aiEnabled: features.ai_stations.effectiveEnabled,
          salesPackEnabled: features.sales_pack.effectiveEnabled,
        }
        : {};
      if (req.query?.filters) {
        runtimeOptions.linkageAst = authorizedFilterAst(value, req.salesUser, pageKey, req.query);
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        schema: authorizedFilterSchema(value, req.salesUser, pageKey, runtimeOptions),
      });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  return app;
}

module.exports = { registerSalesCrmBootstrapRoutes };

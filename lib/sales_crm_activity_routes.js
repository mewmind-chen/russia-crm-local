'use strict';

/**
 * HTTP assembly for non-AI activity search, correction and reaction routes.
 *
 * Activity services retain their existing validation, authorization, state and
 * audit behavior. This module owns only request decoding, database lifetime,
 * response shaping and stable route registration order.
 */
function registerSalesCrmActivityRoutes(app, deps = {}) {
  if (!app) return app;
  const {
    db,
    sendApiError,
    searchActivityCustomers,
    assertActivityCorrectionQuery,
    authorizedFilterAst,
    ACTIVITY_CORRECTION_FILTER_PAGES,
    queryCorrectionTargets,
    correctionWriteEnabled,
    activityCorrectionEnv,
    authorizedFilterSchema,
    queryActivityCorrections,
    activityCorrectionOptions,
    correctActivity,
    proposeActivityCorrection,
    queryActivityCorrectionProposals,
    reviewActivityCorrection,
    listActivityReactions,
    createActivityReaction,
    renameActivityReaction,
    reorderActivityReactions,
    removeActivityReaction,
    auditIdentity,
  } = deps;
  const fail = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});

  app.get('/api/sales-crm/activity-customers', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...searchActivityCustomers(req.salesUser, req.query || {}) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/activity-correction-targets', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {}, { allowExclude: true });
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.targets, req.query || {},
      );
      const result = queryCorrectionTargets(value, req.salesUser, ast, req.query || {});
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        customers: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.targets,
          { excludeCustomerId: req.query?.excludeCustomerId },
        ),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-corrections', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {});
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.corrections, req.query || {},
      );
      const result = queryActivityCorrections(value, req.salesUser, ast, req.query || {});
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        corrections: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.corrections,
        ),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-corrections', (req, res) => {
    const value = db();
    try {
      const options = activityCorrectionOptions(req);
      try {
        return res.json({
          ok: true,
          correction: correctActivity(value, req.salesUser, req.body || {}, options),
        });
      } catch (error) {
        if (error.code !== 'REQUIRES_APPROVAL') throw error;
        const proposal = proposeActivityCorrection(value, req.salesUser, req.body || {}, {
          ...options,
          reasonCodeOverride: error.details?.reasonCode || '',
        });
        return res.status(202).json({ ok: true, proposal });
      }
    } catch (error) { return fail(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-correction-proposals', (req, res) => {
    const value = db();
    try {
      assertActivityCorrectionQuery(req.query || {});
      const ast = authorizedFilterAst(
        value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.proposals, req.query || {},
      );
      const result = queryActivityCorrectionProposals(
        value, req.salesUser, ast, req.query || {},
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        writeEnabled: correctionWriteEnabled(activityCorrectionEnv),
        ...result,
        proposals: result.rows,
        schema: authorizedFilterSchema(
          value, req.salesUser, ACTIVITY_CORRECTION_FILTER_PAGES.proposals,
        ),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-correction-proposals', (req, res) => {
    const value = db();
    try {
      const proposal = proposeActivityCorrection(
        value, req.salesUser, req.body || {}, activityCorrectionOptions(req),
      );
      res.status(proposal.deduplicated ? 200 : 202).json({ ok: true, proposal });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/activity-correction-proposals/:proposalId/review', (req, res) => {
    const value = db();
    try {
      res.json({
        ok: true,
        result: reviewActivityCorrection(value, req.salesUser, {
          ...(req.body || {}),
          proposalId: req.params.proposalId,
        }, activityCorrectionOptions(req)),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/activity-reactions', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listActivityReactions(req.salesUser) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/activity-reactions/admin', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listActivityReactions(req.realUser, { includeInactive: true }) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/sales-crm/activity-reactions', (req, res) => {
    try {
      res.json({
        ok: true,
        ...createActivityReaction(req.realUser, req.body || {}, identity(req)),
      });
    } catch (error) { fail(res, error); }
  });

  app.patch('/api/sales-crm/activity-reactions/:reactionId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...renameActivityReaction(
          req.realUser, req.params.reactionId, req.body || {}, identity(req),
        ),
      });
    } catch (error) { fail(res, error); }
  });

  app.put('/api/sales-crm/activity-reactions/order', (req, res) => {
    try {
      res.json({
        ok: true,
        ...reorderActivityReactions(req.realUser, req.body || {}, identity(req)),
      });
    } catch (error) { fail(res, error); }
  });

  app.delete('/api/sales-crm/activity-reactions/:reactionId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...removeActivityReaction(req.realUser, req.params.reactionId, identity(req)),
      });
    } catch (error) { fail(res, error); }
  });

  return app;
}

module.exports = { registerSalesCrmActivityRoutes };

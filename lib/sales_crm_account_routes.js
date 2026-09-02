'use strict';

/**
 * HTTP assembly for account listing, duplicate review, recycle and account
 * mutation routes. Domain services, access checks and persistence remain in
 * sales_crm; this module preserves the existing adapters and registration
 * order through the two invocation points below.
 */
function registerSalesCrmAccountReadRoutes(app, {
  openDb,
  sendApiError,
  logRequestTiming,
  listCustomerAccounts,
  setCustomerStar,
  auditIdentity,
  listFieldPages,
  httpError,
  featureState,
  hardFeatureFlags,
  effectiveFieldSchema,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('account route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});

  app.get('/api/sales-crm/accounts', (req, res) => {
    const startedAt = process.hrtime.bigint();
    let counts = {};
    logRequestTiming('sales-crm/accounts', req, res, startedAt, () => counts);
    try {
      const payload = listCustomerAccounts(req.salesUser, req.query || {});
      counts = { page: payload.page, rows: payload.rows.length, total: payload.total };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...payload });
    } catch (error) { handleError(res, error); }
  });

  app.put('/api/sales-crm/customer-stars/:customerId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...setCustomerStar(req.salesUser, req.params.customerId, req.body || {}, identity(req)),
      });
    } catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/field-schema/:pageKey', (req, res) => {
    const pageKey = String(req.params.pageKey || '').trim();
    if (!listFieldPages().includes(pageKey)) {
      return handleError(res, httpError(404, '未知字段目录', 'FIELD_SCHEMA_NOT_FOUND'));
    }
    const value = db();
    try {
      const features = featureState(value, hardFeatureFlags);
      const schema = effectiveFieldSchema({
        pageKey,
        user: req.salesUser,
        permissions: req.salesUser?.permissions || {},
        features: { ai_stations: features.ai_stations.effectiveEnabled },
      });
      res.json({ ok: true, schema });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  return app;
}

function registerSalesCrmAccountRecycleRoutes(app, {
  openDb,
  sendApiError,
  featureState,
  hardFeatureFlags,
  enrichmentFlags,
  addAccount,
  auditIdentity,
  listDuplicateReviews,
  duplicateCandidateSearch,
  replaceDuplicateReviewCandidate,
  resolveDuplicateReview,
  bulkResolveDuplicateDistinct,
  recalculateDuplicateReviews,
  bulkAssignAccounts,
  getHistoryAccountForUser,
  inaccessibleOrMissing,
  buildAccountDevelopmentHistory,
  historyAccountSummary,
  listRecycleBin,
  loadRecycleProfile,
  redactUnauthorizedProfileTags,
  bulkReturnCustomers,
  returnCustomer,
  trashManualCustomer,
  restoreManualCustomer,
  reassignReturnedCustomer,
  rejectCrmCustomer,
  mismatchRecordNotFound,
  recycleError,
  loadMismatchRecordProfile,
  restoreMismatchRecord,
  updateAccount,
  updateCustomerNickname,
  updateCustomerMaster,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('account route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});
  const impersonationIdentity = req => ({
    realUserId: req.realUser?.id,
    effectiveUserId: req.salesUser?.id,
    contextId: req.impersonation?.contextId,
  });

  app.post('/api/sales-crm/accounts', (req, res) => {
    let runtimeEnrichmentFlags = enrichmentFlags;
    const value = db();
    try {
      const flags = featureState(value, hardFeatureFlags);
      runtimeEnrichmentFlags = {
        enabled: flags.customer_enrichment.effectiveEnabled,
        autoTriggerEnabled: flags.customer_enrichment_auto_trigger.effectiveEnabled,
      };
    } finally { value.close(); }
    try {
      const result = addAccount(req.salesUser, req.body || {}, {
        enrichmentFlags: runtimeEnrichmentFlags,
        auditIdentity: identity(req),
      });
      const publicResult = result.reviewRequired && req.salesUser.role === 'sales'
        ? { accepted: true, message: '该客户需要管理员确认，确认后可继续领取。' }
        : result;
      res.status(result.reviewRequired ? 202 : 200).json({ ok: true, ...publicResult });
    } catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/duplicate-reviews', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...listDuplicateReviews(req.salesUser, req.query || {}) });
    } catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/duplicate-reviews/:reviewId/candidates', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...duplicateCandidateSearch(req.salesUser, req.params.reviewId, req.query || {}) });
    } catch (error) { handleError(res, error); }
  });

  app.patch('/api/sales-crm/duplicate-reviews/:reviewId/candidate', (req, res) => {
    try {
      res.json({
        ok: true,
        ...replaceDuplicateReviewCandidate(req.salesUser, req.params.reviewId, req.body || {}, identity(req)),
      });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/:reviewId/resolve', (req, res) => {
    try {
      res.json({ ok: true, ...resolveDuplicateReview(req.salesUser, req.params.reviewId, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/bulk-distinct', (req, res) => {
    try {
      res.json({ ok: true, ...bulkResolveDuplicateDistinct(req.salesUser, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/duplicate-reviews/recalculate', (req, res) => {
    try {
      res.json({ ok: true, ...recalculateDuplicateReviews(req.salesUser, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/accounts/bulk-assign', (req, res) => {
    try { res.json({ ok: true, ...bulkAssignAccounts(req.salesUser, req.body || {}, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/accounts/:customerId/history', (req, res) => {
    const value = db();
    try {
      const account = getHistoryAccountForUser(value, req.salesUser, req.params.customerId);
      if (!account) throw inaccessibleOrMissing(req.salesUser, '客户不存在');
      res.json({
        ok: true,
        timeline: buildAccountDevelopmentHistory(value, account),
        account: historyAccountSummary(account),
      });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/accounts/recycle-bin', (req, res) => {
    try {
      res.json({ ok: true, ...listRecycleBin(req.salesUser, req.query || {}, {
        isImpersonating: Boolean(req.impersonation),
      }) });
    } catch (error) { handleError(res, error); }
  });

  app.get('/api/sales-crm/accounts/:customerId/recycle-profile', (req, res) => {
    const value = db();
    try {
      const payload = loadRecycleProfile(req.salesUser, req.params.customerId, {
        hardFlags: hardFeatureFlags,
        isImpersonating: Boolean(req.impersonation),
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(redactUnauthorizedProfileTags(value, req.salesUser, payload));
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/accounts/bulk-return', (req, res) => {
    try { res.json({ ok: true, ...bulkReturnCustomers(req.salesUser, req.body || {}, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.post('/api/sales-crm/accounts/:customerId/return', (req, res) => {
    try { res.json({ ok: true, ...returnCustomer(req.salesUser, req.params.customerId, req.body || {}, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.post('/api/sales-crm/accounts/:customerId/trash', (req, res) => {
    try { res.json({ ok: true, ...trashManualCustomer(req.salesUser, req.params.customerId, req.body || {}, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.post('/api/sales-crm/accounts/:customerId/restore', (req, res) => {
    try { res.json({ ok: true, ...restoreManualCustomer(req.salesUser, req.params.customerId, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.post('/api/sales-crm/accounts/:customerId/reassign', (req, res) => {
    try { res.json({ ok: true, ...reassignReturnedCustomer(req.salesUser, req.params.customerId, req.body || {}, impersonationIdentity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.post('/api/sales-crm/accounts/:customerId/reject', (req, res) => {
    try { res.json({ ok: true, ...rejectCrmCustomer(req.salesUser, req.params.customerId, req.body || {}, identity(req)) }); }
    catch (error) { handleError(res, error); }
  });

  const sendMismatchProfileNotFound = res => {
    res.setHeader('Cache-Control', 'private, no-store');
    return handleError(res, mismatchRecordNotFound({ httpError: recycleError }));
  };
  app.get('/api/sales-crm/mismatch-recycle//profile', (_req, res) => sendMismatchProfileNotFound(res));
  app.get('/api/sales-crm/mismatch-recycle/:recordKey/profile', (req, res) => {
    try {
      const payload = loadMismatchRecordProfile(req.salesUser, req.params.recordKey, {
        hardFlags: hardFeatureFlags,
        isImpersonating: Boolean(req.impersonation),
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(payload);
    } catch (error) { handleError(res, error); }
  });
  app.use((error, req, res, next) => {
    const rawPath = String(req.originalUrl || '').split('?')[0];
    const malformedMismatchProfile = req.method === 'GET'
      && /^\/api\/sales-crm\/mismatch-recycle\/[^/]+\/profile$/.test(rawPath)
      && error instanceof URIError;
    if (!malformedMismatchProfile) return next(error);
    return sendMismatchProfileNotFound(res);
  });

  app.post('/api/sales-crm/mismatch-recycle/:recordKey/restore', (req, res) => {
    try {
      res.json({ ok: true, ...restoreMismatchRecord(req.salesUser, req.params.recordKey, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error); }
  });
  app.patch('/api/sales-crm/accounts/:customerId', (req, res) => {
    try { res.json({ ok: true, ...updateAccount(req.salesUser, req.params.customerId, req.body || {}, identity(req)) }); }
    catch (error) { handleError(res, error); }
  });
  app.patch('/api/sales-crm/customers/:externalCustomerId/nickname', (req, res) => {
    try {
      res.json({ ok: true, ...updateCustomerNickname(req.salesUser, req.params.externalCustomerId, req.body || {}, identity(req)) });
    } catch (error) { handleError(res, error); }
  });
  app.patch('/api/sales-crm/master/:customerId', (req, res) => {
    try { res.json({ ok: true, ...updateCustomerMaster(req.salesUser, req.params.customerId, req.body || {}, identity(req)) }); }
    catch (error) { handleError(res, error); }
  });

  return app;
}

module.exports = {
  registerSalesCrmAccountReadRoutes,
  registerSalesCrmAccountRecycleRoutes,
};

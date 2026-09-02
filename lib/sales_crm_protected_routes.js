'use strict';

/**
 * HTTP assembly for protected-customer identity conflicts and protected
 * customer management. The composition root injects authorization, domain
 * services and serializers so this module keeps route behavior only.
 */
function registerSalesCrmProtectedRoutes(app, {
  openDb,
  sendProtectedConflictError,
  sendProtectedCustomerError,
  listProtectedConflictsPage,
  rescanProtectedIdentityConflicts,
  resolveProtectedIdentityConflict,
  recordIdentityLinkTimeline,
  json,
  identityConflictNote,
  supplementIdentityConflict,
  paginateProtectedCustomers,
  listProtectedCustomers,
  assertProtectedCustomerAdmin,
  protectedCustomerCsv,
  previewProtectedBatch,
  commitProtectedBatch,
  activateProtectedCustomer,
  rollbackProtectedBatch,
  getProtectedCustomer,
  updateProtectedCustomer,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('protected route database factory is required');
  };
  const conflictError = typeof sendProtectedConflictError === 'function'
    ? sendProtectedConflictError
    : (res, error) => res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  const customerError = typeof sendProtectedCustomerError === 'function'
    ? sendProtectedCustomerError
    : (res, error) => res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  const protectedUser = req => ({
    ...req.salesUser,
    isImpersonating: Boolean(req.impersonation),
  });
  const noStore = res => res.setHeader('Cache-Control', 'private, no-store');

  app.get('/api/sales-crm/protected-customer-conflicts', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = listProtectedConflictsPage(value, protectedUser(req), {
        status: req.query.status,
        query: req.query.query,
        page: req.query.page,
        pageSize: req.query.pageSize || req.query.page_size,
      });
      return res.json({ ok: true, ...result });
    } catch (error) { return conflictError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/rescan', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const conflictUser = protectedUser(req);
      const input = {
        status: req.body?.status,
        query: req.body?.query,
        page: req.body?.page,
        pageSize: req.body?.pageSize || req.body?.page_size,
      };
      const rescanResult = rescanProtectedIdentityConflicts(value, conflictUser, input);
      const result = listProtectedConflictsPage(value, conflictUser, input);
      return res.json({ ok: true, ...rescanResult, ...result });
    } catch (error) { return conflictError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/:conflictId/resolve', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const conflictUser = protectedUser(req);
      const result = resolveProtectedIdentityConflict(value, conflictUser, {
        conflictId: req.params.conflictId,
        decision: req.body?.decision,
        targetExternalCustomerId: req.body?.targetExternalCustomerId,
        details: req.body?.details ?? req.body?.reason,
        expectedVersion: req.body?.expectedVersion,
      });
      if (result.status === 'resolved' && result.decision === 'link_existing' && !result.idempotent) {
        const conflictRow = value.prepare(`SELECT latest_external_customer_ids_json
          FROM crm_customer_identity_conflicts WHERE conflict_id=?`).get(req.params.conflictId);
        const linkedIds = json(conflictRow?.latest_external_customer_ids_json, []);
        const masterExternalCustomerId = String(result.targetExternalCustomerId || '');
        const leadExternalCustomerId = linkedIds.find(id => id !== masterExternalCustomerId) || '';
        if (leadExternalCustomerId && masterExternalCustomerId) {
          recordIdentityLinkTimeline(value, conflictUser, {
            leadExternalCustomerId,
            masterExternalCustomerId,
            note: identityConflictNote(req.body?.details ?? req.body?.reason),
          });
        }
      }
      return res.json({ ok: true, resolution: result });
    } catch (error) { return conflictError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/protected-customer-conflicts/:conflictId/supplement', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = supplementIdentityConflict(value, protectedUser(req), {
        conflictId: req.params.conflictId,
        action: req.body?.action,
      });
      return res.json({ ok: true, ...result });
    } catch (error) { return conflictError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/protected-customers', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = paginateProtectedCustomers(listProtectedCustomers(value, protectedUser(req), {
        status: req.query.status,
        query: req.query.query,
        sort: req.query.sort,
      }), req.query || {});
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/protected-customers/template', (req, res) => {
    noStore(res);
    try {
      assertProtectedCustomerAdmin(protectedUser(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="protected-customer-template.csv"');
      return res.send(protectedCustomerCsv([
        'alphaNickname', 'companyName', 'country', 'city', 'website', 'industry',
        'customerType', 'productFocus',
      ], []));
    } catch (error) { return customerError(res, error); }
  });

  app.get('/api/sales-crm/protected-customers/export', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = listProtectedCustomers(value, protectedUser(req), {
        status: req.query.status || 'all',
        query: req.query.query,
      });
      const headers = [
        'externalCustomerId', 'alphaNickname', 'crmNickname', 'companyName', 'status',
        'country', 'city', 'batchId', 'createdAt', 'activatedAt',
      ];
      const rows = result.items.map(item => headers.map(header => item[header]));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="protected-customer-mapping.csv"');
      return res.send(protectedCustomerCsv(headers, rows));
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });

  const runBatch = (operation, optionsFor) => (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = operation(value, protectedUser(req), req.params.batchId, optionsFor(req));
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  };

  app.post('/api/sales-crm/protected-customers/batches/preview', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = previewProtectedBatch(value, protectedUser(req), req.body?.rows, {
        idempotencyKey: req.body?.idempotencyKey,
      });
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });
  app.post('/api/sales-crm/protected-customers/batches/:batchId/commit',
    runBatch(commitProtectedBatch, req => ({ idempotencyKey: req.body?.idempotencyKey })));
  app.post('/api/sales-crm/protected-customers/:externalCustomerId/activate', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = activateProtectedCustomer(value, protectedUser(req), req.params.externalCustomerId, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });
  app.post('/api/sales-crm/protected-customers/batches/:batchId/rollback',
    runBatch(rollbackProtectedBatch, req => ({
      idempotencyKey: req.body?.idempotencyKey,
      reason: req.body?.reason,
    })));
  app.get('/api/sales-crm/protected-customers/:externalCustomerId', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = getProtectedCustomer(value, protectedUser(req), req.params.externalCustomerId);
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });
  app.patch('/api/sales-crm/protected-customers/:externalCustomerId', (req, res) => {
    noStore(res);
    const value = db();
    try {
      const result = updateProtectedCustomer(value, protectedUser(req), req.params.externalCustomerId, req.body || {});
      return res.json({ ok: true, ...result });
    } catch (error) { return customerError(res, error); }
    finally { value.close(); }
  });

  return app;
}

module.exports = { registerSalesCrmProtectedRoutes };

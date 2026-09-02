'use strict';

/**
 * HTTP assembly for the unified CRM contact endpoints.
 *
 * Contact services retain their existing permission, scope and audit logic;
 * this module only keeps the three route adapters and their response/error
 * compatibility behavior.
 */
function registerSalesCrmContactRoutes(app, {
  createAccountContact,
  updateAccountContact,
  archiveAccountContact,
  auditIdentity,
  sendApiError,
} = {}) {
  if (!app) return app;
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});

  app.post('/api/sales-crm/contacts', (req, res) => {
    try {
      res.json({ ok: true, ...createAccountContact(req.salesUser, req.body || {}, identity(req)) });
    } catch (error) { res.status(error.statusCode || 400).json({ ok: false, error: error.message }); }
  });

  app.patch('/api/sales-crm/contacts/:contactId', (req, res) => {
    try {
      res.json({
        ok: true,
        ...updateAccountContact(
          req.salesUser, req.params.contactId, req.body || {}, identity(req),
        ),
      });
    } catch (error) { handleError(res, error); }
  });

  app.post('/api/sales-crm/contacts/:contactId/archive', (req, res) => {
    try {
      res.json({
        ok: true,
        ...archiveAccountContact(req.salesUser, req.params.contactId, identity(req)),
      });
    } catch (error) { handleError(res, error); }
  });

  return app;
}

module.exports = { registerSalesCrmContactRoutes };

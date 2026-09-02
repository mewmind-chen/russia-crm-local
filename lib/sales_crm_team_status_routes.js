'use strict';

/**
 * HTTP assembly for team-status and collaboration-support routes.
 *
 * The handlers remain in their existing service modules; this module owns
 * only request decoding, database lifetime, response headers/statuses and
 * route registration order. The caller supplies the already-authorized
 * service functions so the sales CRM composition root keeps its existing
 * feature, scope and audit closures.
 */
function registerTeamStatusRoutes(app, {
  openDb,
  sendApiError,
  teamStatusRequest,
  teamStatusOptions,
  TEAM_STATUS_FILTER_PAGES,
  TEAM_STATUS_READ_KEYS,
  TEAM_STATUS_CURSOR_KEYS,
  TEAM_STATUS_EXPORT_KEYS,
  COLLABORATION_READ_KEYS,
  COLLABORATION_EXPORT_KEYS,
  paginateTeamProgress,
  buildTeamStatus,
  authorizedFilterSchema,
  readTeamStatusSinceLastView,
  exportTeamStatus,
  listCollaborationSupport,
  recordExternalAssistance,
  supplementCollaborationEvent,
  correctCollaborationEvent,
  revokeCollaborationEvent,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => {
    throw new Error('team status route database factory is required');
  };
  const handleError = typeof sendApiError === 'function'
    ? sendApiError
    : (res, error) => res.status(error.statusCode || 400).json({ ok: false, error: error.message });

  app.get('/api/sales-crm/team-status', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.progress,
        req.query || {},
        TEAM_STATUS_READ_KEYS,
      );
      const result = paginateTeamProgress(
        buildTeamStatus(value, req.salesUser, input, teamStatusOptions(value, req)),
        input,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...result,
        schemas: {
          progress: authorizedFilterSchema(
            value, req.salesUser, TEAM_STATUS_FILTER_PAGES.progress,
          ),
          collaboration: authorizedFilterSchema(
            value, req.salesUser, TEAM_STATUS_FILTER_PAGES.collaboration,
          ),
        },
      });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/team-status/since-last-view', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.progress,
        req.body || {},
        TEAM_STATUS_CURSOR_KEYS,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      const result = paginateTeamProgress(readTeamStatusSinceLastView(
        value, req.salesUser, input, teamStatusOptions(value, req),
      ), input);
      res.json({
        ok: true,
        ...result,
      });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/team-status/export', (req, res) => {
    const value = db();
    try {
      const section = String(req.query?.section || 'progress').toLowerCase();
      const filterPage = section === 'collaboration'
        ? TEAM_STATUS_FILTER_PAGES.collaboration
        : TEAM_STATUS_FILTER_PAGES.progress;
      const input = teamStatusRequest(
        value,
        req.salesUser,
        filterPage,
        req.query || {},
        TEAM_STATUS_EXPORT_KEYS,
      );
      const exported = exportTeamStatus(
        value, req.salesUser, input, teamStatusOptions(value, req),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/collaboration-support', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.collaboration,
        req.query || {},
        COLLABORATION_READ_KEYS,
      );
      const result = listCollaborationSupport(
        value, req.salesUser, input, teamStatusOptions(value, req),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...result,
        schema: authorizedFilterSchema(
          value, req.salesUser, TEAM_STATUS_FILTER_PAGES.collaboration,
        ),
      });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/collaboration-support/export', (req, res) => {
    const value = db();
    try {
      const input = teamStatusRequest(
        value,
        req.salesUser,
        TEAM_STATUS_FILTER_PAGES.collaboration,
        req.query || {},
        COLLABORATION_EXPORT_KEYS,
      );
      const exported = exportTeamStatus(value, req.salesUser, {
        ...input,
        section: 'collaboration',
      }, teamStatusOptions(value, req));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/collaboration-support', (req, res) => {
    const value = db();
    try {
      const event = recordExternalAssistance(
        value, req.salesUser, req.body || {}, teamStatusOptions(value, req),
      );
      res.status(event.deduplicated ? 200 : 201).json({ ok: true, event });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  });

  const appendCollaborationEvent = (operation, action) => (req, res) => {
    const value = db();
    try {
      const event = operation(
        value,
        req.salesUser,
        req.params.eventId,
        req.body || {},
        teamStatusOptions(value, req),
      );
      res.status(event.deduplicated ? 200 : 201).json({ ok: true, event, action });
    } catch (error) { handleError(res, error); }
    finally { value.close(); }
  };

  app.post('/api/sales-crm/collaboration-support/:eventId/supplements',
    appendCollaborationEvent(supplementCollaborationEvent, 'supplement'));
  app.post('/api/sales-crm/collaboration-support/:eventId/corrections',
    appendCollaborationEvent(correctCollaborationEvent, 'correction'));
  app.post('/api/sales-crm/collaboration-support/:eventId/revocations',
    appendCollaborationEvent(revokeCollaborationEvent, 'revocation'));

  return app;
}

module.exports = { registerTeamStatusRoutes };

'use strict';

function registerSalesCrmAdminRoutes(app, deps = {}) {
  if (!app) return app;
  const {
    db,
    sendApiError,
    maintenanceCapabilities,
    listMaintenanceRuns,
    previewDataMaintenance,
    executeDataMaintenance,
    createUser,
    resetUserPassword,
    updateUser,
    archiveUser,
    restoreUser,
    deleteArchivedUser,
    listPermissionGroups,
    createPermissionGroup,
    updatePermissionGroup,
    restoreUserPermissions,
    replaceUserPermissions,
    assertPermission,
    httpError,
    filterPermissionAdminState,
    createFilterDefinition,
    saveGroupFilterGrants,
    restoreUserExtraFilterGrants,
    saveUserExtraFilterGrants,
    updateFilterDefinition,
    badRequest,
  } = deps;
  app.get('/api/sales-crm/data-maintenance/capabilities', (_req, res) => {
    res.json({ ok: true, ...maintenanceCapabilities() });
  });

  app.get('/api/sales-crm/data-maintenance/runs', (req, res) => {
    const value = db();
    try { res.json({ ok: true, runs: listMaintenanceRuns(value, req.query.limit) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/data-maintenance/preview', (req, res) => {
    const value = db();
    try {
      const preview = previewDataMaintenance(value, req.realUser, req.sessionTokenHash, req.body || {});
      res.json({ ok: true, ...preview });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/data-maintenance/execute', async (req, res) => {
    const value = db();
    try {
      const result = await executeDataMaintenance(value, req.realUser, req.sessionTokenHash, req.body || {});
      res.json({ ok: true, ...result });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/users', (req, res) => {
    try { res.json({ ok: true, ...createUser(req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/password-reset', (req, res) => {
    try { res.json({ ok: true, ...resetUserPassword(req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.patch('/api/sales-crm/users/:userId', (req, res) => {
    try { res.json({ ok: true, ...updateUser(req.salesUser, req.params.userId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/archive', (req, res) => {
    try { res.json({ ok: true, ...archiveUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.post('/api/sales-crm/users/:userId/restore', (req, res) => {
    try { res.json({ ok: true, ...restoreUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.delete('/api/sales-crm/users/:userId', (req, res) => {
    try { res.json({ ok: true, ...deleteArchivedUser(req.salesUser, req.params.userId) }); }
    catch (error) { sendApiError(res, error); }
  });

  app.get('/api/sales-crm/permission-groups', (_req, res) => {
    const value = db();
    try { res.json({ ok: true, permissionGroups: listPermissionGroups(value) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/permission-groups', (req, res) => {
    const value = db();
    try { res.json({ ok: true, ...createPermissionGroup(value, req.salesUser, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/permission-groups/:groupId', (req, res) => {
    const value = db();
    try { res.json({ ok: true, ...updatePermissionGroup(value, req.salesUser, req.params.groupId, req.body || {}) }); }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/users/:userId/permission-overrides', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const unsupported = Object.keys(body).find(key => !['permissions', 'restoreDefault'].includes(key));
      if (unsupported) throw badRequest(`不支持的个人权限字段：${unsupported}`);
      if (body.restoreDefault === true) {
        res.json({ ok: true, ...restoreUserPermissions(value, req.salesUser, req.params.userId) });
        return;
      }
      res.json({ ok: true, ...replaceUserPermissions(value, req.salesUser, req.params.userId, body.permissions) });
    }
    catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/filter-permissions', (req, res) => {
    const value = db();
    try {
      assertPermission(req.salesUser, 'view_users');
      assertPermission(req.salesUser, 'manage_users');
      if (req.salesUser.role !== 'admin') {
        throw httpError(403, '只有管理员可以管理筛选权限', 'FILTER_ADMIN_REQUIRED');
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, ...filterPermissionAdminState(value) });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/filter-permissions', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const candidate = body.definition && typeof body.definition === 'object'
        && !Array.isArray(body.definition)
        ? body.definition
        : Object.fromEntries(Object.entries(body).filter(([key]) =>
          !['note', 'expectedVersion'].includes(key)));
      res.json({
        ok: true,
        ...createFilterDefinition(value, req.salesUser, candidate, {
          note: body.note,
          expectedVersion: body.expectedVersion,
        }),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/filter-permissions/groups/:groupId', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      res.json({
        ok: true,
        ...saveGroupFilterGrants(
          value,
          req.salesUser,
          req.params.groupId,
          Array.isArray(body.filterKeys) ? body.filterKeys : [],
          {
            note: body.note,
            expectedVersion: body.expectedVersion,
          },
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.put('/api/sales-crm/filter-permissions/users/:userId', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const options = {
        note: body.note,
        expectedVersion: body.expectedVersion,
      };
      const result = body.restore === true
        ? restoreUserExtraFilterGrants(
          value, req.salesUser, req.params.userId, options,
        )
        : saveUserExtraFilterGrants(
          value,
          req.salesUser,
          req.params.userId,
          Array.isArray(body.filterKeys) ? body.filterKeys : [],
          options,
        );
      res.json({ ok: true, ...result });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/filter-permissions/definitions/:filterKey', (req, res) => {
    const value = db();
    try {
      const body = req.body || {};
      const patch = body.patch && typeof body.patch === 'object'
        ? body.patch
        : Object.fromEntries(Object.entries(body).filter(([key]) =>
          !['note', 'expectedVersion'].includes(key)));
      res.json({
        ok: true,
        ...updateFilterDefinition(
          value,
          req.salesUser,
          req.params.filterKey,
          patch,
          {
            note: body.note,
            expectedVersion: body.expectedVersion,
          },
        ),
      });
    } catch (error) { sendApiError(res, error); }
    finally { value.close(); }
  });

}

module.exports = { registerSalesCrmAdminRoutes };

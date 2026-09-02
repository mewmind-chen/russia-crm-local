'use strict';

/**
 * HTTP assembly for manager-task, manager-metrics and manager-risks routes.
 *
 * The manager services remain in sales_crm.js for now because they share
 * account scope, task state and notification helpers. This module owns only
 * request decoding, database lifetime, response shaping and route wiring.
 */
function registerSalesCrmManagerRoutes(app, deps = {}) {
  if (!app) return app;
  const {
    db,
    sendApiError,
    assertManagerSettingsAdmin,
    getManagerTaskSettings,
    updateManagerSettings,
    scanManagerTasks,
    loadAuthorizedBusinessPage,
    csvSerialize,
    managerTaskAccount,
    json,
    buildCustomerPlanRisk,
    emptyCustomerPlanRisk,
    resolveManagerTaskAction,
    assertPermission,
    forbidden,
    buildManagerMetricDrilldown,
    auditIdentity,
  } = deps;
  const fail = (res, error) => (typeof sendApiError === 'function'
    ? sendApiError(res, error)
    : res.status(error.statusCode || 400).json({ ok: false, error: error.message }));
  const identity = typeof auditIdentity === 'function' ? auditIdentity : () => ({});

  app.get('/api/sales-crm/manager-task-settings', (req, res) => {
    const value = db();
    try {
      assertManagerSettingsAdmin(req.salesUser);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, settings: getManagerTaskSettings(value) });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.patch('/api/sales-crm/manager-task-settings', (req, res) => {
    try {
      res.json({ ok: true, settings: updateManagerSettings(req.salesUser, req.body || {}) });
    } catch (error) { fail(res, error); }
  });

  app.post('/api/sales-crm/manager-tasks', (req, res) => {
    try {
      res.json({ ok: true, ...scanManagerTasks(req.salesUser, req.body || {}) });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_tasks', req.query || {}),
      });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks/export', (req, res) => {
    try {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const result = loadAuthorizedBusinessPage(req.salesUser, 'manager_tasks', {
          ...req.query,
          page: String(page),
          pageSize: '100',
        });
        rows.push(...result.rows);
        if (!result.hasMore) break;
      }
      const headers = [
        '任务ID', '客户编号', '客户名称', '当前负责人', '原因', '状态',
        '触发时间', '到期时间', '完结时间',
      ];
      const reasonLabels = {
        consecutive_deferred: '连续暂未确定',
        first_contact_silence: '首次触达后沉默',
        planned_action_overdue: '计划动作超时',
        manager_assistance: '销售请求经理协助',
      };
      const body = rows.map(row => [
        row.id,
        row.customerId,
        row.companyName,
        row.ownerName || row.ownerId,
        reasonLabels[row.reason] || row.reason,
        row.status,
        row.triggeredAt,
        row.dueAt,
        row.resolvedAt,
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="crm-manager-tasks-${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      return res.send(csvSerialize(headers, body));
    } catch (error) { return fail(res, error); }
  });

  app.get('/api/sales-crm/manager-tasks/:taskId', (req, res) => {
    const value = db();
    try {
      const { task, account, riskAvailable } = managerTaskAccount(
        value,
        req.salesUser,
        req.params.taskId,
        { allowReadOnlyFallback: true },
      );
      const interventions = value.prepare(`SELECT id,task_id,actor_id,action,note,difficulty,
        business_change_json,result_json,created_at FROM crm_manager_interventions
        WHERE task_id=? ORDER BY created_at,id`).all(task.id).map(row => ({
        ...row,
        businessChange: json(row.business_change_json, {}),
        result: json(row.result_json, {}),
      }));
      const customerAssistanceHistory = value.prepare(`SELECT id,status,triggered_at,resolved_at,
        evidence_json,result_json FROM crm_manager_tasks
        WHERE customer_id=? AND reason='manager_assistance'
        ORDER BY triggered_at DESC,id DESC`).all(task.customerId).map(row => {
        const evidence = json(row.evidence_json, {});
        const result = json(row.result_json, {});
        const replied = result.action === 'manager_replied';
        const confirmed = result.action === 'sales_plan_confirmed';
        return {
          taskId: row.id,
          status: row.status,
          requestedAt: evidence.requestedAt || row.triggered_at || '',
          requestReason: evidence.requestReason || evidence.summary || '',
          originalPlan: evidence.originalPlan || '',
          replyText: replied ? String(result.result || '') : '',
          repliedAt: replied ? String(result.repliedAt || '') : '',
          confirmed,
          confirmedAt: confirmed ? String(result.confirmedAt || '') : '',
          nextAction: confirmed ? String(result.nextAction || '') : '',
          resolvedAt: row.resolved_at || '',
        };
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        task,
        account: {
          id: account.id,
          externalCustomerId: account.external_customer_id || '',
          companyName: account.company_name,
          ownerId: account.owner_id || '',
          stage: account.stage,
          sourceType: account.source_type || 'account',
          intakeItemId: account.intake_item_id || '',
        },
        interventions,
        customerAssistanceHistory,
        risk: riskAvailable
          ? buildCustomerPlanRisk(value, { user: req.salesUser, customerId: task.customerId })
          : emptyCustomerPlanRisk(task, account),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.post('/api/sales-crm/manager-tasks/:taskId/resolve', (req, res) => {
    try {
      res.json({
        ok: true,
        ...resolveManagerTaskAction(
          req.salesUser,
          req.params.taskId,
          req.body || {},
          identity(req),
        ),
      });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/manager-metrics', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_metrics', req.query || {}),
      });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/sales-crm/manager-metrics/drilldown', (req, res) => {
    const value = db();
    try {
      assertPermission(req.salesUser, 'resolve_manager_tasks');
      if (!['admin', 'manager'].includes(String(req.salesUser?.role || ''))) {
        throw forbidden('当前账号无权查看团队统计明细');
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...buildManagerMetricDrilldown(value, {
          user: req.salesUser,
          actorId: req.query.actorId,
          kind: req.query.kind,
          rangeDays: req.query.rangeDays,
          settings: getManagerTaskSettings(value),
          page: req.query.page,
          pageSize: req.query.pageSize,
        }),
      });
    } catch (error) { fail(res, error); }
    finally { value.close(); }
  });

  app.get('/api/sales-crm/manager-risks', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        ok: true,
        ...loadAuthorizedBusinessPage(req.salesUser, 'manager_risks', req.query || {}),
      });
    } catch (error) { fail(res, error); }
  });

  return app;
}

module.exports = { registerSalesCrmManagerRoutes };

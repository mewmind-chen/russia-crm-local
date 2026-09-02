'use strict';

/**
 * Non-AI application workflows for deferred plans and manager interventions.
 *
 * The low-level task/event schemas live in `manager_tasks` and
 * `deferred_plan`. This module owns the application boundary that combines
 * authorization, account scope, lifecycle gateways, notifications and audit
 * records. Dependencies are injected so the workflow does not reach into the
 * CRM composition root's private state.
 */
const {
  deferredPlanWritesEnabled,
  parseBusinessDateTime,
  recordDeferredPlan,
  recordExplicitPlan,
} = require('./deferred_plan');
const {
  evaluateManagerTriggers,
  getManagerTask,
  getManagerTaskSettings,
  listManagerTasks,
  markManagerTasksOverdue,
  resolveManagerTask,
  updateManagerTaskSettings,
  upsertManagerTask,
} = require('./manager_tasks');

function createManagerWorkflowServices(deps = {}) {
  const {
    db,
    assertPermission,
    badRequest,
    conflictError,
    forbidden,
    httpError,
    inaccessibleOrMissing,
    hasPermission,
    getAccountForUser,
    accountScope,
    isFollowUpTerminalStage,
    applyAccountPlanPatch,
    applyAccountStatePatch,
    applyManagerStatusPatch,
    PLAN_TIME_BASIS,
    authorizedSalesUser,
    hydrateUserPermissions,
    hydrateUsersPermissions,
    createNotification,
    nowText,
    id,
    redactAuditPayload,
    noPlanStreakForActivities,
  } = deps;

  function deferAccountPlan(user, customerId, payload = {}, identity = {}) {
    assertPermission(user, 'record_activity');
    const sourceEventId = String(payload.idempotencyKey || '').trim();
    if (!sourceEventId || sourceEventId.length > 240) {
      throw badRequest('必须提供有效的幂等键');
    }
    const value = db();
    try {
      const account = getAccountForUser(value, user, String(customerId || '').trim());
      if (isFollowUpTerminalStage(account.stage)) {
        throw conflictError('该客户已处于无需跟进的终止阶段', 'DEFERRED_PLAN_TERMINAL_STAGE');
      }
      const transaction = value.transaction(() => {
        const existing = value.prepare(`SELECT id FROM crm_deferred_plan_events
          WHERE source='manual_deferred' AND source_event_id=?`).get(sourceEventId);
        const event = recordDeferredPlan(value, {
          customerId: account.external_customer_id || account.id,
          actorId: user.id,
          ownerIdSnapshot: account.owner_id || '',
          reviewAt: payload.reviewAt,
          reason: payload.reason,
          source: 'manual_deferred',
          sourceEventId,
        });
        if (existing) {
          return {
            customerId: account.id,
            eventId: event.id,
            reviewAt: event.reviewAt,
            deduplicated: true,
          };
        }
        const changedAt = nowText();
        applyAccountPlanPatch(value, account.id, {
          nextAction: '',
          nextActionAt: '',
          timeBasis: '',
          updatedAt: changedAt,
        });
        value.prepare(`INSERT INTO crm_audit_log
          (id,user_id,action,entity_type,entity_id,detail_json,created_at,
           real_user_id,effective_user_id,impersonation_context_id)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id('AUD'), identity.effectiveUserId || user.id, 'customer_plan_deferred',
          'crm_account', account.id, JSON.stringify({
            eventId: event.id,
            reviewAt: event.reviewAt,
            source: event.source,
          }), changedAt,
          identity.realUserId || user.id,
          identity.effectiveUserId || user.id,
          identity.contextId || '',
        );
        return {
          customerId: account.id,
          eventId: event.id,
          reviewAt: event.reviewAt,
          deduplicated: false,
        };
      });
      return transaction.immediate();
    } finally { value.close(); }
  }

  function recordExplicitPlanIfEnabled(
    value,
    account,
    actorId,
    nextAction,
    nextActionAt,
    source,
    sourceEventId = '',
  ) {
    if (!deferredPlanWritesEnabled()) return null;
    return recordExplicitPlan(value, {
      customerId: account.external_customer_id || account.id,
      actorId,
      ownerIdSnapshot: account.owner_id || '',
      nextAction,
      nextAt: `${String(nextActionAt).replace(' ', 'T')}Z`,
      source,
      sourceEventId,
    });
  }

  function scopedManagerAccount(value, user, customerId) {
    const selected = String(customerId || '').trim();
    const scope = accountScope(user);
    const account = value.prepare(`SELECT a.* FROM crm_accounts a
      WHERE (a.id=? OR a.external_customer_id=?)
        AND ${scope.sql.replace(/^WHERE\s+/i, '')}
      ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END LIMIT 1`)
      .get(selected, selected, ...scope.params, selected);
    if (!account) throw inaccessibleOrMissing(user, '客户不存在');
    return account;
  }

  function assertManagerTaskRole(user) {
    if (!['admin', 'manager'].includes(String(user?.role || ''))) {
      throw forbidden('只有管理员或主管可以访问主管任务');
    }
  }

  function assertManagerSettingsAdmin(user) {
    if (String(user?.role || '') !== 'admin') {
      throw forbidden('只有管理员可以配置主管提醒规则');
    }
  }

  function managerTaskAccount(value, user, taskId, options = {}) {
    assertManagerTaskRole(user);
    const task = getManagerTask(value, taskId);
    if (!task) throw httpError(404, '主管任务不存在', 'MANAGER_TASK_NOT_FOUND');
    let account = null;
    let riskAvailable = false;
    try {
      account = scopedManagerAccount(value, user, task.customerId);
      riskAvailable = true;
    } catch (error) {
      if (!options.allowReadOnlyFallback) throw error;
      const isRecipient = (task.recipientIds || []).includes(String(user.id || ''));
      if (user.role !== 'admin' && !isRecipient) throw error;
      const selected = String(task.customerId || '').trim();
      account = value.prepare(`SELECT a.* FROM crm_accounts a
        WHERE (a.id=? OR a.external_customer_id=?) AND COALESCE(a.is_test_data,0)=0
        ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END LIMIT 1`)
        .get(selected, selected, selected);
      if (account) account.source_type = 'account';
      if (!account) {
        const intake = value.prepare(`SELECT i.*,
          COALESCE(NULLIF(p.company_name,''),i.company_name) resolved_company_name
          FROM crm_intake_items i
          LEFT JOIN customer_pool p ON p.customer_id=i.external_customer_id
          WHERE i.id=? OR i.external_customer_id=?
          ORDER BY CASE WHEN i.id=? THEN 0 ELSE 1 END LIMIT 1`)
          .get(selected, selected, selected);
        if (intake) {
          account = {
            id: '',
            external_customer_id: intake.external_customer_id || selected,
            company_name: intake.resolved_company_name || intake.company_name || selected,
            owner_id: intake.assigned_owner_id || intake.previous_owner_id || '',
            stage: 'intake',
            source_type: 'intake',
            intake_item_id: intake.id,
          };
        }
      }
      if (!account) throw inaccessibleOrMissing(user, '客户不存在');
    }
    return { task, account, riskAvailable };
  }

  function scopedManagerTasks(value, user, options = {}) {
    assertManagerTaskRole(user);
    markManagerTasksOverdue(value);
    const scope = accountScope(user);
    const visibleCustomerIds = new Set(value.prepare(`SELECT a.id,a.external_customer_id
      FROM crm_accounts a ${scope.sql}`).all(...scope.params)
      .flatMap(row => [String(row.id || ''), String(row.external_customer_id || '')]).filter(Boolean));
    return listManagerTasks(value, options).filter(task => visibleCustomerIds.has(task.customerId));
  }

  function scopedManagerTasksForTodayAlerts(value, user) {
    if (!['admin', 'manager'].includes(String(user?.role || ''))) return [];
    return scopedManagerTasks(value, user, { limit: 100 });
  }

  function eligibleManagerRecipient(value, recipientId) {
    const recipient = hydrateUserPermissions(
      value,
      value.prepare("SELECT * FROM sales_users WHERE id=? AND active=1 AND COALESCE(archived_at,'')='' ")
        .get(String(recipientId || '').trim()),
    );
    if (!recipient || !['admin', 'manager'].includes(recipient.role)
        || !hasPermission(recipient, 'resolve_manager_tasks')) {
      return null;
    }
    return recipient;
  }

  function managerRecipient(value, recipientId) {
    const recipient = eligibleManagerRecipient(value, recipientId);
    if (!recipient) {
      throw badRequest('提醒接收人必须是在职且有主管任务权限的管理员或主管');
    }
    return recipient;
  }

  function validateManagerRecipients(value, recipientIds = []) {
    return [...new Set(recipientIds.map(item => String(item || '').trim()).filter(Boolean))]
      .map(recipientId => managerRecipient(value, recipientId));
  }

  function canRecipientAccessAccount(value, recipient, account) {
    try {
      scopedManagerAccount(value, recipient, account.id);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function notifyManagerTaskRecipients(value, task, account) {
    const recipients = task.recipientIds.map(recipientId =>
      eligibleManagerRecipient(value, recipientId)).filter(Boolean)
      .filter(recipient => canRecipientAccessAccount(value, recipient, account));
    for (const recipient of recipients) {
      createNotification(value, {
        userId: recipient.id,
        customerId: task.customerId,
        code: 'MANAGER_TASK_CREATED',
        severity: task.status === 'overdue' ? 'critical' : 'warning',
        title: '有新的主管任务待处理',
        detail: account.company_name || task.customerId,
        dedupeKey: `manager-task:${task.id}:${recipient.id}`,
      }, { wecomEnabled: false });
    }
    return recipients.map(recipient => recipient.id);
  }

  function managerAssistanceRecipientIds(value, account) {
    return hydrateUsersPermissions(value, value.prepare(
      "SELECT * FROM sales_users WHERE role IN ('admin','manager') AND active=1 "
      + "AND COALESCE(archived_at,'')='' ORDER BY id",
    ).all()).filter(recipient =>
      hasPermission(recipient, 'resolve_manager_tasks')
      && hasPermission(recipient, 'view_team')
      && hasPermission(recipient, 'view_alerts')
      && canRecipientAccessAccount(value, recipient, account))
      .map(recipient => recipient.id);
  }

  function notifyManagerTaskEscalation(value, task, account) {
    const admins = hydrateUsersPermissions(value, value.prepare(
      "SELECT * FROM sales_users WHERE role='admin' AND active=1 AND COALESCE(archived_at,'')='' ORDER BY id",
    ).all()).filter(admin => hasPermission(admin, 'resolve_manager_tasks')
      && canRecipientAccessAccount(value, admin, account));
    for (const admin of admins) {
      createNotification(value, {
        userId: admin.id,
        customerId: task.customerId,
        code: 'MANAGER_TASK_ESCALATED',
        severity: 'critical',
        title: '主管协助事项已升级为经营决策事项',
        detail: account.company_name || task.customerId,
        dedupeKey: `manager-task-escalated:${task.id}:${admin.id}`,
      }, { wecomEnabled: false });
    }
  }

  function notifyNoPlanStreak(value, account) {
    if (!account?.id) return;
    const streak = noPlanStreakForActivities(value.prepare(
      `SELECT id,occurred_at,created_at,no_plan,superseded_at,is_test_data
       FROM crm_activities WHERE customer_id=? ORDER BY occurred_at DESC,id DESC`,
    ).all(account.id));
    if (Number(streak.count) < 3 || !streak.streakStartId) return;
    const customerLabel = account.nickname || account.company_name || '客户';
    const ownerName = value.prepare('SELECT name FROM sales_users WHERE id=?')
      .get(String(account.owner_id || ''))?.name || '';
    const recipients = hydrateUsersPermissions(value, value.prepare(
      "SELECT * FROM sales_users WHERE role IN ('admin','manager') AND active=1 "
      + "AND COALESCE(archived_at,'')='' ORDER BY id",
    ).all()).filter(user =>
      hasPermission(user, 'view_alerts')
      && hasPermission(user, 'resolve_manager_tasks')
      && canRecipientAccessAccount(value, user, account));
    const detail = `${customerLabel} · 当前负责人 ${ownerName || '未分配'}`
      + ` · 已连续 ${streak.count} 次暂无计划 · 建议主管协助并形成明确下一步`;
    for (const recipient of recipients) {
      createNotification(value, {
        userId: recipient.id,
        customerId: account.id,
        code: 'NO_PLAN_STREAK',
        severity: 'warning',
        title: `连续 ${streak.count} 次暂无计划`,
        detail,
        dedupeKey: `no-plan-streak:${account.id}:${streak.streakStartId}:${recipient.id}`,
      }, { wecomEnabled: false });
    }
  }

  function scanManagerTasks(user, payload = {}) {
    assertManagerTaskRole(user);
    const value = db();
    try {
      const account = scopedManagerAccount(value, user, payload.customerId);
      return value.transaction(() => {
        const triggers = evaluateManagerTriggers(
          value,
          account.external_customer_id || account.id,
        );
        const tasks = triggers.map(trigger => {
          const task = upsertManagerTask(value, trigger);
          notifyManagerTaskRecipients(value, task, account);
          return task;
        });
        return { tasks, evaluatedReasons: triggers.map(trigger => trigger.reason) };
      }).immediate();
    } finally { value.close(); }
  }

  function updateManagerSettings(user, payload = {}) {
    assertManagerSettingsAdmin(user);
    const value = db();
    try {
      validateManagerRecipients(value, payload.recipientIds ?? payload.patch?.recipientIds ?? []);
      return updateManagerTaskSettings(value, {
        actorId: user.id,
        expectedVersion: payload.expectedVersion,
        patch: payload.patch || payload,
      });
    } finally { value.close(); }
  }

  function managerTaskChange(value, actor, task, account, action = {}) {
    const type = String(action.type || '').trim();
    const at = nowText();
    if (type === 'plan_formed' || type === 'manager_advice') {
      if (!hasPermission(actor, 'edit_customer')) throw forbidden('没有编辑客户资料权限');
      if (type === 'manager_advice' && !hasPermission(actor, 'record_activity')) {
        throw forbidden('没有记录客户进展权限');
      }
      const nextAction = String(action.nextAction || '').trim();
      if (!nextAction) throw badRequest('请填写明确的下一步计划');
      const nextActionAt = parseBusinessDateTime(action.nextActionAt);
      const before = {
        nextAction: account.next_action || '',
        nextActionAt: account.next_action_at || '',
      };
      if (before.nextAction === nextAction && before.nextActionAt === nextActionAt) {
        return { changed: false };
      }
      applyAccountPlanPatch(value, account.id, {
        nextAction,
        nextActionAt,
        timeBasis: PLAN_TIME_BASIS,
        updatedAt: at,
      });
      const sourceEventId = `manager-task:${task.id}:${String(action.idempotencyKey || '').trim()}`;
      recordExplicitPlan(value, {
        customerId: account.external_customer_id || account.id,
        actorId: actor.id,
        ownerIdSnapshot: account.owner_id || '',
        nextAction,
        nextAt: `${nextActionAt.replace(' ', 'T')}Z`,
        source: type === 'manager_advice' ? 'manager_advice' : 'manager_task',
        sourceEventId,
      });
      if (type === 'manager_advice') {
        const note = String(action.note || '').trim();
        if (!note) throw badRequest('请填写主管建议');
        value.prepare(`INSERT INTO crm_activities
          (id,customer_id,user_id,activity_type,summary,next_action,next_action_at,
           stage_before,stage_after,occurred_at,created_at)
          VALUES (?,?,?,'manager_advice',?,?,?,?,?,?,?)`).run(
          id('ACT'), account.id, actor.id, note, nextAction, nextActionAt,
          account.stage, account.stage, at, at,
        );
      }
      return {
        changed: true,
        entityType: 'crm_account_plan',
        entityId: account.id,
        before,
        after: { nextAction, nextActionAt },
      };
    }
    if (type === 'terminal_stage') {
      if (!hasPermission(actor, 'edit_customer')) throw forbidden('没有编辑客户资料权限');
      const stage = String(action.stage || '').trim();
      if (stage !== 'lost') throw badRequest('不对口请使用专用“标记不对口”流程');
      if (account.stage === stage) return { changed: false };
      const before = {
        stage: account.stage,
        nextAction: account.next_action || '',
        nextActionAt: account.next_action_at || '',
      };
      applyAccountStatePatch(value, account.id, { stage, updatedAt: at });
      applyAccountPlanPatch(value, account.id, {
        nextAction: '',
        nextActionAt: '',
        timeBasis: '',
        updatedAt: at,
      });
      value.prepare(`UPDATE crm_accounts SET loss_reason=? WHERE id=?`)
        .run(String(action.note || '').trim(), account.id);
      return {
        changed: true,
        entityType: 'crm_account',
        entityId: account.id,
        before,
        after: { stage, nextAction: '', nextActionAt: '' },
      };
    }
    if (type === 'reassigned') {
      if (!hasPermission(actor, 'manage_intake')) throw forbidden('没有管理入库与分配权限');
      const ownerId = String(action.ownerId || '').trim();
      if (!ownerId || ownerId === String(account.owner_id || '')
          || !authorizedSalesUser(value, ownerId)) {
        throw badRequest('请选择不同的在职销售负责人');
      }
      const before = { ownerId: account.owner_id || '' };
      applyAccountStatePatch(value, account.id, {
        ownerId,
        assignmentStatus: 'claimed',
        updatedAt: at,
      });
      value.prepare(`UPDATE crm_accounts SET assigned_at=? WHERE id=?`).run(at, account.id);
      if (account.intake_item_id) {
        value.prepare(`UPDATE crm_intake_items SET assigned_owner_id=?,status='claimed',
          assigned_at=?,updated_at=? WHERE id=?`).run(ownerId, at, at, account.intake_item_id);
      }
      return {
        changed: true,
        entityType: 'crm_account_owner',
        entityId: account.id,
        before,
        after: { ownerId },
      };
    }
    return null;
  }

  function resolveManagerTaskAction(user, taskId, payload = {}, identity = {}) {
    const value = db();
    try {
      return value.transaction(() => {
        const { task, account } = managerTaskAccount(value, user, taskId);
        if (String(payload.type || '').trim() === 'terminal_stage'
            && String(payload.stage || '').trim() !== 'lost') {
          throw badRequest('不对口请使用专用“标记不对口”流程');
        }
        const before = {
          taskStatus: task.status,
          account: {
            ownerId: account.owner_id || '',
            stage: account.stage || '',
            nextAction: account.next_action || '',
            nextActionAt: account.next_action_at || '',
          },
        };
        const result = resolveManagerTask(value, user, task.id, {
          ...payload,
          apply: (transactionDb, currentTask) => managerTaskChange(
            transactionDb, user, currentTask, account, payload,
          ),
        });
        if (result.task.status === 'escalated' && !result.deduplicated) {
          notifyManagerTaskEscalation(value, result.task, account);
        }
        if (!result.deduplicated) {
          const currentAccount = value.prepare(`SELECT owner_id,stage,next_action,next_action_at
            FROM crm_accounts WHERE id=?`).get(account.id) || {};
          const realUserId = identity.realUserId || user.id;
          const effectiveUserId = identity.effectiveUserId || user.id;
          value.prepare(`INSERT INTO crm_audit_log
            (id,user_id,action,entity_type,entity_id,detail_json,created_at,
             real_user_id,effective_user_id,impersonation_context_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
            id('AUD'),
            effectiveUserId,
            'manager_task_resolved',
            'crm_manager_task',
            task.id,
            JSON.stringify(redactAuditPayload({
              actionType: String(payload.type || ''),
              interventionId: result.interventionId,
              before,
              after: {
                taskStatus: result.task.status,
                account: {
                  ownerId: currentAccount.owner_id || '',
                  stage: currentAccount.stage || '',
                  nextAction: currentAccount.next_action || '',
                  nextActionAt: currentAccount.next_action_at || '',
                },
              },
              result: result.task.result || {},
            })),
            nowText(),
            realUserId,
            effectiveUserId,
            identity.contextId || '',
          );
        }
        return result;
      }).immediate();
    } finally { value.close(); }
  }

  return Object.freeze({
    assertManagerSettingsAdmin,
    assertManagerTaskRole,
    canRecipientAccessAccount,
    deferAccountPlan,
    managerAssistanceRecipientIds,
    managerTaskAccount,
    notifyManagerTaskEscalation,
    notifyManagerTaskRecipients,
    notifyNoPlanStreak,
    recordExplicitPlanIfEnabled,
    resolveManagerTaskAction,
    scanManagerTasks,
    scopedManagerAccount,
    scopedManagerTasks,
    scopedManagerTasksForTodayAlerts,
    updateManagerSettings,
  });
}

module.exports = { createManagerWorkflowServices };

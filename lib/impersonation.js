const crypto = require('crypto');
const { forbidden, hasPermission } = require('./access_control');
const { hydrateUserPermissions } = require('./permission_groups');

const IMPERSONATION_TTL_MS = 30 * 60 * 1000;
const INSPECTABLE_ROLES = new Set(['manager', 'sales']);

function nowText(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function parseText(value) {
  return new Date(`${String(value || '').replace(' ', 'T')}Z`).getTime();
}

function httpError(statusCode, message, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function ensureColumn(db, table, name, definition) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function installImpersonationSchema(db) {
  ensureColumn(db, 'sales_sessions', 'impersonated_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_started_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_expires_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'sales_sessions', 'impersonation_context_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'real_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'effective_user_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'crm_audit_log', 'impersonation_context_id', "TEXT NOT NULL DEFAULT ''");
}

function writeLifecycleAudit(db, { action, reason = '', realUserId, effectiveUserId, contextId, now }) {
  db.prepare(`INSERT INTO crm_audit_log
    (id,user_id,action,entity_type,entity_id,detail_json,created_at,real_user_id,effective_user_id,impersonation_context_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id('AUD'), effectiveUserId || realUserId, action, 'impersonation', contextId,
    JSON.stringify(reason ? { reason } : {}), now, realUserId, effectiveUserId, contextId,
  );
}

function clearContext(db, tokenHash) {
  db.prepare(`UPDATE sales_sessions SET impersonated_user_id='',impersonation_started_at='',
    impersonation_expires_at='',impersonation_context_id='' WHERE token_hash=?`).run(tokenHash);
}

function endInvalidContext(db, session, reason, now) {
  clearContext(db, session.token_hash);
  writeLifecycleAudit(db, {
    action: 'impersonation_end',
    reason,
    realUserId: session.user_id,
    effectiveUserId: session.impersonated_user_id,
    contextId: session.impersonation_context_id,
    now,
  });
}

function resolveSessionIdentity(db, session, now) {
  const realRow = db.prepare('SELECT * FROM sales_users WHERE id=? AND active=1').get(session.user_id);
  if (!realRow) return null;
  const realUser = hydrateUserPermissions(db, realRow);
  const contextId = String(session.impersonation_context_id || '');
  if (!contextId) return { realUser, effectiveUser: realUser, impersonation: null, ended: false };
  const invalid = reason => {
    endInvalidContext(db, session, reason, now);
    return { realUser, effectiveUser: null, impersonation: null, ended: true };
  };
  if (!session.impersonation_expires_at || parseText(session.impersonation_expires_at) <= parseText(now)) {
    return invalid('expired');
  }
  const targetRow = db.prepare('SELECT * FROM sales_users WHERE id=?').get(session.impersonated_user_id);
  if (!targetRow) return invalid('target_missing');
  if (!targetRow.active) return invalid('target_inactive');
  if (targetRow.role === 'admin') return invalid('target_role_admin');
  const groupRole = db.prepare('SELECT role_key FROM permission_groups WHERE id=?')
    .get(targetRow.permission_group_id)?.role_key || '';
  if (!groupRole || groupRole !== targetRow.role) return invalid('target_group_invalid');
  const effectiveUser = hydrateUserPermissions(db, targetRow);
  return {
    realUser,
    effectiveUser,
    impersonation: {
      contextId,
      targetUserId: effectiveUser.id,
      startedAt: session.impersonation_started_at,
      expiresAt: session.impersonation_expires_at,
    },
    ended: false,
  };
}

function startImpersonation(db, realUser, tokenHash, targetUserId, now) {
  if (realUser.role !== 'admin') throw forbidden('只有管理员可以发起身份检查');
  if (!hasPermission(realUser, 'view_users')) throw forbidden('没有权限：用户与权限');
  if (!hasPermission(realUser, 'manage_users')) throw forbidden('没有权限：管理账号与权限');
  const session = db.prepare('SELECT * FROM sales_sessions WHERE token_hash=?').get(tokenHash);
  if (!session) throw httpError(401, '请先登录', 'AUTH_REQUIRED');
  if (session.impersonation_context_id) throw httpError(409, '已有进行中的身份检查', 'IMPERSONATION_ACTIVE');
  const target = db.prepare('SELECT * FROM sales_users WHERE id=?').get(String(targetUserId || ''));
  if (!target || !target.active) throw httpError(400, '目标用户不存在或已停用');
  if (!INSPECTABLE_ROLES.has(target.role)) throw httpError(400, '身份检查目标只能是经理或销售');
  const contextId = id('IMP');
  const startedAt = now;
  const expiresAt = nowText(new Date(parseText(now) + IMPERSONATION_TTL_MS));
  db.prepare(`UPDATE sales_sessions SET impersonated_user_id=?,impersonation_started_at=?,
    impersonation_expires_at=?,impersonation_context_id=? WHERE token_hash=?`)
    .run(target.id, startedAt, expiresAt, contextId, tokenHash);
  writeLifecycleAudit(db, {
    action: 'impersonation_start',
    realUserId: realUser.id,
    effectiveUserId: target.id,
    contextId,
    now,
  });
  return { contextId, targetUserId: target.id, startedAt, expiresAt };
}

function stopImpersonation(db, realUser, tokenHash, reason, now) {
  const session = db.prepare('SELECT * FROM sales_sessions WHERE token_hash=?').get(tokenHash);
  const contextId = String(session?.impersonation_context_id || '');
  if (!session || !contextId) throw httpError(409, '身份检查已结束，请刷新页面', 'IMPERSONATION_ENDED');
  const targetUserId = session.impersonated_user_id;
  clearContext(db, tokenHash);
  writeLifecycleAudit(db, {
    action: 'impersonation_stop',
    reason,
    realUserId: realUser.id,
    effectiveUserId: targetUserId,
    contextId,
    now,
  });
}

function auditIdentity(req) {
  return {
    userId: req.salesUser?.id || '',
    realUserId: req.realUser?.id || req.salesUser?.id || '',
    effectiveUserId: req.salesUser?.id || '',
    contextId: req.impersonation?.contextId || '',
  };
}

module.exports = {
  IMPERSONATION_TTL_MS,
  installImpersonationSchema,
  resolveSessionIdentity,
  startImpersonation,
  stopImpersonation,
  auditIdentity,
};

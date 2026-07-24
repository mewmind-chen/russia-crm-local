'use strict';

const crypto = require('node:crypto');
const { ROLE_PERMISSIONS } = require('../access_control');
const { effectivePermissionsFor } = require('../permission_groups');
const { installAIStationSchema } = require('./schema');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function json(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : now;
  return new Date(value || Date.now()).toISOString();
}

function normalizeCountry(value) {
  const clean = text(value, 100).toLowerCase();
  const aliases = {
    ru: '俄罗斯', russia: '俄罗斯', br: '巴西', brazil: '巴西',
    us: '美国', usa: '美国', de: '德国', germany: '德国',
    kz: '哈萨克斯坦', kazakhstan: '哈萨克斯坦',
  };
  return aliases[clean] || text(value, 100);
}

function normalizedList(value, max = 30) {
  return [...new Set(json(value).map(item => text(item, 100)).filter(Boolean))].slice(0, max);
}

function effectivePermissions(db, row) {
  if (tableExists(db, 'permission_groups') && tableExists(db, 'user_permission_overrides')
      && row.permission_group_id !== undefined) {
    try {
      return effectivePermissionsFor(db, row.id);
    } catch (_error) {
      // Fall through to the legacy role/JSON representation for old fixtures.
    }
  }
  return {
    ...(ROLE_PERMISSIONS[row.role] || {}),
    ...(() => {
      try { return JSON.parse(row.permissions_json || '{}'); } catch (_error) { return {}; }
    })(),
  };
}

function settingsFor(db, options) {
  const row = tableExists(db, 'crm_intake_settings')
    ? db.prepare("SELECT daily_per_sales FROM crm_intake_settings WHERE id='default'").get()
    : null;
  const configured = Number(options.dailyQuota ?? row?.daily_per_sales ?? 5);
  return { dailyQuota: Number.isInteger(configured) && configured > 0 ? configured : 5 };
}

function workloadByOwner(db) {
  const result = {};
  if (tableExists(db, 'crm_accounts')) {
    for (const row of db.prepare(`SELECT owner_id,COUNT(*) n FROM crm_accounts
      WHERE stage NOT IN ('won','repeat','lost')
        AND COALESCE(assignment_status,'claimed')!='returned'
      GROUP BY owner_id`).all()) {
      result[row.owner_id] = Number(result[row.owner_id] || 0) + Number(row.n || 0);
    }
  }
  if (tableExists(db, 'crm_intake_items')) {
    for (const row of db.prepare(`SELECT assigned_owner_id owner_id,COUNT(*) n FROM crm_intake_items
      WHERE status='assigned' AND assigned_owner_id!='' GROUP BY assigned_owner_id`).all()) {
      result[row.owner_id] = Number(result[row.owner_id] || 0) + Number(row.n || 0);
    }
  }
  return result;
}

function dailyByOwner(db, date) {
  if (!tableExists(db, 'crm_intake_items')) return {};
  const rows = db.prepare(`SELECT assigned_owner_id owner_id,COUNT(*) n
    FROM crm_intake_items WHERE assigned_at>=? GROUP BY assigned_owner_id`)
    .all(`${date.slice(0, 10)} 00:00:00`);
  return Object.fromEntries(rows.map(row => [row.owner_id, Number(row.n || 0)]));
}

function targetContext(options) {
  const source = options.context && typeof options.context === 'object' ? options.context : options;
  const contactMethods = normalizedList(source.contactMethods ?? source.contact_methods, 20)
    .map(item => item.toLowerCase());
  return {
    country: normalizeCountry(source.country),
    languages: normalizedList(source.languages ?? source.language, 20),
    channels: normalizedList(source.channels, 20).map(item => item.toLowerCase()),
    contactMethods,
  };
}

function scoreCandidate(row, context, workload, daily, quota) {
  const countries = normalizedList(row.countries_json).map(normalizeCountry);
  const languages = normalizedList(row.languages_json);
  const channels = normalizedList(row.channels_json).map(item => item.toLowerCase());
  const load = Number(workload[row.id] || 0);
  const assigned = Number(daily[row.id] || 0);
  let score = 30 - Math.min(25, load * 2);
  const reasons = [];
  if (context.country && countries.includes(context.country)) {
    score += 45;
    reasons.push('country_match');
  }
  const inferredLanguage = {
    俄罗斯: '俄',
    巴西: '葡',
    墨西哥: '西',
  }[context.country];
  const languageMatch = context.languages.some(language =>
    languages.some(candidate => candidate.toLowerCase().includes(language.toLowerCase())
      || language.toLowerCase().includes(candidate.toLowerCase())))
    || Boolean(inferredLanguage && languages.some(language => language.includes(inferredLanguage)));
  if (languageMatch) {
    score += 20;
    reasons.push('language_match');
  }
  const channelMatch = channels.find(channel =>
    context.channels.concat(context.contactMethods).some(method => method.includes(channel)));
  if (channelMatch) {
    score += 12;
    reasons.push('channel_match');
  }
  score += Math.max(0, 10 - assigned * 2);
  if (!reasons.length) reasons.push('balanced_workload');
  return {
    score,
    reasons,
    load,
    assigned,
    countries,
    languages,
    channels,
  };
}

function buildCandidates(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  const context = targetContext(options);
  const quota = settingsFor(db, options).dailyQuota;
  const at = nowIso(options.now);
  const workload = workloadByOwner(db);
  const daily = dailyByOwner(db, at);
  const rows = db.prepare(`SELECT * FROM sales_users
    WHERE role='sales' AND active=1 ORDER BY id`).all();
  const candidates = [];
  for (const row of rows) {
    const permissions = effectivePermissions(db, row);
    if (!permissions.view_intake) continue;
    if (Number(daily[row.id] || 0) >= quota) continue;
    const scored = scoreCandidate(row, context, workload, daily, quota);
    const state = {
      id: row.id,
      role: row.role,
      active: Number(row.active) === 1,
      permissions,
      countries: scored.countries,
      languages: scored.languages,
      channels: scored.channels,
      activeWorkload: scored.load,
      dailyAssigned: scored.assigned,
      dailyQuota: quota,
    };
    candidates.push({
      state,
      stateHash: hash(state),
      sortScore: scored.score,
      public: {
        name: text(row.name, 160),
        countries: scored.countries,
        languages: scored.languages,
        channels: scored.channels,
        activeWorkload: scored.load,
        dailyAssigned: scored.assigned,
        dailyQuota: quota,
        matchScore: scored.score,
        reasonCodes: scored.reasons,
      },
    });
  }
  candidates.sort((left, right) =>
    right.sortScore - left.sortScore
    || left.state.activeWorkload - right.state.activeWorkload
    || left.state.id.localeCompare(right.state.id));
  const candidateHash = hash(candidates.map(item => ({ stateHash: item.stateHash, id: item.state.id })));
  return { context, candidates, candidateHash };
}

function fail(message, code = 'AI_CANDIDATE_SNAPSHOT_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function publicSnapshot(db, row, items, status = row.status) {
  const candidates = items.map(item => ({
    token: Number(item.token),
    ...JSON.parse(item.candidate_json || '{}'),
  }));
  return deepFreeze({
    snapshotId: row.id,
    jobId: row.job_id || null,
    customerId: row.customer_id || '',
    station: row.station,
    contextHash: row.context_hash,
    status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    candidateEmployeeIds: candidates.map(item => item.token),
    candidates,
  });
}

function loadItems(db, snapshotId) {
  return db.prepare(`SELECT token,candidate_json,sales_user_id,state_hash
    FROM crm_ai_candidate_snapshot_items WHERE snapshot_id=? ORDER BY token`).all(snapshotId);
}

function markInvalid(db, snapshotId, status, reason, at) {
  db.prepare(`UPDATE crm_ai_candidate_snapshots
    SET status=?,invalidated_at=?,invalidated_reason=? WHERE id=? AND status='active'`)
    .run(status, at, reason, snapshotId);
}

function getCandidateSnapshot(db, snapshotId, options = {}) {
  installAIStationSchema(db);
  const row = db.prepare('SELECT * FROM crm_ai_candidate_snapshots WHERE id=?').get(text(snapshotId, 160));
  if (!row) return null;
  const at = nowIso(options.now);
  if (row.status === 'active' && at >= row.expires_at) {
    markInvalid(db, row.id, 'expired', 'snapshot_expired', at);
    row.status = 'expired';
  }
  if (row.status === 'active') {
    const rebuilt = buildCandidates(db, {
      context: JSON.parse(row.context_json || '{}'),
      dailyQuota: JSON.parse(row.context_json || '{}').dailyQuota,
      now: options.now,
    });
    if (rebuilt.candidateHash !== row.candidate_hash) {
      markInvalid(db, row.id, 'invalidated', 'sales_state_changed', at);
      row.status = 'invalidated';
    }
  }
  return publicSnapshot(db, row, loadItems(db, row.id), row.status);
}

function createCandidateSnapshot(db, options = {}) {
  installAIStationSchema(db);
  const customerId = text(options.customerId, 160);
  const jobId = text(options.jobId, 160) || null;
  const station = text(options.station || 'sales_match', 80) || 'sales_match';
  const createdBy = text(options.createdBy || options.actorId, 160);
  const context = { ...targetContext(options), dailyQuota: settingsFor(db, options).dailyQuota };
  const contextHash = text(options.contextHash, 128) || hash(context);
  const built = buildCandidates(db, { ...options, context, dailyQuota: context.dailyQuota });
  const idempotencyKey = `candidate-snapshot:${station}:${jobId || customerId}:${contextHash}:${built.candidateHash}`;
  const existing = db.prepare('SELECT * FROM crm_ai_candidate_snapshots WHERE idempotency_key=?').get(idempotencyKey);
  if (existing) {
    const current = getCandidateSnapshot(db, existing.id, options);
    if (current?.status === 'active') return current;
    db.prepare('UPDATE crm_ai_candidate_snapshots SET idempotency_key=? WHERE id=?')
      .run(`${idempotencyKey}:retired:${existing.id}`, existing.id);
  }
  const now = nowIso(options.now);
  const requestedTtlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
  if (!Number.isFinite(requestedTtlMs) || requestedTtlMs <= 0) {
    throw new Error('ttlMs must be a positive number');
  }
  const ttlMs = Math.max(60_000, Math.min(MAX_TTL_MS, requestedTtlMs));
  const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
  const idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => `ACS-${crypto.randomUUID()}`;
  const snapshotId = text(idFactory(), 160);
  if (!snapshotId) throw new Error('snapshot id is required');
  const insertSnapshot = db.prepare(`INSERT INTO crm_ai_candidate_snapshots
    (id,job_id,customer_id,station,context_hash,candidate_hash,idempotency_key,context_json,status,created_by,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,'active',?,?,?)`);
  const insertItem = db.prepare(`INSERT INTO crm_ai_candidate_snapshot_items
    (snapshot_id,token,sales_user_id,state_hash,candidate_json,created_at) VALUES (?,?,?,?,?,?)`);
  db.transaction(() => {
    insertSnapshot.run(
      snapshotId, jobId, customerId, station, contextHash, built.candidateHash, idempotencyKey,
      JSON.stringify(context), createdBy, now, expiresAt,
    );
    built.candidates.forEach((candidate, index) => insertItem.run(
      snapshotId, index + 1, candidate.state.id, candidate.stateHash, JSON.stringify(candidate.public), now,
    ));
  })();
  return publicSnapshot(db, {
    id: snapshotId, job_id: jobId, customer_id: customerId, station, context_hash: contextHash,
    status: 'active', created_at: now, expires_at: expiresAt,
  }, loadItems(db, snapshotId));
}

function resolveCandidateEmployeeIds(db, snapshotId, rankedTokens, options = {}) {
  const snapshot = getCandidateSnapshot(db, snapshotId, options);
  if (!snapshot || snapshot.status !== 'active') throw fail('candidate snapshot is not active');
  if (!Array.isArray(rankedTokens)) throw fail('ranked candidate tokens must be an array');
  const expected = snapshot.candidateEmployeeIds;
  const tokens = rankedTokens.map(value => value);
  if (tokens.some(token => !Number.isInteger(token) || token < 1)) {
    throw fail('candidate tokens must be positive integers');
  }
  if (new Set(tokens).size !== tokens.length) throw fail('candidate tokens must be unique');
  if (tokens.length !== expected.length || expected.some(token => !tokens.includes(token))) {
    throw fail('candidate tokens must cover the complete snapshot');
  }
  const placeholders = tokens.map(() => '?').join(',');
  const rows = db.prepare(`SELECT token,sales_user_id FROM crm_ai_candidate_snapshot_items
    WHERE snapshot_id=? AND token IN (${placeholders})`).all(snapshotId, ...tokens);
  if (rows.length !== tokens.length) throw fail('candidate snapshot mapping is incomplete');
  const byToken = new Map(rows.map(row => [Number(row.token), row.sales_user_id]));
  if (tokens.some(token => !byToken.has(token))) throw fail('candidate snapshot mapping is incomplete');
  return Object.freeze(tokens.map(token => byToken.get(token)));
}

function invalidateCandidateSnapshot(db, snapshotId, reason = 'manual_invalidation', options = {}) {
  installAIStationSchema(db);
  const at = nowIso(options.now);
  markInvalid(db, text(snapshotId, 160), 'invalidated', text(reason, 160), at);
  return getCandidateSnapshot(db, snapshotId, options);
}

function salesMatchPromptContext(snapshot) {
  if (!snapshot || snapshot.status !== 'active') throw fail('candidate snapshot is not active');
  return deepFreeze({
    snapshotId: snapshot.snapshotId,
    candidateEmployeeIds: [...snapshot.candidateEmployeeIds],
    trustedCrmContext: {
      salesCandidateSnapshot: {
        expiresAt: snapshot.expiresAt,
        candidates: snapshot.candidates.map(candidate => ({ ...candidate })),
      },
    },
  });
}

function createSalesMatchSnapshotContext(db, options = {}) {
  return salesMatchPromptContext(createCandidateSnapshot(db, {
    ...options,
    station: 'sales_match',
  }));
}

module.exports = {
  buildCandidates,
  createCandidateSnapshot,
  createSalesCandidateSnapshot: createCandidateSnapshot,
  createSalesMatchSnapshotContext,
  getCandidateSnapshot,
  getSalesCandidateSnapshot: getCandidateSnapshot,
  invalidateCandidateSnapshot,
  resolveCandidateEmployeeIds,
  salesMatchPromptContext,
};

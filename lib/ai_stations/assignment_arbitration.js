'use strict';

const { ROLE_PERMISSIONS } = require('../access_control');
const { effectivePermissionsFor } = require('../permission_groups');
const { resolveCandidateEmployeeIds } = require('./candidate_snapshots');

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_HIGH_VALUE_THRESHOLD = 90;

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function permissionsForUser(db, row) {
  if (tableExists(db, 'permission_groups') && tableExists(db, 'user_permission_overrides')
      && row.permission_group_id !== undefined) {
    try {
      return effectivePermissionsFor(db, row.id);
    } catch (_error) {
      // Legacy databases use role defaults plus permissions_json.
    }
  }
  return {
    ...(ROLE_PERMISSIONS[row.role] || {}),
    ...parseObject(row.permissions_json),
  };
}

function authorizedSalesUsers(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  return db.prepare("SELECT * FROM sales_users WHERE role='sales' AND active=1 ORDER BY name,id").all()
    .filter(row => permissionsForUser(db, row).view_intake);
}

function authorizedSalesUser(db, userId) {
  if (!db || typeof db.prepare !== 'function') throw new Error('database is required');
  const row = db.prepare("SELECT * FROM sales_users WHERE id=? AND role='sales' AND active=1")
    .get(String(userId || '').trim());
  return row && permissionsForUser(db, row).view_intake ? row : null;
}

function unavailable(reasonCode = 'ai_unavailable') {
  return Object.freeze({
    available: false,
    reasonCode,
    confidence: 0,
    reviewRequired: false,
    rankedCandidates: Object.freeze([]),
  });
}

function loadSalesMatchRecommendation(db, customerId, options = {}) {
  const requiredTables = [
    'crm_ai_station_results',
    'crm_ai_candidate_snapshots',
    'crm_ai_candidate_snapshot_items',
  ];
  if (requiredTables.some(name => !tableExists(db, name))) return unavailable();
  const row = db.prepare(`SELECT
      r.id result_id,r.job_id,r.value_json,r.confidence,r.review_required,
      s.id snapshot_id
    FROM crm_ai_station_results r
    JOIN crm_ai_candidate_snapshots s ON s.job_id=r.job_id
    WHERE r.customer_id=? AND r.station='sales_match' AND r.stale_at=''
    ORDER BY r.generated_at DESC,r.id DESC,s.created_at DESC LIMIT 1`).get(String(customerId || '').trim());
  if (!row) return unavailable();
  const value = parseObject(row.value_json);
  if (!Array.isArray(value.rankedCandidates)) return unavailable('ai_output_invalid');
  const tokens = value.rankedCandidates.map(candidate => candidate?.employeeId);
  let userIds;
  try {
    userIds = resolveCandidateEmployeeIds(db, row.snapshot_id, tokens, options);
  } catch (_error) {
    return unavailable('ai_snapshot_invalid');
  }
  return Object.freeze({
    available: true,
    reasonCode: '',
    resultId: row.result_id,
    jobId: row.job_id,
    snapshotId: row.snapshot_id,
    confidence: Number(row.confidence || value.confidence || 0),
    reviewRequired: Boolean(row.review_required),
    rankedCandidates: Object.freeze(userIds.map((userId, index) => Object.freeze({
      userId,
      score: Number(value.rankedCandidates[index]?.score || 0),
      reasons: Object.freeze(
        Array.isArray(value.rankedCandidates[index]?.reasons)
          ? value.rankedCandidates[index].reasons.map(reason => String(reason || '').trim()).filter(Boolean)
          : [],
      ),
    }))),
  });
}

function valueScore(candidate) {
  return Number(candidate?.match_score ?? candidate?.matchScore ?? candidate?.potential_value ?? 0) || 0;
}

function riskState(candidate, explicitBlocked) {
  const value = [
    candidate?.risk_level,
    candidate?.riskLevel,
    candidate?.risk_status,
    candidate?.riskStatus,
  ].filter(Boolean).join(' ');
  return {
    blocked: Boolean(explicitBlocked) || /blocked|sanction|制裁|军工|风险过高/i.test(value),
    elevated: /high|高风险/i.test(value),
  };
}

function decision(input) {
  return Object.freeze({
    disposition: input.disposition,
    assignable: input.disposition === 'assign',
    managerReview: input.disposition === 'manager_review',
    userId: input.userId || '',
    suggestedUserId: input.suggestedUserId || input.userId || '',
    deterministicUserId: input.deterministicUserId || '',
    aiUserId: input.aiUserId || '',
    source: input.source,
    reasonCode: input.reasonCode,
    reason: input.reason,
    aiConfidence: Number(input.aiConfidence || 0),
  });
}

function arbitrateIntakeOwner(input = {}) {
  const candidate = input.candidate || {};
  const deterministic = input.deterministicMatch || null;
  const recommendation = input.recommendation || unavailable();
  const eligibleUserIds = new Set((input.users || []).map(user => String(user.id || '')).filter(Boolean));
  const deterministicUserId = String(deterministic?.userId || '');
  const aiUserId = String(recommendation.rankedCandidates?.[0]?.userId || '');
  const highValueThreshold = Number(input.highValueThreshold ?? DEFAULT_HIGH_VALUE_THRESHOLD);
  const confidenceThreshold = Number(input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD);
  const highValue = valueScore(candidate) >= highValueThreshold;
  const risk = riskState(candidate, input.riskBlocked);
  const crossTeam = Boolean(input.crossTeam || candidate.cross_team || candidate.crossTeam);

  if (input.duplicate) {
    return decision({
      disposition: 'blocked',
      source: 'deterministic_rules',
      reasonCode: 'duplicate_customer',
      reason: '客户已在 CRM，规则阻止重复分配',
    });
  }
  if (!deterministicUserId) {
    return decision({
      disposition: 'blocked',
      source: 'deterministic_rules',
      reasonCode: 'no_eligible_sales',
      reason: '当前没有满足权限、配额和状态规则的销售',
    });
  }
  if (risk.blocked) {
    return decision({
      disposition: 'manager_review',
      suggestedUserId: deterministicUserId,
      deterministicUserId,
      aiUserId,
      source: 'deterministic_rules',
      reasonCode: 'risk_blocked',
      reason: '风险规则要求经理审批，AI 排名不能越过阻断',
      aiConfidence: recommendation.confidence,
    });
  }
  if (!recommendation.available) {
    if (highValue || risk.elevated || crossTeam) {
      return decision({
        disposition: 'manager_review',
        suggestedUserId: deterministicUserId,
        deterministicUserId,
        source: 'deterministic_fallback',
        reasonCode: highValue ? 'high_value_review' : risk.elevated ? 'elevated_risk_review' : 'cross_team_review',
        reason: highValue ? '高价值客户需要经理审批' : risk.elevated ? '高风险客户需要经理审批' : '跨团队分配需要经理审批',
      });
    }
    return decision({
      disposition: 'assign',
      userId: deterministicUserId,
      deterministicUserId,
      source: 'deterministic_fallback',
      reasonCode: recommendation.reasonCode || 'ai_unavailable',
      reason: deterministic.reason || 'AI 不可用，沿用确定性匹配',
    });
  }
  if (!eligibleUserIds.has(aiUserId)) {
    return decision({
      disposition: 'manager_review',
      suggestedUserId: deterministicUserId,
      deterministicUserId,
      aiUserId,
      source: 'rule_conflict',
      reasonCode: 'ai_candidate_ineligible',
      reason: 'AI 首选销售已不满足权限、状态或配额规则',
      aiConfidence: recommendation.confidence,
    });
  }
  if (recommendation.reviewRequired || recommendation.confidence < confidenceThreshold) {
    return decision({
      disposition: 'manager_review',
      suggestedUserId: aiUserId,
      deterministicUserId,
      aiUserId,
      source: 'ai_recommendation',
      reasonCode: 'low_confidence_review',
      reason: 'AI 置信度不足，需要经理审批',
      aiConfidence: recommendation.confidence,
    });
  }
  if (highValue || risk.elevated || crossTeam) {
    return decision({
      disposition: 'manager_review',
      suggestedUserId: aiUserId,
      deterministicUserId,
      aiUserId,
      source: 'deterministic_rules',
      reasonCode: highValue ? 'high_value_review' : risk.elevated ? 'elevated_risk_review' : 'cross_team_review',
      reason: highValue ? '高价值客户需要经理审批' : risk.elevated ? '高风险客户需要经理审批' : '跨团队分配需要经理审批',
      aiConfidence: recommendation.confidence,
    });
  }
  if (aiUserId !== deterministicUserId) {
    return decision({
      disposition: 'manager_review',
      suggestedUserId: aiUserId,
      deterministicUserId,
      aiUserId,
      source: 'rule_conflict',
      reasonCode: 'ranking_rule_conflict',
      reason: 'AI 排名与确定性规则结果冲突，需要经理审批',
      aiConfidence: recommendation.confidence,
    });
  }
  return decision({
    disposition: 'assign',
    userId: deterministicUserId,
    deterministicUserId,
    aiUserId,
    source: 'ai_confirmed',
    reasonCode: 'ai_rule_agreement',
    reason: deterministic.reason || 'AI 排名与确定性规则一致',
    aiConfidence: recommendation.confidence,
  });
}

module.exports = {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_HIGH_VALUE_THRESHOLD,
  arbitrateIntakeOwner,
  authorizedSalesUser,
  authorizedSalesUsers,
  loadSalesMatchRecommendation,
};

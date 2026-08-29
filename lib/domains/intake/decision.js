'use strict';

// Intake arbitration decision projections. These collapse rule and AI results
// into the stable DTO shape and strip AI influence markers before they reach
// sales-facing payloads.

function serializeArbitrationDecision(decision = {}) {
  return {
    disposition: decision.disposition || '',
    assignable: Boolean(decision.assignable),
    managerReview: Boolean(decision.managerReview),
    userId: decision.userId || '',
    suggestedUserId: decision.suggestedUserId || '',
    deterministicUserId: decision.deterministicUserId || '',
    aiUserId: decision.aiUserId || '',
    source: decision.source || '',
    reasonCode: decision.reasonCode || '',
    reason: decision.reason || '',
    aiConfidence: Number(decision.aiConfidence || 0),
  };
}

function withoutArbitrationAI(decision = {}, fallbackReason = '') {
  const disposition = String(decision.disposition || '');
  const source = String(decision.source || '');
  const reasonCode = String(decision.reasonCode || '');
  const reason = String(decision.reason || fallbackReason || '');
  const aiInfluenced = /ai|ranking/i.test(`${source} ${reasonCode} ${reason}`);
  const safeReason = {
    blocked: '规则阻止当前自动分配',
    manager_review: '当前记录需要人工复核',
    assign: '按确定性规则与当前负荷分配',
  }[disposition] || '等待规则与人工确认';
  const deterministicUserId = String(decision.deterministicUserId || decision.userId || '');
  return {
    disposition,
    assignable: Boolean(decision.assignable),
    managerReview: Boolean(decision.managerReview),
    userId: deterministicUserId,
    suggestedUserId: deterministicUserId,
    deterministicUserId,
    source: aiInfluenced ? 'deterministic_rules' : source,
    reasonCode: aiInfluenced ? (disposition === 'manager_review' ? 'manual_review_required' : 'deterministic_fallback') : reasonCode,
    reason: aiInfluenced ? safeReason : (reason || safeReason),
  };
}

function serializeRecommendation(recommendation = {}) {
  return {
    available: Boolean(recommendation.available),
    reasonCode: recommendation.reasonCode || '',
    resultId: recommendation.resultId || '',
    jobId: recommendation.jobId || '',
    snapshotId: recommendation.snapshotId || '',
    confidence: Number(recommendation.confidence || 0),
    reviewRequired: Boolean(recommendation.reviewRequired),
    rankedCandidates: Array.isArray(recommendation.rankedCandidates)
      ? recommendation.rankedCandidates.map(candidate => ({
        userId: candidate.userId || '',
        score: Number(candidate.score || 0),
        reasons: Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 8) : [],
      }))
      : [],
  };
}

module.exports = Object.freeze({
  serializeArbitrationDecision,
  withoutArbitrationAI,
  serializeRecommendation,
});

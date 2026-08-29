'use strict';

// Manager evaluation projections. Rows normalize to the DTO shape and the
// without* helpers strip AI-authored fields before sales-facing rendering.

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function normalizeEvaluation(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    subjectTitle: row.subject_title,
    evaluationText: row.evaluation_text,
    authorId: row.author_id,
    authorName: row.author_name,
    aiStatus: row.ai_status,
    aiSummary: row.ai_summary,
    aiLabels: json(row.ai_labels_json),
    aiOrderKeys: json(row.ai_order_keys_json),
    aiRisks: json(row.ai_risks_json),
    aiStrategy: row.ai_strategy,
    aiModel: row.ai_model,
    aiError: row.ai_error,
    aiGeneratedAt: row.ai_generated_at,
    createdAt: row.created_at,
  };
}

function withoutEvaluationAI(evaluation) {
  if (!evaluation) return evaluation;
  const {
    aiStatus,
    aiSummary,
    aiLabels,
    aiOrderKeys,
    aiRisks,
    aiStrategy,
    aiModel,
    aiError,
    aiGeneratedAt,
    ...manualEvaluation
  } = evaluation;
  return manualEvaluation;
}

function withoutEvaluationAIRow(evaluation) {
  if (!evaluation) return evaluation;
  return Object.fromEntries(
    Object.entries(evaluation).filter(([key]) => !key.startsWith('ai_')),
  );
}

function aiFeatureDisabled() {
  const error = new Error('AI feature is disabled');
  error.statusCode = 409;
  error.code = 'AI_FEATURE_DISABLED';
  return error;
}

module.exports = Object.freeze({
  normalizeEvaluation,
  withoutEvaluationAI,
  withoutEvaluationAIRow,
  aiFeatureDisabled,
});

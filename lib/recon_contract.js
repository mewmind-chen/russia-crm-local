const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ENUMS = {
  website: new Set(['verified', 'unverified', 'unreachable', 'blocked', 'missing', 'needs_review']),
  sanction: new Set(['clear', 'possible_match', 'confirmed_match', 'unknown', 'error']),
  review: new Set(['pending', 'confirmed', 'rejected', 'not_required']),
  quality: new Set(['complete', 'partial', 'needs_review', 'invalid']),
};

function isIsoDate(value) {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function validateReconV3(value, expected = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['result_v3必须是对象'];
  if (value.schema_version !== '3.0') errors.push('schema_version必须为3.0');
  if (!value.job_id) errors.push('缺少job_id');
  if (!value.customer_id) errors.push('缺少customer_id');
  if (expected.jobId && value.job_id !== expected.jobId) errors.push('result_v3.job_id与任务不一致');
  if (expected.customerId && value.customer_id !== expected.customerId) errors.push('result_v3.customer_id与任务不一致');
  if (!isIsoDate(value.generated_at)) errors.push('generated_at必须是ISO日期');
  if (!value.company || typeof value.company !== 'object') errors.push('缺少company');
  if (!Array.isArray(value.contacts)) errors.push('contacts必须是数组');
  if (!value.website_check || !ENUMS.website.has(value.website_check.status)) errors.push('website_check.status非法');
  if (!value.sanction_check || !ENUMS.sanction.has(value.sanction_check.result)) errors.push('sanction_check.result非法');
  if (!value.sanction_check || !ENUMS.review.has(value.sanction_check.review_status)) errors.push('sanction_check.review_status非法');
  if (!value.quality || !ENUMS.quality.has(value.quality.status)) errors.push('quality.status非法');
  if (!Number.isInteger(value.quality?.score) || value.quality.score < 0 || value.quality.score > 100) errors.push('quality.score必须为0-100整数');
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) errors.push('evidence必须是非空数组');
  (value.contacts || []).forEach((contact, ci) => {
    (contact.methods || []).forEach((method, mi) => {
      if (method.type === 'email' && method.value && !EMAIL_RE.test(method.value)) errors.push(`contacts[${ci}].methods[${mi}]邮箱格式非法`);
    });
  });
  (value.evidence || []).forEach((item, index) => {
    if (!item || !item.field_name) errors.push(`evidence[${index}]缺少field_name`);
    if (!item || typeof item.source_url !== 'string') errors.push(`evidence[${index}].source_url必须是字符串`);
  });
  if (value.sanction_check?.result === 'confirmed_match' && !(value.sanction_check.matches || []).length) {
    errors.push('confirmed_match必须包含matches');
  }
  return errors;
}

function evidenceMetrics(evidence = []) {
  const valid = evidence.filter(item => item && item.field_name);
  const selected = valid.filter(item => item.selected_for_report === true);
  const urls = new Set(valid.map(item => String(item.source_url || '').trim()).filter(Boolean));
  return { total: valid.length, selected: selected.length, uniqueSources: urls.size };
}

module.exports = { validateReconV3, evidenceMetrics };

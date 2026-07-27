'use strict';

const {
  STAGES,
  STAGE_LABELS,
  isValidStage,
  isActivePipelineStage,
  hasReachedStage,
} = require('./customer_stages');

function list(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap(item => String(item || '').split(','))
    .map(item => item.trim()).filter(Boolean))];
}

function truthy(value) {
  return value === true || value === 1 || ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function addMultiFilter(filters, params, column, values, options = {}) {
  const selected = list(values);
  if (!selected.length) return;
  const regular = selected.filter(value => value !== options.emptyValue);
  const clauses = [];
  if (regular.length) {
    clauses.push(`${column} IN (${regular.map(() => '?').join(',')})`);
    params.push(...regular);
  }
  if (selected.includes(options.emptyValue)) clauses.push(`COALESCE(${column},'')=''`);
  filters.push(`(${clauses.join(' OR ')})`);
}

function buildCustomerQuery(query, {
  user,
  canViewContacts = false,
  now = new Date(),
} = {}) {
  const filters = [];
  const params = [];
  const nowText = now.toISOString().slice(0, 19).replace('T', ' ');
  const today = nowText.slice(0, 10);
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowText = tomorrow.toISOString().slice(0, 10);

  const keywords = String(query.search || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  for (const keyword of keywords) {
    const like = `%${escapeLike(keyword)}%`;
    const clauses = [
      'crm_search_fold(COALESCE(NULLIF(p.company_name,\'\'),a.company_name)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.id) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.external_customer_id) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.country,\'\'),a.country)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.city,\'\'),a.city)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.website,\'\'),a.website)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.industry,\'\'),a.industry)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.products,\'\'),a.product_focus)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(COALESCE(NULLIF(p.customer_type,\'\'),a.customer_type)) LIKE ? ESCAPE \'\\\'',
      'crm_search_fold(a.source) LIKE ? ESCAPE \'\\\'',
      `EXISTS (SELECT 1 FROM crm_manager_evaluations e
        WHERE e.customer_id=a.id AND (crm_search_fold(e.evaluation_text) LIKE ? ESCAPE '\\'
          OR crm_search_fold(e.ai_labels_json) LIKE ? ESCAPE '\\'))`,
    ];
    params.push(...Array(12).fill(like));
    if (canViewContacts) {
      clauses.push(`EXISTS (SELECT 1 FROM crm_account_contacts c
        WHERE c.customer_id=a.id AND (crm_search_fold(c.name) LIKE ? ESCAPE '\\'
          OR crm_search_fold(c.title) LIKE ? ESCAPE '\\' OR crm_search_fold(c.phone) LIKE ? ESCAPE '\\'
          OR crm_search_fold(c.email) LIKE ? ESCAPE '\\'))`);
      params.push(...Array(4).fill(like));
    }
    filters.push(`(${clauses.join(' OR ')})`);
  }

  addMultiFilter(filters, params, "COALESCE(NULLIF(p.country,''),a.country)", query.countries ?? query.country);
  addMultiFilter(filters, params, 'a.owner_id', query.owners ?? query.owner, { emptyValue: '__unassigned__' });
  addMultiFilter(filters, params, 'a.stage', query.stages ?? query.stage);
  addMultiFilter(filters, params, 'a.priority', query.priorities ?? query.priority);
  addMultiFilter(filters, params, "COALESCE(NULLIF(p.customer_type,''),a.customer_type)", query.customerTypes);
  addMultiFilter(filters, params, "COALESCE(NULLIF(p.industry,''),a.industry)", query.industries);
  addMultiFilter(filters, params, 'a.source', query.sources);
  addMultiFilter(filters, params, 'a.created_by', query.creators);

  const evaluationTags = list(query.evaluationTags ?? query.evaluationTag);
  if (evaluationTags.length) {
    const clauses = evaluationTags.map(() => `EXISTS (SELECT 1 FROM crm_manager_evaluations e
      WHERE e.customer_id=a.id AND e.ai_labels_json LIKE ? ESCAPE '\\')`);
    filters.push(`(${clauses.join(' OR ')})`);
    params.push(...evaluationTags.map(tag => `%${escapeLike(tag)}%`));
  }

  const quickView = String(query.quickView || 'all');
  if (quickView === 'mine') {
    filters.push('a.owner_id=?');
    params.push(user?.id || '');
  } else if (quickView === 'unassigned') {
    filters.push("COALESCE(a.owner_id,'')=''");
  } else if (quickView === 'today') {
    filters.push("a.next_action_at>=? AND a.next_action_at<?");
    params.push(`${today} 00:00:00`, `${tomorrowText} 00:00:00`);
  } else if (quickView === 'overdue') {
    filters.push("a.next_action_at!='' AND a.next_action_at<?");
    params.push(nowText);
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  } else if (quickView === 'no_next') {
    filters.push("COALESCE(a.next_action,'')=''");
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  } else if (quickView === 'disqualified') {
    filters.push("a.stage='disqualified'");
  }

  if (truthy(query.onlyOverdue) && quickView !== 'overdue') {
    filters.push("a.next_action_at!='' AND a.next_action_at<?");
    params.push(nowText);
    filters.push(`a.stage IN (${STAGES.filter(([key]) => isActivePipelineStage(key)).map(() => '?').join(',')})`);
    params.push(...STAGES.filter(([key]) => isActivePipelineStage(key)).map(([key]) => key));
  }

  const reached = String(query.stageReached || '');
  if (reached && isValidStage(reached)) {
    const reachedStages = STAGES.map(([key]) => key).filter(stage => hasReachedStage(stage, reached));
    filters.push(reachedStages.length ? `a.stage IN (${reachedStages.map(() => '?').join(',')})` : '0=1');
    params.push(...reachedStages);
  }

  const lastActions = list(query.lastActionBuckets);
  if (lastActions.length) {
    const clauses = [];
    for (const bucket of lastActions) {
      if (bucket === 'none') clauses.push("COALESCE(a.last_activity_at,'')=''");
      if (bucket === 'today') { clauses.push('a.last_activity_at>=?'); params.push(`${today} 00:00:00`); }
      if (bucket === '7d') { clauses.push('a.last_activity_at>=datetime(?,"-7 days")'); params.push(nowText); }
      if (bucket === '30d') { clauses.push('a.last_activity_at>=datetime(?,"-30 days")'); params.push(nowText); }
      if (bucket === 'older') { clauses.push("a.last_activity_at!='' AND a.last_activity_at<datetime(?,'-30 days')"); params.push(nowText); }
    }
    if (clauses.length) filters.push(`(${clauses.join(' OR ')})`);
  }

  const nextSteps = list(query.nextStepBuckets);
  if (nextSteps.length) {
    const clauses = [];
    for (const bucket of nextSteps) {
      if (bucket === 'none') clauses.push("COALESCE(a.next_action,'')=''");
      if (bucket === 'overdue') { clauses.push("a.next_action_at!='' AND a.next_action_at<?"); params.push(nowText); }
      if (bucket === 'today') { clauses.push('a.next_action_at>=? AND a.next_action_at<?'); params.push(`${today} 00:00:00`, `${tomorrowText} 00:00:00`); }
      if (bucket === '7d') { clauses.push('a.next_action_at>=? AND a.next_action_at<datetime(?,"+7 days")'); params.push(`${tomorrowText} 00:00:00`, nowText); }
      if (bucket === 'later') { clauses.push('a.next_action_at>=datetime(?,"+7 days")'); params.push(nowText); }
    }
    if (clauses.length) filters.push(`(${clauses.join(' OR ')})`);
  }

  if (query.createdFrom) { filters.push('a.created_at>=?'); params.push(`${query.createdFrom} 00:00:00`); }
  if (query.createdTo) {
    const end = new Date(`${query.createdTo}T00:00:00Z`);
    if (!Number.isNaN(end.getTime())) {
      end.setUTCDate(end.getUTCDate() + 1);
      filters.push('a.created_at<?');
      params.push(`${end.toISOString().slice(0, 10)} 00:00:00`);
    }
  }

  const orderBy = {
    next_urgent: "CASE WHEN a.next_action_at='' THEN 1 ELSE 0 END,a.next_action_at ASC,a.id ASC",
    last_activity: "CASE WHEN a.last_activity_at='' THEN 1 ELSE 0 END,a.last_activity_at DESC,a.id ASC",
    newest: 'a.created_at DESC,a.id ASC',
    potential_desc: 'a.potential_value DESC,a.id ASC',
    company: 'a.company_name COLLATE NOCASE ASC,a.id ASC',
  }[String(query.sort || '')] || 'a.id ASC';

  return { filters, params, orderBy };
}

function addStageLabels(customers) {
  return customers.map(row => ({ ...row, stageLabel: STAGE_LABELS[row.stage] || row.stage }));
}

module.exports = {
  list,
  buildCustomerQuery,
  addStageLabels,
};

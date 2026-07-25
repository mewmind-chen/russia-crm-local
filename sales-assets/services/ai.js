function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload ?? {}) };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

export function createAIService(api) {
  const post = (url, payload, options = {}) =>
    api(url, { ...jsonOptions('POST', payload), ...options });

  return {
    chat(payload, options = {}) {
      return post('/api/assistant/chat', payload, options);
    },
    customerResults(customerId, options = {}) {
      return api(`/api/sales-crm/ai/customers/${encode(customerId)}/results`, options);
    },
    customerEnrichment(customerId, options = {}) {
      return api(`/api/sales-crm/ai/customers/${encode(customerId)}/enrichment`, options);
    },
    runCustomerEnrichment(customerId, payload, options = {}) {
      return post(`/api/sales-crm/ai/customers/${encode(customerId)}/enrichment/run`, payload, options);
    },
    cancelEnrichment(runId, payload, options = {}) {
      return post(`/api/sales-crm/ai/enrichment/${encode(runId)}/cancel`, payload, options);
    },
    reviewProposal(proposalId, payload, options = {}) {
      return post(`/api/sales-crm/ai/proposals/${encode(proposalId)}/review`, payload, options);
    },
    runCustomerFit(customerId, options = {}) {
      return post(`/api/sales-crm/ai/customers/${encode(customerId)}/stations/customer_fit/run`, {}, options);
    },
    runSalesPack(customerId, options = {}) {
      return post(`/api/sales-crm/ai/customers/${encode(customerId)}/stations/sales_pack/run`, {}, options);
    },
    createActionProposal(customerId, payload, options = {}) {
      return post(`/api/sales-crm/ai/customers/${encode(customerId)}/action-proposals`, payload, options);
    },
    listTasks(query, options = {}) {
      return api(`/api/sales-crm/ai/tasks${queryString(query)}`, options);
    },
    getTask(taskId, options = {}) {
      return api(`/api/sales-crm/ai/tasks/${encode(taskId)}`, options);
    },
    retryJob(jobId, options = {}) {
      return post(`/api/sales-crm/ai/jobs/${encode(jobId)}/retry`, {}, options);
    },
    jobAction(jobId, action, payload, options = {}) {
      return post(`/api/sales-crm/ai/jobs/${encode(jobId)}/${encode(action)}`, payload, options);
    },
    adoptNextAction(jobId, payload, options = {}) {
      return post(`/api/sales-crm/ai/jobs/${encode(jobId)}/next-action/adopt`, payload, options);
    },
    submitFeedback(jobId, payload, options = {}) {
      return post(`/api/sales-crm/ai/jobs/${encode(jobId)}/feedback`, payload, options);
    },
    governance(options = {}) {
      return api('/api/sales-crm/ai/governance', options);
    },
    createStrategy(payload, options = {}) {
      return post('/api/sales-crm/ai/governance/strategies', payload, options);
    },
    evaluateStrategy(strategyId, payload, options = {}) {
      return post(`/api/sales-crm/ai/governance/strategies/${encode(strategyId)}/evaluations`, payload, options);
    },
    strategyAction(strategyId, action, payload, options = {}) {
      return post(`/api/sales-crm/ai/governance/strategies/${encode(strategyId)}/${encode(action)}`, payload, options);
    },
    managerAnomalies(options = {}) {
      return api('/api/sales-crm/ai/manager-anomalies', options);
    },
    runManagerAnomalies(payload, options = {}) {
      return post('/api/sales-crm/ai/manager-anomalies/run', payload, options);
    },
    salesCoaching(options = {}) {
      return api('/api/sales-crm/ai/sales-coaching', options);
    },
    runSalesCoaching(userId, payload, options = {}) {
      return post(`/api/sales-crm/ai/sales-coaching/${encode(userId)}/run`, payload, options);
    },
    features(options = {}) {
      return api('/api/sales-crm/ai/features', options);
    },
    updateFeature(key, payload, options = {}) {
      return api(`/api/sales-crm/ai/features/${encode(key)}`, {
        ...jsonOptions('PATCH', payload),
        ...options,
      });
    },
  };
}

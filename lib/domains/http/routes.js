'use strict';

// Anonymous request route normalization. Path segments are collapsed into
// :param templates so timing and access logs group like routes together.

function anonymousSalesRoute(method, requestPath) {
  let route = String(requestPath || '').split('?')[0].replace(/^\/api\/sales-crm/, '') || '/';
  route = route.replace(/^\/accounts\/bulk-assign$/, '/accounts/bulk-assign')
    .replace(/^\/accounts\/recycle-bin$/, '/accounts/recycle-bin')
    .replace(/^\/accounts\/[^/]+\/recycle-profile$/, '/accounts/:customerId/recycle-profile')
    .replace(/^\/accounts\/bulk-return$/, '/accounts/bulk-return')
    .replace(/^\/accounts\/[^/]+\/return$/, '/accounts/:customerId/return')
    .replace(/^\/accounts\/[^/]+\/trash$/, '/accounts/:customerId/trash')
    .replace(/^\/accounts\/[^/]+\/restore$/, '/accounts/:customerId/restore')
    .replace(/^\/accounts\/[^/]+\/reassign$/, '/accounts/:customerId/reassign')
    .replace(/^\/duplicate-reviews\/[^/]+\/candidates$/, '/duplicate-reviews/:reviewId/candidates')
    .replace(/^\/duplicate-reviews\/[^/]+\/candidate$/, '/duplicate-reviews/:reviewId/candidate')
    .replace(/^\/duplicate-reviews\/[^/]+\/resolve$/, '/duplicate-reviews/:reviewId/resolve')
    .replace(/^\/protected-customer-conflicts\/[^/]+\/resolve$/, '/protected-customer-conflicts/:conflictId/resolve')
    .replace(/^\/protected-customer-conflicts\/[^/]+\/supplement$/, '/protected-customer-conflicts/:conflictId/supplement')
    .replace(/^\/protected-customers\/batches\/[^/]+\/commit$/, '/protected-customers/batches/:batchId/commit')
    .replace(/^\/protected-customers\/batches\/[^/]+\/rollback$/, '/protected-customers/batches/:batchId/rollback')
    .replace(/^\/protected-customers\/[^/]+\/activate$/, '/protected-customers/:externalCustomerId/activate')
    .replace(/^\/protected-customers\/(?!template$|export$)[^/]+$/, '/protected-customers/:externalCustomerId')
    .replace(/^\/notifications\/[^/]+\/read$/, '/notifications/:notificationId/read')
    .replace(/^\/intake\/[^/]+\/profile$/, '/intake/:itemId/profile')
    .replace(/^\/master\/[^/]+$/, '/master/:customerId')
    .replace(/^\/profile\/[^/]+\/tag-history$/, '/profile/:customerId/tag-history')
    .replace(/^\/filter-schema\/[^/]+$/, '/filter-schema/:pageKey')
    .replace(/^\/field-schema\/[^/]+$/, '/field-schema/:pageKey')
    .replace(/^\/accounts\/[^/]+$/, '/accounts/:customerId')
    .replace(/^\/profile\/[^/]+$/, '/profile/:customerId')
    .replace(/^\/activity-correction-proposals\/[^/]+\/review$/, '/activity-correction-proposals/:proposalId/review')
    .replace(/^\/activity-reactions\/(?!admin$|order$)[^/]+$/, '/activity-reactions/:reactionId')
    .replace(/^\/collaboration-support\/[^/]+\/(supplements|corrections|revocations)$/, '/collaboration-support/:eventId/$1')
    .replace(/^\/permission-groups\/[^/]+$/, '/permission-groups/:groupId')
    .replace(/^\/users\/[^/]+\/password-reset$/, '/users/:userId/password-reset')
    .replace(/^\/users\/[^/]+\/archive$/, '/users/:userId/archive')
    .replace(/^\/users\/[^/]+\/restore$/, '/users/:userId/restore')
    .replace(/^\/users\/[^/]+\/permission-overrides$/, '/users/:userId/permission-overrides')
    .replace(/^\/filter-permissions\/groups\/[^/]+$/, '/filter-permissions/groups/:groupId')
    .replace(/^\/filter-permissions\/users\/[^/]+$/, '/filter-permissions/users/:userId')
    .replace(/^\/filter-permissions\/definitions\/[^/]+$/, '/filter-permissions/definitions/:filterKey')
    .replace(/^\/users\/[^/]+$/, '/users/:userId')
    .replace(/^\/migration-review\/[^/]+$/, '/migration-review/:reviewId')
    .replace(/^\/evaluations\/[^/]+\/retry$/, '/evaluations/:evaluationId/retry')
    .replace(/^\/ai\/customers\/[^/]+\/results$/, '/ai/customers/:customerId/results')
    .replace(/^\/ai\/customers\/[^/]+\/enrichment$/, '/ai/customers/:customerId/enrichment')
    .replace(/^\/ai\/customers\/[^/]+\/enrichment\/run$/, '/ai/customers/:customerId/enrichment/run')
    .replace(/^\/ai\/customers\/[^/]+\/stations\/customer_fit\/run$/, '/ai/customers/:customerId/stations/customer_fit/run')
    .replace(/^\/ai\/customers\/[^/]+\/stations\/sales_pack\/run$/, '/ai/customers/:customerId/stations/sales_pack/run')
    .replace(/^\/ai\/customers\/[^/]+\/action-proposals$/, '/ai/customers/:customerId/action-proposals')
    .replace(/^\/ai\/features\/[^/]+$/, '/ai/features/:featureKey')
    .replace(/^\/ai\/tasks\/[^/]+$/, '/ai/tasks/:taskId')
    .replace(/^\/ai\/jobs\/[^/]+\/retry$/, '/ai/jobs/:jobId/retry')
    .replace(/^\/ai\/jobs\/[^/]+\/cancel$/, '/ai/jobs/:jobId/cancel')
    .replace(/^\/ai\/jobs\/[^/]+\/review$/, '/ai/jobs/:jobId/review')
    .replace(/^\/ai\/enrichment\/[^/]+\/cancel$/, '/ai/enrichment/:runId/cancel')
    .replace(/^\/ai\/proposals\/[^/]+\/review$/, '/ai/proposals/:proposalId/review')
    .replace(/^\/ai\/budgets\/[^/]+\/[^/]+$/, '/ai/budgets/:scopeType/:scopeId');
  return `${String(method || '').toUpperCase()} ${route}`;
}

module.exports = Object.freeze({
  anonymousSalesRoute,
});
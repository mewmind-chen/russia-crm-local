'use strict';

function createIdentityMiddleware({
  openDb,
  getSession,
  buildAccessContext,
}) {
  if (typeof openDb !== 'function') throw new TypeError('openDb is required');
  if (typeof getSession !== 'function') throw new TypeError('getSession is required');
  if (typeof buildAccessContext !== 'function') throw new TypeError('buildAccessContext is required');

  const authenticate = (req, res, next, { unifiedErrorCode }) => {
    const session = getSession(req);
    if (!session) {
      const body = { ok: false, error: '请先登录' };
      if (!unifiedErrorCode) body.code = 'AUTH_REQUIRED';
      return res.status(401).json(body);
    }
    if (session.ended) {
      return res.status(409).json({
        ok: false,
        error: '身份检查已结束，请刷新页面',
        code: 'IMPERSONATION_ENDED',
      });
    }
    const user = session.effectiveUser;
    req.realUser = session.realUser;
    req.salesUser = user;
    req.impersonation = session.impersonation;
    req.sessionTokenHash = session.tokenHash;
    const value = openDb();
    try {
      req.accessContext = buildAccessContext(value, user);
    } finally {
      value.close();
    }
    return next();
  };

  return Object.freeze({
    requireSalesUser: (req, res, next) => authenticate(req, res, next, { unifiedErrorCode: false }),
    requireUnifiedUser: (req, res, next) => authenticate(req, res, next, { unifiedErrorCode: true }),
  });
}

module.exports = { createIdentityMiddleware };

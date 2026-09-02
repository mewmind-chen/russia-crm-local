'use strict';

const crypto = require('node:crypto');

/**
 * Register the sales session endpoints without moving authentication policy or
 * persistence out of their existing services.  The registrar owns only the
 * HTTP adapter and keeps the login-attempt window local to one app instance.
 */
function registerSalesAuthRoutes(app, {
  openDb,
  hashPassword,
  hydrateUserPermissions,
  safeUser,
  parseCookies,
  nowText,
  logRequestTiming,
} = {}) {
  if (!app) return app;
  const db = typeof openDb === 'function' ? openDb : () => { throw new Error('sales auth db unavailable'); };
  const hash = typeof hashPassword === 'function' ? hashPassword : () => { throw new Error('sales auth password helper unavailable'); };
  const hydrate = typeof hydrateUserPermissions === 'function'
    ? hydrateUserPermissions
    : () => { throw new Error('sales auth user helper unavailable'); };
  const publicUser = typeof safeUser === 'function' ? safeUser : user => user;
  const cookies = typeof parseCookies === 'function' ? parseCookies : () => ({});
  const clock = typeof nowText === 'function' ? nowText : () => new Date().toISOString();
  const timing = typeof logRequestTiming === 'function' ? logRequestTiming : () => {};
  const loginAttempts = new Map();

  app.post('/api/sales-auth/login', (req, res) => {
    const startedAt = process.hrtime.bigint();
    timing('sales-auth/login', req, res, startedAt, () => ({ authenticated: res.statusCode < 400 }));
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const attemptKey = `${req.socket.remoteAddress || ''}:${email}`;
    const attempt = loginAttempts.get(attemptKey) || { count: 0, resetAt: 0 };
    if (attempt.resetAt > Date.now() && attempt.count >= 8) {
      return res.status(429).json({ ok: false, error: '登录尝试过多，请15分钟后再试' });
    }
    if (attempt.resetAt <= Date.now()) {
      attempt.count = 0;
      attempt.resetAt = Date.now() + 15 * 60000;
    }
    const value = db();
    try {
      const row = value.prepare('SELECT * FROM sales_users WHERE email=? AND active=1').get(email);
      if (!row) {
        attempt.count += 1;
        loginAttempts.set(attemptKey, attempt);
        return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
      }
      const candidate = hash(password, row.password_salt).hash;
      const a = Buffer.from(candidate, 'hex');
      const b = Buffer.from(row.password_hash, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        attempt.count += 1;
        loginAttempts.set(attemptKey, attempt);
        return res.status(401).json({ ok: false, error: '邮箱或密码错误' });
      }
      loginAttempts.delete(attemptKey);
      const user = hydrate(value, row);
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expires = clock(new Date(Date.now() + 7 * 86400000));
      value.prepare('DELETE FROM sales_sessions WHERE expires_at<=?').run(clock());
      value.prepare('INSERT INTO sales_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
        .run(tokenHash, user.id, expires, clock());
      const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `sales_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
      res.json({ ok: true, user: publicUser(user) });
    } finally { value.close(); }
  });

  app.post('/api/sales-auth/logout', (req, res) => {
    const token = cookies(req.headers.cookie || '').sales_session || '';
    if (token) {
      const value = db();
      try {
        value.prepare('DELETE FROM sales_sessions WHERE token_hash=?')
          .run(crypto.createHash('sha256').update(token).digest('hex'));
      } finally { value.close(); }
    }
    res.setHeader('Set-Cookie', 'sales_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  return app;
}

module.exports = { registerSalesAuthRoutes };

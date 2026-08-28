'use strict';

const crypto = require('crypto');

// Idempotency fingerprint for manual customer creation. The idempotency key is
// intentionally excluded so a retry with the same payload and actor maps to the
// same request hash regardless of the client-generated key.
function customerCreateRequestHash(user, payload = {}) {
  const copy = { ...payload };
  delete copy.idempotencyKey;
  return crypto.createHash('sha256')
    .update(JSON.stringify({ actorId: user.id, payload: copy }))
    .digest('hex');
}

module.exports = Object.freeze({
  customerCreateRequestHash,
});

'use strict';

// Credential hashing. Passwords are scrypt-hashed with a per-user salt so no
// plaintext or quickly-reversible digest is ever stored.

const crypto = require('crypto');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

module.exports = Object.freeze({
  hashPassword,
});
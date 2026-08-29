'use strict';

// Session cookie parsing. The sales session token is read from the raw Cookie
// header, so it is split and URI-decoded independently of any framework.

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim().split('=').map(decodeURIComponent)).filter(pair => pair.length === 2));
}

module.exports = Object.freeze({
  parseCookies,
});
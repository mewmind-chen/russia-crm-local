'use strict';

// Customer profile normalization helpers extracted from sales_crm.js.
// Error construction is injected by call sites so the original badRequest
// semantics (status codes and messages) stay unchanged.

function defaultBadRequest(message) {
  return new Error(message);
}

function normalizeCountry(value) {
  const text = String(value || '').trim().toLowerCase();
  const map = {
    ru: '俄罗斯', russia: '俄罗斯', br: '巴西', brazil: '巴西', us: '美国', usa: '美国',
    de: '德国', germany: '德国', kz: '哈萨克斯坦', kazakhstan: '哈萨克斯坦',
  };
  return map[text] || String(value || '').trim();
}

function normalizeEstablishedYear(value, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const currentYear = options.now instanceof Date
    ? options.now.getFullYear()
    : new Date().getFullYear();
  const text = String(value ?? '').trim();
  if (!text) return null;
  const year = Number(text);
  if (!/^\d{4}$/.test(text) || !Number.isInteger(year) || year < 1000 || year > currentYear) {
    throw badRequest(`成立年份必须是1000年至${currentYear}之间的四位年份`);
  }
  return year;
}

function normalizeAccountNickname(input, options = {}) {
  const badRequest = options.badRequest || defaultBadRequest;
  const raw = String(input ?? '');
  if (raw === '') return '';
  const nickname = raw.trim();
  if (!nickname) throw badRequest('客户昵称不能只包含空白字符');
  if (/[\p{Cc}]/u.test(nickname)) throw badRequest('客户昵称不能包含控制字符');
  if (Array.from(nickname).length > 40) throw badRequest('客户昵称最多40个字符');
  return nickname;
}

module.exports = Object.freeze({
  normalizeCountry,
  normalizeEstablishedYear,
  normalizeAccountNickname,
});

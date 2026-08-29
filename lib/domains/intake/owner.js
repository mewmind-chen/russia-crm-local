'use strict';

// Deterministic intake owner selection used by the arbitration fallback.

const { normalizeCountry } = require('../customer/normalize');

function json(value, fallback = []) {
  try { return JSON.parse(value || 'null') ?? fallback; } catch (_e) { return fallback; }
}

function chooseIntakeOwner(candidate, users, loadByOwner = {}, dailyByOwner = {}, quota = 5) {
  const country = normalizeCountry(candidate.country);
  const methods = String(candidate.contact_methods || '').toLowerCase();
  const eligible = users.filter(user => user.role === 'sales' && user.active && Number(dailyByOwner[user.id] || 0) < quota);
  const scored = eligible.map(user => {
    const countries = json(user.countries_json).map(normalizeCountry);
    const languages = json(user.languages_json);
    const channels = json(user.channels_json).map(item => String(item).toLowerCase());
    let score = 30 - Math.min(25, Number(loadByOwner[user.id] || 0) * 2);
    const reasons = [];
    if (countries.includes(country)) { score += 45; reasons.push(`国家经验：${country}`); }
    if (country === '俄罗斯' && languages.some(item => String(item).includes('俄'))) { score += 20; reasons.push('俄语能力'); }
    if (country === '巴西' && languages.some(item => String(item).includes('葡'))) { score += 20; reasons.push('葡萄牙语能力'); }
    if (country === '墨西哥' && languages.some(item => String(item).includes('西'))) { score += 20; reasons.push('西班牙语能力'); }
    const matchedChannels = channels.filter(channel => channel && methods.includes(channel.toLowerCase()));
    if (matchedChannels.length) { score += 12; reasons.push(`渠道匹配：${matchedChannels[0]}`); }
    score += Math.max(0, 10 - Number(dailyByOwner[user.id] || 0) * 2);
    return { userId: user.id, score, reason: reasons.join('；') || '按当前负荷均衡分配' };
  }).sort((a, b) => b.score - a.score || Number(loadByOwner[a.userId] || 0) - Number(loadByOwner[b.userId] || 0) || a.userId.localeCompare(b.userId));
  return scored[0] || null;
}

module.exports = Object.freeze({
  chooseIntakeOwner,
});

require('dotenv').config();

const {
  getProspectTask,
  localProspectSearch,
  markProspectTaskFailed,
  markProspectTaskRunning,
  saveProspectTaskResults,
} = require('./db');

const DEFAULT_WEB_LIMIT = 8;
const WEB_TIMEOUT_MS = 12000;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortText(value, limit = 360) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_e) {
    return '';
  }
}

function websiteFromUrl(url) {
  const host = hostFromUrl(url);
  return host ? `https://${host}` : '';
}

function isDirectoryHost(host) {
  return [
    '2gis.', 'yell.', 'yellowpages.', 'kompass.', 'list-org.', 'rusprofile.',
    'saby.', 'vk.com', 'facebook.', 'linkedin.', 'wikipedia.', 'youtube.',
    'hh.ru', 'indeed.', 'glassdoor.',
  ].some(token => host.includes(token));
}

function prospectQuery(task) {
  const parts = [
    task.market || '俄罗斯',
    task.industryFocus,
    task.productFocus,
    task.query,
    'official site contacts procurement электронные компоненты производство контакты',
  ];
  return cleanText(parts.filter(Boolean).join(' '));
}

function scoreWebCandidate(row, task) {
  const text = [
    row.title, row.description, task.query, task.productFocus, task.industryFocus,
  ].join(' ').toLowerCase();
  const host = hostFromUrl(row.url);
  let score = isDirectoryHost(host) ? 38 : 54;
  ['контакты', 'contacts', 'производство', 'manufacturer', 'electronics', 'электрон', 'mcu', 'igbt', 'plc', 'датчик', '采购', '工控', '电子'].forEach(term => {
    if (text.includes(term.toLowerCase())) score += 5;
  });
  if (/\.(ru|su|рф)$/i.test(host)) score += 8;
  if (/contact|contacts|контакт/i.test(row.url || '')) score += 6;
  return Math.max(0, Math.min(100, score));
}

async function searchBrave(task) {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    return { ok: false, skipped: true, reason: 'BRAVE_SEARCH_API_KEY 未配置', results: [] };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
  const query = prospectQuery(task);
  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(DEFAULT_WEB_LIMIT));
    url.searchParams.set('country', 'ru');
    url.searchParams.set('search_lang', 'ru');
    url.searchParams.set('safesearch', 'off');
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_e) {
      return { ok: false, skipped: false, reason: `Brave 返回非 JSON：${text.slice(0, 120)}`, query, results: [] };
    }
    if (!response.ok) {
      return { ok: false, skipped: false, reason: data?.message || data?.error?.detail || `Brave HTTP ${response.status}`, query, results: [] };
    }
    const results = (data?.web?.results || []).slice(0, DEFAULT_WEB_LIMIT).map((item, index) => {
      const host = hostFromUrl(item.url || '');
      const directory = isDirectoryHost(host);
      const description = shortText(item.description || item.extra_snippets?.join(' ') || '', 420);
      return {
        existing_customer_id: '',
        company_name: cleanText(item.title || host).replace(/\s*[-|].*$/, ''),
        domain: directory ? '' : host,
        website: directory ? '' : websiteFromUrl(item.url || ''),
        country: task.market || '俄罗斯',
        city: '',
        industry: task.industryFocus || '',
        customer_type: directory ? '待确认' : '待确认',
        description,
        products: task.productFocus || '',
        need_signal: description,
        sell_signal: task.productFocus || '',
        contact_signal: /contact|contacts|контакт/i.test(`${item.url} ${item.title} ${description}`) ? '搜索结果含联系入口线索' : '',
        decision: directory ? '第三方来源线索，需找到独立官网后再入池' : '疑似官网候选，建议复核后入池或创建 Recon',
        score: scoreWebCandidate({ ...item, description }, task),
        source_summary: directory ? 'Brave 搜索命中第三方页面' : 'Brave 搜索命中疑似官网',
        sources: [{
          source_type: directory ? 'third_party_search' : 'web_search',
          title: cleanText(item.title || host),
          url: item.url || '',
          snippet: description,
          confidence: directory ? 'low' : 'medium',
        }],
        _rank: index + 1,
      };
    }).filter(item => item.company_name || item.website || item.sources[0].url);
    return { ok: true, skipped: false, query, results };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      reason: e.name === 'AbortError' ? 'Brave 搜索超时' : (e.message || String(e)),
      query,
      results: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeCandidates(groups) {
  const merged = new Map();
  groups.flat().forEach(item => {
    const key = cleanText(item.domain || hostFromUrl(item.website) || item.existing_customer_id || item.company_name).toLowerCase();
    if (!key) return;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, sources: Array.isArray(item.sources) ? item.sources.slice() : [] });
      return;
    }
    existing.score = Math.max(existing.score || 0, item.score || 0);
    existing.existing_customer_id = existing.existing_customer_id || item.existing_customer_id || '';
    existing.website = existing.website || item.website || '';
    existing.domain = existing.domain || item.domain || '';
    existing.company_name = existing.company_name || item.company_name || '';
    existing.description = existing.description || item.description || '';
    existing.products = existing.products || item.products || '';
    existing.need_signal = existing.need_signal || item.need_signal || '';
    existing.sell_signal = existing.sell_signal || item.sell_signal || '';
    existing.contact_signal = existing.contact_signal || item.contact_signal || '';
    existing.decision = existing.decision || item.decision || '';
    existing.source_summary = [existing.source_summary, item.source_summary].filter(Boolean).join(' / ');
    existing.sources.push(...(Array.isArray(item.sources) ? item.sources : []));
  });
  return Array.from(merged.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 80);
}

async function runProspectTask(taskId, options = {}) {
  const ownerId = String(options.ownerId || '').trim();
  const task = getProspectTask(taskId, ownerId);
  markProspectTaskRunning(taskId, ownerId);
  try {
    const local = localProspectSearch(task, options.accessContext || {}).map(item => ({
      ...item,
      source_summary: item.source_summary || '本地 CRM 命中',
    }));
    const web = await searchBrave(task);
    const candidates = mergeCandidates([local, web.results || []]);
    const sourceParts = [
      local.length ? `local:${local.length}` : '',
      web.ok ? `brave:${web.results.length}` : `brave:${web.reason || 'skipped'}`,
    ].filter(Boolean);
    return saveProspectTaskResults(taskId, candidates, {
      status: 'done',
      sourceMix: sourceParts.join(' / '),
      error: web.ok || web.skipped ? '' : web.reason,
    }, ownerId);
  } catch (e) {
    return markProspectTaskFailed(taskId, e.message || String(e), ownerId);
  }
}

module.exports = {
  runProspectTask,
  searchBrave,
};

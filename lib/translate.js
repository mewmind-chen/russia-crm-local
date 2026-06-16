const https = require('https');

function normalizeTargetLanguage(language) {
  const value = String(language || 'zh-CN').trim();
  return value.toLowerCase() === 'zh-cn' ? 'zh-CN' : value;
}

function requestJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'russia-crm-local/1.0',
      },
      timeout: timeoutMs,
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`translate http ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`translate returned non-JSON: ${e.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`translate timeout ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function translateText(text, options = {}) {
  const source = String(text || '').trim();
  if (!source) return { text: '' };

  const from = String(options.from || 'auto').trim() || 'auto';
  const to = normalizeTargetLanguage(options.to || 'zh-CN');
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', from);
  url.searchParams.set('tl', to);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', source);

  const data = await requestJson(url, timeoutMs);
  const translated = Array.isArray(data?.[0])
    ? data[0].map(part => Array.isArray(part) ? part[0] : '').join('')
    : '';
  if (!translated) throw new Error('translate returned empty text');
  return { text: translated };
}

module.exports = {
  translateText,
};

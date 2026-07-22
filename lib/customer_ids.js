const COUNTRY_PREFIXES = [
  [/^(ru|russia|россия|российская федерация|俄罗斯)$/i, 'RU'],
  [/^(br|brazil|brasil|巴西)$/i, 'BR'],
  [/^(de|germany|deutschland|德国)$/i, 'DE'],
  [/^(us|usa|united states|united states of america|美国)$/i, 'US'],
  [/^(uk|united kingdom|great britain|england|英国)$/i, 'GB'],
];

const REGION_LOCALES = ['en', 'zh-CN', 'ru', 'pt', 'de'];
let regionNameMap;

function normalizeRegionName(value) {
  return String(value || '').trim().normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function getRegionNameMap() {
  if (regionNameMap) return regionNameMap;
  regionNameMap = new Map();
  if (typeof Intl.DisplayNames !== 'function') return regionNameMap;
  const displays = REGION_LOCALES.map(locale => new Intl.DisplayNames([locale], { type: 'region' }));
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      for (const display of displays) {
        const name = display.of(code);
        if (!name || name === code || /unknown region|неизвестный регион|未知地区/i.test(name)) continue;
        regionNameMap.set(normalizeRegionName(name), code);
      }
    }
  }
  return regionNameMap;
}

function normalizeCountryPrefix(country, fallback = 'RU') {
  const raw = String(country || '').trim();
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  for (const [pattern, prefix] of COUNTRY_PREFIXES) {
    if (pattern.test(raw)) return prefix;
  }
  const regionCode = getRegionNameMap().get(normalizeRegionName(raw));
  if (regionCode) return regionCode;
  const letters = raw
    .normalize('NFKD')
    .replace(/[^a-z]/gi, '')
    .slice(0, 2)
    .toUpperCase();
  return /^[A-Z]{2}$/.test(letters) ? letters : fallback;
}

function isCanonicalCustomerId(value) {
  return /^[A-Z]{2}-\d{4}$/.test(String(value || '').trim());
}

function formatCustomerId(prefix, number) {
  const cleanPrefix = normalizeCountryPrefix(prefix, 'XX');
  const cleanNumber = Number(number);
  if (!Number.isInteger(cleanNumber) || cleanNumber < 1 || cleanNumber > 9999) {
    throw new Error(`客户编号超出四位数字范围: ${cleanPrefix}-${cleanNumber}`);
  }
  return `${cleanPrefix}-${String(cleanNumber).padStart(4, '0')}`;
}

function maxCanonicalNumber(rowsOrIds) {
  let max = 0;
  for (const item of rowsOrIds || []) {
    const id = typeof item === 'string' ? item : item && item.customer_id;
    const match = String(id || '').match(/^([A-Z]{2})-(\d{4})$/);
    if (match) max = Math.max(max, Number(match[2]));
  }
  return max;
}

function allocateCustomerId(usedIds, prefix, counters) {
  const cleanPrefix = normalizeCountryPrefix(prefix, 'XX');
  if (!counters.global) counters.global = maxCanonicalNumber(usedIds) + 1;
  let next = counters.global;
  let id = formatCustomerId(cleanPrefix, next);
  while (usedIds.has(id) || Array.from(usedIds).some(existing => String(existing).slice(3) === String(next).padStart(4, '0'))) {
    next += 1;
    id = formatCustomerId(cleanPrefix, next);
  }
  counters.global = next + 1;
  usedIds.add(id);
  return id;
}

function installCustomerIdTriggers(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_customer_id_insert_format
    BEFORE INSERT ON customer_pool
    FOR EACH ROW
    WHEN NEW.customer_id NOT GLOB '[A-Z][A-Z]-[0-9][0-9][0-9][0-9]'
    BEGIN
      SELECT RAISE(ABORT, 'customer_id must use country prefix + four digits, for example RU-0937');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_customer_id_update_format
    BEFORE UPDATE OF customer_id ON customer_pool
    FOR EACH ROW
    WHEN NEW.customer_id NOT GLOB '[A-Z][A-Z]-[0-9][0-9][0-9][0-9]'
    BEGIN
      SELECT RAISE(ABORT, 'customer_id must use country prefix + four digits, for example RU-0937');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_customer_id_insert_serial_unique
    BEFORE INSERT ON customer_pool
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM customer_pool
      WHERE SUBSTR(customer_id, 4, 4) = SUBSTR(NEW.customer_id, 4, 4)
    )
    BEGIN
      SELECT RAISE(ABORT, 'customer_id numeric part must be globally unique and follow total customer count');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_customer_id_update_serial_unique
    BEFORE UPDATE OF customer_id ON customer_pool
    FOR EACH ROW
    WHEN NEW.customer_id != OLD.customer_id
      AND EXISTS (
        SELECT 1 FROM customer_pool
        WHERE customer_id != OLD.customer_id
          AND SUBSTR(customer_id, 4, 4) = SUBSTR(NEW.customer_id, 4, 4)
      )
    BEGIN
      SELECT RAISE(ABORT, 'customer_id numeric part must be globally unique and follow total customer count');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_recon_grade_insert_guard
    BEFORE INSERT ON customer_pool
    FOR EACH ROW
    WHEN (
      COALESCE(NEW.rating, '') != ''
      OR COALESCE(NEW.current_pool, '') NOT IN ('', '未分池')
    )
    AND NOT EXISTS (
      SELECT 1 FROM recon_results WHERE customer_id = NEW.customer_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'current_pool/rating can only be set after Recon result exists');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_customer_pool_recon_grade_update_guard
    BEFORE UPDATE OF rating, current_pool ON customer_pool
    FOR EACH ROW
    WHEN (
      COALESCE(NEW.rating, '') != ''
      OR COALESCE(NEW.current_pool, '') NOT IN ('', '未分池')
    )
    AND NOT EXISTS (
      SELECT 1 FROM recon_results WHERE customer_id = NEW.customer_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'current_pool/rating can only be set after Recon result exists');
    END;
  `);
}

module.exports = {
  allocateCustomerId,
  formatCustomerId,
  installCustomerIdTriggers,
  isCanonicalCustomerId,
  maxCanonicalNumber,
  normalizeCountryPrefix,
};

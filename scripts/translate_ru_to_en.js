/**
 * 批量翻译 customer_pool 中的俄文内容为中文
 * 使用 Google Translate 公共端点（免费，无需 API Key）
 *
 * 翻译规则：
 *  - russian_name → english_name（填空，存中文译名）
 *  - company_name  纯俄文（无拉丁字母）→ 整段翻译为中文，更新 company_name
 *  - company_name  俄英混合（已有英文）→ 跳过，认为已有可读名
 *  - description   含俄文 → 整段翻译为中文
 *  - products      含俄文 → 整段翻译为中文
 *  - 不含俄文的记录完全跳过
 */

const Database = require('better-sqlite3');
const path = require('path');
const { translateText: translate } = require('../lib/translate');

const DB_PATH = path.join(__dirname, '..', 'data', 'crm.db');
const BATCH_DELAY_MS = 400;   // 每次请求间隔，防限流
const BATCH_REPORT = 20;      // 每 N 条打印一次进度

// CLI: node translate_ru_to_en.js [--limit N]
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  if (idx >= 0 && idx + 1 < process.argv.length) {
    const n = parseInt(process.argv[idx + 1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
})();

// ---- helpers ----

function hasCyrillic(text) {
  return text && /[А-яЁё]/.test(text);
}

/** 是否纯俄文（不含拉丁字母，标点数字和空格忽略） */
function isCyrillicOnly(text) {
  if (!text) return false;
  const stripped = text.replace(/[\d\s.,\-—–()「」""''№/+&:;%\[\]<>@!?|\\_=*~^#$™®° ‑]/g, '');
  if (!stripped) return false;
  return /^[А-яЁё]+$/.test(stripped);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function translateText(text, retries = 3) {
  if (!text || !text.trim()) return text;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await translate(text, { to: 'zh-cn' });
      return res.text;
    } catch (err) {
      if (i < retries - 1) {
        console.log(`  ⚠ 翻译失败（第${i + 1}次），2 秒后重试: ${err.message.slice(0, 80)}`);
        await sleep(2000);
      } else {
        console.error(`  ✗ 翻译失败，已重试${retries}次: ${err.message}`);
        return null;
      }
    }
  }
}

// ---- main ----

async function main() {
  console.log('=== 俄文→中文 批量翻译 ===\n');

  const db = new Database(DB_PATH);

  // 1. 查出所有含俄文的记录
  const records = db.prepare(`
    SELECT rowid, customer_id, russian_name, english_name, company_name, description, products
    FROM customer_pool
    WHERE russian_name GLOB '*[А-яЁё]*'
       OR company_name GLOB '*[А-яЁё]*'
       OR description GLOB '*[А-яЁё]*'
       OR products GLOB '*[А-яЁё]*'
    ORDER BY customer_id
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `).all();

  console.log(`共找到 ${records.length} 条含俄文的记录\n`);

  let translated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const idx = `[${i + 1}/${records.length}]`;

    const updates = [];
    const params = [];

    // --- russian_name → english_name ---
    if (row.russian_name && !row.english_name) {
      const en = await translateText(row.russian_name);
      if (en) {
        updates.push('english_name = ?');
        params.push(en);
        console.log(`${idx} russian→chinese: ${row.russian_name.slice(0, 40)} → ${en.slice(0, 40)}`);
        translated++;
      } else {
        errors++;
      }
      await sleep(BATCH_DELAY_MS);
    }

    // --- company_name (纯俄文才翻译) ---
    if (isCyrillicOnly(row.company_name)) {
      const en = await translateText(row.company_name);
      if (en) {
        updates.push('company_name = ?');
        params.push(en);
        console.log(`${idx} company: ${row.company_name.slice(0, 40)} → ${en.slice(0, 40)}`);
        translated++;
      } else {
        errors++;
      }
      await sleep(BATCH_DELAY_MS);
    } else if (hasCyrillic(row.company_name) && !isCyrillicOnly(row.company_name)) {
      skipped++;
      if (i % 20 === 0) console.log(`${idx} company 跳过（已含英文）: ${row.company_name.slice(0, 50)}`);
    }

    // --- description ---
    if (hasCyrillic(row.description)) {
      const en = await translateText(row.description);
      if (en) {
        updates.push('description = ?');
        params.push(en);
        console.log(`${idx} description: ${row.description.slice(0, 50).replace(/\n/g, ' ')} → ${en.slice(0, 50)}`);
        translated++;
      } else {
        errors++;
      }
      await sleep(BATCH_DELAY_MS);
    }

    // --- products ---
    if (hasCyrillic(row.products)) {
      const en = await translateText(row.products);
      if (en) {
        updates.push('products = ?');
        params.push(en);
        console.log(`${idx} products: ${row.products.slice(0, 50).replace(/\n/g, ' ')} → ${en.slice(0, 50)}`);
        translated++;
      } else {
        errors++;
      }
      await sleep(BATCH_DELAY_MS);
    }

    // 写库
    if (updates.length > 0) {
      params.push(row.rowid);
      db.prepare(`UPDATE customer_pool SET ${updates.join(', ')} WHERE rowid = ?`).run(...params);
    }

    if ((i + 1) % BATCH_REPORT === 0) {
      console.log(`\n--- 进度: ${i + 1}/${records.length} | 已翻译: ${translated} | 跳过: ${skipped} | 错误: ${errors} ---\n`);
    }
  }

  db.close();

  console.log(`\n=== 完成 ===`);
  console.log(`总计处理: ${records.length} 条`);
  console.log(`翻译成功: ${translated} 个字段`);
  console.log(`跳过:     ${skipped} 个字段（俄英混合）`);
  console.log(`错误:     ${errors} 个`);
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});

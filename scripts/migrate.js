#!/usr/bin/env node
/**
 * 一次性迁移：从原项目 xlsx 文件导入数据到 SQLite。
 * 运行: node scripts/migrate.js
 */
const path = require('path');
const { execFileSync } = require('child_process');
const { ensureTables } = require('../lib/db');

const XLSX_PATH = path.join(__dirname, '..', '..', 'russia-customer-crm-webapp', '俄罗斯客户开发看板 (1).xlsx');
const XLSX_TO_JSON = path.join(__dirname, 'xlsx_to_json.py');

function excelDate(val) {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const pad = x => String(x).padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth()+1)}-${pad(val.getDate())}`;
  }
  const n = Number(val);
  if (isNaN(n) || n < 40000 || n > 100000) return String(val||'').trim();
  const d = new Date((n - 25569) * 86400 * 1000);
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function sheetToRows(workbook, sheetName) {
  return workbook[sheetName] || [];
}

function loadWorkbookRows(filePath) {
  const output = execFileSync('python3', [XLSX_TO_JSON, filePath], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
  return JSON.parse(output);
}

async function main() {
  if (!require('fs').existsSync(XLSX_PATH)) {
    console.error('找不到 xlsx 文件:', XLSX_PATH);
    process.exit(1);
  }

  console.log('读取 Excel...');
  const wb = loadWorkbookRows(XLSX_PATH);
  const sheetNames = Object.keys(wb);
  console.log('工作表:', sheetNames.join(', '));

  const db = require('better-sqlite3')(path.join(__dirname, '..', 'data', 'crm.db'));
  db.pragma('journal_mode = WAL');
  ensureTables();

  // 清空旧数据
  db.exec('DELETE FROM recon_evidence');
  db.exec('DELETE FROM recon_results');
  db.exec('DELETE FROM recon_jobs');
  db.exec('DELETE FROM templates');
  db.exec('DELETE FROM customer_pool');
  db.exec('DELETE FROM customers');

  // --- ⑤业务跟进看板 ---
  if (sheetNames.includes('⑤业务跟进看板')) {
    const data = sheetToRows(wb, '⑤业务跟进看板');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const stmt = db.prepare(`INSERT INTO customers (
        follow_id, customer_id, company_name, website, customer_type, industry,
        rating, products, reason, email, phone, contact, owner, assigned_date,
        status, first_contact_date, last_follow_date, channel, feedback,
        next_action, next_follow_date, invalid_reason, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const followId = String(row[col('跟进ID')] || '').trim();
          if (!followId) continue;
          stmt.run(
            followId,
            String(row[col('客户ID')] || '').trim(),
            String(row[col('公司名称')] || '').trim(),
            String(row[col('官网')] || '').trim(),
            String(row[col('客户类型')] || '').trim(),
            String(row[col('行业')] || '').trim(),
            String(row[col('推荐等级')] || '').trim(),
            String(row[col('主推产品')] || '').trim(),
            String(row[col('推荐联系理由')] || '').trim(),
            String(row[col('联系邮箱')] || '').trim(),
            String(row[col('联系电话')] || '').trim(),
            String(row[col('联系人')] || '').trim(),
            String(row[col('分配给')] || '').trim(),
            excelDate(row[col('分配日期')]),
            String(row[col('当前状态')] || '').trim() || '未分配',
            excelDate(row[col('首次联系日期')]),
            excelDate(row[col('最近跟进日期')]),
            String(row[col('联系渠道')] || '').trim(),
            String(row[col('客户反馈')] || '').trim(),
            String(row[col('下一步动作')] || '').trim(),
            excelDate(row[col('下次跟进日期')]),
            String(row[col('无效原因')] || '').trim(),
            String(row[col('备注')] || '').trim(),
          );
        }
      });
      insert(data);
      console.log(`  customers: ${db.prepare('SELECT count(*) as c FROM customers').get().c} 条`);
    }
  }

  // --- ②总客户池 ---
  if (sheetNames.includes('②总客户池')) {
    const data = sheetToRows(wb, '②总客户池');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const stmt = db.prepare(`INSERT INTO customer_pool (
        customer_id, domain, company_name, russian_name, english_name, country, city,
        website, industry, customer_type, description, products, rating, current_pool,
        phone, email, inn, risk_status, website_verification, contact_count,
        deep_report, source_file, first_found, last_found, search_count, verified, notes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const customerId = String(row[col('客户ID')] || '').trim();
          if (!customerId) continue;
          stmt.run(
            customerId,
            String(row[col('域名')] || '').trim(),
            String(row[col('公司名称')] || '').trim(),
            String(row[col('俄文名称')] || '').trim(),
            String(row[col('英文名称')] || '').trim(),
            String(row[col('国家')] || '').trim(),
            String(row[col('城市')] || '').trim(),
            String(row[col('官网')] || '').trim(),
            String(row[col('行业')] || '').trim(),
            String(row[col('客户类型')] || '').trim(),
            String(row[col('简介')] || '').trim(),
            String(row[col('产品需求')] || '').trim(),
            String(row[col('推荐等级')] || '').trim(),
            String(row[col('当前池子')] || '').trim() || '未分池',
            String(row[col('电话')] || '').trim(),
            String(row[col('邮箱')] || '').trim(),
            String(row[col('INN')] || '').trim(),
            String(row[col('制裁/风险状态')] || '').trim(),
            String(row[col('官网验证')] || '').trim(),
            String(row[col('联系人数量')] || '').trim() || '0',
            String(row[col('深度报告')] || '').trim(),
            String(row[col('来源文件')] || '').trim(),
            excelDate(row[col('首次发现')]),
            excelDate(row[col('最后发现')]),
            String(row[col('搜索次数')] || '').trim() || '0',
            String(row[col('已验证')] || '').trim(),
            String(row[col('备注')] || '').trim(),
          );
        }
      });
      insert(data);
      console.log(`  customer_pool: ${db.prepare('SELECT count(*) as c FROM customer_pool').get().c} 条`);
    }
  }

  // --- ⑦话术模板 ---
  if (sheetNames.includes('⑦话术模板')) {
    const data = sheetToRows(wb, '⑦话术模板');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const stmt = db.prepare('INSERT INTO templates (scenario, description, english, russian, customer_type, product) VALUES (?,?,?,?,?,?)');
      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          stmt.run(
            String(row[col('场景')] || '').trim(),
            String(row[col('中文说明')] || '').trim(),
            String(row[col('英文版本')] || '').trim(),
            String(row[col('俄语版本')] || '').trim(),
            String(row[col('适用客户类型')] || '').trim(),
            String(row[col('适用产品')] || '').trim(),
          );
        }
      });
      insert(data);
      console.log(`  templates: ${db.prepare('SELECT count(*) as c FROM templates').get().c} 条`);
    }
  }

  // --- ⑧RussiaRecon任务队列 ---
  if (sheetNames.includes('⑧RussiaRecon任务队列')) {
    const data = sheetToRows(wb, '⑧RussiaRecon任务队列');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const cols = ['job_id','customer_id','follow_id','source','company_name','website','domain','inn','requested_by','requested_at','mode','status','started_at','finished_at','error','output_dir','updated_at'];
      const stmt = db.prepare(`INSERT INTO recon_jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const jobId = String(row[col('job_id')] || '').trim();
          if (!jobId) continue;
          stmt.run(...cols.map(c => String(row[col(c)] || '').trim()));
        }
      });
      insert(data);
      console.log(`  recon_jobs: ${db.prepare('SELECT count(*) as c FROM recon_jobs').get().c} 条`);
    }
  }

  // --- ⑨RussiaRecon结果库 ---
  if (sheetNames.includes('⑨RussiaRecon结果库')) {
    const data = sheetToRows(wb, '⑨RussiaRecon结果库');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const cols = ['job_id','customer_id','company_name','website','customer_type','score','priority','compliance_status','sanctioned','sanction_source','sanction_program','sanction_checked_at','evidence_url','opportunity_summary','contacts_summary','recommended_products','outreach_angle','next_action','evidence_count','report_path','artifacts_json','updated_at'];
      const stmt = db.prepare(`INSERT INTO recon_results (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const jobId = String(row[col('job_id')] || '').trim();
          if (!jobId) continue;
          stmt.run(...cols.map(c => String(row[col(c)] || '').trim()));
        }
      });
      insert(data);
      console.log(`  recon_results: ${db.prepare('SELECT count(*) as c FROM recon_results').get().c} 条`);
    }
  }

  // --- ⑩证据库 ---
  if (sheetNames.includes('⑩证据库')) {
    const data = sheetToRows(wb, '⑩证据库');
    if (data.length > 1) {
      const headers = data[0].map(String);
      const col = name => headers.indexOf(name);
      const cols = ['job_id','customer_id','field_name','value','source_url','source_title','checked_at','confidence','extractor'];
      const stmt = db.prepare(`INSERT INTO recon_evidence (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      const insert = db.transaction(rows => {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          stmt.run(...cols.map(c => String(row[col(c)] || '').trim()));
        }
      });
      insert(data);
      console.log(`  recon_evidence: ${db.prepare('SELECT count(*) as c FROM recon_evidence').get().c} 条`);
    }
  }

  db.close();
  console.log('\n✅ 迁移完成');
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

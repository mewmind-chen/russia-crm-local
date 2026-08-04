#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.CRM_DB_PATH || path.join(ROOT, 'data', 'crm.db');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(DB_PATH)) {
  console.error(`数据库不存在：${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
try {
  const columns = new Set(db.prepare('PRAGMA table_info(crm_accounts)').all().map(row => row.name));
  if (!columns.has('created_by') || !columns.has('first_claimed_by') || !columns.has('first_claimed_at')) {
    console.error('crm_accounts 缺少目标列（created_by/first_claimed_by/first_claimed_at），请先完成表结构迁移');
    process.exit(1);
  }
  const rows = db.prepare(`SELECT id,external_customer_id,owner_id,created_by,intake_item_id,source,
    first_claimed_by,first_claimed_at FROM crm_accounts ORDER BY id`).all();
  const intakeItemColumns = new Set(db.prepare('PRAGMA table_info(crm_intake_items)').all().map(row => row.name));
  const fixed = [];
  const unknown = [];
  const unchanged = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  for (const row of rows) {
    const systemImported = String(row.intake_item_id || '').trim() !== ''
      || String(row.source || '') === '每日未开发线索分配';
    const changes = {};
    if (systemImported) {
      const currentCreator = String(row.created_by || '').trim();
      // 仅修正“由领取产生”的错误签名（created_by 为空或被误写成负责人）；
      // 手工创建后被退回再领取恢复的账户保留原创建人。
      if (currentCreator === '' || currentCreator === String(row.owner_id || '')) {
        const intakeCreator = intakeItemColumns.has('created_by')
          ? String(
            db.prepare('SELECT created_by FROM crm_intake_items WHERE id=?').get(row.intake_item_id)?.created_by || '',
          ).trim() || 'system'
          : 'system';
        changes.created_by = { from: currentCreator, to: intakeCreator };
      }
      if (!row.first_claimed_by || !row.first_claimed_at) {
        const decisions = db.prepare(`SELECT actor_id,created_at,manual_decision_json
          FROM crm_intake_decisions
          WHERE intake_item_id=? AND decision_type='manual'
          ORDER BY created_at ASC,id ASC`).all(row.intake_item_id);
        const claim = decisions.find(decision => {
          try {
            return JSON.parse(decision.manual_decision_json || '{}').action === 'claim';
          } catch (_error) {
            return false;
          }
        });
        if (claim?.actor_id && !row.first_claimed_by) {
          changes.first_claimed_by = { from: row.first_claimed_by || '', to: claim.actor_id };
        }
        if (claim?.created_at && !row.first_claimed_at) {
          changes.first_claimed_at = { from: row.first_claimed_at || '', to: claim.created_at };
        }
      }
    } else if (String(row.created_by || '').trim() === '') {
      unknown.push({ id: row.id, reason: '无法可靠确认创建人' });
    }
    if (Object.keys(changes).length) fixed.push({ id: row.id, changes });
    else unchanged.push(row.id);
  }

  let backupPath = '';
  if (APPLY) {
    backupPath = path.join(ROOT, 'tmp', `customer-creator-backfill-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({ fixed }, null, 2));
    const update = db.transaction(() => {
      for (const item of fixed) {
        const entries = Object.entries(item.changes);
        const sets = entries.map(([column]) => `${column}=?`).join(',');
        const params = entries.map(([, change]) => change.to);
        db.prepare(`UPDATE crm_accounts SET ${sets},updated_at=? WHERE id=?`)
          .run(...params, now, item.id);
      }
    });
    update();
  }

  console.log(JSON.stringify({
    dryRun: !APPLY,
    backup: APPLY ? backupPath : null,
    fixed: fixed.length,
    unknown: unknown.length,
    unchanged: unchanged.length,
    details: fixed.slice(0, 20).map(item => ({ id: item.id, changes: item.changes })),
  }, null, 2));
} finally {
  db.close();
}

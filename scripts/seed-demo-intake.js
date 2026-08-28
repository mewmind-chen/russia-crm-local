#!/usr/bin/env node
'use strict';

// 演示线索池数据（仅开发 runtime 使用）。
// 用法：set -a && source runtime/frontend-widget-pilot/.env && set +a && node scripts/seed-demo-intake.js
// 幂等：crm_intake_items 已有数据时直接跳过。

const path = require('path');
const Database = require('better-sqlite3');

const databasePath = process.env.CRM_DB_PATH
  || path.join(__dirname, '..', 'data', 'crm.db');

const db = new Database(databasePath);

const existing = db.prepare('SELECT COUNT(*) AS total FROM crm_intake_items').get().total;
if (existing > 0) {
  console.log(`跳过：crm_intake_items 已有 ${existing} 条数据。`);
  db.close();
  process.exit(0);
}

const now = () => new Date().toISOString();
const daysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString();
const today = new Date().toISOString().slice(0, 10);

const batchId = `BATCH-DEMO-${today}`;
const batchInsert = db.prepare(`INSERT INTO crm_intake_batches
  (id,batch_date,source,status,candidate_count,imported_count,assigned_count,skipped_count,created_by,created_at,finished_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
batchInsert.run(batchId, today, 'screened-customer-pool', 'done', 12, 12, 4, 0, 'system', now(), now());

const itemInsert = db.prepare(`INSERT INTO crm_intake_items
  (id,batch_id,external_customer_id,crm_customer_id,company_name,country,website,industry,customer_type,
   product_focus,match_score,match_group,contact_name,contact_title,contact_methods,contact_level,
   evidence_urls,report_url,status,suggested_owner_id,assigned_owner_id,decision_reason,return_reason,
   assigned_at,claim_due_at,claimed_at,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const demo = [
  // 待分配（pending）
  { id: 'DEMO-IN-001', status: 'pending', country: '巴西', website: 'aurea-automacao.com.br', industry: '工业自动化', customerType: '终端制造商', product: 'MCU / 连接器', score: 82, group: 'A', level: 'L2', contactName: 'Carlos Mendes', contactTitle: '采购经理', methods: 'carlos@aurea-automacao.com.br / +55 11 4000-1122', suggested: 'USR-S01', reason: '行业匹配 A 组，采购决策人已识别', evidence: 'https://aurea-automacao.com.br/contato' },
  { id: 'DEMO-IN-002', status: 'pending', country: '美国', website: 'northstarcontrols.com', industry: '工业控制', customerType: '终端制造商', product: '传感器 / FPGA', score: 76, group: 'A', level: 'L3', contactName: 'Sarah Kim', contactTitle: '供应链总监', methods: 's.kim@northstarcontrols.com / +1 312 555 0178', suggested: 'USR-S02', reason: '行业匹配 A 组，已有具名联系人', evidence: 'https://northstarcontrols.com/about' },
  // 已审批待分配（approved）
  { id: 'DEMO-IN-003', status: 'approved', country: '俄罗斯', website: 'volga-instrument.ru', industry: '仪器仪表', customerType: '终端制造商', product: '模拟IC / 电源模块', score: 71, group: 'B', level: 'L1', contactName: '', contactTitle: '', methods: '', suggested: 'USR-S03', reason: 'B 组备选，缺少直接联系入口', evidence: 'https://volga-instrument.ru/contacts' },
  // 已分配待领取（assigned，含一条超期）
  { id: 'DEMO-IN-004', status: 'assigned', country: '德国', website: 'helmut-maschinen.de', industry: '机床', customerType: '终端制造商', product: '伺服电机 / 编码器', score: 88, group: 'A', level: 'L3', contactName: 'Jonas Weber', contactTitle: 'CTO', methods: 'j.weber@helmut-maschinen.de / +49 30 555 0123', assigned: 'USR-S01', claimedAt: null, claimDue: daysFromNow(1), reason: 'RFQ 线索高优先级，负责人已指派' },
  { id: 'DEMO-IN-005', status: 'assigned', country: '墨西哥', website: 'monterrey-autopartes.mx', industry: '汽车电子', customerType: '经销商', product: '车规连接器', score: 66, group: 'B', level: 'L2', contactName: 'Luis Ortega', contactTitle: '采购负责人', methods: 'l.ortega@monterrey-autopartes.mx', assigned: 'USR-S02', claimDue: daysFromNow(2), reason: '报价需求已识别，待销售领取' },
  { id: 'DEMO-IN-006', status: 'assigned', country: '哈萨克斯坦', website: 'almaty-energo.kz', industry: '电力设备', customerType: '系统集成商', product: '配电模块', score: 54, group: 'C', level: 'L0', contactName: '', contactTitle: '', methods: '', assigned: 'USR-S04', claimDue: daysFromNow(-1), reason: '自动分配 C 组，领取时限已超期' },
  // 已领取（claimed，一条已触达）
  { id: 'DEMO-IN-007', status: 'claimed', country: '巴西', website: 'santos-logistica.com.br', industry: '物流设备', customerType: '系统集成商', product: 'RFID / 传感器', score: 79, group: 'A', level: 'L3', contactName: 'Ana Souza', contactTitle: '运营总监', methods: 'ana@santos-logistica.com.br / +55 21 4000-8899', crmCustomerId: null, claimedAt: daysFromNow(-2), reason: '已领取，进入 CRM 跟进' },
  { id: 'DEMO-IN-008', status: 'claimed', country: '俄罗斯', website: 'ural-pribor.ru', industry: '仪器仪表', customerType: '终端制造商', product: '测试测量设备', score: 74, group: 'A', level: 'L2', contactName: 'Dmitry Volkov', contactTitle: '技术总监', methods: 'd.volkov@ural-pribor.ru / +7 343 555 0190', crmCustomerId: 'CRM-0004', claimedAt: daysFromNow(-3), reason: '已领取，已建立 CRM 客户' },
  // 已退回（returned）
  { id: 'DEMO-IN-009', status: 'returned', country: '美国', website: 'pacific-led.com', industry: '照明', customerType: '贸易商', product: 'LED 驱动', score: 48, group: 'C', level: 'L1', contactName: '', contactTitle: '', methods: '', assigned: 'USR-S02', claimedAt: null, returnReason: '客户明确表示已无采购计划' },
  { id: 'DEMO-IN-010', status: 'returned', country: '德国', website: 'suedwerk-gmbh.de', industry: '金属加工', customerType: '终端制造商', product: '工控器件', score: 61, group: 'B', level: 'L2', contactName: 'Klaus Schmidt', contactTitle: '总经理', methods: 'k.schmidt@suedwerk-gmbh.de', assigned: 'USR-S01', claimedAt: null, returnReason: '已有稳定供应商，暂不更换' },
  // 不对口（rejected）
  { id: 'DEMO-IN-011', status: 'rejected', country: '墨西哥', website: 'queretaro-aero.mx', industry: '航空航天', customerType: '终端制造商', product: '航空连接器', score: 42, group: 'C', level: 'L0', contactName: '', contactTitle: '', methods: '', assigned: 'USR-S03', claimedAt: null, reason: '产品线不对口，人工判定拒绝' },
  // 重复（duplicate，关联已有客户）
  { id: 'DEMO-IN-012', status: 'duplicate', country: '巴西', website: 'aurea-automacao.com.br', industry: '工业自动化', customerType: '终端制造商', product: 'MCU / 连接器', score: 85, group: 'A', level: 'L2', contactName: 'Carlos Mendes', contactTitle: '采购经理', methods: 'carlos@aurea-automacao.com.br', crmCustomerId: 'CRM-0001', reason: '与现有客户重复，已关联 CRM 客户' },
];

const sales = ['USR-S01', 'USR-S02', 'USR-S03', 'USR-S04'];
const accountLinks = db.prepare('SELECT id, external_customer_id FROM crm_accounts ORDER BY id LIMIT 8').all();

const linkFor = (item) => {
  if (item.crmCustomerId) return item.crmCustomerId;
  if (item.status === 'claimed' && accountLinks[0]) return accountLinks[0].id;
  return '';
};

const tx = db.transaction(() => {
  demo.forEach((row, index) => {
    const assignedOwner = row.assigned || (row.status === 'assigned' ? sales[index % sales.length] : '');
    itemInsert.run(
      row.id, batchId, row.id, linkFor(row),
      `${row.contactName ? row.contactName.split(' ').slice(-1)[0] + ' ' : ''}${row.country} ${row.industry} Demo`,
      row.country, row.website, row.industry, row.customerType,
      row.product, row.score, row.group,
      row.contactName, row.contactTitle, row.methods, row.level,
      row.evidence || '', `https://127.0.0.1:3201/api/report?job_id=demo-${row.id}`,
      row.status,
      row.suggested || '', assignedOwner,
      row.reason || (row.status === 'assigned' ? '规则分配' : ''),
      row.returnReason || '',
      assignedOwner ? daysFromNow(-index) : '',
      row.claimDue || (assignedOwner ? daysFromNow(2) : ''),
      row.claimedAt || '',
      daysFromNow(-index - 1), now(),
    );
  });
});
tx();

const counts = db.prepare('SELECT status, COUNT(*) AS total FROM crm_intake_items GROUP BY status').all();
console.log('演示线索池数据已写入：');
for (const row of counts) console.log(`  ${row.status}: ${row.total}`);
db.close();

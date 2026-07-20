#!/usr/bin/env node
const { installSalesCrm, scanDailyIntake } = require('../lib/sales_crm');

try {
  installSalesCrm();
  const result = scanDailyIntake({ id: 'daily-automation', role: 'admin' });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}

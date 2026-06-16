#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  npm run daily:import
  npm run daily:import -- 2026-05-22
  npm run daily:import -- --skip-translate --input /path/to/new-customers.translated.json 2026-05-22

This runs the bot3 daily import first, then normalizes customer_type and industry.
`);
  process.exit(0);
}

function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run('导入每日新增客户', process.execPath, [path.join('scripts', 'import-bot3-daily.js'), ...args]);
run('归一化类型和行业', process.execPath, [path.join('scripts', 'normalize-taxonomy.js')]);

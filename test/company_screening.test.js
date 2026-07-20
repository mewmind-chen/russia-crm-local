const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCompany } = require('../lib/company_screening');

test('explicit clear sanction wording does not become blocked by the word sanction alone', () => {
  const result = classifyCompany({ company_name: 'Industrial Controls', customer_type: '终端制造商', industry: '工业控制', description: '电子控制器制造', website: 'example.ru', risk_status: 'CLEAR｜未发现制裁命中' });
  assert.notEqual(result.risk_level, 'blocked');
});

test('military business signal remains blocked even when a separate screening says clear', () => {
  const result = classifyCompany({ company_name: 'Defense Plant', customer_type: '终端制造商', industry: '军工电子', description: '导弹控制设备', website: 'example.ru', risk_status: 'CLEAR' });
  assert.equal(result.risk_level, 'blocked');
});

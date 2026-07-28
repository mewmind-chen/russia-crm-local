const CUSTOMER_TYPE_OPTIONS = [
  '终端制造商',
  '终端客户',
  '贸易公司',
  '系统集成商',
  '贴片厂/PCBA',
  'EMS/方案商',
  '原厂',
  '平台型',
  '混合型',
  '服务商/非目标',
  '待确认',
];

const CUSTOMER_SOURCE_OPTIONS = [
  '公司指派',
  '销售自行搜索',
  '邮件搜索',
  '展会',
  'LinkedIn',
  '海关数据',
  '老客户介绍',
];

const INDUSTRY_OPTIONS = [
  '电子设备制造',
  '工业控制',
  '电子制造服务',
  '电子系统集成',
  '电力电子',
  '汽车电子',
  '导航电子',
  '医疗电子',
  '铁路电子',
  '工业自动化',
  '航空电子',
  '通信网络',
  '电力能源',
  '半导体/微电子',
  '非目标/其他',
];

const BUSINESS_PRODUCT_OPTIONS = [
  '电机',
  '无人机',
  '机床/CNC',
  '工业设备',
  '通信设备',
  '医疗设备',
  '汽车电子',
  '智能家居/IoT',
  '机器人',
  '激光/等离子设备',
  '暖通/制冷设备',
  '包装设备',
  '食品设备',
  '输送设备',
  '能源设备',
  '电子设备',
  '液压/气动设备',
  '仪器仪表',
  '焊接设备',
  '电气设备',
];

function foldText(...values) {
  return values
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some(keyword => text.includes(String(keyword).toLowerCase()));
}

function normalizeCustomerType(value, context = '') {
  const raw = String(value || '').trim();
  const text = foldText(raw, context);
  if (!text) return '待确认';

  if (hasAny(text, ['非电子', '纯it', '软件开发', 'training services', 'военная подготовка', '培训中心', '服务公司'])) {
    return '服务商/非目标';
  }
  if (hasAny(text, ['制造商+分销商', '分销商+', '贸易/制造', '制造与贸易', '混合'])) {
    return '混合型';
  }
  if (hasAny(text, ['原厂', 'chip fab', 'semiconductor manufacturer', '半导体制造商'])) {
    return '原厂';
  }
  if (hasAny(text, ['贴片', 'pcba', 'smt', 'pcb生产', '印刷电路板'])) {
    return '贴片厂/PCBA';
  }
  if (hasAny(text, ['ems', '合同制造', '方案商'])) {
    return 'EMS/方案商';
  }
  if (hasAny(text, ['系统集成', '集成商', 'integrator', 'интегратор'])) {
    return '系统集成商';
  }
  if (hasAny(text, ['贸易公司', '贸易商', '大贸易商', '分销商', 'distributor', 'дистрибьютор'])) {
    return '贸易公司';
  }
  if (hasAny(text, ['平台型', '平台', 'marketplace'])) {
    return '平台型';
  }
  if (hasAny(text, ['终端制造商', '制造商', 'manufacturer', 'производитель', 'terminal-auto-mfg', 'oem'])) {
    return '终端制造商';
  }
  if (hasAny(text, ['终端客户', 'end user', 'конечный заказчик', '原油/天然气生产商', '石油行业'])) {
    return '终端客户';
  }
  if (hasAny(text, ['待确认', 'unknown', 'не указано', 'нет данных'])) {
    return '待确认';
  }

  return '待确认';
}

function normalizeIndustry(value, context = '') {
  const raw = String(value || '').trim();
  if (INDUSTRY_OPTIONS.includes(raw)) return raw;

  const text = foldText(raw, context);
  if (!text) return '电子设备制造';

  if (hasAny(text, ['62.01', '软件开发', '纯it', 'нефтегаз', 'oil & gas', 'oil extraction', 'oil refining', '石油天然气', '石油行业', '军事培训', 'training services', '工业炸药'])) {
    return '非目标/其他';
  }
  if (hasAny(text, ['航空航天', '国防电子', '航空电子', 'aerospace', 'defense', 'space vehicles', 'missile', 'авиа', 'оборон', 'воен'])) {
    return '航空电子';
  }
  if (hasAny(text, ['медицин', 'medical', '医疗电子', '医疗设备', '监护仪', '呼吸机', '超声'])) {
    return '医疗电子';
  }
  if (hasAny(text, ['автом', 'automotive', '汽车电子', '车联网', '零部件'])) {
    return '汽车电子';
  }
  if (hasAny(text, ['铁路电子', '交通设备', 'railway', 'железнод'])) {
    return '铁路电子';
  }
  if (hasAny(text, ['导航电子', 'gps', 'glonass', 'навигац'])) {
    return '导航电子';
  }
  if (hasAny(text, ['通信设备', '通信网络', '电信', '微波电子', 'телеком', 'связ', 'radio', '无线电', 'network'])) {
    return '通信网络';
  }
  if (hasAny(text, ['半导体', '微电子', 'микро', 'микросх', 'semiconductor', 'chip fab', 'ic 制造'])) {
    return '半导体/微电子';
  }
  if (hasAny(text, ['pcb', 'smt', 'pcba', '电子制造服务', '合同制造', 'печат', 'сборк'])) {
    return '电子制造服务';
  }
  if (hasAny(text, ['系统集成', '电子系统集成', 'интегратор'])) {
    return '电子系统集成';
  }
  if (hasAny(text, ['电力电子', 'led', '照明', 'силов', 'тиристор', 'преобразоват', 'стабилизатор', '变频', '伺服', '逆变器', '电源模块'])) {
    return '电力电子';
  }
  if (hasAny(text, ['电力能源', '能源设备', 'электростанц', 'дизель', '发电机', '充电站', '电站', 'энерг'])) {
    return '电力能源';
  }
  if (hasAny(text, ['工业控制', 'plc', 'контроллер', '控制器', '仪器仪表', '仪表制造', 'измер', 'кипиа'])) {
    return '工业控制';
  }
  if (hasAny(text, [
    '工业自动化', '工业设备', '数控机床', '机床', 'cnc', 'чпу', 'станк',
    '机器人', 'robot', '包装设备', 'упаков', '食品设备', 'пищ', '输送设备',
    'конвейер', '液压', 'гидравл', '气动', '激光', '等离子', '焊接', 'свароч',
    '暖通', '制冷', '通风', '泵阀', '称重', '锻压', 'электромонтаж',
  ])) {
    return '工业自动化';
  }

  return '电子设备制造';
}

module.exports = {
  CUSTOMER_TYPE_OPTIONS,
  CUSTOMER_SOURCE_OPTIONS,
  INDUSTRY_OPTIONS,
  BUSINESS_PRODUCT_OPTIONS,
  normalizeCustomerType,
  normalizeIndustry,
};

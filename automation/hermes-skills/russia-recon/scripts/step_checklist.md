# Russia Recon v5.8 — 执行检查清单（能力门控 + CloakBrowser 首选版）

> **每次分析前必须读取此文件，逐项勾选。只有“当前环境可执行且输入条件满足”的项，未勾才算未执行。**
>
> **前提不满足 / 环境不可用** 的项必须写明原因，例如：
> - `前提不满足（无唯一用户名）`
> - `前提不满足（无非通用个人邮箱）`
> - `前提不满足（Comtrade API key 未配置）`
> - `环境不可用（browser_fetch_ok=false，已改走 API/Scrapling/官方公开源）`

---

## 🔍 分析前确认

| # | 检查项 | 状态 |
|---|--------|------|
| P1 | 已加载最新技能版本（skill_view russia-recon） | ☐ |
| P2 | 已确认目标公司名/域名 | ☐ |
| P3 | 已创建todo清单（含所有步骤） | ☐ |
| P4 | 已确认最终输出必须是完整 `JSON + Markdown`，不能只写“Analysis complete/Report delivered” | ☐ |
| P5 | 已运行 `network-sentinel check --proxy http://127.0.0.1:7897` 并记录 verdict | ☐ |
| P6 | 已运行 `network-sentinel browser-check` 并记录 `playwright_runtime_ok/browser_fetch_ok/stealth_fetch_ok/cloakbrowser_ok` | ☐ |
| P7 | 已运行 `route-check --route auto` 或在抓取结果中记录 `route_policy/route_group/route_node/route_warning` | ☐ |
| P8 | 已按能力状态选择 `api-* / scrapling-fetch / fetch / browser-fetch / stealth-fetch`；浏览器层默认 `--backend auto` 先试 CloakBrowser；`lightpanda/browser_navigate` 仅作 error 兜底 | ☐ |
| P9 | 已初始化 `blocked_sources/session_state/ip_burned/hopeless/step_skipped` | ☐ |

---

## Step 0 — 客户类型判定 + 行业关联度速判

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 0.1 | 抓取官网首页，确认产品线 | network-sentinel `fetch --route auto`；JS重站用 `browser-fetch --route auto`；自动化识别用 `stealth-fetch --route auto`；error 才 lightpanda/browser_navigate | ☐ |
| 0.2 | 查6维度（产品所有权/技术文档/OKVED/地址/招聘/认证） | 多源 | ☐ |
| 0.3 | 查OKVED主码 → 对照P0-P4分级表 | rusprofile | ☐ |
| 0.4 | 输出：制造商/分销商/分销商+ 判定 + P0-P4关联度 | — | ☐ |
| 0.5 | 域名模式预检：`*.yp.ru` / `*.2gis.ru` / `*.b2b.*` 识别为黄页域名，不当作官网死抓 | session_state | ☐ |

---

## Step 1 — 身份锚定

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 1.1 | 先查 `api-registry`（ФНС / BO.Nalog）；仅在需要网页补证据且浏览器层可用时再查 rusprofile/list-org/saby | `api-registry` -> `scrapling-fetch/fetch` -> `browser-fetch/stealth-fetch` | ☐ |
| 1.2 | 提取：INN/OGRN/法人/员工数/营收/OKVED | — | ☐ |
| 1.3 | ⛔ 营收数据：有就引用（附URL），没有标「未知」，禁止推算 | — | ☐ |
| 1.4 | 搜品牌名（英文+俄文），收集所有关联法人 | network-sentinel `fetch` OpenSanctions；搜索站用 `browser-fetch` | ☐ |
| 1.5 | 查俄语站(.ru)法定信息 + 国际站(.com)全球信息 | network-sentinel `fetch/browser-fetch` | ☐ |
| 1.6 | saby.ru 或 list-org.com 交叉验证 | network-sentinel `browser-fetch` | ☐ |
| 1.7 | 每次 `blocked/captcha/403/KillBot` 写入 `blocked_sources`，同域名本任务不重复撞 | session_state | ☐ |
| 1.8 | `.ru/.su/俄语黄页/工商/招聘/社交` 默认确认 `route_group=RU`；制裁/Google 默认确认 `route_group=US` | network-sentinel route fields | ☐ |

---

## Step 2 — 政府采购记录

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 2.1 | **第一轮快搜**: 先 `api-search` 找 `zakupki.gov.ru / clearspending`，浏览器搜索页只作兜底 | `api-search` -> `scrapling-fetch/fetch` -> `browser-fetch/stealth-fetch` | ☐ |
| 2.2 | ⛔ 无搜索结果 → 标注「zakupki无公开记录」→ 跳到Step 3 | — | ☐ |
| 2.3 | **第二轮深入**（仅在有结果时）: browser-fetch访问合同页；error 才 browser_navigate | network-sentinel `browser-fetch` | ☐ |
| 2.4 | 下载招标PDF/DOC，提取联系人 | — | ☐ |
| 2.5 | OKVED 25.xx军工 → 标注「国防采购数据不公开」 | — | ☐ |

---

## Step 3 — 制裁状态检查（必须至少2源；结论分级）

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 3.1 | 制裁主路径：OpenSanctions + OFAC/EU/UK 官方下载 | `api-sanctions` | ☐ |
| 3.2 | 需要网页证据时补抓官方详情页 | `scrapling-fetch`，必要时 `fetch` | ☐ |
| 3.3 | 只有在 `browser_fetch_ok=true` 且确有必要时，才把浏览器层用于制裁网页补证据 | `browser-fetch/stealth-fetch` | ☐ |
| 3.5 | 区分"直接制裁" vs "关联标记" | — | ☐ |
| 3.6 | **v4.2**: 对集团多实体逐个标注制裁状态 | — | ☐ |
| 3.7 | 输出制裁结论只能为 CLEAR / PARTIAL_CLEAR / UNKNOWN / HIT；EU或UK未完成时禁止写CLEAR | — | ☐ |

---

## Step 4 — 数字足迹 + 元器件需求提取

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 4.0 | 门控检查：无独立域名不跑域名 OSINT；无产品页且 ip_burned 只执行替代源 | session_state | ☐ |
| 4.1 | **招聘侦察**：先 `api-hiring`；若浏览器层可用，再补 hh.ru 网页/招聘署名 | `api-hiring` -> `browser-fetch/stealth-fetch` | ☐ |
| 4.2 | 提取JD中芯片型号/品牌（STM32/FPGA/TI等） | — | ☐ |
| 4.3 | 抓官网产品页 → 搜索元器件关键词 | network-sentinel `fetch/browser-fetch` | ☐ |
| 4.4 | 抓技术文档/PDF → 提取BOM/规格书 | network-sentinel `fetch`，JS页用 `browser-fetch` | ☐ |
| 4.5 | 邮箱格式推断（如有邮箱） | — | ☐ |
| 4.6 | 输出：元器件需求表（产品线/型号/置信度） | — | ☐ |

---

## Step 5 — 社交与专业痕迹（强制执行）

> Step 5 永远执行，但“永远执行”指的是：**所有当前环境可执行且输入满足的联系人检查**必须执行。浏览器层不可用时，浏览器专属项改为“环境不可用”，并必须改走 API、官网、公开文件、电话/邮箱入口、Scrapling/fetch 等替代源。

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 5.1 | 官网社交入口提取（footer/header/contact/requisites） | network-sentinel `fetch/browser-fetch` | ☐ |
| 5.2 | VK搜索（公司名+директор/владелец/снабжение/закупки） | 仅当 `browser_fetch_ok=true` 时进入应执行集合；否则写环境不可用并改走官网/公开文件/搜索 API 替代 | ☐ |
| 5.3 | Telegram检查（VK主页/官网找链接或@handle） | network-sentinel `browser-fetch/fetch` | ☐ |
| 5.4 | WhatsApp/电话入口提取与格式化 | network-sentinel `fetch` 官网；2GIS 用 `browser-fetch` | ☐ |
| 5.5 | 2GIS验证电话、地址、分支、评论线索 | 仅当 `browser_fetch_ok=true` 时进入应执行集合；被拦写原因并转替代源 | ☐ |
| 5.6 | hh.ru 搜公司和招聘署名 | 先 `api-hiring`；网页仅在 `browser_fetch_ok=true` 时进入应执行集合 | ☐ |
| 5.7 | 搜索技术总监/采购/CEO | 优先 `api-search`；Yandex/浏览器搜索页仅作兜底且要求浏览器层可用 | ☐ |
| 5.8 | 输出联系人分类：已验证联系人 / 入口联系人 / 未找到 | — | ☐ |

---

## Step 5+ — 深层侦察（Step 5未找到具体人名时**必须启用**）

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 5+.1 | 专利发明人反查（fips.ru/elibrary.ru） | 只有在 `browser_fetch_ok=true` 时，浏览器专属查询进入应执行集合；否则改查公开 PDF/证书/文件 | ☐ |
| 5+.2 | 公开文件/PDF/报价单/证书中搜索姓名、手机号、邮箱 | network-sentinel `fetch/browser-fetch` | ☐ |
| 5+.3 | **海关供应链指纹**（ImportGenius/Panjiva提单） | Yandex搜 | ☐ |
| 5+.4 | FSA.gov.ru → 搜索Declaration of Conformity | network-sentinel `browser-fetch/fetch` | ☐ |
| 5+.5 | 域名OSINT扫描（theHarvester，可用且有独立域名才执行，不可用/无输入写明原因） | terminal: theHarvester | ☐ |
| 5+.6 | 邮箱注册检测（holehe 有非通用个人邮箱才执行；Maigret 有人名/唯一用户名才执行） | terminal | ☐ |
| 5+.7 | 招聘署名、2GIS评论/分支信息、Telegram群组侦察 | network-sentinel `browser-fetch` | ☐ |

---

## Step 6 — 联系人存活性验证

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 6.1 | hh.ru 搜人名（是否在求职→可能离职） | 仅当 `browser_fetch_ok=true` 且已有明确人名时进入应执行集合 | ☐ |
| 6.2 | VK检查最后活动/当前雇主 | 仅当 `browser_fetch_ok=true` 且已有明确人名时进入应执行集合 | ☐ |
| 6.3 | 邮箱SMTP探测 | scripts/verify_email.py | ☐ |
| 6.4 | 2GIS交叉验证电话 | 仅当 `browser_fetch_ok=true` 且已有可验证电话时进入应执行集合 | ☐ |
| 6.5 | 输出：✅已验证/⚠️部分/❌未验证/🚫已失效 | — | ☐ |

---

## Step 7 — 全球品牌识别 + 中国采购证据

| # | 子步骤 | 工具/命令 | 状态 |
|---|--------|----------|------|
| 7.1 | **UN Comtrade海关数据**（俄罗斯从中国进口HS 8542等） | 只有在 `UN_COMTRADE_API_KEY` 存在时进入应执行集合 | ☐ |
| 7.2 | **elcp.ru合同**（查中国供应商） | network-sentinel `fetch/browser-fetch` | ☐ |
| 7.3 | 官网品牌/型号扫描（用brands_database.py35+品牌库） | scripts/check_china_purchase.py | ☐ |
| 7.4 | 型号前缀识别（STM32/GD32/XC7/TPS等50+前缀） | — | ☐ |
| 7.5 | 设备品类推断（安防→传感器+SoC+NPU） | — | ☐ |
| 7.6 | 输出：中国采购证据总分（满分40） | — | ☐ |

---

## Step 8 — 综合评分（100分制，诚实评分）

| # | 子步骤 | 状态 |
|---|--------|------|
| 8.1 | 中国采购证据(40分)：无证据=0，有型号=30，有海关数据=40 | ☐ |
| 8.2 | 采购需求-产品推断(20分)：无证据=0，有具体型号/产品证据最高20，仅品类推断最高10 | ☐ |
| 8.3 | 客户类型(20分)：制造商=20，分销商=10 | ☐ |
| 8.4 | 联系信息(20分)：已验证决策/采购联系人=20，姓名+公司邮箱=15，通用邮箱+电话=10，info@=5，仅电话=3，无=0 | ☐ |
| 8.5 | ⛔ 诚实检查：每个得分点是否有对应证据URL？无证据的维度是否=0？ | ☐ |
| 8.6 | 质量门槛：无INN/法人最高⭐⭐；制裁未完整最高⭐⭐；Step5未执行或应启Step5+未启=需复核 | ☐ |
| 8.7 | 输出：总分 + 星级 + 优先级；评分表各维度相加必须等于总分 | ☐ |

---

## Step 9 — 置信度 + 话术生成

| # | 子步骤 | 状态 |
|---|--------|------|
| 9.1 | 每条数据标注置信度（✅高/⚠️中/❌低） | ☐ |
| 9.2 | 生成俄语外联开场句（基于思维⑥信号映射） | ☐ |
| 9.3 | 数据质量自检表（每步工具调用次数+来源数+是否有编造） | ☐ |
| 9.4 | 输出完整报告 | ☐ |

---

## ⛔ 报告提交前最终检查

| # | 检查项 | 状态 |
|---|--------|------|
| F1 | 每个Step都有"执行记录"表格（序号/操作/工具/URL/结果） | ☐ |
| F2 | 每个Step都有"未完成项"说明（不能留空） | ☐ |
| F3 | 数据质量自检表已填写 | ☐ |
| F4 | 编造数据条数 = 0 | ☐ |
| F5 | 制裁状态已标注在报告顶部 | ☐ |
| F6 | 俄语外联话术已生成 | ☐ |
| F7 | **v4.8 信息完整性说明已填写**（成功/失败步数+信息缺口） | ☐ |
| F8 | 最终回复包含完整 fenced JSON、完整 Markdown、明文证据URL、`## 客户数据摘要` | ☐ |
| F9 | 最终回复没有只写“Analysis complete / Report delivered / report.html路径”短摘要 | ☐ |
| F10 | 每个来源执行记录含 network-sentinel `status/block_type/saved_body/route_group/route_node/transport`；浏览器来源注明 `cloakbrowser/playwright` 后端；CRM证据只写公开URL | ☐ |
| F11 | 报告单独包含 `Network Sentinel 预检结果`，并说明 `blocked_sources`、抓取层级、路由、被拦来源与替代来源 | ☐ |
| F12 | `hopeless/ip_burned` 只触发透明降级，不跳过 Step 5/必要 Step 5+ | ☐ |
| F13 | CRM摘要字段、执行结论、联系人、外联建议、`客户数据摘要` 均为中文主述；俄文仅作为短原文摘录或括注 | ☐ |
| F14 | 俄文证据行采用 `中文解释：...；原文：...；URL：...`，不得用整段俄文代替中文结论 | ☐ |

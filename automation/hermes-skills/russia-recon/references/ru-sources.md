# Russian B2B Data Sources — Reference (v2)

## Tier 1: Government / Official (最高可信度)

### zakupki.gov.ru
- **What**: Federal procurement portal — all government contracts
- **Best for**: Named procurement contacts with phone + email
- **Access**: Free, no login required for viewing
- **Limitation**: Only companies that participate in gov tenders
- **Search**: by INN, by company name, by region + industry code (ОКПД2)
- **OKPD2 codes for electronics**: 26 (Компьютеры, электронные и оптические изделия), 26.11 (Электронные компоненты), 26.20 (Компьютеры и периферия)
- **Tip**: Download the actual tender PDF — contact person is in the document header

### egrul.nalog.ru
- **What**: Federal Tax Service — official company registry
- **Best for**: Director name, company status (active/liquidated), founding date
- **Access**: Free, returns PDF extract
- **Limitation**: Only legal rep, no operational contacts

### clearspending.ru
- **What**: Aggregator of zakupki data — easier to search
- **Best for**: Quick lookup of procurement history and volumes
- **Access**: Free

### FSA.gov.ru (Росаккредитация)
- **What**: Federal Accreditation Service — Declarations of Conformity
- **Best for**: Finding technical/quality managers who signed off on imported components
- **Access**: Free, searchable by company name or INN
- **Value**: The person who signs the Declaration of Conformity is usually involved in procurement decisions

---

## Tier 2: Business Directories (中等可信度)

### rusprofile.ru
- **What**: Aggregated company data from multiple official sources
- **Best for**: Quick company overview, INN lookup, basic contact
- **Access**: Free for basic info, paid for full reports
- **Limitation**: Contact info often outdated
- **Rate limit**: 10-15 requests/hour safe limit

### list-org.com
- **What**: Company directory
- **Best for**: Phone numbers, sometimes email
- **Limitation**: Data freshness varies

### saby.ru (formerly SBIS)
- **What**: Business intelligence platform
- **Best for**: Second phone numbers, additional contacts
- **Access**: Free basic, paid full
- **URL**: saby.ru/profile/[INN]

### 2gis.ru
- **What**: Russian business map/directory
- **Best for**: Verified phone numbers, physical address
- **Access**: Free
- **Limitation**: Main switchboard only, not individual contacts

### zachestnyibiznes.ru
- **What**: Company registry aggregator
- **Best for**: Quick verification of legal rep and basic financials
- **Access**: Free
- **URL**: zachestnyibiznes.ru/company/ul/[OGRN]_[INN]

### cataloxy.ru
- **What**: City-based company directory
- **Best for**: Finding companies by region/city
- **Format**: `[city].cataloxy.ru/firms/[category]`
- **Example**: `ivanovo.cataloxy.ru/firms/electronics`
- **Access**: Free
- **Data**: Name, address, phone, website
- **Usage**: Good for regional prospecting

### tadviser.ru ⭐ 项目负责人发现源
- **What**: IT and industrial project news database (wiki-style)
- **Best for**: **Finding project managers and responsible persons** in project articles
- **Coverage**: Import substitution projects, industrial automation, IT projects
- **Access**: Free
- **Key feature**: Project articles often mention **specific person names** (project leads, technical directors)
- **Search**: `site:tadviser.ru [company name] проект` or `site:tadviser.ru импортозамещение [关键词]`
- **Example**: `tadviser.ru/index.php/Проект:Иркутский_авиационный_завод_(ИАЗ)` contains Mekhatronika CNC project info
- **Usage**: Find project → extract person name → verify on VK/hh.ru/rusprofile
- **Tip**: Project pages often have "участники" or "исполнители" sections with company names

### elcp.ru ⭐⭐⭐⭐⭐ 合同制造商和PCB供应商专业目录

**俄罗斯电子行业企业目录（B2B版） — 专业数据源！**

| 分类 | URL | 对你的价值 | 客户类型 |
|------|-----|-----------|----------|
| **合同制造商+PCB供应商** | `/catalog/anketa/contracts` | ⭐⭐⭐⭐⭐ **核心客户！** | 代工厂+PCB制造商 |
| 元器件制造商 | `/catalog/anketa/manufacturers` | ❌ 你的同行 | 制造商 |
| 分销商 | `/catalog/anketa/distributors` | ❌ 你的同行 | 分销商 |
| 设备制造商/分销商 | `/catalog/anketa/technics` | ⭐⭐⭐ 可能是客户 | 设备厂 |

**数据字段（非常完整）**：
- 公司名称、组织形式（АО/ООО）
- 业务类型、完整地址（地区/城市/街道）
- 电话、Email、网站
- 员工数量、更新日期

**Access**: Free
**Usage**: 直接生成合同制造商+PCB供应商名单 → 核心目标客户

---

### russianelectronics.ru ⭐⭐⭐⭐⭐ 最高价值客户数据库

**⚠️ 这是最重要的数据源！包含三个专业数据库**

| 数据库 | URL | 客户类型 | 元器件需求 |
|--------|-----|----------|------------|
| **PCB供应商数据库** | `/pcb-2022/` | 印制电路板制造商 | MCU、FPGA、电源芯片、连接器 |
| **合同制造商数据库** | `/kontraktnye-proizvoditeli-baza/` | 电子代工厂 | 各类元器件（按客户需求采购） |
| **元器件/模块制造商** | `/components_/` | ⚠️ 制造商 | 需评估是否采购 |

**PCB供应商和合同制造商是你的核心客户**：
- 他们需要采购大量元器件来完成订单
- 有明确的采购需求
- 数据库包含：公司名称、联系方式、技术能力

**Access**: Free
**Data**: Company name, contacts, technical capabilities, location
**Usage**: 直接生成目标客户名单

### productcenter.ru ⭐ 终端客户名单生成源

**⚠️ 关键：找的是采购电子元器件的终端客户，不是元器件制造商**

**正确目标分类**（你的客户）：

| 分类 | URL | 典型元器件需求 |
|------|-----|----------------|
| CNC数控机床 | `/producers/catalog-frieziernyie-stanki-chpu-2958` | MCU、FPGA、伺服驱动IC、编码器 |
| 工业控制系统 | `/producers/catalog-promyshliennoie-oborudovaniie-29` | PLC芯片、CAN/EtherCAT、传感器 |
| 家用电器 | `/producers/catalog-bytovaia-tiekhnika-eliektronika-26` | MCU、电源IC、显示驱动 |
| 医疗设备 | `/producers/catalog-mieditsinskoie-oborudovaniie-167` | ADC/DAC、MCU、精密传感器 |
| 测量仪器 | `/producers/catalog-izmieritielnyie-pribory-320` | ADC、FPGA、高精度传感器 |
| 通信设备 | `/producers/catalog-sviaz-306` | 射频芯片、以太网PHY、MCU |

**❌ 错误方向**（不要找这些）：
- `/producers/catalog-eliektronnyie-komponienty-286` → 元器件制造商（你的同行）
- `/producers/catalog-mikroskhiemy-1573` → 芯片设计公司

**按地区筛选**：添加 `r-[地区名]-[编号]` 到URL

---
- **What**: Russian yellow pages directory
- **Best for**: Finding manufacturers by category and city
- **Categories**:
  - `/list/radioelektronika/` — Radio electronics
  - `/list/elektro_i_energooborudovanie/` — Electrical equipment production
  - `/list/elektroizmeritelnye_pribory/` — Measurement instruments
- **City filtering**: `msk.yp.ru` (Moscow), `spb.yp.ru` (St. Petersburg)
- **Access**: Free
- **Data**: Name, address, phone, website, reviews
- **Usage**: Regional prospecting by industry category

---

**⚠️ 关键：找的是采购电子元器件的终端客户，不是元器件制造商**

**正确目标分类**（你的客户）：

| 分类 | URL | 典型元器件需求 |
|------|-----|----------------|
| CNC数控机床 | `/producers/catalog-frieziernyie-stanki-chpu-2958` | MCU、FPGA、伺服驱动IC、编码器 |
| 工业控制系统 | `/producers/catalog-promyshliennoie-oborudovaniie-29` | PLC芯片、CAN/EtherCAT、传感器 |
| 家用电器 | `/producers/catalog-bytovaia-tiekhnika-eliektronika-26` | MCU、电源IC、显示驱动 |
| 医疗设备 | `/producers/catalog-mieditsinskoie-oborudovaniie-167` | ADC/DAC、MCU、精密传感器 |
| 测量仪器 | `/producers/catalog-izmieritielnyie-pribory-320` | ADC、FPGA、高精度传感器 |
| 通信设备 | `/producers/catalog-sviaz-306` | 射频芯片、以太网PHY、MCU |

**❌ 错误方向**（不要找这些）：
- `/producers/catalog-eliektronnyie-komponienty-286` → 元器件制造商（你的同行）
- `/producers/catalog-mikroskhiemy-1573` → 芯片设计公司

**按地区筛选**：添加 `r-[地区名]-[编号]` 到URL，如：
- 莫斯科: `r-moskovskaia-obl-191/c-moskva-3109`
- 伊万诺沃: 搜索 "productcenter.ru producers Ivanovo"

**典型目标画像**：
- CNC机床制造商 → 需采购 MCU/FPGA/伺服驱动
- 工业控制系统厂 → 需采购 PLC芯片/通信模块
- 家电制造商 → 需采购 MCU/电源芯片
- 医疗仪器厂 → 需采购 ADC/传感器

**Data per company**: Name, address, website, phone, product categories
**Usage**: Scrape list → filter by industry → generate target list for russia-recon

### bugalter.ru
- **What**: Accounting-focused company directory
- **Best for**: Sometimes has additional contact persons beyond the legal rep
- **Access**: Free

### Контур.Фокус (focus.kontur.ru)
- **What**: Premium business intelligence platform
- **Best for**: Full company financials, all connected entities, full contact database
- **Access**: Paid subscription (~30,000 RUB/year)
- **Value**: If you can get access, this is the most complete source

---

## Tier 3: Job & Professional Platforms (需交叉验证)

### hh.ru (HeadHunter)
- **What**: Russia's largest job platform
- **Best for**: Department structure inference, occasional direct contacts
- **Search tip**: `[company name] снабжение` or `[company name] закупки` or `[company name] комплектация`
- **Key signal**: No procurement jobs found = no dedicated procurement dept → target CEO/CTO instead
- **Access**: Basic search free; full resume database requires employer account
- **Anti-scrape**: Moderate — use browser, not direct HTTP

### superjob.ru
- **What**: Second largest job platform
- **Best for**: Same as hh.ru, covers some companies hh.ru misses
- **Search tip**: Same queries as hh.ru
- **Access**: Free basic search

### rabota.ru
- **What**: Third major job platform
- **Best for**: Backup when hh.ru and superjob have no results
- **Access**: Free

### Avito Работа (avito.ru)
- **What**: Classifieds platform with active job section
- **Best for**: **Small companies (under 50 employees)** that don't post on hh.ru
- **Coverage**: Very strong for small manufacturers and workshops
- **Search**: `avito.ru [город] работа [关键词]` or browse company pages
- **Key value**: Small Russian manufacturers often ONLY post jobs here

### Habr Career (career.habr.com)
- **What**: IT/tech job platform
- **Best for**: Technical staff profiles — engineers, developers, CTO
- **Access**: Free
- **Unique value**: Users often list current employer + tech stack, useful for verifying tech decision-makers

---

## Tier 4: Social & Messaging Platforms (验证+触达)

### vk.com
- **What**: Russia's dominant social network
- **Best for**: Verifying person exists, finding personal Telegram link, confirming current employer
- **Search**: `vk.com/search` with name + company, or `site:vk.com "[全名]" "[公司名]"`
- **Key signals**: Check "Career" section for current employer, check last activity date (>1 year inactive = ⚠️)

### Telegram
- **What**: Primary communication tool for Russian B2B
- **Best for**: Direct outreach if handle found
- **Finding handles**: Check VK profile, company website, industry group memberships
- **Group search strategy**:
  - Search Telegram for: `закупки электронных компонентов`, `электроника закупка`, `комплектация ПП`, `снабжение электроника`
  - Join groups, observe posting patterns for 1-2 days
  - Identify frequent posters with procurement-sounding questions
- **Known procurement communities**: Search `@` + keywords in Telegram

### LinkedIn
- **What**: Professional network
- **Coverage for Russia**: Poor for mid-size manufacturers, better for large/tech companies
- **Post-2022**: Many Russian professionals deactivated accounts
- **Still useful for**: Technical directors, CTO-level at larger companies

---

## Tier 5: Industry-Specific Sources (行业垂直)

### TAdviser (tadviser.ru)
- **What**: IT and industrial project news database
- **Best for**: Finding project managers and technical leads mentioned in project coverage
- **Access**: Free (basic), paid for full reports
- **Search**: Search company name → find project articles → extract person names
- **Example**: TAdviser often covers import substitution projects with named responsible persons

### ExpoElectronica / Electronica Russia
- **What**: Major electronics trade show
- **Best for**: Exhibitor lists with contact persons
- **Search**: `ExpoElectronica [year] участники [company]`
- **Value**: Exhibitor registrations often include sales/procurement contact

### Иннопром (innoprom.com)
- **What**: Major industrial trade show in Yekaterinburg
- **Best for**: Industrial automation and manufacturing companies
- **Coverage**: Strong for Ural/Siberian industrial region

### МАКС (aviasalon.com)
- **What**: International Aviation and Space Salon (Zhukovsky)
- **Best for**: Aerospace supply chain companies
- **Coverage**: Exact target for MS-21 / aviation related prospects

### ПМЭФ (forumspb.com)
- **What**: St. Petersburg International Economic Forum
- **Best for**: Large company executives, government-connected businesses
- **Access**: Participant lists often published in news coverage

### АРПЭ (arpe.ru)
- **What**: Association of Russian Electronics Enterprises
- **Best for**: Member directory with verified contacts
- **Access**: Member list is public

### Минпромторг (minpromtorg.gov.ru)
- **What**: Ministry of Industry — list of strategic electronics manufacturers
- **Best for**: Identifying key players in government-supported sectors

---

## Tier 6: Supply Chain & Customs (供应链痕迹)

### ImportGenius / Panjiva
- **What**: Global customs data, bills of lading
- **Best for**: Finding consignee contacts, tracking intermediary companies
- **Access**: Paid (~$300/month)
- **Value**: Can see who is receiving what, through which intermediary

### Россия-Сеянс (seans.ru)
- **What**: Russian customs statistics
- **Best for**: Import/export data for specific companies
- **Access**: Partially free

### ВЭД-Статистика
- **What**: Foreign trade statistics
- **Best for**: Identifying companies importing specific HS codes (e.g., semiconductors)
- **Access**: Partially free

---

## Tier 7: Patent & Academic (专利与学术)

### Rospatent / FIPS.ru
- **What**: Official Russian patent database
- **Best for**: Finding inventors (= true technical decision-makers)
- **Search**: By company name or INN
- **Key extraction**: Inventor names from patent filings

### ResearchGate
- **What**: Academic paper database
- **Best for**: Finding "Correspondence author" emails
- **Search**: Company name + technical keywords

### eLibrary.ru
- **What**: Russia's largest scientific index
- **Best for**: Identifying active researchers within a company
- **Access**: Free registration

### Yandex Scholar / Google Scholar
- **What**: Academic search engines
- **Best for**: Finding papers by company-affiliated researchers
- **Search**: `[company name]` or `[person name]` + technical terms

---

## Anti-Block Tips

- Use residential proxies or VPN with Russian exit node for heavy scraping
- For zakupki: space requests 3-5 seconds apart
- For hh.ru: browser-based access only, avoid curl/wget
- For rusprofile: 10-15 requests/hour safe limit
- Always start with Google/Yandex search (`site:` operator) before hitting the source directly
- Use `web_fetch` tool first; fall back to browser automation only when blocked
- For Telegram: use the Telegram app directly, not web scraping

---

## Email Verification

Use `scripts/verify_email.py` to verify guessed email addresses via SMTP RCPT TO:
```bash
python3 scripts/verify_email.py v.leznov@mtronics.ru l.panchenko@mtronics.ru
python3 scripts/verify_email.py -f email_list.txt -o results.json
```

Note: Free email providers (mail.ru, yandex.ru, gmail.com) often block RCPT TO verification. Corporate domains usually allow it.

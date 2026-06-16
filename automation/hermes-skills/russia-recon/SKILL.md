---
name: russia-recon
version: 5.8
engine: lightpanda
# 5.8: CloakBrowser 首选浏览器后端 — browser-fetch/stealth-fetch 默认先试 CloakBrowser，再回退 Playwright/rebrowser
# 5.6: API Broker + Scrapling fallback 对齐 — api-* 主路径，scrapling-fetch 网页兜底，浏览器层最后
# 5.5: Scrapling 集成 — scrapling_fetcher.py 三级抓取 + 自适应选择器，CF绕过 + SSRF自动回退
# 5.4: yp.ru KillBot 防护 + preflight 超时处理 — DuckDuckGo Lite 回归为可用搜索源
# 5.3: 本地抓取增强 — network-sentinel check/fetch/browser-fetch 优先，lightpanda/browser_navigate 只兜底
# 5.2: Worker stdout contract — 禁止只返回“报告已交付/已生成”短摘要；最终必须直接输出完整 JSON+Markdown 报告
# 5.1: 源头质量门槛 — 代理7897、Step5/5+强制、制裁四态、评分硬上限
# 5.0: Diff 格式输出容错 — 反糊弄机制新增 diff 污染 pitfall + worker-data-contract 更新
# 4.9: 采购需求分析重构 — 海关实证(0或40)与产品推断(0-20)严格分离，不再混分
# 4.8: 四层容错体系（统一错误格式 + system_prompt规则 + 循环检测 + 降级透明）
description: |
  All-in-one OSINT skill for Russian B2B lead generation. Combines manufacturer-vs-distributor classification (6-dimension weighted scoring), mass-scale email pattern detection, deep-layer patent/customs reconnaissance, component requirement extraction, and a proven 6-mindset cognitive framework. Use when: researching any Russian company for B2B outreach, finding procurement contacts, verifying sanction status, extracting chip/model requirements, or crafting personalized outreach. Triggers on: company names in Russian or English, requests to "find contacts at", "挖掘联系人", "找采购负责人", domain names ending in .ru, or any B2B prospecting targeting Russian electronics/industrial market.
---

# Russia Recon — 俄罗斯 B2B 客户侦察一体化技能

> 从公司名单到可触达的决策人，一套完整流程。

---

## 六条核心思维（执行前必读）

### ① 「被迫公开」原则
不问"联系方式在哪"，问"这家公司在什么情况下**法律上或商业上不得不**公开真实联系人？"

强制公开场景：政府招标、工商注册、对外招聘、行业展会、可查合同、政府补贴申请。

**操作含义**：第一步找"强制性痕迹"，而不是搜"联系方式"。

### ② 「一点撬全局」原则
每个已验证数据点都是杠杆：邮箱 → 格式可推导全公司；INN → 招标/法院/关联公司；法人姓名 → VK/LinkedIn/hh.ru追踪；主线电话 → 转接确认。

### ③ 「数字身份一致性」原则
同一个人在不同平台的痕迹具有内在一致性。VK 找到姓名 → hh.ru 确认职位 → zakupki 找联系方式。多平台浅挖同一人，用一致性验证真实性。

### ④ 「绕过前台」原则
官网联系页信息价值最低。决策人联系方式藏在：技术文章/专利署名、展会嘉宾介绍、行业协会名录、招聘 JD 中的部门信息、政府会议记录。

### ⑤ 「规模决定目标层级」原则

| 员工规模 | 有无独立采购部 | 正确目标 | 判断依据 |
|---------|------------|---------|---------|
| < 50 人 | ❌ | **总经理 / 技术总监** | CEO/CTO 直接决策 |
| 50–200 人 | ⚠️ | **采购主管** | hh.ru 是否有采购岗 |
| 200–1000 人 | ✅ | **采购部** | 专职部门 |
| > 1000 人 | ✅ 有分层 | **品类采购经理** | 需确认电子元器件子部门 |

**关键推论**：hh.ru 搜不到采购岗 = 没有独立采购部，目标应上移至 CEO/CTO。

### ⑥ 「战略背景即话术」原则

| 发现的信号 | 外联切入角度 |
|-----------|------------|
| 产品使用制裁元器件（AD、TI、Murata 等） | "我们专注于 [型号] 的合规替代方案" |
| 参与政府进口替代项目 | "了解到贵公司参与 [项目名]，我们有相关元器件稳定供应渠道" |
| 近 1 年营收增长显著 | "恭喜快速增长，我们希望成为您扩产中的稳定元器件伙伴" |
| 正在招聘电子工程师/采购 | "注意到贵公司正在扩充团队，我们可提供元器件采购支持" |
| 法院有供应商纠纷 | "了解到供应链挑战，我们提供稳定备货服务" |

---

## 🛡️ 四层容错体系（v4.8 新增）

> 来源：Deep Research Agent 工程实践 + Claude Code 工具调用机制
> 核心理念：**容错不是 try/except，容错是让模型感知到失败，然后做出正确的决策。**

### 第一层：统一错误格式

**所有工具失败返回必须统一格式** — 让模型能识别失败信号：

```json
{
  "success": false,
  "error_type": "TIMEOUT",
  "error_message": "Search API timeout after 10s",
  "is_retryable": true,
  "suggestion": "Try a shorter or more specific query"
}
```

**错误类型枚举**（`scripts/failure_handler.py` — ErrorType）：

| 分类 | 枚举值 | 可重试 | 建议操作 |
|------|--------|--------|---------|
| 临时性 | TIMEOUT/RATE_LIMIT/SERVER_ERROR/NETWORK_ERROR/DNS_ERROR/PROXY_ERROR | ✅ | 指数退避重试（1s→2s→4s），最多3次 |
| 确定性 | NOT_FOUND/FORBIDDEN/SSL_ERROR/CAPTCHA/BOT_DETECTION/SPASIBO_ERROR/SPA_DETECTED/EMPTY_RESULT | ❌ | 不重试，换策略或标注信息缺口 |
| 引擎 | ENGINE_TIMEOUT | ✅ | 换引擎重试（lightpanda↔browser_navigate） |

**使用方式**：
```python
from scripts.failure_handler import ToolResult, classify_failure

# 包装工具调用结果
result = classify_failure("lightpanda_fetch", "https://rusprofile.ru/search",
                          response_text, http_status=200)

# 从异常自动推断
result = ToolResult.from_exception("browser_navigate", url, timeout_exception)
```

### 第二层：System_prompt 失败处理规则

**不应让模型自由发挥，必须在 system_prompt 里明确定义规则**：

```
工具调用失败处理规则（v4.8）：
1. 如果 is_retryable=True → 最多重试2次，重试前修改参数（换引擎/缩短query/换数据源）
2. 如果 is_retryable=False → 记录「信息缺口」，继续执行其他可用步骤
3. 如果同一工具在同一任务连续失败3次 → 停止调用该工具，报告中注明「以下信息未能获取」
4. 如果核心信息（制裁检查/INN确认）无法获取 → 主动告知用户，标注「无法完成」
5. 如果遭反爬/CAPTCHA → 不重试，立即切换至搜索引擎间接获取信息
6. 引擎超时 → 换引擎重试（lightpanda→browser_navigate），仍然失败则标注「引擎不可用」
```

### 第三层：循环检测（LoopDetector）

**防止模型进入死循环消耗 token**：

```python
from scripts.failure_handler import LoopDetector

detector = LoopDetector(window_size=5, similarity_threshold=0.9)

# 每次工具调用前检测
check = detector.check(tool_name="lightpanda_fetch", 
                       url="https://rusprofile.ru/search?query=INN",
                       success=False)

if check["is_loop"]:
    if check["action"] == "force_stop":
        print(detector.inject_prompt())  # 注入循环警告到模型prompt
        # → 强制换策略或终止任务
```

**检测层级**：
1. **精确匹配**：最近5步内有完全相同的 action → force_stop
2. **语义相似度**：action 相似度 > 90% → warn
3. **工具失败计数**：同一工具连续失败3次 → force_stop

**实际效果**：加入循环检测后，token 超量使用事故从每天3次降到接近0。

### 第四层：降级透明（DegradationReporter）

**有些信息就是拿不到，正确行为是透明告知，而非编造答案**：

```python
from scripts.failure_handler import DegradationReporter

reporter = DegradationReporter()
reporter.record_step("Step 3 制裁检查", True, tool_calls=4, successful_calls=4)
reporter.record_step("Step 5 社交痕迹", False, tool_calls=3, successful_calls=0,
                     gaps=["VK未找到决策人", "LinkedIn无结果"])

# 注入报告的信息完整性声明
print(reporter.generate_report())
```

**报告中的信息完整性声明**（强制在每个最终报告中包含）：
```
## 信息完整性说明
本次分析共执行 N 步，工具调用 X 次，成功获取 Y 条数据。

**以下信息未能获取**：
- [具体列出每项缺失信息]
建议通过人工渠道补充上述信息。

## 置信度说明
- 高置信度（≥2个信源交叉验证）：[列表]
- 中置信度（1个信源）：[列表]
- 信息不足（未能获取）：[列表]
```

**这个设计对应 Claude Code 的核心原则**：*"Be transparent about your limitations and uncertainties."*

---

## 执行流程

> **流程架构**：10步顺序执行，每步有明确的输入依赖、触发条件和失败处理。
> 核心原则：**每一步的输出 = 下一步的输入**，如果上一步没产出，必须走替代路径。

### ⛔⛔⛔ 强制前置：读取执行检查清单

**每次执行分析前，必须先调用 `skill_view(name='russia-recon', file_path='scripts/step_checklist.md')` 读取检查清单。**

这个检查清单包含所有9个步骤的**完整子步骤列表**（约60+个子项），按顺序逐项执行并勾选。

**为什么必须这样做**：
1. SKILL.md太长（4000+字），上下文压缩后子步骤容易丢失
2. 检查清单是精简版，只列子步骤+工具+勾选框，不含解释文字
3. 每个子步骤都是"工具调用"级别（具体到用什么命令搜什么网站），不会遗漏
4. 未勾选但属于“当前环境可执行且前提满足”的项 = 未执行，报告不合格

**执行顺序**：
1. `skill_view(name='russia-recon')` → 读取完整技能
2. `skill_view(name='russia-recon', file_path='scripts/step_checklist.md')` → **读取检查清单**
3. 用todo系统创建完整步骤列表（包含所有子步骤）
4. 逐项执行，每完成一个子步骤更新todo
5. 报告末尾附检查清单勾选状态

### ⛔ 源头质量硬门槛（v5.1）

1. **代理固定为 7897**：所有 HTTP/Lightpanda 调用使用 `http://127.0.0.1:7897`；SMTP/SOCKS 工具使用 `socks5://127.0.0.1:7897`。禁止把其他端口写成默认端口。
2. **Step 5 强制执行**：无论官网是否已有 `info@`、电话、WhatsApp 或 Telegram，都必须执行 Step 5，目标是寻找具体决策人/采购人。
3. **Step 5+ 条件强制**：Step 5 没找到具体人名时，必须进入 Step 5+。如果某个深层工具不可用，写明工具不可用和替代动作；不能写“未启用/不适用”直接结束。
4. **联系人分类只能三选一**：
   - `已验证联系人`：有人名 + 职位/公司关联 + 邮箱/电话/社交入口，且有来源URL。
   - `入口联系人`：只有公司公开邮箱、电话、WhatsApp、Telegram bot、表单或总机。
   - `未找到`：没有可触达入口。
   未署名的“CEO/owner”不能当作联系人姓名。
5. **制裁结论四态**：只能输出 `CLEAR` / `PARTIAL_CLEAR` / `UNKNOWN` / `HIT`。OpenSanctions+OFAC+EU+UK 都完成且无命中才可写 `CLEAR`；EU或UK未完成时最多写 `PARTIAL_CLEAR`。
6. **评分硬上限**：无 INN 或法人时最高 `⭐⭐`；制裁未完整检查最高 `⭐⭐`；Step 5 未执行或 Step 5+ 应启未启时标记 `需复核`，不得进入高优先级。
7. **评分算术一致**：评分表各维度相加必须等于总分。禁止出现“维度上限20但有效得分43”这类矛盾。

### ⛔ Network Sentinel 抓取优先规则（v5.3）

本技能运行在本地链路时，页面获取必须优先使用 `/Users/ylf/Desktop/projects/network-sentinel`，它是 russia-recon 专用抓取辅助工具，不是通用网关。

**每次任务固定前置动作**：

```bash
cd /Users/ylf/Desktop/projects/network-sentinel
python3 -m network_sentinel.cli check --proxy http://127.0.0.1:7897 --timeout 15
python3 -m network_sentinel.cli browser-check
python3 -m network_sentinel.cli route-check "<PUBLIC_URL>" --route auto
```

**⚠️ 实战坑：preflight timeout（2026-05-14）**：
- `check --timeout 15` 可能因代理延迟或网络状态返回 exit 124（超时）
- 此时不要反复重试 preflight — 直接进入 `fetch`/`browser-fetch` 抓取阶段，各 URL 的抓取结果自然反映站点可达性
- 报告中写明「network-sentinel preflight 超时（exit 124），已跳过预检直接抓取」，无需为此阻断流程

**能力门控规则（v5.8）**：

- `browser-check` 返回的 `playwright_runtime_ok/browser_fetch_ok/stealth_fetch_ok/cloakbrowser_ok` 是硬前提，不是建议。
- `browser_fetch_ok=false` 时，hh.ru / 2GIS / VK / rusprofile / 专利浏览器页等来源不进入当前任务的应执行集合；必须改走 API Broker、官方公开源、官网、Scrapling、fetch 等替代链路。
- `cloakbrowser_ok=true` 时，`browser-fetch` / `stealth-fetch` 默认优先使用 CloakBrowser 后端。执行记录里写明 `transport=cloakbrowser` 或 fallback 到 `transport=playwright`。
- `cloakbrowser_ok=false` 但 `browser_fetch_ok=true` 时，可继续用旧 Playwright/rebrowser 后端；这是浏览器后端降级，不是来源本身无结果。
- `stealth_fetch_ok=false` 时，不要承诺 `stealth-fetch` 重试。
- 没有唯一用户名时，`Maigret` 不是必跑项；没有非通用个人邮箱时，`holehe` 不是必跑项；没有 `UN_COMTRADE_API_KEY` 时，Comtrade 不是必跑项。
- `未执行` 只用于本轮环境和输入都允许执行、但实际漏掉的检查。前提不满足要写清原因，而不是笼统写未执行。

**API Broker 与抓取命令**：

```bash
python3 -m network_sentinel.cli credentials doctor --no-subscriptions
python3 -m network_sentinel.cli api-search "<QUERY>" --free-only
python3 -m network_sentinel.cli api-sanctions --name "<LEGAL_OR_COMMON_NAME>" --inn "<INN>"
python3 -m network_sentinel.cli api-registry --name "<LEGAL_OR_COMMON_NAME>" --inn "<INN>"
python3 -m network_sentinel.cli api-hiring --company "<COMPANY_NAME>"
```

执行顺序固定为：

1. `api-search / api-sanctions / api-registry / api-hiring`
2. `scrapling-fetch`
3. `fetch`
4. `browser-fetch`
5. `stealth-fetch`

**统一抓取命令**：

```bash
python3 -m network_sentinel.cli scrapling-fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text
python3 -m network_sentinel.cli fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text
python3 -m network_sentinel.cli browser-fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text --screenshot
python3 -m network_sentinel.cli stealth-fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text --screenshot
```

`browser-fetch` / `stealth-fetch` 默认等价于 `--backend auto`：先试 CloakBrowser，只有 CloakBrowser 运行时错误才回退 Playwright/rebrowser。需要对照测试时可显式加 `--backend cloak` 或 `--backend playwright`。

**路由感知规则（US/RU/DIRECT）**：

- network-sentinel 会通过 Clash Verge/Mihomo Unix socket `/tmp/verge/verge-mihomo.sock` 读取当前 `US` / `RU` / `DIRECT` 状态；不要手工改全局节点。
- `.ru/.su/.by/.kz` 和 `rusprofile/zachestnyibiznes/2GIS/yp/hh/VK/Yandex` 默认标记 `route_group=RU`；OpenSanctions/OFAC/EU/UK/Google 默认标记 `route_group=US`；localhost/127.0.0.1 默认 `DIRECT`。
- 每个来源执行记录必须保留 `route_policy`、`route_group`、`route_node`、`route_warning`。被拦时要区分是 `RU出口被拦`、`US出口被拦`、站点验证码还是自动化识别，不得写成“无结果”。
- 某个 RU 源返回 `blocked` 后，只允许为了判断路线问题改 `--route us` 复测一次；随后必须切换替代来源，不继续撞同域名。

**四级抓取顺序**：

1. API Broker：搜索、制裁、工商、招聘优先走 `api-*`
2. 官方网页 / 静态正文 / 网页证据补充：`scrapling-fetch`
3. 轻量旧抓取兜底：`fetch`
4. JS 重站/搜索/地图/招聘：仅当 `browser_fetch_ok=true` 时使用 `browser-fetch`
5. 普通浏览器被自动化识别时：仅当 `stealth_fetch_ok=true` 时使用 `stealth-fetch`
   - `cloakbrowser_ok=true` 时优先 CloakBrowser 后端
   - CloakBrowser 运行时失败才降级到 Playwright/rebrowser
6. 仍被拦时：立即切换替代源，不重复撞同一站点

**站点策略**：

| 来源 | 优先命令 | 说明 |
|---|---|---|
| OpenSanctions / OFAC / EU / UK 官方网页 | `api-sanctions`，需要网页证据时 `scrapling-fetch` | 制裁主路径先走官方下载与 API Broker |
| 官网静态页 / PDF 索引页 | `scrapling-fetch`，失败再 `fetch` / `browser-fetch` | 保存正文供复盘 |
| 工商公开来源 | `api-registry` | 先走 ФНС / BO.Nalog 公开服务，不把商业聚合站当主路径 |
| rusprofile / list-org / saby / yp.ru | `browser-fetch`，被自动化识别再 `stealth-fetch` | 俄语工商/黄页站通常需要浏览器 |
| 搜索 | `api-search` | Brave -> Tavily -> Exa；网页搜索页只作最后兜底 |
| Yandex / 2GIS / hh.ru / VK | `browser-fetch`，被自动化识别再 `stealth-fetch` | 搜索、地图、招聘、社交优先浏览器抓取 |

**会话级阻断状态（v5.4 执行层）**：

每个任务必须在执行记录中维护一个轻量状态对象：

```json
{
  "blocked_sources": {},
  "session_state": {
    "inn": "",
    "domain_is_independent": false,
    "has_product_page": false,
    "ip_burned": false,
    "hopeless": false,
    "step_skipped": []
  }
}
```

执行规则：

- 同一域名返回 `blocked/captcha/403/KillBot` 后写入 `blocked_sources`，本任务后续不再重复调用该域名，除非切换了抓取层级且只重试一次。
- `*.yp.ru`、`*.2gis.ru`、`*.b2b.*` 识别为黄页域名，不当作官网死抓；优先用公司名、子域名前缀、电话或 INN 找真实官网与工商源。
- 无 INN 不跑 INN 依赖深挖；无独立域名不跑 theHarvester；没人名/用户名不跑 Maigret；无邮箱不跑 holehe。
- `ip_burned=true` 只表示当前代理对多数高风控源不可用，不等于无数据；仍必须继续抓 `api-search`、`api-registry`、官网、OpenSanctions、公开 PDF/缓存页。
- `hopeless=true` 只能触发快速降级评分，不能跳过 Step 5 入口联系人检查；Step 5 与必要 Step 5+ 仍需有执行记录。

**⚠️ yp.ru KillBot 防护（2026-05-14 实战发现）**：
- yp.ru（俄罗斯黄页）使用 KillBot 反爬系统而非普通的 Cloudflare/captcha
- KillBot 特征：返回 `KillBot user verification` 标题 + 页面内大量随机化 class 名 + `kbErrors` JS 变量
- `lightpanda` 和 `curl` 均被 KillBot 拦截，SSR 页面也返回验证页面
- **yp.ru 被 KillBot 阻断时 ≠ 公司信息不可查**：优先用 `api-search` 搜公司名/子域前缀；只有 API 搜索全部不可用时，才把 DuckDuckGo Lite 当作遗留网页兜底。

**结果处理**：

1. `status=ok`：读取 `saved_body` 内容做分析；报告证据 URL 必须写原始公开 URL，不写本地文件路径作为证据。
2. `status=blocked`：记录 `block_type`（如 `recaptcha`、`smartcaptcha`、`http_403`、`killbot`、`cloudflare`、`empty_js_shell`）；如果还没试过 `stealth-fetch`，只允许升级一次；仍被拦后立即转替代来源。
3. `status=error`：才允许使用原有 `lightpanda` / `browser_navigate` 兜底；兜底失败也要写入执行记录。
4. 如果 preflight 显示关键站点大面积 `blocked`，仍继续抓可访问来源，但报告必须透明写明哪些来源未完成，禁止写“全部已查”或高置信结论。
5. 每个 Step 的执行记录必须包含工具名、公开 URL、`status`、`block_type`、`saved_body`（可作为本地复盘路径），但 CRM 证据字段只写公开 URL。
6. 当 `rusprofile` / `2GIS` / `Yandex` 被拦截时，不得把整步写成“无结果”。必须先切换到 `api-search`、`api-registry`、官网、OpenSanctions、官方公开下载等仍可访问来源继续补事实，再把被拦原因写进未完成项。
7. 报告中必须单独写出一段 `Network Sentinel 预检结果`，至少包含 `verdict`、`blocked_sources`、被拦来源、抓取层级、`route_group/route_node`、以及继续使用的替代来源。

### ⛔ Worker 输出交付硬规则（v5.2）

当本技能由 `recon_agent_worker.py` / Hermes worker 调用时，最终回复会被 worker 直接解析。**最终回复必须是完整机器可解析报告正文，不是状态摘要。**

1. 最终回复第一段必须是 fenced JSON：以 ```` ```json ```` 开始，包含 worker prompt 要求的结构化字段。
2. JSON 后必须紧跟完整中文 Markdown 报告正文，包含可见明文 `http://` 或 `https://` 证据 URL。
3. 禁止只输出：
   - `Analysis complete`
   - `Report delivered to worker`
   - `Report saved/generated at .../report.html`
   - 只有 Summary/Score/Contact 的短摘要
4. 禁止声称“已保存 HTML/已交付给 worker”。模型不能写文件；它只能把完整 JSON+Markdown 报告打印到 stdout，由 worker 保存。
5. 没有任何明文证据 URL 的输出视为失败。即使搜索失败，也必须列出实际尝试过的查询 URL、官网 URL、制裁搜索 URL 或工具不可用说明。
6. 报告末尾必须包含 `## 客户数据摘要`，逐行 `field: value`，不得省略。
7. 报告必须中文主述。每个 Step 的执行结论、分析、评分、联系人、外联建议、`## 客户数据摘要` 字段值必须用自然中文表达。
8. 俄文只保留在法定名称、职位原称、页面标题、短原文摘录和 URL 附近；不要把长段俄文直接作为结论、摘要或建议。
9. 引用俄文来源时使用固定结构：`中文解释：...；原文：...；URL：https://...`。
10. CRM 摘要字段必须中文优先：`industry`、`products`、`description`、`contacts_summary`、`contact_title`、`outreach_angle`、`next_action`、`notes`。职位可写成 `物资技术供应总监（Директор по МТО...）`。

### 前置步骤：目标名单生成

如果用户没有提供具体公司名单，先从**制造商名录网站**批量生成目标列表。

### 📋 流程总览与依赖关系

```
Step 0 (类型判定)
  ↓ [判定为制造商 → 继续 / 分销商 → 终止]
Step 1 (身份锚定) → 产出: INN/法人/规模
  ↓ [有INN → 走俄罗斯路径 / 无INN → 走海外路径]
  ├→ Step 2 (政府采购) [依赖: INN或公司名]
  └→ Step 3 (制裁检查) [无前置依赖，必须独立完成]
  ↓
Step 4 (数字足迹+元器件) → 产出: 产品页内容、招聘信息、邮箱
  ↓
Step 5 (社交痕迹，强制执行) → 产出: 具体人名/入口联系人/未找到
  ↓
  [Step 5没找到人? → 启用 Step 5+ (深层侦察)]
  ↓
Step 6 (联系人验证) [依赖: Step 5的人名/联系方式]
  ↓
Step 7 (品牌识别+中国采购) [依赖: Step 4的产品页内容]
  ↓
Step 8 (综合评分) [依赖: Step 7分数 + Step 0类型 + Step 4需求 + Step 6联系]
  ↓
Step 9 (置信度+话术)
```

### 🔀 海外注册公司替代路径

当 Step 1 在 rusprofile/egrul 找不到公司时（海外注册），自动切换：

| 标准路径 | 海外替代路径 |
|---------|------------|
| rusprofile.ru | Yandex搜 "公司名 INN site:rusprofile.ru OR site:list-org.com" |
| egrul.nalog.ru | Craft.co / D&B (Dun & Bradstreet) |
| saby.ru | RocketReach / LinkedIn Company Page |
| zakupki.gov.ru (用INN) | zakupki.gov.ru (用公司名) + Yandex搜 "公司名 contract OR procurement" |

> ⚠️ **搜索执行说明（v5.6）**：默认不要直接把 Yandex/Google/DuckDuckGo 搜索结果页当主路径。优先使用 `python3 -m network_sentinel.cli api-search "<QUERY>" --free-only`。只有在 API 搜索无 key、配额耗尽或结果不足时，才允许使用一次网页搜索兜底。

### 🔄 分析中断恢复流程（v4.3 新增）

当分析因模型切换、会话超时或其他原因中断时，不要从头开始：

1. **检查已保存的会话文件**：`~/.hermes/sessions/session_[时间戳].json`
2. **提取已完成步骤**：搜索会话文件中的 tool 调用记录和 todo 列表状态
3. **定位中断点**：查找最后一个 tool 响应后未处理的 assistant 消息
4. **恢复执行**：从中断点继续，不重复已完成步骤
5. **关键检查**：重新确认制裁结果（Step 3）是否已完成——这是无法"推断"的关键步骤

**注意事项**：
- 不要信任 todo 状态的字符串标记，要检查实际 tool 调用记录确认步骤是否真实执行
- Step 3（制裁）如果有任何工具调用记录显示实际检查过，可以复用结果
- 产品页数据（Step 4）通常会被缓存，可以重用，但社交数据（Step 5）建议重新获取
- 如果无法确认某步是否完成，宁可重做也不要"猜"

| 步骤 | 如果失败了 | 处理方式 | 容器类型 |
|------|-----------|---------|---------|
| Step 1 | 没找到INN | 走海外替代路径，用公司名+域名继续 | NOT_FOUND → 换源 |
| Step 2 | 没找到具体人 | 写"纯民营企业"（**注意**：OKVED 25.xx军工企业合同走ГОЗ国防采购系统不公开，此时标注"国防采购数据不公开"而非"无政府采购"） | EMPTY_RESULT → 记录缺口 |
| Step 3 | 某个制裁源无法访问 | 用剩余源继续，标注"XX源未检查" | 引擎/网络错误 → 换源 |
| Step 5 | 没找到具体人 | 必须启用Step 5+深层侦察 | EMPTY_RESULT → 升级 |
| 官网页面 | 404或无内容 | 最多重试1次，立即转向外部数据源（hh.ru/Yandex/rusprofile） | NOT_FOUND/SPASIBO → 1次重试 |
| 子代理 | 超时（>600秒） | 主代理直接接管执行，不再委派 | ENGINE_TIMEOUT → 降级 |
| Step 6 | 无联系人可验证 | 写"无法验证，仅有官网公开信息"，不编造 | EMPTY_RESULT → 降级透明 |

> ⚠️ **全流程容器规则**：使用 `scripts/failure_handler.py` 的 ToolResult 统一包装每个工具调用的返回。遇到可重试错误自动指数退避，确定性错误立即换策略。详细信息见上方「四层容错体系」章节。

### ⚡ 浏览器引擎选择

| 引擎 | 速度 | 内存 | 适用场景 |
|------|------|------|--------|
| **Scrapling Fetcher** ⭐新增 | 快 | 低 | HTTP快速抓取，TLS指纹伪装，60%场景首选 |
| **Scrapling Stealthy** ⭐新增 | 慢(20-80s) | 中 | Cloudflare Turnstile绕过，rusprofile等 |
| **Lightpanda** | 10x | 9x 低 | 高速抓取、大规模并发 |
| Chrome (browser_navigate) | 标准 | 标准 | 复杂 JS 渲染、需要登录 |

> ⚠️ **工具边界（2026-05-29 补充）**: network-sentinel / scrapling-fetch / CloakBrowser 等工具设计目标为**俄罗斯本地工商/搜索网站**（rusprofile、elcp、Yandex、VK 等）。全球元器件分销商（LCSC、DigiKey、Mouser）使用企业级 CDN WAF（CloudFront/Cloudflare Enterprise/DataDome），防护级别完全不同。**不要用本技能的工具链去抓取全球分销商**——全部会触发拦截。对于元器件定价查询，使用 `component-market-analysis` 技能或 Camoufox。

**推荐抓取策略（v5.5）**：
1. **API-first 主路径** → `api-search / api-sanctions / api-registry / api-hiring`
2. **静态/API补证据/公开正文页** → `scrapling-fetch` 或 `scrapling_fetcher.fetch()` — HTTP快速，TLS伪装
3. **复杂JS/SPA** → `browser_navigate` 或 `browser-fetch` — 完整渲染
4. **高并发或批量旧链路** → `lightpanda` — 批量抓取

> ⚠️ Scrapling 集成 (v5.5)：已安装 v0.4.8 (Python 3.12, GitHub 最新)。适配脚本：`scripts/scrapling_fetcher.py`。自动处理SSRF代理回退、KillBot/CF检测、自适应选择器。

**⚠️ 实战发现的引擎陷阱（v4.2 新增, v4.3 补充, v4.5 SPA检测）**：

| 场景 | 问题 | 解决方案 |
|------|------|---------|
| SPA官网产品详情页 | lightpanda抓到404（URL在SPA内不独立存在） | 用browser_navigate点击导航进入，而非直接URL |
| SPA站点子页面（如/about/requisites/） | 浏览器browser_navigate直接URL也404 | SPA路由可能完全不暴露独立URL——browser_click从首页导航栏进入；如仍然404，页面可能确实不存在或需登录，标注「页面不可达」并依赖rusprofile获取法定信息 |
| trassir.com/en双语言站 | 产品子页面直接URL全是404 | 用browser_navigate + 点击导航，或改查俄语站 |
| SPA官网产品详情页 | lightpanda抓到404（URL在SPA内不独立存在） | 用browser_navigate点击导航进入，而非直接URL |
| SPA站点子页面（如/about/requisites/） | 浏览器browser_navigate直接URL也404 | SPA路由可能完全不暴露独立URL——browser_click从首页导航栏进入；如仍然404，页面可能确实不存在或需登录，标注「页面不可达」并依赖rusprofile获取法定信息 |
| trassir.com/en双语言站 | 产品子页面直接URL全是404 | 用browser_navigate + 点击导航，或改查俄语站 |
| **俄语JS网站侧边栏导航** | Accessibility click on sidebar category links 不触发页面跳转（JS事件绑定） | 用 `browser_console` + `document.querySelectorAll('a')` 提取所有带href的链接，找到目标分类的URL后直接 `browser_navigate` |
| **elcp.ru SSL错误** | SSL证书错误导致无法访问 | 尝试http:// 协议；如果失败则标注"elcp.ru SSL异常，未检查" |
| **SPA网站（v4.5新增）** | lightpanda返回内容<200字但无报错 | 检测方法：如果lightpanda输出字数<200且只含导航菜单/框架HTML → 标注「SPA网站，lightpanda无法抓取动态内容」，改用browser_navigate或搜索引擎间接获取 |
| SPA官网产品详情页 | lightpanda抓到404（URL在SPA内不独立存在） | 用browser_navigate点击导航进入，而非直接URL |
| SPA站点子页面（如/about/requisites/） | 浏览器browser_navigate直接URL也404 | SPA路由可能完全不暴露独立URL——browser_click从首页导航栏进入；如仍然404，页面可能确实不存在或需登录，标注「页面不可达」并依赖rusprofile获取法定信息 |
| trassir.com/en双语言站 | 产品子页面直接URL全是404 | 用browser_navigate + 点击导航，或改查俄语站 |
| SPA官网产品详情页 | lightpanda抓到404（URL在SPA内不独立存在） | 用browser_navigate点击导航进入，而非直接URL |
| SPA站点子页面（如/about/requisites/） | 浏览器browser_navigate直接URL也404 | SPA路由可能完全不暴露独立URL——browser_click从首页导航栏进入；如仍然404，页面可能确实不存在或需登录，标注「页面不可达」并依赖rusprofile获取法定信息 |
| trassir.com/en双语言站 | 产品子页面直接URL全是404 | 用browser_navigate + 点击导航，或改查俄语站 |
| **俄语JS网站侧边栏导航** | Accessibility click on sidebar category links 不触发页面跳转（JS事件绑定） | 用 `browser_console` + `document.querySelectorAll('a')` 提取所有带href的链接，找到目标分类的URL后直接 `browser_navigate` |
| **elcp.ru SSL错误** | SSL证书错误导致无法访问 | 尝试http:// 协议；如果失败则标注\"elcp.ru SSL异常，未检查\" |

**⚠️ 引擎选择规则（避免子代理超时）**：

| 目标网站 | 推荐引擎 | 原因 |
|---------|---------|------|
| rusprofile.ru | Lightpanda | 简单渲染，速度快 |
| list-org.com | Lightpanda | 可能403，快速失败即可 |
| **zakupki.gov.ru** | **browser_navigate** | JS渲染重，lightpanda易超时 |
| **hh.ru** | **browser_navigate** | 复杂SPA，lightpanda抓取不完整 |
| 官网（简单静态） | Lightpanda | 快速 |
| 官网（复杂JS/React） | browser_navigate | 需要完整渲染 |
| OpenSanctions | Lightpanda | 内容型页面，足够 |

**子代理超时防护**：
- delegate_task 单任务目标不超过 3 个网站
- 政府网站（zakupki.gov.ru）+ 复杂JS网站（hh.ru）拆成独立任务
- 每个子代理最多 4 个工具调用（超 4 个就拆分）
- 主代理直接执行的优先级高于子代理（关键步骤不委派）
- **子代理中断恢复**：如果子代理被中断（~590秒超时或系统打断），检查 `result.tool_trace` 获取其部分工作成果，不完全丢弃——最后一次成功的工具调用可能已有重要数据
- **check_china_purchase.py 超时**：该脚本对复杂网站可能超时（>180秒），如果超时，手动执行品牌库/型号前缀扫描代替

**Lightpanda 命令**：
```bash
# 抓取公司信息
lightpanda fetch --dump markdown --wait-until networkidle --http-proxy http://127.0.0.1:7897 "https://rusprofile.ru/search?query=INN"

# 抓取目录页
lightpanda fetch --dump markdown "http://www.elcp.ru/catalog/anketa/contracts"

# 抓取产品页提取元器件型号
lightpanda fetch --dump markdown --http-proxy http://127.0.0.1:7897 "https://company.ru/products.html"
```

### 📊 UN Comtrade API 配置（中国采购证据检查）

**申请API Key**：
1. 访问 https://comtradedeveloper.un.org
2. 注册账号（免费）
3. 获取订阅密钥（Subscription Key）
4. 保存到配置文件：`~/.hermes/config.yaml`

**API Key配置**：
```yaml
comtrade:
  api_key: "your-subscription-key-here"
  # 免费额度：500条预览/月
  # 付费额度：250K条/月
```

**安装依赖**：
```bash
pip3 install comtradeapicall
```

**测试API**：
```python
import comtradeapicall

# 查询俄罗斯从中国进口集成电路（HS 8542）
df = comtradeapicall.previewFinalData(
    typeCode='C', freqCode='A', clCode='HS',
    period='2023', reporterCode='643', partnerCode='156',
    cmdCode='8542', flowCode='1'
)
print(df.head())
```

### ⭐⭐⭐⭐⭐ 最高价值来源**

### 1. russianelectronics.ru

| 数据库 | URL | 客户类型 | 为什么是你的客户 |
|--------|-----|----------|------------------|
| **PCB 供应商** | `/pcb-2022/` | 印制电路板制造商 | 需采购 MCU/FPGA/电源芯片做PCB |
| **合同制造商** | `/kontraktnye-proizvoditeli-baza/` | 电子代工厂 | 需采购元器件完成客户订单 |

### 2. elcp.ru（电子行业目录）

| 分类 | URL | 对你的价值 |
|------|-----|-----------|
| **合同制造商+PCB 供应商** | `/catalog/anketa/contracts` | ⭐⭐⭐⭐⭐ **核心客户！** |
| 设备制造商/分销商 | `/catalog/anketa/technics` | ⭐⭐⭐ 可能是客户 |

---

⚠️ **关键**：找的是**采购电子元器件的终端客户**，不是元器件制造商。

**正确目标**（你的客户）：

| 分类 | URL | 典型元器件需求 |
|------|-----|----------------|
| **CNC 数控机床** | `/producers/catalog-frieziernyie-stanki-chpu-2958` | MCU、FPGA、伺服驱动、编码器 |
| **工业控制系统** | `/producers/catalog-promyshliennoie-oborudovaniie-29` | PLC 芯片、通信模块、传感器 |
| **家用电器** | `/producers/catalog-bytovaia-tiekhnika-eliektronika-26` | MCU、电源芯片、显示驱动 |
| **医疗设备** | `/producers/catalog-mieditsinskoie-oborudovaniie-167` | ADC/DAC、MCU、传感器 |
| **测量仪器** | `/producers/catalog-izmieritielnyie-pribory-320` | ADC、FPGA、高精度传感器 |
| **通信设备** | `/producers/catalog-sviaz-306` | 射频芯片、以太网芯片 |

**错误方向**（不要找这些）：
- ❌ `/producers/catalog-eliektronnyie-komponienty-286` — 元器件制造商（你的竞争对手）
- ❌ `/producers/catalog-mikroskhiemy-1573` — 芯片设计公司

按地区筛选：添加 `r-[地区名]-[编号]` 到 URL，如：
- 莫斯科：`r-moskovskaia-obl-191/c-moskva-3109`
- 伊万诺沃：`r-ivanovskaia-obl-[编号]`

**提取方法**：
```bash
curl -s "https://productcenter.ru/producers/catalog-eliektronnyie-komponienty-286" | grep -o 'href="/producers/[^"]*"' | sed 's/href="//;s/"$//' | head -50
```

每个链接指向公司页面，包含：名称、地址、网站、电话。

---

### Step 0 — 客户类型判定（必须执行）

> **执行前提**：先提取员工规模 → 套用思维⑤ → **确定目标职位** → 再开始判定。

**目标**：在投入 Step 1-9 之前，先判定公司是**制造商**还是**纯分销商**，避免浪费时间在非目标客户上。

**6 维度加权打分**：

| 维度 | 权重 | 判定依据 | 证据来源 |
|------|------|---------|----------|
| **产品所有权** | ⭐⭐⭐ 最高 | 有自主品牌 = ✅，只代理 = ❌ | 官网产品页、品牌名、商标 |
| **技术文档类型** | ⭐⭐ 高 | BOM/原理图/固件 = ✅，只有手册 = ❌ | 官网文档、产品规格书 |
| **ОКВЭД 主码** | ⭐ 中 | 仅作参考，不能单独判定 | rusprofile/saby |
| **地址类型** | ⭐ 中 | 工厂/车间 = ✅，只有办公室 = 不确定 | 2GIS/官网/地图 |
| **招聘岗位** | ⭐ 中 | 工程/生产岗 = ✅，只有销售 = ❌ | hh.ru |
| **认证资质** | ⭐ 低 | ISO 9001 生产认证 = ✅ | 官网/认证机构 |

**关键原则**：
- **产品所有权是决定性维度**。有自主品牌产品 = ✅（无论 ОКВЭД 是什么码）
- **ОКВЭД 仅作参考**，不能单独判定（PROMPOWER 主码 46.69 贸易，但实际生产自有品牌）
- **技术文档是第二重要维度**。有 BOM/原理图/固件 = ✅ 生产

**判定结果**：
- ✅ **制造商**（产品所有权 ✅ + ≥2 其他 ✅）→ 继续
- ✅✅ **制造商+分销商**（自有品牌 + 代理品牌）→ **最高优先级**
- ❌ **纯分销商**（产品 ❌ + ≥3 ❌）→ **排除，不进入后续层**
- 🟡 **分销商+增值服务**（分销为主，但同时提供合同制造/PCB/电子开发/天线设计等消耗元器件的服务）→ **继续但标注「分销商+」，在Step 7/8评分时客户类型维度上限降为15分（混合型）**
- ⚠️ **不确定** → 继续，但标注

> ⚠️ **分销商+ 判定关键**：如果公司官网明确列出"контрактное производство / разработка электроники / производство печатных плат / контрактная сборка"等服务，说明该公司在生产服务场景下**实际消费元器件**，应标注为「分销商+」而非纯分销商，继续全流程但评分适当下调。

**输出格式**（必须在报告最前面显示）：
```markdown
## 客户类型判定

| 维度 | 证据 | 结论 |
|------|------|------|
| 产品所有权 | [具体品牌名/产品名] | ✅/❌ |
| 技术文档 | [BOM/原理图/手册/无] | ✅/❌ |
| ОКВЭД 主码 | [代码 + 描述] | ⚠️ 参考 |
| 地址类型 | [工厂/办公室/未知] | ✅/⚠️/❌ |
| 招聘岗位 | [工程/生产/销售/无] | ✅/⚠️/❌ |
| 认证资质 | [ISO/其他/无] | ✅/⚠️/❌ |

**判定结果**: ✅ 制造商 / ✅✅ 制造商+分销商 / ❌ 纯分销商 / ⚠️ 不确定
```

**跳过规则**：
- ❌ 纯分销商 → 直接跳过，不执行 Step 1-7
- ⚠️ 不确定 → 继续执行，但标注风险

### 🔍 行业关联度速判（Step 0 强制执行）

> **目的**：在 Step 4-7 之前，快速判断公司产品是否可能包含电子元器件，决定后续步骤的投入深度。

**关联度评分规则**：

| OKVED / 行业 | 典型产品 | 电子元器件关联度 | 后续策略 |
|-------------|---------|---------------|---------|
| **26.x 电子/光学** | 电路板、传感器、通信设备 | 🔴 **直接消费者** P0 | Step 4-7 全面执行 |
| **28.xx 通用机械** | CNC、机器人、自动化产线 | 🔴 **直接消费者** P0 | Step 4-7 全面执行 |
| **27.xx 电气设备** | 电机、变压器、变频器、PLC | 🔴 **直接消费者** P0 | Step 4-7 全面执行 |
| **30.xx 计算机/电子光学** | 计算机、导航、测量仪器 | 🔴 **直接消费者** P0 | Step 4-7 全面执行 |
| **33.xx 维修/安装** | 工业设备维修维护 | 🟠 **间接消费者** P1 | Step 4 正常，Step 5-7 适度 |
| **25.40 武器弹药** | 弹药、火炮、导弹 | 🟡 **极低关联** P3 | Step 4 简化（只查自动化设备），Step 5-7 适度 |
| **10.xx 食品** | 食品加工 | 🟡 **极低关联** P3 | Step 4 简化，Step 5-7 适度 |
| **13-14.xx 纺织/服装** | 纺织品 | ⚪ **无关** P4 | Step 4-7 最简执行 |
| **纯贸易商(46.xx)** | 不确定 | 🟠 视具体品类定 | 查官网产品线再定 |

**判断指标**（按优先级排序）：
1. **OKVED 主码** → 查上表得基础关联度
2. **产品页实际内容** → 产品含电路板/控制器/显示屏 → 升级至 P0
3. **招聘岗位** → 招电子工程师/嵌入式/PCB → 升级至 P0
4. **官网技术文档** → 有BOM/原理图/固件 → 升级至 P0

**输出格式**：
```markdown
### 行业关联度速判
- OKVED主码: [代码+描述] → 基础关联度: [P0-P4]
- 产品页证据: [有/无电子元器件相关内容]
- 招聘证据: [有/无电子工程相关岗位]
- **最终关联度**: [P0-P4] → 后续策略: [全面/适度/简化]
```

---

### Step 1 — 身份锚定

**目标**：确认公司存在、获取 INN、法人、规模、营收

⚠️ **双实体/集团架构发现（v4.2 新增规则）**：
俄罗斯大型企业常将品牌、软件、生产拆分为多个法人实体（如 TRASSIR = ДССЛ品牌公司 + НПП ТРАССИР生产子公司 + ДССЛ-Поволжье等区域分支）。**关键操作**：
1. 先搜品牌名（英文+俄文），收集所有关联法人
2. 在OpenSanctions搜品牌名时，结果常显示多个实体（母公司/子公司/区域分支）
3. 区分**直接制裁实体**和**关联制裁标记**——母公司可能直接制裁，子公司仅关联
4. 在报告中记录所有实体，制裁状态逐个标注

**rusprofile搜索技巧**：
- 英文品牌名搜索（如"TRASSIR"）**经常返回0结果**——必须用俄语全称或INN搜索
- 简短通用词（如"Астро"、"Спектр"、"Импульс"）在 api-registry 会返回大量同名无关实体（多为莫斯科历史注册）→ **必须加城市或全称限定**，不依赖第一条结果
- 搜索「ООО+全称+城市名」格式（如"ООО+Компания+Астро+Пенза"）→ rusprofile 自动跳转目标公司页面，无需手动翻页
- 按INN直接访问 `rusprofile.ru/id/[INN]` **可能404**——用搜索页 `rusprofile.ru/search?query=[INN]` 更可靠
- ⛔ **OGRN直接URL有效**（v4.7新增）：`rusprofile.ru/id/[OGRN]` 如 `rusprofile.ru/id/1197847026277` **不404**，可直接访问。从OpenSanctions获取OGRN后直接用此URL，比搜索页更快更可靠
- 搜索到公司后，注意**"1分钟概要"段落**是信息金矿——包含：员工数变化趋势（如从7人降至4人）、营收对比（↓64%）、地址变更历史（3次搬家）、注册日期/OKVED摘要。这2-3段文字足以完成Step 0-1的大部分判断
- ⛔ **同名公司筛选（v4.6新增）**：俄语公司名（特别是简短通用词如"Диапазон"、"Спектр"、"Импульс"）在rusprofile可能返回10+个同名实体。**必须用官网显示的地址交叉匹配**（如пр-кт Непокорённых, д.66），再核对ОКВЭД主码（46.52电子贸易 vs 41.20建筑施工）。子公司/关联实体可能有**相同名称但不同ИНН**（如"Диапазон 360"的母公司ИНН 7813688837≠本目标7805742375）——不要假设同名即关联

按顺序：
1. `rusprofile.ru` → INN、OGRN、法人姓名、地址、员工数、营收
2. `saby.ru/profile/[INN]` → 第二电话、更多信息
3. `egrul.nalog.ru` → 官方法人确认（最权威）
4. `list-org.com` → 交叉核查

**俄语站 vs 国际站**：大型俄罗斯公司常有两个网站（如 trassir.ru + trassir.com）。俄语站（.ru）通常包含完整法定信息、OKVED明细、Минцифры分类；国际站（.com）有全球联系方式和产品概览。**两个都要查**。

提取：官方全称、INN/OGRN、法人姓名、员工规模、营收趋势、公司状态（注意 AO/OOO 重组）

#### ⛔ 营收/采购预算数据原则（v4.5 修正）

**核心规则：有证据才写，没有就标「未知」。**

- ✅ 允许：rusprofile/list-org 实际显示的营收数据 → 直接引用，标注来源URL
- ✅ 允许：官方财报/年报数据 → 直接引用
- ❌ 禁止：用注册资本×倍数推算营收（无实证依据）
- ❌ 禁止：用员工数×人均推算营收（误差巨大）
- ❌ 禁止：用行业比例推算采购预算（纯猜测）

**输出格式**：
- 有数据：`营收: XX亿卢布 (来源: rusprofile.ru, 2024年)`
- 无数据：`营收: 未知（rusprofile未显示营收数据）`
- ⛔ 绝对不写「估算」「推测」「约」等模糊词

---

### Step 2 — 政府采购记录

**目标**：找到有名有姓的采购联系人（法律强制真实）

**v4.5 策略：先快后慢，避免在超时网站上浪费时间**

#### 第一轮：快速搜索（总计不超过30秒）
```
# Yandex快速搜（优先）
lightpanda fetch "https://yandex.ru/search/?text=site:zakupki.gov.ru+[INN]"
# 备选：clearspending
lightpanda fetch "https://clearspending.ru/search/?q=[公司名]"
```

#### 第二轮：仅在有搜索结果时深入
- 如果Yandex/clearspending返回了结果 → 用browser_navigate访问具体合同页面
- 如果无结果 → 标注「zakupki无公开采购记录」，直接跳到Step 3
- **⛔ 不要对空结果反复尝试browser_navigate**（已知会超时/验证码）

#### 第三轮（可选）：下载招标PDF
- 下载招标PDF/DOC，搜索：`Контактное лицо:` / `Телефон:` / `E-mail:`
- zakupki PDF中的联系人是最高置信度来源

**OKVED 25.xx军工企业**：合同走ГОЗ国防采购系统不公开，标注「国防采购数据不公开」而非「无政府采购」

Step 2 无结果 → 纯民营企业，跳至 Step 3。

---

### Step 3 — 制裁状态检查（必须执行）⚠️

**目标**：确认公司是否在制裁名单中，决定是否继续开发。

**这是合规决策的关键步骤，必须执行。**

#### 制裁数据源（按权威性排序）

| 来源 | 覆盖范围 | 权威性 | 检查方法 |
|------|---------|--------|----------|
| **OpenSanctions** | OFAC + EU + UN + UK 聚合 | ⭐⭐⭐⭐⭐ 最高 | `opensanctions.org/search/?q=[公司名/INN]` |
| **OFAC SDN** | 美国财政部制裁名单 | ⭐⭐⭐⭐⭐ | `sanctionssearch.ofac.treas.gov` |
| **EU Sanctions** | 欧盟制裁名单 | ⭐⭐⭐⭐ | `webgate.ec.europa.eu/fsd/fsf/public/search` |
| **UK Sanctions** | 英国制裁名单 | ⭐⭐⭐⭐ | `gov.uk/government/publications/the-uk-sanctions-list` |
| **EU Sanctions Tracker** | EU 制裁清单 + 法规原文 | ⭐⭐⭐⭐⭐ | `data.europa.eu/apps/eusanctionstracker/` 可搜索实体名/INN，显示 Official Journal 法规编号和理由 |
| **BIS Entity List** | 美国商务部出口管制 | ⭐⭐⭐⭐ | `bis.doc.gov/entity-list` 军工出口管制实体（如 Rostec 子公司），含许可证要求 |
| **UN Security Council** | 联合国制裁名单 | ⭐⭐⭐⭐ | `un.org/securitycouncil/sanctions/` |

#### 制裁数据批量获取 API

| 源 | 端点 | 方法 |
|----|------|------|
| **OpenSanctions 搜索** | `https://api.opensanctions.org/search/default?q=<INN/名称>` | HTTP GET，返回 JSON |
| **OpenSanctions 实体详情** | `https://api.opensanctions.org/entities/<entity_id>` | 获取单个实体的制裁详情 |
| **OpenSanctions INN 直查** | `https://api.opensanctions.org/entities/ru-inn-<INN>/` | 俄罗斯 INN 精确查询（非100%可靠） |
| **OpenSanctions 批量下载** | `https://data.opensanctions.org/datasets/latest/default.json` | 全量制裁数据集 JSON |
| **EU FSF 数据集** | `https://data.opensanctions.org/datasets/latest/eu_fsf/index.json` | 仅欧盟金融制裁名单 |
| **OFAC SDN 数据集** | `https://data.opensanctions.org/datasets/latest/sanctions/ofac_sdn/index.json` | 仅美国 SDN 名单 |
| **EU Official Journal** | `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_<年份><编号>` | 如 `OJ:L_202600509`，含制裁法规 Annex 原文 |
| **OFAC SDN CSV** | `https://ofac.treasury.gov/specially-designated-nationals-list-data-formats` | 可下载 SDN.XML / SDN.CSV 完整列表 |
| **EU Sanctions Map** | `https://www.sanctionsmap.eu/` | 可视化地图 + 实体搜索 |

#### INN 精确制裁检查流程（推荐）

```
1. 先执行 `python3 -m network_sentinel.cli api-sanctions --name "<NAME>" --inn "<INN>"`
2. 若返回命中 → 使用结果中的证据 URL、来源、程序
3. 若需要网页正文补充或详情页证据 → 再抓 OpenSanctions / 官方网页页
4. 若需要法规上下文 → 再查 EU Tracker / eur-lex / BIS / UN
```

#### 自动检查脚本

```bash
# 使用制裁检查脚本
python3 scripts/check_sanctions.py --inn [INN] --name "[公司名]" --output sanctions_result.json --report sanctions_report.md

# 示例
python3 scripts/check_sanctions.py --inn 7704736686 --name "Ростех"
```

#### 检查流程

1. **`api-sanctions` 主路径**（首选，最可靠）
   - 执行：`python3 -m network_sentinel.cli api-sanctions --name "<NAME>" --inn "<INN>"`
   - 它会优先使用 OpenSanctions key + OFAC/EU/UK 官方下载缓存
   - 只有在需要网页证据或人工核对时，才继续访问 OpenSanctions / 官方网页页

2. **OpenSanctions 网页/API 明细补充**（仅补证据）
   - 输入公司名或 INN
   - ⚠️ **同时搜俄语名和英文品牌名**——不同实体可能以不同语言注册（如"ДССЛ"搜到8个实体，"TRASSIR"只搜到1个）
   - **INN精确查询捷径（v4.7新增，v4.8修正）**：`opensanctions.org/entities/ru-inn-[INN]/` — **非100%可靠**（实测ФРЕСТ返回404）。优先用搜索API：`curl "https://api.opensanctions.org/search/default?q=[INN]&limit=10"`；有结果时再用 `entities/ru-inn-[INN]/` 看详情页面。
   - 注意区分 **"Sanctioned entity"**（直接在制裁名单上）vs **"Sanction-linked entity"**（通过关联被标记，未直接制裁）——这是完全不同的法律风险等级
   - ⛔ **⚠️ 同名碰撞陷阱（v4.6新增）**：OpenSanctions搜俄罗斯人名极易命中同名不同人。必须核对出生日期、职业、Wikidata描述——仅姓名匹配≠制裁匹配。如Petrov Sergey Aleksandrovich（常见俄语姓名）在OpenSanctions可能命中FSB雇员（1962年生），但实际为公司法人（不同ИНН/出生年份）。**操作**：打开匹配实体详情页，对比birthDate + description字段
   - 如有匹配 → 点击进入详情页查看制裁机构、具体制裁法律、时间范围

3. **OFAC SDN 确认**（仅补证据）
   - 搜索美国财政部 SDN 名单
   - **⚠️ 浏览器交互问题**：使用 browser_navigate 访问 OFAC SDN 搜索页面后，填写搜索词并按 Enter，页面可能不会返回搜索结果（JavaScript 交互问题）
   - **⚠️ API端点同样不可靠**：`sanctionssearch.ofac.treas.gov` 有自签名SSL证书问题，curl直接访问返回空
   - **替代方案A（推荐）**：依赖 OpenSanctions 作为主要制裁检查源（OpenSanctions 已聚合 OFAC 数据）— 用搜索API: `curl "https://api.opensanctions.org/search/default?q=[公司名/INN]"`
   - **替代方案B（v4.7验证）**：如果OpenSanctions返回了OFAC ID，直接用 **lightpanda** 访问 `sanctionssearch.ofac.treas.gov/Details.aspx?id=[OFAC_ID]` — 该详情页为服务端渲染，lightpanda可成功抓取（已验证：id=47999）
   - 其他替代：下载 SDN CSV 文件进行本地搜索

4. **EU/UK 检查**
   - 搜索欧盟和英国制裁名单
   - 注意：某些公司可能在 EU 名单但不在 OFAC

#### 判断标准

| 制裁状态 | 标记 | 操作 |
|---------|------|------|
| **四源完成且无命中** | ✅ CLEAR | 继续开发 |
| **部分权威源完成且无命中** | ⚠️ PARTIAL_CLEAR | 继续分析，但报告顶部标注未完成源；评分最高⭐⭐ |
| **核心源均不可用/无法确认** | ⚪ UNKNOWN | 继续分析，但进入需复核 |
| **存在直接制裁记录** | 🔴 HIT | **继续全流程分析，报告顶部醒目标注制裁详情** |
| **关联实体制裁** | ⚠️ HIT 或 PARTIAL_CLEAR | 只有四态可用；按关联证据强弱在报告中解释 |

**CLEAR 使用条件**：OpenSanctions、OFAC、EU、UK 四类检查均完成且无直接/关联命中时才可写 `CLEAR`。EU 或 UK 未完成时禁止写 `CLEAR`，只能写 `PARTIAL_CLEAR` 或 `UNKNOWN`。
**不确定**：写 `UNKNOWN`，进入人工复核。

#### 制裁影响评估矩阵（v4.4 新增）

| 制裁方 | 影响范围 | 中国贸易影响 | 支付渠道风险 | 建议操作 |
|---------|---------|-------------|-------------|---------|
| **美国 OFAC SDN** | 全球（美国管辖） | 🔴 高（禁止美元交易） | 🔴 高（美元/SWIFT受限） | **强烈不开发** |
| **欧盟 Sanctions** | 欧盟及关联方 | 🟠 中（欧洲芯片受限） | 🟠 中（欧元渠道受限） | 不开发或谨慎评估 |
| **英国 Sanctions** | 英国及关联方 | 🟠 中 | 🟠 中 | 谨慎评估 |
| **加拿大 SEMA** | 加拿大境内公司 | 🟢 低（不影响中俄贸易） | 🟢 低（可用人民币/卢布） | **可正常开发** |
| **日本/韩国** | 本国及关联方 | 🟠 中（日韩芯片受限） | 🟠 低 | 谨慎评估 |
| **瑞士/挪威** | 本国及关联方 | 🟢 低 | 🟢 低 | 可正常开发 |

**关键原则（用户偏好）：**
- 制裁状态被视为**实力的信号**，即使发现公司受制裁，也必须完成全流程分析
- 制裁公司通常有更强的**进口替代需求**，反而是高价值客户
- 核心逻辑：华强北可供应全球品牌，因此官网出现任何品牌或型号前缀均视为强需求信号

#### 输出格式

```markdown
### 制裁状态检查

| 来源 | 检查状态 | 结果 | 匹配详情 |
|------|---------|------|----------|
| OpenSanctions | ✅ 已检查 | 无记录 | - |
| OFAC SDN | ✅ 已检查 | 无记录 | - |
| EU Sanctions | ✅ 已检查 | 无记录 | - |
| UK Sanctions | ✅ 已检查 | 无记录 | - |

**综合判断**: CLEAR — OpenSanctions、OFAC、EU、UK 四源均完成且未发现命中
**建议**: 可继续开发；制裁状态仅作事实标记

---

### 制裁状态检查（有制裁示例）

| 来源 | 检查状态 | 结果 | 匹配详情 |
|------|---------|------|----------|
| OpenSanctions | ✅ 已检查 | 🔴 有记录 | OFAC SDN + EU Sanctions |
| OFAC SDN | ✅ 已检查 | 🔴 有记录 | SDN List - Entity |
| EU Sanctions | ✅ 已检查 | 🔴 有记录 | Council Regulation (EU) 2022/xxx |

**综合判断**: HIT — 存在直接制裁记录，来源和项目见上表
**建议**: 继续完成商业情报分析；制裁状态仅作事实标记，最终合规判断另行处理
```

#### 关键制裁案例参考

| 公司 | 制裁来源 | 标记 | 处理 |
|------|---------|---------|------|
| **Ростех (Rostec)** | OFAC SDN + EU | HIT | 继续完成画像，制裁事实置顶 |
| **Алмаз-Антей** | OFAC SDN + EU | HIT | 继续完成画像，制裁事实置顶 |
| **Ситроникс** | EU Sanctions | HIT | 继续完成画像，制裁事实置顶 |
| **Микрон (Mikron)** | EU Sanctions | HIT | 继续完成画像，制裁事实置顶 |

#### 规则

1. **制裁检查必须执行**，不能跳过
2. **有制裁记录 ≠ 停止分析**。制裁公司必须继续完成 Step 4-9 全流程，制裁信息标注在报告顶部。核心逻辑：制裁=进口替代需求强烈=高开发价值
3. **制裁名单动态更新**，建议定期复查（每季度）
4. **此检查仅供参考**，最终合规决策请咨询专业律师

---

Step 3 完成后 → 无论是否有制裁，继续 Step 4。制裁公司标注制裁详情后继续全流程。

---

### Step 4 — 数字足迹 + 元器件需求提取

**4a — hh.ru 招聘侦察**
```
site:hh.ru [公司名] снабжение OR закупки OR комплектация
site:hh.ru [公司名] инженер OR "схемотехника" OR "проектирование"
```
搜不到 = 触发思维⑤上移目标层级。找到则提取部门信息和联系邮箱。

**招聘 JD 中的元器件需求**：
- 提取职位描述中提到的具体芯片型号/品牌（STM32、FPGA、AD、TI 等）
- 提取技术要求中的元器件规格（电压、频率、封装等）
- 标注为「JD 需求」，置信度⚠️中

**4b — 官网 Dorks**
```
site:[domain.ru] filetype:pdf "контакт" OR "ответственный" OR "снабжение"
site:[domain.ru] filetype:pdf "микросхема" OR "процессор" OR "FPGA" OR "MCU"
site:[domain.ru] "начальник" OR "директор" OR "менеджер"
```

**官网产品/技术文档元器件提取**（必须执行）：
- 抓取产品页面，提取具体型号（如 РК-405 飞控的 STM32 引脚定义）
- 抓取技术文档/PDF，提取芯片品牌/型号（AD、TI、ST、Xilinx 等）
- 抓取 BOM/规格书，提取关键元器件清单
- 提取方法：Lightpanda 抓取 → 搜索关键词（микросхема、процессор、чип、модуль）

**技术规格 → 元器件类型推断方法论**（当官网不直接显示品牌时使用）：

当客户官网不暴露具体品牌/型号时，从技术规格中推断元器件需求：

| 产品技术规格 | 推断的元器件需求 | 置信度 |
|------------|----------------|--------|
| RS-232 接口 | MAX232 / SP232 / 兼容收发器 | ✅高 |
| RS-485 接口 | MAX485 / SP485 / SN75176 收发器 | ✅高 |
| USB 接口 | CH340 / CP2102 / FT232 / MCU内置 | ✅高 |
| Ethernet 100BASE-TX | LAN8742 / DP83848 / KSZ8081 PHY | ✅高 |
| TFT LCD (800×480+) | TFT模块+驱动IC+背光LED驱动 | ✅高 |
| 电阻式触摸屏 | 四线电阻触摸控制器 (ADS7846/TSC2046) | ✅高 |
| 16通道ADC | 多通道Σ-Δ ADC或MCU内置ADC | ⚠️中高 |
| 16路继电器输出 | 继电器+ULN2003/达林顿驱动 | ✅高 |
| 多通道热电偶输入 | MAX31855/AD8497 + 多路复用器 | ⚠️中高 |
| 气体传感器(O₂/CO₂/CO) | 电化学/红外气体传感器模块 | ✅高 |
| 温湿度传感器 | Sensirion SHTxx / Bosch BME280 / 中国替代 | ⚠️中 |
| 220V AC供电，<50W | AC-DC开关电源模块(HiLink/MeanWell等) | ✅高 |
| 多路模拟输出(4-20mA) | DAC+运放(AD5420/XTR117) | ⚠️中高 |
| LoRa无线通信 | LoRa模块(SX1278/SX1262) | ✅高 |

**LED照明行业专用推断**（实战验证案例 - Ledel L-industry NEW系列）：

| 产品技术规格 | 推断的元器件需求 | 置信度 |
|------------|----------------|--------|
| 自研驱动器型号（如IKVI-11/IKII-21） | LED驱动器主控IC（TI/ST/ADI/ON Semi） | ✅高 |
| 功率因数 ≥0.95 | PFC控制芯片、功率因数校正电路 | ✅高 |
| 工作温度 -60~40℃ | 高温级电容、宽温MOSFET | ✅高 |
| LED非替换式 | 大功率LED灯珠（0.5W~5W） | ✅高 |
| 铝合金挤压散热器 | 导热硅脂、绝缘垫片、散热涂层 | ✅高 |
| 三重保护（热保护/短路保护/脉冲保护） | NTC热敏电阻、TVS管、MOSFET保护电路 | ✅高 |
| 调光功能（可选） | PWM调光控制器/0-10V调光接口 | ⚠️中 |
| 额定频率 50Hz | EMI抑制电容、电感、X电容/Y电容 | ✅高 |
| IP66防护等级 | 防水密封材料、防水连接器 | ✅高 |

**推断逻辑说明**：
- ✅ 高置信度：该规格→必须有对应的标准IC（RS-485必须有收发器）
- ⚠️ 中置信度：规格暗示→但具体方案可能有多种选择（16通道ADC可以是MCU内置或者独立ADC）

**输出格式**：
```markdown
### 元器件需求（官网提取）
| 产品线 | 具体型号/规格 | 证据来源 | 置信度 |
|--------|--------------|---------|--------|
| 飞控 РК-405 | STM32F4/F7 (推断) | 引脚 PB0/PC1 命名规范 | ⚠️中 |
| 滤波器 ФИЛИН | LTCC 基板、SMA 连接器 | filin-rf.ru 产品页 | ✅高 |
```

**元器件需求优先级分类**：
| 优先级 | 类别 | 说明 |
|--------|------|------|
| 🔴 P0 | MCU/处理器 | 核心控制芯片，需求量大 |
| 🔴 P0 | 电源管理 | DC-DC、LDO、PMIC |
| 🔴 P0 | 连接器 | RF 连接器、排针、USB |
| 🟠 P1 | 传感器 | IMU、ADC、温度/压力传感器 |
| 🟠 P1 | RF芯片 | 放大器、混频器、开关、PLL/VCO |
| 🟠 P1 | FPGA/CPLD | 逻辑控制、信号处理 |
| 🟡 P2 | 被动元件 | 电容、电阻、电感、陶瓷谐振器 |
| 🟡 P2 | 基板材料 | LTCC、高频 PCB、陶瓷基板 |
| 🟡 P2 | 保护器件 | TVS、ESD 保护 |

**供应链风险评估**（必须标注）：
| 元器件类别 | 主要供应商 | 制裁影响 | 替代方案 |
|-----------|-----------|---------|---------|
| STM32 MCU | STMicro (欧洲) | ⚠️ 出口管制 | 中国 GD32/俄罗斯 Mikron |
| RF芯片 (HMC/ADF) | Analog Devices (美国) | 🔴 禁止出口 | 中国中电科/俄罗斯 Angstrem |
| 电源管理 | TI/ADI (美国) | 🔴 禁止出口 | 中国圣邦微/矽力杰 |
| FPGA | Xilinx/Intel (美国) | 🔴 禁止出口 | 中国安路/紫光国微 |

**4c — 邮箱格式推断**（找到任一邮箱后）
```
firstname.lastname@domain.ru     ← 最常见
f.lastname@domain.ru
snab@domain.ru / zakupki@domain.ru / komplekt@domain.ru
```
标注为⚠️推断。

---

### Step 5 — 社交与专业痕迹

**强制规则**：Step 5 永远执行，不允许因为官网已有 `info@`、电话、WhatsApp、Telegram 或表单就跳过。Step 5 的目标不是“找一个入口”，而是尽力找到可验证的决策人/采购人。

**必查项**：
1. 官网 header/footer/contact/requisites/social-links，提取 VK、Telegram、WhatsApp、Rutube/YouTube、表单、所有邮箱和电话。
2. VK：公司名 + `директор` / `владелец` / `снабжение` / `закупки`。
3. Telegram：官网链接、VK主页链接、公司名和品牌名的公开频道/机器人/群组。
4. WhatsApp/电话：官网和2GIS双源验证，标注为入口联系人，不等同于具体联系人。
5. 2GIS：电话、地址、分支、评论、照片中的人员/部门线索。
6. hh.ru：雇主页面、招聘署名、采购/工程/销售岗位。
7. LinkedIn/Yandex：技术总监、采购、CEO/owner关键词。

**联系人输出三分类**：
- `已验证联系人`：有人名 + 职位或公司关联 + 可触达渠道 + 来源URL。
- `入口联系人`：公司公开邮箱、总机、WhatsApp、Telegram bot、联系表单等。
- `未找到`：未找到任何可触达入口。

未署名的“CEO/owner/генеральный директор”只能作为角色判断，不能写入 `contact_name`。

**5a — VK**（首选）
```
site:vk.com "[全名]" "[公司名]"
```

**5b — LinkedIn**（技术总监层有效，但 2022 年后覆盖率大幅下降）
```
site:linkedin.com/in "[姓名]" "[公司]"
```

**5c — Telegram** — 检查 VK 主页或官网找 Telegram 链接。俄罗斯 B2B 决策人很多用 Telegram 接受商务联系。

**5d — 小企业(<50人)的联系人金矿：检查官网"Реквизиты"和"Контакты"页**

对于 <50 人且 hh.ru 无雇主页面的企业，**官网的 Реквизиты (requisites) 和 Контакты (contacts) 页面是联系人金矿**，常隐藏着比 info@ 更多的邮箱：

```
📧 eksis@eksis.ru         ← 通用邮箱（黄金渠道，非info@）
📧 support@eksis.ru       ← 技术支持邮箱（可达技术人员）
📧 service@eksis.ru       ← 售后/维修邮箱
📧 buh@eksis.ru           ← 财务部邮箱（可用于采购谈判的侧门）
```

这些邮箱在搜索引擎和 Dorks 中很少被索引到，但直接访问公司官网的 Контакты/Реквизиты 页面就能找到。

**操作步骤**：
1. 直接访问官网 `/contacts/`、`/about-company/requisites/` 或 `/kontakty/`
2. 提取页面上所有 `mailto:` 链接（包括 hidden in HTML）
3. 从文本中搜索 `@` 提取所有邮箱
4. 按优先级排序：договорной/снабжение/закупки > бухгалтерия > техподдержка > общий
5. 标注置信度：官网页面上直接显示的 ✅高，页面源码中隐藏的 ⚠️中

**典型产出**（真实案例，АО «ЭКСИС», eksis.ru）：
| 邮箱 | 部门 | 来源 | 置信度 |
|------|------|------|--------|
| eksis@eksis.ru | 通用 | 官网Контакты | ✅高 |
| support@eksis.ru | 技术支持 | 官网Контакты | ✅高 |
| service@eksis.ru | 售后服务 | 官网Контакты | ✅高 |
| buh@eksis.ru | 财务部 | 官网Реквизиты | ✅高 |

**5e — 当搜索引擎全部被封时的替代路径（2026年实战经验）**

当 Yandex、Google、DuckDuckGo、Bing 全部返回 CAPTCHA/空结果/重定向时（这在当前俄罗斯制裁环境下经常发生）：

```
❌ Yandex → Капча (机器人验证)
❌ Google → CAPTCHA / Sorry 页面
❌ DuckDuckGo → 空结果
❌ Bing → 重定向到 cn.bing.com / 空结果
```

**关键发现（遗留网页兜底）**：DuckDuckGo Lite 版仍然可用，但在 v5.6 之后只作为 API 搜索完全不可用时的最后网页兜底：
```bash
curl -sL -x http://127.0.0.1:7897 "https://lite.duckduckgo.com/lite/?q=[搜索词]"
```
当主站 `html.duckduckgo.com` 返回空结果时，**轻量版 lite.duckduckgo.com** 无 JS 渲染、无验证码，可直接返回搜索结果。在本轮实战中用它解析了 yp.ru 子域名下的隐藏公司身份（necspb.yp.ru → НЭК / necspb.com）。

**搜索引擎可用性分级（2026-05实战验证）**：
| 引擎 | 可用性 | 推荐场景 |
|------|--------|---------|
| DuckDuckGo Lite (lite.duckduckgo.com) | ✅ 可用 | 仅在 API 搜索不可用时作为最后网页兜底 |
| Lightpanda 直接访问目标网站 | ✅ 可用 | 已确认的公开站（官网、rusprofile等） |
| Yandex (yandex.ru) | ⚠️ 常被 captcha 拦截 | 仅作网页兜底，不再是主搜索路径 |
| DuckDuckGo 主站 (html.duckduckgo.com) | ❌ 空结果 | 已降级 |
| Bing (bing.com) | ❌ 重定向到 cn.bing.com | 已降级 |
| Google (google.com) | ❌ CAPTCHA | 已降级，不作为主路径 |

**替代路径**：直接访问已知平台，用公司官网提供的链接进入：

| 原计划 | 替代方案 |
|--------|---------|
| Yandex搜 `site:vk.com [公司名]` | 直接访问官网VK链接(通常挂在header/footer) |
| Yandex搜 `site:hh.ru [公司名]` | 直接访问 `hh.ru/employer/[ID]` (ID来自数据聚合站) |
| Yandex搜 `site:linkedin.com [公司名]` | 直接访问 `linkedin.com/company/[公司名]` |
| Yandex搜 `[公司名] YouTube` | 官网footer找YouTube图标链接 |
| Yandex搜 `[公司名] Telegram` | 官网footer找Telegram链接或发现@handle |

**关键原则**：**官网的 footer/social-links 区域是最可靠的社会化入口**。俄罗斯公司通常在 footer 放置 VK、Telegram、YouTube、Дзен 的完整链接。直接点击这些链接进入平台，绕过搜索引擎。

**5f — 2GIS 验证电话**
```
2gis.ru [公司名] [城市]
```

---

### Step 5+ — 深层侦察（Step 5未找到具体人名时必须启用）

**⚠️ 触发条件**：Step 5 未找到目标联系人（决策人/采购人），自动启用本层。不是"可选"，是"条件必须"。如果工具不可用，必须写明“工具不可用 + 替代动作”，不能写“未启用/不适用”。

当 Step 1-5 未能找到目标联系人时，启用以下高级路径。

#### ⚡ 自动侦察脚本（推荐）

使用 `scripts/layer5_deep_recon.py` 一键完成姓名搜索+邮箱反查+域名OSINT+Google情报：

```bash
# 姓名跨平台搜索（含VK/Habr/Odnoklassniki等俄语平台）
python3 scripts/layer5_deep_recon.py search "Мордасов Александр"

# 邮箱注册检测（反查在哪些平台注册过）
python3 scripts/layer5_deep_recon.py email info@company.ru

# 快速邮箱模式（只显示已注册的平台）
python3 scripts/layer5_deep_recon.py email info@company.ru --quick

# 域名OSINT扫描（邮箱+子域名+主机+LinkedIn员工名）
python3 scripts/layer5_deep_recon.py domain company.ru

# Google生态情报（邮箱→Profile/Maps/Calendar）
python3 scripts/layer5_deep_recon.py ghunt someone@gmail.com
```

脚本集成了以下 GitHub 开源工具：

| 工具 | ⭐ Stars | 功能 | 数据源 |
|------|---------|------|--------|
| **Maigret** | 19.5k | 跨平台用户名搜索 | 400+网站，含VK/Habr/Pikabu等俄语平台 |
| **holehe** | 10k | 邮箱注册检测 | 120+平台，验证真人身份 |
| **theHarvester** | 11k | 域名OSINT扫描 | rapiddns/crtsh/hackertarget/otxsearch/duckduckgo |
| **GHunt** | 15k | Google生态情报 | 邮箱→Profile/Maps/YouTube/Calendar |

**theHarvester 域名扫描产出**：
- 📧 员工邮箱（自动发现@domain邮箱地址）
- 🌐 子域名枚举（rapiddns + crtsh证书透明度）
- 🖥️ 主机/IP发现
- 📋 邮箱格式推断（firstname.lastname / initials / flastname）

**GHunt Google情报产出**（需先认证：`ghunt login`）：
- 👤 真实姓名 + Gaia ID
- 🔧 已激活的Google服务列表
- 📍 Google Maps评论统计
- 📅 公开日历事件
- ⚠️ 认证方式：安装GHunt Companion浏览器扩展 → 运行 `ghunt login`

**依赖安装**：
```bash
# Maigret + holehe（Python 3.9+）
pip3 install maigret holehe
pip3 install "aiosignal==1.3.1" "attrs>=23.1.0"

# theHarvester（Python 3.12 venv，已安装）
# 位置: /opt/homebrew/theharvester-venv/bin/theHarvester
# 版本: v4.10.1

# GHunt（pipx安装，已安装）
# 版本: v2.3.4
# 首次使用需认证: ghunt login
# 认证需安装浏览器扩展: GHunt Companion (Firefox/Chrome)
```

**5a — 专利发明人反查**
```
site:fips.ru [公司名]    # Rospatent
site:researchgate.net [公司名] [技术关键词]
site:elibrary.ru [公司名]
```
专利发明人 = 真正的技术决策者。论文"Correspondence"部分常有个人邮箱。

**5b — 校友/学术网络**
- 找到公司核心关联大学（如 ISPU、МГТУ им. Баумана）
- VK 搜索大学校友群 → 公司名 → 员工自曝信息

**5c — 海关与供应链指纹**
- ImportGenius / Panjiva → 搜公司名的提单（B/L），找"Consignee Contact"
- FSA.gov.ru → 搜索"Declaration of Conformity"找到签署进口组件的质量经理
- 如有付费账号可用，追踪中转壳公司（Turkey/UAE/HK）

**5d — Telegram 群组侦察**
```
# 搜索俄语采购/元器件群组
telegramscraper "закупки электронных компонентов"
telegramscraper "снабжение" "радиоэлектроника"
```
- known community: `@zakupki_ec` / `@elec_comp_buy`
- 适合找到正在表达采购需求的公司

---

### Step 6 — 联系人存活性验证（必须执行）

**前置依赖**：需要Step 5或Step 5+产出的具体人名和联系方式。如果前序步骤未找到任何联系人，本步标记为"⚠️ 无法执行"，不能编造验证结果。

找到联系人后，**必须验证其是否仍在岗且可触达**，否则后续工作全部浪费。

**6a — 在岗验证**
- hh.ru 搜该人姓名 → 如果正在求职 → 标记⚠️「可能即将离职」
- VK 检查最后活动时间 → 超过 1 年未更新 → 标记⚠️「可能已不在该岗位」
- VK「Карьера」板块 → 确认当前雇主是否仍是目标公司

**6b — 联系方式验证**
- 推断邮箱 → 运行 `scripts/verify_email.py` SMTP 探测
- 电话 → 2GIS 交叉验证是否仍是该公司注册号码
- Telegram → 尝试搜索 handle，检查头像/简介是否匹配

**6c — 决策权验证**
- 确认该人的职位是否与思维⑤的目标层级匹配
- 如果找到的是普通工程师而非采购/管理层 → 标记为「信息人」而非「决策人」
- 信息人仍有价值：可用于引荐或确认采购流程

**验证结果标记**：
| 标记 | 含义 | 是否可直接外联 |
|------|------|------------|
| ✅ 已验证 | 多源交叉确认在岗 + 联系方式有效 | 是 |
| ⚠️ 部分验证 | 有些信息过期或无法完全确认 | 可以，但准备备选 |
| ❌ 未验证 | 仅单一来源，无法确认 | 先补充情报再联系 |
| 🚫 已失效 | 确认已离职/联系方式无效 | 不联系，重新找人 |

---

### Step 7 — 全球品牌识别 + 中国采购证据检查

**前置依赖**：需要Step 4产出的产品页内容和官网链接。必须实际访问产品页/数据手册，不能只用推测。

**目标**：扫描客户官网识别使用的元器件品牌/型号 + 验证中国采购证据。这是**核心评分维度（40分）**。

**核心逻辑**：华强北 = 全球元器件超市。客户官网出现**任何品牌**（TI/ST/Xilinx 等欧美品牌，或 INVT/Raycus 等中国品牌）或**型号前缀**（STM32、XC7、TPS等），都是强需求信号。

#### ⚡ 自动检查（推荐）

使用 `scripts/check_china_purchase.py` 一键完成全部检查：

```bash
# 单个公司检查（自动扫描官网品牌+型号+海关数据+elcp合同）
python3 scripts/check_china_purchase.py --inn [INN] --name "[公司名]" --website "[官网]"

# 批量检查
python3 scripts/check_china_purchase.py --batch customers.csv
```

脚本底层使用 `scripts/brands_database.py` 全球品牌库（35+品牌、50+型号前缀、12种设备品类）。

#### 三种证据来源

| 来源 | 权威性 | 最高分数 | 检查方法 |
|------|--------|---------|---------|
| **UN Comtrade 海关数据** | ⭐⭐⭐⭐⭐ | 40分 | 俄罗斯从中国进口记录（HS Code电子元器件） |
| **elcp.ru 公开合同** | ⭐⭐⭐⭐ | 40分 | 合同供应商是否中国公司 |
| **官网品牌/型号/品类扫描** | ⭐⭐⭐ | 30分 | 用global品牌库+型号前缀+品类关键词扫描官网 |

#### 🌍 全球品牌识别库（`brands_database.py` 核心功能）

脚本自动扫描官网，匹配以下**35+ 全球品牌**：

| 分类 | 品牌 | 代表产品 | 价值 |
|------|------|---------|------|
| 🏛️ **欧美** | TI、ADI、ST、Infineon、NXP、Microchip、ONsemi、Maxim、Renesas、Vishay | MCU/电源/运放/ADC | 极高-高 |
| 🏛️ **欧美** | Intel、**Xilinx**、Altera | FPGA/CPU | 极高 |
| 🗾 **日韩** | Samsung、Rohm、Toshiba、Panasonic、Murata、TDK | 存储器/功率/被动 | 中高-中 |
| 🇹🇼 **台湾** | **Delta**、MeanWell、LiteOn、Winbond | 电源/变频器/Flash | 高-中 |
| 🇨🇳 **中国** | **INVT(汇川)**、Estun(埃斯顿)、Xinje(信捷)、**GigaDevice(兆易)** | 伺服/PLC/GD32 MCU | 极高-高 |
| 🇨🇳 **中国** | Raycus(锐科)、JPT(创鑫)、Reci、S&A(特域)、Leadshine(雷赛) | 激光器/冷水机/步进 | 高 |
| 🇨🇳 **中国** | **WCH(沁恒)**、**Espressif(乐鑫)** | CH32 MCU/ESP32 | 极高 |
| 🔌 **分立** | TE、Molex、Amphenol、AVX、KEMET | 连接器/电容 | 中高-中 |
| 📡 **传感器** | Bosch、Honeywell | IMU/气压/压力 | 中高 |

#### 🔢 型号前缀识别（最高优先级）

自动检测官网页面中的**50+ 型号前缀**，直接指向具体需求：

| 类别 | 型号前缀 | 品牌 | 得分 |
|------|---------|------|------|
| **MCU** | STM32F/STM32H/STM32L/STM8 | ST | 30分 |
| **MCU** | GD32 | GigaDevice | 30分 |
| **MCU** | ESP32/ESP8266 | Espressif | 30分 |
| **MCU** | CH32 | WCH | 25分 |
| **FPGA** | XC7/Zynq/Virtex/Artix/Kintex | Xilinx | 30分 |
| **FPGA** | Cyclone/Stratix | Intel/Altera | 25-30分 |
| **电源** | TPS/LM/LT/ADP/MAX | TI/ADI/Maxim | 25-30分 |
| **功率** | IRF/IGBT/STW/FDP | Infineon/ST/ONsemi | 25-30分 |
| **存储** | W25/MX25/AT24/MT | Winbond/Macronix/Micron | 25-30分 |
| **通信** | CH340/CP210/RS485/CAN | WCH/SiliconLabs/多家 | 25-30分 |
| **传感器** | MPU6050/BME280/DS18B20 | InvenSense/Bosch/Maxim | 25分 |

#### 🏭 设备品类推断（间接需求信号）

扫描到以下设备类型关键词时，自动推断元器件需求：

| 设备类型 | 推断元器件需求 | 关联品牌 | 加分 |
|---------|--------------|---------|------|
| 激光切割/焊接 | CO2激光管、光纤激光器、冷水机、步进电机 | Reci/Raycus/S&A/Leadshine | 30分 |
| CNC数控机床 | 伺服电机、伺服驱动、PLC、主轴电机、MCU | INVT/Estun/Xinje/Delta | 28分 |
| 工业机器人 | 伺服×6、减速器、控制器、编码器、FPGA | Estun/INVT/Xilinx | 30分 |
| 自动化生产线 | PLC、触摸屏、传感器、变频器、MCU | Xinje/INVT/ST/TI | 25分 |
| 3D打印机 | 步进电机、步进驱动、MCU、温度传感器 | Leadshine/STM32 | 20分 |
| 电源/UPS | IGBT、MOSFET、DC-DC、AC-DC、电容 | Infineon/TI/ST/MeanWell | 22分 |
| 通信设备 | RF模块、WiFi模块、MCU、FPGA | ESP32/NXP/Xilinx | 20分 |
| 医疗设备 | 传感器、MCU、显示屏、运放 | TI/ADI/ST/Maxim | 18分 |
| LED显示屏 | LED驱动IC、MCU、电源、FPGA | MeanWell/TI/ST/Xilinx | 15分 |
| PCB制造 | 钻机、曝光机、运动控制、MCU | ST/Xilinx/Leadshine | 25分 |

#### 📊 HS Code 电子元器件分类（Comtrade查询用）

| HS Code | 描述 | 说明 |
|---------|------|------|
| 8542 | 电子集成电路 | MCU、FPGA、CPU |
| 8534 | 印制电路 | PCB |
| 8541 | 半导体器件 | 二极管、晶体管 |
| 8536 | 电气装置 | 连接器、开关 |
| 8537 | 电气控制或配电装置 | PLC、控制柜 |
| 8544 | 绝缘电线电缆 | 线缆 |
| 8501 | 电动机 | 伺服电机 |
| 8504 | 变压器/整流器 | 电源模块 |
| 8518 | 音频设备 | 扬声器/麦克风 |
| 8525/8527/8528 | 无线电/电视设备 | 通信接收/发射 |

#### 📐 采购需求分析 — 两种证据、两种分数（v4.9 重构）

> **核心原则**：海关数据（实证）和产品推断（推测）是两种完全不同的证据等级，不能混为一谈。

##### 🔴 海关实证证据（满分40分）

**只有以下三类属于实证**：
| 来源 | 说明 | 分数 |
|------|------|------|
| **UN Comtrade** | 俄罗斯从中国进口指定HS Code的电子元器件，有具体金额 | 40分 |
| **elcp.ru合同** | 该公司在电子行业目录中注册为"合同制造商/PCB供应商"，明确消费元器件 | 40分 |
| **俄罗斯海关申报记录** | ImportGenius/Panjiva等显示该公司实际进口电子元器件 | 40分 |

> ⚠️ **没有海关数据就是0分**。不能说"虽然没有海关数据但推断他们有需求所以给20分"。

##### 🟡 产品推断证据（满分20分）

**基于产品实证的推断**：
| 证据来源 | 分数 | 条件 |
|---------|------|------|
| 官网明确写明使用某品牌元器件（如 Siemens CNC 控制器、Mitsubishi 伺服） | 20分 | 必须有具体品牌名 |
| 官网产品页有型号前缀（如 STM32、XC7、TPS） | 20分 | 必须有具体型号 |
| 官网显示全球品牌但无具体型号（如"使用TI芯片"但不说哪款） | 15分 | 泛品牌提及 |
| 设备品类推断（如生产CNC机床 → 需要伺服/PLC） | 10分 | 品类→需求逻辑链 |
| 无任何证据 | 0分 | — |

> ⚠️ 推断必须标注置信度：✅高（官网明确写品牌/型号）、⚠️中（接口/规格推断）、❌低（纯品类推测）

**输出格式**（必须区分两类）：

```markdown
### 采购需求分析

#### 🔴 海关实证
| 来源 | 状态 | 详情 |
|------|------|------|
| UN Comtrade | ✅/❌ | [具体金额/无数据] |
| elcp.ru | ✅/❌ | [注册类型/未注册] |

**海关实证得分**: [0或40]（无中间值）

#### 🟡 产品推断
| 产品/信号 | 推断的元器件需求 | 证据来源 | 置信度 |
|----------|----------------|---------|--------|
| [具体产品名] | [品牌+品类] | [URL] | ✅/⚠️/❌ |

**产品推断得分**: [0-20]

#### 采购需求总评
- 实证: [0或40]分 — [有海关数据/无海关数据]
- 推断: [0-20]分 — [基于XX证据推断]
- 两者不能相加，独立呈现

### 机会判断（4行结构化摘要 —— 强制输出）

> **用途**：报告顶部决策摘要，供 HTML 渲染层直接解析为 Panel，也供 worker 的 `opportunity_summary` 字段写入数据库。
> **位置**：紧跟在 `## [公司名] | [域名] | 评分: [X]/100 [⭐×N]` 标题行之后。
> **格式**：固定 4 行，每行以 emoji 开头，不可换顺序，不可省略。

```markdown
### 机会判断

⚡ [中文名/俄语简称] | [行业标签(10字内)] | [城市] | [员工N人] | [年营收]
    机会逻辑: [他们做什么] → [需要什么元器件] → [我们能供应什么]（50字内）
📞 入口: [联系人分类标签] | [关键联系方式] | [备注]
🚩 [制裁状态] | [评分N/100] [⭐×N] | [行动建议: 开发/试探/观察/暂不开发/合规风险]
```

**字段说明**：

| 行 | emoji | 内容 | 数据源 | 示例 |
|---|-------|------|--------|------|
| 1 | ⚡ | 公司名+行业标签+城市+规模 | `company_name` 中文简称 + `industry` 摘要 + `city` + `employees` + `description`中提取营收 | `⚡ Станки Трейд \| CNC设备组装 \| 雅罗斯拉夫尔 \| 15人 \| 2.51亿₽` |
| 2 | (无) | 三段机会逻辑 | `outreach_angle` 首句 + `products` 关键项 | `\t组装CNC加工中心/水刀 → 消耗GSK25i控制器+Siemens伺服 → 华强北可供应全套替代` |
| 3 | 📞 | 联系人质量+联系方式+备注 | `contact_classification` + `contacts_summary` | `📞 入口联系人 \| zakaz@ts-stanki.ru + 热线 \| CEO已确认但无个人通道` |
| 4 | 🚩 | 制裁+评分+行动 | `sanction_status` + `score`/`rating` + 自动判定 | `🚩 PARTIAL_CLEAR \| ⭐⭐ 45/100 \| 🔍 试探接触` |

**行动建议自动判定逻辑**：

| 条件 | 建议标签 |
|------|---------|
| `sanction_status == 'HIT'` | `⚠️ 合规风险` |
| `score >= 70` | `🔥 优先开发` |
| `score >= 50` | `✅ 正常开发` |
| `score >= 30` 且 `contact_classification != '未找到'` | `🔍 试探接触` |
| `score < 30` 或 `contact_classification == '未找到'` | `⏸️ 暂不开发` |

**反面示例（不要这么做）**：
```
❌ 机会摘要
ООО «Станки Трейд» | ts-stanki.ru | 评分: 45/100 ⭐⭐
```
——这只是标题重复，没有摘要任何信息。

**输出示例（真实案例）**：

```markdown
### 机会判断

⚡ Станки Трейд | CNC设备组装贸易 | 雅罗斯拉夫尔 | 15人 | 2.51亿₽
    组装CNC加工中心(VMC850)/水刀/激光设备 → 消耗GSK25i控制器+Siemens伺服+变频器 → 华强北可供应全套控制器替代+伺服驱动+功率器件
📞 入口联系人 | zakaz@ts-stanki.ru · 8-800-550-33-50 | CEO Шабалин Е.Н.已确认但无个人通道
🚩 PARTIAL_CLEAR | ⭐⭐ 45/100 | 🔍 试探接触
```

```markdown
### 机会判断

⚡ НПФ Мехатроникс | 工业自动化PC制造商 | 莫斯科 | 9人 | 2.57亿₽
    自有品牌MechaTRONICS工业PC+代理Schneider/Siemens → 消耗Intel N100+Realtek RTL8111+RS-485/232收发器 → 华强北可供应CPU/接口芯片/DC-DC模块
📞 入口联系人 | sales@mechatronics.ru · +7(495)726-78-15 | 9人小公司，总经理即决策人
🚩 CLEAR | ⭐⭐⭐⭐ 70/100 | ✅ 正常开发
```

```markdown
### 机会判断

⚡ ООО Компания Астро | 汽车电子制造商 | 奔萨 | 25人 | 5500万₽
    自有品牌控制器/继电器/传感器/调节器+SMD贴片产线 → 消耗MCU+功率MOSFET+传感器IC+被动元件 → 华强北可供应STM32/GD32替代+全品类元器件
📞 已验证联系人 | penza-astro@mail.ru · +7(8412)48-00-15(采购直拨) | CEO Старцев В.В. + 采购部独立直拨
🚩 CLEAR | ⭐⭐⭐ 55/100 | ✅ 正常开发
```

**渲染端解析规则**（供 `convert_recon_reports_to_html.py` / `report.html` 模板参考）：

1. 在 Markdown 中搜索 `### 机会判断` 后的 4 行
2. 第 1 行匹配 `^⚡ ` → 渲染为公司身份
3. 第 2 行匹配 `^ +机会逻辑:` 或 `^\t` → 渲染为机会链路
4. 第 3 行匹配 `^📞 ` → 渲染为联系人质量
5. 第 4 行匹配 `^🚩 ` → 渲染为风险+决策
6. Fallback：如果找不到 4 行结构，从 JSON 字段自行组装（用 `description` + `outreach_angle` + `contacts_summary` + `sanction_status`/`score`）
```

---

### Step 8 — 客户综合评分（100分制，诚实评分）

> **v4.9 核心原则：实证和推断分开，不混分。无证据 = 0分。**

| 维度 | 满分 | 评分规则 |
|------|------|---------|
| **采购需求** | 60分 | 🔴海关实证(0或40) + 🟡产品推断(0-20)。**不能混成一个总分**。实证=查到海关数据40分，没查到0分。推断=基于产品/官网证据0-20分。 |
| **客户类型** | 20分 | 终端制造商 = 20；EMS/方案商 = 15；混合型 = 18；贸易商 = 10；原厂 = 5 |
| **联系信息** | 20分 | 采购/决策人个人邮箱+职位 = 20；采购/决策人姓名+公司邮箱 = 15；通用邮箱+电话 = 10；info@ = 5；仅电话 = 3；**无 = 0** |

**⚠️ 诚实评分红线**：
1. **海关实证是0或40，没有中间值**。不能把产品推断的分数挪到实证里
2. **禁止虚高**：没有具体品牌/型号证据，推断维度不得给超过10分
3. **禁止凑分**：三个维度独立评分，不要因为别的维度高就拉高本维度
4. **加分必须附URL**：每个得分点必须标注证据来源
5. **未执行 = 0分**：某个Step没实际执行，对应维度直接0分
6. **硬上限**：无 INN 或法人时总星级最高⭐⭐；制裁状态不是 CLEAR 时最高⭐⭐；Step 5 未执行或 Step 5+ 应启未启时标记 `需复核`
7. **算术一致**：总分必须等于四个维度相加，不能额外加“品牌库自动加分”等表外分

#### 星级判定

| 总分 | 星级 | 行动建议 |
|------|------|---------|
| 90-100分 | ⭐⭐⭐⭐⭐ | 立即联系 |
| 70-89分 | ⭐⭐⭐⭐ | 本周联系 |
| 50-69分 | ⭐⭐⭐ | 正常开发 |
| 30-49分 | ⭐⭐ | 待观察 |
| <30分 | ⭐ | 暂不开发 |

---

### Step 9 — 置信度评分与话术生成

**置信度**：

| 来源 | 置信度 |
|-----|-------|
| zakupki.gov.ru 招标 PDF 联系人 | ✅ 高 |
| egrul.nalog.ru 法人信息 | ✅ 高 |
| 2+ 独立来源交叉验证 | ✅ 高 |
| saby.ru / list-org.com | ⚠️ 中 |
| 公司官网联系页 | ⚠️ 中（易过期） |
| hh.ru 职位描述邮箱 | ⚠️ 中 |
| 邮箱格式推断 | ⚠️ 中（需验证） |
| 专利/论文中的邮箱 | ⚠️ 中 |
| 单一来源、未交叉 | ❌ 低 |

**话术**：基于思维⑥，从情报中提取信号 → 映射切入角度 → 生成俄语外联开场句。

---

## 输出格式（v5.2 worker-compatible）

> **原则**：决策信息优先，不确定就写「未知」。由 worker 调用时，必须优先满足 worker prompt 的 `fenced JSON + 完整Markdown + 客户数据摘要 + 明文URL` 合同；不要为了精简而省略证据URL、Step 5/5+记录或质量声明。
> **语言原则**：中文是默认阅读语言。俄文原文只作为核验证据保留，不能替代中文结论。

````markdown
```json
{
  "customer_id": "...",
  "company_name": "...",
  "website": "...",
  "sanction_status": "CLEAR/PARTIAL_CLEAR/UNKNOWN/HIT",
  "quality_status": "完整/部分/需复核",
  "missing_steps": [],
  "step5_status": "已执行/未执行",
  "step5_plus_status": "已执行/未触发/应启未启",
  "contact_classification": "已验证联系人/入口联系人/未找到"
}
```

## [公司名] | [域名] | 评分: [X]/100 [⭐×N]

**制裁**: CLEAR / PARTIAL_CLEAR / UNKNOWN / HIT | **质检**: 完整/部分/需复核 | **类型**: ✅制造商 / ❌分销商 | **员工**: [N]人 | **城市**: [X]

## V2 销售决策卡

> 必须紧跟 JSON 之后、旧版标题之前。报告不是材料堆积，先回答销售决策，再展示证据和执行流水。

### 一句话结论

[是否值得开发 + 最关键原因 + 最大风险/缺口。不要超过 120 字。]

### 我们想要什么

| 问题 | 结论 |
|------|------|
| 这家公司做什么 | [只写业务/产品] |
| 它可能需要什么 | [只写有证据或可解释推断的元器件/采购信号] |
| 我们能卖什么 | [只写可供应产品/方案] |
| 应该找谁 | [已验证联系人/入口联系人/未找到；写明来源] |
| 为什么现在可开发 | [增长、制裁替代、国产化、扩产、招聘、采购入口等信号] |
| 先做什么 | [下一步动作] |
| 风险 | [制裁、缺联系人、缺BOM、官网阻断、数据未验证等] |

### 证据链快速表

| 结论 | 已有证据 | 证据强度 | 仍缺什么 |
|------|----------|----------|----------|
| [业务/需求/联系人/制裁/采购等结论] | [来源 + 明文URL] | 高/中/低/待确认 | [缺口] |

> 数据逻辑硬规则：没有 URL 或可追溯来源支撑的关键结论，不得写成确定事实；必须写为 `待确认`，并在“信息缺口转执行任务”中列出怎么补证。

### Step 0-9 输出一览

| Step | 能得出的结果/结论 | 当前证据 | 可执行性 |
|------|------------------|----------|----------|
| Step 0 客户类型 | [结论] | [证据URL/工具] | 已执行/跳过/阻断/失败 |

### 信息缺口转执行任务

| 缺口 | 为什么重要 | 下一步怎么找 |
|------|------------|--------------|
| [缺口] | [影响] | [具体搜索/联系动作] |

### 关键新增：机会判断（4行结构化摘要）

> 位于标题行之后、`### 一句话结论` 之前。渲染层（`recon_agent_worker.py` 中的 `render_html_report()`）和首页 `report.html` HTML 模板均以此 4 行结构为输入。
> 详细规范和案例见 `references/opportunity-summary-format.md`。

```markdown
### 机会判断

⚡ [中文名/俄语简称] | [行业标签(10字内)] | [城市] | [员工N人] | [年营收]
    机会逻辑: [他们做什么] → [需要什么元器件] → [我们能供应什么]（50字内）
📞 入口: [联系人分类标签] | [关键联系方式] | [备注]
🚩 [制裁状态] | [评分N/100] [⭐×N] | [行动建议: 开发/试探/观察/暂不开发/合规风险]
```

**行动建议判定逻辑**（渲染层 `_determine_action()` 函数）：

| 条件 | 输出建议 | 背景色 |
|------|---------|--------|
| `sanction_status == 'HIT'` | `⚠️ 合规风险，谨慎评估` | 红色 |
| `score >= 70` | `🔥 优先开发` | 绿色 |
| `score >= 50` | `✅ 正常开发` | 绿色 |
| `score >= 30` 且 `contact_classification ≠ '未找到'` | `🔍 试探接触` | 黄色 |
| `score >= 30` 但无入口 | `🔍 先确认入口` | 黄色 |
| `score < 30` | `⏸️ 暂不开发` | 灰色 |

> **反面案例**（不要这样做）：
> `机会摘要：ООО «Станки Трейд» | ts-stanki.ru | 评分: 45/100 ⭐⭐`
> → 这只是标题行重复，不提供任何决策信息。
[为什么值得/不值得开发，50字以内]

### 核心数据
- 官方名称 / INN / OGRN：[或「未知」]
- 法人：[姓名 或「未知」]
- 营收：[XX亿卢布(来源:rusprofile)] / 未知
- OKVED主码：[代码+描述] → 关联度: P[N]

### 元器件需求（仅列有证据的）
| 产品/信号 | 元器件 | 证据来源 | 置信度 |
|----------|--------|---------|--------|
| [产品名] | [具体型号或品类] | [URL] | ✅/⚠️ |

> 无证据时写：**未发现具体型号证据。官网产品页未暴露品牌/型号。**

### 联系人（仅列有真实来源的）
| 姓名 | 职位 | 邮箱/电话 | 来源 | 验证状态 |
|------|------|----------|------|---------|

> 无联系人时写：**仅发现 info@xxx.ru（通用邮箱），未找到采购决策人。**

### 评分明细
| 维度 | 得分 | 依据 |
|------|------|------|
| 采购需求-海关实证(40) | [0或40] | [有海关数据/无海关数据] |
| 采购需求-产品推断(20) | [X] | [具体证据或「未找到证据0分」] |
| 客户类型(20) | [X] | [制造商/分销商] |
| 联系信息(20) | [X] | [邮箱类型+是否决策人] |
| **总分** | **[X]** | |

### 外联建议
- 切入角度：[基于实际发现的信号]
- 俄语开场句：[1-2句]

### 数据质量声明
| 项目 | 工具调用次数 | 编造数据条数 |
|------|------------|------------|
| Step 0-9 全流程 | [N]次 | 0条 |

### 信息完整性说明（v4.8 强制）
- 成功获取: [X]步
- 未能完成: [Y]步 → [具体列出]
- 信息缺口: [Z]项 → [具体列出]
- 建议: [人工补充建议]

### 未完成项
- [具体列出哪些步骤没查到、已尝试什么]

## 客户数据摘要
industry: [行业]
customer_type: [客户类型]
city: [城市]
employees: [员工数或未知]
phone: [联系电话或未找到]
email: [联系邮箱或未找到]
inn: [INN或未知]
rating: [⭐/⭐⭐/⭐⭐⭐]
products: [推荐产品]
description: [一句话简介]
sanctioned: true/false
sanction_status: CLEAR/PARTIAL_CLEAR/UNKNOWN/HIT
sanction_source: [来源或空]
sanction_program: [项目或空]
quality_status: 完整/部分/需复核
missing_steps: [缺失步骤]
step5_status: 已执行/未执行
step5_plus_status: 已执行/未触发/应启未启
contact_classification: 已验证联系人/入口联系人/未找到
outreach_angle: [外联切入角度]
contact_name: [联系人姓名或未找到]
contact_title: [职位或未找到]
notes: [备注]
````

---

## 规则

### ⛔ 红线规则（违反任何一条 = 报告作废）

1. **绝不编造数据**。未找到写「не найдено」，附原因和已尝试的搜索方式。
2. **每条数据必须标注来源**。不是笼统的"OpenSanctions"，而是具体的搜索URL或工具调用记录。
3. **推断必须标注为推断**。写清楚"根据XX推断"，不能把推测写成事实。
4. **禁止用推测替代实证**。如果某个层没执行，就写"未执行"，不能编造结论。
5. 所有侦察限于公开 OSINT 数据，不进行系统入侵或身份伪造。

### 📋 每层执行证明（强制格式）

每个Step的输出必须包含以下三部分，缺一不可：

```markdown
### Step X — [层名称]

#### 执行记录
| 序号 | 操作 | 工具/命令 | 搜索词/URL | 返回结果摘要 |
|------|------|----------|------------|------------|
| 1 | [搜索] | lightpanda fetch | [完整URL] | [前200字摘要] |
| 2 | [浏览] | browser_navigate | [完整URL] | [页面关键内容] |
| 3 | [查询] | terminal sqlite3 | [SQL语句] | [返回行数+首行] |

#### 执行结论
[基于上方操作记录得出的结论，每句话都能追溯到上面某一行]

#### 未完成项
- [具体说明什么没查到、已尝试什么、为什么失败]
- [不能留空——要么有结果，要么有失败说明]
```

### 🔒 各层强制检查点

| 层级 | 强制动作 | 最低证据要求 | 不达标的处理 |
|------|---------|-------------|------------|
| **Step 1** | 实际访问rusprofile或list-org | 至少1个工具调用记录 | 写"INN未获取，已尝试rusprofile+list-org+DuckDuckGo" |
| **Step 2** | 实际搜索zakupki.gov.ru | 必须有lightpanda/browser访问记录 | 写"政府采购未查到，已搜索zakupki.gov.ru用公司名+INN" |
| **Step 3** | 至少查2个制裁源 | OpenSanctions + OFAC各1次调用 | **不允许只查1个源就写"完全干净"** |
| **Step 4** | 实际抓取官网产品页 | 至少抓取1个产品详情页 | 写"产品页抓取失败，原因：XX" |
| **Step 5** | 至少查2个社交平台 | LinkedIn+VK/YouTube至少各1次调用 | 写"仅查到XX平台，未查YY平台" |
| **Step 5+** | Step 5 未找到具体可验证联系人时至少执行1个深层侦察工具 | Maigret/theHarvester/holehe任一，或公开文件/PDF/专利/2GIS/招聘署名替代路径 | 找不到或工具不可用也要写"已尝试：XX；结果：未找到/工具不可用"，不能写"不适用" |
| **Step 6** | 实际验证至少1个联系方式 | SMTP探测或2GIS验证或浏览器确认 | 写"未验证，仅有官网公开信息" |
| **Step 7** | 实际扫描官网提取品牌/型号 | 必须访问产品页/数据手册页 | 不能只写"可能使用TI"——要么有证据，要么写"未找到具体型号" |

### 🚨 反糊弄机制

1. **"未执行"优先于"未发现"**：如果某个检查点没有实际执行工具调用，报告里必须写"⚠️ 未执行"，绝不能写"未发现记录"。
2. **禁止夸大**：如果只查了OpenSanctions一个源，就写"OpenSanctions未发现"，不能写"多源交叉验证确认无制裁"。
3. **推测必须标注置信度+依据**：
   - ✅ 高置信度：官网明确写着品牌名/型号
   - ⚠️ 中置信度：从接口类型推断（如CAN接口→可能用NXP/TI收发器）
   - ❌ 低置信度/纯猜测：没有任何依据的"可能"
4. **报告末尾必须附"数据质量自检表"**：

```markdown
### 数据质量自检表

| 检查项 | 实际工具调用次数 | 数据来源数 | 是否有编造 |
|--------|---------------|-----------|-----------| 
| Step 0 类型判定 | [N]次 | [N]个 | ✅无/❌有 |
| Step 1 身份锚定 | [N]次 | [N]个 | ✅无/❌有 |
| Step 2 政府采购 | [N]次 | [N]个 | ✅无/❌有 |
| Step 3 制裁检查 | [N]次 | [N]个 | ✅无/❌有 |
| Step 4 元器件需求 | [N]次 | [N]个 | ✅无/❌有 |
| Step 5 社交痕迹 | [N]次 | [N]个 | ✅无/❌有 |
| Step 5+ 深层侦察 | [N]次/未触发/应启未启 | [N]个 | ✅无/❌有 |
| Step 6 联系人验证 | [N]次 | [N]个 | ✅无/❌有 |
| Step 7 品牌识别 | [N]次 | [N]个 | ✅无/❌有 |

**编造数据条数**: [N]条（如有，必须标红说明并重新执行）
```

5. **⚠️ Diff 格式输出污染（v5.0 新增）**：Hermes 有时将以 `git diff` 格式返回报告（以 `review diff` / `a/report.md → b/report.md` / `@@ -0,0 +1,N @@` 开头，每行带 `+` 前缀）。这会导致 `## 客户数据摘要` YAML 块及全部结构化数据被 diff 封装。worker 的 `clean_report_line()` 和 `extract_structured_data()` 通过 `normalized = "\\n".join(clean_report_line(line) ...)` 处理 `+` 前缀，但 `review diff` 头行和 `@@` 行可能干扰 regex fallback。  
   **AI 输出规则**：prompt 中已有 `Do not return a git diff, patch, or lines prefixed with \"+\"` 指令。如果仍然出现，worker 侧需前置过滤：检测前 3 行是否含 `review diff`，是则剥离 diff 头、去掉所有 `+`/`-` 前缀后再解析。此坑无法彻底消除，worker 解析层必须容错。

6. **通用规则**：
   - 每层 2-3 次搜索无结果后移至下一层，不在单层过度投入
   - zakupki PDF 是最高价值来源，有招标记录必须下载文件
   - Step 4 搜不到不是失败，是触发思维⑤的信号
   - 每次执行必须输出外联开场句
   - 制裁名单动态更新，建议每季度复查，最终合规决策请咨询专业律师

---

## 参考

- **[ru-sources.md](references/ru-sources.md)** — 俄罗斯数据源完整列表（按可信度分层）
- **[mindsets.md](references/mindsets.md)** — 四种黑客思维详细参考
- **[target-databases.md](references/target-databases.md)** — 专利与海关数据库清单
- **[worker-data-contract.md](references/worker-data-contract.md)** — 本 skill 与 `recon_agent_worker.py` 及 CRM 数据库之间的数据契约。包含 `## 客户数据摘要` YAML 格式、40字段 result dict → database 映射表、worker 各个解析函数的说明。**修改 prompt / 新增输出字段前必读。**
- **[scrapling-integration.md](references/scrapling-integration.md)** — Scrapling 集成参考 (v5.5)：安装、测试结果、已知坑、API 参考
- **[practical-cases.md](references/practical-cases.md)** — 实战案例库：每次执行后记录的典型公司画像、亮点、坑点和评分分布参考。执行前可快速浏览同类案例。**新增案例时追加到该文件末尾。**

### 关联技能

- **customer-pool-grading** (openclaw-imports): 本技能的 Step 8 评分体系已被改编为批量客户池分级工具。如果需要同时对数百家客户做统一评分和重新分池（而非逐家深度侦察），应加载 `customer-pool-grading` 技能。该技能将 Step 8 的 4 维度评分扩展为 6 维度（+市场活跃度 + 地理位置），并自动化了清洗、验证、制裁核查等前序步骤。

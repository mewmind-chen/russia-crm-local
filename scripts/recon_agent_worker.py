#!/usr/bin/env python3
"""Poll Russia-recon jobs from the CRM API and backfill sourced results."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_WEBAPP_URL = "http://localhost:3000/api/recon"
DEFAULT_HERMES_BIN = "/Users/ylf/.hermes/hermes-agent/venv/bin/hermes"
DEFAULT_HERMES_SKILL = "russia-recon"
DEFAULT_NETWORK_SENTINEL_ROOT = "/Users/ylf/Desktop/projects/network-sentinel"
DEFAULT_RECON_PROXY = "http://127.0.0.1:7897"
GENERIC_MAILBOX_PREFIXES = {
    "info", "office", "sales", "admin", "contact", "support", "mail", "hello", "team",
    "zakup", "zakupki", "procurement", "purchase", "hr", "career", "careers", "service",
}


class ReconApiError(RuntimeError):
    pass


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def post_json(url: str, token: str, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = {"action": action, "token": token}
    if payload:
        body.update(payload)
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            text = response.read().decode("utf-8")
    except urllib.error.URLError as exc:
        raise ReconApiError(f"API request failed for {action}: {exc}") from exc
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ReconApiError(f"API returned non-JSON for {action}: {text[:500]}") from exc
    if not parsed.get("ok"):
        raise ReconApiError(parsed.get("error") or f"API returned ok=false for {action}")
    return parsed


def now_slug() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(value: str) -> str:
    allowed = []
    for char in value:
        if char.isalnum() or char in ("-", "_", "."):
            allowed.append(char)
        elif char.isspace():
            allowed.append("-")
    return "".join(allowed).strip("-")[:80] or "customer"


def is_generic_mailbox(email: str) -> bool:
    local = (email or "").strip().split("@", 1)[0].lower()
    if not local:
        return True
    return any(local == prefix or local.startswith(f"{prefix}.") or local.startswith(f"{prefix}_") for prefix in GENERIC_MAILBOX_PREFIXES)


def run_local_json_command(name: str, command: list[str], cwd: Path, timeout: int) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {
            "name": name,
            "ok": False,
            "returncode": 1,
            "stdout": "",
            "stderr": "",
            "error": str(exc)[:300],
            "json": {},
        }
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    try:
        parsed = json.loads(stdout) if stdout.strip() else {}
    except json.JSONDecodeError:
        parsed = {}
    return {
        "name": name,
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": stdout[-1500:],
        "stderr": stderr[-1500:],
        "error": (stderr or "")[:300],
        "json": parsed if isinstance(parsed, dict) else {},
    }


def has_independent_domain(website_or_domain: str) -> bool:
    clean = infer_domain(website_or_domain)
    if not clean:
        return False
    blocked_suffixes = ("yp.ru", "2gis.ru", "list-org.com", "saby.ru", "vk.com", "hh.ru")
    return not any(clean == suffix or clean.endswith(f".{suffix}") for suffix in blocked_suffixes)


def probe_execution_capabilities(job: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    sentinel_root = Path(DEFAULT_NETWORK_SENTINEL_ROOT)
    preflight_dir = output_dir / "preflight"
    preflight_dir.mkdir(parents=True, exist_ok=True)

    commands = {
        "credentials_doctor": [
            "python3", "-m", "network_sentinel.cli", "credentials", "doctor", "--no-subscriptions",
        ],
        "mihomo": [
            "python3", "-m", "network_sentinel.cli", "mihomo", "--controller-socket", "/tmp/verge/verge-mihomo.sock",
        ],
        "fetch": [
            "python3", "-m", "network_sentinel.cli", "fetch", "https://example.com",
            "--proxy", DEFAULT_RECON_PROXY, "--route", "auto", "--timeout", "15", "--text",
            "--out", str(preflight_dir / "fetch"),
        ],
        "scrapling": [
            "python3", "-m", "network_sentinel.cli", "scrapling-fetch", "https://example.com",
            "--proxy", DEFAULT_RECON_PROXY, "--route", "auto", "--timeout", "20", "--text",
            "--out", str(preflight_dir / "scrapling"),
        ],
        "browser": [
            "python3", "-m", "network_sentinel.cli", "browser-check", "--timeout", "20",
        ],
    }

    results = {
        key: run_local_json_command(key, command, sentinel_root, 180 if key == "browser" else 90)
        for key, command in commands.items()
    }

    browser_json = results["browser"].get("json") or {}
    fetch_json = results["fetch"].get("json") or {}
    scrapling_json = results["scrapling"].get("json") or {}
    credentials_json = results["credentials_doctor"].get("json") or {}
    mihomo_json = results["mihomo"].get("json") or {}

    known_email = str(job.get("email") or "").strip()
    eligibility = {
        "known_independent_domain": has_independent_domain(str(job.get("website") or job.get("domain") or "")),
        "known_unique_username": False,
        "known_personal_email": bool(known_email and not is_generic_mailbox(known_email)),
        "comtrade_api_key": bool(os.environ.get("UN_COMTRADE_API_KEY")),
        "browser_required_sources_enabled": bool(browser_json.get("browser_fetch_ok")),
    }

    payload = {
        "generated_at": iso_now(),
        "proxy_url": DEFAULT_RECON_PROXY,
        "api_broker_ok": bool(credentials_json.get("ok")),
        "scrapling_ok": scrapling_json.get("status") in {"ok", "blocked"} or results["scrapling"]["returncode"] in (0, 2),
        "fetch_ok": fetch_json.get("status") in {"ok", "blocked"} or results["fetch"]["returncode"] in (0, 2),
        "browser_fetch_ok": bool(browser_json.get("browser_fetch_ok")),
        "stealth_fetch_ok": bool(browser_json.get("stealth_fetch_ok")),
        "cloakbrowser_ok": bool(browser_json.get("cloakbrowser_ok")),
        "playwright_runtime_ok": bool(browser_json.get("playwright_runtime_ok")),
        "rebrowser_patch_ok": bool(browser_json.get("rebrowser_patch_ok")),
        "mihomo_ok": bool(mihomo_json.get("ok")),
        "eligibility": eligibility,
        "commands": {
            key: {
                "ok": value["ok"],
                "returncode": value["returncode"],
                "json": value["json"],
                "stderr": value["stderr"],
                "error": value["error"],
            }
            for key, value in results.items()
        },
    }

    (output_dir / "capabilities.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def build_prompt(job: dict[str, Any], output_dir: Path, capabilities: dict[str, Any]) -> str:
    company = job.get("company_name") or job.get("customer_id") or "Unknown customer"
    website = job.get("website") or job.get("domain") or ""
    inn = job.get("inn") or ""
    report_path = output_dir / "report.html"
    eligibility = capabilities.get("eligibility") or {}
    browser_fetch_ok = bool(capabilities.get("browser_fetch_ok"))
    stealth_fetch_ok = bool(capabilities.get("stealth_fetch_ok"))
    cloakbrowser_ok = bool(capabilities.get("cloakbrowser_ok"))
    playwright_runtime_ok = bool(capabilities.get("playwright_runtime_ok"))
    capability_json = json.dumps(
        {
            "api_broker_ok": capabilities.get("api_broker_ok"),
            "scrapling_ok": capabilities.get("scrapling_ok"),
            "fetch_ok": capabilities.get("fetch_ok"),
            "browser_fetch_ok": browser_fetch_ok,
            "stealth_fetch_ok": stealth_fetch_ok,
            "cloakbrowser_ok": cloakbrowser_ok,
            "playwright_runtime_ok": playwright_runtime_ok,
            "mihomo_ok": capabilities.get("mihomo_ok"),
            "eligibility": eligibility,
        },
        ensure_ascii=False,
        indent=2,
    )
    return f"""
You are running inside Hermes and MUST use the Hermes skill `{DEFAULT_HERMES_SKILL}` for this task.
Before researching, load and follow the russia-recon skill instructions, especially its step checklist.
You are Russia-recon, an evidence-first OSINT agent for one Russian B2B lead.

Target:
- customer_id: {job.get("customer_id", "")}
- company_name: {company}
- website/domain: {website}
- INN: {inn}

Execution capability snapshot for THIS run (must obey):
```json
{capability_json}
```

Rules:
- All network access must use the local Mihomo proxy on 127.0.0.1:7897.
  Use http://127.0.0.1:7897 for HTTP/Lightpanda and socks5://127.0.0.1:7897 for SMTP/SOCKS tools.
- Before opening external sources, run the local recon-only fetch helper:
  cd {DEFAULT_NETWORK_SENTINEL_ROOT}
  python3 -m network_sentinel.cli check --proxy {DEFAULT_RECON_PROXY} --timeout 15
- Before or during key fetches, keep route awareness:
  `python3 -m network_sentinel.cli route-check "<PUBLIC_URL>" --route auto`
  The helper reads Clash Verge/Mihomo via `/tmp/verge/verge-mihomo.sock` and reports route_policy, route_group, route_node, route_warning.
- Capability gating is mandatory:
  * If `browser_fetch_ok=false`, browser-only checks are NOT part of the required execution set for this run. Do not schedule hh.ru / 2GIS / VK / rusprofile / patent browser crawling as mandatory. Use API Broker, official public sources, scrapling-fetch, fetch, and browser-independent evidence instead.
  * If `cloakbrowser_ok=true`, browser-fetch/stealth-fetch use CloakBrowser as the preferred browser backend by default. Record `transport=cloakbrowser` when it is used.
  * If `cloakbrowser_ok=false` but `browser_fetch_ok=true`, browser-fetch may fall back to the older Playwright/rebrowser backend. Record that fallback instead of treating it as a source result problem.
  * If `stealth_fetch_ok=false`, do not promise stealth retries.
  * If `playwright_runtime_ok=false`, treat the browser layer as unavailable for this run.
  * If `eligibility.known_unique_username=false`, Maigret is not a required step unless you later discover a concrete username or person-handle.
  * If `eligibility.known_personal_email=false`, holehe is not a required step unless you later discover a non-generic personal email.
  * If `eligibility.comtrade_api_key=false`, UN Comtrade is not a required step for this run.
  * Only checks that are both executable in the current environment and have valid inputs should appear as "应执行" in your own checklist.
- Use network-sentinel API Broker before legacy browsing tools:
  * Check available no-subscription sources first:
    `python3 -m network_sentinel.cli credentials doctor --no-subscriptions`
  * Search should use no-subscription API sources first, never raw Google/DuckDuckGo/Yandex pages as the main path:
    `python3 -m network_sentinel.cli api-search "<QUERY>" --free-only`
    This broker tries Brave, Tavily, then Exa. Google Custom Search JSON API is not part of the new-customer-safe path and must be treated as disabled unless policy changes. If no key/quota is available, record the broker result and use one browser fallback only.
  * Sanctions must use official downloads and optional OpenSanctions free key first:
    `python3 -m network_sentinel.cli api-sanctions --name "<LEGAL_OR_COMMON_NAME>" --inn "<INN>"`
    This replaces direct OFAC/EU/UK webpage searching as the main path.
  * Russian registry checks must use no-subscription official/public sources first:
    `python3 -m network_sentinel.cli api-registry --name "<LEGAL_OR_COMMON_NAME>" --inn "<INN>"`
    This replaces Zachestnyibiznes paid API usage. Paid Zachestnyibiznes, production 2GIS, and Yandex Search API are disabled by policy.
  * Hiring signals may try hh.ru API first, but only as an optional enhancer:
    `python3 -m network_sentinel.cli api-hiring --company "<COMPANY_NAME>"`
    If hh anonymous access is blocked, or hh developer registration is not available, record that and continue with browser fallback plus other public sources. If a manual `HH_ACCESS_TOKEN` exists, the broker will use it automatically.
  * If APIs are missing, partial, quota-limited, or you still need webpage evidence from an official/static page, use Scrapling before the older fetchers:
    `python3 -m network_sentinel.cli scrapling-fetch "<PUBLIC_URL>" --proxy {DEFAULT_RECON_PROXY} --route auto --text`
    Use this for official sites, OpenSanctions entity/search pages, public sanctions text pages, company homepages, about/contact/requisites pages, and other light-to-medium protection pages. Do not use Scrapling as the main path for Google/Yandex/DuckDuckGo search result pages.
  * Direct official sites and static pages may still use legacy fetch as a lighter fallback after Scrapling:
    `python3 -m network_sentinel.cli fetch "<PUBLIC_URL>" --proxy {DEFAULT_RECON_PROXY} --route auto --text`
  * rusprofile / list-org / saby / yp.ru / 2GIS / hh.ru / VK browser pages are fallback only, and only when `browser_fetch_ok=true`:
    `python3 -m network_sentinel.cli browser-fetch "<PUBLIC_URL>" --proxy {DEFAULT_RECON_PROXY} --route auto --text --screenshot`
    By default this tries CloakBrowser first (`--backend auto`) and only falls back to the old Playwright backend on CloakBrowser runtime errors.
  * If `browser_fetch_ok=true` and browser-fetch is blocked by automation detection, try once with `python3 -m network_sentinel.cli stealth-fetch "<PUBLIC_URL>" --proxy {DEFAULT_RECON_PROXY} --route auto --text --screenshot` only when `stealth_fetch_ok=true`. This also tries CloakBrowser first by default.
- Route defaults: `.ru/.su/.by/.kz` and rusprofile/zachestnyibiznes/2GIS/yp/hh/VK/Yandex should show route_group=RU; OpenSanctions/OFAC/EU/UK/Google should show route_group=US; localhost/127.0.0.1 should show DIRECT.
- Maintain a per-job state in the report execution record:
  blocked_sources, session_state, ip_burned, hopeless, step_skipped.
- For every source, record route_policy, route_group, route_node, and route_warning. If a RU source is blocked, you may retry once with `--route us` only to diagnose route/IP blocking, then switch sources. Do not call it "no result".
- Treat `*.yp.ru`, `*.2gis.ru`, and `*.b2b.*` as directory pages, not official sites. Do not keep scraping them as homepages after a block; use company name, subdomain prefix, phone, or INN to find the independent official site and registry pages.
- Do not run tools without valid inputs: no INN means skip INN-dependent procurement deep dives; no independent domain means skip theHarvester; no person/username means skip Maigret; no email means skip holehe.
- When Yandex, Google, DuckDuckGo, 2GIS, rusprofile, or yp.ru is blocked, immediately switch to API Broker results, official site, official public downloads, Scrapling official-page fallback, optional hh.ru API evidence, and then one browser fallback. Do not describe a blocked source as "no result".
- Do not use paid-subscription APIs in the main path. Treat production 2GIS API, paid Zachestnyibiznes API, and Yandex Search API as `subscription_required_disabled` unless the user explicitly changes policy.
- Treat Google Custom Search JSON API as `existing_customers_only_disabled` in this project. Vertex AI Search is a billing-backed site/domain search product and is not part of this no-subscription web-search path.
- Treat network-sentinel `status=blocked` as a real observation. Record `block_type` plus route_group/route_node, stop hammering that same source, continue with alternate public sources, and make the degradation explicit in the report.
- `ip_burned` or `hopeless` may trigger transparent score downgrade, but it must not skip Step 5 entry-contact checks or required Step 5+ documentation.
- Use legacy `lightpanda` / `browser_navigate` only when network-sentinel returns `status=error` or the helper does not cover the source. Record the fallback result.
- You may read local `saved_body` files for analysis, but report evidence URLs and CRM evidence fields must use the original public URL, not local artifact paths.
- Use only real, checkable sources. Do not fabricate contacts, names, phones, emails, sanctions, or conclusions.
- Every important fact in the report must include a real source URL in plain text.
- Step 5 is mandatory, but "mandatory" means all currently eligible and available public-source contact checks must run. If browser capability is unavailable, execute the browser-independent part of Step 5 and state that browser-only checks were not eligible in this run.
- Step 5 must prioritize official social links, Telegram, WhatsApp/phone, API Broker evidence, company name + директор/владелец/снабжение/закупки, and then browser-only surfaces (VK / 2GIS / hh.ru) only when browser capability is available.
- If Step 5 does not find a concrete person name, Step 5+ is mandatory for currently eligible tools. Check public files/PDFs, patents/public registries where applicable, domain email patterns, available theHarvester/Maigret/holehe tools, recruitment signatures, 2GIS branch/comment clues. If a tool is unavailable or prerequisites are missing, state that exact reason and the fallback used.
- Contact output must classify findings as exactly one of: 已验证联系人, 入口联系人, 未找到. Do not put an unsigned CEO/owner role into contact_name.
- If no contact is found, write "未找到"; do not infer a contact.
- Sanctions are a neutral factual marker and an opportunity signal. Do not write risk warnings, blocking language, "不建议直接接触", or "合规风险" as the conclusion.
- When sanctions are found, explain the business meaning as supply-chain displacement / replacement demand / sourcing pressure. Keep compliance facts factual, but do not make sanctions a negative scoring gate.
- If sanctions are found, set sanctioned=true and include sanction_source, sanction_program, sanction_checked_at, and evidence_url.
- Sanction status must be one of CLEAR, PARTIAL_CLEAR, UNKNOWN, HIT. Only write CLEAR when OpenSanctions, OFAC, EU, and UK checks all completed with no hit. If EU or UK is not completed, write PARTIAL_CLEAR or UNKNOWN, never CLEAR.
- Quality gates: no INN or no legal representative caps the rating at ⭐⭐; missing Step 5 or missing required Step 5+ marks quality_status=需复核. Sanction status must never cap the score/rating by itself.
- Score arithmetic must be exact: total score equals customs evidence + product inference + customer type + contact information. Do not add hidden bonus points.
- Prefer official website, official registry/procurement pages, sanction list pages, and archived/source pages that can be opened by a human.
- Report semantics:
  * Use `前提不满足` or `当前环境不可用，已改走替代源` when a check is skipped because inputs or runtime capability are missing.
  * Reserve `未执行` for checks that should have run in the current environment but were actually omitted.
  * In `Network Sentinel预检结果`, explicitly state the capability snapshot, current crawl layer used, and why browser-only items were included or excluded.
- Language rules are mandatory:
  * The report is for Chinese CRM users first. All summary fields and narrative sections must be written in natural Chinese.
  * These JSON fields must be Chinese-first, not Russian-first: industry, products, description, contacts_summary, outreach_angle, next_action, notes, contact_title.
  * Every Step must write its execution conclusion, analysis, score, contact finding, outreach recommendation, and `客户数据摘要` in Chinese.
  * Russian is allowed only for legal company names, original titles, official role names, short evidence excerpts, and proper nouns in parentheses.
  * Do not dump long Russian paragraphs into the summary, contact, recommendation, next-step, scoring, or `客户数据摘要` sections.
  * Evidence lines must use this style whenever source text is quoted: `中文解释：...；原文：...；URL：https://...`
  * If the source itself is Russian, translate the meaning into Chinese first, then keep only the minimal original Russian quote needed for verification.
  * Write official Russian role names as Chinese first plus Russian in parentheses, for example `物资技术供应总监（Директор по МТО и общим вопросам）`.

Return a structured JSON summary first, then the complete report as Markdown. Do not return JSON only.
Your final answer is parsed from stdout. Print the full JSON + Markdown report directly in the final answer.
Do not say "Analysis complete", "Report delivered", "Report saved", or only provide a report.html path.
Do not claim you saved/generated the HTML file; the worker will save it after parsing your stdout.
Do not return a git diff, patch, or lines prefixed with "+".
The eventual HTML destination is only for context:
{report_path}

Structured summary format:
- Start with a fenced block exactly ```json.
- Include one JSON object with these keys:
  customer_id, company_name, website, industry, customer_type, city, employees, phone, email, inn,
  rating, score, products, description, opportunity_summary, sanctioned, sanction_status, sanction_source, sanction_program,
  sanction_checked_at, evidence_url, quality_status, missing_steps, step5_status, step5_plus_status,
  contact_classification, contact_name, contact_title, contacts_summary, outreach_angle, next_action, notes,
  opportunity_do, opportunity_need, opportunity_sell, opportunity_contact, opportunity_decision, execution_log.
- missing_steps must be an array of strings.
- Use empty string for unknown scalar fields and false for sanctioned when no direct hit is found.
- Values for industry, products, description, contacts_summary, contact_title, outreach_angle, next_action, and notes must be Chinese-first. Do not put Russian-only values in these fields.
- opportunity_summary must be a concise Chinese business opportunity judgment (80 chars max), not a process sentence such as "Now I have enough data" or "开始编译报告".
- The following 4 fields are the OPPORTUNITY DASHBOARD source data. They must be short, Chinese, and semantically separated:
  opportunity_do: 只写他们做什么产品/业务(20字内). Do not include revenue, employee count, contact, sanctions, or sales pitch. Example: "生产PLC控制器和变频器"
  opportunity_need: 只写他们需要/可能采购的电子元器件或替代采购信号(35字内). Do not write "贵司/我们/我方/可提供/建议/联系". Example: "STM32 MCU、IGBT模块、RS-485/CAN收发器"
  opportunity_sell: 只写可提供的产品/方案(35字内). Do not write "华强北", "我们", "贵司", contact plan, or sales pitch. Example: "GD32 MCU、IGBT模块、工业通信芯片"
  opportunity_decision: 只写动作判断(40字内). Format: "评分X分，[关键信号]，建议[行动]". Do not include email addresses or long outreach steps. Example: "评分45分，有入口邮箱，建议试探接触"
- customer_type must use one of: 终端制造商, 终端客户, 贸易公司, 系统集成商, 贴片厂/PCBA, EMS/方案商, 原厂, 平台型, 混合型, 服务商/非目标, 待确认.
- industry must use one of: 电子设备制造, 工业控制, 电子制造服务, 电子系统集成, 电力电子, 汽车电子, 导航电子, 医疗电子, 铁路电子, 工业自动化, 航空电子, 通信网络, 电力能源, 半导体/微电子, 非目标/其他.
- execution_log is mandatory. It must be an object with `version: "recon-execution-log-v1"` and `records: []`.
- Each execution_log record must include: step, action, tool, query_or_url, source_url, status, found, evidence_type, confidence, failure_reason, saved_body, route_group, route_node, notes.
- status must be one of: ok, no_result, blocked, failed, skipped_input_missing, skipped_capability_missing.
- evidence_type must be one of: identity, product, contact, procurement, sanction, hiring, social, registry, inference, preflight, report_source.
- Every currently eligible Step 0-9 check must have either an `ok/no_result/blocked/failed` record or a `skipped_input_missing/skipped_capability_missing` record. Do not claim a step was executed without an execution_log record.
- Step 5 must have records for official contact/social extraction and any eligible VK/Telegram/2GIS/hh/API contact checks. If Step 5 finds no named contact, Step 5+ must have at least one eligible deep-search record or a specific skipped/failed record.
- Use public URLs in source_url whenever the action touched a public source. Local saved_body paths are allowed only in saved_body.

Report format:
- Chinese Markdown.
- Include sections in this order: V2 销售决策卡, 目标, Network Sentinel预检结果, 核验事实, 制裁标记, 机会判断, 联系人, Step 5执行记录, Step 5+执行记录, 数据质量声明, 证据链接.
- `## V2 销售决策卡` is mandatory and must appear immediately after the fenced JSON. It must include:
  * `### 一句话结论`: say whether to develop this customer and why, in one concise Chinese paragraph.
  * `### 我们想要什么`: a table answering exactly these questions: 这家公司做什么, 它可能需要什么, 我们能卖什么, 应该找谁, 为什么现在可开发, 先做什么, 风险.
  * `### 证据链快速表`: every important business conclusion must map to source evidence and evidence strength. If no source supports a claim, write `待确认` and do not present it as fact.
  * `### Step 0-9 输出一览`: one row per step explaining what result/conclusion that step produced and whether it was executed, skipped, blocked, or failed.
  * `### 信息缺口转执行任务`: convert unsupported claims and missing data into concrete next search/contact tasks.
- Data logic is strict: never let a sales-friendly conclusion outrun evidence. For unsupported demand, contact, revenue, employee, sanction, or procurement claims, either find a source URL and cite it visibly, or downgrade the claim to `待确认/需复核`.
- The Network Sentinel section must show verdict, blocked_sources, crawl layer used (api-broker/scrapling-fetch/fetch/browser-fetch/stealth-fetch), browser backend used (cloakbrowser/playwright when relevant), source_type (official_download/free_api/free_quota_api/official_public_service/web_fallback), route_group/route_node when relevant, blocked reasons, and alternate sources used.
- Put every source URL as a visible plain URL, not hidden only behind markdown link text.
- At the END of your report, add a section titled exactly "## 客户数据摘要" with these fields in YAML-like format (each line: "field: value"). Do not omit this section. The worker will parse this to auto-fill the CRM:
  ```
  ## 客户数据摘要
  industry: 提取的行业
  customer_type: 提取的客户类型(终端制造商/终端客户/贸易公司/系统集成商/贴片厂/PCBA/EMS/方案商/原厂/平台型/混合型/服务商/非目标/待确认)
  city: 城市
  employees: 员工数(数字)
  phone: 联系电话
  email: 联系邮箱
  inn: INN号
  rating: 推荐等级(⭐/⭐⭐/⭐⭐⭐)
  products: 推荐产品
  description: 一句话简介(50字以内)
  opportunity_summary: 中文机会判断(说明为什么值得/不值得开发，80字以内)
  sanctioned: true/false
  sanction_status: CLEAR/PARTIAL_CLEAR/UNKNOWN/HIT
  sanction_source: 制裁来源
  sanction_program: 制裁计划
  quality_status: 完整/部分/需复核
  missing_steps: 缺失步骤列表
  step5_status: 已执行/未执行
  step5_plus_status: 已执行/未触发/应启未启
  contact_classification: 已验证联系人/入口联系人/未找到
  outreach_angle: 外联切入角度(基于发现的信号，可比opportunity字段更长)
  contact_name: 联系人姓名
  contact_title: 联系人职位
  notes: 额外备注(如制裁机会信号/特殊发现)
  opportunity_do: 他们做什么产品(20字内，只写业务)
  opportunity_need: 他们需要什么元器件(35字内，只写需求/采购信号)
  opportunity_sell: 我们能供应什么(35字内，只写产品/方案)
  opportunity_decision: 决策建议(40字内，只写动作判断)
  ```
""".strip()


def run_agent(
    hermes_bin: str,
    hermes_skill: str | None,
    prompt: str,
    output_dir: Path,
    timeout: int,
    prompt_name: str = "prompt.txt",
    stdout_name: str = "hermes_stdout.txt",
    stderr_name: str = "hermes_stderr.log",
) -> str:
    prompt_path = output_dir / prompt_name
    stdout_path = output_dir / stdout_name
    stderr_path = output_dir / stderr_name
    prompt_path.write_text(prompt, encoding="utf-8")
    command = [hermes_bin, "chat", "--query", prompt, "--yolo", "--quiet"]
    if hermes_skill:
        command.extend(["--skills", hermes_skill])
    completed = subprocess.run(command, cwd=str(output_dir), text=True, capture_output=True, timeout=timeout, check=False)
    stdout_path.write_text(completed.stdout or "", encoding="utf-8")
    stderr_path.write_text(completed.stderr or "", encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(f"Hermes exited with {completed.returncode}; see {stderr_path}")
    return completed.stdout or ""


def validate_payload(result: dict[str, Any], evidence: list[dict[str, Any]]) -> None:
    if not isinstance(result, dict):
        raise ValueError("result.json must contain a JSON object")
    if not isinstance(evidence, list):
        raise ValueError("evidence.json must contain a JSON array")
    valid_evidence = [item for item in evidence if isinstance(item, dict) and item.get("field_name") and item.get("source_url")]
    if not valid_evidence:
        raise ValueError("evidence.json must include at least one row with field_name and source_url")
    if str(result.get("sanctioned")).lower() in ("true", "1", "yes"):
        missing = [key for key in ("sanction_source", "sanction_program", "sanction_checked_at", "evidence_url") if not result.get(key)]
        if missing:
            raise ValueError(f"sanctioned=true requires: {', '.join(missing)}")


def unique_urls(text: str) -> list[str]:
    urls = re.findall(r"https?://[^\s>\]\"'<]+", text or "")
    cleaned = []
    for url in urls:
        clean = url.rstrip(".,;:!?" + chr(0x3002) + chr(0xff0c) + chr(0xff1b) + chr(0xff1a) + chr(0xff01) + chr(0xff1f) + chr(0x3001))
        while clean.endswith(")") and clean.count(")") > clean.count("("):
            clean = clean[:-1]
        if clean and clean not in cleaned:
            cleaned.append(clean)
    return cleaned


def strip_json_summary(markdown: str) -> str:
    cleaned = re.sub(r"```(?:json|JSON)\s*[\s\S]*?\s*```", "", markdown or "", count=1)
    cleaned = re.sub(
        r"(?ims)^\+?\s*#{1,6}\s*客户数据摘要\s*$[\s\S]*?(?=^\+?\s*#{1,6}\s+|\Z)",
        "",
        cleaned,
    )
    return cleaned.strip()


def first_report_paragraph(markdown: str) -> str:
    for line in strip_json_summary(markdown).splitlines():
        clean = clean_report_line(line).strip("-*# " + chr(0x2502) + chr(0x250a))
        if not clean or clean.startswith("http") or len(clean) < 15:
            continue
        if clean.startswith("@@") or clean.startswith("a/") or clean.startswith("b/"):
            continue
        if chr(0x2192) in clean and ".md" in clean:
            continue
        return clean[:500]
    return ""


def extract_section_summary(markdown: str, section_name: str) -> str:
    lines = markdown.splitlines()
    capture = False
    collected = []
    for line in lines:
        clean = line.strip()
        if clean.startswith("#") and section_name in clean:
            capture = True
            continue
        if capture and clean.startswith("#"):
            break
        if capture and clean:
            collected.append(clean_report_line(clean).strip("-* "))
    return ";".join(collected)[:500]


def clean_report_line(line: str) -> str:
    """Normalize occasional diff-style report output before regex extraction."""
    clean = str(line or "").strip()
    if clean.startswith("+") and not clean.startswith("++"):
        clean = clean[1:].strip()
    return clean


def first_match(patterns: list[str], text: str, flags: int = re.IGNORECASE | re.MULTILINE) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, flags)
        if match:
            return match.group(1).strip()
    return ""


def cleanup_value(value: str, limit: int = 220) -> str:
    clean = clean_report_line(value)
    clean = re.sub(r"^[✅⚠️🔴⭐\s|:：-]+", "", clean).strip()
    clean = re.sub(r"\s+", " ", clean)
    if is_placeholder(clean):
        return ""
    return clean[:limit]


PLACEHOLDER_VALUES = {
    "", "-", "—", "n/a", "na", "none", "null", "unknown",
    "未找到", "未获取", "未知", "未查到", "未提供", "待确认", "未验证",
    "не указан", "не указано", "нет данных", "не найдено",
}


def is_placeholder(value: Any) -> bool:
    text = str(value or "").strip().strip('"').strip("'")
    return text.lower() in PLACEHOLDER_VALUES


def clean_data_value(value: Any, limit: int = 500) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = "; ".join(str(item).strip() for item in value if not is_placeholder(item))
    elif isinstance(value, dict):
        value = json.dumps(value, ensure_ascii=False)
    clean = clean_report_line(str(value)).strip().strip('"').strip("'")
    clean = re.sub(r"\s+", " ", clean)
    if is_placeholder(clean):
        return ""
    return clean[:limit]


def score_to_rating(score: str) -> str:
    try:
        numeric = float(score)
    except (TypeError, ValueError):
        return ""
    if numeric >= 90:
        return "⭐⭐⭐⭐⭐"
    if numeric >= 75:
        return "⭐⭐⭐⭐"
    if numeric >= 60:
        return "⭐⭐⭐"
    if numeric >= 40:
        return "⭐⭐"
    return "⭐"


def score_to_pool(score: str) -> str:
    try:
        numeric = float(score)
    except (TypeError, ValueError):
        return ""
    if numeric >= 90:
        return "S"
    if numeric >= 75:
        return "A"
    if numeric >= 60:
        return "B"
    if numeric >= 40:
        return "C"
    return "D"


def infer_domain(website: str) -> str:
    if not website:
        return ""
    clean = website.strip().lower()
    clean = re.sub(r"^https?://(www\.)?", "", clean)
    clean = clean.split("/")[0]
    return clean[:120]


def infer_company_names(text: str) -> tuple[str, str]:
    russian = first_match([
        r"\*\*(ООО\s+«[^»]+»)\*\*",
        r"\|\s*\*\*公司\*\*\s*\|\s*(ООО\s+«[^»]+»)",
        r"(ООО\s+\"[^\"]+\")",
        r"\((ООО\s+\"[^\"]+\")\)",
    ], text)
    russian = cleanup_value(russian, 120)
    english = ""
    if "Новые технологии энергомашиностроения" in text:
        english = "New Technologies of Energy Machine Building"
    return russian, english


def infer_customer_type(text: str) -> str:
    raw = first_match([
        r"(?:\*\*)?(?:判定结果|客户类型|类型)(?:\*\*)?\s*[：:]\s*(.+)",
        r"\|\s*\*\*类型\*\*\s*\|\s*(.+?)\s*\|",
    ], text)
    raw = cleanup_value(raw)
    if any(word in raw for word in ("纯IT", "非电子", "软件开发", "培训", "服务公司")):
        return "服务商/非目标"
    if any(word in raw for word in ("贴片", "PCBA", "SMT", "PCB生产", "印刷电路板")):
        return "贴片厂/PCBA"
    if any(word in raw for word in ("混合", "制造商+分销商", "制造与贸易")):
        return "混合型"
    if any(word in raw for word in ("原厂", "半导体制造商", "Chip Fab")):
        return "原厂"
    if any(word in raw for word in ("制造商", "工厂", "生产商")):
        return "终端制造商"
    if any(word in raw for word in ("系统集成", "集成商")):
        return "系统集成商"
    if any(word in raw for word in ("贸易商", "分销", "经销")):
        return "贸易公司"
    if "EMS" in raw.upper() or "方案商" in raw:
        return "EMS/方案商"
    if raw:
        return raw[:80]
    if "终端制造商" in text:
        return "终端制造商"
    return ""


def infer_industry(text: str) -> str:
    okved = first_match([r"OKVED主码\s*[：:]\s*([^→\n]+)", r"ОКВЭД\s*主码\s*[：:]\s*([^|\n]+)"], text)
    text_lower = text.lower()
    if any(word in text for word in ("纯IT", "软件开发", "石油天然气", "军事培训")) or any(word in text_lower for word in ("oil & gas", "нефтегаз")):
        return "非目标/其他"
    if any(word in text for word in ("航空航天", "国防电子", "航空电子")) or any(word in text_lower for word in ("aerospace", "defense", "оборон", "воен")):
        return "航空电子"
    if any(word in text for word in ("半导体", "微电子")) or any(word in text_lower for word in ("semiconductor", "микро", "микросх")):
        return "半导体/微电子"
    if any(word in text for word in ("通信设备", "通信网络", "电信", "微波电子")) or any(word in text_lower for word in ("телеком", "связ")):
        return "通信网络"
    if any(word in text for word in ("医疗电子", "医疗设备")) or "medical" in text_lower:
        return "医疗电子"
    if "汽车电子" in text or "automotive" in text_lower:
        return "汽车电子"
    if "导航" in text or "glonass" in text_lower or "gps" in text_lower:
        return "导航电子"
    if "铁路" in text or "railway" in text_lower:
        return "铁路电子"
    if "pcb" in text_lower or "smt" in text_lower or "电子制造服务" in text:
        return "电子制造服务"
    if any(word in text for word in ("系统集成", "电子系统集成")):
        return "电子系统集成"
    if any(word in text for word in ("电力电子", "силовая электроника")):
        return "电力电子"
    if "能源" in text or "发电机" in text or "электростанц" in text_lower:
        return "电力能源"
    if any(word in text_lower for word in ("plc", "controller")) or "工业控制" in text:
        return "工业控制"
    if "28.12" in okved or "液压" in text or "пневмат" in text_lower:
        return "工业自动化"
    if "工业泵" in text or "磁力泵" in text:
        return "工业自动化"
    if any(word in text_lower for word in ("scada", "automation", "автоматиза")):
        return "工业自动化"
    return "电子设备制造" if cleanup_value(okved, 80) else ""


def infer_city(text: str) -> str:
    raw = first_match([
        r"\*\*城市\*\*\s*\|\s*(.+?)\s*\|",
        r"\*\*城市\*\*\s*[：:]\s*(.+)",
        r"地址\s*\(法定\)\s*[：:]\s*([^,\n]+)",
    ], text)
    raw = cleanup_value(raw, 120)
    cities = []
    city_map = {
        "Москва": "莫斯科",
        "Москв": "莫斯科",
        "Пенза": "Пенза",
        "Пензен": "Пенза",
        "Кондрово": "Кондрово",
        "Калуж": "Калужская область",
        "Санкт-Петербург": "圣彼得堡",
    }
    for key, value in city_map.items():
        if key.lower() in text.lower() and value not in cities:
            cities.append(value)
    if raw and not cities:
        return raw
    return " / ".join(cities[:3])


def infer_description(markdown: str) -> str:
    lines = [clean_report_line(line) for line in markdown.splitlines()]
    for idx, line in enumerate(lines):
        if "一句话结论" in line:
            for candidate in lines[idx + 1:idx + 5]:
                clean = cleanup_value(candidate.strip("-* "), 120)
                if clean and not clean.startswith("---"):
                    return clean
    return first_report_paragraph(markdown)[:120]


def infer_products(text: str) -> str:
    raw = first_match([
        r"推荐产品\s*[：:]\s*(.+)",
        r"电子元器件采购以(.+?)为主",
        r"电子产品为其控制系统的辅助组件",
    ], text)
    if raw == "电子产品为其控制系统的辅助组件":
        return "变频器/VFD、PLC、传感器、工业仪表、电机控制相关元件"
    raw = cleanup_value(raw, 160)
    if raw:
        return raw
    found = []
    keyword_map = [
        ("MCU", "MCU"),
        ("电源管理", "电源管理IC"),
        ("RS-485", "RS-485收发器"),
        ("WiFi", "WiFi模块"),
        ("MOSFET", "MOSFET"),
        ("TRIAC", "TRIAC"),
        ("Modbus", "Modbus接口相关元件"),
        ("VFD", "变频器/VFD"),
        ("PLC", "PLC"),
        ("传感器", "传感器"),
        ("仪表", "工业仪表"),
        ("电机控制", "电机控制相关元件"),
    ]
    for key, label in keyword_map:
        if key.lower() in text.lower() and label not in found:
            found.append(label)
    return "、".join(found[:8])


def infer_phone(text: str) -> str:
    for line in text.splitlines():
        if not re.search(r"телефон|тел\.|phone|контакт|电话|联系电话", line, re.IGNORECASE):
            continue
        match = re.search(r"(\+7[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}|8[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})", line)
        if match:
            return cleanup_value(match.group(1), 40)
    return ""


def infer_contact_summary(text: str) -> str:
    lines = []
    for line in text.splitlines():
        clean = cleanup_value(line.strip("-* "), 180)
        if not clean:
            continue
        if clean.startswith("@@") or "|" in clean or "抓Контакты" in clean or "Yandex" in clean:
            continue
        if "@" in clean or re.search(r"\+7|8\s?800|电话|CEO|销售负责人|директор", clean, re.IGNORECASE):
            lines.append(clean)
    return "; ".join(lines[:6])


def extract_json_summary(markdown: str) -> dict[str, Any]:
    """Parse the first fenced JSON summary returned by the agent."""
    for match in re.finditer(r"```(?:json|JSON)\s*([\s\S]*?)\s*```", markdown or "", re.DOTALL):
        body = (match.group(1) or "").strip()
        if not body.startswith("{"):
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return {}


VALID_EXECUTION_STATUSES = {
    "ok",
    "no_result",
    "blocked",
    "failed",
    "skipped_input_missing",
    "skipped_capability_missing",
}
VALID_EVIDENCE_TYPES = {
    "identity",
    "product",
    "contact",
    "procurement",
    "sanction",
    "hiring",
    "social",
    "registry",
    "inference",
    "preflight",
    "report_source",
}
EXECUTION_EVIDENCE_FIELD_MAP = {
    "identity": "identity",
    "product": "products",
    "contact": "contacts",
    "procurement": "procurement",
    "sanction": "sanctions",
    "hiring": "contacts",
    "social": "contacts",
    "registry": "identity",
    "inference": "report_source",
    "preflight": "report_source",
    "report_source": "report_source",
}
POSITIVE_EXECUTION_STATUSES = {"ok", "no_result"}
EXECUTION_LOG_VERSION = "recon-execution-log-v1"


def coerce_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        clean = clean_data_value(value, 1000)
        return [clean] if clean else []
    if isinstance(value, (list, tuple)):
        values = []
        for item in value:
            clean = clean_data_value(item, 500)
            if clean:
                values.append(clean)
        return values
    clean = clean_data_value(value, 500)
    return [clean] if clean else []


def normalize_execution_record(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    step = clean_data_value(raw.get("step"), 80)
    action = clean_data_value(raw.get("action"), 180)
    status = clean_data_value(raw.get("status"), 80).lower()
    if status not in VALID_EXECUTION_STATUSES:
        status = "failed" if status else ""
    if not step or not action or not status:
        return None
    evidence_type = clean_data_value(raw.get("evidence_type"), 80).lower()
    if evidence_type not in VALID_EVIDENCE_TYPES:
        evidence_type = "report_source"
    confidence = clean_data_value(raw.get("confidence"), 40).lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium" if status in POSITIVE_EXECUTION_STATUSES else "low"
    record = {
        "step": step,
        "action": action,
        "tool": clean_data_value(raw.get("tool"), 160),
        "query_or_url": clean_data_value(raw.get("query_or_url"), 1000),
        "source_url": clean_data_value(raw.get("source_url"), 1000),
        "status": status,
        "found": coerce_string_list(raw.get("found")),
        "evidence_type": evidence_type,
        "confidence": confidence,
        "failure_reason": clean_data_value(raw.get("failure_reason"), 500),
        "saved_body": clean_data_value(raw.get("saved_body"), 1000),
        "route_group": clean_data_value(raw.get("route_group"), 80),
        "route_node": clean_data_value(raw.get("route_node"), 160),
        "route_warning": clean_data_value(raw.get("route_warning"), 220),
        "notes": clean_data_value(raw.get("notes"), 500),
    }
    if not record["source_url"] and re.match(r"^https?://", record["query_or_url"], re.I):
        record["source_url"] = record["query_or_url"]
    return {key: value for key, value in record.items() if value or key in {"status", "found"}}


def normalize_execution_log(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        raw_records = value.get("records") if isinstance(value.get("records"), list) else value.get("execution_log")
        if raw_records is None and all(k in value for k in ("step", "action", "status")):
            raw_records = [value]
    elif isinstance(value, list):
        raw_records = value
    else:
        raw_records = []
    records = []
    for item in raw_records or []:
        record = normalize_execution_record(item)
        if record:
            records.append(record)
    return {"version": EXECUTION_LOG_VERSION, "records": records}


def extract_execution_log(markdown: str) -> dict[str, Any]:
    summary = extract_json_summary(markdown)
    for key in ("execution_log", "executionLog"):
        if key in summary:
            log = normalize_execution_log(summary.get(key))
            if log["records"]:
                return log
    patterns = [
        r"```(?:execution_log|execution-log|json)\s*(\[\s*\{.*?\}\s*\])\s*```",
        r"```(?:execution_log|execution-log)\s*(\{.*?\})\s*```",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, markdown or "", re.DOTALL | re.IGNORECASE):
            try:
                parsed = json.loads(match.group(1))
            except json.JSONDecodeError:
                continue
            log = normalize_execution_log(parsed)
            if log["records"]:
                return log
    return {"version": EXECUTION_LOG_VERSION, "records": []}


def execution_records(log: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(log, dict):
        return []
    records = log.get("records")
    return records if isinstance(records, list) else []


def cyrillic_ratio(text: Any) -> float:
    clean = str(text or "")
    if not clean:
        return 0.0
    letters = [char for char in clean if char.isalpha()]
    if not letters:
        return 0.0
    cyrillic = sum(1 for char in letters if "\u0400" <= char <= "\u04ff")
    return cyrillic / max(1, len(letters))


def has_chinese(text: Any) -> bool:
    return bool(re.search(r"[一-鿿]", str(text or "")))


def is_cyrillic_heavy_value(value: Any, ratio: float = 0.35) -> bool:
    clean = clean_data_value(value)
    return bool(clean and cyrillic_ratio(clean) >= ratio and not has_chinese(clean))


def language_quality_issues(result: dict[str, Any], report_markdown: str) -> list[str]:
    issues: list[str] = []
    chinese_fields = [
        "industry",
        "products",
        "description",
        "contacts_summary",
        "contact_title",
        "outreach_angle",
        "next_action",
        "notes",
        "opportunity_summary",
        "recommended_products",
    ]
    for field in chinese_fields:
        if is_cyrillic_heavy_value(result.get(field)):
            issues.append(f"{field}_russian_heavy")
        elif field == "contact_title" and re.match(r"^\s*[\u0400-\u04ff]", str(result.get(field) or "")):
            issues.append("contact_title_russian_first")
    return issues


def translate_known_russian_value(field: str, value: Any) -> str:
    text = clean_data_value(value)
    if not text:
        return ""
    lower = text.lower()
    original = text[:180]
    if field == "industry":
        if "станк" in lower or "металлообрабатыва" in lower:
            return f"重型机床制造（原文：{original}）"
        if "нефт" in lower or "газ" in lower:
            return f"石油天然气行业（原文：{original}）"
        if "электротех" in lower or "стабилизатор" in lower:
            return f"电气设备制造（原文：{original}）"
        if "производство" in lower:
            return f"制造业（原文：{original}）"
    if field == "contact_title":
        title_map = [
            ("директор по мто", "物资技术供应总监"),
            ("генеральный директор", "总经理"),
            ("единственный учредитель", "唯一创始人"),
            ("коммерческий директор", "商务总监"),
            ("отдел логистики", "物流与海关部"),
            ("снабжение", "采购/供应部门"),
        ]
        hits = [label for key, label in title_map if key in lower]
        if hits:
            return f"{' / '.join(dict.fromkeys(hits))}（原文：{original}）"
    if field == "products":
        if "силовые полупровод" in lower or "симист" in lower or "тирист" in lower:
            return f"功率半导体、可控硅/晶闸管、MCU/控制器、继电器、显示屏、防护器件、电源模块（原文：{original}）"
        if "станк" in lower or "чпу" in lower:
            return f"CNC控制系统、伺服驱动、PLC、变频器、编码器、电气元件（原文：{original}）"
    return f"该字段包含俄文原文，需人工复核；原文摘录：{original}"


def append_quality_note(result: dict[str, Any], note: str) -> None:
    for key in ("notes", "missing_steps"):
        current = clean_data_value(result.get(key), 1000)
        if note in current:
            continue
        result[key] = f"{current}; {note}" if current else note


def apply_light_language_fallback(result: dict[str, Any], issues: list[str]) -> dict[str, Any]:
    if not issues:
        return result
    fixed = dict(result)
    for issue in issues:
        if issue == "contact_title_russian_first":
            fixed["contact_title"] = translate_known_russian_value("contact_title", fixed.get("contact_title"))
            continue
        if not issue.endswith("_russian_heavy"):
            continue
        field = issue[:-len("_russian_heavy")]
        if field in fixed:
            fixed[field] = translate_known_russian_value(field, fixed.get(field))
    fixed["quality_status"] = "需复核"
    fixed["priority"] = "review"
    append_quality_note(fixed, "language_quality_review")
    return fixed


def extract_structured_data(markdown: str) -> dict[str, str]:
    """Parse the '客户数据摘要' YAML-like block from the report."""
    data: dict[str, Any] = {}
    json_summary = extract_json_summary(markdown)
    for key, value in json_summary.items():
        if key in {"execution_log", "executionLog"}:
            continue
        if isinstance(value, (dict, list)) and key != "missing_steps":
            continue
        clean = clean_data_value(value)
        if clean or key == "sanctioned":
            data[key] = clean if key != "sanctioned" else value
    normalized = "\n".join(clean_report_line(line) for line in markdown.splitlines())
    # Find structured block
    m = re.search(r'##\s*客户数据摘要\s*\n(.*?)(?=\n##|\Z)', normalized, re.DOTALL)
    if m:
        block = m.group(1)
        for line in block.split('\n'):
            line = line.strip().strip('-* ')
            if ':' not in line:
                continue
            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            clean = clean_data_value(value)
            if key and clean and not data.get(key):
                data[key] = clean
    
    # Fallback: extract score from report header if not in structured block
    if not data.get("score"):
        m_score = re.search(r'评分[：:]\s*(\d+(?:\.\d+)?)', markdown)
        if not m_score:
            m_score = re.search(r'(\d+)/100', markdown)
        if m_score:
            data["score"] = m_score.group(1)
    
    # Fallback: extract customer_type from report
    if not data.get("customer_type"):
        data["customer_type"] = infer_customer_type(normalized)
    if not data.get("russian_name") or not data.get("english_name"):
        russian_name, english_name = infer_company_names(normalized)
        if russian_name and not data.get("russian_name"):
            data["russian_name"] = russian_name
        if english_name and not data.get("english_name"):
            data["english_name"] = english_name

    if not data.get("industry"):
        data["industry"] = infer_industry(normalized)
    if not data.get("city"):
        data["city"] = infer_city(normalized)
    if not data.get("employees"):
        data["employees"] = first_match([r"(?:员工|员工规模)\s*[：:]\s*~?([0-9+\-~]+人?)", r"\|\s*\*\*员工\*\*\s*\|\s*~?(.+?)\s*\|"], normalized)
    if not data.get("inn"):
        data["inn"] = first_match([r"(?:\*\*)?\bINN(?:\*\*)?\s*[：:]\s*(\d{10,12})", r"(?:\*\*)?\bИНН(?:\*\*)?\s*[：:]\s*(\d{10,12})", r"\|\s*\*\*INN\*\*\s*\|\s*(\d{10,12})\s*\|"], normalized)
    if not data.get("email"):
        emails = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", normalized)
        if emails:
            data["email"] = next((e for e in emails if any(k in e.lower() for k in ("omts", "zakup", "purchase", "supply"))), emails[0])
    if not data.get("phone"):
        data["phone"] = infer_phone(normalized)
    if not data.get("contacts_summary"):
        data["contacts_summary"] = infer_contact_summary(normalized)
    if not data.get("products"):
        data["products"] = infer_products(normalized)
    if not data.get("description"):
        data["description"] = infer_description(normalized)
    if not data.get("rating") and data.get("score"):
        data["rating"] = score_to_rating(data["score"])
    if not data.get("current_pool") and data.get("score"):
        data["current_pool"] = score_to_pool(data["score"])
    if not data.get("sanctioned"):
        if re.search(r"(?:制裁|\*\*制裁\*\*)\s*[：:|]\s*✅?\s*CLEAR", normalized, re.IGNORECASE):
            data["sanctioned"] = "false"
        elif re.search(r"sanctioned\s*[：:=]\s*true|制裁命中", normalized, re.IGNORECASE):
            data["sanctioned"] = "true"
    if not data.get("risk_status") and data.get("sanctioned") == "false":
        data["risk_status"] = "CLEAR｜未发现制裁命中"
    if not data.get("website_verification") and "官网活跃" in normalized:
        data["website_verification"] = "可访问｜Recon报告确认官网活跃"
    
    # New fields: outreach_angle / contact_name / contact_title / notes
    if not data.get("outreach_angle"):
        m_angle = re.search(r"(?:外联切入角度|outreach_angle|话术)[：:]\s*(.+)", normalized)
        if m_angle:
            data["outreach_angle"] = cleanup_value(m_angle.group(1), 200)
        else:
            # Step 9 fallback — extract sentence containing 切入/开场/话术
            m_fallback = re.search(r"(?:切入角度[：:]|外联建议[：:]|俄语开场句[：:]).{1,200}", normalized)
            if m_fallback:
                data["outreach_angle"] = cleanup_value(m_fallback.group(0), 200)
    if not data.get("contact_name"):
        m_name = re.search(r"contact_name[：:][ \t]*([^\n\r]+)", normalized)
        if not m_name:
            # Try structured contact table
            m_name = re.search(r"\|[^|]*?\|\s*([А-Яа-яЁёA-Za-z\-]+\s+[А-Яа-яЁёA-Za-z\-]+)\s*\|.*?(?:采购|менеджер|директор|начальник|снабженец|负责人)", normalized)
        if m_name:
            candidate = cleanup_value(m_name.group(1), 80)
            if not re.match(r"^[a-z_]+[：:]\s*$", candidate, re.I):
                data["contact_name"] = candidate
    if not data.get("contact_title"):
        m_title = re.search(r"contact_title[：:][ \t]*([^\n\r]+)", normalized)
        if m_title:
            candidate = cleanup_value(m_title.group(1), 80)
            if not re.match(r"^[a-z_]+[：:]\s*$", candidate, re.I):
                data["contact_title"] = candidate
    if not data.get("notes"):
        m_notes = re.search(r"notes[：:]\s*(.+)", normalized)
        if m_notes:
            data["notes"] = cleanup_value(m_notes.group(1), 300)
    
    return {key: value for key, value in data.items() if value or key == "sanctioned"}


def normalize_sanction_status(data: dict[str, Any], text: str) -> str:
    explicit = clean_data_value(data.get("sanction_status", "")).upper()
    if explicit in {"CLEAR", "PARTIAL_CLEAR", "UNKNOWN", "HIT"}:
        return explicit

    lowered = (text or "").lower()
    if re.search(r"sanctioned\s*[:=]\s*true|制裁命中|直接制裁|🔴\s*(hit|sanctioned)", text or "", re.I):
        return "HIT"

    incomplete = any(marker in text for marker in (
        "EU Sanctions | ⚠️", "UK Sanctions | ⚠️", "EU/UK", "未检查", "未完成",
        "技术故障", "重定向错误", "无法确认", "UNKNOWN",
    ))
    has_clear_claim = "clear" in lowered or "未发现制裁" in text or "无记录" in text
    if incomplete and has_clear_claim:
        return "PARTIAL_CLEAR"
    if incomplete:
        return "UNKNOWN"
    if has_clear_claim:
        return "CLEAR"
    return "UNKNOWN"


def detect_step_status_from_execution_log(execution_log: dict[str, Any] | None) -> dict[str, str] | None:
    records = execution_records(execution_log)
    if not records:
        return None
    step5_records = [
        row for row in records
        if re.search(r"^step\s*5$", clean_data_value(row.get("step")), re.I)
        and clean_data_value(row.get("status")) in POSITIVE_EXECUTION_STATUSES
    ]
    step5_plus_records = [
        row for row in records
        if re.search(r"^step\s*5\+", clean_data_value(row.get("step")), re.I)
        and clean_data_value(row.get("status")) in POSITIVE_EXECUTION_STATUSES
    ]
    contact_records = [
        row for row in records
        if clean_data_value(row.get("evidence_type")) in {"contact", "social", "hiring"}
        and clean_data_value(row.get("status")) in POSITIVE_EXECUTION_STATUSES
    ]
    found_text = " ".join(
        " ".join(coerce_string_list(row.get("found"))) + " " + clean_data_value(row.get("notes"))
        for row in contact_records
    )
    has_named_contact = bool(re.search(r"[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+|[A-Z][a-z]+ [A-Z][a-z]+|contact_name\s*[:：]\s*(?!未找到|未知|$).+", found_text))
    has_contact_entry = bool(found_text.strip())
    step5_status = "已执行" if step5_records else "未执行"
    if has_named_contact:
        step5_plus_status = "已执行" if step5_plus_records else "未触发"
    elif step5_status == "已执行" and (has_contact_entry or contact_records):
        step5_plus_status = "已执行" if step5_plus_records else "应启未启"
    else:
        step5_plus_status = "已执行" if step5_plus_records else "应启未启"
    return {"step5_status": step5_status, "step5_plus_status": step5_plus_status}


def detect_step_status(markdown: str, execution_log: dict[str, Any] | None = None) -> dict[str, str]:
    from_log = detect_step_status_from_execution_log(execution_log)
    if from_log:
        return from_log
    text = markdown or ""
    step5_present = bool(re.search(r"Step\s*5|社交与专业痕迹|社交入口|VK|Telegram|2GIS|hh\.ru", text, re.I))
    step5_plus_present = bool(re.search(r"Step\s*5\+|深层侦察|theHarvester|Maigret|holehe|公开文件|专利", text, re.I))
    step5_plus_declared_missing = bool(re.search(r"Step\s*5\+[^。\n|]*?(未启用|未执行|不适用)|深层侦察\s*\|\s*未启用", text, re.I))
    if step5_plus_declared_missing and not re.search(r"theHarvester|Maigret|holehe|公开文件|PDF|专利|fips|elibrary|2GIS评论|招聘署名", text, re.I):
        step5_plus_present = False
    no_person = bool(re.search(r"联系人[^。\n]{0,80}未找到|contact_name\s*[:：]\s*未找到|未找到采购|未找到.*决策人|无联系人", text, re.I))
    step5_status = "已执行" if step5_present else "未执行"
    if no_person:
        step5_plus_status = "已执行" if step5_plus_present else "应启未启"
    else:
        step5_plus_status = "已执行" if step5_plus_present else "未触发"
    return {"step5_status": step5_status, "step5_plus_status": step5_plus_status}


def cap_score(score: str, max_score: int) -> str:
    try:
        numeric = float(score)
    except (TypeError, ValueError):
        return score
    if numeric > max_score:
        return str(max_score)
    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric)


def missing_steps_from_execution_log(execution_log: dict[str, Any] | None) -> list[str]:
    missing = []
    for row in execution_records(execution_log):
        status = clean_data_value(row.get("status"))
        if status in POSITIVE_EXECUTION_STATUSES:
            continue
        step = clean_data_value(row.get("step")) or "Step"
        action = clean_data_value(row.get("action")) or "未命名检查"
        reason = clean_data_value(row.get("failure_reason") or row.get("notes"), 160)
        if status in {"blocked", "failed", "skipped_input_missing", "skipped_capability_missing"}:
            suffix = f"：{reason}" if reason else ""
            missing.append(f"{step} {action} {status}{suffix}")
    return missing


def apply_quality_gates(result: dict[str, Any], markdown: str, execution_log: dict[str, Any] | None = None) -> None:
    text = markdown or ""
    missing_steps: list[str] = []
    detected_step_status = detect_step_status(text, execution_log)
    step_status = {}
    has_execution_records = bool(execution_records(execution_log))
    for key in ("step5_status", "step5_plus_status"):
        explicit = clean_data_value(result.get(key))
        if has_execution_records:
            step_status[key] = detected_step_status[key]
        else:
            step_status[key] = explicit if explicit in {"已执行", "未执行", "未触发", "应启未启"} else detected_step_status[key]
    result.update(step_status)

    sanction_status = normalize_sanction_status(result, text)
    result["sanction_status"] = sanction_status
    result["compliance_status"] = {
        "CLEAR": "clear",
        "PARTIAL_CLEAR": "partial_clear",
        "UNKNOWN": "unknown",
        "HIT": "sanctioned",
    }[sanction_status]
    if sanction_status in {"PARTIAL_CLEAR", "UNKNOWN"}:
        missing_steps.append("Step 3 制裁检查未达到四源完整标准")

    if not clean_data_value(result.get("inn")):
        missing_steps.append("Step 1 INN未获取")
    legal_rep_found = bool(re.search(r"(?:法人|法定代表人|负责人)\s*[:：]\s*(?!未知|未获取|未找到|$).+|генеральный директор\s*[:：]\s*[А-ЯA-Z]", text, re.I))
    if not legal_rep_found:
        missing_steps.append("Step 1 法人/负责人姓名未获取")
    if step_status["step5_status"] != "已执行":
        missing_steps.append("Step 5 未执行")
    if step_status["step5_plus_status"] == "应启未启":
        missing_steps.append("Step 5+ 应启未启")
    missing_steps.extend(missing_steps_from_execution_log(execution_log))

    existing_missing = result.get("missing_steps")
    if isinstance(existing_missing, str) and existing_missing:
        missing_steps.extend([item.strip() for item in re.split(r"[;,，、]", existing_missing) if item.strip()])
    elif isinstance(existing_missing, list):
        missing_steps.extend(clean_data_value(item) for item in existing_missing if clean_data_value(item))
    missing_steps = list(dict.fromkeys(item for item in missing_steps if item))

    cap = 100
    if not clean_data_value(result.get("inn")) or not legal_rep_found:
        cap = min(cap, 49)
    if step_status["step5_status"] != "已执行" or step_status["step5_plus_status"] == "应启未启":
        cap = min(cap, 49)

    if result.get("score"):
        result["score"] = cap_score(str(result["score"]), cap)
        if cap < 50:
            result["rating"] = score_to_rating(result["score"])
            result["current_pool"] = score_to_pool(result["score"])
    elif cap < 50 and clean_data_value(result.get("rating")) in {"⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"}:
        result["rating"] = "⭐⭐"
        result["current_pool"] = "C"

    if step_status["step5_status"] != "已执行" or step_status["step5_plus_status"] == "应启未启":
        result["quality_status"] = "需复核"
        result["priority"] = "review"
    elif missing_steps:
        result["quality_status"] = "部分"
    else:
        result["quality_status"] = "完整"
    result["missing_steps"] = "; ".join(missing_steps)

    if sanction_status == "CLEAR":
        result["risk_status"] = "CLEAR｜未发现制裁命中"
    elif sanction_status == "PARTIAL_CLEAR":
        result["risk_status"] = "PARTIAL_CLEAR｜部分制裁源未完成"
    elif sanction_status == "UNKNOWN":
        result["risk_status"] = "UNKNOWN｜制裁状态无法确认"
    elif sanction_status == "HIT":
        result["risk_status"] = "HIT｜制裁命中，供应链替代机会信号"


def build_evidence_records(markdown: str, urls: list[str]) -> list[dict[str, Any]]:
    text = markdown or ""
    records = []
    for url in urls[:50]:
        idx = text.find(url)
        context = text[max(0, idx - 180): idx + len(url) + 180] if idx >= 0 else url
        lower = (context + " " + url).lower()
        if any(k in lower for k in ("opensanctions", "ofac", "treasury", "europa", "gov.uk", "sanction", "制裁")):
            field = "sanctions"
            confidence = "high"
        elif any(k in lower for k in ("2gis", "contacts", "kontakty", "контакт", "vk.com", "telegram", "whatsapp", "hh.ru", "电话", "邮箱", "联系人")):
            field = "contacts"
            confidence = "medium"
        elif any(k in lower for k in ("zakupki", "clearspending", "procurement", "合同", "采购")):
            field = "procurement"
            confidence = "medium"
        elif any(k in lower for k in ("rusprofile", "list-org", "saby", "egrul", "nalog", "inn", "огрн", "инн")):
            field = "identity"
            confidence = "medium"
        elif any(k in lower for k in ("catalog", "product", "about-company", "бренд", "型号", "元器件", "产品")):
            field = "products"
            confidence = "medium"
        else:
            field = "report_source"
            confidence = "medium"
        records.append({
            "field_name": field,
            "value": url,
            "source_url": url,
            "source_title": context.strip()[:180] or "Recon source",
            "checked_at": iso_now(),
            "confidence": confidence,
            "extractor": "hermes:russia-recon",
        })
    return records


def build_evidence_records_from_execution_log(execution_log: dict[str, Any] | None) -> list[dict[str, Any]]:
    records = []
    for row in execution_records(execution_log):
        source_url = clean_data_value(row.get("source_url") or row.get("query_or_url"), 1000)
        if not re.match(r"^https?://", source_url, re.I):
            continue
        status = clean_data_value(row.get("status"))
        evidence_type = clean_data_value(row.get("evidence_type")) or "report_source"
        field = EXECUTION_EVIDENCE_FIELD_MAP.get(evidence_type, "report_source")
        found_values = coerce_string_list(row.get("found"))
        if status not in POSITIVE_EXECUTION_STATUSES and not found_values:
            # Keep failed/blocked attempts in execution_log.json; do not inflate CRM evidence.
            continue
        value = "; ".join(found_values[:6]) if found_values else status
        title_parts = [
            clean_data_value(row.get("step")),
            clean_data_value(row.get("action")),
            clean_data_value(row.get("tool")),
            clean_data_value(row.get("failure_reason") or row.get("notes"), 120),
        ]
        records.append({
            "field_name": field,
            "value": value or source_url,
            "source_url": source_url,
            "source_title": " | ".join(part for part in title_parts if part)[:180] or "Recon execution source",
            "checked_at": iso_now(),
            "confidence": clean_data_value(row.get("confidence")) or ("medium" if status == "ok" else "low"),
            "extractor": "hermes:russia-recon:execution_log",
        })
    deduped = []
    seen = set()
    for item in records:
        key = (item["field_name"], item["source_url"], item["value"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def build_payload_from_report(job: dict[str, Any], report_markdown: str, report_path: Path, execution_log: dict[str, Any] | None = None):
    urls = unique_urls(report_markdown)
    if not urls:
        raise ValueError("Hermes report did not include any plain source URLs")

    sanction_url = next((u for u in urls if any(k in u.lower() for k in ("sanctions", "ofac", "treasury", "europa.eu", "gov.uk"))), urls[0])

    # Extract all fields from structured block or regex fallback
    data = extract_structured_data(report_markdown)
    sanction_status = normalize_sanction_status(data, report_markdown)
    sanctioned = sanction_status == "HIT" or str(data.get("sanctioned")).lower() in ("true", "1", "yes", "y", "是", "命中")
    summary = data.get("opportunity_summary") or data.get("outreach_angle") or data.get("description") or first_report_paragraph(report_markdown)
    contacts = data.get("contacts_summary") or extract_section_summary(report_markdown, "联系人") or ("未找到" if "未找到" in report_markdown else "")
    cust_type = data.get("customer_type", "")
    score_val = data.get("score", "")
    industry = data.get("industry", "")
    city = data.get("city", "")
    phone = data.get("phone", "")
    email = data.get("email", "")
    inn = data.get("inn", "")
    rating = data.get("rating", "")
    products = data.get("products", "")
    description = data.get("description", "")
    employees = data.get("employees", "")

    result = {
        "company_name": job.get("company_name") or "",
        "website": job.get("website") or job.get("domain") or "",
        "domain": infer_domain(job.get("website") or ""),
        "country": "俄罗斯",
        "russian_name": data.get("russian_name", ""),
        "english_name": data.get("english_name", ""),
        "customer_type": cust_type,
        "industry": industry,
        "city": city,
        "phone": phone,
        "email": email,
        "inn": inn,
        "rating": rating,
        "score": score_val,
        "employees": employees,
        "description": description,
        "current_pool": data.get("current_pool", ""),
        "risk_status": data.get("risk_status", ""),
        "website_verification": data.get("website_verification", ""),
        "verified": "1" if data.get("website_verification") else "",
        "contact_count": "1" if clean_data_value(data.get("contact_name")) else "",
        "contact_name": data.get("contact_name", ""),
        "contact_title": data.get("contact_title", ""),
        "contact_classification": data.get("contact_classification", ""),
        "notes": data.get("notes", ""),
        "priority": "review",
        "quality_status": data.get("quality_status", ""),
        "missing_steps": data.get("missing_steps", ""),
        "step5_status": data.get("step5_status", ""),
        "step5_plus_status": data.get("step5_plus_status", ""),
        "sanction_status": sanction_status,
        "compliance_status": "sanctioned" if sanctioned else ("clear" if sanction_status == "CLEAR" else sanction_status.lower()),
        "sanctioned": sanctioned,
        "sanction_source": data.get("sanction_source", ""),
        "sanction_program": data.get("sanction_program", ""),
        "sanction_checked_at": data.get("sanction_checked_at", "") or (iso_now() if sanctioned else ""),
        "evidence_url": sanction_url if sanctioned else urls[0],
        "opportunity_summary": summary,
        "contacts_summary": contacts,
        "recommended_products": products,
        "products": products,
        "outreach_angle": data.get("outreach_angle", ""),
        "next_action": data.get("next_action", "") or ("审核报告后联系" if (phone or email or data.get("contact_name")) else "需补充联系人"),
        "opportunity_do": data.get("opportunity_do", ""),
        "opportunity_need": data.get("opportunity_need", ""),
        "opportunity_sell": data.get("opportunity_sell", ""),
        "opportunity_decision": data.get("opportunity_decision", ""),
        "report_path": str(report_path),
    }
    result = normalize_opportunity_fields(result)
    apply_quality_gates(result, report_markdown, execution_log)

    evidence = build_evidence_records_from_execution_log(execution_log)
    if not evidence:
        evidence = build_evidence_records(report_markdown, urls)
    return result, evidence


def enforce_language_quality(
    args: argparse.Namespace,
    job: dict[str, Any],
    report_markdown: str,
    output_dir: Path,
    report_path: Path,
) -> tuple[str, dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    execution_log = extract_execution_log(report_markdown)
    result, evidence = build_payload_from_report(job, report_markdown, report_path, execution_log)
    issues = language_quality_issues(result, report_markdown)
    if not issues:
        return report_markdown, result, evidence, execution_log
    result = apply_light_language_fallback(result, issues)
    return report_markdown, result, evidence, execution_log


def present_value(value: Any, fallback: str = "未找到") -> str:
    if value is None:
        return fallback
    clean = str(value).strip()
    if not clean or is_placeholder(clean):
        return fallback
    return clean


def first_present(*values: Any, fallback: str = "未找到") -> str:
    for value in values:
        clean = present_value(value, "")
        if clean:
            return clean
    return fallback


def normalize_report_markdown(markdown: str) -> str:
    cleaned: list[str] = []
    for raw in (markdown or "").splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            cleaned.append("")
            continue
        if stripped.startswith(("┊", "╎", "@@ ", "diff --git ", "index ")):
            continue
        if re.match(r"^(a|b)/.*\s→\s.*$", stripped):
            continue
        if stripped.startswith(("+++", "---")) and ".md" in stripped:
            continue
        cleaned.append(clean_report_line(line))
    return "\n".join(cleaned).strip()


def normalize_sanction_opportunity_language(text: Any) -> str:
    clean = str(text or "")
    replacements = [
        ("合规风险，谨慎评估", "制裁驱动机会，确认合规路径"),
        ("合规风险", "合规路径"),
        ("风险评估", "制裁与机会信号"),
        ("风险提示", "机会/合规提示"),
        ("制裁风险", "制裁机会信号"),
        ("二级制裁风险", "二级制裁提示"),
        ("不建议直接接触该实体", "建议先确认合规路径与替代采购切入点"),
        ("不建议直接接触", "建议先确认合规路径"),
        ("不开发该实体本身但可关注其供应链替代需求", "可关注其供应链替代需求"),
        ("制裁HIT必须合规评估后谨慎接触", "制裁HIT提示供应链替代窗口，先确认合规路径后试探接触"),
        ("直接交易需合规评估", "可围绕替代采购需求确认合规路径"),
        ("直接交易需经专业合规审查", "可先确认合规路径与替代采购需求"),
        ("secondary sanctions risk", "secondary sanctions note"),
        ("Secondary sanctions risk", "Secondary sanctions note"),
        ("风险)", "信号)"),
        ("财务状态低，有风险", "财务状态低，需确认付款能力"),
        ("财务稳定性有风险", "财务稳定性需确认"),
        ("华强北可供应", "可提供"),
        ("华强北可提供", "可提供"),
        ("华强北全套", "全套"),
        ("华强北全球品牌元器件", "全球品牌元器件"),
        ("华强北全球供应链", "全球供应链"),
        ("华强北电子元器件供应链", "电子元器件供应链"),
        ("华强北现货渠道", "现货渠道"),
        ("华强北替代渠道", "替代渠道"),
        ("华强北货源", "货源"),
        ("在华强北有", "有"),
        ("华强北", ""),
    ]
    for old, new in replacements:
        clean = clean.replace(old, new)
    return clean


SUPPLY_VOICE_RE = re.compile(r"贵司|贵公司|我们|我方|我司|可提供|可供应|供应能力|供应方案|联系|邮箱|电话|建议|开发信|报价")
PROCESS_NOISE_RE = re.compile(r"now i have|let me compile|compile (?:the )?(?:final|complete) report|已有足够数据|开始编译|开始整理完整报告|现在我将|下面是.*完整侦查报告", re.I)


def clean_opportunity_text(value: Any) -> str:
    clean = normalize_sanction_opportunity_language(value)
    clean = re.sub(r"^(?:贵司|贵公司|该公司|此公司|客户)\s*", "", clean)
    clean = re.sub(r"^(?:可(?:以)?(?:提供|供应|供)|我们(?:能|可以)?(?:提供|供应|卖)|我方(?:可|能)?(?:提供|供应)?)[：:，,\s]*", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip(" ，,；;。")
    if PROCESS_NOISE_RE.search(clean):
        return ""
    return clean


def concise_text(value: Any, limit: int) -> str:
    clean = clean_opportunity_text(value)
    if not clean:
        return ""
    if len(clean) <= limit:
        return clean
    cut = re.split(r"[。；;，,]", clean)[0].strip()
    if cut and len(cut) <= limit + 8:
        return cut[:limit]
    return clean[:limit].rstrip(" ，,；;。")


def demand_text(value: Any) -> str:
    clean = clean_opportunity_text(value)
    if not clean:
        return ""
    clean = re.split(r"可提供|可供应|我们可|我们能|我们有|我方可|我方能|我方有|我司可|供应能力|供应方案|切入点[：:]", clean)[0]
    clean = re.sub(r"^(?:贵司|贵公司|该公司|此公司|客户)\s*", "", clean)
    return concise_text(clean, 70)


def supply_text(value: Any) -> str:
    return concise_text(value, 80)


def action_from_result(result: dict[str, Any]) -> str:
    try:
        score = int(float(str(result.get("score") or 0)))
    except (TypeError, ValueError):
        score = 0
    contact = clean_opportunity_text(result.get("contact_classification") or result.get("contacts_summary"))
    sanctioned = str(result.get("sanctioned")).lower() in ("true", "1", "yes")
    signal = "制裁驱动替代采购" if sanctioned else (result.get("opportunity_need") or result.get("recommended_products") or "需求待确认")
    if score >= 70:
        action = "优先开发"
    elif score >= 50:
        action = "正常开发"
    elif score >= 30:
        action = "试探接触" if contact and contact != "未找到" else "先确认入口"
    else:
        action = "暂不开发"
    return concise_text(f"评分{score}分，{signal}，建议{action}", 40)


def normalize_opportunity_fields(result: dict[str, Any]) -> dict[str, Any]:
    result = dict(result)
    do_text = clean_opportunity_text(result.get("opportunity_do"))
    need = demand_text(result.get("opportunity_need"))
    sell = supply_text(result.get("opportunity_sell"))
    decision = clean_opportunity_text(result.get("opportunity_decision"))

    if not do_text or SUPPLY_VOICE_RE.search(do_text):
        do_text = concise_text(result.get("description") or result.get("industry") or result.get("customer_type"), 32)
    if not need or SUPPLY_VOICE_RE.search(need):
        need = demand_text(result.get("opportunity_summary")) or demand_text(result.get("outreach_angle")) or concise_text(result.get("recommended_products") or result.get("products"), 70)
    if not sell or re.search(r"贵司|贵公司|联系|邮箱|电话|建议", sell):
        sell = supply_text(result.get("recommended_products") or result.get("products"))
    if not decision or len(decision) > 60 or re.search(r"邮箱|电话|抄送|WhatsApp|Telegram|VK|LinkedIn", decision, re.I):
        decision = action_from_result({**result, "opportunity_need": need})

    result["opportunity_do"] = concise_text(do_text, 32)
    result["opportunity_need"] = concise_text(need, 70)
    result["opportunity_sell"] = concise_text(sell, 80)
    result["opportunity_decision"] = concise_text(decision, 50)
    if not result.get("opportunity_summary") or PROCESS_NOISE_RE.search(str(result.get("opportunity_summary") or "")):
        result["opportunity_summary"] = result["opportunity_need"]
    return result


def html_attr(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def linkify_escaped(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        url = match.group(1).rstrip(".,;:!?，。；：！？、")
        suffix = match.group(1)[len(url):]
        safe = html.escape(url, quote=True)
        return f'<a href="{safe}" target="_blank" rel="noopener">{html.escape(url)}</a>{html.escape(suffix)}'
    return re.sub(r"(https?://[^\s<>()]+)", repl, text)


def inline_markdown_to_html(text: str) -> str:
    escaped = html.escape(text or "")
    escaped = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", escaped)
    escaped = escaped.replace("**", "")
    return linkify_escaped(escaped)


def markdown_to_html(markdown: str) -> str:
    lines = normalize_report_markdown(markdown).splitlines()
    output: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    table_rows: list[list[str]] = []
    summary_rows: list[tuple[str, str]] = []
    code_lines: list[str] = []
    in_code = False
    in_customer_summary = False

    def flush_paragraph() -> None:
        if paragraph:
            output.append(f"<p>{inline_markdown_to_html(' '.join(paragraph))}</p>")
            paragraph.clear()

    def flush_list() -> None:
        if list_items:
            output.append("<ul>" + "".join(f"<li>{item}</li>" for item in list_items) + "</ul>")
            list_items.clear()

    def flush_table() -> None:
        if not table_rows:
            return
        rows = []
        body_rows = table_rows
        if len(body_rows) > 1 and all(re.fullmatch(r"[:\-\s]+", cell) for cell in body_rows[1]):
            header = body_rows[0]
            rows.append("<tr>" + "".join(f"<th>{inline_markdown_to_html(cell.strip())}</th>" for cell in header) + "</tr>")
            body_rows = body_rows[2:]
        for row in body_rows:
            rows.append("<tr>" + "".join(f"<td>{inline_markdown_to_html(cell.strip())}</td>" for cell in row) + "</tr>")
        output.append("<table>" + "".join(rows) + "</table>")
        table_rows.clear()

    def flush_summary() -> None:
        if not summary_rows:
            return
        rows = "".join(
            f"<tr><th>{inline_markdown_to_html(key.strip())}</th><td>{inline_markdown_to_html(value.strip())}</td></tr>"
            for key, value in summary_rows
        )
        output.append("<table>" + rows + "</table>")
        summary_rows.clear()

    def flush_code() -> None:
        if code_lines:
            output.append(f"<pre><code>{html.escape(chr(10).join(code_lines))}</code></pre>")
            code_lines.clear()

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_paragraph()
                flush_list()
                flush_table()
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not stripped:
            flush_paragraph()
            flush_list()
            flush_table()
            if not in_customer_summary:
                flush_summary()
            continue
        if stripped.startswith("|") and stripped.endswith("|") and stripped.count("|") >= 2:
            flush_paragraph()
            flush_list()
            table_rows.append([cell.strip() for cell in stripped.strip("|").split("|")])
            continue
        flush_table()
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            flush_list()
            flush_summary()
            level = min(len(heading.group(1)), 4)
            heading_text = heading.group(2)
            output.append(f"<h{level}>{inline_markdown_to_html(heading_text)}</h{level}>")
            in_customer_summary = "客户数据摘要" in heading_text
            continue
        if in_customer_summary and ":" in stripped:
            key, _, value = stripped.partition(":")
            if key.strip() and not key.strip().startswith("http"):
                flush_paragraph()
                flush_list()
                summary_rows.append((key.strip(), value.strip()))
                continue
        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            list_items.append(inline_markdown_to_html(bullet.group(1)))
            continue
        paragraph.append(stripped)

    flush_code()
    flush_paragraph()
    flush_list()
    flush_table()
    flush_summary()
    return "\n".join(output) or "<p>未找到</p>"


def _industry_tag(desc: str, industry: str) -> str:
    """从 description 提取行业标签 (10字内)"""
    if industry and industry not in ('未知', '未找到', ''):
        return industry
    if desc:
        # 取第一个停顿前的关键词
        for sep in ('，', '、', '，', '。', '公司', '企业'):
            idx = desc.find(sep)
            if idx > 0 and idx < 20:
                return desc[:idx].replace('俄罗斯', '').replace('主要', '').strip()
        words = desc.split('，')[0] if '，' in desc else desc[:12]
        return words.replace('俄罗斯', '').strip()
    return '未知'


def _extract_revenue(text: str) -> str:
    """从文本中提取营收信息"""
    if not text:
        return ''
    m = re.search(r'(\d+[\.\d]*)\s*(亿|万|千)?\s*(卢布|元|₽)', text)
    if m:
        val = m.group(1)
        unit = m.group(2) or ''
        ccy = m.group(3) or ''
        # 转中文单位缩写
        unit_map = {'亿': '亿', '万': '万', '千': '千'}
        unit = unit_map.get(unit, unit)
        ccy_map = {'卢布': '₽', '元': '¥', '₽': '₽'}
        ccy = ccy_map.get(ccy, ccy)
        parts = re.findall(rf'{re.escape(m.group(0))}', text)
        if parts:
            return f'{val}{unit}{ccy}'
        return f'{val}{unit}{ccy}'
    return ''


def _short_phrase(value: str, limit: int = 60) -> str:
    clean = clean_data_value(value, limit * 2)
    if not clean:
        return ''
    clean = re.split(r'[。；;\n]', clean, maxsplit=1)[0]
    return clean[:limit]


def _looks_like_sales_offer(value: str) -> bool:
    text = str(value or "")
    return bool(re.search(r"华强北|可供应|我们能|能卖|提供.+替代|国产替代|替代方案", text, re.I))


def _normalize_supply_text(value: str) -> str:
    clean = clean_data_value(value, 120)
    clean = re.sub(r"^(?:华强北)?可(?:以)?(?:提供|供应|供)[：:，,\s]*", "", clean)
    clean = re.sub(r"^我们可(?:以)?(?:提供|供应)[：:，,\s]*", "", clean)
    clean = clean.replace("华强北现货渠道", "现货渠道")
    clean = clean.replace("华强北全球品牌元器件", "全球品牌元器件")
    clean = clean.replace("华强北电子元器件供应链", "电子元器件供应链")
    clean = clean.replace("华强北", "")
    return cleanup_value(clean, 120)


def _extract_supply_phrase(angle: str, products: str) -> str:
    text = clean_data_value(angle, 300)
    for pattern in (
        r"华强北可供应([^，。；;]+)",
        r"华强北可提供([^，。；;]+)",
        r"可供应([^，。；;]+)",
        r"可提供([^，。；;]+)",
        r"提供([^，。；;]+)",
    ):
        match = re.search(pattern, text)
        if match:
            return _normalize_supply_text(match.group(1))
    return _normalize_supply_text(_short_phrase(products, 80))


def _derive_opportunity_chain(result: dict[str, Any], desc: str, products: str, angle: str) -> tuple[str, str, str]:
    customer_type = clean_data_value(result.get("customer_type"))
    industry = clean_data_value(result.get("industry"))
    summary = clean_data_value(result.get("opportunity_summary"))

    do_source = desc or summary
    what_they_do = _short_phrase(do_source, 70)
    if _looks_like_sales_offer(what_they_do) or not what_they_do:
        labels = [item for item in (industry, customer_type) if item]
        what_they_do = " / ".join(labels) if labels else "业务待确认"

    supply_phrase = _extract_supply_phrase(angle, products)
    need_parts = []
    if supply_phrase:
        need_parts.append(f"{supply_phrase}等替代货源")
    if re.search(r"采购经理|采购|供应链|中文能力|中国供应链|替代供应链", angle):
        need_parts.append("采购/供应链线索显示正在寻找中国渠道")
    what_they_need = "；".join(dict.fromkeys(need_parts)) or (_short_phrase(products, 70) or "替代电子元器件")

    if supply_phrase:
        what_we_sell = f"可提供：{supply_phrase}"
    else:
        fallback_supply = _normalize_supply_text(_short_phrase(products, 80) or _short_phrase(angle, 80))
        what_we_sell = f"可提供：{fallback_supply}" if fallback_supply else "可提供：替代电子元器件供应"

    return what_they_do, what_they_need, what_we_sell


def _sanction_signal_summary(result: dict[str, Any], sanction_status: str, sanctioned: bool) -> str:
    if sanction_status == "CLEAR":
        return "CLEAR｜未发现制裁命中"
    source = clean_data_value(result.get("sanction_source"))
    program = clean_data_value(result.get("sanction_program"))
    if source.lower() == "hermes russia-recon report":
        source = ""
    source = re.sub(r"\s*\([^)]*report[^)]*\)\s*", "", source, flags=re.I).strip()
    parts = [part for part in (source, program) if part and part not in {"见报告", "无"}]
    if sanctioned:
        suffix = "供应链替代窗口"
        return "HIT｜" + ("｜".join(parts[:2]) + "｜" if parts else "") + suffix
    if sanction_status in {"PARTIAL_CLEAR", "UNKNOWN"}:
        return f"{sanction_status}｜制裁源待补全"
    return sanction_status or "UNKNOWN"


def _determine_action(score_val: int, sanction_status: str, contact_class: str) -> tuple[str, str, str]:
    """返回 (emoji, 建议, css_class)"""
    if sanction_status == 'HIT':
        return '🔥', '制裁驱动机会', 'sanction'
    if score_val >= 70:
        return '🔥', '优先开发', 'dev'
    if score_val >= 50:
        return '✅', '正常开发', 'dev'
    if score_val >= 30 and contact_class not in ('未找到', ''):
        return '🔍', '试探接触', 'probe'
    if score_val >= 30:
        return '🔍', '先确认入口', 'probe'
    return '⏸️', '暂不开发', 'hold'


def _build_dashboard_html(result: dict[str, Any], score_val: int, sanction_status: str, quality_status: str, sanctioned: bool) -> str:
    """构建方案B决策仪表盘HTML"""
    title = first_present(result.get('russian_name'), result.get('company_name'), fallback='')
    desc = result.get('description') or ''
    industry = result.get('industry') or ''
    city = result.get('city') or ''
    employees = result.get('employees') or ''
    revenue = _extract_revenue(desc) or _extract_revenue(result.get('notes') or '')

    tag = _industry_tag(desc, industry)
    subtitle_parts = [f'<span class="opp-tag">{html.escape(tag)}</span>']
    if city:
        subtitle_parts.append(html.escape(city))
    if employees:
        subtitle_parts.append(f'{html.escape(employees)}人')
    if revenue:
        subtitle_parts.append(revenue)
    subtitle = ' <span class="sep">|</span> '.join(subtitle_parts)

    rating = first_present(result.get('rating'), result.get('score'), fallback='')
    products = result.get('recommended_products') or result.get('products') or ''

    angle = result.get('outreach_angle') or ''
    opp_do = result.get('opportunity_do') or ''
    opp_need = result.get('opportunity_need') or ''
    opp_sell = result.get('opportunity_sell') or ''
    opp_decision = result.get('opportunity_decision') or ''

    if opp_do and opp_need and opp_sell:
        what_they_do = opp_do
        what_they_need = opp_need
        what_we_sell = opp_sell
        if _looks_like_sales_offer(what_they_do):
            what_they_do, what_they_need, what_we_sell = _derive_opportunity_chain(result, desc, products, angle)
    else:
        what_they_do, what_they_need, what_we_sell = _derive_opportunity_chain(result, desc, products, angle)

    product_tags = ''
    for p in re.split(r'[、,，/]', products):
        p = p.strip()
        if len(p) > 1:
            product_tags += f'<span class="db-product-tag">{html.escape(p)}</span>\n          '

    contact_class = result.get('contact_classification') or ''
    contact_badge_css = 'verified' if contact_class == '已验证联系人' else ('entry' if contact_class == '入口联系人' else 'missing')
    email = result.get('email') or ''
    phone = result.get('phone') or ''
    contact_name = result.get('contact_name') or ''
    contact_title = result.get('contact_title') or ''
    contact_summary = result.get('contacts_summary') or ''

    sanction_display = 'HIT｜制裁驱动机会' if sanctioned else (sanction_status or 'UNKNOWN')
    sanction_css = 'hit' if sanctioned else ('unknown' if sanction_status in ('PARTIAL_CLEAR', 'UNKNOWN') else 'clear')
    notes = result.get('notes') or ''
    fin_risk = ''
    if notes:
        fin_m = re.search(r'(营收[↓↑]\d+%[\s·]*净利[↓↑]\d+%)', notes)
        if fin_m:
            fin_risk = fin_m.group(1)

    action_emoji, action_text, action_css = _determine_action(score_val, sanction_status, contact_class)

    chain_steps = ''
    seen_texts = set()
    steps_data = [
        ('1', '他们做什么', what_they_do),
        ('2', '需要什么', what_they_need),
        ('3', '我们能卖什么', what_we_sell or angle),
    ]
    for num, label, text in steps_data:
        if text:
            clean_text = text.strip().lstrip('，,。.;；')
            text_key = clean_text[:40]
            if text_key in seen_texts:
                continue
            seen_texts.add(text_key)
            chain_steps += f'''
          <div class="db-chain-step">
              <div class="db-chain-num">{num}</div>
              <div><strong>{label}</strong><br>{html.escape(clean_text)}</div>
            </div>'''

    contact_items = [
        ('邮箱', email),
        ('电话', phone),
        ('联系人', contact_name),
        ('职位', contact_title),
    ]
    contact_grid = ''.join(
        f'''
          <div class="db-info-item">
            <div class="db-info-key">{html.escape(label)}</div>
            <div class="db-info-val">{html.escape(str(value))}</div>
          </div>'''
        for label, value in contact_items
        if value
    )
    if not contact_grid and contact_summary:
        contact_grid = f'''
          <div class="db-info-item db-info-wide">
            <div class="db-info-key">摘要</div>
            <div class="db-info-val">{html.escape(contact_summary[:140])}</div>
          </div>'''

    sanction_signal = _sanction_signal_summary(result, sanction_status, sanctioned)
    risk_items = [
        ('财务趋势', fin_risk),
        ('制裁信号', sanction_signal),
        ('质检状态', quality_status),
        ('机会备注', notes[:120] if notes and not fin_risk else ''),
    ]
    risk_grid = ''.join(
        f'''
          <div class="db-info-item">
            <div class="db-info-key">{html.escape(label)}</div>
            <div class="db-info-val">{html.escape(str(value))}</div>
          </div>'''
        for label, value in risk_items
        if value
    )

    return f'''
    <div class="db">
      <div class="db-header">
        <div>
          <div class="db-eyebrow">Recon Report</div>
          <div class="db-title">{html.escape(title)}</div>
          <div class="db-subtitle">{subtitle}</div>
        </div>
        <div class="db-score">
          <div class="db-score-num">{score_val if score_val else html.escape(rating)}</div>
          <div class="db-score-sub">{'/100 ' + html.escape(rating) if score_val else ''}</div>
        </div>
      </div>

      <div class="db-body">
        <div class="db-row">
          <div class="db-col db-chain-col">
            <div class="db-col-label">🔗 机会链路</div>
            <div class="db-chain">{chain_steps}</div>
          </div>
          <div class="db-col">
            <div class="db-col-label">📦 推荐产品</div>
            <div class="db-products">{product_tags or '<span class="db-muted">未找到</span>'}</div>
          </div>
        </div>

        <div class="db-row">
          <div class="db-col">
            <div class="db-col-label">📞 可触达性</div>
            <div class="db-contact-line">
              <span class="db-contact-badge {contact_badge_css}">{html.escape(contact_class or '未找到')}</span>
            </div>
            <div class="db-info-grid">{contact_grid or '<div class="db-muted">未找到有效入口</div>'}</div>
          </div>
          <div class="db-col">
            <div class="db-col-label">🚩 制裁与机会信号</div>
            <div class="db-risk">
              <span class="db-risk-pill {sanction_css}">⚖️ {html.escape(sanction_display)}</span>
            </div>
            <div class="db-info-grid">{risk_grid or '<div class="db-muted">暂无补充信号</div>'}</div>
          </div>
        </div>

        <div class="db-action action-{action_css}">
          <div class="db-action-icon">{action_emoji}</div>
          <div class="db-action-body">
            <div class="db-action-title">{html.escape(action_text)}</div>
            <div class="db-action-reason">{html.escape(opp_decision or (f'评分{score_val}分，制裁驱动替代采购，{contact_class or "无入口"}' if sanctioned else f'评分{score_val}分，{sanction_display}，{contact_class or "无入口"}'))}</div>
          </div>
          <div class="db-action-links">
            {f'<a class="btn secondary" href="mailto:{html.escape(email, quote=True)}">📧 发邮件</a>' if email else ''}
            <a class="btn" href="#evidence-links">📄 看证据</a>
          </div>
        </div>
      </div>
    </div>
    '''


def render_html_report(job: dict[str, Any], result: dict[str, Any], evidence: list[dict[str, Any]], report_markdown: str, report_path: Path | None = None) -> str:
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    result = dict(result)
    for key in ("risk_status", "opportunity_summary", "contacts_summary", "recommended_products", "outreach_angle", "next_action", "notes", "description", "opportunity_do", "opportunity_need", "opportunity_sell", "opportunity_decision"):
        if result.get(key):
            result[key] = normalize_sanction_opportunity_language(result[key])
    result = normalize_opportunity_fields(result)
    report_markdown = normalize_sanction_opportunity_language(report_markdown)
    title = first_present(result.get("russian_name"), result.get("company_name"), job.get("company_name"), result.get("domain"), fallback="Russia Recon Report")
    website = first_present(result.get("website"), job.get("website"), job.get("domain"), fallback="")
    website_href = website if re.match(r"^https?://", website, re.I) else (f"https://{website}" if website else "")
    sanctioned = str(result.get("sanctioned")).lower() in ("true", "1", "yes")
    sanction_status = first_present(result.get("sanction_status"), result.get("compliance_status"), fallback="UNKNOWN")
    sanction_text = "HIT｜制裁驱动机会" if sanctioned else first_present(result.get("risk_status"), sanction_status, fallback="UNKNOWN")
    score_val = 0
    try:
        score_val = int(float(str(result.get('score') or 0)))
    except (ValueError, TypeError):
        pass

    quality_status = first_present(result.get('quality_status'), fallback='部分')
    rating = first_present(result.get("rating"), result.get("score"), fallback="未找到")
    evidence_urls = []
    for item in evidence:
        url = str(item.get("source_url") or "").strip()
        if url and url not in evidence_urls:
            evidence_urls.append(url)
    for url in unique_urls(report_markdown):
        if url not in evidence_urls:
            evidence_urls.append(url)

    cards = [
        ("INN", result.get("inn")),
        ("城市", first_present(result.get("city"), result.get("country"), fallback="未找到")),
        ("员工", result.get("employees")),
        ("邮箱", result.get("email")),
        ("电话", result.get("phone")),
        ("联系人", first_present(result.get("contact_name"), result.get("contact_classification"), result.get("contacts_summary"), fallback="未找到")),
        ("质检", quality_status),
        ("Step 5", first_present(result.get("step5_status"), fallback="未找到")),
        ("证据数", str(len(evidence_urls)) if evidence_urls else "未找到"),
    ]

    evidence_links = "\n".join(
        f'<li><a href="{html_attr(url)}" target="_blank" rel="noopener">{html.escape(url)}</a></li>'
        for url in evidence_urls[:30]
    ) or "<li>未找到</li>"

    action_links = []
    if website_href:
        action_links.append(f'<a class="btn" href="{html_attr(website_href)}" target="_blank" rel="noopener">打开官网</a>')
    if evidence_urls:
        action_links.append(f'<a class="btn secondary" href="{html_attr(evidence_urls[0])}" target="_blank" rel="noopener">首要证据</a>')
    action_links.append('<button class="btn ghost" type="button" onclick="window.print()">打印</button>')

    summary_rows = [
        ("客户ID", job.get("customer_id") or result.get("customer_id")),
        ("官网", website),
        ("俄文名称", result.get("russian_name")),
        ("英文名称", result.get("english_name")),
        ("客户类型", result.get("customer_type")),
        ("行业", result.get("industry")),
        ("推荐等级", rating),
        ("制裁/机会信号", sanction_text),
        ("质检状态", quality_status),
        ("缺失步骤", result.get("missing_steps")),
        ("Step 5状态", result.get("step5_status")),
        ("Step 5+状态", result.get("step5_plus_status")),
        ("联系人分类", result.get("contact_classification")),
        ("官网验证", result.get("website_verification")),
        ("他们做什么", result.get("opportunity_do")),
        ("需求信号", result.get("opportunity_need")),
        ("可提供", result.get("opportunity_sell") or result.get("recommended_products") or result.get("products")),
        ("建议动作", result.get("opportunity_decision") or result.get("next_action")),
    ]
    summary_table = "".join(
        f"<tr><th>{html.escape(label)}</th><td>{inline_markdown_to_html(present_value(value))}</td></tr>"
        for label, value in summary_rows
    )

    body_html = markdown_to_html(strip_json_summary(report_markdown))
    report_file = report_path.name if report_path else "report.html"

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)} - Recon Report</title>
  <style>
    :root {{
      color-scheme: light;
      --ink: #172033;
      --muted: #657085;
      --line: #dbe3ee;
      --soft: #f6f8fb;
      --accent: #0f766e;
      --accent-ink: #064e48;
      --warn: #b45309;
      --danger: #b42318;
      --paper: #ffffff;
    }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #eef3f7; color: var(--ink); font: 15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","Microsoft YaHei",sans-serif; }}
    a {{ color: var(--accent); text-decoration: none; word-break: break-word; }}
    a:hover {{ text-decoration: underline; }}
    .shell {{ max-width: 1120px; margin: 0 auto; padding: 28px 18px 56px; }}
    .hero {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 26px; box-shadow: 0 18px 40px rgba(23,32,51,.08); }}
    .eyebrow {{ color: var(--muted); font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }}
    h1 {{ margin: 8px 0 10px; font-size: 30px; line-height: 1.18; letter-spacing: 0; }}
    .meta {{ display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; }}
    .pill {{ display: inline-flex; align-items: center; min-height: 28px; padding: 4px 10px; border-radius: 999px; background: #eaf4f3; color: var(--accent-ink); font-weight: 650; }}
    .pill.warn {{ background: #fff4df; color: var(--warn); }}
    .pill.danger {{ background: #fff0ed; color: var(--danger); }}
    .actions {{ display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }}
    .btn {{ appearance: none; border: 1px solid var(--accent); background: var(--accent); color: white; min-height: 36px; padding: 8px 13px; border-radius: 6px; font-weight: 650; cursor: pointer; }}
    .btn.secondary {{ background: white; color: var(--accent); }}
    .btn.ghost {{ border-color: var(--line); background: white; color: var(--ink); }}
    .grid {{ display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }}
    .card {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-height: 84px; }}
    .label {{ color: var(--muted); font-size: 12px; margin-bottom: 5px; }}
    .value {{ font-weight: 680; overflow-wrap: anywhere; }}
    .main {{ display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }}
    .panel {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 20px; }}
    .panel + .panel {{ margin-top: 18px; }}
    h2 {{ margin: 0 0 12px; font-size: 18px; color: var(--accent-ink); }}
    h3 {{ margin: 22px 0 8px; font-size: 16px; color: #26344d; }}
    h4 {{ margin: 18px 0 6px; font-size: 14px; color: #41506a; }}
    p {{ margin: 9px 0; }}
    ul {{ padding-left: 20px; }}
    li {{ margin: 5px 0; }}
    table {{ width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 13px; }}
    th, td {{ border: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }}
    th {{ background: var(--soft); width: 34%; color: #34435d; }}
    pre {{ white-space: pre-wrap; overflow: auto; background: #101827; color: #edf4ff; padding: 14px; border-radius: 6px; }}
    code {{ background: #eef3f7; padding: 1px 5px; border-radius: 4px; font-size: 13px; }}
    pre code {{ background: transparent; padding: 0; }}
    .report-body h1 {{ font-size: 24px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }}
    .report-body h2 {{ margin-top: 26px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }}
    .muted {{ color: var(--muted); }}
    @media (max-width: 900px) {{
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .main {{ grid-template-columns: 1fr; }}
    }}
    @media (max-width: 560px) {{
      .shell {{ padding: 14px 10px 40px; }}
      .hero, .panel {{ padding: 16px; }}
      h1 {{ font-size: 24px; }}
      .grid {{ grid-template-columns: 1fr; }}
    }}
    @media print {{
      body {{ background: white; }}
      .shell {{ max-width: none; padding: 0; }}
      .hero, .panel, .card {{ box-shadow: none; border-color: #d0d7e2; }}
      .actions {{ display: none; }}
      a {{ color: #111; text-decoration: underline; }}
    }}

    /* 方案B 决策仪表盘 */
    .db {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 18px 40px rgba(23,32,51,.08); overflow: hidden; }}
    .db-header {{ display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding: 20px 24px 14px; border-bottom: 1px solid var(--line); }}
    .db-eyebrow {{ font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }}
    .db-title {{ font-size: 22px; font-weight: 700; line-height: 1.25; margin: 0 0 4px; }}
    .db-subtitle {{ color: var(--muted); font-size: 14px; }}
    .db-subtitle .opp-tag {{ display: inline-block; background: #eaf4f3; color: var(--accent-ink); padding: 1px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }}
    .db-subtitle .sep {{ color: var(--line); margin: 0 6px; }}
    .db-score {{ text-align: right; flex-shrink: 0; min-width: 76px; }}
    .db-score-num {{ font-size: 28px; font-weight: 700; line-height: 1; }}
    .db-score-sub {{ font-size: 13px; color: var(--muted); margin-top: 2px; }}
    .db-body {{ padding: 18px 24px 0; }}
    .db-row {{ display: flex; gap: 24px; padding: 14px 0; }}
    .db-row + .db-row {{ border-top: 1px solid var(--line); }}
    .db-col {{ flex: 1; min-width: 0; }}
    .db-chain-col {{ flex: 1.5; }}
    .db-col-label {{ color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; font-weight: 650; }}
    .db-chain {{ background: var(--soft); border-radius: 8px; padding: 14px 16px; margin-top: 4px; font-size: 14px; line-height: 1.7; }}
    .db-chain-step {{ display: flex; align-items: flex-start; gap: 10px; margin: 4px 0; }}
    .db-chain-num {{ background: var(--accent); color: white; width: 22px; height: 22px; border-radius: 999px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 3px; }}
    .db-products {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }}
    .db-product-tag {{ background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 3px 8px; font-size: 13px; }}
    .db-contact-line {{ display: flex; align-items: center; gap: 8px; margin-top: 6px; }}
    .db-contact-badge {{ padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 650; }}
    .db-contact-badge.verified {{ background: #d1fae5; color: #065f46; }}
    .db-contact-badge.entry {{ background: #fef3c7; color: #92400e; }}
    .db-contact-badge.missing {{ background: #eef3f7; color: var(--muted); }}
    .db-info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }}
    .db-info-item {{ padding: 6px 0; min-width: 0; }}
    .db-info-wide {{ grid-column: 1 / -1; }}
    .db-info-key {{ color: var(--muted); font-size: 12px; }}
    .db-info-val {{ font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }}
    .db-info-val.risk-warn {{ color: var(--danger); }}
    .db-risk {{ display: flex; gap: 12px; flex-wrap: wrap; margin-top: 6px; }}
    .db-risk-pill {{ display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 650; }}
    .db-risk-pill.clear {{ background: #eaf4f3; color: var(--accent-ink); }}
    .db-risk-pill.unknown {{ background: #fef3c7; color: #92400e; }}
    .db-risk-pill.hit {{ background: #dbeafe; color: #1d4ed8; }}
    .db-muted {{ color: var(--muted); font-size: 13px; }}
    .db-action {{ display: flex; align-items: center; gap: 16px; margin: 0 -24px; padding: 14px 24px; border-top: 2px solid var(--accent); background: var(--soft); }}
    .db-action.action-dev {{ border-top-color: #10b981; background: #ecfdf5; }}
    .db-action.action-sanction {{ border-top-color: #2563eb; background: #eff6ff; }}
    .db-action.action-probe {{ border-top-color: #f59e0b; background: #fffbeb; }}
    .db-action.action-hold {{ border-top-color: var(--line); background: var(--soft); }}
    .db-action.action-danger {{ border-top-color: var(--danger); background: #fff0ed; }}
    .db-action-icon {{ font-size: 28px; flex-shrink: 0; }}
    .db-action-body {{ flex: 1; min-width: 0; }}
    .db-action-title {{ font-weight: 700; font-size: 16px; }}
    .db-action-reason {{ font-size: 13px; color: var(--muted); margin-top: 2px; }}
    .db-action-links {{ flex-shrink: 0; display: flex; gap: 8px; }}
    .db-action-links .btn {{ min-height: 32px; padding: 6px 12px; font-size: 13px; text-decoration: none; }}
    @media (max-width: 700px) {{
      .db-header, .db-row, .db-action {{ flex-direction: column; }}
      .db-score {{ text-align: left; }}
      .db-info-grid {{ grid-template-columns: 1fr; }}
      .db-action-links {{ width: 100%; flex-wrap: wrap; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">Russia Recon Report</div>
      <h1>{html.escape(title)}</h1>
      <div class="meta">
        <span class="pill">客户ID {html.escape(present_value(job.get("customer_id")))}</span>
        <span class="pill">评分 {html.escape(rating)}</span>
        <span class="pill">类型 {html.escape(present_value(result.get("customer_type")))}</span>
        <span class="pill {'warn' if sanction_status in {'PARTIAL_CLEAR', 'UNKNOWN'} else ''}">制裁 {html.escape(sanction_text)}</span>
        <span class="pill {'warn' if quality_status != '完整' else ''}">质检 {html.escape(quality_status)}</span>
        <span class="pill">更新 {html.escape(generated_at)}</span>
      </div>
      <div class="meta" style="margin-top:10px;">
        <span>官网：{inline_markdown_to_html(website) if website else "未找到"}</span>
        <span>报告文件：{html.escape(report_file)}</span>
      </div>
      <div class="actions">{"".join(action_links)}</div>
    </section>

    <section class="grid">
      {"".join(f'<div class="card"><div class="label">{html.escape(label)}</div><div class="value">{inline_markdown_to_html(present_value(value))}</div></div>' for label, value in cards)}
    </section>

    <section class="main">
      <div>
        {_build_dashboard_html(result, score_val, sanction_status, quality_status, sanctioned)}

        <section class="panel report-body">
          <h2>完整研究正文</h2>
          {body_html}
        </section>
      </div>
      <aside>
        <section class="panel">
          <h2>关键字段</h2>
          <table>{summary_table}</table>
        </section>
        <section class="panel" id="evidence-links">
          <h2>证据链接</h2>
          <ul>{evidence_links}</ul>
        </section>
      </aside>
    </section>
  </main>
</body>
</html>
"""


def process_job(args: argparse.Namespace, job: dict[str, Any]) -> None:
    job_id = job["job_id"]
    output_dir = (Path(args.output_dir).expanduser().resolve()
                  / f"{now_slug()}-{safe_name(job.get('company_name') or job_id)}-{safe_name(job_id)}")
    output_dir.mkdir(parents=True, exist_ok=True)
    post_json(args.webapp_url, args.token, "markJobRunning", {"job_id": job_id, "output_dir": str(output_dir)})
    try:
        capabilities = probe_execution_capabilities(job, output_dir)
        prompt = build_prompt(job, output_dir, capabilities)
        report_markdown = run_agent(args.hermes_bin, args.hermes_skill, prompt, output_dir, args.timeout).strip()
        if not report_markdown and (output_dir / "report.md").exists():
            report_markdown = (output_dir / "report.md").read_text(encoding="utf-8").strip()
        if not report_markdown:
            raise ValueError("Hermes did not return report markdown")
        html_path = output_dir / "report.html"
        execution_log_path = output_dir / "execution_log.json"
        report_markdown, result, evidence, execution_log = enforce_language_quality(args, job, report_markdown, output_dir, html_path)
        execution_log_path.write_text(json.dumps(execution_log, ensure_ascii=False, indent=2), encoding="utf-8")
        (output_dir / "report.md").write_text(report_markdown, encoding="utf-8")
        validate_payload(result, evidence)
        html_report = render_html_report(job, result, evidence, report_markdown, html_path)
        html_path.write_text(html_report, encoding="utf-8")
        artifacts = {
            "report_html": str(html_path),
            "report_md": str(output_dir / "report.md"),
            "stdout_txt": str(output_dir / "hermes_stdout.txt"),
            "stderr_log": str(output_dir / "hermes_stderr.log"),
            "capabilities_json": str(output_dir / "capabilities.json"),
            "execution_log_json": str(execution_log_path),
        }
        result["artifacts_json"] = json.dumps(artifacts, ensure_ascii=False)
        result["source_file"] = job.get("source", "")
        result["deep_report"] = str(html_path)
        post_json(args.webapp_url, args.token, "submitReconResult", {
            "job_id": job_id, "result": result, "evidence": evidence,
            "report_markdown": report_markdown,
            "report_path": str(html_path),
            "output_dir": str(output_dir),
            "artifacts": artifacts,
        })
        print(f"[done] {job_id} -> {output_dir}", flush=True)
    except Exception as exc:
        post_json(args.webapp_url, args.token, "markJobFailed", {"job_id": job_id, "error": str(exc), "output_dir": str(output_dir)})
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Russia-recon local Hermes worker")
    parser.add_argument("--webapp-url", default=os.environ.get("RECON_WEBAPP_URL", DEFAULT_WEBAPP_URL))
    parser.add_argument("--token", default=os.environ.get("RECON_WORKER_TOKEN", ""))
    parser.add_argument("--poll", type=int, default=int(os.environ.get("RECON_POLL_SECONDS", "10")))
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--output-dir", default=os.environ.get("RECON_OUTPUT_DIR", "recon-runs"))
    parser.add_argument("--hermes-bin", default=os.environ.get("HERMES_BIN", DEFAULT_HERMES_BIN))
    parser.add_argument("--hermes-skill", default=os.environ.get("RECON_HERMES_SKILL", DEFAULT_HERMES_SKILL))
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("RECON_AGENT_TIMEOUT", "1200")))
    parser.add_argument("--limit", type=int, default=1)
    return parser.parse_args()


def main() -> int:
    load_dotenv(Path(".env"))
    args = parse_args()
    if not args.token:
        print("RECON_WORKER_TOKEN is required.", file=sys.stderr)
        return 2
    while True:
        try:
            response = post_json(args.webapp_url, args.token, "listQueuedJobs", {"limit": args.limit})
            jobs = response.get("jobs") or []
            if not jobs:
                if args.once:
                    print("[idle] no queued jobs", flush=True)
                    return 0
                time.sleep(max(3, args.poll))
                continue
            for job in jobs:
                process_job(args, job)
        except KeyboardInterrupt:
            print("\n[stop] interrupted", flush=True)
            return 130
        except Exception as exc:
            print(f"[error] {exc}", file=sys.stderr, flush=True)
            if args.once:
                return 1
            time.sleep(max(5, args.poll))
        if args.once:
            return 0


if __name__ == "__main__":
    raise SystemExit(main())

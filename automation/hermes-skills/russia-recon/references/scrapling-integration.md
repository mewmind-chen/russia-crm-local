# Scrapling Integration Reference

> Added: 2026-05-15 | russia-recon v5.5

## Installation

```bash
pip3 install "scrapling[shell]" git+https://github.com/D4Vinci/Scrapling.git --break-system-packages
# Requires Python 3.10+ → use /opt/homebrew/bin/python3 (3.12.13)
# Then: scrapling install   (Playwright + Chromium deps)
```

**Current**: v0.4.8 (GitHub main, newer than PyPI v0.2.99)

## Three-Tier Fetch Architecture

| Level | Function | Engine | Speed | Use Case |
|-------|----------|--------|-------|----------|
| 1 | `fetch()` | curl_cffi HTTP | ~1s | APIs, static pages, sanctions sources |
| 2 | `stealth_fetch()` | Playwright Chromium | 20-80s | Cloudflare-protected sites |
| 3 | `smart_fetch()` | Auto (1→2) | varies | Default — escalates on block/failure |

## Test Results (2026-05-15)

### Cloudflare Turnstile Bypass
- **Site**: nopecha.com/demo/cloudflare
- **Result**: SUCCESS (22.7s)
- **Method**: `solve_cloudflare=True`
- **Details**: Detected "interactive" turnstile, solved in ~16s, page loaded normally

### Russian Sites 

| Site | Fetcher HTTP | StealthyFetcher | Notes |
|------|-------------|-----------------|-------|
| **rusprofile.ru** | SSRF ERR (proxy redirect) | ✅ OK (80s) | Slow but reliable; use `smart_fetch()` |
| **zachestnyibiznes.ru** | ✅ OK (2s) | N/A | Returns JS shell (34 chars); needs browser |
| **elcp.ru** | SSRF ERR | ❌ Timeout (30s×3) | Hard to reach from this IP |
| **yp.ru** | SSRF ERR | KillBot (title: "User verification...") | KillBot still defeats all engines |

### SSRF Proxy Issue
- **Problem**: Fetcher via proxy triggers `curl: (7) Redirect to internal IP 127.0.0.1 rejected`
- **Cause**: Clash/Mihomo proxy routes some .ru sites to localhost (rule-based DNS)
- **Fix in adapter**: Auto-detects SSRF error → retries without proxy (`proxyless=True`)
- **StealthyFetcher**: Not affected (uses Playwright's own proxy chain)

## KillBot Detection

yp.ru uses KillBot (NOT Cloudflare):
- Title: "User verification..."
- Body: `kbErrors` JS variable, randomized class names
- **Status**: StealthyFetcher detects it but cannot bypass
- **Workaround**: DuckDuckGo Lite — search `[subdomain prefix] компания` to find real site

## Adaptive Selectors

Scrapling's `adaptive=True` + `auto_save=True` survives website redesigns:
```python
# First visit — save selector pattern
elements = page.css('.company-name', auto_save=True)

# Later visits — adapt when DOM changes
elements = page.css('.company-name', adaptive=True)
```

**Warning**: `auto_save` requires `adaptive` enabled at Selector init time. Must set `Selector.adaptive = True` at class level or pass at construction.

## Content Extraction Pitfall

- `str(page)` → returns `<200 https://url>` (status code + URL only — NOT HTML)
- `page._raw_body` → bytes, contains the actual response (decode with UTF-8)
- `page.css('body').get()` → HTML body element
- `page.css('*::text').getall()` → all text nodes (for verbatim text extraction)

**Adapter uses**: `page._raw_body.decode(errors='replace')` with fallback to `page.css('body').get()`

## API Reference

### scrapling_fetcher.py

```python
from scripts.scrapling_fetcher import fetch, stealth_fetch, smart_fetch, adaptive_select

# Fast HTTP (sanctions APIs, static pages)
r = fetch("https://api.opensanctions.org/...", timeout=15)
# → FetchResult(success=True, content="...", title="...", elapsed_ms=NNN)

# Stealth browser (CF-protected sites)
r = stealth_fetch("https://www.rusprofile.ru/...", timeout=30, solve_cloudflare=True)
# → FetchResult(success=True, level="stealth", ...)

# Smart auto-escalate
r = smart_fetch("https://www.rusprofile.ru/search?query=INN")
# → tries fetch() first, escalates to stealth_fetch() on block/failure

# Convenience
r = fetch_sanctions(inn="7704736686")
r = fetch_rusprofile(ogrn="1197847026277")

# Adaptive parsing
result = adaptive_select(html, ".product-card", auto_save=True)
# → {"found": True, "texts": [...], "count": N, "adaptive_used": True}

# Result structure
r.success       # bool
r.content       # raw HTML/text
r.title         # page title
r.elapsed_ms    # timing
r.block_type    # "killbot" | "cloudflare" | "captcha" | "ssrf" | "403" | None
r.error         # error message if failed
```

## Integration Impact on russia-recon

**Before (v5.4)**: network-sentinel → lightpanda → browser_navigate (3-tier escalating)
**After (v5.5)**: scrapling_fetcher → browser_navigate (2-tier with smarter HTTP tier)

**Key differences**:
1. HTTP layer now has TLS impersonation (Chrome 130+ fingerprint)
2. Cloudflare Turnstile bypass at browser level (no external solver needed)
3. SSRF auto-detection with proxyless fallback
4. KillBot/CF detection built into FetchResult.block_type
5. Adaptive selectors for stable parsing across site redesigns

**What stays the same**:
- browser_navigate still used for complex SPA rendering
- lightpanda still available for high-concurrency batch jobs
- DuckDuckGo Lite still the KillBot workaround for yp.ru
- Proxy still 7897 (Clash/Mihomo)

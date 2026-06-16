# Russia Recon Configuration

## Proxy Settings

This skill uses the local Clash/Mihomo proxy for accessing Russian websites.

### Default Proxy
- **HTTP / Lightpanda**: `http://127.0.0.1:7897`
- **SOCKS5 / SMTP tools**: `socks5://127.0.0.1:7897`

### Routing Rules (handled by Clash)
- `.ru` domains → RU node (els)
- `.su`, `.by`, `.kz`, `.uz`, `.kg`, `.tj`, `.tm`, `.az`, `.am`, `.ge` → RU node
- Everything else → US node

### Usage in Scripts
All scripts in this skill must use the local Mihomo mixed proxy on port `7897`.

```bash
# Email verification (automatic proxy)
python3 scripts/verify_email.py info@company.ru

# Company reconnaissance (automatic proxy)
python3 scripts/russia_recon.py --inn 3700022051

# Override proxy if needed
python3 scripts/verify_email.py --proxy socks5://127.0.0.1:7897 email@company.ru
```

## Network Sentinel Fetch Tool

For page acquisition, this skill must prefer the local recon-only helper:

```bash
cd /Users/ylf/Desktop/projects/network-sentinel
python3 -m network_sentinel.cli check --proxy http://127.0.0.1:7897
python3 -m network_sentinel.cli browser-check
python3 -m network_sentinel.cli route-check "<PUBLIC_URL>" --route auto
python3 -m network_sentinel.cli fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text
python3 -m network_sentinel.cli browser-fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text --screenshot
python3 -m network_sentinel.cli stealth-fetch "<PUBLIC_URL>" --proxy http://127.0.0.1:7897 --route auto --text --screenshot
```

Site strategy:

- `api-search / api-sanctions / api-registry / api-hiring` are always the main path when applicable.
- OpenSanctions / OFAC / EU / UK: use `api-sanctions` first, then `scrapling-fetch` / `fetch` for webpage evidence.
- rusprofile / list-org / saby / yp.ru / Yandex / 2GIS / hh.ru / VK: only enter the required execution set when `browser-check` reports `browser_fetch_ok=true`.
- `status=ok`: read `saved_body` and cite the public URL in the report.
- `status=blocked`: record `block_type` plus `route_group/route_node`, update `blocked_sources`, move to alternate sources, and downgrade transparently.
- `status=error`: only then fall back to `lightpanda` / `browser_navigate`.
- Route fields: `.ru`/Russian sources should show `route_group=RU`; sanctions/Google should show `route_group=US`; local URLs should show `DIRECT`.

Execution gating rules:

- If `browser_fetch_ok=false`, browser-only sources are not "未执行"; they are `前提不满足（浏览器层不可用）`, and the agent must use API Broker + official public sources + Scrapling/fetch alternatives.
- If `stealth_fetch_ok=false`, do not promise a stealth retry.
- If there is no unique username, `Maigret` is optional and should not be counted as missing.
- If there is no non-generic personal email, `holehe` is optional and should not be counted as missing.
- If there is no `UN_COMTRADE_API_KEY`, Comtrade is optional and should not be counted as missing.

## Proxy Node Status

| Node | Name | Purpose | Status |
|------|------|---------|--------|
| US-Reality-User1 | US node | General/non-RU sites | Default for most |
| els | RU node | Russian/FSU sites | Auto-selected for .ru |

## Notes

- The proxy client (Clash/Mihomo) must be running before executing any scripts
- Check proxy status: visit http://127.0.0.1:7897 or check Clash dashboard
- If RU node is slow, consider adding more RU-region nodes to the proxy config

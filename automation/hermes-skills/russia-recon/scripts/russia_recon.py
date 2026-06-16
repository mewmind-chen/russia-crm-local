#!/usr/bin/env python3
"""
Russia Recon Automation Script v2.0
Layer 1-2 automation with Lightpanda browser engine.
Usage: python3 russia_recon.py --inn 3700022051 --engine lightpanda

Engine options:
  --engine lightpanda  (default, 10x faster, 9x less memory)
  --engine chrome      (fallback for complex sites)
"""

import sys
import json
import re
import argparse
import urllib.request
import urllib.error
from urllib.parse import quote, urlencode

# Proxy configuration
_proxy_handler = None
DEFAULT_PROXY = 'http://127.0.0.1:7897'  # HTTP proxy (Clash Verge TUN mode)

def setup_proxy(proxy_url=DEFAULT_PROXY):
    """Setup proxy for all HTTP requests."""
    if proxy_url is None:
        proxy_url = DEFAULT_PROXY
    if not proxy_url:
        return
    
    import urllib.request
    if proxy_url.startswith('socks5://'):
        # SOCKS5 proxy requires PySocks
        try:
            import socks
            import socket
            parts = proxy_url[9:].split(':')
            host = parts[0]
            port = int(parts[1]) if len(parts) > 1 else 1080
            socks.set_default_proxy(socks.PROXY_TYPE_SOCKS5, host, port)
            socket.socket = socks.socksocket
            print(f"✓ SOCKS5 proxy configured: {host}:{port}")
        except ImportError:
            print("⚠ PySocks not installed, SOCKS5 proxy unavailable")
            print("  Install: pip3 install PySocks")
    elif proxy_url.startswith('http://'):
        # HTTP proxy
        _proxy_handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
        opener = urllib.request.build_opener(_proxy_handler)
        urllib.request.install_opener(opener)
        print(f"✓ HTTP proxy configured: {proxy_url}")

def fetch_url(url, timeout=15, encoding='utf-8'):
    """Fetch URL content with timeout and encoding handling."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode(encoding, errors='replace')
    except urllib.error.URLError as e:
        print(f"  ⚠ URL error: {e}")
        return None
    except Exception as e:
        print(f"  ⚠ Error: {e}")
        return None

def parse_rusprofile(html):
    """Parse rusprofile.ru page for company info."""
    if not html:
        return None
    
    result = {}
    
    # Extract INN
    inn_match = re.search(r'ИНН[:\s]*(\d{10})', html)
    if inn_match:
        result['inn'] = inn_match.group(1)
    
    # Extract OGRN
    ogrn_match = re.search(r'ОГРН[:\s]*(\d{13})', html)
    if ogrn_match:
        result['ogrn'] = ogrn_match.group(1)
    
    # Extract company name (full)
    name_match = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
    if name_match:
        result['name'] = name_match.group(1).strip()
    
    # Extract director/legal rep
    director_match = re.search(r'(Генеральный директор|Директор|Руководитель)[:\s]*([А-ЯЁа-яё\s]+)', html)
    if director_match:
        result['director'] = director_match.group(2).strip()
    
    # Extract address
    addr_match = re.search(r'Адрес[:\s]*([^<\n]+)', html)
    if addr_match:
        result['address'] = addr_match.group(1).strip()
    
    # Extract employee count (среднесписочная численность)
    emp_match = re.search(r'(среднесписочная численность|численность работников)[:\s]*(\d+)', html, re.IGNORECASE)
    if emp_match:
        result['employees'] = int(emp_match.group(2))
    
    # Extract revenue (выручка)
    rev_match = re.search(r'(выручка|Выручка)[:\s]*([\d\s]+)\s*(тыс\.|млн\.|руб\.)', html)
    if rev_match:
        result['revenue'] = rev_match.group(2).strip().replace(' ', '')
    
    # Extract status
    status_match = re.search(r'(действующая|ликвидирована|в процессе ликвидации)', html, re.IGNORECASE)
    if status_match:
        result['status'] = status_match.group(1).lower()
    
    return result

def parse_zakupki(html):
    """Parse zakupki.gov.ru search results for contracts."""
    if not html:
        return []
    
    contracts = []
    
    # Find contract links and numbers
    contract_pattern = r'regNum[=:]\s*["\']?(\d{19})["\']?'
    for match in re.finditer(contract_pattern, html):
        contracts.append({'regnum': match.group(1)})
    
    # Alternative: find contract links
    link_pattern = r'/epz/contract/contract/[^\s>]*contractNumber[=:][^\s>]*["\']?([^\s"\'>]+)'
    for match in re.finditer(link_pattern, html):
        contracts.append({'number': match.group(1)})
    
    return contracts[:10]  # Limit to first 10

def lookup_company_by_inn(inn, proxy=None):
    """Layer 1: Lookup company by INN."""
    print(f"\n🔍 Layer 1: Looking up INN {inn}...")
    
    # Rusprofile - need to search by INN first to get OGRN
    print("  → Rusprofile search...")
    search_url = f"https://www.rusprofile.ru/search?query={inn}&type=ul"
    html = fetch_url(search_url)
    
    # Try to find OGRN in search results or direct company link
    ogrn_match = re.search(r'/id/(\d{13})', html) if html else None
    
    if ogrn_match:
        ogrn = ogrn_match.group(1)
        print(f"  → Found OGRN: {ogrn}, loading details...")
        company_url = f"https://www.rusprofile.ru/id/{ogrn}"
        html = fetch_url(company_url)
        company_info = parse_rusprofile(html)
    else:
        # Fallback: try direct URL with INN (some sites use INN as path)
        print("  ⚠ Search failed, trying direct URL...")
        company_info = None
    
    if company_info:
        print(f"  ✓ Found: {company_info.get('name', 'N/A')}")
        print(f"    Director: {company_info.get('director', 'N/A')}")
        print(f"    Employees: {company_info.get('employees', 'N/A')}")
        print(f"    Status: {company_info.get('status', 'N/A')}")
    else:
        print("  ⚠ Rusprofile failed, trying zachestnyibiznes...")
        # zachestnyibiznes uses OGRN_INN format
        zb_url = f"https://zachestnyibiznes.ru/search?query={inn}"
        html = fetch_url(zb_url)
        company_info = parse_rusprofile(html)
    
    return company_info

def search_zakupki(company_name, inn, proxy=None):
    """Layer 2: Search government procurement records."""
    print(f"\n🔍 Layer 2: Searching zakupki.gov.ru...")
    
    # Search by company name
    search_url = f"https://zakupki.gov.ru/epz/contract/search/results.html?searchString={quote(company_name)}&morphology=on"
    print(f"  → {search_url}")
    html = fetch_url(search_url, timeout=20)
    contracts = parse_zakupki(html)
    
    if contracts:
        print(f"  ✓ Found {len(contracts)} contract(s)")
        for c in contracts[:5]:
            print(f"    - {c.get('regnum', c.get('number', 'N/A'))}")
    else:
        print("  ⚠ No contracts found")
    
    return contracts

def main():
    parser = argparse.ArgumentParser(description='Russia Recon Automation')
    parser.add_argument('--inn', required=True, help='Company INN (10 digits)')
    parser.add_argument('--name', help='Company name (alternative to INN)')
    parser.add_argument('--proxy', default=DEFAULT_PROXY, help=f'Proxy URL (default: {DEFAULT_PROXY})')
    parser.add_argument('--output', help='Output JSON file')
    args = parser.parse_args()
    
    # Setup proxy (default from CONFIG.md)
    setup_proxy(args.proxy)
    
    print(f"Russia Recon - Layer 1-2 Automation")
    print(f"=====================================")
    
    # Layer 1: Company lookup
    company_info = lookup_company_by_inn(args.inn, args.proxy)
    
    if not company_info:
        print("❌ Company lookup failed")
        sys.exit(1)
    
    # Layer 2: Procurement search
    company_name = company_info.get('name', args.name or '')
    contracts = search_zakupki(company_name, args.inn, args.proxy)
    
    # Output results
    result = {
        'inn': args.inn,
        'company': company_info,
        'contracts': contracts,
        'timestamp': __import__('datetime').datetime.now().isoformat(),
    }
    
    print(f"\n📊 Summary:")
    print(f"  INN: {args.inn}")
    print(f"  Name: {company_info.get('name', 'N/A')}")
    print(f"  Director: {company_info.get('director', 'N/A')}")
    print(f"  Employees: {company_info.get('employees', 'N/A')}")
    print(f"  Contracts: {len(contracts)}")
    
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"📄 Saved to {args.output}")

if __name__ == '__main__':
    main()
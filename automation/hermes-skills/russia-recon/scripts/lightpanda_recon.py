#!/usr/bin/env python3
"""
Russia Recon with Lightpanda Browser Engine
10x faster, 9x less memory than Chrome.

Usage:
  python3 lightpanda_recon.py --inn 3700022051
  python3 lightpanda_recon.py --source elcp --category contracts
"""

import subprocess
import json
import re
import argparse
from pathlib import Path

LIGHTPANDA_BIN = Path.home() / ".local/bin/lightpanda"
PROXY = "http://127.0.0.1:7897"  # Clash Verge HTTP proxy

def fetch_with_lightpanda(url: str, dump_format: str = "markdown", wait_until: str = "networkidle", timeout: int = 30) -> str:
    """Fetch URL using Lightpanda browser engine."""
    cmd = [
        str(LIGHTPANDA_BIN),
        "fetch",
        "--dump", dump_format,
        "--wait-until", wait_until,
        "--http-proxy", PROXY,
        "--http-timeout", str(timeout * 1000),
        url
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 10)
    if result.returncode != 0:
        print(f"⚠ Lightpanda error: {result.stderr}")
        return None
    return result.stdout

def parse_rusprofile_company(html: str) -> dict:
    """Parse rusprofile.ru company page."""
    if not html:
        return None
    
    result = {}
    
    # Extract company name
    name_match = re.search(r'^#\s*([А-ЯЁа-яё"A-Z\s]+)', html, re.MULTILINE)
    if name_match:
        result['name'] = name_match.group(1).strip()
    
    # Extract INN
    inn_match = re.search(r'ИНН[:\s]*(\d{10})', html)
    if inn_match:
        result['inn'] = inn_match.group(1)
    
    # Extract OGRN
    ogrn_match = re.search(r'ОГРН[:\s]*(\d{13})', html)
    if ogrn_match:
        result['ogrn'] = ogrn_match.group(1)
    
    # Extract director
    director_match = re.search(r'(Генеральный директор|Директор)[:\s]*([А-ЯЁа-яё\s]+)', html)
    if director_match:
        result['director'] = director_match.group(2).strip()
    
    # Extract address
    addr_match = re.search(r'Юридический адрес[:\s]*([^\n]+)', html)
    if addr_match:
        result['address'] = addr_match.group(1).strip()
    
    # Extract status
    status_match = re.search(r'(действующая|ликвидирована)', html, re.IGNORECASE)
    if status_match:
        result['status'] = status_match.group(1)
    
    # Extract OKVED (main activity)
    okved_match = re.search(r'Основной вид деятельности[:\s]*([^\(]+)', html)
    if okved_match:
        result['okved'] = okved_match.group(1).strip()
    
    # Extract revenue
    rev_match = re.search(r'Выручка[:\s]*([\d\s]+)\s*(млн|тыс)\s*руб', html)
    if rev_match:
        result['revenue'] = rev_match.group(1).strip() + " " + rev_match.group(2) + " руб"
    
    return result

def parse_elcp_directory(html: str) -> list:
    """Parse elcp.ru directory for company list."""
    if not html:
        return []
    
    companies = []
    
    # Find company names in the table
    # Pattern: | DATE | [Company Name]() | Certification | ...
    pattern = r'\|\s*\d{2}\.\d{2}\.\d{4}\s*\|\s*\[([^\]]+)\]\(\)'
    
    for match in re.finditer(pattern, html):
        name = match.group(1).strip()
        if name and not name.startswith('←') and name != '1':
            companies.append({'name': name, 'source': 'elcp.ru'})
    
    return companies[:20]  # Limit to 20

def lookup_company(inn: str) -> dict:
    """Layer 1: Lookup company by INN."""
    print(f"\n🔍 Layer 1: Looking up INN {inn}...")
    
    url = f"https://www.rusprofile.ru/search?query={inn}&type=ul"
    print(f"  → {url}")
    
    html = fetch_with_lightpanda(url)
    company = parse_rusprofile_company(html)
    
    if company:
        print(f"  ✓ Found: {company.get('name', 'N/A')}")
        print(f"    Director: {company.get('director', 'N/A')}")
        print(f"    Address: {company.get('address', 'N/A')}")
        print(f"    Activity: {company.get('okved', 'N/A')}")
        print(f"    Revenue: {company.get('revenue', 'N/A')}")
    else:
        print("  ⚠ Not found")
    
    return company

def scan_elcp_directory(category: str = "contracts") -> list:
    """Scan elcp.ru directory for contract manufacturers."""
    print(f"\n🔍 Scanning elcp.ru/{category}...")
    
    url = f"http://www.elcp.ru/catalog/anketa/{category}"
    print(f"  → {url}")
    
    html = fetch_with_lightpanda(url)
    companies = parse_elcp_directory(html)
    
    print(f"  ✓ Found {len(companies)} companies:")
    for c in companies[:5]:
        print(f"    - {c['name']}")
    
    return companies

def main():
    parser = argparse.ArgumentParser(description='Russia Recon with Lightpanda')
    parser.add_argument('--inn', help='Company INN to lookup')
    parser.add_argument('--source', choices=['rusprofile', 'elcp'], default='rusprofile', help='Data source')
    parser.add_argument('--category', default='contracts', help='elcp.ru category (contracts/manufacturers/distributors)')
    parser.add_argument('--output', help='Output JSON file')
    args = parser.parse_args()
    
    print("Russia Recon v2.0 — Lightpanda Engine")
    print("=" * 40)
    
    if not LIGHTPANDA_BIN.exists():
        print(f"❌ Lightpanda not found at {LIGHTPANDA_BIN}")
        print("  Install: curl -L -o ~/.local/bin/lightpanda https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos && chmod a+x ~/.local/bin/lightpanda")
        return
    
    if args.inn:
        company = lookup_company(args.inn)
        result = {'inn': args.inn, 'company': company, 'source': 'rusprofile'}
    elif args.source == 'elcp':
        companies = scan_elcp_directory(args.category)
        result = {'companies': companies, 'source': 'elcp.ru', 'category': args.category}
    else:
        print("Usage: --inn <INN> or --source elcp --category contracts")
        return
    
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\n📄 Saved to {args.output}")
    
    print("\n⚡ Lightpanda stats: 10x faster, 9x less RAM than Chrome")

if __name__ == '__main__':
    main()
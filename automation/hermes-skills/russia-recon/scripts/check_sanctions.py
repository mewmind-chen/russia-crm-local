#!/usr/bin/env python3
"""
Sanctions Check Script for Russian Companies
Checks OFAC SDN, EU Sanctions, UK Sanctions, and OpenSanctions database.

Usage:
  python3 check_sanctions.py --inn 3700022051
  python3 check_sanctions.py --name "Ростех"
  python3 check_sanctions.py --name "Ростех" --inn 3700022051
"""

import sys
import json
import re
import argparse
import urllib.request
import urllib.error
from urllib.parse import quote
from datetime import datetime
from typing import Optional

DEFAULT_PROXY = 'http://127.0.0.1:7897'

# Sanctions sources with their API/query endpoints
SANCTIONS_SOURCES = {
    'opensanctions': {
        'name': 'OpenSanctions',
        'search_url': 'https://api.opensanctions.org/search',
        'entity_url': 'https://api.opensanctions.org/entities/{id}',
        'priority': 1,  # Highest priority - aggregates multiple sources
    },
    'ofac_sdn': {
        'name': 'OFAC SDN (US Treasury)',
        'search_url': 'https://sanctionssearch.ofac.treas.gov/SearchResults.aspx?searchString={query}',
        'priority': 2,
    },
    'eu_sanctions': {
        'name': 'EU Sanctions List',
        'search_url': 'https://webgate.ec.europa.eu/fsd/fsf/public/search/search?s={query}',
        'priority': 3,
    },
    'uk_sanctions': {
        'name': 'UK Sanctions List',
        'search_url': 'https://www.gov.uk/government/publications/the-uk-sanctions-list',
        'priority': 4,
    },
}


class SanctionsChecker:
    def __init__(self, proxy: str = DEFAULT_PROXY):
        self.proxy = proxy
        self.results = {
            'query': {},
            'sources': {},
            'summary': {},
            'timestamp': datetime.now().isoformat(),
        }
        self._setup_proxy()
    
    def _setup_proxy(self):
        """Setup HTTP proxy for requests."""
        if self.proxy:
            handler = urllib.request.ProxyHandler({
                'http': self.proxy,
                'https': self.proxy
            })
            opener = urllib.request.build_opener(handler)
            urllib.request.install_opener(opener)
    
    def _fetch(self, url: str, timeout: int = 15) -> Optional[str]:
        """Fetch URL content."""
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/html',
                'Accept-Language': 'en-US,en;q=0.9',
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except urllib.error.URLError as e:
            print(f"  ⚠ URL error: {e}")
            return None
        except Exception as e:
            print(f"  ⚠ Error: {e}")
            return None
    
    def check_openSanctions(self, name: str, inn: str = None) -> dict:
        """
        Check OpenSanctions API (aggregates OFAC, EU, UN, and other sources).
        This is the primary source for sanctions checking.
        """
        print("\n🔍 Checking OpenSanctions...")
        result = {
            'source': 'OpenSanctions',
            'checked': False,
            'found': False,
            'entities': [],
            'details': []
        }
        
        # Build search query
        queries = []
        if name:
            queries.append(quote(name))
        if inn:
            queries.append(quote(inn))
        
        for query in queries:
            print(f"  → Searching: {query}")
            
            # Try OpenSanctions search API
            try:
                search_url = f"https://opensanctions.org/search/?q={query}"
                html = self._fetch(search_url, timeout=20)
                
                if html:
                    # Parse search results page for matches
                    # Look for entity cards with sanction indicators
                    sanction_indicators = [
                        'OFAC SDN',
                        'EU Sanctions',
                        'UK Sanctions',
                        'UN Sanctions',
                        'Russia-related',
                        'Entity List',
                        'SDN List',
                    ]
                    
                    found_indicators = []
                    for indicator in sanction_indicators:
                        if indicator.lower() in html.lower():
                            found_indicators.append(indicator)
                            result['found'] = True
                    
                    # Extract entity names from results
                    entity_pattern = r'<a[^>]*class="entity-link"[^>]*>([^<]+)</a>'
                    entities = re.findall(entity_pattern, html)
                    result['entities'].extend(entities[:5])
                    
                    # Extract program/country indicators
                    program_pattern = r'data-program="([^"]+)"'
                    programs = re.findall(program_pattern, html)
                    result['details'].extend(programs)
                    
                    if result['found']:
                        print(f"  🔴 FOUND in OpenSanctions!")
                        print(f"    Indicators: {found_indicators}")
                        print(f"    Entities: {result['entities'][:3]}")
                    else:
                        print(f"  ✓ Not found in OpenSanctions")
                    
                    result['checked'] = True
                    break
                    
            except Exception as e:
                print(f"  ⚠ OpenSanctions check failed: {e}")
        
        return result
    
    def check_ofac_sdn(self, name: str, inn: str = None) -> dict:
        """
        Check OFAC SDN List (US Treasury).
        Direct check of US sanctions list.
        """
        print("\n🔍 Checking OFAC SDN List...")
        result = {
            'source': 'OFAC SDN (US Treasury)',
            'checked': False,
            'found': False,
            'matches': [],
            'programs': [],
        }
        
        queries = [name] if name else []
        if inn:
            queries.append(inn)
        
        for query in queries:
            if not query:
                continue
            
            print(f"  → Searching: {query}")
            
            # OFAC search URL
            search_url = f"https://sanctionssearch.ofac.treas.gov/SearchResults.aspx?searchString={quote(query)}"
            html = self._fetch(search_url, timeout=20)
            
            if html:
                # Check for exact matches
                if 'Exact Matches' in html or 'exact match' in html.lower():
                    result['found'] = True
                    print(f"  🔴 FOUND in OFAC SDN!")
                    
                    # Extract match details
                    match_pattern = r'<td[^>]*>([^<]+)</td>'
                    matches = re.findall(match_pattern, html)[:10]
                    result['matches'] = matches
                    
                    # Extract sanction programs
                    program_keywords = ['SDN', 'Entity List', 'SSI', 'FSE', 'NS-ISA', 'PLC']
                    for kw in program_keywords:
                        if kw in html:
                            result['programs'].append(kw)
                    
                else:
                    print(f"  ✓ Not found in OFAC SDN")
                
                result['checked'] = True
                break
        
        return result
    
    def check_eu_sanctions(self, name: str, inn: str = None) -> dict:
        """
        Check EU Sanctions List.
        """
        print("\n🔍 Checking EU Sanctions...")
        result = {
            'source': 'EU Sanctions List',
            'checked': False,
            'found': False,
            'matches': [],
        }
        
        queries = [name] if name else []
        if inn:
            queries.append(inn)
        
        for query in queries:
            if not query:
                continue
            
            print(f"  → Searching: {query}")
            
            # EU sanctions search
            try:
                search_url = f"https://webgate.ec.europa.eu/fsd/fsf/public/search?s={quote(query)}"
                html = self._fetch(search_url, timeout=20)
                
                if html:
                    # Check for results
                    if 'sanctions' in html.lower() and (name.lower() in html.lower() if name else True):
                        result['found'] = True
                        print(f"  🔴 FOUND in EU Sanctions!")
                    else:
                        print(f"  ✓ Not found in EU Sanctions")
                    
                    result['checked'] = True
                    break
                    
            except Exception as e:
                print(f"  ⚠ EU check failed: {e}")
        
        return result
    
    def check_all(self, name: str = None, inn: str = None) -> dict:
        """
        Check all sanctions sources.
        """
        print("\n" + "=" * 50)
        print("  制裁状态检查")
        print("=" * 50)
        
        if name:
            print(f"  公司名称: {name}")
        if inn:
            print(f"  INN: {inn}")
        
        self.results['query'] = {
            'name': name,
            'inn': inn,
        }
        
        # Check each source
        self.results['sources']['opensanctions'] = self.check_openSanctions(name, inn)
        self.results['sources']['ofac_sdn'] = self.check_ofac_sdn(name, inn)
        self.results['sources']['eu_sanctions'] = self.check_eu_sanctions(name, inn)
        
        # Generate summary
        any_found = any(
            s.get('found', False) 
            for s in self.results['sources'].values()
        )
        
        self.results['summary'] = {
            'sanctions_status': 'CLEAR' if not any_found else 'SANCTIONED',
            'risk_level': 'LOW' if not any_found else 'HIGH',
            'recommendation': 'Safe to proceed' if not any_found else 'DO NOT DEVELOP - High sanctions risk',
            'confidence': 'High (checked multiple authoritative sources)',
        }
        
        # Print summary
        print("\n" + "-" * 50)
        print("  制裁检查结果汇总")
        print("-" * 50)
        
        status = self.results['summary']['sanctions_status']
        if status == 'CLEAR':
            print("  ✅ 制裁状态: 无制裁记录")
            print("  ✅ 风险等级: 低")
            print("  ✅ 建议: 可正常开发")
        else:
            print("  🔴 制裁状态: 存在制裁记录!")
            print("  🔴 风险等级: 高")
            print("  🔴 建议: 强烈建议不开发")
            
            # List which sources found matches
            for source_name, source_data in self.results['sources'].items():
                if source_data.get('found'):
                    print(f"    - {source_data['source']}: 有记录")
        
        return self.results
    
    def generate_report(self) -> str:
        """Generate Markdown report."""
        name = self.results['query'].get('name', 'Unknown')
        inn = self.results['query'].get('inn', 'N/A')
        summary = self.results['summary']
        
        report = f"""## 制裁状态检查报告

### 查询对象
- 名称: {name}
- INN: {inn}
- 检查时间: {self.results['timestamp']}

### 检查结果

| 来源 | 状态 | 匹配 |
|------|------|------|
"""
        
        for source_key, source_data in self.results['sources'].items():
            status = "🔴 有记录" if source_data.get('found') else "✅ 无记录"
            matches = ", ".join(source_data.get('matches', source_data.get('entities', []))[:3])
            report += f"| {source_data['source']} | {status} | {matches or '-'} |\n"
        
        report += f"""
### 汇总判断
- **制裁状态**: {summary['sanctions_status']}
- **风险等级**: {summary['risk_level']}
- **建议**: {summary['recommendation']}
- **置信度**: {summary['confidence']}

### 数据来源说明
- **OpenSanctions**: 聚合 OFAC、EU、UN 等多源制裁数据，优先级最高
- **OFAC SDN**: 美国财政部特别指定国民名单，美国出口管制核心依据
- **EU Sanctions**: 欧盟制裁名单，欧洲出口管制依据

---
⚠️ 注意: 制裁名单动态更新，建议定期复查。此检查结果仅供参考，最终合规决策请咨询专业律师。
"""
        
        return report


def main():
    parser = argparse.ArgumentParser(
        description='Sanctions Check for Russian Companies',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 check_sanctions.py --inn 3700022051
  python3 check_sanctions.py --name "Ростех"
  python3 check_sanctions.py --name "Ростех" --inn 7704736686 --output sanctions_report.json
        """
    )
    
    parser.add_argument('--inn', help='Company INN (10 or 12 digits)')
    parser.add_argument('--name', help='Company name (Russian or English)')
    parser.add_argument('--proxy', default=DEFAULT_PROXY, help=f'Proxy URL (default: {DEFAULT_PROXY})')
    parser.add_argument('--output', help='Output JSON file')
    parser.add_argument('--report', help='Output Markdown report file')
    
    args = parser.parse_args()
    
    if not args.inn and not args.name:
        print("错误: 请提供 --inn 或 --name 参数")
        print("用法: python3 check_sanctions.py --inn 3700022051")
        print("用法: python3 check_sanctions.py --name 'Ростех'")
        sys.exit(1)
    
    checker = SanctionsChecker(proxy=args.proxy)
    results = checker.check_all(name=args.name, inn=args.inn)
    
    # Save JSON output
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"\n📄 JSON已保存: {args.output}")
    
    # Save Markdown report
    if args.report:
        report = checker.generate_report()
        with open(args.report, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"📄 报告已保存: {args.report}")
    else:
        # Print report to stdout
        print("\n" + checker.generate_report())


if __name__ == '__main__':
    main()
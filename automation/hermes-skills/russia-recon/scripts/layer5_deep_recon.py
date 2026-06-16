#!/usr/bin/env python3
"""
Layer 5 深层侦察集成脚本
集成了 Maigret + holehe + theHarvester + GHunt 四合一

依赖安装:
  pip3 install maigret holehe
  pip3 install "aiosignal==1.3.1" "attrs>=23.1.0"
  theHarvester: /opt/homebrew/theharvester-venv/ (Python 3.12, v4.10.1)
  GHunt: pipx install ghunt (v2.3.4, 需先运行 ghunt login 认证)

Usage:
  # 姓名搜索（跨平台，含VK/Odnoklassniki/Habr）
  python3 layer5_deep_recon.py search "Иван Петров"
  
  # 邮箱反查（检测在哪些平台注册过）
  python3 layer5_deep_recon.py email info@company.ru
  
  # 域名OSINT扫描（邮箱+子域名+主机+员工名）
  python3 layer5_deep_recon.py domain company.ru
  
  # Google生态情报（邮箱→Google Profile/Maps/YouTube/Calendar）
  python3 layer5_deep_recon.py ghunt someone@gmail.com
  
  # 快速模式（只查前10个平台）
  python3 layer5_deep_recon.py email --quick info@company.ru
"""

import argparse
import json
import sys
import os
from pathlib import Path
from datetime import datetime

# 添加Python bin到PATH
BIN_DIR = Path.home() / "Library" / "Python" / "3.9" / "bin"
os.environ["PATH"] = f"{BIN_DIR}:{os.environ['PATH']}"

OUTPUT_DIR = Path.home() / ".hermes" / "workspace" / "deep_recon"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Maigret重点关注的俄语平台（VK/Habr等）
RUSSIAN_SITES = [
    "VK", "Odnoklassniki", "Habr_Career", "Habr_QnA", 
    "Pikabu", "Habr", "LiveJournal", "Yandex_Collection",
    "Yandex_Music", "Yandex_Reviewer", "Drive2"
]

def search_person(name: str, top_sites: int = None, timeout: int = 60):
    """使用Maigret跨平台搜索姓名"""
    print(f"\n🔍 [Maigret] 搜索: {name}")
    
    cmd_parts = [
        "maigret", name,
        "--folderoutput", str(OUTPUT_DIR),
        "--timeout", "15",
        "--retries", "2",
    ]
    
    if top_sites:
        cmd_parts.extend(["--top-sites", str(top_sites)])
    else:
        # 默认只搜俄语重点平台
        for site in RUSSIAN_SITES:
            cmd_parts.extend(["--site", site])
    
    import subprocess
    try:
        result = subprocess.run(
            " ".join(cmd_parts),
            shell=True, capture_output=True, text=True, timeout=timeout
        )
        print(result.stdout[-1000:] if len(result.stdout) > 1000 else result.stdout)
        if result.stderr:
            print(f"  ⚠️ 警告: {result.stderr[:500]}")
        
        # 尝试读取生成的报告
        report_files = list(OUTPUT_DIR.glob(f"*{name.replace(' ', '_')}*"))
        if report_files:
            print(f"  ✅ 报告已生成: {report_files[0]}")
            return {"status": "success", "report": str(report_files[0])}
        
        # 检查是否存在相近的文件
        report_files = sorted(OUTPUT_DIR.glob("*.txt"), key=os.path.getmtime, reverse=True)
        if report_files:
            print(f"  ✅ 最新报告: {report_files[0]}")
            return {"status": "success", "report": str(report_files[0])}
        
        return {"status": "completed", "note": "未找到匹配的账号"}
    
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ Maigret超时（{timeout}s）")
        return {"status": "timeout"}
    except Exception as e:
        print(f"  ❌ Maigret错误: {e}")
        return {"status": "error", "error": str(e)}


def check_email(email: str, quick: bool = False):
    """使用holehe检查邮箱"""
    print(f"\n📧 [holehe] 检查: {email}")
    
    cmd_parts = ["holehe", email, "--no-color"]
    if quick:
        cmd_parts.append("--only-used")
    
    import subprocess
    try:
        result = subprocess.run(
            " ".join(cmd_parts),
            shell=True, capture_output=True, text=True, timeout=120
        )
        
        # 解析结果
        output = result.stdout
        lines = output.strip().split('\n')
        
        registered = []
        not_registered = []
        
        for line in lines:
            line = line.strip()
            if line.startswith('['):
                platform = line.split(']')[0][1:].strip()
                status = line.split(']')[-1].strip() if ']' in line else ""
                
                if '[x]' in line or '✅' in line:
                    registered.append(platform)
                elif '[-]' in line:
                    not_registered.append(platform)
        
        print(f"\n  ✅ 已注册的平台 ({len(registered)}):")
        for p in registered[:15]:
            print(f"     ✓ {p}")
        if len(registered) > 15:
            print(f"     ... 还有{len(registered)-15}个")
        
        print(f"\n  关键发现:")
        high_value_platforms = ["github", "gitlab", "linkedin", "twitter", "facebook", 
                                "vk", "telegram", "habr", "pikabu", "livejournal",
                                "yandex", "mail.ru", "google", "adobe"]
        for p in registered:
            for hvp in high_value_platforms:
                if hvp.lower() in p.lower():
                    print(f"     🔥 {p} — 高价值平台!")
                    break
        
        return {
            "email": email,
            "registered_count": len(registered),
            "registered_platforms": registered,
            "high_value": [p for p in registered if any(hvp.lower() in p.lower() for hvp in high_value_platforms)]
        }
    
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ holehe超时")
        return {"status": "timeout"}
    except Exception as e:
        print(f"  ❌ holehe错误: {e}")
        return {"status": "error", "error": str(e)}


# theHarvester 可执行文件路径（Python 3.12 venv）
THEHARVESTER_BIN = "/opt/homebrew/theharvester-venv/bin/theHarvester"


def harvest_domain(domain: str, limit: int = 200, timeout: int = 180):
    """使用theHarvester对域名进行OSINT扫描
    自动发现: 员工邮箱、子域名、IP主机、LinkedIn员工名
    
    数据源: Google, Bing, LinkedIn, DNS, 等20+公开源
    """
    print(f"\n🌐 [theHarvester] 域名扫描: {domain}")
    
    if not Path(THEHARVESTER_BIN).exists():
        print(f"  ❌ theHarvester未安装: {THEHARVESTER_BIN}")
        return {"status": "error", "error": f"theHarvester未安装在 {THEHARVESTER_BIN}"}
    
    import subprocess
    
    # 使用多种数据源进行扫描
    # 免费（不需要API key）: rapiddns, crtsh, duckduckgo, yahoo, hackertarget, otxsearch
    # 需要API key（可选配置）: bing, brave, dnsdumpster, shodan, censys, virustotal
    sources = [
        "rapiddns",       # DNS枚举（最快，结果多）
        "crtsh",          # 证书透明度（子域名发现）
        "hackertarget",   # DNS/端口扫描
        "otxsearch",      # AlienVault OTX威胁情报
        "duckduckgo",     # 搜索引擎
    ]
    
    all_emails = set()
    all_hosts = set()
    all_subdomains = set()
    linkedin_people = []
    
    # 逐源扫描（避免一次全跑导致超时）
    for source in sources:
        cmd = [
            THEHARVESTER_BIN,
            "-d", domain,
            "-l", str(limit),
            "-b", source,
        ]
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True, timeout=30
            )
            output = result.stdout + result.stderr
            
            # 解析邮箱
            import re
            email_pattern = re.compile(rf'[a-zA-Z0-9._%+-]+@{re.escape(domain)}', re.IGNORECASE)
            found_emails = email_pattern.findall(output)
            all_emails.update(found_emails)
            
            # 解析主机/IP
            host_pattern = re.compile(rf'[a-zA-Z0-9.-]+\.{re.escape(domain)}')
            found_hosts = host_pattern.findall(output)
            all_hosts.update(found_hosts)
            
            # 解析LinkedIn人名
            if 'linkedin' in source:
                # 提取常见格式: "FirstName LastName"
                ln_pattern = re.compile(r'[*]\s+([A-ZА-ЯЁ][a-zа-яё]+\s+[A-ZА-ЯЁ][a-zа-яё]+)')
                people = ln_pattern.findall(output)
                linkedin_people.extend(people)
            
            print(f"  ✓ {source}: {len(found_emails)}邮箱, {len(found_hosts)}主机")
            
        except subprocess.TimeoutExpired:
            print(f"  ⚠️ {source} 超时，跳过")
        except Exception as e:
            print(f"  ⚠️ {source} 错误: {e}")
    
    # 分类子域名
    for host in all_hosts:
        if host != domain and host.endswith(domain):
            all_subdomains.add(host)
    
    # 推断邮箱格式（如果有邮箱发现）
    email_patterns = {}
    if all_emails:
        for email in all_emails:
            local = email.split('@')[0]
            if '.' in local:
                email_patterns['firstname.lastname'] = email
            elif len(local) <= 3:
                email_patterns['initials'] = email
            elif local[0] == local[0].lower() and local[1:].replace('.', '').islower():
                email_patterns['flastname'] = email
    
    result_data = {
        "domain": domain,
        "emails": sorted(all_emails),
        "hosts": sorted(all_hosts),
        "subdomains": sorted(all_subdomains),
        "linkedin_people": linkedin_people,
        "email_patterns": email_patterns,
        "summary": {
            "total_emails": len(all_emails),
            "total_hosts": len(all_hosts),
            "total_subdomains": len(all_subdomains),
            "total_linkedin": len(linkedin_people)
        }
    }
    
    print(f"\n  📊 扫描结果:")
    print(f"     📧 邮箱: {len(all_emails)}")
    for e in sorted(all_emails)[:10]:
        print(f"        → {e}")
    if len(all_emails) > 10:
        print(f"        ... 还有{len(all_emails)-10}个")
    
    print(f"     🌐 子域名: {len(all_subdomains)}")
    for s in sorted(all_subdomains)[:8]:
        print(f"        → {s}")
    
    print(f"     👤 LinkedIn: {len(linkedin_people)}")
    for p in linkedin_people[:5]:
        print(f"        → {p}")
    
    if email_patterns:
        print(f"     📋 邮箱格式: {list(email_patterns.keys())}")
    
    return result_data


def ghunt_email(email: str, timeout: int = 60):
    """使用GHunt通过邮箱查询Google生态情报
    需要先运行 ghunt login 完成认证
    
    返回: 姓名、Gaia ID、Google服务、Maps评论、YouTube、日历等
    """
    print(f"\n🔎 [GHunt] Google情报查询: {email}")
    
    import subprocess
    
    # 检查GHunt是否安装
    ghunt_bin = None
    for candidate in ["ghunt", "/opt/homebrew/bin/ghunt"]:
        try:
            result = subprocess.run(
                ["which", candidate], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                ghunt_bin = candidate
                break
        except Exception:
            continue
    
    if not ghunt_bin:
        print("  ❌ GHunt未安装。运行: pipx install ghunt")
        return {"status": "error", "error": "GHunt未安装"}
    
    # 检查认证状态
    creds_file = Path.home() / ".malfrats" / "ghunt" / "creds.m"
    if not creds_file.exists():
        print("  ⚠️ GHunt未认证。请先运行: ghunt login")
        return {"status": "error", "error": "GHunt未认证，请运行 ghunt login"}
    
    # 输出JSON到临时文件
    json_output = OUTPUT_DIR / f"ghunt_{email.replace('@', '_at_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    cmd = [ghunt_bin, "email", email, "--json", str(json_output)]
    
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        
        output = result.stdout + result.stderr
        
        # 解析结果
        ghunt_data = {
            "email": email,
            "registered_on_google": False,
            "name": None,
            "gaia_id": None,
            "services": [],
            "maps_reviews": None,
            "calendar_events": None,
            "profile_photo": None,
            "is_bot": None,
        }
        
        # 从控制台输出解析基本信息
        if "is not registered" in output.lower() or "not found" in output.lower():
            print(f"  ℹ️ 该邮箱未注册Google")
            return ghunt_data
        
        ghunt_data["registered_on_google"] = True
        
        # 从JSON文件解析详细数据
        if json_output.exists():
            try:
                with open(json_output, 'r') as f:
                    raw = json.load(f)
                
                container = raw.get("PROFILE_CONTAINER", raw)
                profile = container.get("profile", {})
                
                # 提取姓名
                names = profile.get("names", {})
                if isinstance(names, dict) and "PROFILE" in names:
                    name_obj = names["PROFILE"]
                    ghunt_data["name"] = getattr(name_obj, 'fullname', None) or str(name_obj)
                elif isinstance(names, dict):
                    for key, val in names.items():
                        ghunt_data["name"] = getattr(val, 'fullname', None) or str(val)
                        break
                
                # Gaia ID
                ghunt_data["gaia_id"] = profile.get("personId", container.get("gaia_id"))
                
                # Google服务
                reachability = profile.get("inAppReachability", {})
                if isinstance(reachability, dict):
                    ghunt_data["services"] = list(reachability.keys())
                
                # Maps数据
                maps = container.get("maps", {})
                if maps:
                    stats = maps.get("stats")
                    if stats:
                        ghunt_data["maps_reviews"] = {
                            "reviews_count": getattr(stats, 'reviews_count', None),
                            "photos_count": getattr(stats, 'photos_count', None),
                        }
                
                # Calendar数据
                calendar = container.get("calendar", {})
                if calendar:
                    details = calendar.get("details")
                    events = calendar.get("events")
                    ghunt_data["calendar_events"] = {
                        "has_public_calendar": details is not None,
                        "events_count": len(events) if events else 0,
                    }
                
            except (json.JSONDecodeError, Exception) as e:
                print(f"  ⚠️ JSON解析失败: {e}")
        
        # 从控制台输出补充解析
        import re
        name_match = re.search(r'Name\s*:\s*(.+)', output)
        if name_match and not ghunt_data["name"]:
            ghunt_data["name"] = name_match.group(1).strip()
        
        gaia_match = re.search(r'Gaia ID\s*:\s*(.+)', output)
        if gaia_match and not ghunt_data["gaia_id"]:
            ghunt_data["gaia_id"] = gaia_match.group(1).strip()
        
        bot_match = re.search(r'Bot\s*:\s*(\w+)', output)
        if bot_match:
            ghunt_data["is_bot"] = bot_match.group(1).lower() == "true"
        
        # 打印结果
        print(f"\n  📊 Google情报:")
        if ghunt_data["name"]:
            print(f"     👤 姓名: {ghunt_data['name']}")
        if ghunt_data["gaia_id"]:
            print(f"     🆔 Gaia ID: {ghunt_data['gaia_id']}")
        if ghunt_data["services"]:
            print(f"     🔧 已激活服务: {', '.join(ghunt_data['services'][:10])}")
        if ghunt_data["maps_reviews"]:
            print(f"     📍 Maps: {ghunt_data['maps_reviews']}")
        if ghunt_data["calendar_events"]:
            print(f"     📅 Calendar: {ghunt_data['calendar_events']}")
        
        if not ghunt_data["name"] and not ghunt_data["services"]:
            print(f"     (详细输出见控制台)")
        
        return ghunt_data
    
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ GHunt超时({timeout}s)")
        return {"status": "timeout", "email": email}
    except Exception as e:
        print(f"  ❌ GHunt错误: {e}")
        return {"status": "error", "error": str(e), "email": email}


def format_report(search_result: dict, email_result: dict, harvest_result: dict = None, 
                  ghunt_result: dict = None,
                  name: str = None, email: str = None, domain: str = None):
    """生成格式化的Markdown报告"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    report = f"""# Layer 5 深层侦察报告
**生成时间**: {now}

---
"""
    if name:
        report += f"\n## 姓名搜索: {name}\n"
        if search_result.get("status") == "success":
            report += f"\n✅ Maigret搜索完成\n报告文件: {search_result.get('report', 'N/A')}\n"
            # 读取报告内容
            report_path = search_result.get("report")
            if report_path and Path(report_path).exists():
                content = Path(report_path).read_text(encoding='utf-8', errors='replace')
                report += f"\n### 搜索发现\n```\n{content[:2000]}\n```\n"
        elif search_result.get("status") == "completed":
            report += "\nℹ️ 搜索完成，未找到匹配项\n"
        else:
            report += f"\n⚠️ 搜索状态: {search_result.get('status')}\n"
    
    if email:
        report += f"\n## 邮箱检测: {email}\n"
        if email_result.get("registered_count", 0) > 0:
            report += f"\n✅ 在 **{email_result['registered_count']}** 个平台注册\n"
            if email_result.get("high_value"):
                report += "\n🔥 高价值平台:\n"
                for p in email_result["high_value"]:
                    report += f"- {p}\n"
            report += "\n完整列表:\n"
            for p in email_result.get("registered_platforms", []):
                report += f"- {p}\n"
        else:
            report += "\nℹ️ 未在任何公开平台注册\n"
    
    if domain and harvest_result and harvest_result.get("emails") is not None:
        report += f"\n## 域名OSINT扫描: {domain}\n"
        summary = harvest_result.get("summary", {})
        report += f"\n📊 扫描摘要:\n"
        report += f"- 📧 邮箱: {summary.get('total_emails', 0)}\n"
        report += f"- 🌐 子域名: {summary.get('total_subdomains', 0)}\n"
        report += f"- 🖥️ 主机: {summary.get('total_hosts', 0)}\n"
        report += f"- 👤 LinkedIn: {summary.get('total_linkedin', 0)}\n"
        
        emails = harvest_result.get("emails", [])
        if emails:
            report += f"\n### 发现的邮箱 ({len(emails)})\n"
            for e in emails:
                report += f"- `{e}`\n"
        
        subdomains = harvest_result.get("subdomains", [])
        if subdomains:
            report += f"\n### 子域名 ({len(subdomains)})\n"
            for s in subdomains[:20]:
                report += f"- `{s}`\n"
        
        linkedin = harvest_result.get("linkedin_people", [])
        if linkedin:
            report += f"\n### LinkedIn员工 ({len(linkedin)})\n"
            for p in linkedin[:15]:
                report += f"- {p}\n"
        
        patterns = harvest_result.get("email_patterns", {})
        if patterns:
            report += f"\n### 推断邮箱格式\n"
            for fmt, example in patterns.items():
                report += f"- `{fmt}` → 示例: `{example}`\n"
    
    if ghunt_result and ghunt_result.get("email"):
        report += f"\n## Google生态情报: {ghunt_result['email']}\n"
        if not ghunt_result.get("registered_on_google"):
            report += "\nℹ️ 该邮箱未注册Google\n"
        else:
            if ghunt_result.get("name"):
                report += f"\n👤 **姓名**: {ghunt_result['name']}\n"
            if ghunt_result.get("gaia_id"):
                report += f"- 🆔 Gaia ID: `{ghunt_result['gaia_id']}`\n"
            if ghunt_result.get("services"):
                report += f"- 🔧 已激活服务: {', '.join(ghunt_result['services'][:10])}\n"
            if ghunt_result.get("maps_reviews"):
                mr = ghunt_result["maps_reviews"]
                report += f"- 📍 Maps评论: {mr.get('reviews_count', 0)}条, 照片: {mr.get('photos_count', 0)}张\n"
            if ghunt_result.get("calendar_events"):
                ce = ghunt_result["calendar_events"]
                report += f"- 📅 公开日历: {'是' if ce.get('has_public_calendar') else '否'}, 事件: {ce.get('events_count', 0)}个\n"
    
    report += f"\n---\n*工具: maigret + holehe + theHarvester v4.10.1 + GHunt v2.3.4*"
    
    report_path = OUTPUT_DIR / f"deep_recon_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    report_path.write_text(report, encoding='utf-8')
    print(f"\n📄 报告已保存: {report_path}")
    return str(report_path)


def main():
    parser = argparse.ArgumentParser(description="Layer 5 深层侦察 - Maigret + holehe + theHarvester + GHunt")
    subparsers = parser.add_subparsers(dest="command")
    
    # 姓名搜索
    search_parser = subparsers.add_parser("search", help="姓名跨平台搜索")
    search_parser.add_argument("name", help="要搜索的姓名")
    search_parser.add_argument("--top", type=int, help="只搜前N个最流行平台")
    search_parser.add_argument("--timeout", type=int, default=60, help="超时秒数")
    
    # 邮箱检查
    email_parser = subparsers.add_parser("email", help="邮箱注册检测")
    email_parser.add_argument("email", help="要检查的邮箱")
    email_parser.add_argument("--quick", action="store_true", help="快速模式(只显示已注册的)")
    
    # 域名OSINT扫描 (theHarvester)
    domain_parser = subparsers.add_parser("domain", help="域名OSINT扫描 (theHarvester)")
    domain_parser.add_argument("domain", help="目标域名 (如 company.ru)")
    domain_parser.add_argument("--limit", type=int, default=200, help="搜索结果限制 (默认200)")
    domain_parser.add_argument("--timeout", type=int, default=180, help="总超时秒数 (默认180)")
    
    # Google生态情报 (GHunt)
    ghunt_parser = subparsers.add_parser("ghunt", help="Google生态情报 (GHunt)")
    ghunt_parser.add_argument("email", help="目标邮箱")
    ghunt_parser.add_argument("--timeout", type=int, default=60, help="超时秒数 (默认60)")
    
    args = parser.parse_args()
    
    harvest_result = None
    ghunt_result = None
    
    if args.command == "search":
        result = search_person(args.name, args.top, args.timeout)
        email_result = None
    elif args.command == "email":
        result = None
        email_result = check_email(args.email, args.quick)
    elif args.command == "domain":
        result = None
        email_result = None
        harvest_result = harvest_domain(args.domain, args.limit, args.timeout)
    elif args.command == "ghunt":
        result = None
        email_result = None
        ghunt_result = ghunt_email(args.email, args.timeout)
    else:
        parser.print_help()
        return
    
    # 生成报告
    report_path = format_report(
        result or {}, email_result or {}, harvest_result or {},
        ghunt_result or {},
        args.name if args.command == "search" else None,
        args.email if args.command in ("email", "ghunt") else None,
        args.domain if args.command == "domain" else None,
    )
    print(f"\n✅ Layer 5侦察完成 | 报告: {report_path}")


if __name__ == "__main__":
    main()

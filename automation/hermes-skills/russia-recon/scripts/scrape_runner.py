#!/usr/bin/env python3
"""
统一数据抓取入口 — scrape_runner.py

用法:
  python scrape_runner.py                    # 抓取所有数据源（按优先级）
  python scrape_runner.py --source elcp      # 只抓 elcp.ru
  python scrape_runner.py --source productcenter
  python scrape_runner.py --export           # 导出CSV（不抓取）
  python scrape_runner.py --stats            # 查看统计

数据源优先级:
  1. elcp.ru         ★★★★★  专业电子目录，直接含电话/邮件
  2. productcenter   ★★★★☆  制造商目录，需抓详情页
  3. cataloxy        ★★★☆☆  通用目录，关键词搜索
  4. yp.ru           ★★★☆☆  黄页目录，关键词+分类
"""

import sys
import argparse
from pathlib import Path
try:
    from loguru import logger
except ImportError:
    class _FallbackLogger:
        def info(self, msg): print(msg)
        def error(self, msg): print(msg)
        def exception(self, msg): print(msg)
    logger = _FallbackLogger()

try:
    from rich.console import Console
    from rich.table import Table
except ImportError:
    class Console:
        def print(self, *args, **kwargs): print(*args)
    class Table:
        def __init__(self, title="", **kwargs):
            self.title = title
            self.rows = []
        def add_column(self, *args, **kwargs): pass
        def add_row(self, *args, **kwargs): self.rows.append(args)
        def add_section(self): self.rows.append(())
        def __str__(self):
            rows = [" | ".join(map(str, r)) for r in self.rows if r]
            return "\n".join(([self.title] if self.title else []) + rows)

sys.path.insert(0, str(Path(__file__).parent))
from utils.storage import init_db, get_stats, get_conn

console = Console()


def export_csv():
    """导出所有数据到CSV"""
    import csv
    output_dir = Path(__file__).parent.parent.parent / "data" / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    conn = get_conn()
    rows = conn.execute("""
        SELECT name, inn, city, region, address, phone, email, website,
               employees, customer_level, source, source_url, description
        FROM companies
        ORDER BY customer_level, source, name
    """).fetchall()
    conn.close()
    
    out_path = output_dir / "companies_all.csv"
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["公司名", "INN", "城市", "地区", "地址", "电话", "邮箱",
                         "官网", "员工数", "客户级别", "数据来源", "来源URL", "业务描述"])
        for row in rows:
            writer.writerow(list(row))
    
    logger.info(f"✅ CSV已导出: {out_path} ({len(rows)} 条)")
    return out_path


def show_stats():
    """显示统计信息"""
    stats = get_stats()
    
    table = Table(title="数据库统计", show_header=True, header_style="bold cyan")
    table.add_column("数据来源", style="cyan")
    table.add_column("数量", justify="right", style="green")
    
    for s in stats["by_source"]:
        table.add_row(s["source"], str(s["cnt"]))
    
    table.add_section()
    table.add_row("[bold]总计[/bold]", f"[bold]{stats['total']}[/bold]")
    console.print(table)
    
    # 按客户级别统计
    conn = get_conn()
    levels = conn.execute("""
        SELECT customer_level, COUNT(*) as cnt 
        FROM companies GROUP BY customer_level ORDER BY customer_level
    """).fetchall()
    conn.close()
    
    level_table = Table(title="客户级别分布", header_style="bold yellow")
    level_table.add_column("级别")
    level_table.add_column("数量", justify="right")
    level_table.add_column("说明")
    
    desc = {"A": "直接元器件采购（100%确定）", "B": "高概率需求", "C": "可能需求", None: "未分级"}
    for row in levels:
        lv = row["customer_level"] or "未分级"
        level_table.add_row(lv, str(row["cnt"]), desc.get(lv, ""))
    
    console.print(level_table)
    
    # 接触方式完整度
    conn = get_conn()
    with_email = conn.execute("SELECT COUNT(*) FROM companies WHERE email != '' AND email IS NOT NULL").fetchone()[0]
    with_phone = conn.execute("SELECT COUNT(*) FROM companies WHERE phone != '' AND phone IS NOT NULL").fetchone()[0]
    with_web   = conn.execute("SELECT COUNT(*) FROM companies WHERE website != '' AND website IS NOT NULL").fetchone()[0]
    conn.close()
    
    total = stats["total"]
    if total > 0:
        console.print(f"\n[bold]联系方式覆盖率:[/bold]")
        console.print(f"  📧 邮箱: {with_email}/{total} ({with_email*100//total}%)")
        console.print(f"  📞 电话: {with_phone}/{total} ({with_phone*100//total}%)")
        console.print(f"  🌐 官网: {with_web}/{total} ({with_web*100//total}%)")


def main():
    parser = argparse.ArgumentParser(description="俄罗斯电子企业数据抓取系统")
    parser.add_argument("--source", choices=["elcp", "productcenter", "cataloxy", "yp", "all"],
                        default="all", help="指定数据源")
    parser.add_argument("--export", action="store_true", help="导出CSV")
    parser.add_argument("--stats", action="store_true", help="查看统计")
    parser.add_argument("--no-skip", action="store_true", help="不跳过已抓取的URL（重新抓取）")
    parser.add_argument("--test", action="store_true", help="测试模式")
    args = parser.parse_args()

    init_db()

    if args.stats:
        show_stats()
        return

    if args.export:
        path = export_csv()
        console.print(f"[green]✅ 导出完成: {path}[/green]")
        return

    sources = {
        "elcp":          ("scrape_elcp",          "elcp.ru — 电子行业专业名录"),
        "productcenter": ("scrape_productcenter",  "productcenter.ru — 制造商目录"),
        "cataloxy":      ("scrape_cataloxy",       "cataloxy.ru — 通用目录关键词搜索"),
        "yp":            ("scrape_yp",             "yp.ru — 黄页目录"),
    }

    order = ["elcp", "productcenter", "cataloxy", "yp"] if args.source == "all" else [args.source]

    console.print("\n[bold magenta]俄罗斯电子企业 全量数据抓取系统[/bold magenta]\n")

    for src in order:
        module_name, desc = sources[src]
        console.print(f"\n[bold yellow]▶ 开始: {desc}[/bold yellow]")
        
        try:
            module = __import__(module_name)
            module.scrape_all(
                skip_done=not args.no_skip,
                test_mode=args.test,
            )
        except ImportError as e:
            logger.error(f"无法导入模块 {module_name}: {e}")
        except KeyboardInterrupt:
            console.print("\n[yellow]⚠️ 用户中断，进度已保存[/yellow]")
            break
        except Exception as e:
            logger.exception(f"抓取 {src} 时出错: {e}")
            continue

    console.print("\n[bold green]═══ 全部抓取完成 ═══[/bold green]")
    show_stats()
    
    console.print("\n[bold]导出CSV...[/bold]")
    export_csv()


if __name__ == "__main__":
    main()

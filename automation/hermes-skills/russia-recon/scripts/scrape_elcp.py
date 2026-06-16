#!/usr/bin/env python3
"""
elcp.ru 爬虫 v2 — 优化版
来源: 俄罗斯电子行业专业名录（媒体集团"Электроника"）

策略:
  1. 先从各分类页 收集公司名 → 建立 分类映射表
  2. 从综合 /info 页面抓取全部公司的联系方式（含电话/邮件/官网）
  3. 交叉匹配 → 合并数据

列结构（已通过代码验证）:
  /info 页 (15列):
    td[0]  = 更新日期
    td[1]  = 公司名
    td[2]  = 法律形式 (ООО/АО等)
    td[3]  = 分类标签
    td[4]  = 邮政区号
    td[5]  = 地区
    td[6]  = 区
    td[7]  = 城市
    td[8]  = 街道
    td[9]  = 门牌号
    td[10] = 办公室
    td[11] = 电话 (skype链接)
    td[12] = 邮件 (mailto链接)
    td[13] = 官网
    td[14] = 员工数

  /manufacturers 等分类页 (8列, 无联系方式):
    td[0] = 更新日期
    td[1] = 公司名
    td[2] = 产品应用领域
    td[3] = 产品形态
    td[4] = 产品类型
    td[5] = 产品描述
    td[6] = 商业模式
    td[7] = 其他业务

  /contracts 页 (10列, 无联系方式):
    td[0] = 更新日期
    td[1] = 公司名
    td[2]-[9] = 生产能力/认证等
"""

import re
import sys
from pathlib import Path
from typing import Optional
from bs4 import BeautifulSoup
from loguru import logger
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
from rich.console import Console

sys.path.insert(0, str(Path(__file__).parent))
from utils.http_client import HTTPClient
from utils.storage import init_db, upsert_company, log_url, url_done, get_stats

console = Console()
SOURCE = "elcp.ru"
BASE = "http://www.elcp.ru/catalog/anketa"

# 分类配置：各分类页的客户级别
SECTION_LEVELS = {
    "manufacturers": "A",
    "contracts":     "A",
    "distributors":  "B",
    "technics":      "B",
}

# /info 综合页有 15 列，含完整联系方式
INFO_URL = f"{BASE}/info"


def safe_td(cells, idx, default=""):
    if idx < len(cells):
        return cells[idx].get_text(strip=True)
    return default


def clean_url(href):
    """清理 URL：去除双协议、修复 // 开头"""
    if not href:
        return ""
    href = re.sub(r'^https?://(https?://)', r'\1', href)
    href = re.sub(r'^//', 'https://', href)
    return href


def parse_info_page(html: str) -> list[dict]:
    """
    解析 /info 综合页（15列），提取完整联系方式。
    返回含 name, city, region, address, phone, email, website, employees 的列表。
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="table-striped")
    if not table:
        logger.warning("  未找到 table-striped 表格")
        return []

    rows = table.find_all("tr", class_=["odd", "even"])
    if not rows:
        rows = table.find_all("tr")[1:]

    companies = []
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 12:
            continue

        name = safe_td(cells, 1)
        if not name:
            continue

        # 电话：从 td[11] 的 skype: 链接取显示文字
        phone = ""
        if len(cells) > 11:
            skype_a = cells[11].find("a", href=re.compile(r"^skype:"))
            if skype_a:
                phone = skype_a.get_text(strip=True)
                if not phone:
                    phone = skype_a.get("href", "").replace("skype:", "").split("?")[0]

        # 邮件：td[12] 的 mailto: 链接
        email = ""
        if len(cells) > 12:
            mailto_a = cells[12].find("a", href=re.compile(r"^mailto:"))
            if mailto_a:
                email = mailto_a.get("href", "").replace("mailto:", "").strip()
        # 备用：全行文本搜索
        if not email:
            m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', row.get_text())
            if m:
                email = m.group(0)

        # 官网：td[13]
        website = ""
        if len(cells) > 13:
            for a in cells[13].find_all("a", href=True):
                href = clean_url(a.get("href", ""))
                if href.startswith(("http://", "https://")) and "elcp.ru" not in href:
                    website = href
                    break
            if not website:
                raw = safe_td(cells, 13)
                if raw.startswith(("http", "www")):
                    website = raw if raw.startswith("http") else f"http://{raw}"

        # 城市/地址
        city = safe_td(cells, 7)
        street = safe_td(cells, 8)
        house = safe_td(cells, 9)
        address_parts = [city, street, house]
        address = ", ".join(p for p in address_parts if p)

        companies.append({
            "name":      name,
            "org_form":  safe_td(cells, 2),
            "region":    safe_td(cells, 5),
            "city":      city,
            "address":   address,
            "phone":     phone,
            "email":     email,
            "website":   website,
            "employees": safe_td(cells, 14),
            "source":    SOURCE,
        })

    return companies


def parse_section_page(html: str) -> list[str]:
    """
    解析分类页，只提取公司名列表。
    td[1] = 公司名
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="table-striped")
    if not table:
        return []
    rows = table.find_all("tr", class_=["odd", "even"])
    if not rows:
        rows = table.find_all("tr")[1:]
    names = []
    for row in rows:
        cells = row.find_all("td")
        if len(cells) >= 2:
            name = cells[1].get_text(strip=True)
            if name:
                names.append(name)
    return names


def get_total_pages(html: str) -> int:
    soup = BeautifulSoup(html, "lxml")
    max_page = 1
    for a in soup.find_all("a", href=re.compile(r"Anketa_page=(\d+)")):
        m = re.search(r"Anketa_page=(\d+)", a.get("href", ""))
        if m:
            max_page = max(max_page, int(m.group(1)))
    return max_page


def collect_section_names(section: str, client: HTTPClient) -> set:
    """收集某分类页所有公司名（用于分类标记）"""
    url = f"{BASE}/{section}"
    resp = client.get(url, encoding="utf-8")
    if not resp:
        return set()
    total = get_total_pages(resp.text)
    logger.info(f"  [{section}] 共 {total} 页")
    names = set(parse_section_page(resp.text))
    for page in range(2, total + 1):
        r = client.get(f"{url}?Anketa_page={page}", encoding="utf-8")
        if r:
            names.update(parse_section_page(r.text))
    logger.info(f"  [{section}] 收集到 {len(names)} 家公司名")
    return names


def scrape_all(skip_done: bool = True, test_mode: bool = False):
    init_db()
    client = HTTPClient(min_delay=1.5, max_delay=3.0)

    console.print("\n[bold magenta]═══ elcp.ru 全量抓取 v2 ═══[/bold magenta]\n")

    # Step 1: 收集各分类的公司名集合（用于后续分类标记）
    console.print("[bold]Step 1: 收集分类标签...[/bold]")
    section_names = {}
    for section in SECTION_LEVELS:
        section_names[section] = collect_section_names(section, client)

    # 构建 name → level 映射（A > B 优先）
    name_to_level = {}
    for section, names in section_names.items():
        level = SECTION_LEVELS[section]
        for name in names:
            old = name_to_level.get(name, "C")
            if not old or old > level:  # A < B < C
                name_to_level[name] = level

    all_known_names = set(name_to_level.keys())
    console.print(f"  共 {len(all_known_names)} 家在分类页中有记录\n")

    # Step 2: 从 /info 综合页抓取全部联系方式
    console.print("[bold]Step 2: 从综合页抓取联系方式（持续抓到空页）...[/bold]")

    page = 1
    grand_total = 0
    new_count = 0
    consecutive_empty = 0

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        TextColumn("已抓{task.completed}页"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("抓取 /info", total=None)

        while True:
            page_url = INFO_URL if page == 1 else f"{INFO_URL}?Anketa_page={page}"

            if skip_done and url_done(page_url):
                page += 1
                progress.advance(task)
                continue

            resp = client.get(page_url, encoding="utf-8")
            if not resp:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    console.print(f"  连续3页请求失败，停止")
                    break
                page += 1
                continue

            companies = parse_info_page(resp.text)

            if not companies:
                consecutive_empty += 1
                if consecutive_empty >= 2:
                    console.print(f"  第{page}页无数据，抓取结束（共 {page - 1} 页）")
                    break
            else:
                consecutive_empty = 0
                for company in companies:
                    name = company["name"]
                    level = name_to_level.get(name, "B")
                    company["customer_level"] = level
                    company["source_url"] = page_url
                    is_new = upsert_company(company)
                    grand_total += 1
                    if is_new:
                        new_count += 1
                        logger.info(
                            f"  ✅ [{level}] {name} | "
                            f"{company.get('phone', '???')} | "
                            f"{company.get('email', '???')} | "
                            f"{company.get('city', '')}"
                        )
                console.print(f"  第{page}页: {len(companies)} 家 | 累计: {grand_total}")

            log_url(SOURCE, page_url, "done", len(companies))
            progress.advance(task)
            page += 1

    stats = get_stats()
    console.print(f"\n[bold green]═══ elcp.ru 抓取完成 ═══[/bold green]")
    console.print(f"已处理: {grand_total} 条 | 新增: {new_count} 条")
    console.print(f"数据库总计: {stats['total']} 条")
    for s in stats["by_source"]:
        console.print(f"  {s['source']}: {s['cnt']} 条")


if __name__ == "__main__":
    scrape_all()
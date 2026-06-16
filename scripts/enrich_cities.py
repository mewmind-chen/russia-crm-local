#!/usr/bin/env python3
"""
从官网补充客户缺失信息（city, description, products, phone, email）。
直接导入 network-sentinel 的 fetch 逻辑，不走 subprocess。

用法:
  python3 scripts/enrich_cities.py --dry-run          # 预览
  python3 scripts/enrich_cities.py --limit 20         # 试跑
  python3 scripts/enrich_cities.py                    # 全跑
  python3 scripts/enrich_cities.py --only-city        # 只补城市(最快)
"""
import argparse
import re
import sqlite3
import ssl
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

# --- 导入 network-sentinel ---
SENTINEL_DIR = Path.home() / "Desktop/projects/network-sentinel"
sys.path.insert(0, str(SENTINEL_DIR))
from network_sentinel.cli import fetch_url as ns_fetch, resolve_route, browser_fetch_url  # noqa: E402

DB_PATH = Path(__file__).parent.parent / "data" / "crm.db"
TIMEOUT = 20
PROXY = "http://127.0.0.1:7897"

# 忽略 SSL 证书验证（俄罗斯网站很多证书过期/自签）
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE
_UNVERIFIED_HTTPS = urllib.request.HTTPSHandler(context=_ssl_ctx)

RUSSIAN_CITIES = [
    "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань",
    "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону",
    "Уфа", "Красноярск", "Воронеж", "Пермь", "Волгоград", "Краснодар",
    "Саратов", "Тюмень", "Тольятти", "Ижевск", "Барнаул", "Ульяновск",
    "Иркутск", "Хабаровск", "Ярославль", "Владивосток", "Махачкала",
    "Томск", "Оренбург", "Кемерово", "Рязань", "Астрахань", "Пенза",
    "Липецк", "Тула", "Киров", "Чебоксары", "Калининград", "Брянск",
    "Курск", "Иваново", "Магнитогорск", "Тверь", "Ставрополь", "Белгород",
    "Нижний Тагил", "Архангельск", "Владимир", "Симферополь", "Таганрог",
    "Смоленск", "Саранск", "Череповец", "Волжский", "Вологда", "Курган",
    "Орёл", "Мурманск", "Подольск", "Химки", "Набережные Челны", "Люберцы",
    "Балашиха", "Электросталь", "Королёв", "Мытищи", "Коломна", "Серпухов",
    "Щёлково", "Одинцово", "Домодедово", "Раменское", "Жуковский", "Пушкино",
    "Ступино", "Дмитров", "Клин", "Наро-Фоминск", "Елец", "Миасс",
    "Новокузнецк", "Прокопьевск", "Гусев", "Железногорск", "Зеленогорск",
    "Голицыно", "Кувандык", "Фрязино", "Чехов", "Козловка", "Щербинка",
    "Красково", "Киржач", "Александров", "Колпино", "Белорецк",
    "Зеленоград", "Дубна", "Обнинск",
]


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text_parts, self.meta_desc, self.title = [], "", ""
        self.in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag == "meta":
            d = dict(attrs)
            if d.get("name") == "description":
                self.meta_desc = d.get("content", "")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        t = data.strip()
        if t:
            if self.in_title:
                self.title += t
            else:
                self.text_parts.append(t)

    def get_text(self):
        return " ".join(self.text_parts)


def extract_city(text):
    for m in re.findall(r'г\.?\s*([А-Я][а-яя]+(?:[-\s][А-Я][а-яя]+)*)', text):
        for city in RUSSIAN_CITIES:
            if city.lower() in m.lower() or m.lower() in city.lower():
                return city
    for m in re.findall(r'город\s+([А-Я][а-яя]+(?:[-\s][А-Я][а-яя]+)*)', text):
        for city in RUSSIAN_CITIES:
            if city in m:
                return city
    for city in RUSSIAN_CITIES:
        if city.lower() in text.lower():
            return city
    return ""


def extract_phone(text):
    phones = set()
    for p in [r'\+7[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}',
              r'8[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}',
              r'8\s?800\s?\d{3}\s?\d{2}\s?\d{2}']:
        for m in re.findall(p, text):
            if len(re.sub(r'[\s\-\(\)]', '', m)) >= 10:
                phones.add(m.strip())
    return "; ".join(list(phones)[:3])


def extract_email(text):
    emails = set()
    for m in re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text):
        if not any(x in m.lower() for x in ["example.com", "domain.com", "sentry"]):
            emails.add(m.lower())
    return "; ".join(list(emails)[:2])


def extract_description(text, meta_desc):
    if meta_desc and len(meta_desc) > 20:
        return meta_desc.strip()[:200]
    for p in [r'(?:компания|предприятие|завод)[^。]*?(?:занимается|специализируется|производит|разрабатывает|является|предлагает)[^。]{20,200}']:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            return m.group().strip()[:200]
    return ""


def extract_products(text):
    cats = []
    for p in [r'(?:продукция|каталог|оборудование|изделия)[:\s]*([^。.!?]{10,200})',
              r'(?:производим|выпускаем|изготавливаем)[:\s]*([^。.!?]{10,200})']:
        for m in re.findall(p, text, re.IGNORECASE):
            cats.append(m.strip()[:80])
    return "; ".join(cats[:3])[:300]


def fetch_page(url, try_browser=False):
    """使用 network-sentinel 抓取页面（跳过 SSL 验证），支持 browser fallback"""
    route = resolve_route(url, "auto", "/tmp/verge/verge-mihomo.sock")
    out_dir = SENTINEL_DIR / "reports" / "fetches"
    out_dir.mkdir(parents=True, exist_ok=True)

    if try_browser:
        result = browser_fetch_url(url, PROXY, TIMEOUT, out_dir, save_text=True, save_screenshot=False, route=route)
    else:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
            _UNVERIFIED_HTTPS,
        )
        result = ns_fetch(opener, url, TIMEOUT, out_dir, save_text=True, route=route)

    if result.status == "ok":
        body_path = result.saved_body
        if body_path and Path(body_path).exists():
            return Path(body_path).read_text("utf-8"), None
        return None, "no text saved"
    if result.status == "blocked":
        return None, f"blocked:{result.block_type}"
    return None, f"{result.status}:{result.error[:60]}"


def search_fallback(company_name, needed):
    """用 DuckDuckGo 搜索公司信息兜底（当 fetch 失败时）"""
    if not company_name:
        return {}
    query = f"{company_name} адрес контакты"
    try:
        # DuckDuckGo lite search
        data = f"q={urllib.parse.quote(query)}&kl=ru-ru"
        req = urllib.request.Request(
            "https://lite.duckduckgo.com/lite/",
            data=data.encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "User-Agent": "Mozilla/5.0"},
        )
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}),
            _UNVERIFIED_HTTPS,
        )
        resp = opener.open(req, timeout=TIMEOUT)
        html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return {}

    updates = {}
    if "city" in needed:
        c = extract_city(html)
        if c:
            updates["city"] = c
    if "phone" in needed:
        p = extract_phone(html)
        if p:
            updates["phone"] = p
    if "email" in needed:
        e = extract_email(html)
        if e:
            updates["email"] = e
    if "description" in needed:
        # 从搜索结果摘要中取片段
        for m in re.findall(r'<a[^>]*class="result-snippet"[^>]*>(.*?)</a>', html, re.DOTALL):
            t = re.sub(r'<[^>]+>', '', m).strip()
            if t and len(t) > 20:
                updates.setdefault("description", t[:200])
                break
    return updates


def process(conn, row, only_city, only_missing):
    cid, name, url, has_city, has_desc, has_prod, has_phone, has_email = row

    if not url:
        return False, "无网址"
    if not url.startswith("http"):
        url = "https://" + url

    domain = re.sub(r"^https?://", "", url).split("/")[0].lower()
    skip = ["mail.", "webmail.", "outlook", "login", ".transneft.",
            "peterlink.ru", "mari-el.ru", "torus.ru", "zavod.ru"]
    if any(s in domain for s in skip):
        return False, f"跳过:{domain}"

    try:
        text, err = fetch_page(url, try_browser=False)
    except Exception as e:
        text, err = None, str(e)[:80]

    # 如果 HTTP fetch 失败，尝试 Chromium 浏览器模式
    if not text:
        try:
            text, err = fetch_page(url, try_browser=True)
        except Exception as e:
            text, err = None, str(e)[:80]

    # 如果还是失败，尝试搜索引擎兜底
    if not text and name:
        needed = []
        if not only_missing and not has_city:
            needed.append("city")
        if not only_city:
            if not has_phone:
                needed.append("phone")
            if not has_email:
                needed.append("email")
            if not has_desc:
                needed.append("description")
        if needed:
            fb = search_fallback(name, needed)
            if fb:
                if not only_missing and not has_city and "city" in fb:
                    pass  # 在下面统一写入
                if fb:
                    sql = "UPDATE customer_pool SET " + ", ".join(f"{k}=?" for k in fb) + " WHERE customer_id=?"
                    conn.execute(sql, list(fb.values()) + [cid])
                    conn.commit()
                    found = ", ".join(f"{k}={v[:15]}" for k, v in fb.items())
                    return True, f"搜索:{found}"

    if not text:
        return False, err or "获取失败"

    parser = TextExtractor()
    try:
        parser.feed(text)
    except Exception:
        pass
    page_text = parser.get_text()
    meta = parser.meta_desc

    updates = {}
    if not only_missing and not has_city:
        c = extract_city(page_text)
        if c:
            updates["city"] = c
    if not only_city:
        if not has_phone:
            p = extract_phone(page_text)
            if p:
                updates["phone"] = p
        if not has_email:
            e = extract_email(page_text)
            if e:
                updates["email"] = e
        if not has_desc:
            d = extract_description(page_text, meta)
            if d:
                updates["description"] = d
        if not has_prod:
            pr = extract_products(page_text)
            if pr:
                updates["products"] = pr

    if updates:
        sql = "UPDATE customer_pool SET " + ", ".join(f"{k}=?" for k in updates) + " WHERE customer_id=?"
        conn.execute(sql, list(updates.values()) + [cid])
        conn.commit()

    found = ", ".join(f"{k}={v[:15]}" for k, v in updates.items())
    return bool(updates), found or "未提取到"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--only-city", action="store_true")
    ap.add_argument("--only-missing", action="store_true")
    args = ap.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    db = conn.cursor()

    target = "(length(trim(city)) = 0 OR length(trim(description)) = 0 OR length(trim(products)) = 0 OR length(trim(phone)) = 0 OR length(trim(email)) = 0)"
    if args.only_city:
        target = "length(trim(city)) = 0"
    if args.only_missing:
        target = "(length(trim(description)) = 0 OR length(trim(products)) = 0 OR length(trim(phone)) = 0 OR length(trim(email)) = 0)"

    where = target
    if args.resume:
        where += " AND length(trim(city)) = 0"

    cols = ("customer_id, company_name, website, "
            "CASE WHEN length(trim(city))>0 THEN 1 ELSE 0 END, "
            "CASE WHEN length(trim(description))>0 THEN 1 ELSE 0 END, "
            "CASE WHEN length(trim(products))>0 THEN 1 ELSE 0 END, "
            "CASE WHEN length(trim(phone))>0 THEN 1 ELSE 0 END, "
            "CASE WHEN length(trim(email))>0 THEN 1 ELSE 0 END")
    sql = f"SELECT {cols} FROM customer_pool WHERE {where} ORDER BY customer_id"
    if args.limit:
        sql += f" LIMIT {args.limit}"
    rows = db.execute(sql).fetchall()
    conn.close()

    if not rows:
        print("✅ 没有需要补充的记录")
        return

    print(f"📋 待处理: {len(rows)} 条")

    if args.dry_run:
        for r in rows:
            missing = []
            for l, v in [("city", r[3]), ("description", r[4]), ("products", r[5]), ("phone", r[6]), ("email", r[7])]:
                if not v:
                    missing.append(l)
            print(f"  {r['customer_id']} {r['company_name'][:25]:25s} | {', '.join(missing)}")
        print(f"\n共 {len(rows)} 条")
        return

    conn = sqlite3.connect(str(DB_PATH))
    ok, fail = 0, 0

    try:
        for i, row in enumerate(rows, 1):
            succ, msg = process(conn, row, args.only_city, args.only_missing)
            if succ:
                ok += 1
            else:
                fail += 1

            name = (row["company_name"] or "")[:20]
            icon = "✅" if succ else "❌"
            print(f"  [{i}/{len(rows)}] {icon} {row['customer_id']} {name:20s} | {msg}")
            time.sleep(args.delay)
    finally:
        conn.close()

    print(f"\n📊 成功 {ok}, 失败 {fail}, 共 {len(rows)}")


if __name__ == "__main__":
    main()

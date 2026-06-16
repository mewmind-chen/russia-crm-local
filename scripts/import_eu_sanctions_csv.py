#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "crm.db"
DEFAULT_CSV = Path("/Users/ylf/workspace/EU_Sanctions_2026-04-23.csv")
RISK_MARK = "EU Sanctions CSV"
TAG_CATEGORY = "名单标签"
TAG_NAMES = ("制裁",)
TAG_COLOR = "#b42318"


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def today_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def clean_text(value: str) -> str:
    text = str(value or "").strip()
    return re.sub(r"\s+", " ", text)


def clean_digits(value: str) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def extract_domain(website: str) -> str:
    text = clean_text(website)
    if not text:
        return ""
    parsed = urlparse(text if "://" in text else f"https://{text}")
    host = (parsed.netloc or parsed.path or "").lower().strip()
    if ":" in host:
        host = host.split(":", 1)[0]
    return host.lstrip("www.")


def summarize_reason(row: dict[str, str]) -> str:
    parts = [
        clean_text(row.get("reason", "")),
        clean_text(row.get("function", "")),
        clean_text(row.get("address", "")),
    ]
    text = " | ".join(part for part in parts if part)
    return text[:1200]


def merged_risk_status(existing: str) -> str:
    current = clean_text(existing)
    if RISK_MARK in current:
        return current
    if not current:
        return f"🔴 已标记制裁｜{RISK_MARK}"
    if "已标记制裁" in current:
        return f"{current}｜{RISK_MARK}"
    return f"{current}｜{RISK_MARK}"


def merged_notes(existing: str, row: dict[str, str], source_name: str) -> str:
    marker = f"[{source_name} #{clean_text(row.get('number', ''))}]"
    current = str(existing or "").strip()
    if marker and marker in current:
        return current
    reason = summarize_reason(row)
    reg_number = clean_text(row.get("reg_number", ""))
    tax_id = clean_digits(row.get("tax_id", ""))
    bits = [marker]
    if reg_number:
        bits.append(f"reg={reg_number}")
    if tax_id:
        bits.append(f"tax_id={tax_id}")
    if reason:
        bits.append(reason)
    note = " ".join(bit for bit in bits if bit)
    if not current:
        return note
    return f"{current}\n{note}"


def next_customer_id(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT MAX(CAST(SUBSTR(customer_id, 4) AS INTEGER)) FROM customer_pool WHERE customer_id LIKE 'RU-%'"
    ).fetchone()
    return int(row[0] or 0) + 1


def ensure_tags(conn: sqlite3.Connection) -> list[int]:
    now = now_text()
    ids: list[int] = []
    for name in TAG_NAMES:
        conn.execute(
            """
            INSERT INTO tags (name, category, color, is_preset, created_at)
            VALUES (?, ?, ?, 0, ?)
            ON CONFLICT(category, name) DO UPDATE SET color = excluded.color
            """,
            (name, TAG_CATEGORY, TAG_COLOR, now),
        )
        row = conn.execute(
            "SELECT id FROM tags WHERE category = ? AND name = ?",
            (TAG_CATEGORY, name),
        ).fetchone()
        if row:
            ids.append(int(row["id"] if isinstance(row, sqlite3.Row) else row[0]))
    return ids


def attach_tags(conn: sqlite3.Connection, customer_id: str, tag_ids: list[int]) -> None:
    now = now_text()
    for tag_id in tag_ids:
        conn.execute(
            "INSERT OR IGNORE INTO customer_tags (customer_id, tag_id, created_at) VALUES (?, ?, ?)",
            (customer_id, tag_id, now),
        )


def find_existing(conn: sqlite3.Connection, inn: str, reg_number: str, website: str, company_name: str):
    if inn:
        row = conn.execute("SELECT * FROM customer_pool WHERE inn = ? LIMIT 1", (inn,)).fetchone()
        if row:
            return row
    if reg_number:
        row = conn.execute(
            "SELECT * FROM customer_pool WHERE notes LIKE ? OR source_file LIKE ? LIMIT 1",
            (f"%reg={reg_number}%", "%EU_Sanctions%"),
        ).fetchone()
        if row and clean_text(row["company_name"]).casefold() == clean_text(company_name).casefold():
            return row
    if website:
        domain = extract_domain(website)
        if domain:
            row = conn.execute(
                "SELECT * FROM customer_pool WHERE lower(domain) = ? OR lower(website) = ? LIMIT 1",
                (domain, website.lower()),
            ).fetchone()
            if row:
                return row
    if company_name:
        row = conn.execute(
            "SELECT * FROM customer_pool WHERE lower(company_name) = lower(?) OR lower(english_name) = lower(?) LIMIT 1",
            (company_name, company_name),
        ).fetchone()
        if row:
            return row
    return None


def import_rows(csv_path: Path, db_path: Path, dry_run: bool) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    stats = {"scanned": 0, "eligible": 0, "inserted": 0, "updated": 0, "skipped": 0}
    source_name = csv_path.name
    rows = list(csv.DictReader(csv_path.read_text(encoding="utf-8-sig").splitlines()))
    next_id = next_customer_id(conn)
    tag_ids = ensure_tags(conn)
    today = today_key()
    now = now_text()

    insert_sql = """
        INSERT INTO customer_pool (
          customer_id, domain, company_name, russian_name, english_name,
          country, city, website, industry, customer_type,
          description, products, rating, current_pool,
          phone, email, inn, risk_status, website_verification,
          contact_count, deep_report, source_file,
          first_found, last_found, search_count, verified, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    for row in rows:
        stats["scanned"] += 1
        row_type = clean_text(row.get("type", ""))
        country = clean_text(row.get("country", ""))
        if row_type.lower() != "entity" or country.lower() != "russia":
            stats["skipped"] += 1
            continue
        stats["eligible"] += 1
        company_name = clean_text(row.get("name", ""))
        inn = clean_digits(row.get("tax_id", ""))
        reg_number = clean_text(row.get("reg_number", ""))
        website = clean_text(row.get("website", ""))
        domain = extract_domain(website)
        existing = find_existing(conn, inn, reg_number, website, company_name)

        if existing:
            new_risk = merged_risk_status(existing["risk_status"])
            new_notes = merged_notes(existing["notes"], row, source_name)
            updates = {
                "risk_status": new_risk,
                "notes": new_notes,
                "last_found": today,
                "source_file": source_name,
            }
            if not clean_text(existing["inn"]) and inn:
                updates["inn"] = inn
            if not clean_text(existing["website"]) and website:
                updates["website"] = website
            if not clean_text(existing["domain"]) and domain:
                updates["domain"] = domain
            if not clean_text(existing["english_name"]) and company_name:
                updates["english_name"] = company_name
            if not clean_text(existing["country"]):
                updates["country"] = "Russia"
            if clean_text(existing["industry"]) == "制裁名单实体":
                updates["industry"] = ""
            if not clean_text(existing["description"]):
                updates["description"] = summarize_reason(row)
            if not clean_text(existing["search_count"]):
                updates["search_count"] = "1"

            if not dry_run:
                fields = ", ".join(f"{key} = ?" for key in updates)
                conn.execute(
                    f"UPDATE customer_pool SET {fields} WHERE customer_id = ?",
                    (*updates.values(), existing["customer_id"]),
                )
                attach_tags(conn, existing["customer_id"], tag_ids)
            stats["updated"] += 1
            continue

        customer_id = f"RU-{next_id:04d}"
        next_id += 1
        payload = (
            customer_id,
            domain,
            company_name,
            "",
            company_name,
            "Russia",
            "",
            website,
            "",
            "待确认",
            summarize_reason(row),
            "",
            "C",
            "未分池",
            clean_text(row.get("phone", "")),
            clean_text(row.get("email", "")),
            inn,
            f"🔴 已标记制裁｜{RISK_MARK}",
            "",
            "0",
            "",
            source_name,
            today,
            today,
            "1",
            "",
            merged_notes("", row, source_name),
        )
        if not dry_run:
            conn.execute(insert_sql, payload)
            attach_tags(conn, customer_id, tag_ids)
        stats["inserted"] += 1

    if dry_run:
        conn.rollback()
    else:
        conn.commit()
    conn.close()
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Russian entity rows from an EU sanctions CSV into CRM customer_pool.")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to EU sanctions CSV export.")
    parser.add_argument("--db", default=str(DB_PATH), help="Path to crm.db.")
    parser.add_argument("--dry-run", action="store_true", help="Preview inserts/updates without writing.")
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser()
    db_path = Path(args.db).expanduser()
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")

    stats = import_rows(csv_path, db_path, args.dry_run)
    print(
        f"scanned={stats['scanned']} eligible={stats['eligible']} "
        f"inserted={stats['inserted']} updated={stats['updated']} skipped={stats['skipped']} dry_run={args.dry_run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

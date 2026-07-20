#!/usr/bin/env python3
"""Convert existing recon Markdown reports into worker-rendered HTML reports."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "crm.db"
WORKER_PATH = ROOT / "scripts" / "recon_agent_worker.py"


def load_worker_module():
    spec = importlib.util.spec_from_file_location("recon_agent_worker", WORKER_PATH)
    if not spec or not spec.loader:
        raise RuntimeError(f"Cannot load worker module: {WORKER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    placeholders = {
        "-", "—", "N/A", "n/a", "None", "null", "未找到", "未获取", "未知",
        "未查到", "未提供", "待确认", "未验证", "не указан", "не указано",
        "нет данных", "не найдено",
    }
    return "" if text.lower() in {p.lower() for p in placeholders} else text


def should_fill(existing: Any, incoming: Any) -> bool:
    current = clean(existing)
    value = clean(incoming)
    if not value:
        return False
    return current in ("", "-", "待确认", "未验证")


def update_table(conn: sqlite3.Connection, table: str, key_col: str, key_value: str, values: dict[str, Any], *, fill_only: bool = False) -> int:
    row = conn.execute(f"SELECT * FROM {table} WHERE {key_col} = ?", (key_value,)).fetchone()
    if not row:
        return 0
    columns = {item["name"] for item in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    assignments: list[str] = []
    params: list[Any] = []
    for column, value in values.items():
        if column not in columns or column == key_col:
            continue
        text = clean(value)
        if column != "sanctioned" and not text:
            continue
        if fill_only and column != "deep_report" and not should_fill(row[column], text):
            continue
        assignments.append(f"{column} = ?")
        if column == "sanctioned":
            params.append("true" if str(value).lower() in ("true", "1", "yes") or value is True else "false")
        else:
            params.append(text)
    if not assignments:
        return 0
    params.append(key_value)
    conn.execute(f"UPDATE {table} SET {', '.join(assignments)} WHERE {key_col} = ?", params)
    return 1


def convert_report(conn: sqlite3.Connection, worker: Any, row: sqlite3.Row, dry_run: bool = False, render_only: bool = False) -> tuple[bool, str]:
    report_path = clean(row["report_path"])
    if not report_path or report_path.startswith(("http://", "https://")):
        return False, f"skip {row['job_id']}: non-local report path"
    md_path = Path(report_path).expanduser()
    if md_path.suffix.lower() in (".html", ".htm"):
        same_dir_md = md_path.with_name("report.md")
        if same_dir_md.exists():
            md_path = same_dir_md
        else:
            try:
                artifact_path = clean(json.loads(row["artifacts_json"] or "{}").get("report_md"))
            except json.JSONDecodeError:
                artifact_path = ""
            if artifact_path:
                md_path = Path(artifact_path).expanduser()
    if md_path.suffix.lower() not in (".md", ".markdown"):
        return False, f"skip {row['job_id']}: no markdown source"
    if not md_path.exists():
        return False, f"skip {row['job_id']}: missing {md_path}"

    job = conn.execute("SELECT * FROM recon_jobs WHERE job_id = ?", (row["job_id"],)).fetchone()
    pool = conn.execute("SELECT * FROM customer_pool WHERE customer_id = ?", (row["customer_id"],)).fetchone()
    job_dict = dict(job) if job else {}
    if pool:
        pool_dict = dict(pool)
        for key in ("customer_id", "company_name", "website", "domain", "inn", "source_file"):
            if not clean(job_dict.get(key)) and clean(pool_dict.get(key)):
                job_dict[key] = pool_dict[key]
    for key in ("job_id", "customer_id", "company_name", "website"):
        if not clean(job_dict.get(key)):
            job_dict[key] = row[key] if key in row.keys() else ""

    report_markdown = md_path.read_text(encoding="utf-8")
    html_path = md_path.with_name("report.html")
    result, evidence = worker.build_payload_from_report(job_dict, report_markdown, html_path)
    if render_only:
        # A render-only pass must not silently downgrade fields already validated
        # and stored by the CRM. Use the stored result as the authority, while
        # retaining newly derived values only for columns that are still empty.
        for key, value in dict(row).items():
            if clean(value):
                result[key] = value
        stored_evidence = conn.execute(
            "SELECT * FROM recon_evidence WHERE job_id = ? ORDER BY id",
            (row["job_id"],),
        ).fetchall()
        if stored_evidence:
            evidence = [dict(item) for item in stored_evidence]
    result["customer_id"] = clean(row["customer_id"])
    if pool:
        pool_dict = dict(pool)
        for key in (
            "company_name", "russian_name", "english_name", "country", "city", "website",
            "industry", "customer_type", "description", "products", "rating", "current_pool",
            "phone", "email", "inn", "risk_status", "website_verification", "contact_count", "notes",
        ):
            pool_value = clean(pool_dict.get(key))
            result_value = clean(result.get(key))
            if key == "phone" and pool_value and (not result_value or len(pool_value) > len(result_value)):
                result[key] = pool_dict[key]
            elif not result_value and pool_value:
                result[key] = pool_dict[key]
        if not clean(result.get("recommended_products")) and clean(pool_dict.get("products")):
            result["recommended_products"] = pool_dict["products"]
    html_report = worker.render_html_report(job_dict, result, evidence, report_markdown, html_path)

    if dry_run:
        return True, f"dry-run {row['job_id']}: {html_path}"

    html_path.write_text(html_report, encoding="utf-8")
    if render_only:
        return True, f"rendered {row['job_id']}: {html_path}"

    artifacts = {
        "report_html": str(html_path),
        "report_md": str(md_path),
    }
    recon_values = {
        "report_path": str(html_path),
        "artifacts_json": json.dumps(artifacts, ensure_ascii=False),
        "evidence_count": str(len(evidence)),
        "updated_at": now_text(),
        "customer_type": result.get("customer_type"),
        "score": result.get("score") or result.get("rating"),
        "priority": result.get("priority"),
        "compliance_status": result.get("compliance_status"),
        "sanctioned": result.get("sanctioned"),
        "sanction_source": result.get("sanction_source"),
        "sanction_program": result.get("sanction_program"),
        "sanction_checked_at": result.get("sanction_checked_at"),
        "evidence_url": result.get("evidence_url"),
        "opportunity_summary": result.get("opportunity_summary"),
        "contacts_summary": result.get("contacts_summary"),
        "recommended_products": result.get("recommended_products"),
        "outreach_angle": result.get("outreach_angle"),
        "next_action": result.get("next_action"),
    }
    update_table(conn, "recon_results", "job_id", row["job_id"], recon_values)

    pool_values = {
        "deep_report": str(html_path),
        "company_name": result.get("company_name"),
        "russian_name": result.get("russian_name"),
        "english_name": result.get("english_name"),
        "country": result.get("country"),
        "city": result.get("city"),
        "website": result.get("website"),
        "industry": result.get("industry"),
        "customer_type": result.get("customer_type"),
        "description": result.get("description"),
        "products": result.get("products") or result.get("recommended_products"),
        "rating": result.get("rating") or result.get("score"),
        "current_pool": result.get("current_pool"),
        "phone": result.get("phone"),
        "email": result.get("email"),
        "inn": result.get("inn"),
        "risk_status": result.get("risk_status") or result.get("compliance_status"),
        "website_verification": result.get("website_verification"),
        "contact_count": result.get("contact_count"),
        "notes": result.get("notes"),
    }
    if row["customer_id"]:
        update_table(conn, "customer_pool", "customer_id", row["customer_id"], pool_values, fill_only=True)
    return True, f"converted {row['job_id']}: {html_path}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert existing recon Markdown reports to HTML.")
    parser.add_argument("--db", default=str(DB_PATH), help="SQLite CRM database path")
    parser.add_argument("--job-id", action="append", default=[], help="Only convert the given job id; can be repeated")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--render-only", action="store_true", help="Rewrite report.html files without updating database rows")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    worker = load_worker_module()
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    try:
        if args.job_id:
            placeholders = ",".join("?" for _ in args.job_id)
            rows = conn.execute(f"SELECT * FROM recon_results WHERE job_id IN ({placeholders})", args.job_id).fetchall()
        else:
            rows = conn.execute("SELECT * FROM recon_results ORDER BY updated_at DESC").fetchall()
        converted = 0
        for row in rows:
            ok, message = convert_report(conn, worker, row, args.dry_run, args.render_only)
            print(message)
            converted += int(ok)
        if not args.dry_run:
            conn.commit()
        print(f"done: {converted}/{len(rows)} report(s)")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

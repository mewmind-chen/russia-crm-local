"""
SQLite 存储层
公司数据的读写与去重管理
"""

import sqlite3
import json
from pathlib import Path

try:
    from loguru import logger
except ImportError:
    class _FallbackLogger:
        def info(self, msg): print(msg)
        def warning(self, msg): print(msg)
        def error(self, msg): print(msg)
        def exception(self, msg): print(msg)
    logger = _FallbackLogger()

DB_PATH = Path(__file__).parent.parent.parent / "data" / "companies.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS companies (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            inn         TEXT,
            city        TEXT,
            region      TEXT,
            address     TEXT,
            phone       TEXT,
            email       TEXT,
            website     TEXT,
            employees   TEXT,
            description TEXT,
            source      TEXT,
            source_url  TEXT,
            customer_level TEXT DEFAULT 'C',
            recon_status   TEXT DEFAULT 'pending',
            raw_data    TEXT,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name, source)
        );

        CREATE TABLE IF NOT EXISTS scrape_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            source     TEXT,
            url        TEXT UNIQUE,
            status     TEXT,
            count      INTEGER DEFAULT 0,
            scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()
    logger.info(f"✅ 数据库已初始化: {DB_PATH}")

def _none_if_blank(v):
    if v is None:
        return None
    if isinstance(v, str):
        vv = v.strip()
        return vv if vv != "" else None
    return v


def upsert_company(data: dict) -> bool:
    """插入或更新公司记录，返回是否为新记录"""
    conn = get_conn()
    try:
        name = (data.get("name") or "").strip()
        source = (data.get("source") or "").strip()
        if not name or not source:
            return False

        existed = conn.execute(
            "SELECT 1 FROM companies WHERE name=? AND source=? LIMIT 1",
            (name, source),
        ).fetchone() is not None

        raw = json.dumps(data, ensure_ascii=False)
        conn.execute("""
            INSERT INTO companies (name, inn, city, region, address, phone, email,
                website, employees, description, source, source_url, raw_data)
            VALUES (:name, :inn, :city, :region, :address, :phone, :email,
                :website, :employees, :description, :source, :source_url, :raw_data)
            ON CONFLICT(name, source) DO UPDATE SET
                phone       = COALESCE(NULLIF(excluded.phone, ''), phone),
                email       = COALESCE(NULLIF(excluded.email, ''), email),
                website     = COALESCE(NULLIF(excluded.website, ''), website),
                city        = COALESCE(NULLIF(excluded.city, ''), city),
                region      = COALESCE(NULLIF(excluded.region, ''), region),
                address     = COALESCE(NULLIF(excluded.address, ''), address),
                employees   = COALESCE(NULLIF(excluded.employees, ''), employees),
                description = COALESCE(NULLIF(excluded.description, ''), description),
                raw_data    = excluded.raw_data
        """, {
            "name":        name,
            "inn":         _none_if_blank(data.get("inn")),
            "city":        _none_if_blank(data.get("city")),
            "region":      _none_if_blank(data.get("region")),
            "address":     _none_if_blank(data.get("address")),
            "phone":       _none_if_blank(data.get("phone")),
            "email":       _none_if_blank(data.get("email")),
            "website":     _none_if_blank(data.get("website")),
            "employees":   _none_if_blank(data.get("employees")),
            "description": _none_if_blank(data.get("description")),
            "source":      source,
            "source_url":  _none_if_blank(data.get("source_url")),
            "raw_data":    raw,
        })
        conn.commit()
        return not existed
    finally:
        conn.close()


def log_url(source: str, url: str, status: str, count: int = 0):
    conn = get_conn()
    conn.execute("""
        INSERT INTO scrape_log (source, url, status, count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET status=excluded.status, count=excluded.count
    """, (source, url, status, count))
    conn.commit()
    conn.close()


def url_done(url: str) -> bool:
    conn = get_conn()
    row = conn.execute(
        "SELECT id FROM scrape_log WHERE url=? AND status='done'", (url,)
    ).fetchone()
    conn.close()
    return row is not None


def get_stats() -> dict:
    conn = get_conn()
    total = conn.execute("SELECT COUNT(*) FROM companies").fetchone()[0]
    by_source = conn.execute(
        "SELECT source, COUNT(*) as cnt FROM companies GROUP BY source ORDER BY cnt DESC"
    ).fetchall()
    conn.close()
    return {"total": total, "by_source": [dict(r) for r in by_source]}

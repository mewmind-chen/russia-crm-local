#!/usr/bin/env python3
"""Render a Codex-produced recon Markdown report to the existing HTML style."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "crm.db"
WORKER_PATH = ROOT / "scripts" / "recon_agent_worker.py"


def load_worker_module() -> Any:
    spec = importlib.util.spec_from_file_location("recon_agent_worker", WORKER_PATH)
    if not spec or not spec.loader:
        raise RuntimeError(f"Cannot load worker module: {WORKER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def get_job(job_id: str) -> dict[str, Any]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM recon_jobs WHERE job_id = ?", (job_id,)).fetchone()
        if not row:
            return {"job_id": job_id}
        return dict(row)
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Codex recon report HTML")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--result-file", required=True)
    parser.add_argument("--evidence-file", required=True)
    parser.add_argument("--report-file", required=True)
    parser.add_argument("--html-file", required=True)
    args = parser.parse_args()

    result_path = (ROOT / args.result_file).resolve()
    evidence_path = (ROOT / args.evidence_file).resolve()
    report_path = (ROOT / args.report_file).resolve()
    html_path = (ROOT / args.html_file).resolve()

    result = read_json(result_path)
    evidence = read_json(evidence_path)
    if not isinstance(result, dict):
        raise ValueError("result-file must contain a JSON object")
    if not isinstance(evidence, list):
        raise ValueError("evidence-file must contain a JSON array")

    markdown = report_path.read_text(encoding="utf-8")
    worker = load_worker_module()
    job = get_job(args.job_id)
    html = worker.render_html_report(job, result, evidence, markdown, html_path)
    html_path.write_text(html, encoding="utf-8")
    print(str(html_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

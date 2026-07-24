#!/usr/bin/env python3
"""Claim Contact Recon jobs, run Hermes, validate JSON, and submit to CRM."""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

DEFAULT_URL = "http://127.0.0.1:3000/api/contact-recon"
DEFAULT_HERMES = "/Users/ylf/.hermes/hermes-agent/venv/bin/hermes"
DEFAULT_SKILL = "russia-contact-recon"


class JobCancelled(RuntimeError):
    pass


def ensure_active(response: dict[str, Any]) -> dict[str, Any]:
    if response.get("cancel_requested"):
        raise JobCancelled("Contact Recon job cancellation requested")
    return response


def load_dotenv(path: Path) -> None:
    if not path.exists(): return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        key, value = line.split("=", 1)
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = value.strip().strip('"').strip("'")


def post_json(url: str, token: str, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = {"action": action, "token": token, **(payload or {})}
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        try: detail = exc.read().decode("utf-8", errors="replace")
        except Exception: detail = ""
        raise RuntimeError(f"Contact Recon API {action} failed: HTTP {exc.code}: {detail[:2000]}") from exc
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Contact Recon API {action} failed: {exc}") from exc
    if not result.get("ok"): raise RuntimeError(result.get("error") or f"Contact Recon API {action} returned ok=false")
    return result


def safe_name(value: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "-" for c in str(value))[:100]


def build_prompt(job: dict[str, Any]) -> str:
    roles = json.loads(job.get("target_roles_json") or "[]")
    return f"""
Use the `{DEFAULT_SKILL}` skill. Perform contact-first public OSINT for this B2B lead.

job_id: {job['job_id']}
customer_id: {job['customer_id']}
company_name: {job.get('company_name','')}
website: {job.get('website','')}
company_identifier: {job.get('inn','')}
target_roles: {json.dumps(roles, ensure_ascii=False)}

The only success condition is a verifiable responsible person. Do not spend tokens rewriting a general company report.
Search procurement documents/PDFs, official news/team pages, job postings, exhibitions, conferences,
patents/publications, and public professional/social profiles. Verify person-company-title and contact separately.

Return exactly one fenced JSON object first, schema_version `contact-recon-v1`, with:
- job_id/customer_id exactly as above
- target_roles
- people[]: person_id, full_name, full_name_local, title, department, role_category, decision_role,
  employment{{status,confidence,evidence_ids}}, methods[], contact_level, sales_ready, quality_issues
- each method: type, value, discovery_type, verification_status, is_direct, is_generic, is_inferred, source_url, evidence_ids
- company_entry_points[] for generic mailboxes, switchboards, forms, bots, or company social accounts
- evidence[]: evidence_id, person_id, evidence_type, field_name, value, source_url, source_title,
  source_date, checked_at, confidence, supports_current_employment, supports_decision_role
- search_gaps[] and recommended_next_searches[]

Hard rules: titles are not names; empty people is valid; every evidence row needs a public URL;
generic contacts are never direct person contacts; inferred emails are never claimed as publicly verified.
After JSON, provide only a concise Chinese summary of who was found and what remains missing.
""".strip()


def extract_json(text: str) -> dict[str, Any]:
    matches = re.findall(r"```(?:json|JSON)\s*([\s\S]*?)\s*```", text or "")
    for candidate in matches:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict) and value.get("schema_version") == "contact-recon-v1": return value
        except json.JSONDecodeError: pass
    raise ValueError("Hermes output did not contain a valid contact-recon-v1 JSON object")


def normalize_result(value: dict[str, Any]) -> dict[str, Any]:
    """Normalize harmless model vocabulary drift; the CRM still recalculates every level."""
    decision_map = {
        "ultimate_decision_maker": "decision_maker", "operator": "influencer",
        "gatekeeper": "entry", "contact": "entry",
    }
    verification_map = {
        "verified_public": "verified", "public_verified": "verified",
        "unverified_for_person": "unverified", "probable": "likely_valid",
    }
    confidence_map = {"low": 30, "medium": 60, "high": 90}
    role_map = {"owner": "executive", "management": "executive", "sales": "commercial", "purchasing": "procurement", "procurement_manager": "procurement"}
    allowed_roles = {"procurement", "supply_chain", "technical", "engineering", "production", "commercial", "executive", "unknown"}
    allowed_decisions = {"decision_maker", "influencer", "information_source", "entry", "unknown"}
    value["people"] = value.get("people") if isinstance(value.get("people"), list) else []
    value["evidence"] = value.get("evidence") if isinstance(value.get("evidence"), list) else []
    value["company_entry_points"] = value.get("company_entry_points") if isinstance(value.get("company_entry_points"), list) else []
    value["target_roles"] = value.get("target_roles") if isinstance(value.get("target_roles"), list) else []
    value["search_gaps"] = value.get("search_gaps") if isinstance(value.get("search_gaps"), list) else []
    value["recommended_next_searches"] = value.get("recommended_next_searches") if isinstance(value.get("recommended_next_searches"), list) else []
    clean_evidence, evidence_ids = [], set()
    for index, item in enumerate(value["evidence"]):
        if not isinstance(item, dict) or not str(item.get("source_url") or "").strip(): continue
        evidence_id = str(item.get("evidence_id") or f"E{index + 1}").strip()
        if evidence_id in evidence_ids: evidence_id = f"{evidence_id}-{index + 1}"
        evidence_ids.add(evidence_id); item["evidence_id"] = evidence_id
        item["confidence"] = item.get("confidence") if item.get("confidence") in {"low", "medium", "high"} else "medium"
        clean_evidence.append(item)
    value["evidence"] = clean_evidence
    clean_people = []
    for index, person in enumerate(value["people"]):
        if not isinstance(person, dict): continue
        person["person_id"] = str(person.get("person_id") or f"P{index + 1}")
        person["full_name"] = str(person.get("full_name") or person.get("full_name_local") or "").strip()
        name_words = person["full_name"].split()
        role_only = {"director","manager","owner","ceo","负责人","经理","总经理","директор","менеджер","руководитель","начальник"}
        if (len(name_words) < 2 or len(name_words) > 5 or any(mark in person["full_name"] for mark in "|｜:：—–") or person["full_name"].lower() in role_only):
            person["full_name"] = ""
        person["title"] = str(person.get("title") or "").strip()
        person["role_category"] = role_map.get(person.get("role_category"), person.get("role_category", "unknown"))
        if person["role_category"] not in allowed_roles: person["role_category"] = "unknown"
        person["decision_role"] = decision_map.get(person.get("decision_role"), person.get("decision_role", "unknown"))
        if person["decision_role"] not in allowed_decisions: person["decision_role"] = "unknown"
        employment = person.setdefault("employment", {})
        employment["status"] = employment.get("status") if employment.get("status") in {"verified_current","likely_current","historical","left_company","unverified","conflicting"} else "unverified"
        confidence = employment.get("confidence", 0)
        if isinstance(confidence, str): employment["confidence"] = confidence_map.get(confidence.lower(), 0)
        employment["confidence"] = max(0, min(100, int(employment.get("confidence") or 0)))
        employment["evidence_ids"] = employment.get("evidence_ids") if isinstance(employment.get("evidence_ids"), list) else []
        methods = []
        for method in person.get("methods") or []:
            if not isinstance(method, dict) or not str(method.get("value") or "").strip(): continue
            method["value"] = str(method["value"]).strip()
            method["verification_status"] = verification_map.get(method.get("verification_status"), method.get("verification_status", "unverified"))
            if method["verification_status"] not in {"verified","likely_valid","unverified","invalid","risky","expired"}: method["verification_status"] = "unverified"
            method["discovery_type"] = method.get("discovery_type") or "manual"
            method["is_inferred"] = bool(method.get("is_inferred")) or method["discovery_type"] == "pattern_inferred"
            if method["is_inferred"]: method["discovery_type"] = "pattern_inferred"
            method["is_generic"] = bool(method.get("is_generic")); method["is_direct"] = bool(method.get("is_direct")) and not method["is_generic"]
            method["evidence_ids"] = method.get("evidence_ids") if isinstance(method.get("evidence_ids"), list) else []
            methods.append(method)
        person["methods"] = methods
        person["contact_level"] = person.get("contact_level") if person.get("contact_level") in {"L0","L1","L2","L3"} else "L0"
        person["sales_ready"] = bool(person.get("sales_ready")); person["quality_issues"] = person.get("quality_issues") if isinstance(person.get("quality_issues"), list) else []
        clean_people.append(person)
    value["people"] = clean_people
    return value


def extract_result(stdout: str, output: Path) -> dict[str, Any]:
    try:
        return normalize_result(extract_json(stdout))
    except ValueError as stdout_error:
        # Hermes may use its file tool even when asked for fenced JSON. Accept only the
        # known run-local file and still pass the same server-side contract checks.
        candidates = sorted(output.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        for candidate in candidates:
            try:
                value = json.loads(candidate.read_text(encoding="utf-8"))
                if isinstance(value, dict) and value.get("schema_version") == "contact-recon-v1":
                    return normalize_result(value)
            except (OSError, json.JSONDecodeError):
                pass
        raise stdout_error


def process_job(args: argparse.Namespace, job: dict[str, Any]) -> None:
    root = Path(args.output_dir).expanduser().resolve()
    output = root / f"{datetime.now():%Y%m%d-%H%M%S}-{safe_name(job.get('company_name') or job['job_id'])}-{job['job_id']}"
    output.mkdir(parents=True, exist_ok=True)
    def heartbeat() -> dict[str, Any]:
        return ensure_active(post_json(args.url, args.token, "heartbeatContactReconJob", {
            "job_id": job["job_id"],
            "worker_id": args.worker_id,
            "lease_seconds": args.timeout + 600,
            "output_dir": str(output),
            "stage": "researching",
        }))
    try:
        heartbeat()
        prompt = build_prompt(job)
        (output / "prompt.txt").write_text(prompt, encoding="utf-8")
        command = [args.hermes, "chat", "--query", prompt, "--yolo", "--quiet", "--skills", args.skill]
        process = subprocess.Popen(command, cwd=output, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.monotonic() + args.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                process.kill()
                process.communicate()
                raise subprocess.TimeoutExpired(command, args.timeout)
            try:
                stdout, stderr = process.communicate(timeout=min(30, remaining))
                break
            except subprocess.TimeoutExpired:
                try:
                    heartbeat()
                except Exception:
                    process.terminate()
                    try:
                        process.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate()
                    raise
        (output / "hermes_stdout.txt").write_text(stdout or "", encoding="utf-8")
        (output / "hermes_stderr.log").write_text(stderr or "", encoding="utf-8")
        if process.returncode != 0: raise RuntimeError(f"Hermes exited with {process.returncode}")
        result = extract_result(stdout or "", output)
        result["job_id"] = job["job_id"]
        result["customer_id"] = job["customer_id"]
        (output / "contact-result-v1.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        heartbeat()
        post_json(args.url, args.token, "submitContactReconResult", {"job_id": job["job_id"], "result": result, "output_dir": str(output)})
        print(f"[done] {job['job_id']} -> {output}", flush=True)
    except JobCancelled:
        print(f"[cancelled] {job['job_id']}", flush=True)
        return
    except Exception as exc:
        post_json(args.url, args.token, "failContactReconJob", {"job_id": job["job_id"], "error": str(exc), "output_dir": str(output)})
        raise


def main() -> int:
    load_dotenv(Path(".env"))
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.environ.get("CONTACT_RECON_URL", DEFAULT_URL))
    p.add_argument("--token", default=os.environ.get("RECON_WORKER_TOKEN", ""))
    p.add_argument("--worker-id", default=os.environ.get("CONTACT_RECON_WORKER_ID", f"{socket.gethostname()}-{os.getpid()}"))
    p.add_argument("--output-dir", default=os.environ.get("CONTACT_RECON_OUTPUT_DIR", "contact-recon-runs"))
    p.add_argument("--hermes", default=os.environ.get("HERMES_BIN", DEFAULT_HERMES))
    p.add_argument("--skill", default=os.environ.get("CONTACT_RECON_HERMES_SKILL", DEFAULT_SKILL))
    p.add_argument("--timeout", type=int, default=int(os.environ.get("CONTACT_RECON_TIMEOUT", "1800")))
    p.add_argument("--poll", type=int, default=int(os.environ.get("CONTACT_RECON_POLL_SECONDS", "15")))
    p.add_argument("--once", action="store_true")
    args = p.parse_args()
    if not args.token:
        print("RECON_WORKER_TOKEN is required", file=sys.stderr); return 2
    while True:
        try:
            response = post_json(args.url, args.token, "claimContactReconJob", {"worker_id": args.worker_id, "lease_seconds": args.timeout + 600})
            job = response.get("job")
            if not job:
                if args.once: print("[idle] no contact recon jobs"); return 0
                time.sleep(max(3, args.poll)); continue
            process_job(args, job)
            if args.once: return 0
        except KeyboardInterrupt: return 130
        except Exception as exc:
            print(f"[error] {exc}", file=sys.stderr, flush=True)
            if args.once: return 1
            time.sleep(max(5, args.poll))


if __name__ == "__main__": raise SystemExit(main())

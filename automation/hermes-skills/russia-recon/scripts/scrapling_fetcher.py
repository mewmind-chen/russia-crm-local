#!/usr/bin/env python3
"""scrapling_fetcher.py — Scrapling adapter for russia-recon (v1.0)"""
import time, json, sys
from dataclasses import dataclass, field, asdict
from typing import Optional, Dict, Any

@dataclass
class FetchResult:
    success: bool; url: str; level: str = "fetch"
    content: str = ""; title: str = ""; status_code: int = 0
    elapsed_ms: int = 0; error: Optional[str] = None
    block_type: Optional[str] = None; engine: str = "scrapling"
    metadata: Dict[str, Any] = field(default_factory=dict)
    def to_dict(self): return asdict(self)

PROXY = "http://127.0.0.1:7897"
KL = ["KillBot user verification","kbErrors","kb-captcha"]
CF = ["Checking your browser","cf-browser-verification","cf-challenge"]

def _raw(page):
    """Extract raw content from Scrapling page object."""
    if hasattr(page, "_raw_body") and page._raw_body:
        return page._raw_body.decode(errors="replace") if isinstance(page._raw_body, bytes) else str(page._raw_body)
    return page.css("body").get() or ""

def _detect(h, t=""):
    x = (h+t).lower()
    for s in KL:
        if s.lower() in x: return "killbot"
    for s in CF:
        if s.lower() in x: return "cloudflare"
    if "captcha" in x or "kapcha" in x: return "captcha"
    return None

# ---- Level 1: HTTP ----

def fetch(url, timeout=20, impersonate="chrome", proxy=PROXY, stealthy_headers=True):
    t0=time.time()
    try:
        from scrapling.fetchers import Fetcher
        p = Fetcher.get(url,timeout=timeout,impersonate=impersonate,proxy=proxy,stealthy_headers=stealthy_headers)
        e=int((time.time()-t0)*1000); h=_raw(p); ti=p.css("title::text").get() or ""
        return FetchResult(success=True,url=url,level="fetch",content=h,title=ti,status_code=getattr(p,"status_code",200),elapsed_ms=e,block_type=_detect(h,ti))
    except Exception as ex:
        err=str(ex); e=int((time.time()-t0)*1000)
        if "SSRF" in err or "Redirect to internal IP" in err:
            try:
                from scrapling.fetchers import Fetcher
                p=Fetcher.get(url,timeout=timeout,impersonate=impersonate,stealthy_headers=stealthy_headers)
                h=_raw(p); ti=p.css("title::text").get() or ""
                return FetchResult(success=True,url=url,level="fetch",content=h,title=ti,elapsed_ms=int((time.time()-t0)*1000),metadata={"ssrf_retry":True,"proxyless":True})
            except Exception as e2:
                return FetchResult(success=False,url=url,level="fetch",elapsed_ms=e,error=str(e2)[:200],block_type="ssrf")
        return FetchResult(success=False,url=url,level="fetch",elapsed_ms=e,error=err[:300])

# ---- Level 2: Stealth Browser ----

def stealth_fetch(url, timeout=30, headless=True, solve_cloudflare=True, network_idle=True):
    t0=time.time()
    try:
        from scrapling.fetchers import StealthyFetcher
        p=StealthyFetcher.fetch(url,headless=headless,timeout=timeout*1000,solve_cloudflare=solve_cloudflare,network_idle=network_idle)
        e=int((time.time()-t0)*1000); h=_raw(p); ti=p.css("title::text").get() or ""
        return FetchResult(success=True,url=url,level="stealth",content=h,title=ti,status_code=getattr(p,"status_code",200),elapsed_ms=e,block_type=_detect(h,ti),metadata={"headless":headless,"cf_solved":solve_cloudflare})
    except Exception as ex:
        return FetchResult(success=False,url=url,level="stealth",elapsed_ms=int((time.time()-t0)*1000),error=str(ex)[:300])

# ---- Smart Fetch (auto escalate) ----

def smart_fetch(url, allow_stealth=True, timeout_fast=20, timeout_stealth=30):
    r=fetch(url,timeout=timeout_fast)
    if r.success and not r.block_type: return r
    if not allow_stealth: return r
    r2=stealth_fetch(url,timeout=timeout_stealth)
    r2.metadata["fallback_from"]="fetch"; r2.metadata["fetch_error"]=r.error
    return r2

# ---- Adaptive Parsing ----

def adaptive_select(html, selector, auto_save=False):
    try:
        from scrapling.parser import Selector
        p=Selector(html); els=p.css(selector,adaptive=True,auto_save=auto_save)
        return {"found":len(els)>0,"texts":[e.get() for e in els[:20]],"adaptive_used":True,"count":len(els)}
    except Exception as e:
        return {"found":False,"error":str(e)[:200],"adaptive_used":False}

# ---- Recon-specific ----

def fetch_sanctions(name="", inn=""):
    import urllib.parse
    q=inn if inn else name
    return fetch(f"https://api.opensanctions.org/search/default?q={urllib.parse.quote(q)}&limit=10", timeout=15)

def fetch_rusprofile(inn="", ogrn="", company_name=""):
    if ogrn: url=f"https://www.rusprofile.ru/id/{ogrn}"
    elif inn: url=f"https://www.rusprofile.ru/search?query={inn}"
    else: url=f"https://www.rusprofile.ru/search?query={company_name}"
    return smart_fetch(url)

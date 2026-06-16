"""
统一HTTP客户端
- 随机 User-Agent 轮换
- 可配置延迟 + jitter
- 自动重试（指数退避）
- 统一错误日志
"""

import time
import random
from typing import Optional
from urllib.parse import urljoin
import re
import requests

try:
    from loguru import logger
except ImportError:
    class _FallbackLogger:
        def debug(self, msg): pass
        def info(self, msg): print(msg)
        def warning(self, msg): print(msg)
        def error(self, msg): print(msg)
        def exception(self, msg): print(msg)
    logger = _FallbackLogger()


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]


class HTTPClient:
    def __init__(self, min_delay: float = 1.0, max_delay: float = 3.0, max_retries: int = 3):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.max_retries = max_retries
        self.session = requests.Session()
        # 避免受到系统/环境变量中的代理设置影响
        self.session.trust_env = False

    def _get_headers(self):
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }

    def _sleep(self):
        delay = random.uniform(self.min_delay, self.max_delay)
        logger.debug(f"  等待 {delay:.1f}s...")
        time.sleep(delay)

    def get(self, url: str, params: dict = None, encoding: str = None) -> Optional[requests.Response]:
        for attempt in range(1, self.max_retries + 1):
            try:
                self._sleep()
                resp = self.session.get(
                    url,
                    params=params,
                    headers=self._get_headers(),
                    timeout=15,
                    allow_redirects=True,
                )
                if encoding:
                    resp.encoding = encoding
                if resp.status_code == 200:
                    # 常见反爬：JS 挑战页
                    if "Checking" in resp.text and "hi.php?token=" in resp.text:
                        hi_m = re.search(r'(\\?/hi\\.php\\?token=[^"\\s]+)', resp.text)
                        if hi_m:
                            hi_path = hi_m.group(1).replace("\\/", "/")
                            hi_url = urljoin(resp.url, hi_path)
                            try:
                                logger.debug("  检测到JS挑战页，尝试通过验证…")
                                self.session.get(
                                    hi_url,
                                    headers=self._get_headers(),
                                    timeout=15,
                                    allow_redirects=True,
                                )
                                self._sleep()
                                resp2 = self.session.get(
                                    url,
                                    params=params,
                                    headers=self._get_headers(),
                                    timeout=15,
                                    allow_redirects=True,
                                )
                                if encoding:
                                    resp2.encoding = encoding
                                if resp2.status_code == 200:
                                    if "Checking" in resp2.text and "hi.php?token=" in resp2.text:
                                        logger.warning("  仍返回JS挑战页，疑似需要浏览器验证，跳过")
                                        return None
                                    return resp2
                            except Exception as e:
                                logger.warning(f"  JS挑战绕过失败: {e}")
                        logger.warning("  命中JS挑战页，脚本请求被拦截")
                        return None

                    # KillBot 验证页
                    if "KillBot user verification" in resp.text or "user verification" in resp.text.lower():
                        logger.warning("  命中站点人机验证页（KillBot），脚本请求被拦截")
                        return None
                    return resp
                elif resp.status_code == 429:
                    wait = 60 * attempt
                    logger.warning(f"  被限速 (429)，等待 {wait}s 后重试...")
                    time.sleep(wait)
                elif resp.status_code in (403, 404):
                    logger.warning(f"  HTTP {resp.status_code}: {url}")
                    return None
                else:
                    logger.warning(f"  HTTP {resp.status_code} (尝试 {attempt}/{self.max_retries}): {url}")
            except requests.exceptions.ConnectionError as e:
                logger.error(f"  连接错误 (尝试 {attempt}/{self.max_retries}): {e}")
                time.sleep(5 * attempt)
            except requests.exceptions.Timeout:
                logger.error(f"  超时 (尝试 {attempt}/{self.max_retries}): {url}")
                time.sleep(5 * attempt)
            except Exception as e:
                logger.error(f"  未知错误 (尝试 {attempt}/{self.max_retries}): {e}")
                break
        logger.error(f"  ❌ 放弃: {url}")
        return None

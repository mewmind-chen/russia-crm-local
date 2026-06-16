#!/usr/bin/env python3
"""
russia-recon 统一容错框架 v1.0
来源：Deep Research Agent 工程实践 + Claude Code 工具调用机制
基于：吴师兄《Agent工具调用失败了怎么处理？》(2026-05-12)

四层容错体系：
  1. 统一错误格式 — 所有工具返回 {success, error_type, is_retryable, suggestion}
  2. System_prompt 规则 — 明确的重试/跳过/终止策略
  3. 循环检测 — LoopDetector 防止 token 耗尽
  4. 降级透明 — 信息完整性声明，告知用户缺口

使用：
  from failure_handler import ToolResult, classify_failure, LoopDetector, retry_with_backoff

  # 包装工具调用
  result = ToolResult.from_exception(e)
  
  # 循环检测
  detector = LoopDetector()
  if detector.check(action_dict):
      print("检测到循环，强制换策略！")
"""

import time
import json
import hashlib
import re
from dataclasses import dataclass, field, asdict
from typing import Optional, Any, Literal
from difflib import SequenceMatcher
from enum import Enum


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 统一错误格式
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class ErrorType(Enum):
    """工具失败类型枚举 — 模型可以直接识别"""
    # 临时性失败（可重试）
    TIMEOUT = "TIMEOUT"            # API超时
    RATE_LIMIT = "RATE_LIMIT"      # 频率限制
    SERVER_ERROR = "SERVER_ERROR"  # 500/503
    NETWORK_ERROR = "NETWORK_ERROR"# 网络抖动
    DNS_ERROR = "DNS_ERROR"        # DNS解析失败
    PROXY_ERROR = "PROXY_ERROR"    # 代理不可用
    
    # 确定性失败（不可重试）
    NOT_FOUND = "NOT_FOUND"        # 404
    FORBIDDEN = "FORBIDDEN"        # 403
    UNAUTHORIZED = "UNAUTHORIZED"  # 401
    BAD_REQUEST = "BAD_REQUEST"    # 400
    CAPTCHA = "CAPTCHA"            # 验证码
    BOT_DETECTION = "BOT_DETECTION"# 反爬
    SSL_ERROR = "SSL_ERROR"        # SSL证书错误
    EMPTY_RESULT = "EMPTY_RESULT"  # 返回空（API正常但无数据）
    
    # 语言/编码问题
    ENCODING_ERROR = "ENCODING_ERROR"
    SPASIBO_ERROR = "SPASIBO_ERROR"   # 俄语спасибо字样=真的404
    
    # 引擎问题
    SPA_DETECTED = "SPA_DETECTED"   # SPA网站，lightpanda无法渲染
    ENGINE_TIMEOUT = "ENGINE_TIMEOUT"# 浏览器引擎超时


# 错误类型 → 是否可重试
RETRYABLE_MAP = {
    ErrorType.TIMEOUT: True,
    ErrorType.RATE_LIMIT: True,
    ErrorType.SERVER_ERROR: True,
    ErrorType.NETWORK_ERROR: True,
    ErrorType.DNS_ERROR: True,
    ErrorType.PROXY_ERROR: True,
    
    ErrorType.NOT_FOUND: False,
    ErrorType.FORBIDDEN: False,
    ErrorType.UNAUTHORIZED: False,
    ErrorType.BAD_REQUEST: False,
    ErrorType.CAPTCHA: False,
    ErrorType.BOT_DETECTION: False,
    ErrorType.SSL_ERROR: False,
    ErrorType.EMPTY_RESULT: False,
    ErrorType.ENCODING_ERROR: False,
    ErrorType.SPASIBO_ERROR: False,
    ErrorType.SPA_DETECTED: False,
    ErrorType.ENGINE_TIMEOUT: True,  # 引擎超时可换引擎重试
}


# 错误类型 → 建议操作
SUGGESTION_MAP = {
    ErrorType.TIMEOUT: "尝试缩短搜索词、减少请求量、或换更快的引擎（lightpanda）",
    ErrorType.RATE_LIMIT: "等待60秒后重试，或换IP/代理",
    ErrorType.SERVER_ERROR: "1秒后重试，最多3次指数退避",
    ErrorType.NETWORK_ERROR: "检查代理状态，重试2次",
    ErrorType.DNS_ERROR: "检查DNS设置，尝试直接IP访问",
    ErrorType.PROXY_ERROR: "尝试绕过代理（NO_PROXY）或更换代理节点",
    ErrorType.NOT_FOUND: "不重试。改用搜索引擎间接获取信息，或标注「页面不可达」",
    ErrorType.FORBIDDEN: "不重试。换搜索引擎或依赖rusprofile/OpenSanctions等替代数据源",
    ErrorType.CAPTCHA: "不重试。切换到browser_navigate（绕过反爬）或使用搜索引擎替代",
    ErrorType.BOT_DETECTION: "不重试。启用人机验证绕过方案或换数据源",
    ErrorType.SSL_ERROR: "尝试HTTP协议替代；失败则标注「SSL异常」",
    ErrorType.EMPTY_RESULT: "不重试。标注「未发现数据」，继续下一步",
    ErrorType.SPA_DETECTED: "切换到browser_navigate（完整浏览器渲染），或标注「SPA无法抓取」",
    ErrorType.ENGINE_TIMEOUT: "换引擎重试（lightpanda→browser_navigate 或 vice versa）",
    ErrorType.ENCODING_ERROR: "标注编码问题，尝试指定编码后重试",
    ErrorType.SPASIBO_ERROR: "确认404，不重试。改搜索引擎间接获取",
}


@dataclass
class ToolResult:
    """统一的工具返回格式 — 模型可以识别成功/失败"""
    tool_name: str
    target: str = ""  # URL/搜索词/INN
    success: bool = False
    
    # 成功时
    data: Any = None
    data_summary: str = ""  # 前200字摘要
    
    # 失败时（统一格式）
    error_type: Optional[str] = None      # ErrorType枚举值
    error_message: Optional[str] = None   # 人类可读描述
    is_retryable: Optional[bool] = None   # 是否值得重试
    suggestion: Optional[str] = None      # 给模型的下一步建议
    retry_count: int = 0                  # 已重试次数
    
    # 元信息
    source_url: str = ""
    engine_used: str = ""                 # lightpanda / browser_navigate / curl
    timestamp: float = field(default_factory=time.time)
    
    @classmethod
    def success(cls, tool_name: str, target: str, data: Any, 
                data_summary: str = "", source_url: str = "", 
                engine_used: str = "") -> "ToolResult":
        return cls(
            success=True,
            tool_name=tool_name,
            target=target,
            data=data,
            data_summary=data_summary[:200] if data_summary else "",
            source_url=source_url,
            engine_used=engine_used,
        )
    
    @classmethod
    def failure(cls, tool_name: str, target: str, 
                error_type: ErrorType, error_message: str = "",
                retry_count: int = 0, source_url: str = "",
                engine_used: str = "") -> "ToolResult":
        return cls(
            success=False,
            tool_name=tool_name,
            target=target,
            error_type=error_type.value,
            error_message=error_message,
            is_retryable=RETRYABLE_MAP.get(error_type, False),
            suggestion=SUGGESTION_MAP.get(error_type, ""),
            retry_count=retry_count,
            source_url=source_url,
            engine_used=engine_used,
        )
    
    @classmethod
    def from_exception(cls, tool_name: str, target: str, e: Exception,
                       retry_count: int = 0, engine_used: str = "") -> "ToolResult":
        """从异常自动推断错误类型"""
        error_msg = str(e)
        error_type = cls._classify_exception(e, error_msg)
        return cls.failure(
            tool_name=tool_name,
            target=target,
            error_type=error_type,
            error_message=error_msg,
            retry_count=retry_count,
            engine_used=engine_used,
        )
    
    @staticmethod
    def _classify_exception(e: Exception, msg: str) -> ErrorType:
        msg_lower = msg.lower()
        type_name = type(e).__name__
        
        # Timeout
        if "timeout" in msg_lower or "timed out" in msg_lower:
            return ErrorType.TIMEOUT
        
        # HTTP状态码
        if "404" in msg_lower or "not found" in msg_lower:
            # 俄语спасибо(谢谢)出现在404页面 — 确认真404
            if "спасибо" in msg_lower or "spasibo" in msg_lower:
                return ErrorType.SPASIBO_ERROR
            return ErrorType.NOT_FOUND
        if "403" in msg_lower or "forbidden" in msg_lower:
            return ErrorType.FORBIDDEN
        if "401" in msg_lower or "unauthorized" in msg_lower:
            return ErrorType.UNAUTHORIZED
        if "500" in msg_lower or "502" in msg_lower or "503" in msg_lower:
            return ErrorType.SERVER_ERROR
        
        # 网络
        if "dns" in msg_lower or "name resolution" in msg_lower or "getaddrinfo" in msg_lower:
            return ErrorType.DNS_ERROR
        if "connection" in msg_lower or "refused" in msg_lower:
            return ErrorType.NETWORK_ERROR
        if "proxy" in msg_lower or "tunnel" in msg_lower:
            return ErrorType.PROXY_ERROR
        
        # SSL
        if "ssl" in msg_lower or "certificate" in msg_lower:
            return ErrorType.SSL_ERROR
        
        # 反爬
        if "captcha" in msg_lower or "verify" in msg_lower:
            return ErrorType.CAPTCHA
        if "bot" in msg_lower or "blocked" in msg_lower or "cloudflare" in msg_lower:
            return ErrorType.BOT_DETECTION
        
        # 编码
        if "encode" in msg_lower or "decode" in msg_lower or "utf" in msg_lower:
            return ErrorType.ENCODING_ERROR
        
        # 空结果 (非异常，由调用方显式传入)
        if "empty" in msg_lower:
            return ErrorType.EMPTY_RESULT
        
        # SPA检测 (由调用方判断后显式传入)
        if "spa" in msg_lower:
            return ErrorType.SPA_DETECTED
        
        # 默认
        return ErrorType.SERVER_ERROR
    
    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop('data', None)  # 大字段不序列化
        return d
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
    
    def format_for_model(self) -> str:
        """生成给模型看的字符串（注入到prompt）"""
        if self.success:
            return f"[✓] {self.tool_name}({self.target}): 成功 — {self.data_summary[:200]}"
        else:
            icon = "♻️" if self.is_retryable else "✗"
            return (
                f"[{icon}] {self.tool_name}({self.target}): 失败\n"
                f"  类型: {self.error_type}\n"
                f"  原因: {self.error_message}\n"
                f"  重试: {'是' if self.is_retryable else '否'}\n"
                f"  建议: {self.suggestion or '无'}"
            )


def classify_failure(tool_name: str, target: str, response_text: str = "",
                     http_status: int = 0, engine: str = "") -> ToolResult:
    """快速分析工具调用结果，判断成功/失败及类型"""
    
    # 空响应
    if not response_text or len(response_text.strip()) < 10:
        return ToolResult.failure(tool_name, target, ErrorType.EMPTY_RESULT,
                                  "返回内容为空", engine_used=engine)
    
    # SPA检测：返回内容<200字且含导航菜单
    if len(response_text) < 200 and any(kw in response_text.lower() 
        for kw in ['nav', 'menu', 'header', 'footer', 'sidebar', 'главная', 'меню']):
        return ToolResult.failure(tool_name, target, ErrorType.SPA_DETECTED,
                                  f"SPA网站，返回{len(response_text)}字，需完整浏览器渲染",
                                  engine_used=engine)
    
    # HTTP状态码
    if http_status == 404:
        is_spasibo = 'спасибо' in response_text.lower()
        return ToolResult.failure(tool_name, target, 
                                  ErrorType.SPASIBO_ERROR if is_spasibo else ErrorType.NOT_FOUND,
                                  f"HTTP 404 /{'спасибо确认' if is_spasibo else '页面不存在'}")
    if http_status == 403:
        return ToolResult.failure(tool_name, target, ErrorType.FORBIDDEN, "HTTP 403")
    if http_status >= 500:
        return ToolResult.failure(tool_name, target, ErrorType.SERVER_ERROR, f"HTTP {http_status}")
    
    # 反爬检测
    if any(kw in response_text.lower() for kw in ['captcha', 'капча', 'проверка']):
        return ToolResult.failure(tool_name, target, ErrorType.CAPTCHA, 
                                  "检测到验证码", engine_used=engine)
    if any(kw in response_text.lower() for kw in ['cloudflare', 'бот', 'заблокирован']):
        return ToolResult.failure(tool_name, target, ErrorType.BOT_DETECTION,
                                  "反爬/机器人检测触发", engine_used=engine)
    
    # 成功
    return ToolResult.success(tool_name, target, response_text,
                              data_summary=response_text[:200],
                              engine_used=engine)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 指数退避重试
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def retry_with_backoff(func, max_retries: int = 3, base_delay: float = 1.0,
                       backoff_factor: float = 2.0, max_delay: float = 30.0,
                       retryable_errors: tuple = (TimeoutError, ConnectionError)):
    """
    指数退避重试装饰器/函数
    延迟: 1s → 2s → 4s → ... (最多30s)
    """
    last_exception = None
    for attempt in range(max_retries + 1):
        try:
            return True, func()
        except retryable_errors as e:
            last_exception = e
            if attempt < max_retries:
                delay = min(base_delay * (backoff_factor ** attempt), max_delay)
                time.sleep(delay)
        except Exception as e:
            # 非可重试错误，直接抛出
            return False, e
    
    return False, last_exception


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 循环检测器
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class LoopDetector:
    """
    循环失败检测器 — 防止模型进入死循环消耗 token
    
    两层检测:
      1. 精确匹配: 最近N步内有完全相同的action
      2. 语义相似度: action相似度超过阈值

    来源: 字节 Deep Research Agent 实战
          加入后循环导致token超量使用事故从每天3次降到接近0
    """
    
    def __init__(self, window_size: int = 5, similarity_threshold: float = 0.9):
        self.recent_actions = []  # [(tool_name, query_hash, timestamp), ...]
        self.window_size = window_size
        self.threshold = similarity_threshold
        self.fail_count_by_tool = {}  # 每个工具的失败次数
        self.max_fails_per_tool = 3
    
    def check(self, tool_name: str, query: str = "", url: str = "", 
              success: bool = False) -> dict:
        """
        检查是否出现循环
        
        Returns:
          {"is_loop": bool, "reason": str, "action": "continue"|"warn"|"force_stop"}
        """
        target = query or url or ""
        normalized = self._normalize(tool_name, target)
        
        # 记录失败次数
        if not success:
            self.fail_count_by_tool[tool_name] = self.fail_count_by_tool.get(tool_name, 0) + 1
        else:
            self.fail_count_by_tool[tool_name] = 0  # 成功重置
        
        # 1. 精确匹配检测
        if normalized in [a[0] for a in self.recent_actions[-self.window_size:]]:
            self.recent_actions.append((normalized, time.time()))
            return {
                "is_loop": True,
                "reason": f"最近{self.window_size}步内有完全相同的工具调用: {tool_name}({target[:50]})",
                "action": "force_stop",
                "fail_count": self.fail_count_by_tool.get(tool_name, 0)
            }
        
        # 2. 语义相似度检测
        for past_normalized, _ in self.recent_actions[-self.window_size:]:
            sim = self._similarity(normalized, past_normalized)
            if sim > self.threshold:
                self.recent_actions.append((normalized, time.time()))
                return {
                    "is_loop": True,
                    "reason": f"相似度{sim:.2%}超过阈值{self.threshold:.0%}: {tool_name}({target[:50]})",
                    "action": "warn",
                    "fail_count": self.fail_count_by_tool.get(tool_name, 0)
                }
        
        # 3. 同工具失败次数检测
        fc = self.fail_count_by_tool.get(tool_name, 0)
        if fc >= self.max_fails_per_tool:
            return {
                "is_loop": True,
                "reason": f"工具 {tool_name} 已连续失败{fc}次（阈值{self.max_fails_per_tool}次）",
                "action": "force_stop",
                "fail_count": fc
            }
        
        self.recent_actions.append((normalized, time.time()))
        # 保持窗口大小
        if len(self.recent_actions) > self.window_size * 2:
            self.recent_actions = self.recent_actions[-self.window_size:]
        
        return {
            "is_loop": False,
            "reason": "",
            "action": "continue",
            "fail_count": fc
        }
    
    def _normalize(self, tool_name: str, target: str) -> str:
        """标准化 action：去掉时间戳等变化字段，提取核心指纹"""
        # 去掉协议、www、尾部斜杠
        t = re.sub(r'^https?://', '', target)
        t = re.sub(r'^www\.', '', t)
        t = t.rstrip('/')
        # 短指纹
        return f"{tool_name}:{t[:100]}"
    
    def _similarity(self, a: str, b: str) -> float:
        """语义相似度：公共子串占比"""
        return SequenceMatcher(None, a, b).ratio()
    
    def inject_prompt(self) -> str:
        """生成注入给模型的循环警告 prompt"""
        recent = [a[0] for a in self.recent_actions[-5:]]
        return (
            "⚠️ 循环检测警告：你已经重复调用了相似的工具多次。\n"
            f"  最近5步: {recent}\n"
            "  请更换思路：尝试不同的数据源、搜索引擎、或调整搜索策略。\n"
            "  如果已经尝试了3种以上不同方法仍然失败，请记录信息缺口并继续下一步。"
        )
    
    def reset_tool(self, tool_name: str):
        """重置某个工具的失败计数（成功一次后）"""
        self.fail_count_by_tool[tool_name] = 0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 降级透明 — 信息完整性报告
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class DegradationReporter:
    """
    降级透明策略 — 告知用户信息缺口
    
    原则: 对用户说「我拿不到这条信息，以下结论是在没有这条信息的情况下给出的」
          远比默默生成一个基于不完整信息的自信结论要好。
          前者听起来没那么 impressive，但它是诚实的。
    
    来源: Claude Code 设计哲学 — "Be transparent about your limitations and uncertainties."
    """
    
    def __init__(self):
        self.steps_executed = []
        self.steps_failed = []
        self.total_tool_calls = 0
        self.successful_calls = 0
        self.information_gaps = []  # 未能获取的信息
        self.confidence_items = {"high": [], "medium": [], "low": [], "missing": []}
    
    def record_step(self, step_name: str, success: bool, 
                    tool_calls: int = 0, successful_calls: int = 0,
                    gaps: list = None):
        """记录一个步骤的执行结果"""
        self.total_tool_calls += tool_calls
        self.successful_calls += successful_calls
        
        if success:
            self.steps_executed.append(step_name)
        else:
            self.steps_failed.append(step_name)
        
        if gaps:
            self.information_gaps.extend(gaps)
    
    def add_confidence(self, level: Literal["high", "medium", "low", "missing"], 
                       item: str):
        self.confidence_items[level].append(item)
    
    def generate_report(self) -> str:
        """生成信息完整性声明 — 注入到最终报告"""
        lines = []
        
        # 信息完整性说明
        lines.append("## 信息完整性说明")
        lines.append(f"本次分析共执行 {len(self.steps_executed) + len(self.steps_failed)} 个步骤，")
        lines.append(f"工具调用 {self.total_tool_calls} 次，成功获取 {self.successful_calls} 条数据。")
        lines.append("")
        
        if self.steps_failed:
            lines.append(f"**以下步骤未能完成** ({len(self.steps_failed)}个)：")
            for step in self.steps_failed:
                lines.append(f"- {step}")
            lines.append("")
        
        if self.information_gaps:
            lines.append(f"**以下信息未能获取** ({len(self.information_gaps)}项)：")
            for gap in self.information_gaps:
                lines.append(f"- {gap}")
            lines.append("建议通过人工渠道补充上述信息。")
            lines.append("")
        
        # 置信度说明
        lines.append("## 置信度说明")
        lines.append("以下结论基于可获取信息，置信度评估：")
        if self.confidence_items["high"]:
            items = "、".join(self.confidence_items["high"])
            lines.append(f"- **高置信度**（≥3个信源交叉验证）：{items}")
        if self.confidence_items["medium"]:
            items = "、".join(self.confidence_items["medium"])
            lines.append(f"- **中置信度**（1-2个信源）：{items}")
        if self.confidence_items["low"]:
            items = "、".join(self.confidence_items["low"])
            lines.append(f"- **低置信度**（推断/单一来源）：{items}")
        if self.confidence_items["missing"]:
            items = "、".join(self.confidence_items["missing"])
            lines.append(f"- **信息不足**（未能获取）：{items}")
        
        return "\n".join(lines)
    
    def get_completeness_score(self) -> float:
        """信息完整度 0.0-1.0"""
        total = self.steps_executed + self.steps_failed
        if total == 0:
            return 0.0
        return len(self.steps_executed) / len(total)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 工具调用包装器（集成所有容错层）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class SafeToolRunner:
    """
    安全的工具调用封装 — 自动执行：
      1. 循环检测
      2. 错误分类
      3. 统一格式返回
      4. 指数退避重试（临时性错误）
      5. 降级记录
    """
    
    def __init__(self):
        self.loop_detector = LoopDetector()
        self.degradation = DegradationReporter()
    
    def run(self, tool_name: str, target: str, 
            call_func, *args, max_retries: int = 2, 
            engine: str = "", **kwargs) -> ToolResult:
        """
        安全执行工具调用
        
        Args:
            tool_name: 工具名（如 'lightpanda_fetch'）
            target: 调用目标（URL/搜索词/INN）
            call_func: 实际执行函数
            max_retries: 最大重试次数
            engine: 引擎类型
        
        Returns:
            ToolResult: 统一格式的结果
        """
        # 1. 循环检测
        loop_check = self.loop_detector.check(
            tool_name=tool_name, 
            url=target if target.startswith('http') else "", 
            query=target if not target.startswith('http') else ""
        )
        
        if loop_check["is_loop"]:
            if loop_check["action"] == "force_stop":
                return ToolResult.failure(
                    tool_name, target, ErrorType.SERVER_ERROR,
                    f"循环检测强制终止: {loop_check['reason']}",
                    engine_used=engine
                )
            # warn - 允许尝试但附警告
            print(f"[LoopDetector WARN] {loop_check['reason']}")
        
        # 2. 执行调用（带指数退避）
        last_result = None
        for attempt in range(max_retries + 1):
            try:
                raw_result = call_func(*args, **kwargs) if args or kwargs else call_func()
                
                # 判断结果
                if isinstance(raw_result, ToolResult):
                    result = raw_result
                elif isinstance(raw_result, str):
                    result = classify_failure(tool_name, target, raw_result, engine=engine)
                elif isinstance(raw_result, (list, dict)):
                    if raw_result:
                        result = ToolResult.success(tool_name, target, raw_result, 
                                                    data_summary=str(raw_result)[:200],
                                                    engine_used=engine)
                    else:
                        result = ToolResult.failure(tool_name, target, ErrorType.EMPTY_RESULT,
                                                    "返回空数据", engine_used=engine)
                else:
                    result = ToolResult.success(tool_name, target, raw_result,
                                                engine_used=engine)
                
                result.retry_count = attempt
                
                if result.success:
                    self.loop_detector.reset_tool(tool_name)
                    # 记录循环检测状态
                    self.loop_detector.check(tool_name, target, 
                                            query=target if not target.startswith('http') else "",
                                            url=target if target.startswith('http') else "",
                                            success=True)
                    return result
                
                # 失败 — 判断是否可重试
                if not result.is_retryable or attempt >= max_retries:
                    self.loop_detector.check(tool_name, target,
                                            query=target if not target.startswith('http') else "",
                                            url=target if target.startswith('http') else "",
                                            success=False)
                    return result
                
                # 指数退避
                delay = min(1.0 * (2 ** attempt), 4.0)
                time.sleep(delay)
                last_result = result
                
            except Exception as e:
                result = ToolResult.from_exception(tool_name, target, e, 
                                                   retry_count=attempt,
                                                   engine_used=engine)
                if not result.is_retryable or attempt >= max_retries:
                    self.loop_detector.check(tool_name, target,
                                            query=target if not target.startswith('http') else "",
                                            url=target if target.startswith('http') else "",
                                            success=False)
                    return result
                delay = min(1.0 * (2 ** attempt), 4.0)
                time.sleep(delay)
                last_result = result
        
        return last_result or ToolResult.failure(
            tool_name, target, ErrorType.SERVER_ERROR, "未知错误", engine_used=engine
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. 便捷函数
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def make_error_schema():
    """返回可用于 reference 文档的完整错误格式说明"""
    return {
        "schema": {
            "success": "bool — 调用是否成功",
            "error_type": "str — ErrorType枚举值（TIMEOUT/NOT_FOUND/FORBIDDEN/...）",
            "error_message": "str — 人类可读的错误描述",
            "is_retryable": "bool — 是否值得重试（临时性=true，确定性=false）",
            "suggestion": "str — 给模型的下一步操作建议",
            "retry_count": "int — 已重试次数",
            "source_url": "str — 数据源URL（用于溯源）",
            "engine_used": "str — 使用的引擎（lightpanda/browser_navigate/curl）",
            "timestamp": "float — Unix时间戳"
        },
        "error_types": {et.value: f"可重试={RETRYABLE_MAP[et]}" for et in ErrorType},
        "retryable_errors": [et.value for et, r in RETRYABLE_MAP.items() if r],
        "non_retryable_errors": [et.value for et, r in RETRYABLE_MAP.items() if not r],
    }


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CLI 入口（用于测试）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法:")
        print("  python3 failure_handler.py test         # 运行自测")
        print("  python3 failure_handler.py schema       # 输出错误格式说明")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "schema":
        print(json.dumps(make_error_schema(), indent=2, ensure_ascii=False))
    
    elif cmd == "test":
        print("=== 容错框架自测 ===\n")
        
        # 测试 LoopDetector
        print("1. LoopDetector 测试")
        detector = LoopDetector(window_size=3)
        
        actions = [
            ("lightpanda_fetch", "https://rusprofile.ru/search?query=12345", False),
            ("lightpanda_fetch", "https://rusprofile.ru/search?query=12345", False),
            ("lightpanda_fetch", "https://rusprofile.ru/search?query=12345", False),
            ("browser_navigate", "https://zakupki.gov.ru", True),
        ]
        
        for tool, target, success in actions:
            result = detector.check(tool, query=target, success=success)
            status = f"🔴 循环检测!" if result["is_loop"] else "🟢 OK"
            print(f"  {status} {tool}({target[:50]}...) → {result.get('action', 'N/A')}")
        
        # 测试 ToolResult
        print("\n2. ToolResult 测试")
        success_result = ToolResult.success(
            "lightpanda_fetch", "https://rusprofile.ru/search",
            "ООО ПромЭнерго ...", data_summary="公司名: ПромЭнерго, INN: 7734..., 员工: 150人",
            source_url="https://rusprofile.ru/company/12345", engine_used="lightpanda"
        )
        print(f"  成功: {success_result.format_for_model()}")
        
        fail_result = ToolResult.failure(
            "browser_navigate", "https://zakupki.gov.ru",
            ErrorType.TIMEOUT, "zakupki.gov.ru 页面加载超时 (600s)",
            engine_used="browser_navigate"
        )
        print(f"  失败: {fail_result.format_for_model()}")
        
        not_found = ToolResult.failure(
            "lightpanda_fetch", "https://company.ru/products",
            ErrorType.SPASIBO_ERROR, "Спасибо... 页面不存在",
            engine_used="lightpanda"
        )
        print(f"  404(spasibo): {not_found.format_for_model()}")
        
        # 测试异常分类
        print("\n3. 异常分类测试")
        test_cases = [
            (TimeoutError("Connection timed out"), "TIMEOUT"),
            (ConnectionError("getaddrinfo ENOTFOUND"), "DNS_ERROR"),
            (Exception("HTTP 404 Not Found"), "NOT_FOUND"),
            (Exception("Cloudflare bot detection"), "BOT_DETECTION"),
            (Exception("SSL certificate verify failed"), "SSL_ERROR"),
        ]
        for exc, expected in test_cases:
            result = ToolResult.from_exception("test_tool", "test_target", exc)
            status = "✅" if result.error_type == expected else "❌"
            print(f"  {status} {type(exc).__name__}: {result.error_type} (expected: {expected})")
        
        # 测试 DegradationReporter
        print("\n4. DegradationReporter 测试")
        reporter = DegradationReporter()
        reporter.record_step("Step 1 身份锚定", True, 3, 3)
        reporter.record_step("Step 2 政府采购", False, 2, 0, 
                           gaps=["zakupki.gov.ru 无公开采购记录"])
        reporter.record_step("Step 3 制裁检查", True, 4, 4)
        reporter.record_step("Step 5 社交痕迹", False, 3, 0,
                           gaps=["VK未找到决策人", "LinkedIn无结果"])
        reporter.add_confidence("high", "公司存在确认、INN/OGRN获取")
        reporter.add_confidence("medium", "制裁状态确认")
        reporter.add_confidence("missing", "采购联系人")
        reporter.add_confidence("missing", "元器件具体型号")
        
        print(reporter.generate_report())
        
        print(f"\n=== 测试完成 ===")
        print(f"信息完整度: {reporter.get_completeness_score():.0%}")
